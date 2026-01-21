import React, { useMemo } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from '../context/ThemeContext';
import { FONTS, SPACING, BORDER_RADIUS } from '../utils/theme';
import { useChatStore } from '../stores/chatStore';
import { useAuthStore } from '../stores/authStore';
import { callsApi, channelsApi } from '../services/api';
import { Call } from '../types';

import ChatsScreen from '../screens/main/ChatsScreen';
import GroupsScreen from '../screens/main/GroupsScreen';
import CallsScreen from '../screens/main/CallsScreen';
import ChannelsScreen from '../screens/main/ChannelsScreen';
import SettingsScreen from '../screens/main/SettingsScreen';

interface Channel {
  id: string;
  unreadCount?: number;
  isFollowing: boolean;
}

export type MainTabParamList = {
  Chats: undefined;
  Groups: undefined;
  Calls: undefined;
  Channels: undefined;
  Settings: undefined;
};

const Tab = createBottomTabNavigator<MainTabParamList>();

interface TabIconProps {
  name: string;
  focused: boolean;
  color: string;
  size: number;
  badge?: number;
  badgeColor: string;
  badgeTextColor: string;
}

const TabIcon: React.FC<TabIconProps> = ({ name, focused, color, size, badge, badgeColor, badgeTextColor }) => (
  <View style={staticStyles.iconContainer}>
    <Icon name={name} size={size} color={color} />
    {badge !== undefined && badge > 0 && (
      <View style={[staticStyles.badge, { backgroundColor: badgeColor }]}>
        <Text style={[staticStyles.badgeText, { color: badgeTextColor }]}>{badge > 99 ? '99+' : badge}</Text>
      </View>
    )}
  </View>
);

const MainTabNavigator: React.FC = () => {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const conversations = useChatStore((state) => state.conversations);
  const { userId } = useAuthStore();

  // Calculate unread counts for chats (private only) and groups separately
  const { chatsUnreadCount, groupsUnreadCount } = useMemo(() => {
    let chats = 0;
    let groups = 0;
    conversations.forEach((conv) => {
      if (!conv.isArchived && !conv.isDeleted && conv.unreadCount > 0) {
        if (conv.type === 'Private') {
          chats += conv.unreadCount;
        } else if (conv.type === 'Group') {
          groups += conv.unreadCount;
        }
      }
    });
    return { chatsUnreadCount: chats, groupsUnreadCount: groups };
  }, [conversations]);

  // Fetch missed calls count
  const { data: calls } = useQuery({
    queryKey: ['callHistory'],
    queryFn: async () => {
      const response = await callsApi.getHistory();
      return response.data as Call[];
    },
    staleTime: 30000, // Cache for 30 seconds
  });

  const missedCallsCount = useMemo(() => {
    if (!calls || !userId) return 0;
    return calls.filter((call) => {
      const isMissed = call.status === 'Missed' || call.status === 'Declined';
      const isIncoming = call.initiatorId !== userId;
      return isMissed && isIncoming;
    }).length;
  }, [calls, userId]);

  // Fetch channels unread count
  const { data: channels } = useQuery({
    queryKey: ['channels'],
    queryFn: async () => {
      const response = await channelsApi.getAll();
      return response.data as Channel[];
    },
    staleTime: 30000, // Cache for 30 seconds
  });

  const channelsUnreadCount = useMemo(() => {
    if (!channels) return 0;
    return channels
      .filter((channel) => channel.isFollowing)
      .reduce((total, channel) => total + (channel.unreadCount || 0), 0);
  }, [channels]);

  // Calculate tab bar height with safe area insets for iOS Home Indicator
  // Base height is 56px for the tab bar content
  const tabBarBaseHeight = 56;
  const bottomInset = insets.bottom;
  // Use 70% of the safe area to position the bar slightly above the home indicator
  const bottomPadding = Math.max(bottomInset * 0.7, 4);

  const tabBarStyle = useMemo(() => ({
    backgroundColor: colors.tabBar,
    borderTopWidth: 0,
    height: tabBarBaseHeight + bottomPadding,
    paddingTop: SPACING.xs,
    paddingBottom: bottomPadding,
    borderTopLeftRadius: BORDER_RADIUS.xl,
    borderTopRightRadius: BORDER_RADIUS.xl,
    position: 'absolute' as const,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    borderTopColor: colors.divider,
  }), [colors, bottomPadding]);

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: colors.header },
        headerTintColor: colors.headerText,
        headerTitleStyle: { fontWeight: 'bold' },
        tabBarStyle: tabBarStyle,
        tabBarActiveTintColor: colors.tabBarActive,
        tabBarInactiveTintColor: colors.tabBarInactive,
        tabBarLabelStyle: staticStyles.tabBarLabel,
        tabBarItemStyle: staticStyles.tabBarItem,
        tabBarIcon: ({ focused, color, size }) => {
          let iconName: string;

          switch (route.name) {
            case 'Chats':
              iconName = focused ? 'chat' : 'chat-outline';
              break;
            case 'Groups':
              iconName = focused ? 'account-group' : 'account-group-outline';
              break;
            case 'Calls':
              iconName = focused ? 'phone' : 'phone-outline';
              break;
            case 'Channels':
              iconName = focused ? 'bullhorn' : 'bullhorn-outline';
              break;
            case 'Settings':
              iconName = focused ? 'cog' : 'cog-outline';
              break;
            default:
              iconName = 'help';
          }

          if (route.name === 'Chats') {
            return (
              <TabIcon
                name={iconName}
                focused={focused}
                color={color}
                size={24}
                badge={chatsUnreadCount}
                badgeColor={colors.secondary}
                badgeTextColor={colors.textInverse}
              />
            );
          }

          if (route.name === 'Groups') {
            return (
              <TabIcon
                name={iconName}
                focused={focused}
                color={color}
                size={24}
                badge={groupsUnreadCount}
                badgeColor={colors.primary}
                badgeTextColor={colors.textInverse}
              />
            );
          }

          if (route.name === 'Calls') {
            return (
              <TabIcon
                name={iconName}
                focused={focused}
                color={color}
                size={24}
                badge={missedCallsCount}
                badgeColor={colors.error}
                badgeTextColor={colors.textInverse}
              />
            );
          }

          if (route.name === 'Channels') {
            return (
              <TabIcon
                name={iconName}
                focused={focused}
                color={color}
                size={24}
                badge={channelsUnreadCount}
                badgeColor={colors.primary}
                badgeTextColor={colors.textInverse}
              />
            );
          }

          return <Icon name={iconName} size={24} color={color} />;
        },
      })}
    >
      <Tab.Screen
        name="Chats"
        component={ChatsScreen}
        options={{
          title: 'Chats',
          headerShown: false,
        }}
      />
      <Tab.Screen
        name="Groups"
        component={GroupsScreen}
        options={{
          title: 'Groups',
          headerShown: false,
        }}
      />
      <Tab.Screen
        name="Calls"
        component={CallsScreen}
        options={{
          title: 'Calls',
          headerShown: false,
        }}
      />
      <Tab.Screen
        name="Channels"
        component={ChannelsScreen}
        options={{
          title: 'Channels',
          headerShown: false,
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          title: 'Settings',
          headerShown: false,
        }}
      />
    </Tab.Navigator>
  );
};

const staticStyles = StyleSheet.create({
  tabBarLabel: {
    fontSize: FONTS.sizes.xs,
    fontWeight: '500',
    marginTop: 2,
  },
  tabBarItem: {
    paddingVertical: SPACING.xs,
  },
  iconContainer: {
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -10,
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: 'bold',
  },
});

export default MainTabNavigator;
