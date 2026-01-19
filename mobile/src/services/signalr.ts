import {
  HubConnectionBuilder,
  HubConnection,
  HubConnectionState,
  LogLevel,
} from '@microsoft/signalr';
import { Platform } from 'react-native';
import { useChatStore } from '../stores/chatStore';
import { useCallStore } from '../stores/callStore';
import { useAuthStore } from '../stores/authStore';
import { Message, Call, MessageReaction, DeleteType } from '../types';
import { AppConfig } from '../config';
import { callSoundService } from './CallSoundService';
import { NativeCallSound } from './NativeCallSound';
import { endNativeCall } from './NativeCallEvent';
import { CallManager } from './CallManager';
import { guidsEqual } from '../utils/guid';

// SignalR URL is now centralized in AppConfig
const API_URL = AppConfig.signalRUrl;

let chatConnection: HubConnection | null = null;
let callConnection: HubConnection | null = null;
let presenceConnection: HubConnection | null = null;

// Track typing timeouts per user to properly reset them
const typingTimeouts: Map<string, NodeJS.Timeout> = new Map();

// Check if a connection is in a connected or connecting state
const isConnectionActive = (connection: HubConnection | null): boolean => {
  if (!connection) return false;
  return connection.state === HubConnectionState.Connected ||
         connection.state === HubConnectionState.Connecting ||
         connection.state === HubConnectionState.Reconnecting;
};

export const initializeSignalR = async (accessToken: string): Promise<void> => {
  // Skip if all connections are already active
  if (isConnectionActive(chatConnection) &&
      isConnectionActive(callConnection) &&
      isConnectionActive(presenceConnection)) {
    console.log('SignalR connections already active, skipping reinitialization');
    return;
  }

  // Clean up existing connections before reinitializing
  await disconnectSignalR();

  // Initialize connections sequentially to avoid race conditions
  try {
    await initializeChatHub(accessToken);
  } catch (error) {
    console.error('Failed to initialize chat hub:', error);
  }

  try {
    await initializeCallHub(accessToken);
  } catch (error) {
    console.error('Failed to initialize call hub:', error);
  }

  try {
    await initializePresenceHub(accessToken);
  } catch (error) {
    console.error('Failed to initialize presence hub:', error);
  }
};

export const disconnectSignalR = async (): Promise<void> => {
  await Promise.all([
    chatConnection?.stop(),
    callConnection?.stop(),
    presenceConnection?.stop(),
  ]);
  chatConnection = null;
  callConnection = null;
  presenceConnection = null;
};

// Chat Hub
const initializeChatHub = async (accessToken: string): Promise<void> => {
  chatConnection = new HubConnectionBuilder()
    .withUrl(`${API_URL}/hubs/chat`, {
      accessTokenFactory: () => accessToken,
    })
    .withAutomaticReconnect()
    .configureLogging(LogLevel.Information)
    .build();

  // Connection lifecycle events
  chatConnection.onclose((error) => {
    console.log('=== CHAT HUB CONNECTION CLOSED ===');
    console.log('Error:', error?.message || 'No error message');
  });

  chatConnection.onreconnecting((error) => {
    console.log('=== CHAT HUB RECONNECTING ===');
    console.log('Error:', error?.message || 'No error message');
  });

  chatConnection.onreconnected((connectionId) => {
    console.log('=== CHAT HUB RECONNECTED ===');
    console.log('New connection ID:', connectionId);
  });

  // Event handlers
  chatConnection.on('ReceiveMessage', async (message: Message) => {
    try {
      // TODO: Decrypt the message content when proper E2E encryption is implemented
      // For now, messages are sent in plain text
      const chatStore = useChatStore.getState();
      const currentUserId = useAuthStore.getState().userId;

      console.log('ReceiveMessage - senderId:', message.senderId, 'currentUserId:', currentUserId, 'activeConv:', chatStore.activeConversationId, 'messageConv:', message.conversationId);

      // Populate replyToMessage from local messages if not included by server
      if (message.replyToMessageId && !message.replyToMessage) {
        const conversationMessages = chatStore.messages[message.conversationId] || [];
        const replyToMsg = conversationMessages.find(m => m.id === message.replyToMessageId);
        if (replyToMsg) {
          message.replyToMessage = replyToMsg;
        }
      }

      chatStore.addMessage(message.conversationId, message);

      // Increment unread count if message is not from current user
      // and user is not viewing this conversation
      if (message.senderId !== currentUserId &&
          chatStore.activeConversationId !== message.conversationId) {
        console.log('Incrementing unread count for conversation:', message.conversationId);
        chatStore.incrementUnreadCount(message.conversationId);
      } else {
        console.log('Not incrementing unread: isOwnMessage=', message.senderId === currentUserId, 'isActiveConv=', chatStore.activeConversationId === message.conversationId);
      }
    } catch (error) {
      console.error('Error processing received message:', error);
      useChatStore.getState().addMessage(message.conversationId, message);
    }
  });

  chatConnection.on('MessageDelivered', (messageId: string, userId: string, timestamp: string) => {
    const { messages, conversations } = useChatStore.getState();
    Object.keys(messages).forEach((convId) => {
      const msg = messages[convId].find((m) => m.id === messageId);
      if (msg) {
        const updatedStatuses = msg.statuses.map((s) =>
          s.userId === userId ? { ...s, status: 'Delivered' as const, deliveredAt: timestamp } : s
        );
        useChatStore.getState().updateMessage(convId, messageId, {
          statuses: updatedStatuses,
        });

        // Also update the conversation's lastMessage if this is the last message
        const conversation = conversations.find((c) => c.id === convId);
        if (conversation?.lastMessage?.id === messageId) {
          useChatStore.getState().updateConversation(convId, {
            lastMessage: { ...conversation.lastMessage, statuses: updatedStatuses },
          });
        }
      }
    });
  });

  chatConnection.on('MessageRead', (messageId: string, userId: string, timestamp: string) => {
    const { messages, conversations } = useChatStore.getState();
    Object.keys(messages).forEach((convId) => {
      const msg = messages[convId].find((m) => m.id === messageId);
      if (msg) {
        const updatedStatuses = msg.statuses.map((s) =>
          s.userId === userId ? { ...s, status: 'Read' as const, readAt: timestamp } : s
        );
        useChatStore.getState().updateMessage(convId, messageId, {
          statuses: updatedStatuses,
        });

        // Also update the conversation's lastMessage if this is the last message
        const conversation = conversations.find((c) => c.id === convId);
        if (conversation?.lastMessage?.id === messageId) {
          useChatStore.getState().updateConversation(convId, {
            lastMessage: { ...conversation.lastMessage, statuses: updatedStatuses },
          });
        }
      }
    });
  });

  chatConnection.on('MessageDeleted', (messageId: string, userId: string) => {
    const { messages } = useChatStore.getState();
    Object.keys(messages).forEach((convId) => {
      useChatStore.getState().deleteMessage(convId, messageId);
    });
  });

  chatConnection.on('MessageEdited', (message: Message) => {
    useChatStore.getState().updateMessage(message.conversationId, message.id, message);
  });

  chatConnection.on('UserTyping', (conversationId: string, userId: string) => {
    console.log('=== USER TYPING EVENT RECEIVED ===');
    console.log('Conversation ID:', conversationId);
    console.log('User ID:', userId);
    useChatStore.getState().setUserTyping(conversationId, userId);
    console.log('Typing users after set:', useChatStore.getState().typingUsers);

    // Create a unique key for this user's typing timeout
    const timeoutKey = `${conversationId}-${userId}`;

    // Clear existing timeout if any (reset the timer)
    const existingTimeout = typingTimeouts.get(timeoutKey);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Auto-remove after 4 seconds (slightly longer than send interval to account for network delay)
    const newTimeout = setTimeout(() => {
      useChatStore.getState().removeUserTyping(conversationId, userId);
      typingTimeouts.delete(timeoutKey);
    }, 4000);
    typingTimeouts.set(timeoutKey, newTimeout);
  });

  chatConnection.on('UserStopTyping', (conversationId: string, userId: string) => {
    console.log('=== USER STOP TYPING EVENT RECEIVED ===');
    console.log('Conversation ID:', conversationId);
    console.log('User ID:', userId);

    // Clear the typing timeout for this user
    const timeoutKey = `${conversationId}-${userId}`;
    const existingTimeout = typingTimeouts.get(timeoutKey);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      typingTimeouts.delete(timeoutKey);
    }

    useChatStore.getState().removeUserTyping(conversationId, userId);
  });

  chatConnection.on('UserOnline', (userId: string) => {
    useChatStore.getState().setUserOnline(userId);
  });

  chatConnection.on('UserOffline', (userId: string, lastSeen: string) => {
    useChatStore.getState().setUserOffline(userId);
  });

  chatConnection.on('MessageError', (error: string) => {
    console.error('Message error:', error);
  });

  // Push-to-Talk (PTT) event handlers
  chatConnection.on('PTTStarted', (conversationId: string, userId: string, userName: string) => {
    console.log(`PTT: ${userName} started speaking in conversation ${conversationId}`);
    useChatStore.getState().setPTTActive(conversationId, userId, userName);
  });

  chatConnection.on('PTTChunk', (conversationId: string, userId: string, audioChunkBase64: string) => {
    // Handle incoming audio chunk for real-time playback
    // This will be processed by the PTT player component
    useChatStore.getState().addPTTChunk(conversationId, userId, audioChunkBase64);
  });

  chatConnection.on('PTTEnded', (conversationId: string, userId: string, mediaUrl: string | null, duration: number) => {
    console.log(`PTT: User ${userId} ended speaking in conversation ${conversationId}, duration: ${duration}ms`);
    useChatStore.getState().clearPTTActive(conversationId, userId);
  });

  chatConnection.on('PTTCancelled', (conversationId: string, userId: string) => {
    console.log(`PTT: User ${userId} cancelled PTT in conversation ${conversationId}`);
    useChatStore.getState().clearPTTActive(conversationId, userId);
  });

  chatConnection.on('ConversationRead', (conversationId: string, userId: string, timestamp: string) => {
    // Update the unread count for the conversation
    useChatStore.getState().updateConversation(conversationId, { unreadCount: 0 });

    // Mark all messages in this conversation as read by this user
    const { messages, conversations } = useChatStore.getState();
    const conversationMessages = messages[conversationId] || [];
    const conversation = conversations.find((c) => c.id === conversationId);

    conversationMessages.forEach((msg) => {
      if (msg.statuses) {
        const updatedStatuses = msg.statuses.map((s) =>
          s.userId === userId ? { ...s, status: 'Read' as const, readAt: timestamp } : s
        );
        useChatStore.getState().updateMessage(conversationId, msg.id, {
          statuses: updatedStatuses,
        });

        // Also update the conversation's lastMessage if this is the last message
        if (conversation?.lastMessage?.id === msg.id) {
          useChatStore.getState().updateConversation(conversationId, {
            lastMessage: { ...conversation.lastMessage, statuses: updatedStatuses },
          });
        }
      }
    });
  });

  // Forward message events
  chatConnection.on('MessageForwarded', (originalMessageId: string, toConversationId: string, newMessageId: string) => {
    console.log(`Message ${originalMessageId} forwarded to ${toConversationId} as ${newMessageId}`);
  });

  chatConnection.on('MessagesForwarded', (originalMessageId: string, count: number) => {
    console.log(`Message ${originalMessageId} forwarded to ${count} conversations`);
  });

  chatConnection.on('ForwardError', (error: string) => {
    console.error('Forward error:', error);
  });

  // Reaction events
  chatConnection.on('ReactionAdded', (messageId: string, reaction: MessageReaction) => {
    const { messages } = useChatStore.getState();
    Object.keys(messages).forEach((convId) => {
      const msg = messages[convId].find((m) => m.id === messageId);
      if (msg) {
        const existingReactions = msg.reactions || [];
        useChatStore.getState().updateMessage(convId, messageId, {
          reactions: [...existingReactions, reaction],
        });
      }
    });
  });

  chatConnection.on('ReactionRemoved', (messageId: string, userId: string, emoji: string) => {
    const { messages } = useChatStore.getState();
    Object.keys(messages).forEach((convId) => {
      const msg = messages[convId].find((m) => m.id === messageId);
      if (msg && msg.reactions) {
        useChatStore.getState().updateMessage(convId, messageId, {
          reactions: msg.reactions.filter((r) => !(r.userId === userId && r.emoji === emoji)),
        });
      }
    });
  });

  chatConnection.on('ReactionError', (error: string) => {
    console.error('Reaction error:', error);
  });

  // Star/Bookmark events
  chatConnection.on('MessageStarred', (messageId: string, starredAt: string) => {
    console.log(`Message ${messageId} starred at ${starredAt}`);
  });

  chatConnection.on('MessageUnstarred', (messageId: string) => {
    console.log(`Message ${messageId} unstarred`);
  });

  chatConnection.on('StarError', (error: string) => {
    console.error('Star error:', error);
  });

  // Pin events
  chatConnection.on('MessagePinned', (pinnedMessage: any) => {
    console.log(`Message ${pinnedMessage.messageId} pinned in conversation ${pinnedMessage.conversationId}`);
  });

  chatConnection.on('MessageUnpinned', (conversationId: string, messageId: string, userId: string) => {
    console.log(`Message ${messageId} unpinned from conversation ${conversationId}`);
  });

  chatConnection.on('PinError', (error: string) => {
    console.error('Pin error:', error);
  });

  // Delete with audit events
  chatConnection.on('DeleteError', (error: string) => {
    console.error('Delete error:', error);
  });

  try {
    await chatConnection.start();
    console.log('Chat hub connected');
  } catch (error) {
    console.error('Error connecting to chat hub:', error);
  }
};

// Call Hub
const initializeCallHub = async (accessToken: string): Promise<void> => {
  callConnection = new HubConnectionBuilder()
    .withUrl(`${API_URL}/hubs/call`, {
      accessTokenFactory: () => accessToken,
    })
    .withAutomaticReconnect()
    .configureLogging(LogLevel.Information)
    .build();

  // Connection lifecycle events
  callConnection.onclose((error) => {
    console.log('=== CALL HUB CONNECTION CLOSED ===');
    console.log('Error:', error?.message || 'No error message');
  });

  callConnection.onreconnecting((error) => {
    console.log('=== CALL HUB RECONNECTING ===');
    console.log('Error:', error?.message || 'No error message');
  });

  callConnection.onreconnected((connectionId) => {
    console.log('=== CALL HUB RECONNECTED ===');
    console.log('New connection ID:', connectionId);
  });

  callConnection.on('IncomingCall', (call: Call) => {
    console.log('=== INCOMING CALL RECEIVED ===');
    console.log('Call ID:', call.id);
    console.log('Initiator:', call.initiatorId, call.initiatorName);
    console.log('Type:', call.type);
    console.log('Conversation:', call.conversationId);
    console.log('Full call object:', JSON.stringify(call, null, 2));

    const callStore = useCallStore.getState();

    // Check if user is already on a call (call waiting scenario)
    if (callStore.activeCall) {
      console.log('=== CALL WAITING: User is already on a call ===');
      // For now, we'll set it as incoming call which will show a smaller notification
      // The UI can decide how to display call waiting
      callStore.setIncomingCall(call);
    } else {
      callStore.setIncomingCall(call);
    }
    console.log('Call set in store');
  });

  // Handle missed call event
  callConnection.on('CallMissed', (callId: string, callerId: string, callerName: string, callType: 'Voice' | 'Video', conversationId: string) => {
    console.log('=== CALL MISSED EVENT RECEIVED ===');
    console.log('Call ID:', callId);
    console.log('Caller:', callerName);
    console.log('Type:', callType);
    console.log('Platform:', Platform.OS);

    // Add missed call message to the conversation
    useChatStore.getState().addMissedCallMessage(
      conversationId,
      callerId,
      callerName,
      callType
    );

    // Clear any pending incoming call state
    const { incomingCall } = useCallStore.getState();
    if (guidsEqual(incomingCall?.id, callId) || incomingCall) {
      callSoundService.stopAllSounds();
      NativeCallSound.stopRingtone();
      // End native call UI on both platforms
      if (Platform.OS === 'ios') {
        console.log('Ending iOS CallKit call for missed call:', callId);
        CallManager.endCall(callId);
        if (incomingCall?.id) {
          CallManager.endCall(incomingCall.id);
        }
      } else {
        endNativeCall(callId);
      }
      useCallStore.getState().setIncomingCall(null);
    }
  });

  // Handle busy call event (when user is on another call and caller times out)
  callConnection.on('CallBusy', (callId: string, callerId: string, callerName: string, callType: 'Voice' | 'Video', conversationId: string) => {
    console.log('=== CALL BUSY EVENT RECEIVED ===');
    console.log('Call ID:', callId);
    console.log('Caller was busy:', callerName);
    console.log('Platform:', Platform.OS);

    // Add missed call message since user was busy
    useChatStore.getState().addMissedCallMessage(
      conversationId,
      callerId,
      callerName,
      callType
    );

    // Clear any pending incoming call state
    const { incomingCall } = useCallStore.getState();
    if (guidsEqual(incomingCall?.id, callId) || incomingCall) {
      callSoundService.stopAllSounds();
      NativeCallSound.stopRingtone();
      // End native call UI on both platforms
      if (Platform.OS === 'ios') {
        console.log('Ending iOS CallKit call for busy call:', callId);
        CallManager.endCall(callId);
        if (incomingCall?.id) {
          CallManager.endCall(incomingCall.id);
        }
      } else {
        endNativeCall(callId);
      }
      useCallStore.getState().setIncomingCall(null);
    }
  });

  callConnection.on('UserJoinedCall', (callId: string, participant: any) => {
    const { activeCall } = useCallStore.getState();
    if (activeCall && guidsEqual(activeCall.id, callId)) {
      useCallStore.getState().setActiveCall({
        ...activeCall,
        participants: [...activeCall.participants, participant],
      });
    }
  });

  callConnection.on('UserLeftCall', (callId: string, userId: string) => {
    const { activeCall } = useCallStore.getState();
    if (activeCall && guidsEqual(activeCall.id, callId)) {
      useCallStore.getState().setActiveCall({
        ...activeCall,
        participants: activeCall.participants.filter((p) => p.userId !== userId),
      });
    }
  });

  callConnection.on('CallDeclined', (callId: string, declinedByUserId: string) => {
    console.log('=== CALL DECLINED EVENT RECEIVED ===');
    console.log('Call ID:', callId);
    console.log('Declined by user ID:', declinedByUserId);
    console.log('Platform:', Platform.OS);
    const { activeCall, incomingCall } = useCallStore.getState();
    const currentUserId = useAuthStore.getState().userId;
    console.log('Current user ID:', currentUserId);
    console.log('Active call ID:', activeCall?.id);
    console.log('Incoming call ID:', incomingCall?.id);
    console.log('Active call guidsEqual:', guidsEqual(activeCall?.id, callId));

    // Stop all sounds (both JS and native)
    callSoundService.stopAllSounds();
    NativeCallSound.stopRingtone();

    // Close native call UI on both platforms
    if (Platform.OS === 'ios') {
      console.log('Ending iOS CallKit call for declined call:', callId);
      CallManager.endCall(callId);
      if (incomingCall?.id) {
        CallManager.endCall(incomingCall.id);
      }
    } else {
      endNativeCall(callId);
    }

    if (guidsEqual(incomingCall?.id, callId)) {
      console.log('Clearing incoming call');
      useCallStore.getState().setIncomingCall(null);
    }

    if (guidsEqual(activeCall?.id, callId)) {
      // For 1-on-1 calls, if the other person declined, end the call for the caller
      if (currentUserId && declinedByUserId !== currentUserId) {
        // The other person declined, so end the call for the caller
        console.log('Other participant declined the call, ending call for caller');
        callSoundService.playBusyTone();
        useCallStore.getState().resetCallState();
      } else {
        console.log('Current user declined, updating participant status');
        useCallStore.getState().updateCallParticipant(declinedByUserId, { status: 'Declined' });
      }
    } else {
      console.log('Call IDs do not match - activeCall:', activeCall?.id, 'received:', callId);
    }
  });

  callConnection.on('CallEnded', (callId: string, userId: string) => {
    console.log('=== CALL ENDED EVENT RECEIVED ===');
    console.log('Call ID:', callId);
    console.log('Ended by user ID:', userId);
    console.log('Platform:', Platform.OS);
    const { activeCall, incomingCall } = useCallStore.getState();
    console.log('Current active call:', activeCall?.id);
    console.log('Current incoming call:', incomingCall?.id);

    // Stop all sounds (both JS and native) immediately
    callSoundService.stopAllSounds();
    NativeCallSound.stopRingtone();

    // Close native call UI on both platforms
    if (Platform.OS === 'ios') {
      // End iOS CallKit call
      console.log('Ending iOS CallKit call for:', callId);
      CallManager.endCall(callId);
      // Also try with incoming call ID if different
      if (incomingCall?.id && !guidsEqual(incomingCall.id, callId)) {
        console.log('Also ending with incoming call ID:', incomingCall.id);
        CallManager.endCall(incomingCall.id);
      }
    } else {
      // End Android native call activity
      endNativeCall(callId);
    }

    if (guidsEqual(activeCall?.id, callId) || guidsEqual(incomingCall?.id, callId)) {
      console.log('Resetting call state...');
      callSoundService.playEndedTone();
      useCallStore.getState().resetCallState();
      console.log('Call state reset complete');
    } else {
      console.log('Call IDs do not match, not resetting state');
      // Even if IDs don't match, if we have an incoming call showing, reset state
      // This handles edge cases where the call ID format might differ
      if (incomingCall) {
        console.log('Incoming call exists but ID mismatch - resetting anyway as safety measure');
        callSoundService.playEndedTone();
        useCallStore.getState().resetCallState();
      }
    }
  });

  callConnection.on('ParticipantStatusChanged', (callId: string, userId: string, status: any) => {
    console.log('[SignalR] ParticipantStatusChanged:', { callId, userId, status });
    useCallStore.getState().updateCallParticipant(userId, status);
  });

  callConnection.on('CallInvitation', (call: Call, invitedByName: string) => {
    console.log('=== CALL INVITATION RECEIVED ===');
    console.log('Call ID:', call.id);
    console.log('Invited by:', invitedByName);
    console.log('Type:', call.type);
    // Treat call invitation the same as incoming call
    useCallStore.getState().setIncomingCall(call);
  });

  callConnection.on('CallError', (error: string) => {
    console.error('Call error:', error);
  });

  try {
    await callConnection.start();
    console.log('Call hub connected');
  } catch (error) {
    console.error('Error connecting to call hub:', error);
  }
};

// Presence Hub
const initializePresenceHub = async (accessToken: string): Promise<void> => {
  presenceConnection = new HubConnectionBuilder()
    .withUrl(`${API_URL}/hubs/presence`, {
      accessTokenFactory: () => accessToken,
    })
    .withAutomaticReconnect()
    .configureLogging(LogLevel.Information)
    .build();

  // Connection lifecycle events
  presenceConnection.onclose((error) => {
    console.log('=== PRESENCE HUB CONNECTION CLOSED ===');
    console.log('Error:', error?.message || 'No error message');
  });

  presenceConnection.onreconnecting((error) => {
    console.log('=== PRESENCE HUB RECONNECTING ===');
    console.log('Error:', error?.message || 'No error message');
  });

  presenceConnection.onreconnected((connectionId) => {
    console.log('=== PRESENCE HUB RECONNECTED ===');
    console.log('New connection ID:', connectionId);
  });

  presenceConnection.on('ContactOnline', (userId: string) => {
    useChatStore.getState().setUserOnline(userId);
  });

  presenceConnection.on('ContactOffline', (userId: string, lastSeen: string) => {
    useChatStore.getState().setUserOffline(userId);
  });

  presenceConnection.on('OnlineContacts', (userIds: string[]) => {
    useChatStore.getState().setOnlineUsers(userIds);
  });

  presenceConnection.on('PresenceUpdate', (updates: Record<string, any>) => {
    Object.entries(updates).forEach(([userId, status]) => {
      if (status.IsOnline) {
        useChatStore.getState().setUserOnline(userId);
      } else {
        useChatStore.getState().setUserOffline(userId);
      }
    });
  });

  try {
    await presenceConnection.start();
    console.log('Presence hub connected');
  } catch (error) {
    console.error('Error connecting to presence hub:', error);
  }
};

// Chat Hub Methods
export const joinConversation = async (conversationId: string): Promise<void> => {
  if (chatConnection?.state === HubConnectionState.Connected) {
    await chatConnection.invoke('JoinConversation', conversationId);
  }
};

export const leaveConversation = async (conversationId: string): Promise<void> => {
  if (chatConnection?.state === HubConnectionState.Connected) {
    await chatConnection.invoke('LeaveConversation', conversationId);
  }
};

// Helper function to wait for chat connection with timeout
const waitForChatConnection = async (timeoutMs: number = 5000): Promise<boolean> => {
  if (chatConnection && chatConnection.state === HubConnectionState.Connected) {
    return true;
  }

  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    if (chatConnection && chatConnection.state === HubConnectionState.Connected) {
      return true;
    }
    // If connection is reconnecting, wait a bit
    if (chatConnection && chatConnection.state === HubConnectionState.Reconnecting) {
      await new Promise(resolve => setTimeout(resolve, 200));
      continue;
    }
    // If disconnected, try to restart
    if (chatConnection && chatConnection.state === HubConnectionState.Disconnected) {
      try {
        await chatConnection.start();
        return true;
      } catch (e) {
        console.log('Failed to restart chat connection:', e);
      }
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  return false;
};

export const sendMessage = async (
  conversationId: string,
  message: {
    type: string;
    content?: string;
    mediaUrl?: string;
    mediaMimeType?: string;
    mediaSize?: number;
    mediaDuration?: number;
    fileName?: string;
    metadata?: string;
    replyToMessageId?: string;
  }
): Promise<void> => {
  // Clean up the message object - remove undefined values
  const cleanMessage: Record<string, any> = {
    type: message.type,
  };

  if (message.content !== undefined) {
    cleanMessage.content = message.content;
  }
  if (message.mediaUrl !== undefined) {
    cleanMessage.mediaUrl = message.mediaUrl;
  }
  if (message.mediaMimeType !== undefined) {
    cleanMessage.mediaMimeType = message.mediaMimeType;
  }
  if (message.mediaSize !== undefined) {
    cleanMessage.mediaSize = message.mediaSize;
  }
  if (message.mediaDuration !== undefined) {
    cleanMessage.mediaDuration = message.mediaDuration;
  }
  if (message.fileName !== undefined) {
    cleanMessage.fileName = message.fileName;
  }
  if (message.metadata !== undefined) {
    cleanMessage.metadata = message.metadata;
  }
  if (message.replyToMessageId !== undefined) {
    cleanMessage.replyToMessageId = message.replyToMessageId;
  }

  console.log('SignalR sendMessage called:', { conversationId, mediaUrl: cleanMessage.mediaUrl, state: chatConnection?.state });

  // Wait for connection if not connected (with 5 second timeout)
  const isConnected = await waitForChatConnection(5000);

  if (isConnected && chatConnection?.state === HubConnectionState.Connected) {
    try {
      await chatConnection.invoke('SendMessage', conversationId, cleanMessage);
      console.log('Message sent successfully via SignalR');
    } catch (error) {
      console.error('Error sending message via SignalR:', error);
      throw error;
    }
  } else {
    console.warn('Chat connection not connected after waiting. State:', chatConnection?.state);
    throw new Error('Chat connection is not established');
  }
};

export const sendTyping = async (conversationId: string): Promise<void> => {
  console.log('=== SENDING TYPING EVENT ===');
  console.log('Conversation ID:', conversationId);
  console.log('Chat connection state:', chatConnection?.state);
  if (chatConnection?.state === HubConnectionState.Connected) {
    await chatConnection.invoke('SendTyping', conversationId);
    console.log('Typing event sent successfully');
  } else {
    console.log('Chat connection not connected, cannot send typing event');
  }
};

export const sendStopTyping = async (conversationId: string): Promise<void> => {
  console.log('=== SENDING STOP TYPING EVENT ===');
  console.log('Conversation ID:', conversationId);
  if (chatConnection?.state === HubConnectionState.Connected) {
    await chatConnection.invoke('SendStopTyping', conversationId);
    console.log('Stop typing event sent successfully');
  }
};

export const markMessageDelivered = async (messageId: string): Promise<void> => {
  if (chatConnection?.state === HubConnectionState.Connected) {
    await chatConnection.invoke('MarkMessageDelivered', messageId);
  }
};

export const markMessageRead = async (messageId: string): Promise<void> => {
  if (chatConnection?.state === HubConnectionState.Connected) {
    await chatConnection.invoke('MarkMessageRead', messageId);
  }
};

export const markConversationRead = async (conversationId: string): Promise<void> => {
  if (chatConnection?.state === HubConnectionState.Connected) {
    await chatConnection.invoke('MarkConversationRead', conversationId);
  }
};

export const deleteMessage = async (messageId: string, forEveryone: boolean): Promise<void> => {
  if (chatConnection?.state === HubConnectionState.Connected) {
    await chatConnection.invoke('DeleteMessage', messageId, forEveryone);
  }
};

export const editMessage = async (messageId: string, newContent: string): Promise<void> => {
  if (chatConnection?.state === HubConnectionState.Connected) {
    await chatConnection.invoke('EditMessage', messageId, newContent);
  }
};

// Push-to-Talk (PTT) Methods
export const startPTT = async (conversationId: string): Promise<void> => {
  if (chatConnection?.state === HubConnectionState.Connected) {
    await chatConnection.invoke('StartPTT', conversationId);
  }
};

export const sendPTTChunk = async (conversationId: string, audioChunkBase64: string): Promise<void> => {
  if (chatConnection?.state === HubConnectionState.Connected) {
    await chatConnection.invoke('SendPTTChunk', conversationId, audioChunkBase64);
  }
};

export const endPTT = async (conversationId: string, mediaUrl: string | null, duration: number): Promise<void> => {
  if (chatConnection?.state === HubConnectionState.Connected) {
    await chatConnection.invoke('EndPTT', conversationId, mediaUrl, duration);
  }
};

export const cancelPTT = async (conversationId: string): Promise<void> => {
  if (chatConnection?.state === HubConnectionState.Connected) {
    await chatConnection.invoke('CancelPTT', conversationId);
  }
};

// Call Hub Methods
export const initiateCall = async (
  conversationId: string,
  type: 'Voice' | 'Video'
): Promise<any> => {
  console.log('initiateCall called:', { conversationId, type, connectionState: callConnection?.state });
  if (callConnection?.state === HubConnectionState.Connected) {
    try {
      const result = await callConnection.invoke('InitiateCall', { conversationId, type });
      console.log('InitiateCall result:', result);
      return result;
    } catch (error) {
      console.error('InitiateCall error:', error);
      throw error;
    }
  }
  console.error('Call connection not connected, state:', callConnection?.state);
  return null;
};

export const joinCall = async (callId: string): Promise<any> => {
  if (callConnection?.state === HubConnectionState.Connected) {
    return await callConnection.invoke('JoinCall', callId);
  }
  return null;
};

export const declineCall = async (callId: string): Promise<void> => {
  console.log('=== DECLINE CALL FUNCTION ===');
  console.log('Call ID to decline:', callId);
  console.log('Call ID type:', typeof callId);
  console.log('SignalR connection state:', callConnection?.state);

  // Try SignalR first for real-time notification
  let signalRSuccess = false;
  if (callConnection?.state === HubConnectionState.Connected) {
    try {
      console.log('Invoking DeclineCall via SignalR...');
      await callConnection.invoke('DeclineCall', callId);
      signalRSuccess = true;
      console.log('DeclineCall via SignalR succeeded');
    } catch (error) {
      console.error('SignalR DeclineCall failed:', error);
    }
  } else {
    console.log('SignalR not connected, state:', callConnection?.state);
  }

  // Only call HTTP API if SignalR failed (to avoid duplicate decline attempts)
  // When SignalR succeeds, the call is already declined on the server
  if (!signalRSuccess) {
    try {
      console.log('SignalR failed, trying HTTP API...');
      const { callsApi } = await import('./api');
      await callsApi.decline(callId);
      console.log('DeclineCall via HTTP API succeeded');
    } catch (error) {
      console.error('HTTP API DeclineCall failed:', error);
      throw error;
    }
  }
};

export const leaveCall = async (callId: string): Promise<void> => {
  if (callConnection?.state === HubConnectionState.Connected) {
    await callConnection.invoke('LeaveCall', callId);
  }
};

export const endCall = async (callId: string): Promise<void> => {
  if (callConnection?.state === HubConnectionState.Connected) {
    await callConnection.invoke('EndCall', callId);
  }
};

export const updateCallStatus = async (
  callId: string,
  status: { isMuted?: boolean; isVideoEnabled?: boolean; isOnHold?: boolean }
): Promise<void> => {
  if (callConnection?.state === HubConnectionState.Connected) {
    await callConnection.invoke('UpdateCallStatus', callId, status);
  }
};

export const inviteToCall = async (callId: string, userId: string): Promise<void> => {
  if (callConnection?.state === HubConnectionState.Connected) {
    await callConnection.invoke('InviteToCall', callId, userId);
  }
};

// Presence Hub Methods
export const requestPresence = async (userIds: string[]): Promise<void> => {
  if (presenceConnection?.state === HubConnectionState.Connected) {
    await presenceConnection.invoke('RequestPresence', userIds);
  }
};

export const ping = async (): Promise<void> => {
  if (presenceConnection?.state === HubConnectionState.Connected) {
    await presenceConnection.invoke('Ping');
  }
};

// Forward Message Methods
export const forwardMessage = async (messageId: string, toConversationId: string): Promise<void> => {
  if (chatConnection?.state === HubConnectionState.Connected) {
    await chatConnection.invoke('ForwardMessage', messageId, toConversationId);
  }
};

export const forwardMessageToMultiple = async (messageId: string, conversationIds: string[]): Promise<void> => {
  if (chatConnection?.state === HubConnectionState.Connected) {
    await chatConnection.invoke('ForwardMessageToMultiple', messageId, conversationIds);
  }
};

// Enhanced Delete Methods
export const deleteMessageWithAudit = async (
  messageId: string,
  deleteType: 'ForMe' | 'ForEveryone' | 'AdminDelete',
  reason?: string
): Promise<void> => {
  if (chatConnection?.state === HubConnectionState.Connected) {
    // Convert string to enum value expected by backend
    const deleteTypeValue = deleteType === 'ForMe' ? 0 : deleteType === 'ForEveryone' ? 1 : 2;
    await chatConnection.invoke('DeleteMessageWithAudit', messageId, deleteTypeValue, reason || null);
  }
};

// Reaction Methods
export const addReaction = async (messageId: string, emoji: string): Promise<void> => {
  if (chatConnection?.state === HubConnectionState.Connected) {
    await chatConnection.invoke('AddReaction', messageId, emoji);
  }
};

export const removeReaction = async (messageId: string, emoji: string): Promise<void> => {
  if (chatConnection?.state === HubConnectionState.Connected) {
    await chatConnection.invoke('RemoveReaction', messageId, emoji);
  }
};

// Star/Bookmark Methods
export const starMessage = async (messageId: string): Promise<void> => {
  if (chatConnection?.state === HubConnectionState.Connected) {
    await chatConnection.invoke('StarMessage', messageId);
  }
};

export const unstarMessage = async (messageId: string): Promise<void> => {
  if (chatConnection?.state === HubConnectionState.Connected) {
    await chatConnection.invoke('UnstarMessage', messageId);
  }
};

// Pin Methods
export const pinMessage = async (conversationId: string, messageId: string): Promise<void> => {
  if (chatConnection?.state === HubConnectionState.Connected) {
    await chatConnection.invoke('PinMessage', conversationId, messageId);
  }
};

export const unpinMessage = async (conversationId: string, messageId: string): Promise<void> => {
  if (chatConnection?.state === HubConnectionState.Connected) {
    await chatConnection.invoke('UnpinMessage', conversationId, messageId);
  }
};

export {
  chatConnection,
  callConnection,
  presenceConnection,
};
