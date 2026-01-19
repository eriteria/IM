import React, { useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Vibration,
  Platform,
  Dimensions,
  PanResponder,
  AppState,
  AppStateStatus,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Avatar from './Avatar';
import * as signalr from '../services/signalr';
import { useCallStore } from '../stores/callStore';
import { RootStackParamList } from '../navigation/RootNavigator';
import { FONTS, SPACING } from '../utils/theme';
import { useTheme, ThemeColors } from '../context/ThemeContext';
import { callSoundService } from '../services/CallSoundService';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const DRAWER_HEIGHT = 120;
const SWIPE_THRESHOLD = -50; // Swipe up threshold to dismiss

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

interface IncomingCallDrawerProps {
  visible: boolean;
  callId: string;
  callerName: string;
  callerAvatar?: string;
  callType: 'Voice' | 'Video';
  conversationId: string;
  isCallWaiting?: boolean; // True if user is already on another call
  onDismiss: () => void;
}

const IncomingCallDrawer: React.FC<IncomingCallDrawerProps> = ({
  visible,
  callId,
  callerName,
  callerAvatar,
  callType,
  conversationId,
  isCallWaiting = false,
  onDismiss,
}) => {
  const navigation = useNavigation<NavigationProp>();
  const { clearIncomingCall, activeCall } = useCallStore();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const slideAnim = useRef(new Animated.Value(-DRAWER_HEIGHT - 50)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const panY = useRef(new Animated.Value(0)).current;
  const isHandlingAction = useRef(false);
  const appStateRef = useRef(AppState.currentState);

  // Pan responder for swipe-up to dismiss
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gestureState) => {
          // Only respond to vertical swipes
          return Math.abs(gestureState.dy) > Math.abs(gestureState.dx);
        },
        onPanResponderMove: (_, gestureState) => {
          // Only allow upward movement
          if (gestureState.dy < 0) {
            panY.setValue(gestureState.dy);
          }
        },
        onPanResponderRelease: (_, gestureState) => {
          if (gestureState.dy < SWIPE_THRESHOLD) {
            // Swipe up - decline the call
            handleDecline();
          } else {
            // Reset position
            Animated.spring(panY, {
              toValue: 0,
              useNativeDriver: true,
              tension: 100,
              friction: 10,
            }).start();
          }
        },
      }),
    [callId]
  );

  // Listen for app going to background - switch to full screen
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (
        appStateRef.current === 'active' &&
        nextAppState.match(/inactive|background/) &&
        visible &&
        !isHandlingAction.current
      ) {
        // App going to background with active incoming call
        // The native UI will handle it, but we keep state
        console.log('IncomingCallDrawer: App going to background, native UI will take over');
      }
      appStateRef.current = nextAppState;
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [visible]);

  // Slide in/out animation
  useEffect(() => {
    if (visible) {
      // Slide in
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 80,
        friction: 12,
      }).start();

      // Start pulse animation for avatar
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.1,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }),
        ])
      );
      pulse.start();

      // Start vibration
      const vibrationPattern = [0, 800, 400, 800, 400, 800];
      Vibration.vibrate(vibrationPattern, true);

      // Play ringtone
      callSoundService.playIncomingRingtone();

      return () => {
        pulse.stop();
        Vibration.cancel();
        callSoundService.stopAllSounds();
      };
    } else {
      // Slide out
      Animated.timing(slideAnim, {
        toValue: -DRAWER_HEIGHT - 50,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [visible]);

  const handleAccept = useCallback(async () => {
    if (isHandlingAction.current) return;
    isHandlingAction.current = true;

    console.log('IncomingCallDrawer: Accepting call', callId);
    try {
      Vibration.cancel();
      callSoundService.stopAllSounds();
      clearIncomingCall();
      onDismiss();

      // Navigate to call screen
      navigation.navigate('Call', {
        callId,
        conversationId,
        type: callType,
        isIncoming: true,
      });
    } catch (error) {
      console.error('Failed to accept call from drawer:', error);
      isHandlingAction.current = false;
    }
  }, [callId, conversationId, callType, navigation, clearIncomingCall, onDismiss]);

  const handleDecline = useCallback(async () => {
    if (isHandlingAction.current) return;
    isHandlingAction.current = true;

    console.log('IncomingCallDrawer: Declining call', callId);
    try {
      Vibration.cancel();
      callSoundService.stopAllSounds();

      // Slide out animation
      Animated.timing(slideAnim, {
        toValue: -DRAWER_HEIGHT - 50,
        duration: 200,
        useNativeDriver: true,
      }).start(async () => {
        await signalr.declineCall(callId);
        clearIncomingCall();
        onDismiss();
        isHandlingAction.current = false;
      });
    } catch (error) {
      console.error('Failed to decline call from drawer:', error);
      clearIncomingCall();
      onDismiss();
      isHandlingAction.current = false;
    }
  }, [callId, slideAnim, clearIncomingCall, onDismiss]);

  const handleExpand = useCallback(() => {
    // Navigate to full-screen incoming call view
    console.log('IncomingCallDrawer: Expanding to full screen');
    Vibration.cancel();
    callSoundService.stopAllSounds();
    onDismiss();

    navigation.navigate('IncomingCall', {
      callId,
      callerName,
      callerAvatar,
      callType,
      conversationId,
    });
  }, [callId, callerName, callerAvatar, callType, conversationId, navigation, onDismiss]);

  if (!visible) return null;

  const combinedTranslateY = Animated.add(slideAnim, panY);

  return (
    <Animated.View
      style={[
        styles.container,
        {
          transform: [{ translateY: combinedTranslateY }],
        },
      ]}
      {...panResponder.panHandlers}
    >
      {/* Swipe indicator */}
      <View style={styles.swipeIndicator} />

      {/* Main content - tappable to expand */}
      <TouchableOpacity
        style={styles.content}
        onPress={handleExpand}
        activeOpacity={0.95}
      >
        {/* Left side - Avatar with pulse */}
        <Animated.View
          style={[
            styles.avatarContainer,
            { transform: [{ scale: pulseAnim }] },
          ]}
        >
          <Avatar uri={callerAvatar} name={callerName} size={50} />
        </Animated.View>

        {/* Middle - Caller info */}
        <View style={styles.callerInfo}>
          <Text style={styles.callerName} numberOfLines={1}>
            {callerName}
          </Text>
          <Text style={styles.callType}>
            {isCallWaiting ? 'Call Waiting - ' : ''}
            Incoming {callType === 'Video' ? 'Video' : 'Voice'} Call
          </Text>
          <Text style={styles.swipeHint}>Swipe up to decline</Text>
        </View>

        {/* Right side - Action buttons */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionButton, styles.declineButton]}
            onPress={handleDecline}
            activeOpacity={0.7}
          >
            <Icon name="phone-hangup" size={24} color={colors.textInverse} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, styles.acceptButton]}
            onPress={handleAccept}
            activeOpacity={0.7}
          >
            <Icon
              name={callType === 'Video' ? 'video' : 'phone'}
              size={24}
              color={colors.textInverse}
            />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>

      {/* Call waiting indicator */}
      {isCallWaiting && (
        <View style={styles.callWaitingBadge}>
          <Icon name="phone-in-talk" size={12} color={colors.textInverse} />
          <Text style={styles.callWaitingText}>On another call</Text>
        </View>
      )}
    </Animated.View>
  );
};

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      position: 'absolute',
      top: Platform.OS === 'ios' ? 50 : 10,
      left: SPACING.md,
      right: SPACING.md,
      backgroundColor: colors.surface,
      borderRadius: 16,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
      elevation: 10,
      zIndex: 9999,
      overflow: 'hidden',
    },
    swipeIndicator: {
      alignSelf: 'center',
      width: 40,
      height: 4,
      backgroundColor: colors.textMuted,
      borderRadius: 2,
      marginTop: SPACING.xs,
      opacity: 0.5,
    },
    content: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: SPACING.md,
    },
    avatarContainer: {
      marginRight: SPACING.md,
      borderWidth: 2,
      borderColor: colors.secondary,
      borderRadius: 27,
      padding: 2,
    },
    callerInfo: {
      flex: 1,
      marginRight: SPACING.sm,
    },
    callerName: {
      fontSize: FONTS.sizes.lg,
      fontWeight: 'bold',
      color: colors.text,
      marginBottom: 2,
    },
    callType: {
      fontSize: FONTS.sizes.sm,
      color: colors.textSecondary,
    },
    swipeHint: {
      fontSize: FONTS.sizes.xs,
      color: colors.textMuted,
      marginTop: 4,
    },
    actions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACING.sm,
    },
    actionButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
    },
    declineButton: {
      backgroundColor: colors.error,
    },
    acceptButton: {
      backgroundColor: colors.secondary,
    },
    callWaitingBadge: {
      position: 'absolute',
      top: SPACING.xs,
      right: SPACING.md,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.warning,
      paddingHorizontal: SPACING.sm,
      paddingVertical: 2,
      borderRadius: 10,
    },
    callWaitingText: {
      fontSize: FONTS.sizes.xs,
      color: colors.textInverse,
      marginLeft: 4,
      fontWeight: '500',
    },
  });

export default IncomingCallDrawer;
