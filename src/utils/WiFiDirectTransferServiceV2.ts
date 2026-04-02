/**
 * WiFiDirectTransferServiceV2.ts
 * 
 * This service uses the native sendFile and receiveFile methods 
 * from react-native-wifi-p2p for better OS-level file handling.
 */

import { Platform } from 'react-native';
import RNBlobUtil from 'react-native-blob-util';
import WiFiDirectManager, { P2PStatus, WifiP2pDevice } from './Wifidirectmanager';
import TransferServer, { ServerStatus } from './TransferServer';
import TransferClient, { TransferStatus } from './TransferClient';

const P2P_PORT = 8888; // We still use this port for metadata sync

export type DirectTransferStatusV2 =
  | { type: 'p2p'; status: P2PStatus }
  | { type: 'progress'; name: string; percent: number; sent: number; total: number; speed?: number }
  | { type: 'complete'; name: string }
  | { type: 'ready'; ip: string; role: 'sender' | 'receiver' }
  | { type: 'client_connected'; deviceName?: string }
  | { type: 'error'; message: string };

class WiFiDirectTransferServiceV2 {
  private role: 'sender' | 'receiver' | null = null;
  private isActive = false;
  private _isFinalized = false;
  private currentSaveDir: string = '';
  public onStatus?: (status: DirectTransferStatusV2) => void;

  public isRunning(): boolean {
    return this.isActive;
  }

  // ── SENDER (Client) ───────────────────────────────────────────────────────
  async startSender(files: any[], onDevicesFound?: (devices: WifiP2pDevice[]) => void) {
    console.log('[V2 SERVICE] startSender called with', files.length, 'files');
    // Guard: if already finalized or active as sender, just re-attach the handler.
    // This prevents restarting WiFi discovery mid-transfer (which crashes the connection).
    if (this.isActive && this.role === 'sender') {
      console.log('[V2 SERVICE] Sender already active, syncing status handler only.');
      WiFiDirectManager.onStatus = (s) => this.emit({ type: 'p2p', status: s });
      return;
    }
    if (this._isFinalized) {
      console.warn('[V2 SERVICE] startSender called but transfer already finalized! Ignoring to avoid crash.');
      return;
    }

    this.role = 'sender';
    this.isActive = true;
    WiFiDirectManager.onStatus = (s) => this.emit({ type: 'p2p', status: s });
    await WiFiDirectManager.startDiscovery(onDevicesFound);
  }


  async finalizeSender(detectedIp: string, files: any[]) {
    if (this._isFinalized) return;
    this._isFinalized = true;
    
    // 💡 ROBUSTNESS: Some Androids return the wrong LAN IP, and others use randomized 
    // P2P subnets instead of the default 192.168.49.x. We test the observed and the default.
    const candidateIps = [detectedIp];
    if (detectedIp !== '192.168.49.1') candidateIps.push('192.168.49.1');
    
    console.log(`[V2 SERVICE] finalizeSender. Candidates:`, candidateIps);

    // 🔗 Push metadata handshake to GO (Receiver)
    let handshakeSuccess = false;
    let actualReceiverIp = detectedIp;
    
    const bodyPayload = JSON.stringify(files.map(f => ({ name: f.name, size: f.size, uri: f.uri })));

    // Maximum 5 overall attempts
    for (let attempt = 0; attempt < 5; attempt++) {
        if (handshakeSuccess) break;
        
        for (const ip of candidateIps) {
            try {
                console.log(`[V2 HANDSHAKE] Attempt ${attempt+1}: POSTing to http://${ip}:${P2P_PORT}/api/v2/handshake`);
                const res = await fetch(`http://${ip}:${P2P_PORT}/api/v2/handshake`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: bodyPayload
                });
                
                if (res.ok) {
                    console.log(`[V2 HANDSHAKE] SUCCESS! Receiver acknowledged via IP: ${ip}`);
                    handshakeSuccess = true;
                    actualReceiverIp = ip;
                    break;
                } else {
                    console.warn(`[V2 HANDSHAKE] Error status from ${ip}:`, res.status);
                }
            } catch (e: any) {
                console.log(`[V2 HANDSHAKE] Attempt ${attempt+1} on ${ip} Fail: ${e.message}`);
            }
        }
        if (!handshakeSuccess) {
            await new Promise(r => setTimeout(r, 1500));
        }
    }
    
    if (!handshakeSuccess) {
        console.error('[V2 HANDSHAKE] FATAL: Receiver not reachable for metadata sync.');
        this.emit({ type: 'error', message: 'Failed to establish metadata handshake with Receiver. Check if both devices are on the same P2P group.' });
        return;
    }
    
    console.log('[V2 SERVICE] Handshake complete, preparing native transfer in 2s...');
    this.emit({ type: 'ready', ip: actualReceiverIp, role: 'sender' });
    await new Promise(r => setTimeout(r, 2000));
    this.startP2PSending(files, actualReceiverIp);
  }


  /**
   * Resolves a content:// or file:// URI to an absolute filesystem path.
   *
   * WHY THIS IS NEEDED:
   * The native sendFileTo() in react-native-wifi-p2p does:
   *   `Uri uri = Uri.fromFile(new File(filePath));`
   * `new File("content://...")` is INVALID on Android — the File constructor
   * does not understand content:// URIs → the app crashes immediately.
   *
   * ANDROID 10+ NOTE: `_data` column is deprecated, so PathResolver / stat()
   * may return null for MediaStore URIs. We use RNBlobUtil's wrap+readStream
   * to copy it to a real temp file as the most reliable fallback.
   */
  private async resolveRealPath(uri: string): Promise<string> {
    // Already a real filesystem path — strip file:// prefix if present
    if (!uri.startsWith('content://')) {
      return uri.startsWith('file://') ? uri.slice(7) : uri;
    }

    // First try: RNBlobUtil.fs.stat() — on Android <10, this gives the real _data path
    try {
      const statResult = await RNBlobUtil.fs.stat(uri);
      if (statResult && statResult.path && !statResult.path.startsWith('content://')) {
        console.log(`[V2 SERVICE] resolveRealPath (stat): ${statResult.path}`);
        return statResult.path;
      }
    } catch (_) {}

    // Second try (Android 10+): Copy via RNBlobUtil which internally uses ContentResolver
    try {
      const ext = uri.includes('video') ? '.mp4' : uri.includes('image') ? '.jpg' : uri.includes('audio') ? '.mp3' : '.bin';
      const tmpPath = `${RNBlobUtil.fs.dirs.CacheDir}/fd_tmp_${Date.now()}${ext}`;
      await RNBlobUtil.fs.cp(uri, tmpPath);
      console.log(`[V2 SERVICE] resolveRealPath (cp): ${tmpPath}`);
      return tmpPath;
    } catch (e1) {
      console.warn('[V2 SERVICE] cp failed, trying wrap+fetch:', e1);
    }

    // Final fallback: read stream and write manually
    try {
      const ext = uri.includes('video') ? '.mp4' : uri.includes('image') ? '.jpg' : '.bin';
      const tmpPath = `${RNBlobUtil.fs.dirs.CacheDir}/fd_tmp_${Date.now()}${ext}`;
      const data = await RNBlobUtil.fs.readStream(uri, 'base64');
      // This is async but we need the full read — collect chunks
      await new Promise<void>((resolve, reject) => {
        let chunks = '';
        data.open();
        data.onData((chunk: string | number[]) => { chunks += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('base64'); });
        data.onEnd(async () => {
          try {
            await RNBlobUtil.fs.writeFile(tmpPath, chunks, 'base64');
            resolve();
          } catch (e) { reject(e); }
        });
        data.onError(reject);
      });
      console.log(`[V2 SERVICE] resolveRealPath (stream): ${tmpPath}`);
      return tmpPath;
    } catch (e2) {
      console.error('[V2 SERVICE] All resolveRealPath strategies failed, using raw URI (crash likely):', e2);
      return uri;
    }
  }



  private async startP2PSending(files: any[], targetIp: string) {
    console.log('[V2 SERVICE] startP2PSending: Initiating native send loop');
    for (const file of files) {
      console.log(`[V2 SERVICE] --> NATIVE SEND: ${file.name} (uri: ${file.uri})`);
      this.emit({ type: 'progress', name: file.name, percent: 5, sent: 0, total: file.size });

      // ⚠️ CRITICAL: Resolve content:// URI → real /storage/... path.
      // The native Java sendFileTo() does `new File(filePath)` which crashes on content:// URIs.
      const realPath = await this.resolveRealPath(file.uri);
      console.log(`[V2 SERVICE] --> Sending real path: ${realPath}`);
      this.emit({ type: 'progress', name: file.name, percent: 10, sent: 0, total: file.size });

      const success = await WiFiDirectManager.sendFileP2P(realPath, targetIp);

      if (success) {
        console.log(`[V2 SERVICE] --> NATIVE SUCCESS: ${file.name}`);
        this.emit({ type: 'complete', name: file.name });
      } else {
        console.error(`[V2 SERVICE] --> NATIVE FAIL: ${file.name}`);
        this.emit({ type: 'error', message: `Failed to send ${file.name}` });
      }

      await new Promise(r => setTimeout(r, 1000));
    }
  }


  // ── RECEIVER (Group Owner) ────────────────────────────────────────────────
  async startReceiver(saveDir: string, files: any[] = []): Promise<string | null> {
    if (Platform.OS !== 'android') return null;
    console.log('[V2 SERVICE] startReceiver called, saveDir:', saveDir);

    if (this.isActive && this.role === 'receiver') {
      console.log('[V2 SERVICE] Receiver already active as GO');
      return '192.168.49.1';
    }

    this.role = 'receiver';
    this.isActive = true;
    this.currentSaveDir = saveDir;
    
    WiFiDirectManager.onStatus = (s) => this.emit({ type: 'p2p', status: s });
    
    console.log('[V2 SERVICE] Starting metadata server on port', P2P_PORT);
    TransferServer.start(P2P_PORT, [], (status: ServerStatus) => {
        console.log('[V2 SERVICE] Metadata Server Event:', status.type);
        if (status.type === 'client_connected' && status.message) {
            console.log('[V2 HANDSHAKE] Metadata Received from Client! Body length:', status.message.length);
            try {
                this.emit({ type: 'client_connected', deviceName: 'Sender V2' });
                const filesV2 = JSON.parse(status.message);
                if (Array.isArray(filesV2)) {
                    console.log('[V2 SERVICE] Files total:', filesV2.length);
                    this.finalizeReceiver(status.clientAddress || '192.168.49.X', this.currentSaveDir, filesV2);
                }
            } catch (e) {
                console.error('[V2 SERVICE] Failed to parse metadata JSON');
            }
        }
    });

    const ip = await WiFiDirectManager.startAsGroupOwner();
    if (!ip) {
      console.error('[V2 SERVICE] GO Setup Failed');
      this.isActive = false;
      return null;
    }

    this.emit({ type: 'ready', ip, role: 'receiver' });
    return ip;
  }

  async finalizeReceiver(clientIp: string, saveDir: string, files: any[] = []) {
    if (this._isFinalized) return;
    this._isFinalized = true;
    console.log('[V2 SERVICE] finalizeReceiver called. Client:', clientIp, 'Files:', files.length);

    this.emit({ type: 'ready', ip: clientIp, role: 'receiver' });
    
    if (files.length > 0) {
        console.log('[V2 SERVICE] Starting native receive loop');
        this.startP2PReceiving(files, saveDir);
    }
  }


  async connectToSpecificDevice(deviceAddress: string): Promise<string | null> {
    this.isActive = true;
    const ip = await WiFiDirectManager.connectToDevice(deviceAddress);
    return ip;
  }



  private async startP2PReceiving(files: any[], saveDir: string) {
    if (!(await RNBlobUtil.fs.exists(saveDir))) {
      await RNBlobUtil.fs.mkdir(saveDir).catch(() => { });
    }
    for (const file of files) {
      console.log(`[V2] Waiting for ${file.name} via Native P2P`);
      this.emit({ type: 'progress', name: file.name, percent: 0, sent: 0, total: file.size });
      
      const resultPath = await WiFiDirectManager.receiveFileP2P(saveDir, file.name);
      
      if (resultPath) {
        console.log(`[V2] Received ${file.name} at ${resultPath}`);
        this.emit({ type: 'complete', name: file.name });
      } else {
        this.emit({ type: 'error', message: `Failed to receive ${file.name}` });
      }
      
      await new Promise(r => setTimeout(r, 500));
    }
  }

  async stop() {
    this.isActive = false;
    this._isFinalized = false;
    this.role = null;
    TransferServer.stop();
    TransferClient.stop();
    await WiFiDirectManager.stop().catch(() => {});
  }

  private emit(status: DirectTransferStatusV2) {
    this.onStatus?.(status);
  }
}

export default new WiFiDirectTransferServiceV2();
