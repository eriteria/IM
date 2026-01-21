// Polyfill for crypto.getRandomValues (required by tweetnacl)
import 'react-native-get-random-values';

// Polyfill for Buffer (required by tweetnacl-util)
import { Buffer } from 'buffer';
global.Buffer = Buffer;

import { AppRegistry, NativeModules, Platform } from 'react-native';
import messaging from '@react-native-firebase/messaging';
import notifee, {
  EventType,
  AndroidCategory,
  AndroidImportance,
  AndroidVisibility,
  AndroidStyle,
} from '@notifee/react-native';
import RNCallKeep from 'react-native-callkeep';
import App from './App';
import { name as appName } from './app.json';

// Initialize CallKeep for background calls
const initializeCallKeep = async () => {
  try {
    await RNCallKeep.setup({
      ios: {
        appName: 'IM',
        supportsVideo: true,
        maximumCallGroups: '1',
        maximumCallsPerCallGroup: '1',
        includesCallsInRecents: true,
        ringtoneSound: 'ringtone.caf',
      },
      android: {
        alertTitle: 'Permissions Required',
        alertDescription: 'IM needs access to manage phone calls',
        cancelButton: 'Cancel',
        okButton: 'OK',
        imageName: 'ic_launcher',
        selfManaged: true,
        additionalPermissions: [],
        foregroundService: {
          channelId: 'calls',
          channelName: 'Incoming Calls',
          notificationTitle: 'IM Call',
          notificationIcon: 'ic_call',
        },
      },
    });
    console.log('CallKeep initialized in background');
  } catch (error) {
    console.log('CallKeep initialization failed in background:', error);
  }
};

// Generate a UUID for CallKeep
const generateUUID = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

// Helper to stop native ringtone
const stopNativeRingtone = async () => {
  if (Platform.OS === 'android' && NativeModules.CallSoundModule) {
    try {
      await NativeModules.CallSoundModule.stopRingtone();
    } catch (e) {
      console.log('Error stopping native ringtone:', e);
    }
  }
};

// Handle background messages from Firebase
// This is called when the app is in background or killed state
messaging().setBackgroundMessageHandler(async (remoteMessage) => {
  console.log('Background message received:', JSON.stringify(remoteMessage.data));

  const { data } = remoteMessage;
  if (!data) return;

  // Handle incoming call notifications
  // ANDROID: Skip here - let native CallNotificationService handle it directly
  // The native service is more reliable for showing incoming call UI when app is killed
  // iOS: Use CallKeep for CallKit integration
  if (data.type === 'call') {
    if (Platform.OS === 'android') {
      // On Android, native CallNotificationService handles FCM call messages directly
      // via onMessageReceived(). We don't need to do anything here.
      // This JS handler runs in a headless context where NativeModules may not work reliably.
      console.log('Android: Call notification - native service handles this');
      return;
    }

    // iOS: Use CallKeep
    const callId = data.callId;
    const callerName = data.callerName || 'Unknown Caller';
    const isVideo = data.callType === 'Video';
    const uuid = generateUUID();

    console.log('iOS Background call received:', { callId, callerName, isVideo });

    try {
      // Initialize CallKeep in background
      await initializeCallKeep();

      // Display incoming call via CallKeep - this wakes the device
      RNCallKeep.displayIncomingCall(
        uuid,
        callerName,
        callerName,
        'generic',
        isVideo
      );

      console.log('CallKeep incoming call displayed:', uuid);
    } catch (error) {
      console.error('Failed to display incoming call via CallKeep:', error);

      // Fallback: Use notifee notification with full-screen intent
      await displayCallNotificationFallback(data);
    }
    return;
  }

  // Handle call ended notification
  // ANDROID: Skip here - let native CallNotificationService handle it
  // iOS: Use CallKeep
  if (data.type === 'call_ended') {
    if (Platform.OS === 'android') {
      // On Android, native CallNotificationService handles call_ended messages directly
      console.log('Android: Call ended notification - native service handles this');
      return;
    }

    const callId = data.callId;
    console.log('iOS Background call ended:', callId);

    try {
      // End all active calls (in background, we can't track specific UUIDs)
      RNCallKeep.endAllCalls();
    } catch (error) {
      console.error('Failed to end call via CallKeep:', error);
    }

    // Cancel any call notifications
    await notifee.cancelNotification(`call-${callId}`);
    return;
  }

  // Handle force logout notification (single device login enforcement)
  if (data.type === 'force_logout') {
    console.log('Force logout notification received:', data.reason);
    // Store the force logout flag - the app will handle this when it opens
    // We can't directly call the authStore from background handler
    // The app will check for this flag on startup
    try {
      const AsyncStorage = require('@react-native-async-storage/async-storage').default;
      await AsyncStorage.setItem('force_logout', JSON.stringify({
        reason: data.reason || 'You have been logged out because you logged in on another device.',
        timestamp: Date.now(),
      }));
      console.log('Force logout flag stored');
    } catch (error) {
      console.error('Failed to store force logout flag:', error);
    }
    return;
  }

  // Handle message notifications - with wake-up capability
  if (data.type === 'message') {
    // Data-only message from updated backend
    const senderName = data.senderName || 'New Message';
    const messagePreview = data.messagePreview || 'You have a new message';

    // Create message channel if needed - respects device DND settings
    await notifee.createChannel({
      id: 'messages_urgent',
      name: 'Messages',
      importance: AndroidImportance.HIGH,
      sound: 'default',
      vibration: true,
      vibrationPattern: [0, 250, 250, 250],
      lights: true,
      lightColor: '#128C7E',
      // Don't bypass DND - respect user's device settings
      bypassDnd: false,
      visibility: AndroidVisibility.PUBLIC,
    });

    await notifee.displayNotification({
      title: senderName,
      body: messagePreview,
      data: {
        type: 'message',
        conversationId: data.conversationId,
        messageId: data.messageId,
        senderId: data.senderId,
      },
      android: {
        channelId: 'messages_urgent',
        smallIcon: 'ic_notification',
        color: '#128C7E',
        importance: AndroidImportance.HIGH,
        visibility: AndroidVisibility.PUBLIC,
        lights: true,
        lightColor: '#128C7E',
        vibrationPattern: [0, 250, 250, 250],
        pressAction: {
          id: 'default',
          launchActivity: 'com.im.MainActivity',
        },
        showTimestamp: true,
        timestamp: Date.now(),
      },
      ios: {
        sound: 'default',
        interruptionLevel: 'timeSensitive',
      },
    });

    console.log('Message notification displayed for:', data.messageId);
  }
});

// Fallback function for call notifications when CallKeep fails
const displayCallNotificationFallback = async (data) => {
  try {
    await notifee.deleteChannel('calls');
  } catch (e) {
    // Channel might not exist
  }

  await notifee.createChannel({
    id: 'calls',
    name: 'Incoming Calls',
    importance: AndroidImportance.HIGH,
    sound: 'ringtone',
    vibration: true,
    vibrationPattern: [500, 250, 500, 250],
    lights: true,
    lightColor: '#128C7E',
    // Don't bypass DND - respect user's device settings
    bypassDnd: false,
  });

  await notifee.displayNotification({
    id: `call-${data.callId}`,
    title: data.callerName || 'Incoming Call',
    body: `Incoming ${data.callType?.toLowerCase() || 'voice'} call`,
    data: {
      type: 'call',
      callId: data.callId,
      callerId: data.callerId,
      callerName: data.callerName,
      callType: data.callType,
      conversationId: data.conversationId,
    },
    android: {
      channelId: 'calls',
      smallIcon: 'ic_call',
      largeIcon: 'ic_launcher',
      color: '#128C7E',
      category: AndroidCategory.CALL,
      importance: AndroidImportance.HIGH,
      visibility: AndroidVisibility.PUBLIC,
      ongoing: true,
      autoCancel: false,
      sound: 'ringtone',
      loopSound: true,
      vibrationPattern: [500, 250, 500, 250],
      asForegroundService: true,
      fullScreenAction: {
        id: 'incoming-call',
        launchActivity: 'com.im.MainActivity',
      },
      pressAction: {
        id: 'answer',
        launchActivity: 'com.im.MainActivity',
      },
      actions: [
        {
          title: '❌ Decline',
          pressAction: { id: 'decline' },
        },
        {
          title: '✓ Answer',
          pressAction: { id: 'answer', launchActivity: 'com.im.MainActivity' },
        },
      ],
      style: {
        type: AndroidStyle.BIGTEXT,
        text: `${data.callerName || 'Someone'} is calling you`,
      },
      showTimestamp: true,
      timestamp: Date.now(),
      onlyAlertOnce: false,
    },
    ios: {
      sound: 'ringtone.caf',
      critical: true,
      criticalVolume: 1.0,
      interruptionLevel: 'timeSensitive',
    },
  });

  console.log('Fallback call notification displayed for:', data.callId);
};

// Handle notification background events
notifee.onBackgroundEvent(async ({ type, detail }) => {
  console.log('Background notification event:', type, detail);

  const { notification, pressAction } = detail;

  if (type === EventType.ACTION_PRESS) {
    const data = notification?.data;

    if (pressAction?.id === 'decline' && data?.callId) {
      // User declined the call from notification
      console.log('Call declined from notification:', data.callId);
      // Stop native ringtone
      await stopNativeRingtone();
      // The actual decline will be handled when the app opens
      await notifee.cancelNotification(notification?.id || '');
    } else if (pressAction?.id === 'answer' && data?.callId) {
      // User answered the call from notification
      console.log('Call answered from notification:', data.callId);
      // Stop native ringtone
      await stopNativeRingtone();
      await notifee.cancelNotification(notification?.id || '');
      // The navigation to CallScreen will be handled in App.tsx
    }
  }

  if (type === EventType.DISMISSED) {
    // Notification was dismissed
    console.log('Notification dismissed');
  }
});

AppRegistry.registerComponent(appName, () => App);
