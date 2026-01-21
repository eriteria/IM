import React, { useEffect, useRef, useState } from 'react';
import { StatusBar, LogBox, AppState, AppStateStatus, Platform, Alert, Linking } from 'react-native';
import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { check, request, PERMISSIONS, RESULTS, Permission } from 'react-native-permissions';
import AsyncStorage from '@react-native-async-storage/async-storage';

import RootNavigator, { RootStackParamList } from './src/navigation/RootNavigator';
import IncomingCallListener from './src/components/IncomingCallListener';
import IncomingCallDrawer from './src/components/IncomingCallDrawer';
import GlobalPTTNotification from './src/components/GlobalPTTNotification';
import ErrorBoundary from './src/components/ErrorBoundary';
import { useAuthStore } from './src/stores/authStore';
import { useCallStore } from './src/stores/callStore';
import { initializeSignalR, declineCall, joinCall } from './src/services/signalr';
import {
  initializeNotifications,
  setupForegroundHandler,
  setupNotificationListeners,
  NotificationData,
} from './src/services/notifications';
import { CallManager } from './src/services/CallManager';
import { initializeVoipPush, setVoipCallHandler, VoipCallData } from './src/services/VoipPushService';
import { nativeCallEventService, NativeCallEventData } from './src/services/NativeCallEvent';
import NativeBatteryOptimization from './src/services/NativeBatteryOptimization';
import { canDrawOverlays, requestOverlayPermission } from './src/services/NativeOverlayPermission';
import { ThemeProvider, useTheme, NotificationProvider } from './src/context';

// Ignore specific warnings in development
LogBox.ignoreLogs([
  'Non-serializable values were found in the navigation state',
  'could not determine track dimensions',
  '[🍉] JSI SQLiteAdapter not available',
]);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 1000 * 60 * 5, // 5 minutes
    },
  },
});

/**
 * Request all required permissions on app launch
 * For iOS: Forces permission dialogs for camera, microphone, contacts, photos, and location
 * For Android: Requests essential permissions
 */
const requestAllPermissions = async (): Promise<void> => {
  try {
    if (Platform.OS === 'ios') {
      // iOS: Request all permissions sequentially to ensure each dialog is shown
      const iosPermissions: Permission[] = [
        PERMISSIONS.IOS.CAMERA,
        PERMISSIONS.IOS.MICROPHONE,
        PERMISSIONS.IOS.CONTACTS,
        PERMISSIONS.IOS.PHOTO_LIBRARY,
        PERMISSIONS.IOS.LOCATION_WHEN_IN_USE,
      ];

      console.log('Requesting all iOS permissions on app launch...');

      for (const permission of iosPermissions) {
        const status = await check(permission);
        if (status === RESULTS.DENIED) {
          console.log(`Requesting permission: ${permission}`);
          const result = await request(permission);
          console.log(`Permission ${permission}: ${result}`);
          // Small delay between permission requests to ensure UI is responsive
          await new Promise(resolve => setTimeout(resolve, 300));
        } else if (status === RESULTS.BLOCKED) {
          console.log(`Permission ${permission} is blocked, user needs to enable in settings`);
        } else {
          console.log(`Permission ${permission} already: ${status}`);
        }
      }

      console.log('All iOS permissions requested');
    } else if (Platform.OS === 'android') {
      // Android: Request essential permissions
      const androidPermissions: Permission[] = [
        PERMISSIONS.ANDROID.CAMERA,
        PERMISSIONS.ANDROID.RECORD_AUDIO,
        PERMISSIONS.ANDROID.READ_CONTACTS,
        PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION,
      ];

      console.log('Requesting all Android permissions on app launch...');

      for (const permission of androidPermissions) {
        const status = await check(permission);
        if (status === RESULTS.DENIED) {
          const result = await request(permission);
          console.log(`Permission ${permission}: ${result}`);
        } else if (status === RESULTS.BLOCKED) {
          console.log(`Permission ${permission} is blocked, user needs to enable in settings`);
        }
      }
    }
  } catch (error) {
    console.error('Error requesting permissions:', error);
  }
};

/**
 * Request overlay permission on Android 15+ (API 35+)
 * Required to show incoming call screen when app is in background with screen on
 * Without this, users must tap notification to answer calls on Android 15+
 */
const requestOverlayPermissionIfNeeded = async (): Promise<void> => {
  if (Platform.OS !== 'android') return;

  try {
    // Only needed on Android 15+ (API 35+)
    const sdkVersion = Platform.Version;
    if (typeof sdkVersion === 'number' && sdkVersion < 35) {
      console.log('Android < 15, overlay permission not required for calls');
      return;
    }

    const hasPermission = await canDrawOverlays();
    if (!hasPermission) {
      console.log('Overlay permission not granted on Android 15+, prompting user');
      Alert.alert(
        'Display Over Other Apps',
        'To show incoming call screens when your phone is in use, please allow this app to display over other apps. This ensures you never miss an important call.',
        [
          {
            text: 'Not Now',
            style: 'cancel',
          },
          {
            text: 'Open Settings',
            onPress: async () => {
              await requestOverlayPermission();
            },
          },
        ]
      );
    } else {
      console.log('Overlay permission already granted');
    }
  } catch (error) {
    console.error('Error checking overlay permission:', error);
  }
};

/**
 * Request battery optimization exemption on Android
 * Critical for receiving calls when app is in background
 */
const requestBatteryOptimizationExemption = async (): Promise<void> => {
  if (Platform.OS !== 'android') return;

  try {
    const isIgnoring = await NativeBatteryOptimization.isIgnoringBatteryOptimizations();
    if (!isIgnoring) {
      const hasAggressive = await NativeBatteryOptimization.hasAggressiveBatteryManagement();
      const manufacturer = await NativeBatteryOptimization.getDeviceManufacturer();

      // Show explanation dialog
      Alert.alert(
        'Battery Optimization',
        'To receive calls reliably when the app is in the background or your phone is locked, please disable battery optimization for this app.',
        [
          {
            text: 'Not Now',
            style: 'cancel',
          },
          {
            text: 'Open Settings',
            onPress: async () => {
              await NativeBatteryOptimization.requestIgnoreBatteryOptimizations();

              // If device has aggressive battery management, show additional guidance
              if (hasAggressive) {
                setTimeout(() => {
                  Alert.alert(
                    'Additional Settings Required',
                    `Your ${manufacturer.charAt(0).toUpperCase() + manufacturer.slice(1)} device has additional battery settings. For best call reliability, also disable any "App sleeping" or "Background restrictions" in your device settings.`,
                    [
                      { text: 'OK', style: 'default' },
                      {
                        text: 'Open Device Settings',
                        onPress: () => NativeBatteryOptimization.openManufacturerBatterySettings(),
                      },
                    ]
                  );
                }, 2000);
              }
            },
          },
        ]
      );
    }
  } catch (error) {
    console.error('Error checking battery optimization:', error);
  }
};

// Inner app component that can use theme context
const AppContent: React.FC = () => {
  const { isAuthenticated, accessToken, logout } = useAuthStore();
  const { setIncomingCall, clearIncomingCall, incomingCall, showIncomingCallDrawer, setShowIncomingCallDrawer, activeCall } = useCallStore();
  const { colors, isDark } = useTheme();
  const navigationRef = useRef<NavigationContainerRef<RootStackParamList>>(null);
  const appState = useRef(AppState.currentState);
  // Track navigated call IDs to prevent duplicate navigation
  const navigatedCallIds = useRef<Set<string>>(new Set());

  // Helper to check if we're already on a specific screen
  const isOnScreen = (screenName: string): boolean => {
    const state = navigationRef.current?.getRootState();
    if (!state || !state.routes || state.routes.length === 0) return false;
    return state.routes[state.index]?.name === screenName;
  };

  // Helper to safely navigate to IncomingCall without duplicates
  const navigateToIncomingCallSafe = (params: {
    callId: string;
    callerName: string;
    callerAvatar?: string;
    callType: 'Voice' | 'Video';
    conversationId: string;
  }) => {
    // Skip if already on IncomingCall screen
    if (isOnScreen('IncomingCall')) {
      console.log('App: Already on IncomingCall screen, skipping navigation');
      return;
    }
    // Skip if we've already navigated for this call
    if (navigatedCallIds.current.has(params.callId)) {
      console.log('App: Already navigated for this call ID, skipping');
      return;
    }
    navigatedCallIds.current.add(params.callId);
    console.log('App: Navigating to IncomingCall screen for call:', params.callId);
    navigationRef.current?.navigate('IncomingCall', params);
  };

  // Clear navigated call IDs when incoming call is cleared
  useEffect(() => {
    const unsubscribe = useCallStore.subscribe((state, prevState) => {
      if (prevState.incomingCall && !state.incomingCall) {
        // Incoming call was cleared, reset navigation tracking
        navigatedCallIds.current.clear();
      }
    });
    return unsubscribe;
  }, []);

  // Check for force logout flag (single device login enforcement)
  useEffect(() => {
    const checkForceLogout = async () => {
      try {
        const forceLogoutData = await AsyncStorage.getItem('force_logout');
        if (forceLogoutData) {
          const { reason, timestamp } = JSON.parse(forceLogoutData);
          // Only process if it's recent (within last 5 minutes)
          if (Date.now() - timestamp < 5 * 60 * 1000) {
            console.log('Force logout detected:', reason);
            // Clear the flag first
            await AsyncStorage.removeItem('force_logout');
            // Show alert and logout
            Alert.alert(
              'Session Ended',
              reason || 'You have been logged out because you logged in on another device.',
              [
                {
                  text: 'OK',
                  onPress: async () => {
                    await logout();
                  },
                },
              ],
              { cancelable: false }
            );
          } else {
            // Old flag, just remove it
            await AsyncStorage.removeItem('force_logout');
          }
        }
      } catch (error) {
        console.error('Error checking force logout:', error);
      }
    };

    if (isAuthenticated) {
      checkForceLogout();
    }
  }, [isAuthenticated, logout]);

  // Request all permissions on app launch (even before authentication)
  useEffect(() => {
    const initializePermissions = async () => {
      // Request all permissions on app launch
      await requestAllPermissions();

      // Request battery optimization exemption (Android only)
      // Slight delay to not overwhelm user with dialogs
      if (Platform.OS === 'android') {
        setTimeout(() => {
          requestBatteryOptimizationExemption();
        }, 1500);

        // Request overlay permission for Android 15+ (needed for incoming call screen)
        setTimeout(() => {
          requestOverlayPermissionIfNeeded();
        }, 4000); // After battery optimization dialog
      }
    };

    initializePermissions();
  }, []); // Run once on app launch

  // Initialize notifications, CallManager, and VoIP push
  useEffect(() => {
    const initNotifications = async () => {
      try {
        await initializeNotifications();
        console.log('Notifications initialized successfully');

        // Initialize CallManager for CallKit/ConnectionService
        await CallManager.initialize();
        console.log('CallManager initialized successfully');

        // Set up CallManager callbacks
        CallManager.setCallbacks({
          onAnswerCall: async (callId: string) => {
            console.log('CallManager: Answer call', callId);
            try {
              const result = await joinCall(callId);
              clearIncomingCall();
              navigationRef.current?.navigate('Call', {
                callId,
                conversationId: result.conversationId || '',
                type: result.type === 'Video' ? 'Video' : 'Voice',
                isIncoming: true,
                roomToken: result.roomToken,
                roomId: result.roomId,
                liveKitUrl: result.liveKitUrl,
              });
            } catch (error) {
              console.error('Failed to join call from CallManager:', error);
            }
          },
          onEndCall: async (callId: string) => {
            console.log('CallManager: End call', callId);
            try {
              await declineCall(callId);
              clearIncomingCall();
            } catch (error) {
              console.error('Failed to decline call from CallManager:', error);
            }
          },
          onMuteCall: (callId: string, muted: boolean) => {
            console.log('CallManager: Mute call', callId, muted);
            // This will be handled by the CallScreen component
          },
        });

        // Initialize VoIP push for iOS
        if (Platform.OS === 'ios') {
          await initializeVoipPush();
          console.log('VoIP push initialized successfully');

          // Handle VoIP call events
          setVoipCallHandler((callData: VoipCallData) => {
            console.log('VoIP call received:', callData);
            setIncomingCall({
              id: callData.callId,
              conversationId: callData.conversationId,
              initiatorId: callData.callerId,
              initiatorName: callData.callerName,
              type: callData.callType,
              status: 'Ringing',
              participants: [],
              startedAt: new Date().toISOString(),
            });
          });
        }
      } catch (error) {
        console.error('Failed to initialize notifications:', error);
      }
    };

    if (isAuthenticated) {
      initNotifications();
    }

    return () => {
      CallManager.cleanup();
    };
  }, [isAuthenticated, clearIncomingCall, setIncomingCall]);

  // Handle native call events (from Android native notification actions)
  useEffect(() => {
    if (!isAuthenticated || Platform.OS !== 'android') return;

    const handleNativeCallEvent = async (event: NativeCallEventData) => {
      console.log('Native call event received:', event);

      if (event.action === 'decline' && event.callId) {
        // User declined call from native notification
        console.log('Declining call from native notification:', event.callId);
        try {
          await declineCall(event.callId);
          clearIncomingCall();
        } catch (error) {
          console.error('Error declining call:', error);
        }
      } else if (event.action === 'answer' && event.callId) {
        // User answered call from native notification - navigate to call screen
        console.log('Answering call from native notification:', event.callId);
        console.log('Room token from native:', event.roomToken ? `present (${event.roomToken.substring(0, 20)}...)` : 'NOT PRESENT');
        console.log('Room ID from native:', event.roomId || 'NOT PRESENT');
        console.log('LiveKit URL from native:', event.liveKitUrl || 'NOT PRESENT');
        clearIncomingCall();
        navigationRef.current?.navigate('Call', {
          callId: event.callId,
          conversationId: event.conversationId,
          type: event.callType === 'Video' ? 'Video' : 'Voice',
          isIncoming: true,
          // Pass room token data from native join call (if available)
          roomToken: event.roomToken,
          roomId: event.roomId,
          liveKitUrl: event.liveKitUrl,
        });
      } else if (event.action === 'incoming' && event.callId) {
        // App opened from native notification - show incoming call screen
        console.log('Showing incoming call screen from native notification');
        navigateToIncomingCallSafe({
          callId: event.callId,
          callerName: event.callerName || 'Unknown',
          callerAvatar: undefined,
          callType: event.callType === 'Video' ? 'Video' : 'Voice',
          conversationId: event.conversationId || '',
        });
      }
    };

    // Start listening for native events
    const unsubscribe = nativeCallEventService.startListening(handleNativeCallEvent);

    // Check for pending call data (when app was launched from notification)
    const checkPendingData = async () => {
      const pendingData = await nativeCallEventService.getPendingCallData();
      if (pendingData) {
        console.log('Found pending call data:', pendingData);
        handleNativeCallEvent(pendingData);
      }
    };
    checkPendingData();

    return unsubscribe;
  }, [isAuthenticated, clearIncomingCall]);

  // Handle notification interactions
  useEffect(() => {
    if (!isAuthenticated) return;

    // Handle notification press
    const handleNotificationPress = (data: NotificationData) => {
      console.log('Notification pressed:', data);

      if (data.type === 'call' && data.callId && data.conversationId) {
        // Navigate to incoming call screen using safe navigation
        navigateToIncomingCallSafe({
          callId: data.callId,
          callerName: data.callerName || data.title,
          callerAvatar: data.imageUrl,
          callType: data.callType === 'Video' ? 'Video' : 'Voice',
          conversationId: data.conversationId,
        });
      } else if (data.type === 'message' && data.conversationId) {
        // Navigate to chat screen
        navigationRef.current?.navigate('Chat', {
          conversationId: data.conversationId,
        });
      }
    };

    const unsubscribeListeners = setupNotificationListeners(handleNotificationPress);

    // Handle foreground messages
    const unsubscribeForeground = setupForegroundHandler((notification) => {
      console.log('Foreground notification:', notification);

      // For call notifications, also update the call store
      if (notification.type === 'call' && notification.callId) {
        setIncomingCall({
          id: notification.callId,
          conversationId: notification.conversationId || '',
          initiatorId: notification.callerId || notification.userId || '',
          initiatorName: notification.callerName || notification.title,
          type: notification.callType === 'Video' ? 'Video' : 'Voice',
          status: 'Ringing',
          participants: [],
          startedAt: new Date().toISOString(),
        });
      }
    });

    return () => {
      unsubscribeListeners();
      unsubscribeForeground();
    };
  }, [isAuthenticated, setIncomingCall]);

  // Initialize SignalR
  useEffect(() => {
    if (isAuthenticated && accessToken) {
      console.log('Initializing SignalR with token...');
      initializeSignalR(accessToken)
        .then(() => console.log('SignalR initialized successfully'))
        .catch((error) => console.error('SignalR initialization failed:', error));
    }
  }, [isAuthenticated, accessToken]);

  // Handle app state changes for reconnecting
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (
        appState.current.match(/inactive|background/) &&
        nextAppState === 'active' &&
        isAuthenticated &&
        accessToken
      ) {
        // Reconnect SignalR when app comes to foreground
        console.log('App came to foreground, reconnecting SignalR...');
        initializeSignalR(accessToken).catch(console.error);
      }
      appState.current = nextAppState;
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [isAuthenticated, accessToken]);

  const handlePTTNotificationPress = (conversationId: string) => {
    // Navigate to PTT screen when notification is tapped
    navigationRef.current?.navigate('PTT' as any);
  };

  // Handle drawer dismiss
  const handleDrawerDismiss = () => {
    setShowIncomingCallDrawer(false);
  };

  return (
    <>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'light-content'}
        backgroundColor={colors.header}
      />
      <NavigationContainer ref={navigationRef}>
        {isAuthenticated && <IncomingCallListener />}
        {isAuthenticated && <GlobalPTTNotification onPress={handlePTTNotificationPress} />}
        <RootNavigator />
        {/* Incoming Call Drawer - shown when app is in foreground */}
        {isAuthenticated && incomingCall && (
          <IncomingCallDrawer
            visible={showIncomingCallDrawer}
            callId={incomingCall.id}
            callerName={incomingCall.initiatorName || 'Unknown'}
            callerAvatar={incomingCall.initiatorProfilePicture}
            callType={incomingCall.type}
            conversationId={incomingCall.conversationId}
            isCallWaiting={!!activeCall}
            onDismiss={handleDrawerDismiss}
          />
        )}
      </NavigationContainer>
    </>
  );
};

// Main App component with all providers
const App: React.FC = () => {
  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <QueryClientProvider client={queryClient}>
          <SafeAreaProvider>
            <ThemeProvider>
              <NotificationProvider>
                <AppContent />
              </NotificationProvider>
            </ThemeProvider>
          </SafeAreaProvider>
        </QueryClientProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
};

export default App;
