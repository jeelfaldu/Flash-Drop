import { PermissionsAndroid, Platform } from 'react-native';
import { check, request, requestMultiple, PERMISSIONS, RESULTS } from 'react-native-permissions';
import DeviceInfo from 'react-native-device-info';

export const requestConnectPermissions = async () => {
  if (Platform.OS === 'android') {
    const apiLevel = await DeviceInfo.getApiLevel();
    
    // Core permissions for P2P + Contacts restore
    const permissions: string[] = [];

    const fineLoc = PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
    if (fineLoc) permissions.push(fineLoc);

    const readContacts = PermissionsAndroid.PERMISSIONS.READ_CONTACTS;
    if (readContacts) permissions.push(readContacts);

    if (apiLevel >= 33) { // Android 13+
      const nearby = (PermissionsAndroid.PERMISSIONS as any).NEARBY_WIFI_DEVICES || 'android.permission.NEARBY_WIFI_DEVICES';
      permissions.push(nearby);
    } else {
      // Android 12 and below
      const readExt = PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE;
      const writeExt = PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE;
      if (readExt) permissions.push(readExt);
      if (writeExt) permissions.push(writeExt);
    }

    try {
      const finalPerms = Array.from(new Set(permissions.filter(p => typeof p === 'string' && p.length > 0)));
      if (finalPerms.length === 0) return true;

      const granted: any = await PermissionsAndroid.requestMultiple(finalPerms as any);

      const isFineLocationGranted = granted[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] === PermissionsAndroid.RESULTS.GRANTED;
      const isContactsGranted = granted[PermissionsAndroid.PERMISSIONS.READ_CONTACTS] === PermissionsAndroid.RESULTS.GRANTED;

      if (apiLevel >= 33) {
        // Check Nearby Devices
        const isNearbyGranted = granted[PermissionsAndroid.PERMISSIONS.NEARBY_WIFI_DEVICES] === PermissionsAndroid.RESULTS.GRANTED;
        return isFineLocationGranted && isNearbyGranted && isContactsGranted;
      } else {
        // For older androids, Location is the main gatekeeper for P2P
        return isFineLocationGranted && isContactsGranted;
      }
    } catch (e) {
      console.warn(e);
      return false;
    }
  } else if (Platform.OS === 'ios') {
    const results = await requestMultiple([
      PERMISSIONS.IOS.PHOTO_LIBRARY,
      PERMISSIONS.IOS.CONTACTS,
      PERMISSIONS.IOS.CAMERA,
      PERMISSIONS.IOS.LOCATION_WHEN_IN_USE,
      PERMISSIONS.IOS.MICROPHONE
    ]);

    return (
      results[PERMISSIONS.IOS.PHOTO_LIBRARY] === RESULTS.GRANTED &&
      results[PERMISSIONS.IOS.CONTACTS] === RESULTS.GRANTED &&
      results[PERMISSIONS.IOS.CAMERA] === RESULTS.GRANTED &&
      results[PERMISSIONS.IOS.LOCATION_WHEN_IN_USE] === RESULTS.GRANTED &&
      results[PERMISSIONS.IOS.MICROPHONE] === RESULTS.GRANTED
    );
  }
  return true;
};

export const requestStoragePermission = async () => {
    if (Platform.OS === 'android') {
        const apiLevel = await DeviceInfo.getApiLevel();
        if(apiLevel >= 33) {
          return true; 
        }
        const granted = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
    } else if (Platform.OS === 'ios') {
      const status = await request(PERMISSIONS.IOS.PHOTO_LIBRARY);
      return status === RESULTS.GRANTED;
    }
    return true;
}
