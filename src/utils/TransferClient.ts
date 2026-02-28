import { Platform } from 'react-native';
import TcpSocket from 'react-native-tcp-socket';
import RNFS from 'react-native-fs';
import { Buffer } from 'buffer';
import DeviceInfo from 'react-native-device-info';
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
    };
    connected: boolean;
    files?: any[];
}

export class TransferClient {
    private isTransferring = false;
    private shouldStop = false;
    private isProbing = false;
    private downloadedFiles = new Set<string>();
    public onStatus?: (status: TransferStatus) => void;

  // Max auto-retries per file on transient errors (network blip, timeout)
  private static readonly MAX_RETRIES = 3;
  // Base delay for exponential backoff: 1s, 2s, 4s
  private static readonly RETRY_BASE_DELAY_MS = 1000;

    start(port = 8888, saveDir: string, specificIp?: string) {
        console.log(`[TransferClient] Starting client on port ${port}...`);
        this.shouldStop = false;
        this.isTransferring = false;
        this.isProbing = false;
        this.initConnection(port, saveDir, specificIp);
    }

    stop() {
        console.log('[TransferClient] Stopping client...');
        this.shouldStop = true;
        this.isTransferring = false;
        this.isProbing = false;
    }

  /**
   * Remove a file from the "already downloaded" set so the retry logic
   * treats it as a new file and re-downloads (resuming from partial).
   */
  clearFailedFile(fileName: string, fileSize: number) {
    this.downloadedFiles.delete(fileName + fileSize);
    console.log(`[TransferClient] Cleared ${fileName} from downloaded set — will resume on next poll.`);
  }

    private reportStatus(status: TransferStatus) {
        if (this.onStatus) {
            this.onStatus(status);
        }
    }

    private async initConnection(port: number, saveDir: string, specificIp?: string) {
        if (this.isProbing || this.shouldStop) return;
        this.isProbing = true;

      this.reportStatus({ type: 'log', message: '🔍 Discovering sender...', connected: false });

      let foundIp: string | null = null;

      // ── If caller already knows the IP (e.g. from QR scan), probe it first ──
        if (specificIp && specificIp !== '0.0.0.0' && specificIp !== '127.0.0.1') {
          this.reportStatus({
            type: 'log',
            message: `🎯 Trying known IP: ${specificIp}...`,
            connected: false
          });

          let ok = false;
          // Retry up to 10 times to allow the Wi-Fi connection to fully establish
          for (let i = 0; i < 10; i++) {
            if (this.shouldStop) break;
            ok = await DiscoveryManager.probeTcpPort(specificIp, port, 3000);
            if (ok) break;

            this.reportStatus({
              type: 'log',
              message: `⏳ Waiting for network... (Attempt ${i + 1}/10)`,
              connected: false
            });
            await new Promise(r => setTimeout(r, 2000));
          }

          if (ok && !this.shouldStop) {
            foundIp = specificIp;
          }
        }

      // ── Full discovery (mDNS primary → subnet scan fallback) ──
      if (!foundIp && !this.shouldStop) {
        foundIp = await DiscoveryManager.discoverSender(
          port,
          (msg) => this.reportStatus({ type: 'log', message: msg, connected: false })
        );
      }

      this.isProbing = false;

      if (foundIp && !this.shouldStop) {
        console.log(`[TransferClient] Sender found at ${foundIp}`);
        this.persistentLoop(foundIp, port, saveDir);
      } else if (!this.shouldStop) {
        this.reportStatus({
          type: 'log',
          message: '❌ Sender not found. Make sure both devices are on the same Wi-Fi.',
          connected: false
        });
      }
    }

    private async persistentLoop(ip: string, port: number, saveDir: string) {
      this.reportStatus({ type: 'connection', message: '✅ Connected!', connected: true });
        console.log(`[TransferClient] Standing by for files from ${ip}...`);

      // Force traffic through Wi-Fi on Android (prevent fallback to mobile data)
      if (Platform.OS === 'android') {
        try {
          const WifiManager = require('react-native-wifi-reborn').default;
          await WifiManager.forceWifiUsage(true);
        } catch (_) { }
      }

        let failCount = 0;
      while (!this.shouldStop) {
        try {
          const files = await this.fetchMetadata(ip, port);
          failCount = 0;

          if (files && files.length > 0) {
                this.reportStatus({
                  type: 'log',
                  message: this.isTransferring ? '⬇️ Downloading...' : '⏳ Standing by...',
                  connected: true,
                  files
                });

                if (!this.isTransferring) {
                  const newFiles = files.filter(
                    (f: any) => !this.downloadedFiles.has(f.name + (f.size || 0))
                  );
                        if (newFiles.length > 0) {
                            console.log(`[TransferClient] New files detected: ${newFiles.length}`);
                          this.isTransferring = true;
                            await this.downloadAll(newFiles, ip, port, saveDir);
                            this.isTransferring = false;
                        }
                    }
              }
        } catch (e) {
          failCount++;
          console.log(`[TransferClient] Polling error (retry ${failCount})`);
          if (failCount > 10 && !this.shouldStop) {
            console.log(`[TransferClient] Connection lost to ${ip}. Re-discovering...`);
            this.reportStatus({
              type: 'log',
              message: '🔄 Connection lost. Re-discovering...',
              connected: false
            });
            this.initConnection(port, saveDir, ip);
            return;
          }
        }
        // Adaptive polling: fast when active transfer, slow when idle
        await new Promise(r => setTimeout(r, this.isTransferring ? 500 : 2000));
        }
    }

  // trySingleIp removed — use DiscoveryManager.probeTcpPort() instead

  private async fetchMetadata(ip: string, port: number): Promise<any[]> {
    const url = `http://${ip}:${port}/api/files`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    try {
          const response = await fetch(url, { signal: controller.signal });
          clearTimeout(timeoutId);
          if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
          return await response.json();
        } catch (e) {
          clearTimeout(timeoutId);
          throw e;
        }
    }

    async downloadAll(files: any[], ip: string, port: number, saveDir: string) {
      if (!(await RNFS.exists(saveDir))) { await RNFS.mkdir(saveDir).catch(() => { }); }

      // ── 3-Tier Parallelism Strategy ───────────────────────────────────
      // Small  (<5MB):   3 parallel — fast, minimal memory pressure
      // Medium (5-50MB): 2 parallel — balanced speed + stability
      // Large  (>50MB):  1 at a time — maximizes bandwidth per file
      const smallFiles = files.filter(f => (f.size || 0) < 5 * 1024 * 1024);
      const mediumFiles = files.filter(f => (f.size || 0) >= 5 * 1024 * 1024 && (f.size || 0) < 50 * 1024 * 1024);
      const largeFiles = files.filter(f => (f.size || 0) >= 50 * 1024 * 1024);

      const runBatch = async (batch: any[], concurrency: number) => {
        for (let i = 0; i < batch.length; i += concurrency) {
          if (this.shouldStop) break;
          const chunk = batch.slice(i, i + concurrency);
          await Promise.all(
            chunk.map(file =>
              this.downloadFile(file, ip, port, saveDir)
                .then(() => this.downloadedFiles.add(file.name + (file.size || 0)))
                    .catch(e => console.error(`[TransferClient] Download failed: ${file.name}`, e))
                )
              );
        }
      };

      await runBatch(smallFiles, 3);
      await runBatch(mediumFiles, 2);
      await runBatch(largeFiles, 1);

      this.reportStatus({ type: 'complete', message: '✅ Batch Completed', connected: true });
    }

  private downloadFile(file: any, ip: string, port: number, saveDir: string): Promise<void> {
    return this.downloadFileWithRetry(file, ip, port, saveDir, 0);
    }

  /**
   * Core download logic with exponential-backoff retry.
   *
   * On NETWORK ERROR:
   *   - Keep partial file (resume on next attempt via Range header)
   *   - Wait: 1s, 2s, 4s between retries
   *   - After MAX_RETRIES, reject so batch can continue with other files
   *
   * On BAD HTTP STATUS (4xx/5xx):
   *   - Delete partial (unrecoverable for this session)
   *   - Reject immediately (no point retrying)
   */
  private async downloadFileWithRetry(
    file: any,
    ip: string,
    port: number,
    saveDir: string,
    attempt: number
  ): Promise<void> {
        const dest = `${saveDir}/${file.name}`;
      const total: number = file.size || 0;
      const maxRetries = TransferClient.MAX_RETRIES;

      // ── Integrity / Skip Check ────────────────────────────────────────────
      if (await RNFS.exists(dest)) {
            const stat = await RNFS.stat(dest);
          if (stat.size >= total && total > 0) {
            console.log(`[TransferClient] ✅ ${file.name} already complete, skipping.`);
            this.reportStatus({
              type: 'progress',
              connected: true,
              fileProgress: { name: file.name, percent: 100, received: total, total }
            });
            return;
        }
      }

      // ── Calculate resume offset ───────────────────────────────────────────
      let resumeFrom = 0;
      if (await RNFS.exists(dest)) {
        const stat = await RNFS.stat(dest);
        if (stat.size > 0) {
          resumeFrom = stat.size;
          const pct = Math.min(99, Math.floor((resumeFrom / total) * 100));
          console.log(`[TransferClient] ⏩ Attempt ${attempt + 1}/${maxRetries + 1} — Resuming ${file.name} from byte ${resumeFrom} (${pct}%)`);
          this.reportStatus({
            type: 'progress',
            connected: true,
            fileProgress: { name: file.name, percent: pct, received: resumeFrom, total }
          });
        }
        } else {
          this.reportStatus({
            type: 'progress',
            connected: true,
            fileProgress: { name: file.name, percent: 0, received: 0, total }
          });
        }

      const downloadUrl = `http://${ip}:${port}/api/download?name=${encodeURIComponent(file.name)}`;
      const headers: Record<string, string> = {};
      if (resumeFrom > 0) {
        headers['Range'] = `bytes=${resumeFrom}-`;
      }

      try {
          console.log(`[TransferClient] ⬇️  Downloading: ${file.name} from byte ${resumeFrom}`);

          const { promise } = RNFS.downloadFile({
                fromUrl: downloadUrl,
                toFile: dest,
              headers,
                progressDivider: 2,
              begin: () => console.log(`[TransferClient] Download begin: ${file.name}`),
                progress: (res) => {
                  const received = resumeFrom + res.bytesWritten;
                  const expectedTotal = total > 0 ? total : (res.contentLength + resumeFrom);
                  const pct = Math.min(100, Math.floor((received / expectedTotal) * 100));
                  this.reportStatus({
                    type: 'progress',
                    connected: true,
                    fileProgress: { name: file.name, percent: pct, received, total: expectedTotal }
                  });
                }
            });

          const res = await promise;

          // ── 200 OK (full) or 206 Partial Content (resumed) = success ─────
          if (res.statusCode === 200 || res.statusCode === 206) {
            // Final integrity check: file size must match declaration
            if (total > 0) {
              const finalStat = await RNFS.stat(dest).catch(() => null);
              if (finalStat && finalStat.size < total) {
                console.warn(`[TransferClient] ⚠️  ${file.name} size mismatch (got ${finalStat.size}, expected ${total}). Will resume.`);
                // File is partial — do not mark as complete, let next poll resume it
                return;
              }
            }

            this.reportStatus({
              type: 'progress',
              connected: true,
              fileProgress: { name: file.name, percent: 100, received: total, total }
            });
            saveHistoryItem({
              fileName: file.name,
              fileSize: file.size,
              type: file.type || 'unknown',
              role: 'received',
              status: 'success'
            });
            console.log(`[TransferClient] ✅ Download complete: ${file.name}`);
            return;
          }

          // ── Bad HTTP status — unrecoverable, discard partial ─────────────
          await RNFS.unlink(dest).catch(() => { });
          throw new Error(`HTTP ${res.statusCode} — unrecoverable, discarding partial file.`);

        } catch (e: any) {
          const isLastAttempt = attempt >= maxRetries;

          if (isLastAttempt || this.shouldStop) {
            // Partial file is KEPT so the next session's retry can resume
            console.error(`[TransferClient] ❌ ${file.name} failed after ${attempt + 1} attempt(s): ${e.message}`);
            throw e; // Let batch handle the error
            }

          // ── Exponential backoff before next attempt ───────────────────────
          const delayMs = TransferClient.RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
          console.warn(`[TransferClient] ⚠️  ${file.name} failed (attempt ${attempt + 1}/${maxRetries + 1}). Retrying in ${delayMs}ms...`);
          this.reportStatus({
            type: 'log',
            message: `⚠️ ${file.name} — retrying in ${delayMs / 1000}s... (${attempt + 1}/${maxRetries})`,
            connected: true
            });

          await new Promise(r => setTimeout(r, delayMs));

          // Recurse with incremented attempt counter
          return this.downloadFileWithRetry(file, ip, port, saveDir, attempt + 1);
        }
    }
}

export default new TransferClient();
