import React, { useEffect, useCallback, useState, useMemo } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  Text,
  StatusBar,
  Alert,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';
import ConversationItem from '../../components/ConversationItem';
import MediaPicker, { SelectedMedia } from '../../components/MediaPicker';
import Avatar from '../../components/Avatar';
import { conversationsApi, filesApi } from '../../services/api';
import { sendMessage } from '../../services/signalr';
import { useChatStore } from '../../stores/chatStore';
import { useAuthStore } from '../../stores/authStore';
import { conversationDBService } from '../../database/services';
import { RootStackParamList } from '../../navigation/RootNavigator';
import { Conversation } from '../../types';
import { useTheme } from '../../context/ThemeContext';
import { FONTS, SPACING, BORDER_RADIUS } from '../../utils/theme';

type ChatsScreenNavigationProp = NativeStackNavigationProp<RootStackParamList>;

const ChatsScreen: React.FC = () => {
  const navigation = useNavigation<ChatsScreenNavigationProp>();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors, insets.bottom), [colors, insets.bottom]);
  const { userId } = useAuthStore();
  const { conversations, setConversations } = useChatStore();
  const [showMediaPicker, setShowMediaPicker] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState<SelectedMedia | null>(null);
  const [showConversationPicker, setShowConversationPicker] = useState(false);
  const [isSendingMedia, setIsSendingMedia] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [loadedFromCache, setLoadedFromCache] = useState(false);
  const queryClient = useQueryClient();

  // Subscribe to all typing users to show in chat list
  // Using JSON.stringify for deep comparison since typingUsers is a nested object
  const typingUsersRaw = useChatStore((state) => state.typingUsers);
  const typingUsersKey = JSON.stringify(typingUsersRaw);
  const typingUsers = React.useMemo(() => typingUsersRaw, [typingUsersKey]);

  // Check network status
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      setIsOffline(!state.isConnected);
    });
    return () => unsubscribe();
  }, []);

  // Load conversations from local database first (for offline support)
  // Only load from cache if we're offline - otherwise wait for server data
  useEffect(() => {
    const loadFromLocalDB = async () => {
      try {
        // Check if we're offline before loading from cache
        const netState = await NetInfo.fetch();
        if (!netState.isConnected) {
          const localConversations = await conversationDBService.getActiveConversations();
          if (localConversations.length > 0 && conversations.length === 0) {
            // Convert WatermelonDB conversations to app format
            const formattedConversations: Conversation[] = localConversations.map(conv => ({
              id: conv.serverId,
              type: conv.type === 'direct' ? 'Private' : 'Group',
              name: conv.name || undefined,
              iconUrl: conv.avatarUrl || undefined,
              defaultMessageExpiry: 0 as const,
              lastMessage: conv.lastMessageContent ? {
                id: '',
                conversationId: conv.serverId,
                senderId: conv.lastMessageSenderId || '',
                content: conv.lastMessageContent,
                type: 'Text' as const,
                isForwarded: false,
                isEdited: false,
                isDeleted: false,
                status: 'Sent' as const,
                createdAt: conv.lastMessageAt ? new Date(conv.lastMessageAt).toISOString() : '',
                statuses: [],
              } : undefined,
              unreadCount: conv.unreadCount || 0,
              isMuted: conv.isMuted || false,
              isArchived: false,
              isDeleted: conv.isDeleted || false,
              participants: [],
              createdAt: new Date(conv.createdAt).toISOString(),
            }));
            setConversations(formattedConversations);
            setLoadedFromCache(true);
          }
        }
      } catch (error) {
        console.error('Error loading conversations from local DB:', error);
      }
    };

    loadFromLocalDB();
  }, []);

  // Debug: Log typing users changes
  useEffect(() => {
    console.log('ChatsScreen - typingUsers changed:', typingUsersKey);
  }, [typingUsersKey]);

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['conversations'],
    queryFn: async () => {
      const response = await conversationsApi.getAll();
      const fetchedConversations = response.data as Conversation[];

      // Sync to local database for offline access
      try {
        await conversationDBService.syncConversations(fetchedConversations.map(conv => ({
          id: conv.id,
          type: conv.type === 'Private' ? 'Direct' : 'Group',
          name: conv.name || null,
          avatarUrl: conv.iconUrl || null,
          lastMessage: conv.lastMessage ? {
            content: conv.lastMessage.content || '',
            createdAt: conv.lastMessage.createdAt,
            senderId: conv.lastMessage.senderId,
          } : undefined,
          unreadCount: conv.unreadCount || 0,
          isMuted: conv.isMuted || false,
          isPinned: false,
          participants: conv.participants?.map(p => ({
            userId: p.userId,
            role: p.role || 'member',
            joinedAt: p.joinedAt || new Date().toISOString(),
          })) || [],
          createdAt: conv.createdAt,
          updatedAt: conv.createdAt,
        })));
      } catch (syncError) {
        console.error('Error syncing conversations to local DB:', syncError);
      }

      return fetchedConversations;
    },
    retry: isOffline ? 0 : 3,
    retryDelay: 1000,
    staleTime: isOffline ? Infinity : 0,
  });

  useEffect(() => {
    if (data) {
      // Merge server data with local state to preserve real-time updates
      // Keep local unreadCount and lastMessage if they're more recent
      const currentConversations = useChatStore.getState().conversations;

      // Use a Map to deduplicate by conversation ID
      const conversationMap = new Map<string, Conversation>();

      // First, add all server conversations
      data.forEach(serverConv => {
        const localConv = currentConversations.find(c => c.id === serverConv.id);
        if (localConv) {
          // Keep local unreadCount if it's higher (real-time messages arrived)
          const unreadCount = Math.max(localConv.unreadCount || 0, serverConv.unreadCount || 0);

          // Keep local lastMessage if it's more recent
          const serverLastMessageTime = serverConv.lastMessage?.createdAt
            ? new Date(serverConv.lastMessage.createdAt).getTime()
            : 0;
          const localLastMessageTime = localConv.lastMessage?.createdAt
            ? new Date(localConv.lastMessage.createdAt).getTime()
            : 0;

          const lastMessage = localLastMessageTime > serverLastMessageTime
            ? localConv.lastMessage
            : serverConv.lastMessage;
          const lastMessageAt = localLastMessageTime > serverLastMessageTime
            ? localConv.lastMessageAt
            : serverConv.lastMessageAt;

          conversationMap.set(serverConv.id, {
            ...serverConv,
            unreadCount,
            lastMessage,
            lastMessageAt,
          });
        } else {
          conversationMap.set(serverConv.id, serverConv);
        }
      });

      // Convert Map back to array (this ensures no duplicates)
      const mergedConversations = Array.from(conversationMap.values());

      setConversations(mergedConversations);
      setLoadedFromCache(false);
    }
  }, [data, setConversations]);

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  // Archive mutation
  const archiveMutation = useMutation({
    mutationFn: async (conversationId: string) => {
      await conversationsApi.archive(conversationId, true);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
    onError: (error) => {
      console.error('Failed to archive:', error);
      Alert.alert('Error', 'Failed to archive conversation');
    },
  });

  // Filter only private (single) chats - non-archived and non-deleted
  // Also deduplicate by participant - if there are multiple conversations with the same user,
  // keep the one with the most recent message
  const privateConversations = React.useMemo(() => {
    const filtered = conversations.filter((c) => c.type === 'Private' && !c.isArchived && !c.isDeleted);

    // Deduplicate by other participant (for private chats, keep only one conversation per user)
    const participantMap = new Map<string, Conversation>();
    filtered.forEach(conv => {
      const otherParticipant = conv.participants.find(p => p.userId !== userId);
      if (otherParticipant) {
        const key = otherParticipant.userId;
        const existing = participantMap.get(key);

        if (!existing) {
          participantMap.set(key, conv);
        } else {
          // Keep the conversation with the most recent message, or the one that has a message
          const existingTime = existing.lastMessageAt
            ? new Date(existing.lastMessageAt).getTime()
            : (existing.createdAt ? new Date(existing.createdAt).getTime() : 0);
          const currentTime = conv.lastMessageAt
            ? new Date(conv.lastMessageAt).getTime()
            : (conv.createdAt ? new Date(conv.createdAt).getTime() : 0);

          // Prefer conversation with lastMessage, then by most recent time
          if (!existing.lastMessage && conv.lastMessage) {
            participantMap.set(key, conv);
          } else if (existing.lastMessage && !conv.lastMessage) {
            // Keep existing
          } else if (currentTime > existingTime) {
            participantMap.set(key, conv);
          }

          if (__DEV__) {
            console.warn(`[ChatsScreen] Duplicate conversations found for participant ${key}, keeping most recent`);
          }
        }
      } else {
        // No other participant found (shouldn't happen for private chats)
        // Keep based on conversation ID to avoid losing data
        if (!participantMap.has(conv.id)) {
          participantMap.set(conv.id, conv);
        }
      }
    });

    return Array.from(participantMap.values());
  }, [conversations, userId]);

  // Count archived conversations (only private ones)
  const archivedCount = React.useMemo(() => {
    return conversations.filter((c) => c.type === 'Private' && c.isArchived).length;
  }, [conversations]);

  // Non-archived private conversations for the media picker
  const nonArchivedConversations = React.useMemo(() => {
    return conversations.filter((c) => !c.isArchived && !c.isDeleted);
  }, [conversations]);

  const handleConversationPress = (conversation: Conversation) => {
    const title = conversation.type === 'Private'
      ? conversation.participants.find((p) => p.userId !== userId)?.displayName ||
        conversation.participants.find((p) => p.userId !== userId)?.fullName ||
        'Chat'
      : conversation.name || 'Group';

    navigation.navigate('Chat', { conversationId: conversation.id, title });
  };

  const handleConversationLongPress = (conversation: Conversation) => {
    const title = conversation.type === 'Private'
      ? conversation.participants.find((p) => p.userId !== userId)?.displayName ||
        conversation.participants.find((p) => p.userId !== userId)?.fullName ||
        'Chat'
      : conversation.name || 'Group';

    Alert.alert(
      title,
      'What would you like to do?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Archive',
          onPress: () => archiveMutation.mutate(conversation.id),
        },
        {
          text: 'Delete Chat',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Delete Chat',
              'Are you sure you want to delete this chat? This action cannot be undone.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: () => {
                    useChatStore.getState().softDeleteConversation(conversation.id);
                  },
                },
              ]
            );
          },
        },
      ]
    );
  };

  const handleMediaSelected = (media: SelectedMedia) => {
    setSelectedMedia(media);
    setShowMediaPicker(false);
    setShowConversationPicker(true);
  };

  const handleSendMediaToConversation = async (conversation: Conversation) => {
    if (!selectedMedia) return;

    setIsSendingMedia(true);
    try {
      // Upload the media file using uploadFile which handles FormData creation
      const uploadResponse = await filesApi.uploadFile(
        selectedMedia.uri,
        selectedMedia.type === 'video' ? 'video/mp4' : 'image/jpeg'
      );
      const fileData = uploadResponse.data;

      // Determine message type based on media type
      const messageType = selectedMedia.type === 'video' ? 'Video' : 'Image';

      // Send the message
      await sendMessage(conversation.id, {
        type: messageType,
        mediaUrl: fileData.fileUrl,
      });

      setShowConversationPicker(false);
      setSelectedMedia(null);

      // Navigate to the chat
      const title = conversation.type === 'Private'
        ? conversation.participants.find((p) => p.userId !== userId)?.displayName ||
          conversation.participants.find((p) => p.userId !== userId)?.fullName ||
          'Chat'
        : conversation.name || 'Group';

      navigation.navigate('Chat', { conversationId: conversation.id, title });
    } catch (error) {
      console.error('Error sending media:', error);
      Alert.alert('Error', 'Failed to send media');
    } finally {
      setIsSendingMedia(false);
    }
  };

  const getConversationTitle = (conversation: Conversation) => {
    return conversation.type === 'Private'
      ? conversation.participants.find((p) => p.userId !== userId)?.displayName ||
        conversation.participants.find((p) => p.userId !== userId)?.fullName ||
        'Chat'
      : conversation.name || 'Group';
  };

  const getConversationAvatar = (conversation: Conversation) => {
    if (conversation.type === 'Private') {
      const otherParticipant = conversation.participants.find((p) => p.userId !== userId);
      return otherParticipant?.profilePictureUrl;
    }
    return conversation.iconUrl;
  };

  const renderArchivedButton = () => {
    if (archivedCount === 0) return null;

    return (
      <TouchableOpacity
        style={styles.archivedButton}
        onPress={() => navigation.navigate('ArchivedChats')}
        activeOpacity={0.7}
      >
        <View style={styles.archivedIconContainer}>
          <Icon name="archive-outline" size={20} color={colors.primary} />
        </View>
        <Text style={styles.archivedText}>Archived</Text>
        <View style={styles.archivedBadge}>
          <Text style={styles.archivedBadgeText}>{archivedCount}</Text>
        </View>
        <Icon name="chevron-right" size={20} color={colors.textSecondary} />
      </TouchableOpacity>
    );
  };

  const renderEmptyList = () => (
    <View style={styles.emptyContainer}>
      <View style={styles.emptyIconContainer}>
        <Icon name="chat-processing-outline" size={64} color={colors.primary} />
      </View>
      <Text style={styles.emptyTitle}>No conversations yet</Text>
      <Text style={styles.emptySubtitle}>
        Start a conversation with your contacts to see them here
      </Text>
      <TouchableOpacity
        style={styles.startChatButton}
        onPress={() => navigation.navigate('NewChat')}
        activeOpacity={0.8}
      >
        <Icon name="message-plus" size={20} color={colors.textInverse} />
        <Text style={styles.startChatButtonText}>Start a new chat</Text>
      </TouchableOpacity>
    </View>
  );

  const renderItem = ({ item }: { item: Conversation }) => {
    const conversationTypingUsers = typingUsers[item.id] || [];
    const otherTypingUsers = conversationTypingUsers.filter(id => id !== userId);
    const isTyping = otherTypingUsers.length > 0;

    // Get first typing user's name for groups
    let typingUserName: string | undefined;
    if (isTyping && item.type === 'Group') {
      const typingUserId = otherTypingUsers[0];
      const participant = item.participants.find(p => p.userId === typingUserId);
      typingUserName = participant?.displayName || participant?.fullName;
    }

    return (
      <ConversationItem
        conversation={item}
        currentUserId={userId || ''}
        onPress={() => handleConversationPress(item)}
        onLongPress={() => handleConversationLongPress(item)}
        isTyping={isTyping}
        typingUserName={typingUserName}
      />
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={colors.surface} />

      {/* Offline Banner */}
      {isOffline && (
        <View style={styles.offlineBanner}>
          <Icon name="wifi-off" size={16} color={colors.textInverse} />
          <Text style={styles.offlineBannerText}>
            You're offline. Showing cached chats.
          </Text>
        </View>
      )}

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Chats</Text>
        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.headerButton}
            onPress={() => setShowMediaPicker(true)}
          >
            <Icon name="camera-outline" size={24} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerButton}
            onPress={() => navigation.navigate('Search')}
          >
            <Icon name="magnify" size={24} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerButton}>
            <Icon name="dots-vertical" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={privateConversations}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        extraData={typingUsers}
        ListHeaderComponent={renderArchivedButton}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={!isLoading ? renderEmptyList : null}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
        contentContainerStyle={privateConversations.length === 0 && archivedCount === 0 ? styles.emptyListContent : styles.listContent}
        showsVerticalScrollIndicator={false}
      />

      {/* FAB - New Chat Button */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => navigation.navigate('NewChat')}
        activeOpacity={0.8}
      >
        <Icon name="message-plus" size={26} color={colors.textInverse} />
      </TouchableOpacity>

      {/* Media Picker */}
      <MediaPicker
        visible={showMediaPicker}
        onClose={() => setShowMediaPicker(false)}
        onMediaSelected={handleMediaSelected}
      />

      {/* Conversation Picker Modal */}
      <Modal
        visible={showConversationPicker}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          setShowConversationPicker(false);
          setSelectedMedia(null);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Send to...</Text>
              <TouchableOpacity
                onPress={() => {
                  setShowConversationPicker(false);
                  setSelectedMedia(null);
                }}
                style={styles.modalCloseButton}
              >
                <Icon name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            {isSendingMedia ? (
              <View style={styles.sendingContainer}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={styles.sendingText}>Sending...</Text>
              </View>
            ) : (
              <FlatList
                data={nonArchivedConversations}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.conversationPickerItem}
                    onPress={() => handleSendMediaToConversation(item)}
                    activeOpacity={0.7}
                  >
                    <Avatar
                      uri={getConversationAvatar(item)}
                      name={getConversationTitle(item)}
                      size={50}
                    />
                    <View style={styles.conversationPickerInfo}>
                      <Text style={styles.conversationPickerName}>
                        {getConversationTitle(item)}
                      </Text>
                      <Text style={styles.conversationPickerType}>
                        {item.type === 'Private' ? 'Private chat' : `${item.participants.length} members`}
                      </Text>
                    </View>
                  </TouchableOpacity>
                )}
                ItemSeparatorComponent={() => <View style={styles.conversationPickerSeparator} />}
                ListEmptyComponent={
                  <View style={styles.emptyPickerContainer}>
                    <Text style={styles.emptyPickerText}>No conversations available</Text>
                  </View>
                }
              />
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
};

// Dynamic styles based on theme
const createStyles = (colors: any, bottomInset: number = 0) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.md,
    backgroundColor: colors.warning,
  },
  offlineBannerText: {
    marginLeft: SPACING.xs,
    fontSize: FONTS.sizes.sm,
    fontWeight: '500',
    color: colors.textInverse,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.xl + 20,
    paddingBottom: SPACING.md,
    backgroundColor: colors.surface,
  },
  headerTitle: {
    fontSize: FONTS.sizes.title,
    fontWeight: 'bold',
    color: colors.text,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerButton: {
    padding: SPACING.sm,
    marginLeft: SPACING.xs,
  },
  archivedButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  archivedIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary + '15',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.md,
  },
  archivedText: {
    flex: 1,
    fontSize: FONTS.sizes.md,
    color: colors.text,
    fontWeight: '500',
  },
  archivedBadge: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    minWidth: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.xs,
    marginRight: SPACING.sm,
  },
  archivedBadgeText: {
    color: colors.textInverse,
    fontSize: FONTS.sizes.xs,
    fontWeight: 'bold',
  },
  listContent: {
    paddingBottom: 100,
  },
  separator: {
    height: 1,
    backgroundColor: colors.divider,
    marginLeft: 88,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xxl,
  },
  emptyListContent: {
    flexGrow: 1,
  },
  emptyIconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: colors.primary + '15',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.xl,
  },
  emptyTitle: {
    fontSize: FONTS.sizes.xl,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: SPACING.sm,
  },
  emptySubtitle: {
    fontSize: FONTS.sizes.md,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: SPACING.xxl,
    lineHeight: 22,
  },
  startChatButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.xl,
    borderRadius: BORDER_RADIUS.xl,
    gap: SPACING.sm,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  startChatButtonText: {
    color: colors.textInverse,
    fontSize: FONTS.sizes.md,
    fontWeight: '600',
  },
  fab: {
    position: 'absolute',
    right: SPACING.lg,
    bottom: 66 + Math.max(bottomInset * 0.7, 4), // tab bar height + 10px margin
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: BORDER_RADIUS.xl,
    borderTopRightRadius: BORDER_RADIUS.xl,
    maxHeight: '80%',
    paddingBottom: SPACING.xxl,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  modalTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: 'bold',
    color: colors.text,
  },
  modalCloseButton: {
    padding: SPACING.xs,
  },
  sendingContainer: {
    padding: SPACING.xxl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendingText: {
    marginTop: SPACING.md,
    fontSize: FONTS.sizes.md,
    color: colors.textSecondary,
  },
  conversationPickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
  },
  conversationPickerInfo: {
    flex: 1,
    marginLeft: SPACING.md,
  },
  conversationPickerName: {
    fontSize: FONTS.sizes.md,
    fontWeight: '500',
    color: colors.text,
    marginBottom: 2,
  },
  conversationPickerType: {
    fontSize: FONTS.sizes.sm,
    color: colors.textSecondary,
  },
  conversationPickerSeparator: {
    height: 1,
    backgroundColor: colors.divider,
    marginLeft: 82,
  },
  emptyPickerContainer: {
    padding: SPACING.xxl,
    alignItems: 'center',
  },
  emptyPickerText: {
    fontSize: FONTS.sizes.md,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});

export default ChatsScreen;
