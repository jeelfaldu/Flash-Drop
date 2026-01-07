import { PermissionsAndroid, Platform } from 'react-native';
import { initialize, startDiscoveringPeers, stopDiscoveringPeers, subscribeOnPeersUpdates, subscribeOnConnectionInfoUpdates, createGroup, removeGroup, connect, getAvailablePeers, getConnectionInfo, getGroupInfo } from 'react-native-wifi-p2p';
import WifiManager from 'react-native-wifi-reborn';
import DeviceInfo from 'react-native-device-info';
import { requestConnectPermissions } from './permissionHelper';

class WifiP2PManager {
    isInitialized = false;

    async init() {
        if (this.isInitialized) return;
        try {
            await initialize();
            this.isInitialized = true;
            console.log("P2P Initialized");
        } catch (e: any) {
             if (e && e.message && e.message.includes("initialized once")) {
                this.isInitialized = true;
            } else {
                console.error("P2P Init failed", e);
            }
        }
    }

    async createGroup() {
        await this.init();
        const hasPerm = await requestConnectPermissions();
        if (!hasPerm) throw new Error("Permission denied");
        
        // 1. Cleanup existing group with extra delay
        try { 
            await removeGroup(); 
            await new Promise(r => setTimeout(r, 2000));
        } catch(e) {}
        
        // 2. Create new group
        console.log("Calling native createGroup...");
        return createGroup();
    }

    async removeGroup() {
        try {
            await removeGroup();
            await new Promise(r => setTimeout(r, 1000));
        } catch(e) {
            console.log("Remove group error:", e);
        }
    }

    // New helper to wait for valid group info
  async getGroupInfoWithRetry(maxAttempts = 15) {
        for(let i=0; i<maxAttempts; i++) {
            try {
                const connInfo = await getConnectionInfo();
                console.log(`P2P Status [${i}]:`, JSON.stringify(connInfo));
                
                if (connInfo && connInfo.groupFormed) {
                    try {
                        const groupDetailed = await getGroupInfo();
                        console.log("Detailed Group Info:", JSON.stringify(groupDetailed));
                        
                        // Some versions return 'networkName', others 'ssid'
                      const group: any = groupDetailed;
                      const ssid = group.networkName || group.ssid;
                      const pass = group.passphrase || group.password;
                        
                        if (ssid && pass) {
                          let ownerIp = connInfo.groupOwnerAddress?.hostAddress || connInfo.groupOwnerAddress || '192.168.49.1';

                          // If we are the group owner and can't find hostAddress, try our own IP
                          if (connInfo.isGroupOwner && (!ownerIp || ownerIp === '127.0.0.1' || typeof ownerIp !== 'string')) {
                            try {
                              const myIp = await DeviceInfo.getIpAddress();
                              if (myIp && myIp !== '0.0.0.0' && myIp !== '127.0.0.1') {
                                ownerIp = myIp;
                              }
                            } catch (e) { }
                          }

                            return { 
                                ssid, 
                                pass, 
                                groupFormed: true,
                              ownerIp: typeof ownerIp === 'string' ? ownerIp : '192.168.49.1'
                            };
                        }
                    } catch(innerErr) {
                        console.log("getGroupInfo not yet ready...");
                    }
                }
            } catch(e) {}
          await new Promise(r => setTimeout(r, 1000)); // Reduced from 2000
        }
        return null;
    }

    async disconnectFromWifi() {
        try {
            await WifiManager.disconnect();
        } catch(e) {
            console.log("Wifi Disconnect error:", e);
        }
    }

    async connectToSSID(ssid: string, password?: string) {
        // Connect to Legacy WiFi (Hotspot)
        const hasPerm = await requestConnectPermissions(); 
        if(!hasPerm) throw new Error("Permission denied");

        await this.disconnectFromWifi();
        await new Promise(r => setTimeout(r, 1500)); 

        console.log(`Connecting to SSID: ${ssid}`);

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
      } catch (e) {
        console.warn("WIFI Connect attempt failed, but might be connected anyway.");
        }

        if (Platform.OS === 'android') {
          // Force Wi-Fi usage with multiple tries
          for (let i = 0; i < 3; i++) {
            try {
                 await new Promise(r => setTimeout(r, 1000));
                 await WifiManager.forceWifiUsage(true);
            } catch (e) { }
          }
        }
    }

  async getConnectionInfo() {
    await this.init();
    return getConnectionInfo();
  }
}

export default new WifiP2PManager();
