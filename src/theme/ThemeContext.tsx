import React, { createContext, useContext, useState, useEffect } from 'react';
import { useColorScheme, Platform, StatusBar } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const Colors = {
  light: {
    background: '#F7F9FC', // Slightly cooler white
    surface: '#FFFFFF',
    text: '#1A1B1E', // Soifter black
    subtext: '#6C727F',
    primary: '#6200EA', // Deep Purple
    primaryDark: '#3700B3',
    secondary: '#00D1FF', // Cyan accent
    accent: '#00D1FF',
    border: '#E2E8F0',
    card: '#FFFFFF',
    success: '#00B894',
    error: '#FF4757',
    warning: '#FFA502',
    gradient: ['#6200EA', '#7C4DFF', '#B388FF'],
  },
  dark: {
    background: '#0F1115', // Deep dark blue-grey
    surface: '#1A1D23',
    text: '#F7F9FC',
    subtext: '#9CA3AF',
    primary: '#7C4DFF', // Lighter purple for dark mode
    primaryDark: '#5E31D6',
    secondary: '#00E5FF',
    accent: '#00E5FF',
    border: '#2D333E',
    card: '#1A1D23',
    success: '#00D189',
    error: '#FF6B6B',
    warning: '#FFC048',
    gradient: ['#1A1D23', '#000000'],
  }
};

export const Spacing = {
  xs: 4,
  s: 8,
  m: 16,
  l: 24,
  xl: 32,
  xxl: 48,
};

export const Layout = {
  radius: {
    s: 8,
    m: 16,
    l: 24,
    xl: 32,
  },
  shadow: {
    light: {
      shadowColor: '#6200EA',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.1,
      shadowRadius: 12,
      elevation: 5,
    },
    medium: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.15,
      shadowRadius: 20,
      elevation: 10,
    },
    dark: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
      elevation: 8,
    }
  }
};

export const Typography = {
  fontFamily: Platform.select({ ios: 'System', android: 'Roboto' }), // Default system fonts are usually good but we can aim towards 'Inter' if available
  weights: {
    regular: '400',
    medium: '500',
    bold: '700',
    heavy: '800',
  },
  sizes: {
    xs: 12,
    s: 14,
    m: 16,
    l: 18,
    xl: 24,
    xxl: 32,
    xxxl: 40,
  }
};

type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeContextType {
  mode: ThemeMode;
  colors: typeof Colors.light;
  spacing: typeof Spacing;
  layout: typeof Layout;
  typography: typeof Typography;
  setMode: (mode: ThemeMode) => void;
  isDark: boolean;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const systemColorScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');

  useEffect(() => {
    loadTheme();
  }, []);

  const loadTheme = async () => {
    const savedMode = await AsyncStorage.getItem('themeMode');
    if (savedMode) {
      setModeState(savedMode as ThemeMode);
    }
  };

  const setMode = async (newMode: ThemeMode) => {
    setModeState(newMode);
    await AsyncStorage.setItem('themeMode', newMode);
  };

  const isDark = mode === 'system' ? systemColorScheme === 'dark' : mode === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;

  const toggleTheme = () => {
    setMode(isDark ? 'light' : 'dark');
  };

  return (
    <ThemeContext.Provider value={{ mode, colors, spacing: Spacing, layout: Layout, typography: Typography, setMode, isDark, toggleTheme }}>
      <StatusBar
        barStyle={isDark ? "light-content" : "dark-content"}
        backgroundColor={isDark ? colors.background : "transparent"}
        translucent={true}
      />
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider');
  return context;
};
