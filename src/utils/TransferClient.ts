import { Platform } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';

import { Buffer } from 'buffer';
import DeviceInfo from 'react-native-device-info';
import CryptoJS from 'crypto-js';
import { saveHistoryItem } from './HistoryService';
import DiscoveryManager from './DiscoveryManager';

export type TransferStatus = {
  type: 'log' | 'progress' | 'complete' | 'connection';
  message?: string;
  fileProgress?: {
    name: string;
    percent: number;
    received: number;
    total: number;
    speed?: number;    // bytes/sec — wall-clock
    etaSecs?: number;
  };
  connected: boolean;
  files?: any[];
};

// ─── Wall-clock speed tracker — same formula as TransferServer ────────────────
// Both sides use identical math → same speed/ETA shown on both devices.
class SpeedTracker {
  private t0 = 0;
  private b0 = 0;
  private on = false;

  begin(bytes: number) { this.t0 = Date.now(); this.b0 = bytes; this.on = true; }

  sample(bytes: number, total: number): { speed: number; etaSecs: number } {
    if (!this.on) return { speed: 0, etaSecs: 0 };
    const dt = (Date.now() - this.t0) / 1000;
    if (dt < 0.3) return { speed: 0, etaSecs: 0 };
    const speed = Math.round((bytes - this.b0) / dt);
    const remaining = total - bytes;
    const etaSecs = speed > 0 && remaining > 0 ? Math.round(remaining / speed) : 0;
    return { speed, etaSecs };
  }

  reset() { this.on = false; }
}

export class TransferClient {
  private isTransferring = false;
  private shouldStop = false;
  private isProbing = false;
  private downloadedFiles = new Set<string>();
  private activeJobs = new Map<string, any>();
  private currentFiles: any[] = [];
  public onStatus?: (status: TransferStatus) => void;

  public connectedIp: string | null = null;
  public connectedPort: number = 8888;

  private static readonly MAX_RETRIES = 5;
  private static readonly RETRY_BASE_DELAY_MS = 1500;

  private secretKey?: string;
  private speedTrackers = new Map<string, SpeedTracker>();

  start(port = 8888, saveDir: string, specificIp?: string, secretKey?: string) {
    this.shouldStop = false;
    this.isTransferring = false;
    this.isProbing = false;
    this.activeJobs.clear();
    this.speedTrackers.clear();
    this.currentFiles = [];
    this.secretKey = secretKey;
    this.initConnection(port, saveDir, specificIp);
  }

  stop() {
    this.shouldStop = true;
    this.isTransferring = false;
    this.isProbing = false;
    this.activeJobs.forEach(job => { try { job.cancel(); } catch (_) { } });
    this.activeJobs.clear();
    this.speedTrackers.clear();
    this.currentFiles = [];
    this.downloadedFiles.clear();
    this.connectedIp = null;
  }

  clearFailedFile(fileName: string, fileSize: number) {
    this.downloadedFiles.delete(fileName + fileSize);
    this.speedTrackers.delete(fileName);
  }

  async registerWithPeer(myPort: number): Promise<void> {
    if (!this.connectedIp || this.shouldStop) return;
    try {
      const url = `http://${this.connectedIp}:${this.connectedPort}/api/register?port=${myPort}`;
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 6000);
      await fetch(url, { method: 'GET', signal: ctrl.signal });
      clearTimeout(tid);
    } catch (_) { }
  }

  private emit(status: TransferStatus) { this.onStatus?.(status); }

  private async initConnection(port: number, saveDir: string, specificIp?: string) {
    if (this.isProbing || this.shouldStop) return;
    this.isProbing = true;

    // We let the OS determine the route rather than using forceWifiUsage, 
    // because forceWifiUsage forces the wlan0 interface which blocks P2P traffic (p2p0 interface).

    let foundIp: string | null = null;

    // CASE 1: Specific IP provided (Wi-Fi Direct / QR Scan)
    if (specificIp && specificIp !== '0.0.0.0' && specificIp !== '127.0.0.1') {
      this.emit({ type: 'log', message: `🎯 Connecting to ${specificIp}...`, connected: false });

      // Wi-Fi Direct is point-to-point. If we have an IP, it's THE IP.
      // We retry for 60 seconds because the server might still be booting or group owner transitioning.
      console.log(`[TransferClient] Starting HTTP fetch probe sequence targeting ${specificIp}:${port} for up to 45 seconds`);
      for (let i = 0; i < 30 && !this.shouldStop; i++) {
        try {
          const tcpOk = await DiscoveryManager.probeTcpPort(specificIp, port, 1500);
          console.log(`[TransferClient] Probe attempt ${i + 1} - TCP socket ping: ${tcpOk ? 'Success' : 'Failed'}`);
          
          // Even if TCP failed, try HTTP directly (Android routing weirdness sometimes allows one but not the other)
          const files = await this.fetchMetadata(specificIp, port);
          if (files) {
            console.log(`[TransferClient] Successfully reached Sender over HTTP at ${specificIp}:${port}`);
            foundIp = specificIp;
            this.currentFiles = files; // Pre-cache to save a network roundtrip later
            break;
          }
        } catch (e: any) {
          console.log(`[TransferClient] HTTP Probe attempt ${i + 1} failed: ${e.message}`);
        }
        
        this.emit({ type: 'log', message: `⏳ Waiting for sender... (${i + 1}/30)`, connected: false });
        await new Promise(r => setTimeout(r, 1500));
      }

      if (!foundIp && !this.shouldStop) {
        console.error(`[TransferClient] Exhausted all HTTP probes, server unreachable at ${specificIp}:${port}`);
        this.emit({ type: 'log', message: '❌ Could not reach sender. Turn off Mobile Data & try again.', connected: false });
        this.isProbing = false;
        return;
      }
    }

    // CASE 2: No IP provided, use mDNS/Scan discovery
    if (!foundIp && !this.shouldStop) {
      this.emit({ type: 'log', message: '🔍 Discovering nearby senders...', connected: false });
      foundIp = await DiscoveryManager.discoverSender(port, msg => this.emit({ type: 'log', message: msg, connected: false }));
    }

    this.isProbing = false;

    if (foundIp && !this.shouldStop) {
      this.persistentLoop(foundIp, port, saveDir);
    } else if (!this.shouldStop) {
      this.emit({ type: 'log', message: '❌ Discovery failed. Try scanning the QR code.', connected: false });
    }
  }

  private async persistentLoop(ip: string, port: number, saveDir: string) {
    console.log(`[TransferClient] Starting persistent data loop pointing to ${ip}:${port}`);
    this.connectedIp = ip;
    this.connectedPort = port;
    this.emit({ type: 'connection', message: '✅ Connected!', connected: true });

    let failCount = 0;
    while (!this.shouldStop) {
      try {
        const files = await this.fetchMetadata(ip, port);
        if (failCount > 0) console.log(`[TransferClient] Metadata fetch completely restored after ${failCount} failures`);
        if (files) console.log(`[TransferClient] Metadata fetched successfully! Sender has ${files.length} files queued.`);
        failCount = 0;
        this.currentFiles = files;

        if (files?.length > 0) {
          this.emit({ type: 'log', message: this.isTransferring ? '⬇️ Downloading...' : '⏳ Standing by...', connected: true, files: this.currentFiles });

          if (!this.isTransferring) {
            // Only queue files not yet fully downloaded
            const newFiles = files.filter((f: any) => !this.downloadedFiles.has(f.name + (f.size || 0)));
            if (newFiles.length > 0) {
              this.isTransferring = true;
              this.downloadAll(newFiles, ip, port, saveDir, files)
                .catch(e => console.error('[Client] downloadAll failed:', e))
                .finally(() => { this.isTransferring = false; });
            }
          }
        }
      } catch (_) {
        failCount++;
        if (failCount > 10 && !this.shouldStop) {
          this.emit({ type: 'log', message: '🔄 Connection lost. Re-discovering...', connected: false });
          this.initConnection(port, saveDir, ip);
          return;
        }
      }
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  private async fetchMetadata(ip: string, port: number): Promise<any[]> {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 10000);
    try {
      const res = await fetch(`http://${ip}:${port}/api/files`, { signal: ctrl.signal });
      clearTimeout(tid);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) { clearTimeout(tid); throw e; }
  }

  async downloadAll(files: any[], ip: string, port: number, saveDir: string, allKnownFiles?: any[]) {
    if (!(await ReactNativeBlobUtil.fs.exists(saveDir))) await ReactNativeBlobUtil.fs.mkdir(saveDir).catch(() => { });
    this.currentFiles = allKnownFiles || files;
    this.emit({ type: 'log', message: '⬇️ Starting batch download...', connected: true, files: this.currentFiles });

    for (const file of files) {
      if (this.shouldStop) break;
      this.emit({ type: 'log', message: `⬇️ Downloading: ${file.name}`, connected: true, files: this.currentFiles });
      try {
        await this.downloadWithRetry(file, ip, port, saveDir, 0);
        // Mark ONLY after confirmed complete — prevents re-queue race
        this.downloadedFiles.add(file.name + (file.size || 0));
        console.log(`[Client] ✅ Confirmed complete: ${file.name}`);
      } catch (e) {
        // Do NOT add to downloadedFiles — will retry on next poll
        console.error(`[Client] ❌ Download failed (will retry next poll): ${file.name}`, e);
      }
    }

    this.emit({ type: 'complete', message: '✅ Batch Completed', connected: true, files: this.currentFiles });
  }

  private async downloadWithRetry(file: any, ip: string, port: number, saveDir: string, attempt: number): Promise<void> {
    const dest = `${saveDir}/${file.name}`;
    const total: number = file.size || 0;

    // Skip if already complete
    if (await ReactNativeBlobUtil.fs.exists(dest)) {
      const stat = await ReactNativeBlobUtil.fs.stat(dest);
      if (stat.size >= total && total > 0) {
        this.emit({ type: 'progress', connected: true, files: this.currentFiles, fileProgress: { name: file.name, percent: 100, received: total, total, speed: 0, etaSecs: 0 } });
        return;
      }
    }

    // Resume support
    let resumeFrom = 0;
    if (await ReactNativeBlobUtil.fs.exists(dest)) {
      const stat = await ReactNativeBlobUtil.fs.stat(dest);
      if (stat.size > 0) {
        resumeFrom = stat.size;
        const pct = Math.min(99, Math.floor((resumeFrom / total) * 100));
        this.emit({ type: 'progress', connected: true, files: this.currentFiles, fileProgress: { name: file.name, percent: pct, received: resumeFrom, total, speed: 0, etaSecs: 0 } });
      }
    } else {
      this.emit({ type: 'progress', connected: true, files: this.currentFiles, fileProgress: { name: file.name, percent: 0, received: 0, total, speed: 0, etaSecs: 0 } });
    }

    // Init speed tracker for this file
    if (!this.speedTrackers.has(file.name)) {
      const t = new SpeedTracker();
      t.begin(resumeFrom);
      this.speedTrackers.set(file.name, t);
    }

    const tracker = this.speedTrackers.get(file.name)!;
    const headers: Record<string, string> = {};
    if (resumeFrom > 0 && !this.secretKey) headers['Range'] = `bytes=${resumeFrom}-`;

    const downloadUrl = `http://${ip}:${port}/api/download?name=${encodeURIComponent(file.name)}`;

    try {
      const task = ReactNativeBlobUtil.config({
        path: dest,
        overwrite: resumeFrom === 0,
        // High-performance flags for mobile-to-mobile
        fileCache: false,
      }).fetch('GET', downloadUrl, headers);

      this.activeJobs.set(file.name, task);

      task.progress({ interval: 500 }, (received, totalCount) => {
        const currentTotal = Number(totalCount);
        const receivedSoFar = resumeFrom + Number(received);
        const expectedTotal = total > 0 ? total : (currentTotal > 0 ? currentTotal + resumeFrom : receivedSoFar);
        if (expectedTotal === 0) return;
        const pct = Math.min(99, Math.floor((receivedSoFar / expectedTotal) * 100));
        const { speed, etaSecs } = tracker.sample(receivedSoFar, expectedTotal);
        this.emit({
          type: 'progress', connected: true, files: this.currentFiles,
          fileProgress: { name: file.name, percent: pct, received: receivedSoFar, total: expectedTotal, speed, etaSecs },
        });
      });

      const result = await task.finally(() => this.activeJobs.delete(file.name));
      const respInfo = result.info();

      if (respInfo.status === 200 || respInfo.status === 206) {
        // Decrypt if needed
        if (this.secretKey) {
          const encB64 = await ReactNativeBlobUtil.fs.readFile(dest, 'base64');
          const key = CryptoJS.SHA256(this.secretKey);
          const iv = CryptoJS.enc.Hex.parse(key.toString().substring(0, 32));
          const dec = CryptoJS.AES.decrypt(encB64, key, { iv });
          const decB64 = dec.toString(CryptoJS.enc.Utf8);
          if (!decB64) throw new Error('Decryption failed');
          await ReactNativeBlobUtil.fs.writeFile(dest, decB64, 'base64');
        }

        // Integrity check — if size mismatch, delete partial and let retry handle it
        if (total > 0 && !this.secretKey) {
          const finalStat = await ReactNativeBlobUtil.fs.stat(dest).catch(() => null);
          if (!finalStat || finalStat.size < total) {
            console.warn(`[Client] ⚠️ Size mismatch ${file.name}: got ${finalStat?.size} expected ${total}. Deleting partial.`);
            await ReactNativeBlobUtil.fs.unlink(dest).catch(() => { });
            throw new Error(`Size mismatch — got ${finalStat?.size}, expected ${total}`);
          }
        }

        this.speedTrackers.delete(file.name);
        this.emit({ type: 'progress', connected: true, files: this.currentFiles, fileProgress: { name: file.name, percent: 100, received: total, total, speed: 0, etaSecs: 0 } });
        saveHistoryItem({ fileName: file.name, fileSize: file.size, type: file.type || 'unknown', role: 'received', status: 'success' });
        return;
      }

      await ReactNativeBlobUtil.fs.unlink(dest).catch(() => { });
      throw new Error(`HTTP ${respInfo.status}`);

    } catch (e: any) {
      if (attempt >= TransferClient.MAX_RETRIES || this.shouldStop) throw e;
      const delay = TransferClient.RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      this.emit({ type: 'log', message: `⚠️ ${file.name} — retrying... (${attempt + 1}/${TransferClient.MAX_RETRIES})`, connected: true, files: this.currentFiles });
      await new Promise(r => setTimeout(r, delay));
      return this.downloadWithRetry(file, ip, port, saveDir, attempt + 1);
    }
  }
}

export default new TransferClient();