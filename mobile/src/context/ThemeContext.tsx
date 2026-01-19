import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { useColorScheme, Appearance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Theme mode type
export type ThemeMode = 'light' | 'dark' | 'system';

// Light theme colors
const lightColors = {
  // Primary WhatsApp-like colors
  primary: '#075E54',
  primaryDark: '#054C44',
  primaryLight: '#128C7E',
  secondary: '#25D366',
  secondaryDark: '#1DA851',

  // Backgrounds
  background: '#FFFFFF',
  backgroundSecondary: '#F0F2F5',
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',

  // Text
  text: '#111B21',
  textSecondary: '#667781',
  textTertiary: '#8696A0',
  textMuted: '#8696A0',
  textInverse: '#FFFFFF',

  // Chat
  chatBackground: '#ECE5DD',
  chatBubbleSent: '#D9FDD3',
  chatBubbleReceived: '#FFFFFF',
  chatBubbleSentText: '#111B21',
  chatBubbleReceivedText: '#111B21',

  // Status
  online: '#25D366',
  offline: '#667781',
  typing: '#25D366',

  // Message status
  tick: '#667781',
  tickBlue: '#53BDEB',

  // Dividers and borders
  divider: '#E9EDEF',
  border: '#E9EDEF',

  // States
  error: '#F44336',
  warning: '#FFA000',
  success: '#4CAF50',
  info: '#2196F3',
  link: '#027EB5',

  // Call
  callAccept: '#25D366',
  callDecline: '#F44336',

  // Overlay
  overlay: 'rgba(0, 0, 0, 0.5)',
  overlayLight: 'rgba(0, 0, 0, 0.3)',

  // Input
  inputBackground: '#F0F2F5',
  inputText: '#111B21',
  inputPlaceholder: '#8696A0',
  inputBorder: '#E9EDEF',

  // Icons
  icon: '#54656F',
  iconActive: '#075E54',

  // Tab bar
  tabBar: '#FFFFFF',
  tabBarBorder: '#E9EDEF',
  tabBarActive: '#075E54',
  tabBarInactive: '#8696A0',

  // Header (primary green)
  header: '#075E54',
  headerText: '#FFFFFF',

  // Card
  card: '#FFFFFF',
  cardBorder: '#E9EDEF',

  // Skeleton
  skeleton: '#E9EDEF',
  skeletonHighlight: '#F0F2F5',

  // Switch
  switchTrack: '#E9EDEF',
  switchTrackActive: '#25D366',
  switchThumb: '#FFFFFF',

  // Additional colors for components
  receivedBubble: '#FFFFFF',
  surfaceSecondary: '#F0F2F5',
};

// Dark theme colors
const darkColors = {
  // Primary WhatsApp-like colors
  primary: '#00A884',
  primaryDark: '#008069',
  primaryLight: '#25D366',
  secondary: '#25D366',
  secondaryDark: '#1DA851',

  // Backgrounds
  background: '#111B21',
  backgroundSecondary: '#0B141A',
  surface: '#1F2C34',
  surfaceElevated: '#233138',

  // Text
  text: '#E9EDEF',
  textSecondary: '#8696A0',
  textTertiary: '#667781',
  textMuted: '#667781',
  textInverse: '#FFFFFF',

  // Chat
  chatBackground: '#0B141A',
  chatBubbleSent: '#005C4B',
  chatBubbleReceived: '#1F2C34',
  chatBubbleSentText: '#E9EDEF',
  chatBubbleReceivedText: '#E9EDEF',

  // Status
  online: '#25D366',
  offline: '#667781',
  typing: '#25D366',

  // Message status
  tick: '#667781',
  tickBlue: '#53BDEB',

  // Dividers and borders
  divider: '#233138',
  border: '#233138',

  // States
  error: '#F44336',
  warning: '#FFA000',
  success: '#4CAF50',
  info: '#2196F3',
  link: '#53BDEB',

  // Call
  callAccept: '#25D366',
  callDecline: '#F44336',

  // Overlay
  overlay: 'rgba(0, 0, 0, 0.7)',
  overlayLight: 'rgba(0, 0, 0, 0.5)',

  // Input
  inputBackground: '#233138',
  inputText: '#E9EDEF',
  inputPlaceholder: '#8696A0',
  inputBorder: '#233138',

  // Icons
  icon: '#8696A0',
  iconActive: '#00A884',

  // Tab bar
  tabBar: '#1F2C34',
  tabBarBorder: '#233138',
  tabBarActive: '#00A884',
  tabBarInactive: '#8696A0',

  // Header (dark surface)
  header: '#1F2C34',
  headerText: '#E9EDEF',

  // Card
  card: '#1F2C34',
  cardBorder: '#233138',

  // Skeleton
  skeleton: '#233138',
  skeletonHighlight: '#2A3942',

  // Switch
  switchTrack: '#233138',
  switchTrackActive: '#00A884',
  switchThumb: '#E9EDEF',

  // Additional colors for components
  receivedBubble: '#1F2C34',
  surfaceSecondary: '#0B141A',
};

export type ThemeColors = typeof lightColors;

// Theme context type
interface ThemeContextType {
  colors: ThemeColors;
  isDark: boolean;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  toggleTheme: () => void;
}

// Storage key
const THEME_STORAGE_KEY = '@app_theme_mode';

// Create context
const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// Provider props
interface ThemeProviderProps {
  children: ReactNode;
}

// Theme provider component
export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  const systemColorScheme = useColorScheme();
  const [themeMode, setThemeModeState] = useState<ThemeMode>('system');
  const [isLoaded, setIsLoaded] = useState(false);

  // Determine if dark mode is active
  const isDark = themeMode === 'system'
    ? systemColorScheme === 'dark'
    : themeMode === 'dark';

  // Get current colors
  const colors = isDark ? darkColors : lightColors;

  // Load saved theme preference
  useEffect(() => {
    const loadTheme = async () => {
      try {
        const savedTheme = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        if (savedTheme && ['light', 'dark', 'system'].includes(savedTheme)) {
          setThemeModeState(savedTheme as ThemeMode);
        }
      } catch (error) {
        console.error('Error loading theme preference:', error);
      } finally {
        setIsLoaded(true);
      }
    };
    loadTheme();
  }, []);

  // Listen for system theme changes
  useEffect(() => {
    const subscription = Appearance.addChangeListener(({ colorScheme }) => {
      if (themeMode === 'system') {
        // Force re-render when system theme changes
        setThemeModeState('system');
      }
    });

    return () => subscription.remove();
  }, [themeMode]);

  // Set theme mode and persist
  const setThemeMode = useCallback(async (mode: ThemeMode) => {
    setThemeModeState(mode);
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch (error) {
      console.error('Error saving theme preference:', error);
    }
  }, []);

  // Toggle between light and dark (not system)
  const toggleTheme = useCallback(() => {
    const newMode = isDark ? 'light' : 'dark';
    setThemeMode(newMode);
  }, [isDark, setThemeMode]);

  // Don't render until theme is loaded to prevent flash
  if (!isLoaded) {
    return null;
  }

  return (
    <ThemeContext.Provider value={{ colors, isDark, themeMode, setThemeMode, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

// Hook to use theme
export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

// Export colors for static usage where context isn't available
export { lightColors, darkColors };
