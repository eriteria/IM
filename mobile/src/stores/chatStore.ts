import { create } from 'zustand';
import { Conversation, Message, Participant } from '../types';
import { conversationDBService, messageDBService, syncService } from '../database/services';
import { v4 as uuidv4 } from 'uuid';

// PTT (Push-to-Talk) state for tracking active PTT sessions
interface PTTSession {
  userId: string;
  userName: string;
  startedAt: number;
  chunks: string[]; // Base64 audio chunks for playback
}

interface ChatState {
  conversations: Conversation[];
  activeConversationId: string | null;
  messages: Record<string, Message[]>;
  typingUsers: Record<string, string[]>; // conversationId -> userIds
  onlineUsers: Set<string>;
  isLoadingFromCache: boolean;
  isOnline: boolean;
  syncStatus: 'idle' | 'syncing' | 'error' | 'offline';
  pttSessions: Record<string, PTTSession>; // conversationId -> active PTT session

  // Actions
  setConversations: (conversations: Conversation[]) => void;
  addConversation: (conversation: Conversation) => void;
  updateConversation: (conversationId: string, updates: Partial<Conversation>) => void;
  removeConversation: (conversationId: string) => void;
  setActiveConversation: (conversationId: string | null) => void;
  softDeleteConversation: (conversationId: string) => void;
  incrementUnreadCount: (conversationId: string) => void;
  resetUnreadCount: (conversationId: string) => void;
  moveConversationToTop: (conversationId: string) => void;

  // Messages
  setMessages: (conversationId: string, messages: Message[]) => void;
  addMessage: (conversationId: string, message: Message) => void;
  addOptimisticMessage: (conversationId: string, message: Partial<Message>, senderId: string, senderName?: string) => string;
  confirmOptimisticMessage: (conversationId: string, tempId: string, serverMessage: Message) => void;
  failOptimisticMessage: (conversationId: string, tempId: string) => void;
  updateMessage: (conversationId: string, messageId: string, updates: Partial<Message>) => void;
  deleteMessage: (conversationId: string, messageId: string) => void;
  prependMessages: (conversationId: string, messages: Message[]) => void;
  addMissedCallMessage: (conversationId: string, callerId: string, callerName: string, callType: 'Voice' | 'Video') => void;

  // Typing
  setUserTyping: (conversationId: string, userId: string) => void;
  removeUserTyping: (conversationId: string, userId: string) => void;

  // Online status
  setUserOnline: (userId: string) => void;
  setUserOffline: (userId: string) => void;
  setOnlineUsers: (userIds: string[]) => void;

  // Helpers
  getConversation: (conversationId: string) => Conversation | undefined;
  getMessages: (conversationId: string) => Message[];
  getUnreadCount: () => number;

  // Offline support
  loadFromCache: () => Promise<void>;
  syncWithServer: () => Promise<void>;
  setSyncStatus: (status: 'idle' | 'syncing' | 'error' | 'offline') => void;
  saveConversationsToCache: (conversations: Conversation[]) => Promise<void>;
  saveMessagesToCache: (conversationId: string, messages: Message[]) => Promise<void>;

  // PTT (Push-to-Talk)
  setPTTActive: (conversationId: string, userId: string, userName: string) => void;
  addPTTChunk: (conversationId: string, userId: string, audioChunk: string) => void;
  clearPTTActive: (conversationId: string, userId: string) => void;
  getPTTSession: (conversationId: string) => PTTSession | undefined;
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  activeConversationId: null,
  messages: {},
  typingUsers: {},
  onlineUsers: new Set(),
  isLoadingFromCache: false,
  isOnline: true,
  syncStatus: 'idle',
  pttSessions: {},

  setConversations: (conversations) => {
    // Deduplicate conversations by ID (keep the first occurrence)
    const uniqueConversations = conversations.reduce((acc, conv) => {
      if (!acc.some(c => c.id === conv.id)) {
        acc.push(conv);
      }
      return acc;
    }, [] as Conversation[]);

    // Sort conversations by lastMessageAt (most recent first), with fallback to createdAt
    const sortedConversations = [...uniqueConversations].sort((a, b) => {
      const aDate = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
      const bDate = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
      return bDate - aDate; // Descending order (most recent first)
    });
    set({ conversations: sortedConversations });
    // Save to local cache in background
    get().saveConversationsToCache(sortedConversations);
  },

  addConversation: (conversation) => {
    set((state) => ({
      conversations: [conversation, ...state.conversations.filter(c => c.id !== conversation.id)],
    }));
  },

  updateConversation: (conversationId, updates) => {
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === conversationId ? { ...c, ...updates } : c
      ),
    }));

    // Update in local DB
    if (updates.lastMessage) {
      conversationDBService.updateLastMessage(
        conversationId,
        updates.lastMessage.content || '',
        updates.lastMessage.senderId,
        new Date(updates.lastMessage.createdAt)
      );
    }
    if (updates.unreadCount !== undefined) {
      conversationDBService.updateUnreadCount(conversationId, updates.unreadCount);
    }
  },

  removeConversation: (conversationId) => {
    set((state) => ({
      conversations: state.conversations.filter((c) => c.id !== conversationId),
    }));
  },

  setActiveConversation: (conversationId) => {
    set({ activeConversationId: conversationId });
  },

  softDeleteConversation: (conversationId) => {
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === conversationId
          ? { ...c, isDeleted: true, deletedAt: new Date().toISOString() }
          : c
      ),
    }));
    // Update in local DB
    conversationDBService.softDeleteConversation(conversationId);
  },

  incrementUnreadCount: (conversationId) => {
    console.log('incrementUnreadCount called for:', conversationId);
    set((state) => {
      const updated = state.conversations.map((c) =>
        c.id === conversationId
          ? { ...c, unreadCount: (c.unreadCount || 0) + 1 }
          : c
      );
      const updatedConv = updated.find(c => c.id === conversationId);
      console.log('New unread count for', conversationId, ':', updatedConv?.unreadCount);
      return { conversations: updated };
    });
    // Update in local DB
    const conv = get().conversations.find((c) => c.id === conversationId);
    if (conv) {
      conversationDBService.updateUnreadCount(conversationId, (conv.unreadCount || 0) + 1);
    }
  },

  resetUnreadCount: (conversationId) => {
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === conversationId ? { ...c, unreadCount: 0 } : c
      ),
    }));
    // Update in local DB
    conversationDBService.updateUnreadCount(conversationId, 0);
  },

  moveConversationToTop: (conversationId) => {
    set((state) => {
      const conversation = state.conversations.find((c) => c.id === conversationId);
      if (!conversation) return state;

      const otherConversations = state.conversations.filter((c) => c.id !== conversationId);
      return {
        conversations: [conversation, ...otherConversations],
      };
    });
  },

  setMessages: (conversationId, messages) => {
    set((state) => ({
      messages: {
        ...state.messages,
        [conversationId]: messages,
      },
    }));
    // Save to local cache in background
    get().saveMessagesToCache(conversationId, messages);
  },

  addMessage: (conversationId, message) => {
    set((state) => {
      const existingMessages = state.messages[conversationId] || [];

      // Check if message already exists by ID
      if (existingMessages.some((m) => m.id === message.id)) {
        return state;
      }

      // Check if this is a server confirmation of an optimistic message
      // Match by: same sender, same content, status is 'Sending', and ID starts with 'temp_'
      const optimisticIndex = existingMessages.findIndex(
        (m) =>
          m.id.startsWith('temp_') &&
          m.senderId === message.senderId &&
          m.content === message.content &&
          m.type === message.type &&
          m.status === 'Sending'
      );

      if (optimisticIndex !== -1) {
        // Replace the optimistic message with the server message
        const updatedMessages = [...existingMessages];
        updatedMessages[optimisticIndex] = message;
        return {
          messages: {
            ...state.messages,
            [conversationId]: updatedMessages,
          },
        };
      }

      return {
        messages: {
          ...state.messages,
          [conversationId]: [message, ...existingMessages],
        },
      };
    });

    // Update conversation's last message and move to top
    get().updateConversation(conversationId, {
      lastMessage: message,
      lastMessageAt: message.createdAt,
    });
    get().moveConversationToTop(conversationId);
  },

  // Add optimistic message for instant display
  addOptimisticMessage: (conversationId, messageData, senderId, senderName) => {
    const tempId = `temp_${uuidv4()}`;
    const now = new Date().toISOString();

    const optimisticMessage: Message = {
      id: tempId,
      conversationId,
      senderId,
      senderName,
      type: messageData.type || 'Text',
      content: messageData.content,
      mediaUrl: messageData.mediaUrl,
      mediaThumbnailUrl: messageData.mediaThumbnailUrl,
      mediaMimeType: messageData.mediaMimeType,
      mediaSize: messageData.mediaSize,
      mediaDuration: messageData.mediaDuration,
      replyToMessageId: messageData.replyToMessageId,
      replyToMessage: messageData.replyToMessage,
      isForwarded: false,
      isEdited: false,
      isDeleted: false,
      status: 'Sending',
      createdAt: now,
      statuses: [],
      // Upload progress fields for media uploads
      uploadProgress: messageData.uploadProgress,
      localMediaUri: messageData.localMediaUri,
    };

    set((state) => ({
      messages: {
        ...state.messages,
        [conversationId]: [optimisticMessage, ...(state.messages[conversationId] || [])],
      },
    }));

    // Update conversation's last message and move to top
    get().updateConversation(conversationId, {
      lastMessage: optimisticMessage,
      lastMessageAt: now,
    });
    get().moveConversationToTop(conversationId);

    return tempId;
  },

  // Confirm optimistic message with server response
  confirmOptimisticMessage: (conversationId, tempId, serverMessage) => {
    set((state) => ({
      messages: {
        ...state.messages,
        [conversationId]: (state.messages[conversationId] || []).map((m) =>
          m.id === tempId ? serverMessage : m
        ),
      },
    }));

    // Update last message to confirmed version
    get().updateConversation(conversationId, {
      lastMessage: serverMessage,
      lastMessageAt: serverMessage.createdAt,
    });
  },

  // Mark optimistic message as failed
  failOptimisticMessage: (conversationId, tempId) => {
    set((state) => ({
      messages: {
        ...state.messages,
        [conversationId]: (state.messages[conversationId] || []).map((m) =>
          m.id === tempId ? { ...m, status: 'Failed' as const } : m
        ),
      },
    }));
  },

  updateMessage: (conversationId, messageId, updates) => {
    set((state) => ({
      messages: {
        ...state.messages,
        [conversationId]: (state.messages[conversationId] || []).map((m) =>
          m.id === messageId ? { ...m, ...updates } : m
        ),
      },
    }));
  },

  deleteMessage: (conversationId, messageId) => {
    set((state) => ({
      messages: {
        ...state.messages,
        [conversationId]: (state.messages[conversationId] || []).map((m) =>
          m.id === messageId ? { ...m, isDeleted: true, content: undefined } : m
        ),
      },
    }));
    // Update in local DB
    messageDBService.markAsDeleted(messageId);
  },

  prependMessages: (conversationId, newMessages) => {
    set((state) => ({
      messages: {
        ...state.messages,
        [conversationId]: [
          ...(state.messages[conversationId] || []),
          ...newMessages,
        ],
      },
    }));
  },

  // Add missed call message to conversation
  addMissedCallMessage: (conversationId, callerId, callerName, callType) => {
    const now = new Date().toISOString();
    const missedCallMessage: Message = {
      id: `missed_call_${uuidv4()}`,
      conversationId,
      senderId: callerId,
      senderName: callerName,
      type: callType === 'Video' ? 'MissedVideoCall' : 'MissedCall',
      content: callType === 'Video' ? 'Missed video call' : 'Missed voice call',
      isForwarded: false,
      isEdited: false,
      isDeleted: false,
      status: 'Sent',
      createdAt: now,
      statuses: [],
    };

    // Add the missed call message
    get().addMessage(conversationId, missedCallMessage);

    // Increment unread count if user is not viewing this conversation
    const activeConversationId = get().activeConversationId;
    if (activeConversationId !== conversationId) {
      get().incrementUnreadCount(conversationId);
    }
  },

  setUserTyping: (conversationId, userId) => {
    set((state) => {
      const currentTyping = state.typingUsers[conversationId] || [];
      if (currentTyping.includes(userId)) return state;
      return {
        typingUsers: {
          ...state.typingUsers,
          [conversationId]: [...currentTyping, userId],
        },
      };
    });
  },

  removeUserTyping: (conversationId, userId) => {
    set((state) => ({
      typingUsers: {
        ...state.typingUsers,
        [conversationId]: (state.typingUsers[conversationId] || []).filter(
          (id) => id !== userId
        ),
      },
    }));
  },

  setUserOnline: (userId) => {
    set((state) => {
      const newOnlineUsers = new Set(state.onlineUsers);
      newOnlineUsers.add(userId);
      return { onlineUsers: newOnlineUsers };
    });
  },

  setUserOffline: (userId) => {
    set((state) => {
      const newOnlineUsers = new Set(state.onlineUsers);
      newOnlineUsers.delete(userId);
      return { onlineUsers: newOnlineUsers };
    });
  },

  setOnlineUsers: (userIds) => {
    set({ onlineUsers: new Set(userIds) });
  },

  getConversation: (conversationId) => {
    return get().conversations.find((c) => c.id === conversationId);
  },

  getMessages: (conversationId) => {
    return get().messages[conversationId] || [];
  },

  getUnreadCount: () => {
    return get().conversations.reduce((count, conv) => count + conv.unreadCount, 0);
  },

  // Load conversations and recent messages from local cache
  loadFromCache: async () => {
    set({ isLoadingFromCache: true });
    try {
      const cachedConversations = await conversationDBService.getAllConversations();

      if (cachedConversations.length > 0) {
        // Convert WatermelonDB models to plain objects matching the Conversation interface
        const conversations: Conversation[] = cachedConversations.map(c => ({
          id: c.serverId,
          type: c.type === 'direct' ? 'Private' : 'Group',
          name: c.name || undefined,
          iconUrl: c.avatarUrl || undefined,
          participants: [], // Will be loaded separately
          unreadCount: c.unreadCount,
          isMuted: c.isMuted,
          isArchived: false,
          defaultMessageExpiry: 0 as const,
          lastMessage: c.lastMessageContent ? {
            id: '',
            conversationId: c.serverId,
            senderId: c.lastMessageSenderId || '',
            type: 'Text' as const,
            content: c.lastMessageContent,
            createdAt: c.lastMessageAt ? new Date(c.lastMessageAt).toISOString() : new Date().toISOString(),
            isEdited: false,
            isDeleted: false,
            isForwarded: false,
            status: 'Sent' as const,
            statuses: [],
          } : undefined,
          lastMessageAt: c.lastMessageAt ? new Date(c.lastMessageAt).toISOString() : undefined,
          createdAt: c.createdAt.toISOString(),
        }));

        set({ conversations });
        console.log(`Loaded ${conversations.length} conversations from cache`);
      }
    } catch (error) {
      console.error('Error loading from cache:', error);
    } finally {
      set({ isLoadingFromCache: false });
    }
  },

  // Trigger sync with server
  syncWithServer: async () => {
    set({ syncStatus: 'syncing' });
    try {
      await syncService.syncAll();
      set({ syncStatus: 'idle' });
    } catch (error) {
      console.error('Error syncing with server:', error);
      set({ syncStatus: 'error' });
    }
  },

  setSyncStatus: (status) => {
    set({ syncStatus: status, isOnline: status !== 'offline' });
  },

  // Save conversations to local cache
  saveConversationsToCache: async (conversations: Conversation[]) => {
    try {
      // Convert to server format for the DB service
      const serverConversations = conversations.map(c => ({
        id: c.id,
        type: (c.type === 'Private' ? 'Direct' : 'Group') as 'Direct' | 'Group',
        name: c.name || null,
        avatarUrl: c.iconUrl || null,
        lastMessage: c.lastMessage ? {
          content: c.lastMessage.content || '',
          createdAt: c.lastMessage.createdAt,
          senderId: c.lastMessage.senderId,
        } : undefined,
        unreadCount: c.unreadCount,
        isMuted: c.isMuted || false,
        isPinned: false,
        participants: c.participants?.map(p => ({
          userId: p.userId,
          role: p.role || 'Member',
          joinedAt: p.joinedAt || new Date().toISOString(),
        })) || [],
        createdAt: c.createdAt,
        updatedAt: c.createdAt,
      }));

      await conversationDBService.syncConversations(serverConversations);
    } catch (error) {
      console.error('Error saving conversations to cache:', error);
    }
  },

  // Save messages to local cache
  saveMessagesToCache: async (conversationId: string, messages: Message[]) => {
    try {
      const serverMessages = messages.map(m => ({
        id: m.id,
        conversationId: conversationId,
        senderId: m.senderId,
        type: m.type,
        content: m.content || null,
        mediaUrl: m.mediaUrl || null,
        thumbnailUrl: m.mediaThumbnailUrl || null,
        mimeType: m.mediaMimeType || null,
        fileSize: m.mediaSize || null,
        duration: m.mediaDuration || null,
        replyToId: m.replyToMessageId || null,
        forwardedFromId: null,
        isEdited: m.isEdited || false,
        isDeleted: m.isDeleted || false,
        expiresAt: m.expiresAt || null,
        createdAt: m.createdAt,
        updatedAt: m.editedAt || m.createdAt,
      }));

      await messageDBService.syncMessages(conversationId, serverMessages);
    } catch (error) {
      console.error('Error saving messages to cache:', error);
    }
  },

  // PTT (Push-to-Talk) methods
  setPTTActive: (conversationId, userId, userName) => {
    set((state) => ({
      pttSessions: {
        ...state.pttSessions,
        [conversationId]: {
          userId,
          userName,
          startedAt: Date.now(),
          chunks: [],
        },
      },
    }));
  },

  addPTTChunk: (conversationId, userId, audioChunk) => {
    set((state) => {
      const session = state.pttSessions[conversationId];
      if (!session || session.userId !== userId) return state;

      return {
        pttSessions: {
          ...state.pttSessions,
          [conversationId]: {
            ...session,
            chunks: [...session.chunks, audioChunk],
          },
        },
      };
    });

    // Forward chunk to PTT stream service for real-time playback
    try {
      const { pttStreamService } = require('../services/PTTStreamService');
      pttStreamService.addReceivedChunk(conversationId, userId, audioChunk);
    } catch (error) {
      console.error('Error forwarding PTT chunk to stream service:', error);
    }
  },

  clearPTTActive: (conversationId, userId) => {
    set((state) => {
      const session = state.pttSessions[conversationId];
      if (!session || session.userId !== userId) return state;

      const { [conversationId]: _, ...remainingSessions } = state.pttSessions;
      return { pttSessions: remainingSessions };
    });
  },

  getPTTSession: (conversationId) => {
    return get().pttSessions[conversationId];
  },
}));
