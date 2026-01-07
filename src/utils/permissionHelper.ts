import { PermissionsAndroid, Platform } from 'react-native';
import { check, request, PERMISSIONS, RESULTS } from 'react-native-permissions';
import DeviceInfo from 'react-native-device-info';

export const requestConnectPermissions = async () => {
  if (Platform.OS === 'android') {
    const apiLevel = await DeviceInfo.getApiLevel();
    
    const permissions = [
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      PermissionsAndroid.PERMISSIONS.READ_CONTACTS,
    ];

    if (apiLevel >= 33) { // Android 13+
      permissions.push(
        PermissionsAndroid.PERMISSIONS.NEARBY_WIFI_DEVICES,
        PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES,
        PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO,
        PermissionsAndroid.PERMISSIONS.READ_MEDIA_AUDIO
      );
    } else {
      // Android 12 and below
      permissions.push(PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE);
      permissions.push(PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE);
    }

    const granted = await PermissionsAndroid.requestMultiple(permissions);

    const isFineLocationGranted = granted[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] === PermissionsAndroid.RESULTS.GRANTED;
    const isContactsGranted = granted[PermissionsAndroid.PERMISSIONS.READ_CONTACTS] === PermissionsAndroid.RESULTS.GRANTED;
    
    if (apiLevel >= 33) {
        return (
            isFineLocationGranted &&
            isContactsGranted &&
            granted[PermissionsAndroid.PERMISSIONS.NEARBY_WIFI_DEVICES] === PermissionsAndroid.RESULTS.GRANTED
        );
    } else {
        return (
            isFineLocationGranted &&
            isContactsGranted &&
            granted[PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE] === PermissionsAndroid.RESULTS.GRANTED
        );
    }
  }
  return true;
};

export const requestStoragePermission = async () => {
    if (Platform.OS === 'android') {
        const apiLevel = await DeviceInfo.getApiLevel();
        if(apiLevel >= 33) {
             return true; // Use READ_MEDIA_* above
        }
        const granted = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
    }
    return true;
}
