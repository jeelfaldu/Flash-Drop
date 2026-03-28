// TransferClient.ts
import ReactNativeBlobUtil from 'react-native-blob-util';
import crypto from 'react-native-quick-crypto';
import { Buffer } from 'buffer';
import { saveHistoryItem } from './HistoryService';

export type TransferContext = 'pc' | 'p2p';
export type TransferStatus = {
  type: 'log' | 'progress' | 'complete' | 'connection' | 'error';
  context?: TransferContext;
  message?: string;
  fileProgress?: { name: string; percent: number; received: number; total: number; speed?: number; etaSecs?: number; };
  connected: boolean;
  files?: any[];
};

class SpeedTracker {
  private t0 = 0;
  private b0 = 0;

  begin(bytes: number) {
    this.t0 = Date.now();
    this.b0 = bytes;
  }

  sample(bytes: number, total: number) {
    const dt = (Date.now() - this.t0) / 1000;
    if (dt < 0.1) return { speed: 0, etaSecs: 0 };

    const speed = Math.round((bytes - this.b0) / dt);
    const remaining = total - bytes;
    const etaSecs = speed > 0 ? Math.round(remaining / speed) : 0;

    return { speed, etaSecs };
  }
}

export class TransferClient {
  public onStatus?: (status: TransferStatus) => void;
  public isTransferring = false;
  private shouldStop = false;
  private activeJobs = new Map<string, any>();
  private statusListeners: Set<(status: TransferStatus) => void> = new Set();
  private downloadedFiles = new Set<string>();
  private secretKey?: string;
  private currentLoopId = 0; // ✅ Prevent overlapping poll loops from multiple start() calls

  public addStatusListener(l: (s: TransferStatus) => void) { this.statusListeners.add(l); }
  public removeStatusListener(l: (s: TransferStatus) => void) { this.statusListeners.delete(l); }

  private emit(status: TransferStatus) {
    const finalStatus = { ...status, context: this.currentContext || 'p2p' };
    this.onStatus?.(finalStatus);
    this.statusListeners.forEach(l => l(finalStatus));
  }
  private currentContext: TransferContext | null = null;

  public stop() {
    this.shouldStop = true;
    this.isTransferring = false;
    this.activeJobs.forEach(job => job.cancel());
    this.activeJobs.clear();
    this.downloadedFiles.clear();
    this.emit({ type: 'connection', connected: false });
  }

  public clearFailedFile(fileName: string, fileSize: number) {
    this.downloadedFiles.delete(`${fileName}|${fileSize}`);
  }

  // ✅ Call: TransferClient.start(8888, saveDir, ip) support
  public async start(port = 8888, saveDir: string, ip: string, secretKey?: string, context: TransferContext = 'p2p') {
    this.currentContext = context;
    // 🛑 Session handling: increment ID so any previous loop knows to die
    const loopId = ++this.currentLoopId;
    this.shouldStop = false;
    this.secretKey = secretKey;
    this.downloadedFiles.clear();
    this.isTransferring = false;
    this.emit({ type: 'connection', connected: true, message: 'Syncing...' });

    // Loop logic to monitor the server for new files
    while (!this.shouldStop && this.currentLoopId === loopId) {
      try {
        const res = await fetch(`http://${ip}:${port}/api/files`);
        if (!res.ok) throw new Error("Sync Fail");
        
        const files = await res.json();
        
        // 📥 Sync files to UI
        if (Array.isArray(files)) {
          this.emit({ type: 'connection', connected: true, files });
        }

        if (files.length > 0 && !this.isTransferring) {
          this.isTransferring = true;
          try {
            await this.processBatch(files, ip, port, saveDir);
          } catch (e) {
            console.error('[TransferClient] Batch error:', e);
          } finally {
            this.isTransferring = false;
          }
        }
      } catch (e: any) { 
        // Sync poll failed, will retry
      }
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  private async processBatch(files: any[], ip: string, port: number, saveDir: string) {
    for (const file of files) {
      if (this.shouldStop) break;
      const key = `${file.name}|${file.size}`;
      if (this.downloadedFiles.has(key)) continue;

      try {
        await this.downloadFile(file, ip, port, saveDir);
        this.downloadedFiles.add(key);
      } catch (e: any) {
        console.error('[TransferClient] File download error:', file.name, e);
      }
    }
    // Only emit batch completion if we completed something
    this.emit({ type: 'complete', connected: true, message: 'Batch Sync Done' });
  }

  private async downloadFile(file: any, ip: string, port: number, saveDir: string) {
    const dest = `${saveDir}/${file.name}`;
    let resumeAt = 0;

    if (await ReactNativeBlobUtil.fs.exists(dest)) {
      const s = await ReactNativeBlobUtil.fs.stat(dest);
      // Only skip if the size is EXACTLY the same AND it's not a tiny file (which might be a placeholder)
      if (s.size === file.size && s.size > 0) {
        this.emit({
          type: 'complete',
          connected: true,
          fileProgress: { name: file.name, percent: 100, received: file.size, total: file.size }
        });
        return;
      }
      // If file exists but size is different, we can resume only if NOT using encryption
      // (Encrypted files must be re-downloaded fully for security/correctness)
      resumeAt = (s.size < file.size && !this.secretKey) ? s.size : 0;
    }

    const url = `http://${ip}:${port}/api/download?name=${encodeURIComponent(file.name)}&token=${file.token}`;
    const reqHeaders: Record<string, string> = {};
    if (resumeAt > 0) reqHeaders['Range'] = `bytes=${resumeAt}-`;
    const task = ReactNativeBlobUtil.config({ path: dest, overwrite: resumeAt === 0 }).fetch('GET', url, reqHeaders);

    const tracker = new SpeedTracker();
    tracker.begin(resumeAt);

    this.activeJobs.set(file.name, task);
    task.progress((received, total) => {
      const currentReceived = Number(received) + resumeAt;
      const { speed, etaSecs } = tracker.sample(currentReceived, file.size);
      
      this.emit({
        type: 'progress', connected: true, fileProgress: {
          name: file.name, percent: Math.floor((currentReceived / file.size) * 100),
          received: currentReceived, total: file.size,
          speed, etaSecs
        }
      });
    });

    const res = await task;
    const h = res.info().headers;
    const ivHex = h['X-IV'] || h['x-iv'];
    const sHash = h['X-Hash'] || h['x-hash'];

    if (this.secretKey && ivHex) await this.decryptStream(dest, ivHex);

    if (sHash) {
      const lHash = await ReactNativeBlobUtil.fs.hash(dest, 'sha256');
      if (lHash.toLowerCase() !== sHash.toLowerCase()) {
        await ReactNativeBlobUtil.fs.unlink(dest);
        throw new Error("Hash fail");
      }
    }

    // ✅ Emit explicit completion for this file
    this.emit({
      type: 'complete',
      connected: true,
      fileProgress: {
        name: file.name,
        percent: 100,
        received: file.size,
        total: file.size,
        speed: 0,
        etaSecs: 0
      }
    });

    this.activeJobs.delete(file.name); // 🗑️ Cleanup job reference
    saveHistoryItem({ fileName: file.name, fileSize: file.size, type: file.type, role: 'received', status: 'success' });
  }

  // ✅ STREAMING DECRYPT (No Memory Leaks)
  private async decryptStream(path: string, ivHex: string) {
    const key = crypto.createHash('sha256').update(this.secretKey!).digest();
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    const tmp = path + ".enc";
    await ReactNativeBlobUtil.fs.mv(path, tmp);

    const r = await ReactNativeBlobUtil.fs.readStream(tmp, 'base64', 512 * 1024, 0);
    const w = await ReactNativeBlobUtil.fs.writeStream(path, 'base64', false);

    return new Promise((resolve, reject) => {
      r.onData(c => {
        const d = decipher.update(Buffer.from(c as string, 'base64'));
        if (d.length) w.write(d.toString('base64'));
      });
      r.onEnd(async () => {
        const f = decipher.final();
        if (f.length) await w.write(f.toString('base64'));
        await w.close(); await ReactNativeBlobUtil.fs.unlink(tmp);
        resolve(true);
      });
      r.onError(reject); r.open();
    });
  }
}

export default new TransferClient();