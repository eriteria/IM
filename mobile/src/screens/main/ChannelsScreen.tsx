import React, { useCallback, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import Avatar from '../../components/Avatar';
import { channelsApi } from '../../services/api';
import { RootStackParamList } from '../../navigation/RootNavigator';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { FONTS, SPACING, BORDER_RADIUS } from '../../utils/theme';

type ChannelsScreenNavigationProp = NativeStackNavigationProp<RootStackParamList>;

type FilterType = 'all' | 'following';

interface Channel {
  id: string;
  name: string;
  shortName: string;
  description?: string;
  iconUrl?: string;
  followerCount: number;
  isFollowing: boolean;
  isVerified?: boolean;
  isMuted?: boolean;
  unreadCount?: number;
  lastMessage?: {
    content: string;
    createdAt: string;
  };
}

const ChannelsScreen: React.FC = () => {
  const navigation = useNavigation<ChannelsScreenNavigationProp>();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const queryClient = useQueryClient();
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');

  const { data: channels, isLoading, refetch, isRefetching, isError } = useQuery({
    queryKey: ['channels'],
    queryFn: async () => {
      const response = await channelsApi.getAll();
      return response.data as Channel[];
    },
  });

  const followMutation = useMutation({
    mutationFn: async ({ channelId, follow }: { channelId: string; follow: boolean }) => {
      if (follow) {
        return channelsApi.follow(channelId);
      } else {
        return channelsApi.unfollow(channelId);
      }
    },
    onMutate: async ({ channelId, follow }) => {
      // Optimistic update
      await queryClient.cancelQueries({ queryKey: ['channels'] });
      const previousChannels = queryClient.getQueryData(['channels']);

      queryClient.setQueryData(['channels'], (old: Channel[] | undefined) =>
        old?.map((channel) =>
          channel.id === channelId
            ? { ...channel, isFollowing: follow }
            : channel
        )
      );

      return { previousChannels };
    },
    onError: (_err, _variables, context) => {
      // Rollback on error
      if (context?.previousChannels) {
        queryClient.setQueryData(['channels'], context.previousChannels);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['channels'] });
    },
  });

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  const filteredChannels = React.useMemo(() => {
    if (!channels) return [];

    // Filter by tab
    if (activeFilter === 'following') {
      return channels.filter((channel) => channel.isFollowing);
    }

    return channels;
  }, [channels, activeFilter]);

  const followingCount = React.useMemo(() => {
    return channels?.filter((c) => c.isFollowing).length || 0;
  }, [channels]);

  const handleFollowPress = (channel: Channel) => {
    followMutation.mutate({ channelId: channel.id, follow: !channel.isFollowing });
  };

  const handleChannelPress = (channel: Channel) => {
    navigation.navigate('Channel', {
      channelId: channel.id,
    });
  };

  const formatMemberCount = (count?: number): string => {
    if (!count && count !== 0) return '0';
    if (count >= 1000000) {
      return `${(count / 1000000).toFixed(1)}M`;
    }
    if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}K`;
    }
    return count.toString();
  };

  const renderChannelItem = ({ item }: { item: Channel }) => {
    const hasUnread = (item.unreadCount || 0) > 0;

    return (
      <TouchableOpacity
        style={styles.channelItem}
        onPress={() => handleChannelPress(item)}
        activeOpacity={0.7}
      >
        <View style={styles.channelIconContainer}>
          {item.iconUrl ? (
            <Avatar uri={item.iconUrl} name={item.shortName} size={54} />
          ) : (
            <View style={styles.defaultIcon}>
              <Icon name="bullhorn" size={26} color={colors.primary} />
            </View>
          )}
          {hasUnread && (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadBadgeText}>
                {item.unreadCount! > 99 ? '99+' : item.unreadCount}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.channelInfo}>
          <View style={styles.channelHeader}>
            <Text style={[styles.channelShortName, hasUnread && styles.channelNameUnread]} numberOfLines={1}>
              {item.shortName}
            </Text>
            {item.isVerified && (
              <Icon name="check-decagram" size={16} color={colors.primary} style={styles.verifiedIcon} />
            )}
            {item.isMuted && (
              <Icon name="bell-off" size={14} color={colors.textSecondary} style={styles.mutedIcon} />
            )}
          </View>
          <Text style={styles.channelName} numberOfLines={1}>
            {item.name}
          </Text>
          <View style={styles.channelMeta}>
            <Icon name="account-group" size={12} color={colors.textSecondary} />
            <Text style={styles.memberCount}>{formatMemberCount(item.followerCount)} followers</Text>
            {item.lastMessage && (
              <>
                <Text style={styles.metaSeparator}>•</Text>
                <Text style={styles.lastMessageTime}>
                  {formatDistanceToNow(new Date(item.lastMessage.createdAt), { addSuffix: true })}
                </Text>
              </>
            )}
          </View>
          {item.lastMessage && (
            <Text style={[styles.lastMessageContent, hasUnread && styles.lastMessageUnread]} numberOfLines={1}>
              {item.lastMessage.content}
            </Text>
          )}
        </View>

        <TouchableOpacity
          style={[
            styles.followButton,
            item.isFollowing && styles.followingButton,
          ]}
          onPress={() => handleFollowPress(item)}
          activeOpacity={0.7}
          disabled={followMutation.isPending}
        >
          {followMutation.isPending && followMutation.variables?.channelId === item.id ? (
            <ActivityIndicator size="small" color={item.isFollowing ? colors.textSecondary : colors.textInverse} />
          ) : (
            <Text
              style={[
                styles.followButtonText,
                item.isFollowing && styles.followingButtonText,
              ]}
            >
              {item.isFollowing ? 'Following' : 'Follow'}
            </Text>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  const renderEmptyList = () => {
    if (isLoading) {
      return (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading channels...</Text>
        </View>
      );
    }

    if (isError) {
      return (
        <View style={styles.emptyContainer}>
          <View style={styles.emptyIconContainer}>
            <Icon name="alert-circle-outline" size={64} color={colors.error} />
          </View>
          <Text style={styles.emptyTitle}>Failed to load channels</Text>
          <Text style={styles.emptySubtitle}>
            Please check your connection and try again
          </Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
            <Icon name="refresh" size={20} color={colors.textInverse} />
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (activeFilter === 'following') {
      return (
        <View style={styles.emptyContainer}>
          <View style={styles.emptyIconContainer}>
            <Icon name="broadcast" size={64} color={colors.primary} />
          </View>
          <Text style={styles.emptyTitle}>No channels followed</Text>
          <Text style={styles.emptySubtitle}>
            Follow channels to see their updates here
          </Text>
          <TouchableOpacity
            style={styles.browseButton}
            onPress={() => setActiveFilter('all')}
          >
            <Text style={styles.browseButtonText}>Browse Channels</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View style={styles.emptyContainer}>
        <View style={styles.emptyIconContainer}>
          <Icon name="broadcast" size={64} color={colors.primary} />
        </View>
        <Text style={styles.emptyTitle}>No channels available</Text>
        <Text style={styles.emptySubtitle}>
          Official channels will appear here
        </Text>
      </View>
    );
  };

  const renderFilterTab = (filter: FilterType, label: string, count?: number) => {
    const isActive = activeFilter === filter;
    return (
      <TouchableOpacity
        style={[styles.filterTab, isActive && styles.filterTabActive]}
        onPress={() => setActiveFilter(filter)}
        activeOpacity={0.7}
      >
        <Text style={[styles.filterTabText, isActive && styles.filterTabTextActive]}>
          {label}
        </Text>
        {count !== undefined && (
          <View style={[styles.filterBadge, isActive && styles.filterBadgeActive]}>
            <Text style={[styles.filterBadgeText, isActive && styles.filterBadgeTextActive]}>
              {count}
            </Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={colors.surface} />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Channels</Text>
        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.headerButton}
            onPress={() => navigation.navigate('Search')}
          >
            <Icon name="magnify" size={24} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerButton}
            onPress={() => navigation.navigate('CreateChannel')}
          >
            <Icon name="plus" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Filter Tabs */}
      <View style={styles.filterContainer}>
        {renderFilterTab('all', 'All', channels?.length || 0)}
        {renderFilterTab('following', 'Following', followingCount)}
      </View>

      <FlatList
        data={filteredChannels}
        renderItem={renderChannelItem}
        keyExtractor={(item) => item.id}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={renderEmptyList}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
        contentContainerStyle={!filteredChannels?.length ? styles.emptyListContent : styles.listContent}
        showsVerticalScrollIndicator={false}
      />

      {/* FAB - Create Channel Button */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => navigation.navigate('CreateChannel')}
        activeOpacity={0.8}
      >
        <Icon name="bullhorn-variant" size={26} color={colors.textInverse} />
      </TouchableOpacity>
    </View>
  );
};

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
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
  filterContainer: {
    flexDirection: 'row',
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.md,
    gap: SPACING.sm,
  },
  filterTab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.lg,
    backgroundColor: 'transparent',
  },
  filterTabActive: {
    backgroundColor: colors.primary + '15',
  },
  filterTabText: {
    fontSize: FONTS.sizes.sm,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  filterTabTextActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  filterBadge: {
    marginLeft: SPACING.xs,
    backgroundColor: colors.textSecondary + '30',
    borderRadius: BORDER_RADIUS.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  filterBadgeActive: {
    backgroundColor: colors.primary + '20',
  },
  filterBadgeText: {
    fontSize: FONTS.sizes.xs,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  filterBadgeTextActive: {
    color: colors.primary,
  },
  listContent: {
    paddingBottom: 100,
  },
  fab: {
    position: 'absolute',
    right: SPACING.lg,
    bottom: 90,
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
  channelItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.md,
    paddingHorizontal: SPACING.lg,
  },
  channelIconContainer: {
    position: 'relative',
    marginRight: SPACING.md,
  },
  defaultIcon: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: colors.primary + '15',
    justifyContent: 'center',
    alignItems: 'center',
  },
  unreadBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  unreadBadgeText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: colors.textInverse,
  },
  channelInfo: {
    flex: 1,
  },
  channelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  channelShortName: {
    fontSize: FONTS.sizes.md,
    fontWeight: '600',
    color: colors.text,
    flexShrink: 1,
  },
  channelNameUnread: {
    fontWeight: 'bold',
  },
  verifiedIcon: {
    marginLeft: 4,
  },
  mutedIcon: {
    marginLeft: 4,
  },
  channelName: {
    fontSize: FONTS.sizes.sm,
    color: colors.textSecondary,
    marginTop: 1,
  },
  channelMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 4,
  },
  memberCount: {
    fontSize: FONTS.sizes.xs,
    color: colors.textSecondary,
  },
  metaSeparator: {
    fontSize: FONTS.sizes.xs,
    color: colors.textSecondary,
  },
  lastMessageTime: {
    fontSize: FONTS.sizes.xs,
    color: colors.textSecondary,
  },
  lastMessageContent: {
    fontSize: FONTS.sizes.sm,
    color: colors.textSecondary,
    marginTop: 4,
  },
  lastMessageUnread: {
    color: colors.text,
    fontWeight: '500',
  },
  followButton: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.lg,
    backgroundColor: colors.primary,
    minWidth: 80,
    alignItems: 'center',
  },
  followingButton: {
    backgroundColor: colors.inputBackground,
  },
  followButtonText: {
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
    color: colors.textInverse,
  },
  followingButtonText: {
    color: colors.textSecondary,
  },
  separator: {
    height: 1,
    backgroundColor: colors.divider,
    marginLeft: 86,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xxl,
  },
  loadingText: {
    fontSize: FONTS.sizes.md,
    color: colors.textSecondary,
    marginTop: SPACING.md,
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
    lineHeight: 22,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.lg,
    marginTop: SPACING.xl,
    gap: SPACING.sm,
  },
  retryButtonText: {
    fontSize: FONTS.sizes.md,
    fontWeight: '600',
    color: colors.textInverse,
  },
  browseButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.lg,
    marginTop: SPACING.xl,
  },
  browseButtonText: {
    fontSize: FONTS.sizes.md,
    fontWeight: '600',
    color: colors.textInverse,
  },
});

export default ChannelsScreen;
