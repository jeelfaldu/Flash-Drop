/**
 * WiFiDirectTransferService.ts
 *
 * Yeh file existing TransferServer + TransferClient ko
 * Wi-Fi Direct connection ke saath bridge karti hai.
 *
 * Kuch important points:
 * - TransferServer/Client ka code bilkul nahi badla
 * - Sirf IP source badla: Wi-Fi IP → Wi-Fi Direct IP (192.168.49.x)
 * - Group Owner (sender) hamesha 192.168.49.1 hota hai Android par
 * - Receiver ko groupOwnerAddress milta hai getConnectionInfo() se
 *
 * Usage:
 *   Sender:   WiFiDirectTransferService.startSender(files, onStatus)
 *   Receiver: WiFiDirectTransferService.startReceiver(saveDir, onStatus)
 *   Stop:     WiFiDirectTransferService.stop()
 */

import { Platform } from 'react-native';
import RNBlobUtil from 'react-native-blob-util';
import WiFiDirectManager, { P2PStatus, WifiP2pDevice } from './Wifidirectmanager';
import TransferServer from './TransferServer';
import TransferClient from './TransferClient';
import type { ServerStatus } from './TransferServer';
import type { TransferStatus } from './TransferClient';

const P2P_PORT = 8888;

export type DirectTransferStatus =
  | { type: 'p2p'; status: P2PStatus }
  | { type: 'server'; status: ServerStatus }
  | { type: 'client'; status: TransferStatus }
  | { type: 'ready'; ip: string; role: 'sender' | 'receiver' }
  | { type: 'error'; message: string };

class WiFiDirectTransferService {
  private role: 'sender' | 'receiver' | null = null;
  private isActive = false;
  private _isFinalized = false;
  public onStatus?: (status: DirectTransferStatus) => void;


  public isRunning(): boolean {
    return this.isActive;
  }

  public getRole(): 'sender' | 'receiver' | null {
    return this.role;
  }

  // ── SENDER ────────────────────────────────────────────────────────────────
  // 1. Create Wi-Fi Direct group (becomes Group Owner at 192.168.49.1)
  // 2. Start TransferServer on that IP
  async startSender(files: any[], secretKey?: string): Promise<string | null> {
    if (Platform.OS !== 'android') {
      this.emit({ type: 'error', message: 'Wi-Fi Direct is Android only' });
      return null;
    }

    if (this.isActive && this.role === 'sender') {
      console.log('[DirectTransfer] Sender already active, updating files...');
      TransferServer.updateFiles(files);
      const ip = '192.168.49.1'; // Standard Android P2P IP
      // Re-wire status in case onStatus was re-assigned
      TransferServer.statusCallback = (status) => this.emit({ type: 'server', status });
      // Small delay to ensure caller has set up onStatus listener
      setTimeout(() => this.emit({ type: 'ready', ip, role: 'sender' }), 100);
      return ip;
    }

    this.role = 'sender';
    this.isActive = true;

    // Wire up Wi-Fi Direct status
    WiFiDirectManager.onStatus = (s) => this.emit({ type: 'p2p', status: s });

    // Create P2P group — this phone becomes the Group Owner
    const ip = await WiFiDirectManager.startAsGroupOwner();
    if (!ip) {
      this.isActive = false;
      return null;
    }

    // Start or update TransferServer
    TransferServer.start(P2P_PORT, files, (status) => {
      this.emit({ type: 'server', status });
    }, secretKey);

    // [Improved] Poll for group clients to ensure sender knows when someone joins
    // This handles cases where the OS blocks the initial TCP handshake
    const clientCheckInterval = setInterval(async () => {
      if (!this.isActive || this.role !== 'sender') {
        clearInterval(clientCheckInterval);
        return;
      }
      const clients = await WiFiDirectManager.getGroupClients();
      if (clients && clients.length > 0) {
        console.log(`[DirectTransfer] Polling found ${clients.length} clients`);
        // We don't emit 'connected' here anymore, let TransferServer handle 'client_connected'
        // But we can emit a P2P signal if needed
        this.emit({ type: 'p2p', status: { type: 'connected', ip: '192.168.49.1', isGroupOwner: true } });
        clearInterval(clientCheckInterval);
      }
    }, 2000);

    this.emit({ type: 'ready', ip, role: 'sender' });
    console.log(`[DirectTransfer] Sender ready at ${ip}:${P2P_PORT}`);
    return ip;
  }

  // ── RECEIVER ──────────────────────────────────────────────────────────────
  // 1. Discover sender's P2P group
  // 2. Connect to it
  // 3. Get Group Owner IP (192.168.49.1)
  // 4. Start TransferClient pointing to that IP
  async startReceiver(
    saveDir: string,
    onDevicesFound?: (devices: WifiP2pDevice[]) => void,
    secretKey?: string,
  ): Promise<string | null> {
    if (Platform.OS !== 'android') {
      this.emit({ type: 'error', message: 'Wi-Fi Direct is Android only' });
      return null;
    }

    // If we were already in receiver role, just ensure discovery is on
    // UNLESS we are already connected to a server
    this.role = 'receiver';
    this.isActive = true;

    // Ensure save directory exists
    if (!(await RNBlobUtil.fs.exists(saveDir))) {
      await RNBlobUtil.fs.mkdir(saveDir).catch(() => { });
    }

    // Wire up Wi-Fi Direct status
    WiFiDirectManager.onStatus = (s) => this.emit({ type: 'p2p', status: s });

    // Just start discovery. We don't auto-connect here to prevent 
    // interfering with QR scanning or intentional selection.
    await WiFiDirectManager.startDiscovery(onDevicesFound);

    return null; // Won't return IP until connected
  }

  // Use this to finish the receiver setup once a connection is MADE at P2P level
  async finalizeReceiver(senderIp: string, saveDir: string, secretKey?: string) {
    if (this._isFinalized) return;
    this._isFinalized = true;

    this.role = 'receiver';
    this.isActive = true;
    
    TransferClient.onStatus = (status) => this.emit({ type: 'client', status });
    TransferClient.start(P2P_PORT, saveDir, senderIp, secretKey);
    
    this.emit({ type: 'ready', ip: senderIp, role: 'receiver' });
    console.log(`[DirectTransfer] Receiver finalized at ${senderIp}:${P2P_PORT}`);
  }



  // ── Manual device selection ───────────────────────────────────────────────
  // Use this if you want to show a device picker UI instead of auto-connect
  async connectToSpecificDevice(deviceAddress: string, saveDir: string, secretKey?: string): Promise<string | null> {
    this.role = 'receiver';
    this.isActive = true;

    const ip = await WiFiDirectManager.connectToDevice(deviceAddress);
    if (!ip) {
      this.isActive = false;
      return null;
    }

    if (!(await RNBlobUtil.fs.exists(saveDir))) {
      await RNBlobUtil.fs.mkdir(saveDir).catch(() => { });
    }

    // Finalize receiver if not already done by the P2P event listener
    if (!this._isFinalized) {
      await this.finalizeReceiver(ip, saveDir, secretKey);
    }
    return ip;
  }

  // ── Add files to sender ───────────────────────────────────────────────────
  addFiles(files: any[]) {
    TransferServer.updateFiles(files);
  }

  // ── Stop everything ───────────────────────────────────────────────────────
  async stop() {
    this.isActive = false;
    this._isFinalized = false;
    this.role = null;
    TransferClient.stop();
    TransferServer.stop();
    await WiFiDirectManager.stop().catch(() => {});
    console.log('[DirectTransfer] Stopped');
  }

  private emit(status: DirectTransferStatus) {
    this.onStatus?.(status);
  }
}

export default new WiFiDirectTransferService();