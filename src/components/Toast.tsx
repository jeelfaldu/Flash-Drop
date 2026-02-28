/**
 * Toast — Global slide-in toast notification system.
 *
 * Usage:
 *   // In App.tsx: <ToastProvider> wraps everything, <ToastContainer> at root
 *   // Anywhere:   Toast.show({ message: 'Done!', type: 'success' })
 */
import React, {
  createContext,
  useContext,
  useRef,
  useState,
  useCallback,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  Platform,
  Dimensions,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastOptions {
  message: string;
  type?: ToastType;
  duration?: number; // ms, default 3000
  subtitle?: string;
}

interface ToastContextValue {
  show: (opts: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue>({ show: () => {} });

const { width } = Dimensions.get('window');

const TOAST_COLORS: Record<ToastType, { bg: string; icon: string; iconName: string }> = {
  success: { bg: '#00B894', icon: '#FFF', iconName: 'check-circle' },
  error:   { bg: '#FF4757', icon: '#FFF', iconName: 'close-circle' },
  warning: { bg: '#FFA502', icon: '#FFF', iconName: 'alert-circle' },
  info:    { bg: '#6200EA', icon: '#FFF', iconName: 'information' },
};

interface ToastItem extends ToastOptions {
  id: number;
}

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counterRef = useRef(0);

  const show = useCallback((opts: ToastOptions) => {
    const id = ++counterRef.current;
    setToasts(prev => [...prev, { ...opts, id }]);

    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, opts.duration ?? 3000);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {/* Overlay: renders on top of everything */}
      <View style={styles.container} pointerEvents="box-none">
        {toasts.map(toast => (
          <ToastBanner
            key={toast.id}
            toast={toast}
            onDismiss={() => setToasts(prev => prev.filter(t => t.id !== toast.id))}
          />
        ))}
      </View>
    </ToastContext.Provider>
  );
};

const ToastBanner: React.FC<{ toast: ToastItem; onDismiss: () => void }> = ({ toast, onDismiss }) => {
  const slideY = useRef(new Animated.Value(-120)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    // Slide in
    Animated.parallel([
      Animated.spring(slideY, { toValue: 0, tension: 70, friction: 10, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();

    // Slide out near end of duration
    const hideDelay = (toast.duration ?? 3000) - 400;
    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(slideY, { toValue: -120, duration: 350, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 350, useNativeDriver: true }),
      ]).start();
    }, hideDelay);

    return () => clearTimeout(timer);
  }, []);

  const config = TOAST_COLORS[toast.type ?? 'info'];

  return (
    <Animated.View
      style={[
        styles.toast,
        { backgroundColor: config.bg, transform: [{ translateY: slideY }], opacity },
      ]}
    >
      <Icon name={config.iconName} size={22} color={config.icon} style={{ marginRight: 10 }} />
      <View style={{ flex: 1 }}>
        <Text style={styles.message} numberOfLines={2}>{toast.message}</Text>
        {toast.subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>{toast.subtitle}</Text>
        ) : null}
      </View>
      <TouchableOpacity onPress={onDismiss} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Icon name="close" size={18} color="rgba(255,255,255,0.8)" />
      </TouchableOpacity>
    </Animated.View>
  );
};

export const useToast = () => useContext(ToastContext);

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: Platform.OS === 'android' ? 48 : 56,
    left: 16,
    right: 16,
    zIndex: 9999,
    gap: 8,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 10,
    width: width - 32,
  },
  message: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 14,
    lineHeight: 19,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    marginTop: 2,
  },
});
