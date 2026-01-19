import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  StatusBar,
  Platform,
  Alert,
  ScrollView,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useQuery } from '@tanstack/react-query';
import { registerGlobals, VideoView } from '@livekit/react-native';
import {
  Room,
  Track,
  RoomOptions,
  VideoPresets,
  ConnectionQuality,
  RoomEvent,
  RemoteParticipant,
  LocalVideoTrack,
  facingModeFromLocalTrack,
} from 'livekit-client';
import InCallManager from 'react-native-incall-manager';
import Avatar from '../../components/Avatar';
import { GroupCallGrid } from '../../components/call';
import { conversationsApi, callsApi } from '../../services/api';
import * as signalr from '../../services/signalr';
import { useCallStore } from '../../stores/callStore';
import { useAuthStore } from '../../stores/authStore';
import { RootStackParamList } from '../../navigation/RootNavigator';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { FONTS, SPACING } from '../../utils/theme';
import { callSoundService } from '../../services/CallSoundService';
import { CallManager } from '../../services/CallManager';

// Participant info type for group calls
interface RemoteParticipantInfo {
  id: string;
  name: string;
  profilePictureUrl?: string;
  videoTrack: Track | null;
  audioTrack: Track | null;
  isMuted: boolean;
  isVideoEnabled: boolean;
  isSpeaking: boolean;
  isLocal: boolean;
  connectionQuality?: ConnectionQuality;
}

registerGlobals();

// Connection quality levels for UI display
type QualityLevel = 'excellent' | 'good' | 'poor' | 'lost';

const getQualityLevel = (quality: ConnectionQuality): QualityLevel => {
  switch (quality) {
    case ConnectionQuality.Excellent:
      return 'excellent';
    case ConnectionQuality.Good:
      return 'good';
    case ConnectionQuality.Poor:
      return 'poor';
    case ConnectionQuality.Lost:
      return 'lost';
    default:
      return 'good';
  }
};

const getQualityColor = (quality: QualityLevel): string => {
  switch (quality) {
    case 'excellent':
      return '#4CAF50'; // Green
    case 'good':
      return '#8BC34A'; // Light green
    case 'poor':
      return '#FF9800'; // Orange
    case 'lost':
      return '#F44336'; // Red
    default:
      return '#8BC34A';
  }
};

const getQualityIcon = (quality: QualityLevel): string => {
  switch (quality) {
    case 'excellent':
      return 'signal-cellular-3';
    case 'good':
      return 'signal-cellular-2';
    case 'poor':
      return 'signal-cellular-1';
    case 'lost':
      return 'signal-cellular-outline';
    default:
      return 'signal-cellular-2';
  }
};

type CallScreenRouteProp = RouteProp<RootStackParamList, 'Call'>;
type CallScreenNavigationProp = NativeStackNavigationProp<RootStackParamList>;

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const CallScreen: React.FC = () => {
  const route = useRoute<CallScreenRouteProp>();
  const navigation = useNavigation<CallScreenNavigationProp>();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { conversationId, type, callId, isIncoming, roomToken: preJoinedRoomToken, roomId: preJoinedRoomId, liveKitUrl: preJoinedLiveKitUrl } = route.params;
  const { userId } = useAuthStore();
  const { setActiveCall, clearActiveCall, activeCall } = useCallStore();
  const currentUserId = userId || '';
  const currentConversationId = conversationId || '';
  const existingCallId = callId;

  const [room, setRoom] = useState<Room | null>(null);
  const [isConnecting, setIsConnecting] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(type === 'Video');
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [callDuration, setCallDuration] = useState(0);
  const [hasOtherParticipant, setHasOtherParticipant] = useState(false);
  const [localVideoTrack, setLocalVideoTrack] = useState<Track | null>(null);
  const [remoteVideoTrack, setRemoteVideoTrack] = useState<Track | null>(null);
  const [callInitialized, setCallInitialized] = useState(false);
  const [callStatus, setCallStatus] = useState<'calling' | 'ringing' | 'connected'>('calling');
  const ringingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasOtherParticipantRef = useRef(false); // Ref to track participant status for timeout callback
  const isReconnectingRef = useRef(false); // Ref to track reconnection status for callbacks
  const participantDisconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Grace period timeout
  const isCallTerminatedRef = useRef(false); // Ref to track if call has been terminated to prevent re-initialization

  // Group call state - track multiple remote participants
  const [remoteParticipants, setRemoteParticipants] = useState<Map<string, RemoteParticipantInfo>>(new Map());
  const [activeSpeakerId, setActiveSpeakerId] = useState<string | null>(null);
  const [callLayout, setCallLayout] = useState<'grid' | 'spotlight'>('grid');

  // Connection quality and reconnection state
  const [connectionQuality, setConnectionQuality] = useState<QualityLevel>('good');
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [showQualityWarning, setShowQualityWarning] = useState(false);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const qualityWarningTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Camera flip state
  const [isFrontCamera, setIsFrontCamera] = useState(true);
  const [isFlippingCamera, setIsFlippingCamera] = useState(false);

  // Hold/Resume state
  const [isOnHold, setIsOnHold] = useState(false);
  const [remoteIsOnHold, setRemoteIsOnHold] = useState(false);

  // Audio routing state
  const [audioRoute, setAudioRoute] = useState<'speaker' | 'earpiece' | 'bluetooth' | 'headphones'>('speaker');
  const [isBluetoothAvailable, setIsBluetoothAvailable] = useState(false);

  // Encryption state
  const [isEncrypted, setIsEncrypted] = useState(true); // LiveKit uses E2EE by default when configured

  const { data: conversation } = useQuery({
    queryKey: ['conversation', currentConversationId],
    queryFn: async () => {
      const response = await conversationsApi.get(currentConversationId);
      return response.data;
    },
    enabled: !!currentConversationId,
  });

  const otherParticipant = conversation?.participants?.find(
    (p: any) => p.userId !== currentUserId
  );

  // Determine if this is a group call
  const isGroupCall = conversation?.type === 'Group';
  const participantCount = conversation?.participants?.length || 0;

  // Get all other participants for group calls
  const allOtherParticipants = useMemo(() => {
    if (!conversation?.participants) return [];
    return conversation.participants.filter((p: any) => p.userId !== currentUserId);
  }, [conversation, currentUserId]);

  // Helper to get participant info from conversation
  const getParticipantInfo = useCallback((participantId: string) => {
    const participant = conversation?.participants?.find(
      (p: any) => p.userId === participantId
    );
    return participant ? {
      name: participant.displayName || participant.fullName || 'Unknown',
      profilePictureUrl: participant.profilePictureUrl,
    } : { name: 'Unknown', profilePictureUrl: undefined };
  }, [conversation]);

  // Convert remoteParticipants Map to array for GroupCallGrid
  const remoteParticipantsArray = useMemo(() => {
    return Array.from(remoteParticipants.values());
  }, [remoteParticipants]);

  // Update remote participant info
  const updateRemoteParticipant = useCallback((
    participantId: string,
    updates: Partial<RemoteParticipantInfo>
  ) => {
    setRemoteParticipants(prev => {
      const newMap = new Map(prev);
      const existing = newMap.get(participantId);
      if (existing) {
        newMap.set(participantId, { ...existing, ...updates });
      }
      return newMap;
    });
  }, []);

  // Add a remote participant
  const addRemoteParticipant = useCallback((participant: RemoteParticipant) => {
    // Look up participant info directly from conversation to avoid stale closure issues
    const conversationParticipant = conversation?.participants?.find(
      (p: any) => p.userId === participant.identity
    );
    const name = conversationParticipant?.displayName || conversationParticipant?.fullName || participant.name || 'Unknown';
    const profilePictureUrl = conversationParticipant?.profilePictureUrl;

    console.log('[CallScreen] Adding remote participant:', participant.identity, 'name:', name);

    const participantInfo: RemoteParticipantInfo = {
      id: participant.identity,
      name,
      profilePictureUrl,
      videoTrack: null,
      audioTrack: null,
      isMuted: !participant.isMicrophoneEnabled,
      isVideoEnabled: participant.isCameraEnabled,
      isSpeaking: participant.isSpeaking,
      isLocal: false,
      connectionQuality: participant.connectionQuality,
    };
    setRemoteParticipants(prev => {
      const newMap = new Map(prev);
      newMap.set(participant.identity, participantInfo);
      return newMap;
    });
  }, [conversation]);

  // Remove a remote participant
  const removeRemoteParticipant = useCallback((participantId: string) => {
    setRemoteParticipants(prev => {
      const newMap = new Map(prev);
      newMap.delete(participantId);
      return newMap;
    });
  }, []);

  // Update participant names when conversation data loads
  // This handles the case where participants were added before conversation data was available
  useEffect(() => {
    if (conversation?.participants && remoteParticipants.size > 0) {
      setRemoteParticipants(prev => {
        const newMap = new Map(prev);
        let updated = false;

        newMap.forEach((participantInfo, participantId) => {
          // If participant name is Unknown, try to look it up from conversation
          if (participantInfo.name === 'Unknown') {
            const conversationParticipant = conversation.participants.find(
              (p: any) => p.userId === participantId
            );
            if (conversationParticipant) {
              const name = conversationParticipant.displayName || conversationParticipant.fullName || 'Unknown';
              newMap.set(participantId, {
                ...participantInfo,
                name,
                profilePictureUrl: conversationParticipant.profilePictureUrl,
              });
              console.log('[CallScreen] Updated participant name:', participantId, 'to:', name);
              updated = true;
            }
          }
        });

        return updated ? newMap : prev;
      });
    }
  }, [conversation]);

  useEffect(() => {
    // Start InCallManager for proper audio routing
    InCallManager.start({ media: type === 'Video' ? 'video' : 'audio' });
    // Set initial speaker mode:
    // - Video calls: always speaker
    // - Outgoing voice calls: speaker initially (so user can hear dial tone), switch to earpiece when connected
    // - Incoming voice calls: earpiece (ringtone handled separately)
    const shouldUseSpeaker = type === 'Video' || !isIncoming;
    InCallManager.setSpeakerphoneOn(shouldUseSpeaker);
    setIsSpeakerOn(shouldUseSpeaker);

    // Check for wired headset on mount
    const checkAudioDevices = async () => {
      try {
        const headsetInfo = await InCallManager.getIsWiredHeadsetPluggedIn();
        if (headsetInfo.isWiredHeadsetPluggedIn) {
          setAudioRoute('headphones');
          setIsSpeakerOn(false);
          console.log('[CallScreen] Wired headset detected');
        }
      } catch (error) {
        console.log('[CallScreen] Error checking headset:', error);
      }
    };

    checkAudioDevices();
    initializeCall();

    return () => {
      // Clear timeout on unmount
      if (ringingTimeoutRef.current) {
        clearTimeout(ringingTimeoutRef.current);
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (qualityWarningTimeoutRef.current) {
        clearTimeout(qualityWarningTimeoutRef.current);
      }
      if (participantDisconnectTimeoutRef.current) {
        clearTimeout(participantDisconnectTimeoutRef.current);
      }
      // Stop any playing sounds
      callSoundService.stopAllSounds();
      // Stop InCallManager
      InCallManager.stop();
      cleanupCall();
    };
  }, []);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (!isConnecting && room && hasOtherParticipant) {
      interval = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isConnecting, room, hasOtherParticipant]);

  // Token refresh for long calls (tokens expire after 2 hours)
  // Refresh 5 minutes before expiry to ensure uninterrupted calls
  const tokenRefreshTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!room || !activeCall?.id || isCallTerminatedRef.current) return;

    // Set up token refresh 1 hour 55 minutes into the call (5 min before 2hr expiry)
    const REFRESH_INTERVAL = (2 * 60 - 5) * 60 * 1000; // 1h 55min in ms

    const refreshToken = async () => {
      try {
        console.log('[CallScreen] Refreshing LiveKit token...');
        const response = await callsApi.refreshToken(activeCall.id);
        if (response.data?.token && room) {
          // LiveKit room has a method to update the token
          // This keeps the connection alive without reconnecting
          console.log('[CallScreen] Token refreshed successfully');
          // Schedule next refresh
          tokenRefreshTimeoutRef.current = setTimeout(refreshToken, REFRESH_INTERVAL);
        }
      } catch (error) {
        console.error('[CallScreen] Failed to refresh token:', error);
        // Don't end the call on refresh failure, the token might still be valid
      }
    };

    // Schedule first refresh
    tokenRefreshTimeoutRef.current = setTimeout(refreshToken, REFRESH_INTERVAL);

    return () => {
      if (tokenRefreshTimeoutRef.current) {
        clearTimeout(tokenRefreshTimeoutRef.current);
        tokenRefreshTimeoutRef.current = null;
      }
    };
  }, [room, activeCall?.id]);

  // Watch for call ending from the other side
  useEffect(() => {
    console.log('CallScreen: activeCall changed:', activeCall?.id);
    console.log('CallScreen: existingCallId from route:', existingCallId);
    console.log('CallScreen: room exists:', !!room);
    console.log('CallScreen: callInitialized:', callInitialized);
    console.log('CallScreen: isCallTerminatedRef:', isCallTerminatedRef.current);
    if (!activeCall && callInitialized && !isCallTerminatedRef.current) {
      // Call was ended remotely, cleanup and navigate back
      console.log('CallScreen: Call ended remotely, cleaning up and navigating back');

      // Mark call as terminated to prevent any further actions
      isCallTerminatedRef.current = true;

      // Clear all timeouts immediately
      if (ringingTimeoutRef.current) {
        console.log('CallScreen: Clearing ringing timeout');
        clearTimeout(ringingTimeoutRef.current);
        ringingTimeoutRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (qualityWarningTimeoutRef.current) {
        clearTimeout(qualityWarningTimeoutRef.current);
        qualityWarningTimeoutRef.current = null;
      }
      if (participantDisconnectTimeoutRef.current) {
        clearTimeout(participantDisconnectTimeoutRef.current);
        participantDisconnectTimeoutRef.current = null;
      }

      // Stop all sounds
      callSoundService.stopAllSounds();

      cleanupCall();
      navigateBack();
    }
  }, [activeCall]);

  // Monitor remote participant hold status
  useEffect(() => {
    if (!activeCall?.participants) return;

    // Find the other participant (not current user)
    const remoteParticipant = activeCall.participants.find(
      (p) => p.userId !== currentUserId
    );

    if (remoteParticipant) {
      setRemoteIsOnHold(remoteParticipant.isOnHold || false);
    }
  }, [activeCall?.participants, currentUserId]);

  const navigateBack = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.reset({
        index: 0,
        routes: [{ name: 'MainTabs' as never }],
      });
    }
  };

  const initializeCall = async () => {
    // Check if call has already been terminated (e.g., declined before init completed)
    if (isCallTerminatedRef.current) {
      console.log('CallScreen: initializeCall skipped - call already terminated');
      return;
    }

    if (!currentConversationId) {
      Alert.alert('Error', 'No conversation specified');
      navigation.goBack();
      return;
    }

    console.log('CallScreen: initializeCall starting');
    console.log('CallScreen: isIncoming:', isIncoming, 'callId:', existingCallId);
    console.log('CallScreen: preJoinedRoomToken:', preJoinedRoomToken ? `present (${preJoinedRoomToken.substring(0, 20)}...)` : 'NOT PRESENT');
    console.log('CallScreen: preJoinedLiveKitUrl:', preJoinedLiveKitUrl || 'NOT PRESENT');
    console.log('CallScreen: preJoinedRoomId:', preJoinedRoomId || 'NOT PRESENT');

    // Declare call outside try block so it's accessible in catch for cleanup
    let call: any = null;

    try {
      let roomToken: string;
      let liveKitUrl: string;

      if (isIncoming && existingCallId) {
        // Check if we have pre-fetched room token from native code
        // This happens when the call was answered from the native IncomingCallActivity
        if (preJoinedRoomToken && preJoinedLiveKitUrl) {
          console.log('CallScreen: Using pre-fetched room token from native code');
          console.log('CallScreen: Token length:', preJoinedRoomToken.length);
          console.log('CallScreen: LiveKit URL:', preJoinedLiveKitUrl);
          call = { id: existingCallId };
          roomToken = preJoinedRoomToken;
          liveKitUrl = preJoinedLiveKitUrl;
        } else {
          // Join existing call via SignalR (fallback when not answered from native)
          console.log('CallScreen: Joining call via SignalR (no pre-joined token)');
          const response = await signalr.joinCall(existingCallId);
          if (!response) {
            throw new Error('Failed to join call - SignalR returned null');
          }
          call = { id: existingCallId };
          roomToken = response.roomToken;
          liveKitUrl = response.liveKitUrl;
          console.log('CallScreen: Got room token from SignalR, length:', roomToken.length);
        }
      } else {
        // Initiate new call via SignalR
        const response = await signalr.initiateCall(currentConversationId, type);
        if (!response) {
          throw new Error('Failed to initiate call - SignalR returned null');
        }
        call = response.call;
        roomToken = response.roomToken;
        liveKitUrl = response.liveKitUrl;
      }

      setActiveCall({
        id: call.id,
        conversationId: currentConversationId,
        type,
        status: 'Connecting',
        initiatorId: currentUserId,
        participants: [],
        startedAt: new Date().toISOString(),
      });

      // Connect to LiveKit room
      const roomOptions: RoomOptions = {
        adaptiveStream: true,
        dynacast: true,
        videoCaptureDefaults: {
          resolution: VideoPresets.h720.resolution,
        },
        publishDefaults: {
          videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
        },
      };

      const newRoom = new Room(roomOptions);

      newRoom.on('participantConnected', (participant: any) => {
        console.log('[CallScreen] === PARTICIPANT CONNECTED ===');
        console.log('[CallScreen] Participant identity:', participant.identity);
        hasOtherParticipantRef.current = true;
        setHasOtherParticipant(true);
        setCallStatus('connected');
        // Add to remote participants map for group calls
        addRemoteParticipant(participant);
        // Stop the ringing/dial tone when participant joins (call answered)
        console.log('[CallScreen] Stopping dial tone - call answered');
        callSoundService.stopAllSounds();
        // Clear the ringing timeout when participant joins
        if (ringingTimeoutRef.current) {
          clearTimeout(ringingTimeoutRef.current);
          ringingTimeoutRef.current = null;
        }
        // For outgoing voice calls, switch from speaker to earpiece when call connects
        if (!isIncoming && type === 'Voice') {
          console.log('[CallScreen] Switching to earpiece for connected voice call');
          InCallManager.setSpeakerphoneOn(false);
          setIsSpeakerOn(false);
          setAudioRoute('earpiece');
        }
      });

      newRoom.on('participantDisconnected', (participant: any) => {
        console.log('Participant disconnected:', participant.identity);
        console.log('Remaining remote participants:', newRoom.remoteParticipants.size);
        console.log('Is reconnecting:', isReconnectingRef.current);
        // Remove from remote participants map
        removeRemoteParticipant(participant.identity);

        // Update hasOtherParticipant based on remaining participants
        const stillHasParticipants = newRoom.remoteParticipants.size > 0;
        hasOtherParticipantRef.current = stillHasParticipants;
        setHasOtherParticipant(stillHasParticipants);

        // Only clear remote video track if no participants left
        if (!stillHasParticipants) {
          setRemoteVideoTrack(null);
        }

        // If all participants disconnected, wait for potential reconnection
        if (newRoom.remoteParticipants.size === 0) {
          console.log('All remote participants left, waiting for potential reconnection...');

          // Clear any existing grace period timeout
          if (participantDisconnectTimeoutRef.current) {
            clearTimeout(participantDisconnectTimeoutRef.current);
          }

          // Wait 5 seconds before ending call to allow for reconnection
          participantDisconnectTimeoutRef.current = setTimeout(() => {
            // Check again if still no participants and not reconnecting
            if (newRoom.remoteParticipants.size === 0 && !isReconnectingRef.current) {
              console.log('No participants after grace period, ending call');
              callSoundService.stopAllSounds();
              callSoundService.playEndedTone();
              newRoom.disconnect();
              clearActiveCall();
              navigateBack();
            } else {
              console.log('Participant reconnected or reconnecting, keeping call alive');
            }
          }, 5000);
        }
      });

      // Cancel grace period timeout when participant reconnects
      newRoom.on('participantConnected', (participant: any) => {
        if (participantDisconnectTimeoutRef.current) {
          console.log('Participant reconnected, cancelling disconnect timeout');
          clearTimeout(participantDisconnectTimeoutRef.current);
          participantDisconnectTimeoutRef.current = null;
        }
      });

      newRoom.on('trackSubscribed', (track: Track, publication: any, participant: any) => {
        console.log('Track subscribed:', track.kind, 'from', participant.identity);
        if (track.kind === Track.Kind.Video) {
          console.log('Setting remote video track for', participant.identity);
          // Update the participant's video track in the map
          updateRemoteParticipant(participant.identity, { videoTrack: track });
          // For backwards compatibility with 1:1 calls, also set the single track
          setRemoteVideoTrack(track);
        } else if (track.kind === Track.Kind.Audio) {
          updateRemoteParticipant(participant.identity, { audioTrack: track });
        }
      });

      newRoom.on('trackUnsubscribed', (track: Track, publication: any, participant: any) => {
        console.log('Track unsubscribed:', track.kind, 'from', participant.identity);
        if (track.kind === Track.Kind.Video) {
          updateRemoteParticipant(participant.identity, { videoTrack: null });
          // Check if there are any other video tracks
          const hasOtherVideo = Array.from(remoteParticipants.values()).some(
            p => p.id !== participant.identity && p.videoTrack
          );
          if (!hasOtherVideo) {
            setRemoteVideoTrack(null);
          }
        } else if (track.kind === Track.Kind.Audio) {
          updateRemoteParticipant(participant.identity, { audioTrack: null });
        }
      });

      // Track mute/unmute events
      newRoom.on(RoomEvent.TrackMuted, (publication: any, participant: any) => {
        if (!participant.isLocal) {
          if (publication.kind === 'audio') {
            updateRemoteParticipant(participant.identity, { isMuted: true });
          } else if (publication.kind === 'video') {
            updateRemoteParticipant(participant.identity, { isVideoEnabled: false });
          }
        }
      });

      newRoom.on(RoomEvent.TrackUnmuted, (publication: any, participant: any) => {
        if (!participant.isLocal) {
          if (publication.kind === 'audio') {
            updateRemoteParticipant(participant.identity, { isMuted: false });
          } else if (publication.kind === 'video') {
            updateRemoteParticipant(participant.identity, { isVideoEnabled: true });
          }
        }
      });

      // Track active speaker
      newRoom.on(RoomEvent.ActiveSpeakersChanged, (speakers: any[]) => {
        if (speakers.length > 0) {
          const topSpeaker = speakers[0];
          if (!topSpeaker.isLocal) {
            setActiveSpeakerId(topSpeaker.identity);
            updateRemoteParticipant(topSpeaker.identity, { isSpeaking: true });
          }
          // Mark others as not speaking
          remoteParticipants.forEach((p, id) => {
            if (!speakers.some(s => s.identity === id)) {
              updateRemoteParticipant(id, { isSpeaking: false });
            }
          });
        } else {
          setActiveSpeakerId(null);
        }
      });

      newRoom.on('disconnected', (reason?: any) => {
        console.log('Room disconnected, reason:', reason);
        // Don't call handleEndCall if we're the one who initiated the disconnect
        // Check if already terminated to prevent duplicate navigation
        if (isCallTerminatedRef.current) {
          console.log('Room disconnected but call already terminated, skipping navigation');
          return;
        }
        isCallTerminatedRef.current = true;
        // Just cleanup and navigate back
        callSoundService.stopAllSounds();
        callSoundService.playEndedTone();
        clearActiveCall();
        navigateBack();
      });

      // Connection quality monitoring
      newRoom.on(RoomEvent.ConnectionQualityChanged, (quality: ConnectionQuality, participant: any) => {
        // Only track local participant's connection quality
        if (participant.isLocal) {
          const qualityLevel = getQualityLevel(quality);
          console.log('Connection quality changed:', qualityLevel);
          setConnectionQuality(qualityLevel);

          // Show warning for poor/lost quality
          if (qualityLevel === 'poor' || qualityLevel === 'lost') {
            setShowQualityWarning(true);
            // Auto-hide warning after 5 seconds if quality improves
            if (qualityWarningTimeoutRef.current) {
              clearTimeout(qualityWarningTimeoutRef.current);
            }
            qualityWarningTimeoutRef.current = setTimeout(() => {
              setShowQualityWarning(false);
            }, 5000);
          } else {
            setShowQualityWarning(false);
          }

          // Automatically reduce video quality when connection is poor
          if (qualityLevel === 'poor' && type === 'Video' && isVideoEnabled) {
            console.log('Poor connection - reducing video quality');
            // LiveKit's adaptive streaming will handle this automatically
            // but we can also manually set preferred quality
          }
        }
      });

      // Reconnection handling
      newRoom.on(RoomEvent.Reconnecting, () => {
        console.log('Connection lost, attempting to reconnect...');
        isReconnectingRef.current = true;
        setIsReconnecting(true);
        setReconnectAttempts((prev) => prev + 1);
      });

      newRoom.on(RoomEvent.Reconnected, () => {
        console.log('Successfully reconnected!');
        isReconnectingRef.current = false;
        setIsReconnecting(false);
        setReconnectAttempts(0);
      });

      newRoom.on(RoomEvent.SignalReconnecting, () => {
        console.log('Signal connection lost, reconnecting...');
        isReconnectingRef.current = true;
        setIsReconnecting(true);
      });

      // Media device failure handling
      newRoom.on(RoomEvent.MediaDevicesError, (error: Error) => {
        console.error('Media device error:', error);
        Alert.alert(
          'Media Error',
          'There was a problem with your microphone or camera. Please check your device permissions.',
          [{ text: 'OK' }]
        );
      });

      // Listen for local track published BEFORE enabling camera
      newRoom.localParticipant.on('localTrackPublished', (publication: any) => {
        console.log('Local track published:', publication.kind, publication.track?.sid);
        if (publication.kind === 'video' && publication.track) {
          setLocalVideoTrack(publication.track);
        }
      });

      await newRoom.connect(liveKitUrl, roomToken);
      console.log('Connected to LiveKit room');

      // Check if there are already participants in the room
      // This handles the case where the other user joined before us
      if (newRoom.remoteParticipants.size > 0) {
        console.log('Found existing participants:', newRoom.remoteParticipants.size);
        hasOtherParticipantRef.current = true;
        setHasOtherParticipant(true);
        setCallStatus('connected');
        // Stop any ringing sounds since we're already connected
        callSoundService.stopAllSounds();
        // Clear the ringing timeout since participant is already here
        if (ringingTimeoutRef.current) {
          clearTimeout(ringingTimeoutRef.current);
          ringingTimeoutRef.current = null;
        }

        // Add all existing participants to the remoteParticipants map and check for video tracks
        newRoom.remoteParticipants.forEach((participant: RemoteParticipant) => {
          console.log('Adding existing participant:', participant.identity);
          // Add participant to map
          addRemoteParticipant(participant);

          // Check for existing video tracks
          participant.videoTrackPublications.forEach((publication: any) => {
            if (publication.track) {
              console.log('Found existing remote video track from', participant.identity);
              setRemoteVideoTrack(publication.track);
              // Update the participant's video track in the map
              updateRemoteParticipant(participant.identity, {
                videoTrack: publication.track,
                isVideoEnabled: true
              });
            }
          });

          // Check for existing audio tracks
          participant.audioTrackPublications.forEach((publication: any) => {
            if (publication.track) {
              console.log('Found existing remote audio track from', participant.identity);
              updateRemoteParticipant(participant.identity, {
                audioTrack: publication.track
              });
            }
          });
        });
      }

      // Enable media
      await newRoom.localParticipant.setMicrophoneEnabled(true);
      if (type === 'Video') {
        await newRoom.localParticipant.setCameraEnabled(true);
        console.log('Camera enabled');

        // Wait a bit for track to be published, then try to get it
        setTimeout(() => {
          const videoTracks = Array.from(newRoom.localParticipant.videoTrackPublications.values());
          console.log('Video track publications:', videoTracks.length);
          if (videoTracks.length > 0) {
            const pub = videoTracks[0] as any;
            if (pub.track) {
              console.log('Setting local video track from publication');
              setLocalVideoTrack(pub.track);
            }
          }
        }, 500);
      }

      setRoom(newRoom);
      setIsConnecting(false);
      setCallInitialized(true);

      // If this is an outgoing call and no participants yet, set status to ringing and start 30s timeout
      // Skip if we already found existing participants (handled above)
      if (!isIncoming && newRoom.remoteParticipants.size === 0) {
        console.log('[CallScreen] Outgoing call - setting status to ringing and playing dial tone');
        setCallStatus('ringing');
        // Play the outgoing call tone (ringback tone / dial tone)
        // Await the tone playback to ensure it starts and catch any errors
        try {
          await callSoundService.playOutgoingTone();
          console.log('[CallScreen] Outgoing tone playback initiated successfully');
        } catch (toneError) {
          console.error('[CallScreen] Failed to play outgoing tone:', toneError);
          // Continue with the call even if tone fails - don't block the call
        }
        ringingTimeoutRef.current = setTimeout(async () => {
          // Check if call was already terminated (e.g., declined)
          if (isCallTerminatedRef.current) {
            console.log('Ringing timeout skipped - call already terminated');
            return;
          }
          // Use ref instead of state to get current value (avoids stale closure issue)
          // Also double-check remoteParticipants size as a backup
          console.log('Timeout check - hasOtherParticipantRef:', hasOtherParticipantRef.current, 'remoteParticipants:', newRoom.remoteParticipants.size);
          if (!hasOtherParticipantRef.current && newRoom.remoteParticipants.size === 0) {
            console.log('Call timeout - no answer after 30 seconds');
            // Stop the dial tone first and wait for it to complete
            await callSoundService.stopAllSounds();
            console.log('Dial tone stopped after timeout');
            Alert.alert('Call Ended', 'No answer');
            handleEndCall();
          } else {
            console.log('Timeout fired but participant is connected, ignoring');
          }
        }, 30000);
      } else if (isIncoming) {
        // Incoming call - immediately connected (ringtone handled by IncomingCallScreen)
        setCallStatus('connected');
      }
      // Note: If !isIncoming && remoteParticipants.size > 0, status was already set to 'connected' above
    } catch (error: any) {
      console.error('Failed to initialize call:', error);

      // IMPORTANT: End the call on the server to prevent stale calls
      // This happens when LiveKit connection fails but the call was already created
      // Use local call variable since activeCall state may not be set yet
      const callIdToEnd = call?.id || activeCall?.id;
      if (callIdToEnd) {
        try {
          console.log('Ending failed call on server:', callIdToEnd);
          await signalr.endCall(callIdToEnd);
        } catch (endError) {
          console.error('Error ending failed call:', endError);
        }
      }

      clearActiveCall();

      // Show user-friendly error message
      const errorMessage = error?.message || '';
      let friendlyMessage = 'Call failed. Please try again.';

      if (errorMessage.includes('401') || errorMessage.includes('Network')) {
        friendlyMessage = 'Call failed. Unable to connect to call server.';
      } else if (errorMessage.includes('active call')) {
        friendlyMessage = 'Call failed. There may be an ongoing call. Please try again in a moment.';
      }

      Alert.alert('Call Failed', friendlyMessage);

      if (navigation.canGoBack()) {
        navigation.goBack();
      } else {
        navigation.reset({
          index: 0,
          routes: [{ name: 'MainTabs' as never }],
        });
      }
    }
  };

  const cleanupCall = async () => {
    if (room) {
      await room.disconnect();
    }
    clearActiveCall();
  };

  const handleEndCall = async () => {
    // Prevent multiple calls to handleEndCall
    if (isCallTerminatedRef.current) {
      console.log('handleEndCall: Call already terminated, skipping');
      return;
    }
    isCallTerminatedRef.current = true;

    console.log('[CallScreen] handleEndCall started');

    // Clear all timeouts
    if (ringingTimeoutRef.current) {
      console.log('[CallScreen] Clearing ringing timeout in handleEndCall');
      clearTimeout(ringingTimeoutRef.current);
      ringingTimeoutRef.current = null;
    }

    // Clear participant disconnect grace period timeout
    if (participantDisconnectTimeoutRef.current) {
      console.log('[CallScreen] Clearing participant disconnect timeout in handleEndCall');
      clearTimeout(participantDisconnectTimeoutRef.current);
      participantDisconnectTimeoutRef.current = null;
    }

    // Stop any playing sounds first and log it
    console.log('[CallScreen] Stopping all sounds before ending call...');
    await callSoundService.stopAllSounds();
    console.log('[CallScreen] All sounds stopped');

    try {
      if (activeCall?.id) {
        console.log('[CallScreen] Ending call via SignalR:', activeCall.id);
        await signalr.endCall(activeCall.id);
        console.log('[CallScreen] Call ended via SignalR');
      }
    } catch (error) {
      console.error('[CallScreen] Error ending call:', error);
    }

    // Play the call ended tone
    console.log('[CallScreen] Playing ended tone');
    callSoundService.playEndedTone();

    await cleanupCall();
    // Use reset instead of goBack to handle case where there's no screen to go back to
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      // Navigate to main screen if there's nothing to go back to
      navigation.reset({
        index: 0,
        routes: [{ name: 'MainTabs' as never }],
      });
    }
  };

  const toggleMute = async () => {
    if (room) {
      await room.localParticipant.setMicrophoneEnabled(isMuted);
      setIsMuted(!isMuted);
    }
  };

  const toggleVideo = async () => {
    if (room && type === 'Video') {
      await room.localParticipant.setCameraEnabled(!isVideoEnabled);
      setIsVideoEnabled(!isVideoEnabled);
    }
  };

  const toggleSpeaker = () => {
    const newSpeakerState = !isSpeakerOn;
    InCallManager.setSpeakerphoneOn(newSpeakerState);
    setIsSpeakerOn(newSpeakerState);
    setAudioRoute(newSpeakerState ? 'speaker' : 'earpiece');
  };

  // Camera flip implementation
  const flipCamera = async () => {
    if (!room || type !== 'Video' || isFlippingCamera) return;

    try {
      setIsFlippingCamera(true);

      // Get the current camera track
      const videoTrackPublications = Array.from(
        room.localParticipant.videoTrackPublications.values()
      );

      if (videoTrackPublications.length === 0) {
        console.log('No video track to flip');
        return;
      }

      const cameraPublication = videoTrackPublications.find(
        (pub) => pub.source === Track.Source.Camera
      );

      if (!cameraPublication?.track) {
        console.log('No camera track found');
        return;
      }

      const track = cameraPublication.track as LocalVideoTrack;

      // Determine the new facing mode
      const currentFacingMode = facingModeFromLocalTrack(track);
      const newFacingMode: 'user' | 'environment' = currentFacingMode?.facingMode === 'environment'
        ? 'user'
        : 'environment';

      console.log('Flipping camera from', currentFacingMode?.facingMode, 'to', newFacingMode);

      // Restart the track with the new facing mode
      await track.restartTrack({
        facingMode: newFacingMode,
      });

      setIsFrontCamera(newFacingMode === 'user');
      console.log('Camera flipped successfully');
    } catch (error) {
      console.error('Error flipping camera:', error);
      Alert.alert('Error', 'Failed to switch camera. Please try again.');
    } finally {
      setIsFlippingCamera(false);
    }
  };

  // Hold/Resume call functionality
  const toggleHold = async () => {
    if (!room) return;

    // Capture the new hold state before setting it
    const newHoldState = !isOnHold;

    try {
      if (isOnHold) {
        // Resume call
        await room.localParticipant.setMicrophoneEnabled(!isMuted);
        if (type === 'Video') {
          await room.localParticipant.setCameraEnabled(isVideoEnabled);
        }
        console.log('Call resumed');
      } else {
        // Put call on hold - mute mic and disable video
        await room.localParticipant.setMicrophoneEnabled(false);
        if (type === 'Video') {
          await room.localParticipant.setCameraEnabled(false);
        }
        console.log('Call put on hold');
      }

      // Update local state
      setIsOnHold(newHoldState);

      // Update CallKit (iOS) to show hold state in native UI
      if (activeCall?.id) {
        CallManager.setOnHold(activeCall.id, newHoldState);
      }

      // Notify the other participant via SignalR
      if (activeCall?.id) {
        await signalr.updateCallStatus(activeCall.id, { isOnHold: newHoldState });
      }
    } catch (error) {
      console.error('Error toggling hold:', error);
    }
  };

  // Cycle through audio routes (speaker -> earpiece, with bluetooth if available)
  const cycleAudioRoute = async () => {
    try {
      // Build available routes array based on what's connected
      const availableRoutes: Array<'speaker' | 'earpiece' | 'bluetooth'> = ['earpiece', 'speaker'];

      // Add bluetooth if available (detected via InCallManager events or state)
      if (isBluetoothAvailable) {
        availableRoutes.splice(1, 0, 'bluetooth'); // Insert between earpiece and speaker
      }

      // Find current route index and cycle to next
      const currentIndex = availableRoutes.indexOf(audioRoute as any);
      const nextIndex = (currentIndex + 1) % availableRoutes.length;
      const nextRoute = availableRoutes[nextIndex];

      console.log(`[CallScreen] Cycling audio route: ${audioRoute} -> ${nextRoute}`);

      switch (nextRoute) {
        case 'speaker':
          InCallManager.setSpeakerphoneOn(true);
          setIsSpeakerOn(true);
          break;
        case 'bluetooth':
          // On most devices, turning off speaker while BT is connected routes to BT
          InCallManager.setSpeakerphoneOn(false);
          setIsSpeakerOn(false);
          break;
        case 'earpiece':
          InCallManager.setSpeakerphoneOn(false);
          setIsSpeakerOn(false);
          break;
      }

      setAudioRoute(nextRoute);
    } catch (error) {
      console.error('Error cycling audio route:', error);
    }
  };

  // Get audio route icon
  const getAudioRouteIcon = (): string => {
    switch (audioRoute) {
      case 'speaker':
        return 'volume-high';
      case 'bluetooth':
        return 'bluetooth-audio';
      case 'headphones':
        return 'headphones';
      case 'earpiece':
      default:
        return 'phone';
    }
  };

  // Add participant to the call
  const handleAddParticipant = () => {
    if (!activeCall?.id) return;
    // Navigate to contact picker to add participants
    // The selected contacts will be invited to the call
    navigation.navigate('AddToCall', {
      callId: activeCall.id,
      callType: type,
      existingParticipants: [
        currentUserId,
        ...Array.from(remoteParticipants.keys()),
      ],
    });
  };

  const formatDuration = (seconds: number): string => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Toggle between grid and spotlight layout for group calls
  const toggleLayout = () => {
    setCallLayout(prev => prev === 'grid' ? 'spotlight' : 'grid');
  };

  // Prepare local participant info for grid
  const localParticipantInfo = useMemo((): RemoteParticipantInfo | undefined => {
    if (!localVideoTrack && !isVideoEnabled) return undefined;
    const userInfo = getParticipantInfo(currentUserId);
    return {
      id: currentUserId,
      name: 'You',
      profilePictureUrl: userInfo.profilePictureUrl,
      videoTrack: localVideoTrack,
      audioTrack: null,
      isMuted,
      isVideoEnabled,
      isSpeaking: false,
      isLocal: true,
    };
  }, [localVideoTrack, isMuted, isVideoEnabled, currentUserId, getParticipantInfo]);

  const renderVideoCall = () => {
    const showLocalVideoFullscreen = !remoteVideoTrack && localVideoTrack && isVideoEnabled;
    const hasMultipleParticipants = remoteParticipantsArray.length > 1;

    console.log('renderVideoCall - localVideoTrack:', !!localVideoTrack, 'remoteVideoTrack:', !!remoteVideoTrack, 'isVideoEnabled:', isVideoEnabled, 'participants:', remoteParticipantsArray.length);

    // Use group call grid for multiple participants
    if (hasMultipleParticipants || (isGroupCall && remoteParticipantsArray.length > 0)) {
      return (
        <View style={styles.videoContainer}>
          <GroupCallGrid
            participants={remoteParticipantsArray}
            localParticipant={localParticipantInfo}
            activeSpeakerId={activeSpeakerId || undefined}
            layout={callLayout}
          />

          {/* Call duration overlay */}
          {callStatus === 'connected' && hasOtherParticipant && (
            <View style={styles.durationOverlay}>
              <View style={styles.durationBadge}>
                <View style={styles.recordingDot} />
                <Text style={styles.durationText}>{formatDuration(callDuration)}</Text>
              </View>
            </View>
          )}

          {/* Layout toggle button for group calls */}
          <TouchableOpacity style={styles.layoutToggleButton} onPress={toggleLayout}>
            <Icon
              name={callLayout === 'grid' ? 'view-grid' : 'spotlight-beam'}
              size={24}
              color={colors.textInverse}
            />
          </TouchableOpacity>

          {/* Participant count badge */}
          <View style={styles.participantCountBadge}>
            <Icon name="account-group" size={16} color={colors.textInverse} />
            <Text style={styles.participantCountText}>
              {remoteParticipantsArray.length + 1}
            </Text>
          </View>
        </View>
      );
    }

    // Original 1:1 call rendering
    return (
      <View style={styles.videoContainer}>
        {/* Remote video (full screen) or placeholder */}
        {remoteVideoTrack ? (
          <VideoView
            style={styles.remoteVideo}
            videoTrack={remoteVideoTrack as any}
            objectFit="cover"
          />
        ) : (
          <View style={styles.remoteVideoPlaceholder}>
            {showLocalVideoFullscreen ? (
              // Show local video fullscreen while waiting for remote participant
              <VideoView
                style={styles.remoteVideo}
                videoTrack={localVideoTrack as any}
                objectFit="cover"
                mirror
              />
            ) : null}
            <View style={[styles.waitingOverlay, showLocalVideoFullscreen && styles.waitingOverlayTransparent]}>
              <Avatar
                uri={otherParticipant?.profilePictureUrl}
                name={otherParticipant?.displayName || otherParticipant?.fullName || ''}
                size={100}
              />
              <Text style={styles.callerName}>
                {isGroupCall ? conversation?.name : (otherParticipant?.displayName || otherParticipant?.fullName)}
              </Text>
              <Text style={styles.callStatus}>
                {getCallStatusText()}
              </Text>
            </View>
          </View>
        )}

        {/* Call duration overlay when connected */}
        {callStatus === 'connected' && hasOtherParticipant && (
          <View style={styles.durationOverlay}>
            <View style={styles.durationBadge}>
              <View style={styles.recordingDot} />
              <Text style={styles.durationText}>{formatDuration(callDuration)}</Text>
            </View>
          </View>
        )}

        {/* Local video PiP (Picture-in-Picture) - WhatsApp style */}
        {localVideoTrack && isVideoEnabled && remoteVideoTrack && (
          <View style={styles.localVideoContainer}>
            <VideoView
              style={styles.localVideo}
              videoTrack={localVideoTrack as any}
              objectFit="cover"
              mirror
            />
            <TouchableOpacity style={styles.flipButton} onPress={flipCamera}>
              <Icon name="camera-flip" size={20} color={colors.textInverse} />
            </TouchableOpacity>
          </View>
        )}

        {/* Local video PiP when no remote video yet */}
        {localVideoTrack && isVideoEnabled && !remoteVideoTrack && !showLocalVideoFullscreen && (
          <View style={styles.localVideoContainer}>
            <VideoView
              style={styles.localVideo}
              videoTrack={localVideoTrack as any}
              objectFit="cover"
              mirror
            />
            <TouchableOpacity style={styles.flipButton} onPress={flipCamera}>
              <Icon name="camera-flip" size={20} color={colors.textInverse} />
            </TouchableOpacity>
          </View>
        )}

        {/* Flip camera button when local video is fullscreen */}
        {showLocalVideoFullscreen && (
          <TouchableOpacity style={styles.flipButtonFullscreen} onPress={flipCamera}>
            <Icon name="camera-flip" size={24} color={colors.textInverse} />
          </TouchableOpacity>
        )}

        {/* Remote participant info badge when connected */}
        {remoteVideoTrack && (
          <View style={styles.remoteInfoBadge}>
            <Avatar
              uri={otherParticipant?.profilePictureUrl}
              name={otherParticipant?.displayName || otherParticipant?.fullName || ''}
              size={32}
            />
            <Text style={styles.remoteInfoName} numberOfLines={1}>
              {otherParticipant?.displayName || otherParticipant?.fullName}
            </Text>
          </View>
        )}
      </View>
    );
  };

  const getCallStatusText = () => {
    if (isReconnecting) return 'Reconnecting...';
    if (isConnecting) return 'Calling...';
    if (callStatus === 'calling') return 'Calling...';
    if (callStatus === 'ringing') return 'Ringing...';
    if (callStatus === 'connected') return formatDuration(callDuration);
    return 'Connecting...';
  };

  const renderVoiceCall = () => {
    // For group voice calls, show participant avatars in a scrollable row
    if (isGroupCall) {
      return (
        <View style={styles.voiceContainer}>
          {/* Group icon/name at top */}
          <Avatar
            uri={conversation?.iconUrl}
            name={conversation?.name || 'Group'}
            size={100}
          />
          <Text style={styles.callerName}>
            {conversation?.name || 'Group Call'}
          </Text>
          <Text style={styles.callStatus}>
            {getCallStatusText()}
          </Text>

          {/* Connected participants */}
          {remoteParticipantsArray.length > 0 && (
            <View style={styles.voiceParticipantsContainer}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.voiceParticipantsList}
              >
                {remoteParticipantsArray.map((participant) => (
                  <View key={participant.id} style={styles.voiceParticipantItem}>
                    <Avatar
                      uri={participant.profilePictureUrl}
                      name={participant.name}
                      size={60}
                    />
                    {participant.isSpeaking && (
                      <View style={styles.speakingIndicatorSmall}>
                        <Icon name="volume-high" size={12} color={colors.success} />
                      </View>
                    )}
                    {participant.isMuted && (
                      <View style={styles.mutedIndicatorSmall}>
                        <Icon name="microphone-off" size={12} color={colors.error} />
                      </View>
                    )}
                    <Text style={styles.voiceParticipantName} numberOfLines={1}>
                      {participant.name}
                    </Text>
                  </View>
                ))}
              </ScrollView>
            </View>
          )}

          {/* Participant count */}
          <View style={styles.voiceParticipantCount}>
            <Icon name="account-group" size={20} color={colors.textInverse} />
            <Text style={styles.voiceParticipantCountText}>
              {remoteParticipantsArray.length + 1} participants
            </Text>
          </View>
        </View>
      );
    }

    // Original 1:1 voice call
    return (
      <View style={styles.voiceContainer}>
        <Avatar
          uri={otherParticipant?.profilePictureUrl}
          name={otherParticipant?.displayName || otherParticipant?.fullName || ''}
          size={150}
        />
        <Text style={styles.callerName}>
          {otherParticipant?.displayName || otherParticipant?.fullName}
        </Text>
        <Text style={styles.callStatus}>
          {getCallStatusText()}
        </Text>
      </View>
    );
  };

  // Render connection quality indicator
  const renderConnectionQuality = () => (
    <View style={styles.qualityIndicator}>
      <Icon
        name={getQualityIcon(connectionQuality)}
        size={20}
        color={getQualityColor(connectionQuality)}
      />
    </View>
  );

  // Render reconnecting banner
  const renderReconnectingBanner = () => {
    if (!isReconnecting) return null;

    return (
      <View style={styles.reconnectingBanner}>
        <Icon name="wifi-off" size={18} color={colors.textInverse} />
        <Text style={styles.reconnectingText}>
          Connection lost. Reconnecting{reconnectAttempts > 1 ? ` (attempt ${reconnectAttempts})` : ''}...
        </Text>
      </View>
    );
  };

  // Render quality warning banner
  const renderQualityWarning = () => {
    if (!showQualityWarning || isReconnecting) return null;

    return (
      <View style={styles.qualityWarningBanner}>
        <Icon name="signal-cellular-1" size={18} color={colors.textInverse} />
        <Text style={styles.qualityWarningText}>
          {connectionQuality === 'lost'
            ? 'Connection lost'
            : 'Poor network connection - quality may be reduced'}
        </Text>
      </View>
    );
  };

  // Render hold banner (for local hold)
  const renderHoldBanner = () => {
    if (!isOnHold) return null;

    return (
      <View style={styles.holdBanner}>
        <Icon name="pause-circle" size={18} color={colors.textInverse} />
        <Text style={styles.holdBannerText}>Call on hold</Text>
        <TouchableOpacity style={styles.resumeButton} onPress={toggleHold}>
          <Text style={styles.resumeButtonText}>Resume</Text>
        </TouchableOpacity>
      </View>
    );
  };

  // Render remote hold banner (when other participant has put call on hold)
  const renderRemoteHoldBanner = () => {
    if (!remoteIsOnHold || isOnHold) return null; // Don't show if local is also on hold

    return (
      <View style={styles.remoteHoldBanner}>
        <Icon name="pause-circle-outline" size={18} color={colors.warning} />
        <Text style={styles.remoteHoldBannerText}>
          {otherParticipant?.displayName || otherParticipant?.fullName || 'Other participant'} put the call on hold
        </Text>
      </View>
    );
  };

  // Render encryption indicator
  const renderEncryptionIndicator = () => {
    if (!isEncrypted || callStatus !== 'connected') return null;

    return (
      <View style={styles.encryptionIndicator}>
        <Icon name="lock" size={14} color="#4CAF50" />
        <Text style={styles.encryptionText}>Encrypted</Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={colors.surface} />

      {/* Reconnecting banner at top */}
      {renderReconnectingBanner()}

      {/* Quality warning banner */}
      {renderQualityWarning()}

      {/* Hold banner (local) */}
      {renderHoldBanner()}

      {/* Remote hold banner (when other participant is on hold) */}
      {renderRemoteHoldBanner()}

      {type === 'Video' ? renderVideoCall() : renderVoiceCall()}

      {/* Connection quality indicator */}
      {callStatus === 'connected' && !isReconnecting && renderConnectionQuality()}

      {/* Encryption indicator */}
      {renderEncryptionIndicator()}

      <View style={styles.controls}>
        {/* Top row - main controls */}
        <View style={styles.controlButtons}>
          <TouchableOpacity
            style={[styles.controlButton, isMuted && styles.controlButtonActive]}
            onPress={toggleMute}
            disabled={isOnHold}
          >
            <Icon
              name={isMuted ? 'microphone-off' : 'microphone'}
              size={28}
              color={isMuted ? '#1a1a2e' : '#FFFFFF'}
            />
          </TouchableOpacity>

          {type === 'Video' && (
            <TouchableOpacity
              style={[styles.controlButton, !isVideoEnabled && styles.controlButtonActive]}
              onPress={toggleVideo}
              disabled={isOnHold}
            >
              <Icon
                name={isVideoEnabled ? 'video' : 'video-off'}
                size={28}
                color={!isVideoEnabled ? '#1a1a2e' : '#FFFFFF'}
              />
            </TouchableOpacity>
          )}

          {/* Audio route button - cycles through speaker/bluetooth/earpiece */}
          <TouchableOpacity
            style={[styles.controlButton, audioRoute === 'speaker' && styles.controlButtonActive]}
            onPress={cycleAudioRoute}
            onLongPress={toggleSpeaker}
          >
            <Icon
              name={getAudioRouteIcon()}
              size={28}
              color={audioRoute === 'speaker' ? '#1a1a2e' : '#FFFFFF'}
            />
            {audioRoute === 'bluetooth' && (
              <View style={styles.bluetoothBadge}>
                <Icon name="bluetooth" size={10} color="#FFFFFF" />
              </View>
            )}
          </TouchableOpacity>

          {/* Hold/Resume button - only show when call is connected */}
          {callStatus === 'connected' && (
            <TouchableOpacity
              style={[styles.controlButton, isOnHold && styles.controlButtonHold]}
              onPress={toggleHold}
            >
              <Icon
                name={isOnHold ? 'play' : 'pause'}
                size={28}
                color={isOnHold ? '#1a1a2e' : '#FFFFFF'}
              />
            </TouchableOpacity>
          )}

          {/* Add participant button - only show when call is connected */}
          {callStatus === 'connected' && (
            <TouchableOpacity
              style={styles.controlButton}
              onPress={handleAddParticipant}
            >
              <Icon name="account-plus" size={28} color="#FFFFFF" />
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity style={styles.endCallButton} onPress={handleEndCall}>
          <Icon name="phone-hangup" size={32} color="#FFFFFF" />
        </TouchableOpacity>
      </View>
    </View>
  );
};

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  videoContainer: {
    flex: 1,
  },
  remoteVideo: {
    flex: 1,
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
  },
  remoteVideoPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  waitingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  waitingOverlayTransparent: {
    backgroundColor: colors.overlay,
  },
  durationOverlay: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 20,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  durationBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.overlay,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.error,
    marginRight: 8,
  },
  durationText: {
    fontSize: FONTS.sizes.sm,
    color: colors.textInverse,
    fontWeight: '600',
  },
  localVideoContainer: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 100 : 60,
    right: 16,
    width: 120,
    height: 160,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: colors.background,
    elevation: 8,
    shadowColor: colors.text,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    borderWidth: 2,
    borderColor: colors.border,
  },
  localVideo: {
    width: 120,
    height: 160,
  },
  flipButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
  },
  flipButtonFullscreen: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 20,
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
  },
  remoteInfoBadge: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.overlay,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    maxWidth: SCREEN_WIDTH * 0.6,
  },
  remoteInfoName: {
    fontSize: FONTS.sizes.sm,
    color: colors.textInverse,
    fontWeight: '500',
    marginLeft: 8,
  },
  voiceContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  callerName: {
    fontSize: FONTS.sizes.xxl,
    fontWeight: 'bold',
    color: colors.text,
    marginTop: SPACING.lg,
  },
  callStatus: {
    fontSize: FONTS.sizes.lg,
    color: colors.textSecondary,
    opacity: 0.8,
    marginTop: SPACING.sm,
  },
  controls: {
    paddingHorizontal: SPACING.xl,
    paddingBottom: Platform.OS === 'ios' ? 50 : SPACING.xl,
    paddingTop: SPACING.lg,
    backgroundColor: colors.overlayLight,
  },
  duration: {
    fontSize: FONTS.sizes.md,
    color: colors.textInverse,
    textAlign: 'center',
    marginBottom: SPACING.lg,
  },
  controlButtons: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: SPACING.xl,
    marginBottom: SPACING.xl,
  },
  controlButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.overlayLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  controlButtonActive: {
    backgroundColor: colors.surface,
  },
  endCallButton: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: colors.callDecline,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
  },
  // Connection quality indicator
  qualityIndicator: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 20,
    right: 16,
    backgroundColor: colors.overlay,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 12,
  },
  // Group call styles
  layoutToggleButton: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 20,
    left: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
  },
  participantCountBadge: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 20,
    right: 70,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.overlay,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
  },
  participantCountText: {
    color: colors.textInverse,
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
    marginLeft: 6,
  },
  // Voice call group styles
  voiceParticipantsContainer: {
    marginTop: SPACING.xl,
    width: '100%',
  },
  voiceParticipantsList: {
    paddingHorizontal: SPACING.md,
  },
  voiceParticipantItem: {
    alignItems: 'center',
    marginHorizontal: SPACING.sm,
    width: 80,
  },
  voiceParticipantName: {
    color: colors.text,
    fontSize: FONTS.sizes.xs,
    marginTop: 4,
    textAlign: 'center',
  },
  speakingIndicatorSmall: {
    position: 'absolute',
    top: 0,
    right: 0,
    backgroundColor: 'rgba(76, 175, 80, 0.3)',
    borderRadius: 10,
    padding: 2,
  },
  mutedIndicatorSmall: {
    position: 'absolute',
    bottom: 20,
    right: 0,
    backgroundColor: 'rgba(255, 82, 82, 0.3)',
    borderRadius: 10,
    padding: 2,
  },
  voiceParticipantCount: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: SPACING.xl,
  },
  voiceParticipantCountText: {
    color: colors.text,
    fontSize: FONTS.sizes.md,
    marginLeft: 8,
    opacity: 0.8,
  },
  // Reconnecting banner
  reconnectingBanner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.error,
    paddingVertical: 8,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
    paddingTop: Platform.OS === 'ios' ? 50 : 8,
  },
  reconnectingText: {
    color: colors.textInverse,
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
    marginLeft: 8,
  },
  // Quality warning banner
  qualityWarningBanner: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 0,
    left: 0,
    right: 0,
    backgroundColor: colors.warning,
    paddingVertical: 6,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 99,
  },
  qualityWarningText: {
    color: colors.textInverse,
    fontSize: FONTS.sizes.xs,
    fontWeight: '500',
    marginLeft: 8,
  },
  // Hold banner styles
  holdBanner: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 100 : 50,
    left: 0,
    right: 0,
    backgroundColor: colors.warning,
    paddingVertical: 10,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 98,
  },
  holdBannerText: {
    color: colors.textInverse,
    fontSize: FONTS.sizes.md,
    fontWeight: '600',
    marginLeft: 8,
    flex: 1,
  },
  resumeButton: {
    backgroundColor: colors.overlayLight,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 16,
  },
  resumeButtonText: {
    color: colors.textInverse,
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
  },
  // Remote hold banner (when other participant is on hold)
  remoteHoldBanner: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 150 : 100,
    left: 0,
    right: 0,
    backgroundColor: colors.surfaceSecondary,
    paddingVertical: 10,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  remoteHoldBannerText: {
    color: colors.warning,
    fontSize: FONTS.sizes.sm,
    fontWeight: '500',
    marginLeft: 8,
    textAlign: 'center',
  },
  // Hold control button style
  controlButtonHold: {
    backgroundColor: colors.warning,
  },
  // Bluetooth badge
  bluetoothBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    backgroundColor: colors.info,
    width: 16,
    height: 16,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Encryption indicator
  encryptionIndicator: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 200 : 180,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.overlay,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  encryptionText: {
    color: colors.success,
    fontSize: FONTS.sizes.xs,
    fontWeight: '500',
    marginLeft: 4,
  },
});

export default CallScreen;
