import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  StatusBar,
  Modal,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, isToday, isYesterday, isSameDay } from 'date-fns';
import { Swipeable } from 'react-native-gesture-handler';
import Avatar from '../../components/Avatar';
import GroupAvatar from '../../components/GroupAvatar';
import { callsApi } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import { RootStackParamList } from '../../navigation/RootNavigator';
import { Call } from '../../types';
import { useTheme } from '../../context/ThemeContext';
import { FONTS, SPACING, BORDER_RADIUS } from '../../utils/theme';
import { ThemeColors } from '../../context/ThemeContext';

type CallsScreenNavigationProp = NativeStackNavigationProp<RootStackParamList>;

type FilterType = 'all' | 'missed';

interface CallWithSection extends Call {
  sectionHeader?: string;
}

const CallsScreen: React.FC = () => {
  const navigation = useNavigation<CallsScreenNavigationProp>();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const queryClient = useQueryClient();
  const { userId } = useAuthStore();
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [selectedCall, setSelectedCall] = useState<Call | null>(null);
  const [showCallInfo, setShowCallInfo] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);

  const { data: calls, isLoading, refetch } = useQuery({
    queryKey: ['callHistory'],
    queryFn: async () => {
      const response = await callsApi.getHistory();
      return response.data as Call[];
    },
  });

  // Delete call mutation
  const deleteCallMutation = useMutation({
    mutationFn: async (callId: string) => {
      await callsApi.deleteCall(callId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['callHistory'] });
    },
    onError: () => {
      Alert.alert('Error', 'Failed to delete call from history');
    },
  });

  // Clear all calls mutation
  const clearAllCallsMutation = useMutation({
    mutationFn: async () => {
      await callsApi.clearHistory();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['callHistory'] });
      setIsEditMode(false);
    },
    onError: () => {
      Alert.alert('Error', 'Failed to clear call history');
    },
  });

  // Helper function to check if a call is missed
  const isCallMissed = (call: Call): boolean => {
    const isOutgoing = call.initiatorId === userId;
    const callStatusMissed = call.status === 'Missed' || call.status === 'Declined';
    const currentUserParticipant = call.participants.find((p) => p.userId === userId);
    const participantMissed = currentUserParticipant?.status === 'Missed' || currentUserParticipant?.status === 'Declined';
    const otherParticipants = call.participants.filter((p) => p.userId !== userId);
    const allOthersMissed = isOutgoing && otherParticipants.length > 0 &&
      otherParticipants.every((p) => p.status === 'Missed' || p.status === 'Declined');

    return callStatusMissed || participantMissed || allOthersMissed;
  };

  // Filtered and sectioned calls
  const sectionedCalls = React.useMemo(() => {
    if (!calls) return [];

    let filteredCalls = calls;
    if (activeFilter === 'missed') {
      filteredCalls = calls.filter((c) => isCallMissed(c));
    }

    // Add section headers based on date
    const result: CallWithSection[] = [];
    let lastDate: Date | null = null;

    filteredCalls.forEach((call) => {
      const callDate = new Date(call.startedAt);

      if (!lastDate || !isSameDay(callDate, lastDate)) {
        // Add section header
        let header: string;
        if (isToday(callDate)) {
          header = 'Today';
        } else if (isYesterday(callDate)) {
          header = 'Yesterday';
        } else {
          header = format(callDate, 'EEEE, MMMM d');
        }
        result.push({ ...call, sectionHeader: header });
        lastDate = callDate;
      } else {
        result.push(call);
      }
    });

    return result;
  }, [calls, activeFilter]);

  const formatCallTime = (dateString: string): string => {
    const date = new Date(dateString);
    return format(date, 'HH:mm');
  };

  const formatDuration = (seconds?: number): string => {
    if (!seconds || seconds === 0) return '';

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  const getCallInfo = (call: Call): { icon: string; color: string; label: string } => {
    const isOutgoing = call.initiatorId === userId;

    // Check both call status AND participant status for missed calls
    // When a call ends without being answered:
    // - call.status = 'Ended'
    // - participant.status = 'Missed' (for unanswered participants)
    const callStatusMissed = call.status === 'Missed' || call.status === 'Declined';

    // Also check if the current user's participant status is Missed
    const currentUserParticipant = call.participants.find((p) => p.userId === userId);
    const participantMissed = currentUserParticipant?.status === 'Missed' || currentUserParticipant?.status === 'Declined';

    // For outgoing calls, check if all other participants missed/declined
    const otherParticipants = call.participants.filter((p) => p.userId !== userId);
    const allOthersMissed = isOutgoing && otherParticipants.length > 0 &&
      otherParticipants.every((p) => p.status === 'Missed' || p.status === 'Declined');

    const isMissed = callStatusMissed || participantMissed || allOthersMissed;

    if (isMissed) {
      // For outgoing calls where recipients missed, show as "No answer"
      if (isOutgoing && allOthersMissed && !participantMissed) {
        return { icon: 'phone-missed', color: colors.error, label: 'No Answer' };
      }
      return { icon: 'phone-missed', color: colors.error, label: 'Missed' };
    }
    if (isOutgoing) {
      return { icon: 'phone-outgoing', color: colors.textSecondary, label: 'Outgoing' };
    }
    return { icon: 'phone-incoming', color: colors.primary, label: 'Incoming' };
  };

  const isGroupCall = (call: Call): boolean => {
    return call.participants.length > 2;
  };

  const getCallDisplayInfo = (call: Call): { name: string; avatarUri?: string; participants?: { profilePictureUrl?: string; displayName?: string }[] } => {
    if (isGroupCall(call)) {
      // For group calls, show all participant names
      const otherParticipants = call.participants.filter((p) => p.userId !== userId);
      const names = otherParticipants.map((p) => p.displayName || 'Unknown').join(', ');
      return {
        name: names || 'Group Call',
        participants: otherParticipants.slice(0, 3),
      };
    }

    // For 1-on-1 calls
    const otherParticipant = call.initiatorId === userId
      ? call.participants.find((p) => p.userId !== userId)
      : call.participants.find((p) => p.userId === call.initiatorId);

    return {
      name: otherParticipant?.displayName || 'Unknown',
      avatarUri: otherParticipant?.profilePictureUrl,
    };
  };

  const handleCallPress = (call: Call) => {
    if (isEditMode) return;

    navigation.navigate('Call', {
      conversationId: call.conversationId,
      type: call.type,
    });
  };

  const handleInfoPress = (call: Call) => {
    setSelectedCall(call);
    setShowCallInfo(true);
  };

  const handleDeleteCall = useCallback((callId: string) => {
    Alert.alert(
      'Delete Call',
      'Are you sure you want to remove this call from your history?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteCallMutation.mutate(callId),
        },
      ]
    );
  }, [deleteCallMutation]);

  const handleClearAll = () => {
    Alert.alert(
      'Clear All Calls',
      'Are you sure you want to remove all calls from your history? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: () => clearAllCallsMutation.mutate(),
        },
      ]
    );
  };

  const handleNewCall = () => {
    navigation.navigate('NewChat');
  };

  const renderRightActions = (callId: string) => {
    return (
      <TouchableOpacity
        style={styles.deleteAction}
        onPress={() => handleDeleteCall(callId)}
      >
        <Icon name="trash-can-outline" size={24} color={colors.textInverse} />
        <Text style={styles.deleteActionText}>Delete</Text>
      </TouchableOpacity>
    );
  };

  const renderCallItem = ({ item }: { item: CallWithSection }) => {
    const displayInfo = getCallDisplayInfo(item);
    const callInfo = getCallInfo(item);
    const isMissed = isCallMissed(item);
    const isVideo = item.type === 'Video';
    const isGroup = isGroupCall(item);
    const duration = formatDuration(item.duration);

    return (
      <>
        {item.sectionHeader && (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionHeaderText}>{item.sectionHeader}</Text>
          </View>
        )}
        <Swipeable
          renderRightActions={() => renderRightActions(item.id)}
          overshootRight={false}
        >
          <TouchableOpacity
            style={styles.callItem}
            onPress={() => handleCallPress(item)}
            activeOpacity={0.7}
          >
            {isEditMode && (
              <TouchableOpacity
                style={styles.deleteButton}
                onPress={() => handleDeleteCall(item.id)}
              >
                <Icon name="minus-circle" size={22} color={colors.error} />
              </TouchableOpacity>
            )}

            <View style={styles.avatarContainer}>
              {isGroup && displayInfo.participants ? (
                <GroupAvatar
                  participants={displayInfo.participants}
                  size={50}
                />
              ) : (
                <Avatar
                  uri={displayInfo.avatarUri}
                  name={displayInfo.name}
                  size={50}
                />
              )}
              {isVideo && (
                <View style={styles.videoIndicator}>
                  <Icon name="video" size={10} color={colors.textInverse} />
                </View>
              )}
            </View>

            <View style={styles.callInfo}>
              <Text
                style={[styles.callName, isMissed && styles.callNameMissed]}
                numberOfLines={1}
              >
                {displayInfo.name}
              </Text>
              <View style={styles.callMeta}>
                <Icon name={callInfo.icon} size={14} color={callInfo.color} />
                <Text style={[styles.callLabel, isMissed && styles.callLabelMissed]}>
                  {callInfo.label}
                </Text>
                {duration && (
                  <>
                    <Text style={styles.callDurationSeparator}>•</Text>
                    <Text style={styles.callDuration}>{duration}</Text>
                  </>
                )}
                {isGroup && (
                  <>
                    <Text style={styles.callDurationSeparator}>•</Text>
                    <Icon name="account-group" size={14} color={colors.textSecondary} />
                  </>
                )}
              </View>
            </View>

            <View style={styles.callRight}>
              <Text style={styles.callTime}>{formatCallTime(item.startedAt)}</Text>
              <TouchableOpacity
                style={styles.infoButton}
                onPress={() => handleInfoPress(item)}
                activeOpacity={0.7}
              >
                <Icon name="information-outline" size={22} color={colors.primary} />
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Swipeable>
      </>
    );
  };

  const renderEmptyList = () => (
    <View style={styles.emptyContainer}>
      <View style={styles.emptyIconContainer}>
        <Icon name="phone-clock" size={64} color={colors.primary} />
      </View>
      <Text style={styles.emptyTitle}>No call history</Text>
      <Text style={styles.emptySubtitle}>
        Your voice and video call history will appear here
      </Text>
    </View>
  );

  const renderCallInfoModal = () => {
    if (!selectedCall) return null;

    const displayInfo = getCallDisplayInfo(selectedCall);
    const callInfo = getCallInfo(selectedCall);
    const isGroup = isGroupCall(selectedCall);
    const duration = formatDuration(selectedCall.duration);

    return (
      <Modal
        visible={showCallInfo}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCallInfo(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Call Info</Text>
              <TouchableOpacity onPress={() => setShowCallInfo(false)}>
                <Icon name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              {/* Caller Info */}
              <View style={styles.modalCallerInfo}>
                {isGroup && displayInfo.participants ? (
                  <GroupAvatar participants={displayInfo.participants} size={80} />
                ) : (
                  <Avatar uri={displayInfo.avatarUri} name={displayInfo.name} size={80} />
                )}
                <Text style={styles.modalCallerName}>{displayInfo.name}</Text>
              </View>

              {/* Call Details */}
              <View style={styles.modalDetails}>
                <View style={styles.modalDetailRow}>
                  <Icon name={callInfo.icon} size={20} color={callInfo.color} />
                  <Text style={styles.modalDetailLabel}>Type</Text>
                  <Text style={styles.modalDetailValue}>
                    {selectedCall.type === 'Video' ? 'Video Call' : 'Voice Call'} ({callInfo.label})
                  </Text>
                </View>

                <View style={styles.modalDetailRow}>
                  <Icon name="calendar" size={20} color={colors.textSecondary} />
                  <Text style={styles.modalDetailLabel}>Date</Text>
                  <Text style={styles.modalDetailValue}>
                    {format(new Date(selectedCall.startedAt), 'EEEE, MMMM d, yyyy')}
                  </Text>
                </View>

                <View style={styles.modalDetailRow}>
                  <Icon name="clock-outline" size={20} color={colors.textSecondary} />
                  <Text style={styles.modalDetailLabel}>Time</Text>
                  <Text style={styles.modalDetailValue}>
                    {format(new Date(selectedCall.startedAt), 'HH:mm')}
                    {selectedCall.endedAt && ` - ${format(new Date(selectedCall.endedAt), 'HH:mm')}`}
                  </Text>
                </View>

                {duration && (
                  <View style={styles.modalDetailRow}>
                    <Icon name="timer-outline" size={20} color={colors.textSecondary} />
                    <Text style={styles.modalDetailLabel}>Duration</Text>
                    <Text style={styles.modalDetailValue}>{duration}</Text>
                  </View>
                )}

                {isGroup && (
                  <View style={styles.modalDetailRow}>
                    <Icon name="account-group" size={20} color={colors.textSecondary} />
                    <Text style={styles.modalDetailLabel}>Participants</Text>
                    <Text style={styles.modalDetailValue}>{selectedCall.participants.length}</Text>
                  </View>
                )}
              </View>

              {/* Actions */}
              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.modalActionButton}
                  onPress={() => {
                    setShowCallInfo(false);
                    handleCallPress(selectedCall);
                  }}
                >
                  <Icon
                    name={selectedCall.type === 'Video' ? 'video' : 'phone'}
                    size={24}
                    color={colors.textInverse}
                  />
                  <Text style={styles.modalActionText}>Call Again</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.modalActionButton, styles.modalActionButtonSecondary]}
                  onPress={() => {
                    setShowCallInfo(false);
                    navigation.navigate('Chat', { conversationId: selectedCall.conversationId });
                  }}
                >
                  <Icon name="message-text" size={24} color={colors.primary} />
                  <Text style={[styles.modalActionText, styles.modalActionTextSecondary]}>Message</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={colors.surface} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.editButton}
          onPress={() => {
            if (isEditMode) {
              setIsEditMode(false);
            } else if (sectionedCalls.length > 0) {
              setIsEditMode(true);
            }
          }}
        >
          <Text style={styles.editButtonText}>
            {isEditMode ? 'Done' : 'Edit'}
          </Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Calls</Text>
        <TouchableOpacity style={styles.newCallButton} onPress={handleNewCall}>
          <Icon name="phone-plus" size={24} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {/* Filter Row */}
      <View style={styles.filterRow}>
        {isEditMode ? (
          <TouchableOpacity onPress={handleClearAll}>
            <Text style={styles.clearAllText}>Clear All</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 60 }} />
        )}

        <View style={styles.filterTabs}>
          <TouchableOpacity
            style={[styles.filterTab, activeFilter === 'all' && styles.filterTabActive]}
            onPress={() => setActiveFilter('all')}
            activeOpacity={0.7}
          >
            <Text style={[styles.filterTabText, activeFilter === 'all' && styles.filterTabTextActive]}>
              All
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterTab, activeFilter === 'missed' && styles.filterTabActive]}
            onPress={() => setActiveFilter('missed')}
            activeOpacity={0.7}
          >
            <Text style={[styles.filterTabText, activeFilter === 'missed' && styles.filterTabTextActive]}>
              Missed
            </Text>
          </TouchableOpacity>
        </View>

        <View style={{ width: 60 }} />
      </View>

      <FlatList
        data={sectionedCalls}
        renderItem={renderCallItem}
        keyExtractor={(item) => item.id}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={!isLoading ? renderEmptyList : null}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={refetch}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
        contentContainerStyle={!sectionedCalls?.length ? styles.emptyListContent : styles.listContent}
        showsVerticalScrollIndicator={false}
      />

      {renderCallInfoModal()}
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
    paddingBottom: SPACING.sm,
    backgroundColor: colors.surface,
  },
  editButton: {
    padding: SPACING.xs,
    minWidth: 50,
  },
  editButtonText: {
    fontSize: FONTS.sizes.md,
    color: colors.primary,
    fontWeight: '500',
  },
  headerTitle: {
    fontSize: FONTS.sizes.xl,
    fontWeight: '600',
    color: colors.text,
  },
  newCallButton: {
    padding: SPACING.xs,
    minWidth: 50,
    alignItems: 'flex-end',
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  clearAllText: {
    fontSize: FONTS.sizes.md,
    color: colors.error,
    fontWeight: '500',
  },
  filterTabs: {
    flexDirection: 'row',
    backgroundColor: colors.inputBackground,
    borderRadius: BORDER_RADIUS.lg,
    padding: 2,
  },
  filterTab: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    borderRadius: BORDER_RADIUS.md,
  },
  filterTabActive: {
    backgroundColor: colors.primary,
  },
  filterTabText: {
    fontSize: FONTS.sizes.sm,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  filterTabTextActive: {
    color: colors.textInverse,
    fontWeight: '600',
  },
  sectionHeader: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    backgroundColor: colors.background,
  },
  sectionHeaderText: {
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  listContent: {
    paddingBottom: 100,
  },
  callItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.md,
    paddingHorizontal: SPACING.lg,
    backgroundColor: colors.surface,
  },
  deleteButton: {
    marginRight: SPACING.sm,
  },
  avatarContainer: {
    position: 'relative',
  },
  videoIndicator: {
    position: 'absolute',
    bottom: -2,
    left: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.error,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.surface,
  },
  callInfo: {
    flex: 1,
    marginLeft: SPACING.md,
  },
  callName: {
    fontSize: FONTS.sizes.md,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 2,
  },
  callNameMissed: {
    color: colors.error,
  },
  callMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  callLabel: {
    fontSize: FONTS.sizes.sm,
    color: colors.textSecondary,
  },
  callLabelMissed: {
    color: colors.error,
  },
  callDurationSeparator: {
    fontSize: FONTS.sizes.sm,
    color: colors.textSecondary,
    marginHorizontal: 2,
  },
  callDuration: {
    fontSize: FONTS.sizes.sm,
    color: colors.textSecondary,
  },
  callRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  callTime: {
    fontSize: FONTS.sizes.sm,
    color: colors.textSecondary,
  },
  infoButton: {
    padding: SPACING.xs,
  },
  deleteAction: {
    backgroundColor: colors.error,
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    height: '100%',
  },
  deleteActionText: {
    color: colors.textInverse,
    fontSize: FONTS.sizes.xs,
    marginTop: 4,
  },
  separator: {
    height: 1,
    backgroundColor: colors.divider,
    marginLeft: 82,
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
  // Modal styles
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
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  modalTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: '600',
    color: colors.text,
  },
  modalBody: {
    padding: SPACING.lg,
  },
  modalCallerInfo: {
    alignItems: 'center',
    marginBottom: SPACING.xl,
  },
  modalCallerName: {
    fontSize: FONTS.sizes.xl,
    fontWeight: '600',
    color: colors.text,
    marginTop: SPACING.md,
  },
  modalDetails: {
    backgroundColor: colors.inputBackground,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.xl,
  },
  modalDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    gap: SPACING.sm,
  },
  modalDetailLabel: {
    fontSize: FONTS.sizes.sm,
    color: colors.textSecondary,
    width: 80,
  },
  modalDetailValue: {
    flex: 1,
    fontSize: FONTS.sizes.sm,
    color: colors.text,
    textAlign: 'right',
  },
  modalActions: {
    flexDirection: 'row',
    gap: SPACING.md,
  },
  modalActionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    backgroundColor: colors.primary,
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.lg,
  },
  modalActionButtonSecondary: {
    backgroundColor: colors.inputBackground,
  },
  modalActionText: {
    fontSize: FONTS.sizes.md,
    fontWeight: '600',
    color: colors.textInverse,
  },
  modalActionTextSecondary: {
    color: colors.primary,
  },
});

export default CallsScreen;
