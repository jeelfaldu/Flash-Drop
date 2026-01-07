import React, { createContext, useContext, useState, useEffect } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const Colors = {
  light: {
    background: '#F8F9FB',
    surface: '#FFFFFF',
    text: '#333333',
    subtext: '#8E8E93',
    primary: '#7C4DFF',
    primaryDark: '#6200EA',
    accent: '#B3E5FC',
    border: '#E0E0E0',
    card: '#FFFFFF',
  },
  dark: {
    background: '#121212',
    surface: '#1E1E1E',
    text: '#FFFFFF',
    subtext: '#AAAAAA',
    primary: '#9D7AFF',
    primaryDark: '#7C4DFF',
    accent: '#03DAC6',
    border: '#333333',
    card: '#242424',
  }
};

type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeContextType {
  mode: ThemeMode;
  theme: typeof Colors.light;
  setMode: (mode: ThemeMode) => void;
  isDark: boolean;
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
    await AsyncStorage.getItem('themeMode');
    await AsyncStorage.setItem('themeMode', newMode);
  };

  const isDark = mode === 'system' ? systemColorScheme === 'dark' : mode === 'dark';
  const theme = isDark ? Colors.dark : Colors.light;

  return (
    <ThemeContext.Provider value={{ mode, theme, setMode, isDark }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider');
  return context;
};
