import { PermissionsAndroid, Platform } from 'react-native';
import { check, request, requestMultiple, PERMISSIONS, RESULTS } from 'react-native-permissions';
import DeviceInfo from 'react-native-device-info';

export const requestConnectPermissions = async () => {
  if (Platform.OS === 'android') {
    const apiLevel = await DeviceInfo.getApiLevel();
    
    // Core permissions for P2P + Contacts restore
    const permissions = [
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      PermissionsAndroid.PERMISSIONS.READ_CONTACTS,
    ];

    if (apiLevel >= 33) { // Android 13+
      permissions.push(
        PermissionsAndroid.PERMISSIONS.NEARBY_WIFI_DEVICES,
      );
    } else {
      // Android 12 and below
      permissions.push(PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE);
      permissions.push(PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE);
    }

    try {
      const granted = await PermissionsAndroid.requestMultiple(permissions);

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
      PERMISSIONS.IOS.LOCATION_WHEN_IN_USE
    ]);

    return (
      results[PERMISSIONS.IOS.PHOTO_LIBRARY] === RESULTS.GRANTED &&
      results[PERMISSIONS.IOS.CONTACTS] === RESULTS.GRANTED &&
      results[PERMISSIONS.IOS.CAMERA] === RESULTS.GRANTED &&
      results[PERMISSIONS.IOS.LOCATION_WHEN_IN_USE] === RESULTS.GRANTED
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
