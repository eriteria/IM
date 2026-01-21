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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';
import ConversationItem from '../../components/ConversationItem';
import { conversationsApi } from '../../services/api';
import { useChatStore } from '../../stores/chatStore';
import { useAuthStore } from '../../stores/authStore';
import { RootStackParamList } from '../../navigation/RootNavigator';
import { Conversation } from '../../types';
import { useTheme } from '../../context/ThemeContext';
import { FONTS, SPACING, BORDER_RADIUS } from '../../utils/theme';

type GroupsScreenNavigationProp = NativeStackNavigationProp<RootStackParamList>;

const GroupsScreen: React.FC = () => {
  const navigation = useNavigation<GroupsScreenNavigationProp>();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors, insets.bottom), [colors, insets.bottom]);
  const { userId } = useAuthStore();
  const { conversations, setConversations } = useChatStore();
  const [isOffline, setIsOffline] = useState(false);
  const queryClient = useQueryClient();

  // Subscribe to all typing users to show in chat list
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

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['conversations'],
    queryFn: async () => {
      const response = await conversationsApi.getAll();
      return response.data as Conversation[];
    },
    retry: isOffline ? 0 : 3,
    retryDelay: 1000,
    staleTime: isOffline ? Infinity : 0,
  });

  useEffect(() => {
    if (data) {
      const currentConversations = useChatStore.getState().conversations;
      const mergedConversations = data.map(serverConv => {
        const localConv = currentConversations.find(c => c.id === serverConv.id);
        if (localConv) {
          const unreadCount = Math.max(localConv.unreadCount || 0, serverConv.unreadCount || 0);
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

          return {
            ...serverConv,
            unreadCount,
            lastMessage,
            lastMessageAt,
          };
        }
        return serverConv;
      });

      setConversations(mergedConversations);
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

  // Filter only group conversations (non-archived, non-deleted)
  const groupConversations = React.useMemo(() => {
    return conversations.filter((c) => c.type === 'Group' && !c.isArchived && !c.isDeleted);
  }, [conversations]);

  const handleConversationPress = (conversation: Conversation) => {
    const title = conversation.name || 'Group';
    navigation.navigate('Chat', { conversationId: conversation.id, title });
  };

  const handleConversationLongPress = (conversation: Conversation) => {
    const title = conversation.name || 'Group';

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

  const renderEmptyList = () => (
    <View style={styles.emptyContainer}>
      <View style={styles.emptyIconContainer}>
        <Icon name="account-group-outline" size={64} color={colors.primary} />
      </View>
      <Text style={styles.emptyTitle}>No groups yet</Text>
      <Text style={styles.emptySubtitle}>
        Create a group to chat with multiple people at once
      </Text>
      <TouchableOpacity
        style={styles.startChatButton}
        onPress={() => navigation.navigate('NewGroup')}
        activeOpacity={0.8}
      >
        <Icon name="account-multiple-plus" size={20} color={colors.textInverse} />
        <Text style={styles.startChatButtonText}>Create a new group</Text>
      </TouchableOpacity>
    </View>
  );

  const renderItem = ({ item }: { item: Conversation }) => {
    const conversationTypingUsers = typingUsers[item.id] || [];
    const otherTypingUsers = conversationTypingUsers.filter(id => id !== userId);
    const isTyping = otherTypingUsers.length > 0;

    // Get first typing user's name for groups
    let typingUserName: string | undefined;
    if (isTyping) {
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
            You're offline. Showing cached groups.
          </Text>
        </View>
      )}

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Groups</Text>
        <View style={styles.headerRight}>
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
        data={groupConversations}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        extraData={typingUsers}
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
        contentContainerStyle={groupConversations.length === 0 ? styles.emptyListContent : styles.listContent}
        showsVerticalScrollIndicator={false}
      />

      {/* FAB - New Group Button */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => navigation.navigate('NewGroup')}
        activeOpacity={0.8}
      >
        <Icon name="account-multiple-plus" size={26} color={colors.textInverse} />
      </TouchableOpacity>
    </View>
  );
};

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
});

export default GroupsScreen;
