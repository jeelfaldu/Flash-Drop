/**
 * HapticUtil — Cross-platform haptic feedback using built-in Vibration API.
 * No extra package needed. Android uses vibration patterns; iOS uses system
 * haptics via Vibration (limited but functional without a native module).
 */
import { Vibration, Platform } from 'react-native';

const HapticUtil = {
  /** Light tap — button presses, selections */
  light() {
    if (Platform.OS === 'android') {
      Vibration.vibrate(30);
    } else {
      Vibration.vibrate(10);
    }
  },

  /** Medium — connection established, navigation */
  medium() {
    if (Platform.OS === 'android') {
      Vibration.vibrate(60);
    } else {
      Vibration.vibrate(20);
    }
  },

  /** Success pattern — double tap: file complete, transfer done */
  success() {
    if (Platform.OS === 'android') {
      Vibration.vibrate([0, 50, 60, 80]);
    } else {
      Vibration.vibrate([0, 30, 40, 50]);
    }
  },

  /** Error pattern — long buzz: connection fail, transfer error */
  error() {
    if (Platform.OS === 'android') {
      Vibration.vibrate([0, 80, 50, 80]);
    } else {
      Vibration.vibrate([0, 60, 40, 60]);
    }
  },

  /** Celebration — triple burst: all files done! */
  celebrate() {
    if (Platform.OS === 'android') {
      Vibration.vibrate([0, 60, 40, 60, 40, 120]);
    } else {
      Vibration.vibrate([0, 40, 30, 40, 30, 80]);
    }
  },
};

export default HapticUtil;
