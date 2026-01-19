import { useCallback, useEffect, useState, useRef } from 'react';
import { InteractionManager } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';
import { conversationsApi, messagesApi } from '../services/api';
import { sendMessage as sendSignalRMessage } from '../services/signalr';
import { useChatStore } from '../stores/chatStore';
import { messageDBService } from '../database/services';
import { Message, MessageType } from '../types';

interface SendMessageParams {
  type: MessageType;
  content?: string;
  mediaUrl?: string;
  mediaType?: string;
  fileName?: string;
  replyToMessageId?: string;
}

export const useMessages = (conversationId: string) => {
  const queryClient = useQueryClient();
  const { messages, setMessages, prependMessages, addMessage } = useChatStore();
  const [isOffline, setIsOffline] = useState(false);
  const [loadedFromCache, setLoadedFromCache] = useState(false);

  const conversationMessages = messages[conversationId] || [];

  // Load messages from local database first (for offline support)
  // Use useRef to track if we've already loaded from cache to prevent re-loading
  const hasLoadedFromCache = useRef(false);

  useEffect(() => {
    // Skip if we've already loaded from cache or already have messages
    if (hasLoadedFromCache.current || conversationMessages.length > 0) {
      return;
    }

    // Defer local DB loading to after interactions complete
    const handle = InteractionManager.runAfterInteractions(() => {
      const loadFromLocalDB = async () => {
        try {
          const localMessages = await messageDBService.getMessages(conversationId, 50, 0);
          if (localMessages.length > 0) {
            // Convert WatermelonDB messages to app Message format
            // Process in smaller batches to avoid blocking the JS thread
            const formattedMessages: Message[] = [];
            const batchSize = 10;

            for (let i = 0; i < localMessages.length; i += batchSize) {
              const batch = localMessages.slice(i, i + batchSize);
              const formattedBatch = batch.map(msg => ({
                id: msg.serverId,
                conversationId: msg.conversationId,
                senderId: msg.senderId,
                senderName: '',
                type: msg.type.charAt(0).toUpperCase() + msg.type.slice(1) as any,
                content: msg.content || undefined,
                mediaUrl: msg.mediaUrl || undefined,
                mediaThumbnailUrl: msg.mediaThumbnailUrl || undefined,
                mediaDuration: msg.mediaDuration || undefined,
                status: msg.status === 'sending' ? 'Sending' : msg.status === 'sent' ? 'Sent' : 'Delivered',
                isEdited: msg.isEdited,
                isForwarded: !!msg.forwardedFromId,
                isDeleted: msg.isDeleted,
                replyToMessageId: msg.replyToId || undefined,
                createdAt: new Date(msg.createdAt).toISOString(),
                statuses: [],
                reactions: [],
              }));
              formattedMessages.push(...formattedBatch);

              // Yield to allow UI updates between batches
              if (i + batchSize < localMessages.length) {
                await new Promise(resolve => setTimeout(resolve, 0));
              }
            }

            setMessages(conversationId, formattedMessages);
            setLoadedFromCache(true);
          }
          hasLoadedFromCache.current = true;
        } catch (error) {
          console.error('Error loading messages from local DB:', error);
          hasLoadedFromCache.current = true;
        }
      };

      loadFromLocalDB();
    });

    return () => handle.cancel();
  }, [conversationId, conversationMessages.length, setMessages]);

  // Check network status
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      setIsOffline(!state.isConnected);
    });
    return () => unsubscribe();
  }, []);

  // Fetch initial messages from API
  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['messages', conversationId],
    queryFn: async () => {
      const response = await conversationsApi.getMessages(conversationId, 1, 50);
      const fetchedMessages = response.data as Message[];

      // Populate replyToMessage for messages that have replyToMessageId
      // Create a map for quick lookup
      const messageMap = new Map(fetchedMessages.map(m => [m.id, m]));
      fetchedMessages.forEach(msg => {
        if (msg.replyToMessageId && !msg.replyToMessage) {
          const replyToMsg = messageMap.get(msg.replyToMessageId);
          if (replyToMsg) {
            msg.replyToMessage = replyToMsg;
          }
        }
      });

      // Sync to local database for offline access
      try {
        await messageDBService.syncMessages(conversationId, fetchedMessages.map(msg => ({
          id: msg.id,
          conversationId: msg.conversationId,
          senderId: msg.senderId,
          type: msg.type,
          content: msg.content || null,
          mediaUrl: msg.mediaUrl || null,
          thumbnailUrl: msg.mediaThumbnailUrl || null,
          mimeType: msg.mediaMimeType || null,
          fileSize: msg.mediaSize || null,
          duration: msg.mediaDuration || null,
          replyToId: msg.replyToMessageId || null,
          forwardedFromId: msg.isForwarded ? 'forwarded' : null,
          isEdited: msg.isEdited || false,
          isDeleted: msg.isDeleted || false,
          expiresAt: msg.expiresAt || null,
          createdAt: msg.createdAt,
          updatedAt: msg.createdAt,
        })));
      } catch (syncError) {
        console.error('Error syncing messages to local DB:', syncError);
      }

      return fetchedMessages;
    },
    // Don't fail immediately if offline - we have cached data
    retry: isOffline ? 0 : 3,
    retryDelay: 1000,
    // Consider cached data as still valid when offline
    staleTime: isOffline ? Infinity : 0,
  });

  // Update store when data changes
  useEffect(() => {
    if (data) {
      setMessages(conversationId, data);
      setLoadedFromCache(false);
    }
  }, [data, conversationId, setMessages]);

  // Load more messages (pagination)
  const loadMoreMessages = useCallback(async (page: number) => {
    try {
      const response = await conversationsApi.getMessages(conversationId, page, 50);
      const newMessages = response.data as Message[];

      if (newMessages.length > 0) {
        // Populate replyToMessage from existing messages in the store
        const existingMessages = useChatStore.getState().messages[conversationId] || [];
        const allMessages = [...newMessages, ...existingMessages];
        const messageMap = new Map(allMessages.map(m => [m.id, m]));

        newMessages.forEach(msg => {
          if (msg.replyToMessageId && !msg.replyToMessage) {
            const replyToMsg = messageMap.get(msg.replyToMessageId);
            if (replyToMsg) {
              msg.replyToMessage = replyToMsg;
            }
          }
        });

        prependMessages(conversationId, newMessages);
      }

      return newMessages.length === 50; // hasMore
    } catch (error) {
      console.error('Error loading more messages:', error);
      return false;
    }
  }, [conversationId, prependMessages]);

  // Send message mutation
  const sendMessageMutation = useMutation({
    mutationFn: async (params: SendMessageParams) => {
      await sendSignalRMessage(conversationId, params);
    },
    onError: (error) => {
      console.error('Failed to send message:', error);
    },
  });

  // Edit message mutation
  const editMessageMutation = useMutation({
    mutationFn: async ({ messageId, content }: { messageId: string; content: string }) => {
      await messagesApi.edit(messageId, content);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
    },
  });

  // Delete message mutation
  const deleteMessageMutation = useMutation({
    mutationFn: async ({ messageId, forEveryone }: { messageId: string; forEveryone: boolean }) => {
      await messagesApi.delete(messageId, forEveryone);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
    },
  });

  // Mark message as read
  const markAsRead = useCallback(async (messageId: string) => {
    try {
      await messagesApi.markRead(messageId);
    } catch (error) {
      console.error('Error marking message as read:', error);
    }
  }, []);

  // Forward message
  const forwardMessage = useCallback(async (messageId: string, targetConversationIds: string[]) => {
    try {
      await messagesApi.forward(messageId, targetConversationIds);
    } catch (error) {
      console.error('Error forwarding message:', error);
      throw error;
    }
  }, []);

  return {
    messages: conversationMessages,
    isLoading: isLoading && !loadedFromCache && conversationMessages.length === 0,
    isError,
    error,
    isOffline,
    loadedFromCache,
    refetch,
    loadMoreMessages,
    sendMessage: sendMessageMutation.mutate,
    isSending: sendMessageMutation.isPending,
    editMessage: editMessageMutation.mutate,
    isEditing: editMessageMutation.isPending,
    deleteMessage: deleteMessageMutation.mutate,
    isDeleting: deleteMessageMutation.isPending,
    markAsRead,
    forwardMessage,
  };
};

export default useMessages;
