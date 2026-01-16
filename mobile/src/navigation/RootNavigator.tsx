import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View, Platform, PermissionsAndroid, Alert, Linking } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { request, check, PERMISSIONS, RESULTS } from 'react-native-permissions';
import { useAuthStore } from '../stores/authStore';
import { COLORS } from '../utils/theme';

// Auth Screens
import WelcomeScreen from '../screens/auth/WelcomeScreen';
import ServiceNumberScreen from '../screens/auth/ServiceNumberScreen';
import TokenVerificationScreen from '../screens/auth/TokenVerificationScreen';

// Main Screens
import MainTabNavigator from './MainTabNavigator';
import ChatScreen from '../screens/chat/ChatScreen';
import GroupInfoScreen from '../screens/chat/GroupInfoScreen';
import ContactInfoScreen from '../screens/chat/ContactInfoScreen';
import NewChatScreen from '../screens/chat/NewChatScreen';
import NewGroupScreen from '../screens/chat/NewGroupScreen';
import MediaViewerScreen from '../screens/chat/MediaViewerScreen';
import SearchScreen from '../screens/chat/SearchScreen';
import ForwardMessageScreen from '../screens/chat/ForwardMessageScreen';
import MediaGalleryScreen from '../screens/chat/MediaGalleryScreen';
import ArchivedChatsScreen from '../screens/chat/ArchivedChatsScreen';
import CallScreen from '../screens/call/CallScreen';
import IncomingCallScreen from '../screens/call/IncomingCallScreen';
import ProfileScreen from '../screens/settings/ProfileScreen';
import PrivacyScreen from '../screens/settings/PrivacyScreen';
import BlockedUsersScreen from '../screens/settings/BlockedUsersScreen';
import StorageManagementScreen from '../screens/settings/StorageManagementScreen';
import ChatBackupScreen from '../screens/settings/ChatBackupScreen';
import QRCodeScreen from '../screens/settings/QRCodeScreen';
import StatusViewerScreen from '../screens/status/StatusViewerScreen';
import CreateStatusScreen from '../screens/status/CreateStatusScreen';
import AddToCallScreen from '../screens/call/AddToCallScreen';
import PTTScreen from '../screens/main/PTTScreen';
import CreateChannelScreen from '../screens/channels/CreateChannelScreen';
import ChannelScreen from '../screens/channels/ChannelScreen';
import AddParticipantsScreen from '../screens/chat/AddParticipantsScreen';
import NewContactScreen from '../screens/chat/NewContactScreen';
import DocumentViewerScreen from '../screens/chat/DocumentViewerScreen';

export type RootStackParamList = {
  // Auth
  Welcome: undefined;
  ServiceNumber: undefined;
  TokenVerification: {
    serviceNumber: string;
    fullName: string;
    maskedEmail?: string;
    maskedPhone?: string;
  };

  // Main
  MainTabs: undefined;
  Chat: { conversationId: string; title?: string; openSearch?: boolean };
  GroupInfo: { conversationId: string };
  ContactInfo: { userId: string };
  NewChat: undefined;
  NewGroup: undefined;
  MediaViewer: {
    mediaUrl: string;
    mediaType: string;
    senderName?: string;
    timestamp?: string;
  };
  DocumentViewer: {
    mediaUrl: string;
    fileName: string;
    fileSize?: number;
    senderName?: string;
    timestamp?: string;
  };
  MediaGallery: { conversationId: string };
  Search: undefined;
  ForwardMessage: { messageId: string };
  Call: {
    callId?: string;
    conversationId?: string;
    type: 'Voice' | 'Video';
    isIncoming?: boolean;
    // Pre-fetched room token from native code (when call was answered via native API)
    roomToken?: string;
    roomId?: string;
    liveKitUrl?: string;
  };
  IncomingCall: {
    callId: string;
    callerName: string;
    callerAvatar?: string;
    callType: 'Voice' | 'Video';
    conversationId: string;
  };
  Profile: undefined;
  Privacy: undefined;
  BlockedUsers: undefined;
  StatusViewer: { userId: string };
  CreateStatus: undefined;
  AddToCall: {
    callId: string;
    existingParticipants?: string[];
    callType: 'Voice' | 'Video';
  };
  ArchivedChats: undefined;
  StorageManagement: undefined;
  ChatBackup: undefined;
  QRCode: undefined;
  PTT: { conversationId?: string };
  CreateChannel: undefined;
  Channel: { channelId: string };
  AddParticipants: { conversationId: string; existingParticipantIds: string[] };
  NewContact: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

// Request essential permissions via native popups
const requestPermissions = async () => {
  if (Platform.OS === 'android') {
    const androidVersion = Platform.Version as number;

    // Core permissions that are always required
    const permissions = [
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      PermissionsAndroid.PERMISSIONS.CAMERA,
      PermissionsAndroid.PERMISSIONS.READ_CONTACTS,
    ];

    // Add notification permission for Android 13+
    if (androidVersion >= 33) {
      permissions.push(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
      permissions.push(PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES);
      permissions.push(PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO);
      permissions.push(PermissionsAndroid.PERMISSIONS.READ_MEDIA_AUDIO);
    } else {
      permissions.push(PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE);
      permissions.push(PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE);
    }

    try {
      const results = await PermissionsAndroid.requestMultiple(permissions);

      // Check if critical permissions (audio, camera) were denied
      const audioGranted = results[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === PermissionsAndroid.RESULTS.GRANTED;
      const cameraGranted = results[PermissionsAndroid.PERMISSIONS.CAMERA] === PermissionsAndroid.RESULTS.GRANTED;

      const deniedPermissions: string[] = [];
      if (!audioGranted) deniedPermissions.push('Microphone');
      if (!cameraGranted) deniedPermissions.push('Camera');

      if (deniedPermissions.length > 0) {
        // Show alert to guide user to settings
        Alert.alert(
          'Permissions Required',
          `The following permissions are required for full app functionality: ${deniedPermissions.join(', ')}. Please enable them in Settings.`,
          [
            { text: 'Later', style: 'cancel' },
            {
              text: 'Open Settings',
              onPress: () => Linking.openSettings(),
            },
          ]
        );
      }
    } catch (error) {
      console.error('Error requesting permissions:', error);
    }
  } else {
    // iOS - request permissions one by one
    try {
      const micResult = await request(PERMISSIONS.IOS.MICROPHONE);
      const cameraResult = await request(PERMISSIONS.IOS.CAMERA);
      await request(PERMISSIONS.IOS.CONTACTS);
      await request(PERMISSIONS.IOS.PHOTO_LIBRARY);

      const deniedPermissions: string[] = [];
      if (micResult !== RESULTS.GRANTED) deniedPermissions.push('Microphone');
      if (cameraResult !== RESULTS.GRANTED) deniedPermissions.push('Camera');

      if (deniedPermissions.length > 0) {
        Alert.alert(
          'Permissions Required',
          `The following permissions are required for full app functionality: ${deniedPermissions.join(', ')}. Please enable them in Settings.`,
          [
            { text: 'Later', style: 'cancel' },
            {
              text: 'Open Settings',
              onPress: () => Linking.openSettings(),
            },
          ]
        );
      }
    } catch (error) {
      console.error('Error requesting iOS permissions:', error);
    }
  }
};

const RootNavigator: React.FC = () => {
  const { isAuthenticated, isLoading, initialize } = useAuthStore();
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    const init = async () => {
      await initialize();
      setIsInitialized(true);
    };
    init();
  }, [initialize]);

  // Request permissions when user becomes authenticated
  useEffect(() => {
    if (isAuthenticated && isInitialized) {
      requestPermissions();
    }
  }, [isAuthenticated, isInitialized]);

  if (!isInitialized || isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background }}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: COLORS.primary },
        headerTintColor: COLORS.textLight,
        headerTitleStyle: { fontWeight: 'bold' },
        headerBackTitleVisible: false, // Hide back button title on iOS
      }}
    >
      {!isAuthenticated ? (
        // Auth Stack
        <>
          <Stack.Screen name="Welcome" component={WelcomeScreen} options={{ headerShown: false }} />
          <Stack.Screen name="ServiceNumber" component={ServiceNumberScreen} options={{ title: 'Service Number' }} />
          <Stack.Screen name="TokenVerification" component={TokenVerificationScreen} options={{ title: 'Verification' }} />
        </>
      ) : (
        // Main Stack - permissions requested via native popups
        <>
          <Stack.Screen name="MainTabs" component={MainTabNavigator} options={{ headerShown: false }} />
          <Stack.Screen name="Chat" component={ChatScreen} options={({ route }) => ({ title: route.params?.title || 'Chat' })} />
          <Stack.Screen name="GroupInfo" component={GroupInfoScreen} options={{ title: 'Group Info' }} />
          <Stack.Screen name="ContactInfo" component={ContactInfoScreen} options={{ title: 'Contact Info' }} />
          <Stack.Screen name="NewChat" component={NewChatScreen} options={{ title: 'New Chat' }} />
          <Stack.Screen name="NewGroup" component={NewGroupScreen} options={{ title: 'New Group' }} />
          <Stack.Screen name="MediaViewer" component={MediaViewerScreen} options={{ headerShown: false }} />
          <Stack.Screen name="DocumentViewer" component={DocumentViewerScreen} options={{ headerShown: false }} />
          <Stack.Screen name="MediaGallery" component={MediaGalleryScreen} options={{ title: 'Media' }} />
          <Stack.Screen name="Search" component={SearchScreen} options={{ title: 'Search' }} />
          <Stack.Screen name="ForwardMessage" component={ForwardMessageScreen} options={{ title: 'Forward to...' }} />
          <Stack.Screen name="Call" component={CallScreen} options={{ headerShown: false, gestureEnabled: false }} />
          <Stack.Screen
            name="IncomingCall"
            component={IncomingCallScreen}
            options={{ headerShown: false, gestureEnabled: false, presentation: 'fullScreenModal' }}
          />
          <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: 'Profile' }} />
          <Stack.Screen name="Privacy" component={PrivacyScreen} options={{ title: 'Privacy' }} />
          <Stack.Screen name="BlockedUsers" component={BlockedUsersScreen} options={{ title: 'Blocked Users' }} />
          <Stack.Screen name="StatusViewer" component={StatusViewerScreen} options={{ headerShown: false }} />
          <Stack.Screen name="CreateStatus" component={CreateStatusScreen} options={{ headerShown: false }} />
          <Stack.Screen name="AddToCall" component={AddToCallScreen} options={{ headerShown: false }} />
          <Stack.Screen name="ArchivedChats" component={ArchivedChatsScreen} options={{ headerShown: false }} />
          <Stack.Screen name="StorageManagement" component={StorageManagementScreen} options={{ headerShown: false }} />
          <Stack.Screen name="ChatBackup" component={ChatBackupScreen} options={{ headerShown: false }} />
          <Stack.Screen name="QRCode" component={QRCodeScreen} options={{ headerShown: false }} />
          <Stack.Screen name="PTT" component={PTTScreen} options={{ title: 'Push to Talk', headerShown: false }} />
          <Stack.Screen name="CreateChannel" component={CreateChannelScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Channel" component={ChannelScreen} options={{ headerShown: false }} />
          <Stack.Screen name="AddParticipants" component={AddParticipantsScreen} options={{ headerShown: false }} />
          <Stack.Screen name="NewContact" component={NewContactScreen} options={{ headerShown: false }} />
        </>
      )}
    </Stack.Navigator>
  );
};

export default RootNavigator;
