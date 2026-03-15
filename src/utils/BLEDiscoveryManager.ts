import { Platform, PermissionsAndroid } from 'react-native';
import BleManager from 'react-native-ble-manager';
import { Buffer } from 'buffer';

const SERVICE_UUID = 'F00D'; // FlashDrop Discovery service

export class BLEDiscoveryManager {
  private isScanning = false;

  async init() {
    await BleManager.start({ showAlert: false });
    if (Platform.OS === 'android') {
      await this.requestPermissions();
    }
  }

  async requestPermissions() {
    if (Platform.OS === 'android' && Platform.Version >= 23) {
      await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]);
    }
  }

  async startAdvertising(deviceName: string) {
    try {
      // Note: react-native-ble-manager doesn't support advertising directly on some versions
      // We might need react-native-ble-peripheral for true advertising.
      // However, some apps use the "Name" of the device to broadcast data.
      console.log(`[BLE] Starting discovery for ${deviceName}...`);
    } catch (e) {
      console.error('[BLE] Advertising failed', e);
    }
  }

  async startScanning(callback: (device: any) => void) {
    if (this.isScanning) return;
    this.isScanning = true;
    
    BleManager.scan([], 5).then(() => {
      console.log('[BLE] Scan started');
    });

    // We'll need to listen to BleManagerDiscoverPeripheral event
  }

  stopScanning() {
    BleManager.stopScan();
    this.isScanning = false;
  }
}

export default new BLEDiscoveryManager();
