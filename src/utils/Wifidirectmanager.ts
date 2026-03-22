/**
 * WiFiDirectManager.ts
 *
 * Wi-Fi Direct ka kaam sirf ek hai:
 *   - Dono devices ko ek direct P2P link par connect karo
 *   - Group Owner ka IP nikalo
 *   - Baaki sab existing TransferServer + TransferClient handle karta hai
 *
 * Flow:
 *   Sender  → createGroup() → Group Owner banta hai → apna IP share karta hai QR/mDNS se
 *   Receiver → discoverPeers() → connect() → getConnectionInfo() → groupOwnerAddress milta hai
 *   Receiver → TransferClient.start(port, saveDir, groupOwnerAddress)
 *
 * Speed: 50-200 MB/s (router bypass, direct RF link)
 * iOS: Not supported — Wi-Fi Direct Android only hai
 */

import {
  initialize,
  startDiscoveringPeers,
  stopDiscoveringPeers,
  subscribeOnPeersUpdates,
  subscribeOnConnectionInfoUpdates,
  connect,
  cancelConnect,
  createGroup,
  removeGroup,
  getAvailablePeers,
  getConnectionInfo,
  getGroupInfo,
} from 'react-native-wifi-p2p';
import { PermissionsAndroid, Platform } from 'react-native';

export type WifiP2pDevice = {
  deviceAddress: string;
  deviceName: string;
  status: number;   // 0=CONNECTED, 1=INVITED, 2=FAILED, 3=AVAILABLE, 4=UNAVAILABLE
};

export type WifiP2pConnectionInfo = {
  groupOwnerAddress: string;
  groupFormed: boolean;
  isGroupOwner: boolean;
};

export type WifiP2pGroupInfo = {
  networkName: string;
  passphrase: string;
  interface: string;
  isGroupOwner: boolean;
  owners: WifiP2pDevice[];
};

export type P2PStatus =
  | { type: 'discovering'; message: string }
  | { type: 'peers_found'; devices: WifiP2pDevice[] }
  | { type: 'connecting'; message: string }
  | { type: 'connected'; ip: string; isGroupOwner: boolean }
  | { type: 'group_created'; ip: string }
  | { type: 'error'; message: string }
  | { type: 'disconnected' };

class WiFiDirectManager {
  private initialized = false;
  private peersSubscription: any = null;
  private connectionSubscription: any = null;
  private thisDeviceSubscription: any = null;
  public onStatus?: (status: P2PStatus) => void;

  // ── Initialize & Permissions ─────────────────────────────────────────────
  // ── Initialize & Permissions ─────────────────────────────────────────────
  async init(): Promise<boolean> {
    if (Platform.OS !== 'android') return false;
    if (this.initialized) return true;

    try {
      await initialize();
      console.log('[WiFiDirect] Initialized successfully');

      const apiLevel = typeof Platform.Version === 'number' ? Platform.Version : parseInt(Platform.Version, 10);
      const requested: string[] = [];

      const fineLoc = PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
      if (fineLoc) requested.push(fineLoc);

      const coarseLoc = PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION;
      if (coarseLoc) requested.push(coarseLoc);

      if (apiLevel >= 33) {
        // Nearby devices permission is critical for Android 13+
        const nearby = (PermissionsAndroid.PERMISSIONS as any).NEARBY_WIFI_DEVICES;
        if (nearby) {
          requested.push(nearby);
        } else {
          requested.push('android.permission.NEARBY_WIFI_DEVICES');
        }
      }

      const finalPerms = Array.from(new Set(requested.filter(p => typeof p === 'string' && p.length > 0)));

      if (finalPerms.length > 0) {
        console.log('[WiFiDirect] Requesting permissions:', finalPerms);
        const results: any = await PermissionsAndroid.requestMultiple(finalPerms as any);

        // Critical permissions check
        if (fineLoc && results[fineLoc as string] !== PermissionsAndroid.RESULTS.GRANTED) {
          console.warn('[WiFiDirect] Fine location permission not granted. P2P might fail.');
        }
      }

      this.initialized = true;
      return true;
    } catch (e: any) {
      if (e.message?.includes('initialized once')) {
        this.initialized = true;
        return true;
      }
      console.error('[WiFiDirect] init error:', e);
      this.emit({ type: 'error', message: `Initialization failed: ${e.message}. Tip: Ensure Location/GPS is ON.` });
      return false;
    }
  }


  // ── Sender side: Create P2P Group ────────────────────────────────────────
  // Sender becomes Group Owner (GO). GO always gets IP 192.168.49.1.
  // TransferServer listens on this IP at port 8888.
  async startAsGroupOwner(): Promise<string | null> {
    if (!(await this.init())) return null;

    try {
      this.emit({ type: 'discovering', message: 'Cleaning up Wi-Fi Direct...' });

      // Force cleanup
      try { await stopDiscoveringPeers(); } catch (_) { }
      try { await removeGroup(); } catch (_) { }
      await new Promise(r => setTimeout(r, 1000));

      this.emit({ type: 'discovering', message: 'Creating Wi-Fi Direct Group...' });
      await createGroup();
      console.log('[WiFiDirect] Group create command sent');

      // Poll for group info — Android sometimes takes a few seconds to stabilize
      for (let i = 0; i < 25; i++) {
        await new Promise(r => setTimeout(r, 1000));
        try {
          const info: any = await getGroupInfo();
          const conn: any = await getConnectionInfo();

          console.log(`[WiFiDirect] Poll ${i}: GroupFormed=${conn?.groupFormed}, isGO=${conn?.isGroupOwner}`);

          if (conn?.groupFormed && conn?.isGroupOwner) {
            const ownerIp = '192.168.49.1';

            // Log clients if available in group info
            if (info && info.clients) {
              console.log(`[WiFiDirect] Clients connected: ${info.clients.length}`);
            }

            // Start listening for client connections at P2P level
            if (!this.connectionSubscription) {
              this.connectionSubscription = subscribeOnConnectionInfoUpdates((newConn: any) => {
                console.log('[WiFiDirect] Connection update:', newConn);
                if (newConn?.groupFormed && newConn?.isGroupOwner) {
                  // Check if someone joined

                  getGroupInfo().then((info: any) => {
                    console.log('[WiFiDirect] Group info:', info);
                    if (info?.clients && info.clients.length > 0) {
                      console.log('[WiFiDirect] Client detected in group info');
                      this.emit({ type: 'connected', ip: '192.168.49.1', isGroupOwner: true });
                    }
                  }).catch((e) => {
                    console.log('[WiFiDirect] Failed to get group info', e);
                  });
                }
              });
            }

            this.emit({
              type: 'group_created',
              ip: ownerIp,
              ...(info ? { networkName: info.networkName, passphrase: info.passphrase } : {})
            } as any);
            return ownerIp;

          }
        } catch (e) {
          console.log('[WiFiDirect] Poll error:', e);
        }
      }

      this.emit({ type: 'error', message: 'Failed to establish Wi-Fi Direct Group. Please toggle Wi-Fi and try again.' });
      return null;
    } catch (e: any) {
      this.emit({ type: 'error', message: `Group creation failed: ${e.message}` });
      return null;
    }
  }

  // ── Receiver side: Discover → Connect → Get IP ───────────────────────────
  // Returns the Group Owner IP to connect TransferClient to.
  // ── Receiver side: Discovery ───────────────────────────────────────────
  async startDiscovery(onDevicesFound?: (devices: WifiP2pDevice[]) => void): Promise<boolean> {
    if (!(await this.init())) return false;

    try {
      // Cleanup previous discovery/groups
      try { await stopDiscoveringPeers(); } catch (_) { }
      try { await removeGroup(); } catch (_) { }

      // Subscribe to peer list updates
      this.peersSubscription?.remove?.();
      this.peersSubscription = subscribeOnPeersUpdates(({ devices }: { devices: WifiP2pDevice[] }) => {
        this.emit({ type: 'peers_found', devices });
        onDevicesFound?.(devices);
      });

      this.emit({ type: 'discovering', message: 'Scanning for devices...' });
      await startDiscoveringPeers();

      // Initial check
      try {
        const { devices } = await getAvailablePeers() as any;
        if (devices?.length > 0) {
          this.emit({ type: 'peers_found', devices });
          onDevicesFound?.(devices);
        }
      } catch (_) { }

      return true;
    } catch (e: any) {
      console.error('[WiFiDirect] Discovery start error:', e);
      this.emit({ type: 'error', message: `Discovery failed: ${e.message}` });
      return false;
    }
  }

  // ── Receiver side: Connect → Get IP ───────────────────────────
  // Returns the Group Owner IP to connect TransferClient to.
  async connectToSender(onDevicesFound?: (devices: WifiP2pDevice[]) => void, autoConnect = true): Promise<string | null> {
    if (!(await this.init())) return null;

    // Start discovery if not already running
    await this.startDiscovery(onDevicesFound);

    return new Promise(async (resolve) => {
      let resolved = false;
      const done = (ip: string | null) => {
        if (resolved) return;
        resolved = true;
        resolve(ip);
      };

      // Subscribe to connection info updates
      this.connectionSubscription?.remove?.();
      this.connectionSubscription = subscribeOnConnectionInfoUpdates((info: any) => {
        if (info.groupFormed) {
          const rawIp = info.groupOwnerAddress?.hostAddress || info.groupOwnerAddress;
          const ip = typeof rawIp === 'string' ? rawIp : rawIp?.hostAddress;

          if (ip && ip !== '0.0.0.0' && ip !== '127.0.0.1') {
            console.log(`[WiFiDirect] Connected via event! IP: ${ip}`);
            this.emit({ type: 'connected', ip: ip, isGroupOwner: info.isGroupOwner });
            done(ip);
          }
        }
      });


      if (autoConnect) {
        const checkAndAutoConnect = async () => {
          if (resolved) return;
          try {
            const { devices } = await getAvailablePeers() as any;
            const target = devices?.find((d: any) => d.status === 3); // 3 = AVAILABLE
            if (target && !resolved) {
              console.log(`[WiFiDirect] Auto-connecting to: ${target.deviceName}`);
              this.emit({ type: 'connecting', message: `Connecting to ${target.deviceName}...` });
              connect(target.deviceAddress).catch(() => { });
            }
          } catch (_) { }
        };

        const poll = setInterval(checkAndAutoConnect, 3000);
        setTimeout(() => clearInterval(poll), 30000);
      }

      // Timeout for the whole connection attempt
      setTimeout(() => {
        if (!resolved) {
          console.log('[WiFiDirect] Connection promise timed out');
          // We don't resolve null here because they might still find a device manually
        }
      }, 60000);
    });
  }


  // ── Manual connect to specific device ────────────────────────────────────
  async connectToDevice(deviceAddress: string): Promise<string | null> {
    if (!(await this.init())) return null;

    // Clean up any stale/ghost connections before starting a fresh one
    try {
      const currentInfo: any = await getConnectionInfo();
      if (currentInfo?.groupFormed) {
        console.log('[WiFiDirect] Found stale group, removing before connect...');
        await removeGroup();
        await new Promise(r => setTimeout(r, 1000));
      }
    } catch (_) { }

    return new Promise((resolve) => {
      let resolved = false;
      let poll: any = null;

      const done = (ip: string | null) => {
        if (!resolved) {
          resolved = true;
          if (poll) clearInterval(poll);
          resolve(ip);
        }
      };

      this.connectionSubscription?.remove?.();
      this.connectionSubscription = subscribeOnConnectionInfoUpdates((info: any) => {

        const rawIp = info.groupOwnerAddress?.hostAddress || info.groupOwnerAddress;
        const ip = typeof rawIp === 'string' ? rawIp : rawIp?.hostAddress;

        if (info.groupFormed && ip && ip !== '0.0.0.0') {
          console.log(`[WiFiDirect] Connected via event: ${ip}`);
          this.emit({ type: 'connected', ip: ip, isGroupOwner: info.isGroupOwner });
          done(ip);
        }
      });

      // Poll as backup (some devices don't emit the event reliably)
      poll = setInterval(async () => {
        try {
          const info: any = await getConnectionInfo();
          if (info?.groupFormed) {
            const rawIp = info.groupOwnerAddress?.hostAddress || info.groupOwnerAddress;
            const ip = typeof rawIp === 'string' ? rawIp : rawIp?.hostAddress;

            if (ip && ip !== '0.0.0.0') {
              console.log(`[WiFiDirect] Connected via poll: ${ip}`);
              this.emit({ type: 'connected', ip: ip, isGroupOwner: info.isGroupOwner });
              done(ip);
            }
          }
        } catch (_) { }
      }, 3000);

      console.log(`[WiFiDirect] Connecting to ${deviceAddress}...`);
      connect(deviceAddress)
        .then(() => {
          console.log('[WiFiDirect] connect() command sent');
        })
        .catch((e: any) => {
          console.error('[WiFiDirect] connect error:', e.message);
          this.emit({ type: 'error', message: e.message });
          done(null);
        });

      setTimeout(() => {
        if (!resolved) {
          console.warn('[WiFiDirect] Connection timed out');
          this.emit({ type: 'error', message: 'Connection timed out' });
          done(null);
        }
      }, 30000);
    });
  }


  // ── Get current connection info ───────────────────────────────────────────
  async getConnectedIp(): Promise<string | null> {
    try {
      const info: WifiP2pConnectionInfo = await getConnectionInfo() as any;
      if (info.groupFormed && info.groupOwnerAddress) return info.groupOwnerAddress;
    } catch (_) { }
    return null;
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  async stop() {
    if (!this.initialized) return;
    try { await stopDiscoveringPeers(); } catch (_) { }
    try { await cancelConnect(); } catch (_) { }
    try { await removeGroup(); } catch (_) { }
    this.peersSubscription?.remove?.();
    this.connectionSubscription?.remove?.();
    this.thisDeviceSubscription?.remove?.();
    this.peersSubscription = null;
    this.connectionSubscription = null;
    this.thisDeviceSubscription = null;
    this.initialized = false;
    console.log('[WiFiDirect] Stopped');
  }

  async stopDiscovery() {
    if (!this.initialized) return;
    try { await stopDiscoveringPeers(); } catch (_) { }
    this.peersSubscription?.remove?.();
    this.peersSubscription = null;
  }

  async getGroupClients(): Promise<WifiP2pDevice[]> {
    if (Platform.OS !== 'android') return [];
    try {
      const info: any = await getGroupInfo();
      return info?.clients || [];
    } catch (e) {
      console.log('[WiFiDirect] Error getting group clients:', e);
      return [];
    }
  }

  private emit(status: P2PStatus) {
    this.onStatus?.(status);
    console.log('[WiFiDirect] Status:', status.type, (status as any).message ?? (status as any).ip ?? (status as any).devices?.length ?? '');
  }
}

export default new WiFiDirectManager();