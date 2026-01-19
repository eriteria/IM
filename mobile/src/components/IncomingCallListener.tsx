import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useNavigation, useNavigationState } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallStore } from '../stores/callStore';
import { RootStackParamList } from '../navigation/RootNavigator';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

/**
 * Component that listens for incoming calls from SignalR
 * and either shows a drawer (when app is in foreground) or
 * navigates to the IncomingCallScreen (when coming from background).
 *
 * This component prevents duplicate navigation by:
 * 1. Tracking if we've already handled the current call
 * 2. Checking if we're already on the IncomingCall screen
 * 3. Tracking the last handled call ID to prevent re-handling
 */
const IncomingCallListener: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const incomingCall = useCallStore((state) => state.incomingCall);
  const setShowIncomingCallDrawer = useCallStore((state) => state.setShowIncomingCallDrawer);
  const hasHandled = useRef(false);
  const lastHandledCallId = useRef<string | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  // Get current route name to check if already on IncomingCall screen
  const currentRouteName = useNavigationState((state) => {
    if (!state || !state.routes || state.routes.length === 0) return null;
    return state.routes[state.index]?.name;
  });

  // Track app state changes
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      appStateRef.current = nextAppState;
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (incomingCall && !hasHandled.current) {
      // Check if we're already on the IncomingCall screen for this call
      if (currentRouteName === 'IncomingCall') {
        console.log('IncomingCallListener: Already on IncomingCall screen, skipping');
        hasHandled.current = true;
        lastHandledCallId.current = incomingCall.id;
        return;
      }

      // Check if we already handled this specific call ID
      if (lastHandledCallId.current === incomingCall.id) {
        console.log('IncomingCallListener: Already handled this call ID, skipping');
        return;
      }

      hasHandled.current = true;
      lastHandledCallId.current = incomingCall.id;

      const callerName = incomingCall.initiatorName || 'Unknown';
      const callerAvatar = incomingCall.initiatorProfilePicture;

      console.log('IncomingCallListener: Incoming call detected:', {
        callId: incomingCall.id,
        callerName,
        callType: incomingCall.type,
        conversationId: incomingCall.conversationId,
        appState: appStateRef.current,
      });

      // Determine if app is in foreground
      const isAppInForeground = appStateRef.current === 'active';

      if (isAppInForeground) {
        // App is in foreground - show the drawer instead of navigating
        console.log('IncomingCallListener: App in foreground, showing drawer');
        setShowIncomingCallDrawer(true);
      } else {
        // App is in background or inactive - navigate to full screen
        // This typically happens when the app is woken by a push notification
        console.log('IncomingCallListener: App in background, navigating to IncomingCall screen');
        navigation.navigate('IncomingCall', {
          callId: incomingCall.id,
          callerName,
          callerAvatar,
          callType: incomingCall.type,
          conversationId: incomingCall.conversationId,
        });
      }
    }

    // Reset handled flag when incoming call is cleared
    if (!incomingCall) {
      hasHandled.current = false;
      lastHandledCallId.current = null;
      setShowIncomingCallDrawer(false);
    }
  }, [incomingCall, navigation, currentRouteName, setShowIncomingCallDrawer]);

  // This component doesn't render anything - the drawer is rendered in App.tsx
  return null;
};

export default IncomingCallListener;
