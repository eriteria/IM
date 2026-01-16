import { useEffect, useRef } from 'react';
import { useNavigation, useNavigationState } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallStore } from '../stores/callStore';
import { RootStackParamList } from '../navigation/RootNavigator';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

/**
 * Component that listens for incoming calls from SignalR
 * and navigates to the IncomingCallScreen.
 *
 * This component prevents duplicate navigation by:
 * 1. Tracking if we've already navigated for the current call
 * 2. Checking if we're already on the IncomingCall screen
 * 3. Tracking the last navigated call ID to prevent re-navigation
 */
const IncomingCallListener: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const incomingCall = useCallStore((state) => state.incomingCall);
  const hasNavigated = useRef(false);
  const lastNavigatedCallId = useRef<string | null>(null);

  // Get current route name to check if already on IncomingCall screen
  const currentRouteName = useNavigationState((state) => {
    if (!state || !state.routes || state.routes.length === 0) return null;
    return state.routes[state.index]?.name;
  });

  useEffect(() => {
    if (incomingCall && !hasNavigated.current) {
      // Check if we're already on the IncomingCall screen for this call
      if (currentRouteName === 'IncomingCall') {
        console.log('IncomingCallListener: Already on IncomingCall screen, skipping navigation');
        hasNavigated.current = true;
        lastNavigatedCallId.current = incomingCall.id;
        return;
      }

      // Check if we already navigated for this specific call ID
      if (lastNavigatedCallId.current === incomingCall.id) {
        console.log('IncomingCallListener: Already navigated for this call ID, skipping');
        return;
      }

      hasNavigated.current = true;
      lastNavigatedCallId.current = incomingCall.id;

      const callerName = incomingCall.initiatorName || 'Unknown';
      const callerAvatar = incomingCall.initiatorProfilePicture;

      console.log('IncomingCallListener: Navigating to IncomingCall screen:', {
        callId: incomingCall.id,
        callerName,
        callType: incomingCall.type,
        conversationId: incomingCall.conversationId,
      });

      // Navigate to incoming call screen
      navigation.navigate('IncomingCall', {
        callId: incomingCall.id,
        callerName,
        callerAvatar,
        callType: incomingCall.type,
        conversationId: incomingCall.conversationId,
      });
    }

    // Reset navigation flag when incoming call is cleared
    if (!incomingCall) {
      hasNavigated.current = false;
      lastNavigatedCallId.current = null;
    }
  }, [incomingCall, navigation, currentRouteName]);

  // This component doesn't render anything
  return null;
};

export default IncomingCallListener;
