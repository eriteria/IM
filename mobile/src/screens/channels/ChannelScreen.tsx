import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  StatusBar,
  ActivityIndicator,
  TextInput,
  Image,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { launchImageLibrary } from 'react-native-image-picker';
import Avatar from '../../components/Avatar';
import { channelsApi, filesApi } from '../../services/api';
import { RootStackParamList } from '../../navigation/RootNavigator';
import { FONTS, SPACING, BORDER_RADIUS } from '../../utils/theme';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { useAuthStore } from '../../stores/authStore';

type ChannelScreenNavigationProp = NativeStackNavigationProp<RootStackParamList>;
type ChannelScreenRouteProp = RouteProp<RootStackParamList, 'Channel'>;

interface ChannelPost {
  id: string;
  channelId: string;
  channelName: string;
  authorId: string;
  authorName: string;
  authorProfilePicture?: string;
  content?: string;
  type: string;
  mediaUrl?: string;
  mediaMimeType?: string;
  mediaSize?: number;
  mediaDuration?: number;
  thumbnailUrl?: string;
  viewCount: number;
  reactionCount: number;
  isPinned: boolean;
  reactions: { emoji: string; count: number }[];
  myReaction?: string;
  createdAt: string;
}

interface Channel {
  id: string;
  name: string;
  shortName: string;
  description?: string;
  iconUrl?: string;
  ownerId: string;
  ownerName?: string;
  isPublic: boolean;
  isVerified: boolean;
  followerCount: number;
  isFollowing: boolean;
  isMuted: boolean;
  lastPostAt?: string;
  createdAt: string;
}

const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

const ChannelScreen: React.FC = () => {
  const navigation = useNavigation<ChannelScreenNavigationProp>();
  const route = useRoute<ChannelScreenRouteProp>();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const { channelId } = route.params;
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [newPostContent, setNewPostContent] = useState('');
  const [isPosting, setIsPosting] = useState(false);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);

  // Fetch channel details
  const { data: channel, isLoading: isLoadingChannel } = useQuery({
    queryKey: ['channel', channelId],
    queryFn: async () => {
      const response = await channelsApi.get(channelId);
      return response.data as Channel;
    },
  });

  // Fetch channel posts with pagination
  const {
    data: postsData,
    isLoading: isLoadingPosts,
    refetch,
    isRefetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['channelPosts', channelId],
    queryFn: async ({ pageParam = 1 }) => {
      const response = await channelsApi.getPosts(channelId, pageParam, 20);
      return response.data as ChannelPost[];
    },
    getNextPageParam: (lastPage, allPages) => {
      return lastPage.length === 20 ? allPages.length + 1 : undefined;
    },
    initialPageParam: 1,
  });

  const posts = postsData?.pages.flat() || [];

  const isOwner = channel?.ownerId === user?.id;

  // Create post mutation
  const createPostMutation = useMutation({
    mutationFn: async (data: { content?: string; mediaUrl?: string; mediaMimeType?: string }) => {
      return channelsApi.createPost(channelId, {
        content: data.content,
        type: data.mediaUrl ? 'Image' : 'Text',
        mediaUrl: data.mediaUrl,
        mediaMimeType: data.mediaMimeType,
      });
    },
    onSuccess: () => {
      setNewPostContent('');
      queryClient.invalidateQueries({ queryKey: ['channelPosts', channelId] });
    },
    onError: (error: any) => {
      Alert.alert('Error', error?.response?.data?.message || 'Failed to create post');
    },
  });

  // Delete post mutation
  const deletePostMutation = useMutation({
    mutationFn: async (postId: string) => {
      return channelsApi.deletePost(postId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['channelPosts', channelId] });
    },
  });

  // React to post mutation
  const reactMutation = useMutation({
    mutationFn: async ({ postId, emoji }: { postId: string; emoji: string }) => {
      return channelsApi.reactToPost(postId, emoji);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['channelPosts', channelId] });
      setSelectedPostId(null);
    },
  });

  // Pin post mutation
  const pinMutation = useMutation({
    mutationFn: async ({ postId, pin }: { postId: string; pin: boolean }) => {
      return channelsApi.pinPost(postId, pin);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['channelPosts', channelId] });
    },
  });

  // Follow/unfollow mutation
  const followMutation = useMutation({
    mutationFn: async (follow: boolean) => {
      if (follow) {
        return channelsApi.follow(channelId);
      } else {
        return channelsApi.unfollow(channelId);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['channel', channelId] });
      queryClient.invalidateQueries({ queryKey: ['channels'] });
    },
  });

  const handleCreatePost = async () => {
    if (!newPostContent.trim()) return;
    setIsPosting(true);
    try {
      await createPostMutation.mutateAsync({ content: newPostContent.trim() });
    } finally {
      setIsPosting(false);
    }
  };

  const handleMediaPost = async () => {
    try {
      const result = await launchImageLibrary({
        mediaType: 'photo',
        quality: 0.8,
      });

      if (result.didCancel || !result.assets?.[0]) return;

      const asset = result.assets[0];
      if (!asset.uri) return;

      setIsPosting(true);
      const uploadResponse = await filesApi.uploadFile(asset.uri, asset.type || 'image/jpeg');
      await createPostMutation.mutateAsync({
        content: newPostContent.trim() || undefined,
        mediaUrl: uploadResponse.data.fileUrl,
        mediaMimeType: asset.type,
      });
    } catch (error) {
      Alert.alert('Error', 'Failed to upload image');
    } finally {
      setIsPosting(false);
    }
  };

  const handleDeletePost = (postId: string) => {
    Alert.alert('Delete Post', 'Are you sure you want to delete this post?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => deletePostMutation.mutate(postId),
      },
    ]);
  };

  const handlePinPost = (postId: string, currentlyPinned: boolean) => {
    pinMutation.mutate({ postId, pin: !currentlyPinned });
  };

  const formatCount = (count: number): string => {
    if (count >= 1000000) {
      return `${(count / 1000000).toFixed(1)}M`;
    }
    if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}K`;
    }
    return count.toString();
  };

  const renderPostItem = ({ item }: { item: ChannelPost }) => {
    const showReactionPicker = selectedPostId === item.id;

    return (
      <View style={styles.postItem}>
        {item.isPinned && (
          <View style={styles.pinnedBadge}>
            <Icon name="pin" size={12} color={colors.primary} />
            <Text style={styles.pinnedText}>Pinned</Text>
          </View>
        )}

        <View style={styles.postHeader}>
          <Avatar
            uri={item.authorProfilePicture}
            name={item.authorName}
            size={40}
          />
          <View style={styles.postHeaderInfo}>
            <Text style={styles.authorName}>{item.authorName}</Text>
            <Text style={styles.postTime}>
              {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
            </Text>
          </View>
          {isOwner && (
            <TouchableOpacity
              style={styles.postMenuButton}
              onPress={() => {
                Alert.alert('Post Options', '', [
                  {
                    text: item.isPinned ? 'Unpin' : 'Pin',
                    onPress: () => handlePinPost(item.id, item.isPinned),
                  },
                  {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: () => handleDeletePost(item.id),
                  },
                  { text: 'Cancel', style: 'cancel' },
                ]);
              }}
            >
              <Icon name="dots-vertical" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>

        {item.content && <Text style={styles.postContent}>{item.content}</Text>}

        {item.mediaUrl && (
          <TouchableOpacity
            onPress={() =>
              navigation.navigate('MediaViewer', {
                mediaUrl: item.mediaUrl!,
                mediaType: item.mediaMimeType || 'image/jpeg',
                senderName: item.authorName,
                timestamp: item.createdAt,
              })
            }
          >
            <Image source={{ uri: item.mediaUrl }} style={styles.postMedia} resizeMode="cover" />
          </TouchableOpacity>
        )}

        <View style={styles.postStats}>
          <View style={styles.statItem}>
            <Icon name="eye" size={16} color={colors.textSecondary} />
            <Text style={styles.statText}>{formatCount(item.viewCount)}</Text>
          </View>
          {item.reactionCount > 0 && (
            <View style={styles.statItem}>
              <Text style={styles.statText}>{formatCount(item.reactionCount)} reactions</Text>
            </View>
          )}
        </View>

        {/* Reactions display */}
        {item.reactions.length > 0 && (
          <View style={styles.reactionsDisplay}>
            {item.reactions.slice(0, 5).map((reaction, index) => (
              <View key={index} style={styles.reactionBadge}>
                <Text style={styles.reactionEmoji}>{reaction.emoji}</Text>
                <Text style={styles.reactionCount}>{reaction.count}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Action buttons */}
        <View style={styles.postActions}>
          <TouchableOpacity
            style={[styles.actionButton, !!item.myReaction && styles.actionButtonActive]}
            onPress={() => setSelectedPostId(showReactionPicker ? null : item.id)}
          >
            <Icon
              name={item.myReaction ? 'heart' : 'heart-outline'}
              size={20}
              color={item.myReaction ? colors.error : colors.textSecondary}
            />
            <Text style={[styles.actionText, !!item.myReaction && styles.actionTextActive]}>
              {item.myReaction || 'React'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Reaction picker */}
        {showReactionPicker && (
          <View style={styles.reactionPicker}>
            {REACTION_EMOJIS.map((emoji) => (
              <TouchableOpacity
                key={emoji}
                style={[
                  styles.reactionOption,
                  item.myReaction === emoji && styles.reactionOptionSelected,
                ]}
                onPress={() => reactMutation.mutate({ postId: item.id, emoji })}
              >
                <Text style={styles.reactionOptionEmoji}>{emoji}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
    );
  };

  const renderHeader = () => {
    if (!channel) return null;

    return (
      <View style={styles.channelHeader}>
        <View style={styles.channelInfo}>
          {channel.iconUrl ? (
            <Avatar uri={channel.iconUrl} name={channel.shortName} size={80} />
          ) : (
            <View style={styles.channelIcon}>
              <Icon name="bullhorn" size={40} color={colors.primary} />
            </View>
          )}
          <View style={styles.channelDetails}>
            <View style={styles.channelNameRow}>
              <Text style={styles.channelShortName}>{channel.shortName}</Text>
              {channel.isVerified && (
                <Icon name="check-decagram" size={20} color={colors.primary} />
              )}
            </View>
            <Text style={styles.channelName}>{channel.name}</Text>
            <Text style={styles.followerCount}>
              {formatCount(channel.followerCount)} followers
            </Text>
          </View>
        </View>

        {channel.description && (
          <Text style={styles.channelDescription}>{channel.description}</Text>
        )}

        {!isOwner && (
          <TouchableOpacity
            style={[styles.followButton, channel.isFollowing && styles.followingButton]}
            onPress={() => followMutation.mutate(!channel.isFollowing)}
            disabled={followMutation.isPending}
          >
            {followMutation.isPending ? (
              <ActivityIndicator size="small" color={colors.textInverse} />
            ) : (
              <Text
                style={[
                  styles.followButtonText,
                  channel.isFollowing && styles.followingButtonText,
                ]}
              >
                {channel.isFollowing ? 'Following' : 'Follow'}
              </Text>
            )}
          </TouchableOpacity>
        )}
      </View>
    );
  };

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Icon name="post-outline" size={64} color={colors.textSecondary} />
      <Text style={styles.emptyTitle}>No posts yet</Text>
      <Text style={styles.emptySubtitle}>
        {isOwner
          ? 'Share your first post with your followers!'
          : 'This channel has no posts yet. Check back later!'}
      </Text>
    </View>
  );

  if (isLoadingChannel) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
    >
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={colors.surface} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Icon name="arrow-left" size={24} color={colors.textInverse} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {channel?.shortName || 'Channel'}
        </Text>
        <TouchableOpacity style={styles.menuButton}>
          <Icon name="dots-vertical" size={24} color={colors.textInverse} />
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <FlatList
          data={posts}
          renderItem={renderPostItem}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={renderHeader}
          ListEmptyComponent={isLoadingPosts ? null : renderEmpty}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              colors={[colors.primary]}
              tintColor={colors.primary}
            />
          }
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) {
              fetchNextPage();
            }
          }}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            isFetchingNextPage ? (
              <View style={styles.loadingMore}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            ) : null
          }
          contentContainerStyle={styles.listContent}
        />

        {/* Composer (only for owners) */}
        {isOwner && (
          <View style={styles.composer}>
            <TextInput
              style={styles.composerInput}
              placeholder="Write a post..."
              placeholderTextColor={colors.textSecondary}
              value={newPostContent}
              onChangeText={setNewPostContent}
              multiline
              maxLength={2000}
            />
            <View style={styles.composerActions}>
              <TouchableOpacity style={styles.composerButton} onPress={handleMediaPost}>
                <Icon name="image" size={24} color={colors.primary} />
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.sendButton,
                  (!newPostContent.trim() || isPosting) && styles.sendButtonDisabled,
                ]}
                onPress={handleCreatePost}
                disabled={!newPostContent.trim() || isPosting}
              >
                {isPosting ? (
                  <ActivityIndicator size="small" color={colors.textInverse} />
                ) : (
                  <Icon name="send" size={20} color={colors.textInverse} />
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
};

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.primary,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.xl + 20,
    paddingBottom: SPACING.md,
  },
  backButton: {
    padding: SPACING.sm,
  },
  headerTitle: {
    flex: 1,
    fontSize: FONTS.sizes.lg,
    fontWeight: '600',
    color: colors.textInverse,
    textAlign: 'center',
    marginHorizontal: SPACING.md,
  },
  menuButton: {
    padding: SPACING.sm,
  },
  content: {
    flex: 1,
    backgroundColor: colors.surface,
    borderTopLeftRadius: BORDER_RADIUS.xl,
    borderTopRightRadius: BORDER_RADIUS.xl,
  },
  listContent: {
    flexGrow: 1,
  },
  channelHeader: {
    padding: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  channelInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  channelIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.primary + '15',
    justifyContent: 'center',
    alignItems: 'center',
  },
  channelDetails: {
    flex: 1,
    marginLeft: SPACING.md,
  },
  channelNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  channelShortName: {
    fontSize: FONTS.sizes.xl,
    fontWeight: 'bold',
    color: colors.text,
  },
  channelName: {
    fontSize: FONTS.sizes.md,
    color: colors.textSecondary,
    marginTop: 2,
  },
  followerCount: {
    fontSize: FONTS.sizes.sm,
    color: colors.textSecondary,
    marginTop: SPACING.xs,
  },
  channelDescription: {
    fontSize: FONTS.sizes.md,
    color: colors.text,
    marginTop: SPACING.md,
    lineHeight: 22,
  },
  followButton: {
    backgroundColor: colors.primary,
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.lg,
    alignItems: 'center',
    marginTop: SPACING.lg,
  },
  followingButton: {
    backgroundColor: colors.inputBackground,
  },
  followButtonText: {
    fontSize: FONTS.sizes.md,
    fontWeight: '600',
    color: colors.textInverse,
  },
  followingButtonText: {
    color: colors.textSecondary,
  },
  postItem: {
    padding: SPACING.md,
    backgroundColor: colors.surface,
  },
  pinnedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.sm,
    gap: 4,
  },
  pinnedText: {
    fontSize: FONTS.sizes.xs,
    color: colors.primary,
    fontWeight: '500',
  },
  postHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  postHeaderInfo: {
    flex: 1,
    marginLeft: SPACING.sm,
  },
  authorName: {
    fontSize: FONTS.sizes.md,
    fontWeight: '600',
    color: colors.text,
  },
  postTime: {
    fontSize: FONTS.sizes.xs,
    color: colors.textSecondary,
    marginTop: 2,
  },
  postMenuButton: {
    padding: SPACING.sm,
  },
  postContent: {
    fontSize: FONTS.sizes.md,
    color: colors.text,
    lineHeight: 22,
    marginTop: SPACING.sm,
  },
  postMedia: {
    width: '100%',
    height: 200,
    borderRadius: BORDER_RADIUS.md,
    marginTop: SPACING.sm,
  },
  postStats: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: SPACING.sm,
    gap: SPACING.md,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statText: {
    fontSize: FONTS.sizes.sm,
    color: colors.textSecondary,
  },
  reactionsDisplay: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: SPACING.sm,
    gap: SPACING.xs,
  },
  reactionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.inputBackground,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: BORDER_RADIUS.lg,
    gap: 4,
  },
  reactionEmoji: {
    fontSize: 14,
  },
  reactionCount: {
    fontSize: FONTS.sizes.xs,
    color: colors.textSecondary,
  },
  postActions: {
    flexDirection: 'row',
    marginTop: SPACING.md,
    paddingTop: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    gap: SPACING.xs,
  },
  actionButtonActive: {
    backgroundColor: colors.error + '10',
    borderRadius: BORDER_RADIUS.md,
  },
  actionText: {
    fontSize: FONTS.sizes.sm,
    color: colors.textSecondary,
  },
  actionTextActive: {
    color: colors.error,
  },
  reactionPicker: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: colors.inputBackground,
    padding: SPACING.sm,
    borderRadius: BORDER_RADIUS.lg,
    marginTop: SPACING.sm,
  },
  reactionOption: {
    padding: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
  },
  reactionOptionSelected: {
    backgroundColor: colors.primary + '20',
  },
  reactionOptionEmoji: {
    fontSize: 24,
  },
  separator: {
    height: 8,
    backgroundColor: colors.background,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xxl,
    minHeight: 300,
  },
  emptyTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: '600',
    color: colors.text,
    marginTop: SPACING.md,
  },
  emptySubtitle: {
    fontSize: FONTS.sizes.md,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: SPACING.sm,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    backgroundColor: colors.surface,
  },
  composerInput: {
    flex: 1,
    backgroundColor: colors.inputBackground,
    borderRadius: BORDER_RADIUS.lg,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    fontSize: FONTS.sizes.md,
    color: colors.text,
    maxHeight: 100,
  },
  composerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: SPACING.sm,
    gap: SPACING.sm,
  },
  composerButton: {
    padding: SPACING.sm,
  },
  sendButton: {
    backgroundColor: colors.primary,
    padding: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  loadingMore: {
    padding: SPACING.md,
    alignItems: 'center',
  },
});

export default ChannelScreen;
