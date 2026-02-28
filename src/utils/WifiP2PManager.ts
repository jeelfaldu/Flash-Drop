import { Platform } from 'react-native';
import WifiManager from 'react-native-wifi-reborn';
import { requestConnectPermissions } from './permissionHelper';

let wifiP2p: any = null;
if (Platform.OS === 'android') {
  wifiP2p = require('react-native-wifi-p2p');
}

export interface GroupInfo {
  ssid: string;
  pass: string;
  groupFormed: boolean;
  ownerIp: string;
  mac?: string;
}

class WifiP2PManager {
    isInitialized = false;

    async init() {
      if (Platform.OS !== 'android') return;
        if (this.isInitialized) return;
        try {
          await wifiP2p.initialize();
            this.isInitialized = true;
          console.log("[WifiP2P] Initialized");
        } catch (e: any) {
          if (e?.message?.includes("initialized once")) {
                this.isInitialized = true;
            } else {
            console.error("[WifiP2P] Init failed", e);
            // Throw error for proper propagation
            throw e;
            }
        }
    }

  async createGroup(): Promise<void> {
    if (Platform.OS !== 'android') {
      throw new Error("P2P is only supported on Android");
    }
        await this.init();
        const hasPerm = await requestConnectPermissions();
    if (!hasPerm) throw new Error("Permission denied for P2P connection");

    // SMART: Check if group is already formed and we are the owner
    try {
      const conn = await wifiP2p.getConnectionInfo();
      if (conn?.groupFormed && conn?.isGroupOwner) {
        console.log("[WifiP2P] Group already formed and we are owner.");
        return;
      }
    } catch (e) {
      console.log("[WifiP2P] Failed to get connection info before creating group");
    }

    try {
      await wifiP2p.stopDiscoveringPeers();
    } catch (e) { }

    // SMART: Remove ONLY if there's a stale group
    try {
      const conn = await wifiP2p.getConnectionInfo();
      if (conn?.groupFormed) {
        console.log("[WifiP2P] Removing existing stale group");
        await wifiP2p.removeGroup();
        await new Promise(r => setTimeout(r, 1000)); // allow OS to cleanup
      }
    } catch (e) {
      // Ignore safely
    }

    console.log("[WifiP2P] Calling native createGroup...");
      return wifiP2p.createGroup();
    }

    async removeGroup() {
      if (Platform.OS !== 'android') return;
      try {
        await wifiP2p.stopDiscoveringPeers();
      } catch (e) { }
      try {
          await wifiP2p.removeGroup();
        console.log("[WifiP2P] Group removed successfully");
      } catch (e: any) {
        console.log("[WifiP2P] Remove group info:", e?.message);
        }
    }

  async getGroupInfoWithRetry(timeoutMs = 15000): Promise<GroupInfo | null> {
    if (Platform.OS !== 'android') return null;
    await this.init();

    return new Promise(async (resolve, reject) => {
      let timeoutId = setTimeout(() => {
        unsub();
        reject(new Error("Timeout getting group info. Please try again."));
      }, timeoutMs);

      let isResolved = false;
      let isChecking = false;
      let subscription: any = null;

      const check = async () => {
        if (isResolved || isChecking) return isResolved;
        isChecking = true;
        try {
          const connInfo = await wifiP2p.getConnectionInfo();
          if (connInfo?.groupFormed) {
            const group: any = await wifiP2p.getGroupInfo();
            const ssid = group?.networkName || group?.ssid;
            const pass = group?.passphrase || group?.password;
            const mac = group?.owner?.deviceAddress;

            if (ssid && pass) {
              let ownerIp = connInfo.groupOwnerAddress?.hostAddress || connInfo.groupOwnerAddress;

              if (!ownerIp || ownerIp === '127.0.0.1' || typeof ownerIp !== 'string') {
                ownerIp = connInfo.isGroupOwner ? '192.168.49.1' : '192.168.49.1';
              }
              if (!isResolved) {
                isResolved = true;
                resolve({ ssid, pass, mac, groupFormed: true, ownerIp });
              }
              return true;
            }
          }
        } catch (e) {
          // Soft fail, will be retried
        } finally {
          isChecking = false;
        }
        return false;
      };

      const unsub = () => {
        clearTimeout(timeoutId);
        if (subscription) {
          try { subscription.remove(); } catch (e) { }
        }
      };

      // Initial check in case it's already ready
      if (await check()) {
        unsub();
        return;
      }

      // Proper Android Event Listener
      try {
        subscription = wifiP2p.subscribeOnConnectionInfoUpdates(async () => {
          if (await check()) unsub();
        });
      } catch (e) {
        console.error("[WifiP2P] Event listener failed, using polling fallback");
        let interval = setInterval(async () => {
          if (isResolved) clearInterval(interval);
          else if (await check()) {
            clearInterval(interval);
            unsub();
                    }
        }, 1500);
      }
    });
    }

    async disconnectFromWifi() {
      if (Platform.OS !== 'android') return;
        try {
            await WifiManager.disconnect();
          console.log("[WifiP2P] Disconnected from fallback Wi-Fi");
        } catch (e: any) {
          console.log("[WifiP2P] Wifi Disconnect error:", e?.message);
        }
    }

  async connectToSSID(ssid: string, password?: string): Promise<boolean> {
    if (Platform.OS !== 'android') return false;
        const hasPerm = await requestConnectPermissions(); 
    if (!hasPerm) throw new Error("Permission denied for Wi-Fi");

    await this.disconnectFromWifi();

    console.log(`[WifiP2P] Connecting to fallback SSID: ${ssid}`);
      try {
        if (password && password.length > 0) {
          await WifiManager.connectToProtectedSSID(ssid, password, false, false);
        } else {
          // @ts-ignore
          if (WifiManager.connectToSSID) {
            await WifiManager.connectToSSID(ssid);
          } else {
            await WifiManager.connectToProtectedSSID(ssid, "", false, false);
          }
        }
    } catch (e: any) {
      console.warn(`[WifiP2P] WIFI Connect threw an error (checking status anyway): ${e?.message}`);
    }

    // SMART: Verify connection via polling, no false successes
    for (let i = 0; i < 7; i++) {
      await new Promise(r => setTimeout(r, 1000));
      try {
        const currentSSID = await WifiManager.getCurrentWifiSSID();
        if (currentSSID === ssid || currentSSID === `"${ssid}"`) {
          console.log(`[WifiP2P] Fallback Wi-Fi successfully connected to ${ssid}`);
          try { await WifiManager.forceWifiUsage(true); } catch (e) { }
          return true;
        }
      } catch (e) { }
    }

    throw new Error(`Failed to connect to Wi-Fi Network: ${ssid}`);
  }

  async connectToMAC(mac: string, timeoutMs = 20000): Promise<boolean> {
    if (Platform.OS !== 'android') return false;
    await this.init();
    const hasPerm = await requestConnectPermissions();
    if (!hasPerm) throw new Error("Permission denied for P2P connection");

    console.log(`[WifiP2P] Connecting to P2P peer MAC: ${mac}`);

    // Android requires discovering peers sometimes before connecting directly to a MAC
    try {
      await wifiP2p.startDiscoveringPeers();
    } catch (e: any) {
      console.log("[WifiP2P] Start discovering error (ignoring):", e?.message);
    }

    return new Promise(async (resolve, reject) => {
      let timeoutId = setTimeout(() => {
        unsub();
        reject(new Error(`P2P Connection to peer timed out.`));
      }, timeoutMs);

      let isResolved = false;
      let isChecking = false;
      let subscription: any = null;

      const check = async () => {
        if (isResolved || isChecking) return isResolved;
        isChecking = true;
        try {
          const conn = await wifiP2p.getConnectionInfo();
          if (conn?.groupFormed) {
            if (!isResolved) {
              isResolved = true;
              console.log(`[WifiP2P] Connected via P2P natively!`);
              resolve(true);
            }
            return true;
          }
        } catch (e) { } finally {
          isChecking = false;
        }
        return false;
      };

      const unsub = () => {
        clearTimeout(timeoutId);
        if (subscription) {
          try { subscription.remove(); } catch (e) { }
        }
        try { wifiP2p.stopDiscoveringPeers(); } catch (e) { }
      };

      // Proper Android Event Listener
      try {
        subscription = wifiP2p.subscribeOnConnectionInfoUpdates(async () => {
          if (await check()) unsub();
        });
      } catch (e) {
        console.error("[WifiP2P] Failed to subscribe to connection updates", e);
      }

      // Trigger actual native connection
      try {
        await wifiP2p.connectWithConfig({ deviceAddress: mac, groupOwnerIntent: 0 });
        console.log(`[WifiP2P] Connection config applied, waiting for EVENT...`);
      } catch (e: any) {
        console.error("[WifiP2P] P2P Connect trigger failed:", e);
        // Don't reject immediately here if it's "internal error", let the listener retry
        if (e && e.message && e.message.includes('internal error')) {
          console.log("[WifiP2P] Handled internal error internally. Continuing wait for event...");
        } else {
          if (!isResolved) {
            isResolved = true;
            unsub();
            reject(e);
          }
        }
      }
    });
  }

  async getConnectionInfo() {
    if (Platform.OS !== 'android') return null;
    await this.init();
    return wifiP2p.getConnectionInfo();
    }
}

export default new WifiP2PManager();
