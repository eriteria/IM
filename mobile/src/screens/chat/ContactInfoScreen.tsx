import React, { useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Switch,
  Modal,
  TextInput,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import Avatar from '../../components/Avatar';
import { usersApi, conversationsApi } from '../../services/api';
import { RootStackParamList } from '../../navigation/RootNavigator';
import { UserProfile, Conversation } from '../../types';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { FONTS, SPACING } from '../../utils/theme';

type ContactInfoRouteProp = RouteProp<RootStackParamList, 'ContactInfo'>;
type ContactInfoNavigationProp = NativeStackNavigationProp<RootStackParamList>;

const MUTE_OPTIONS = [
  { label: '8 hours', value: 8 },
  { label: '1 week', value: 168 },
  { label: 'Always', value: -1 },
];

const ContactInfoScreen: React.FC = () => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const route = useRoute<ContactInfoRouteProp>();
  const navigation = useNavigation<ContactInfoNavigationProp>();
  const queryClient = useQueryClient();
  const { userId } = route.params;

  const [showMuteModal, setShowMuteModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [reportDetails, setReportDetails] = useState('');

  const { data: user } = useQuery({
    queryKey: ['user', userId],
    queryFn: async () => {
      const response = await usersApi.getUser(userId);
      return response.data as UserProfile;
    },
  });

  // Get or create conversation with this user
  const { data: conversation } = useQuery({
    queryKey: ['privateConversation', userId],
    queryFn: async () => {
      const response = await conversationsApi.getOrCreatePrivate(userId);
      return response.data as Conversation;
    },
  });

  const blockMutation = useMutation({
    mutationFn: async () => {
      await usersApi.blockUser(userId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user', userId] });
      queryClient.invalidateQueries({ queryKey: ['blockedUsers'] });
      Alert.alert('Blocked', 'User has been blocked');
    },
    onError: () => {
      Alert.alert('Error', 'Failed to block user');
    },
  });

  const muteMutation = useMutation({
    mutationFn: async (hours: number) => {
      if (!conversation?.id) throw new Error('No conversation');
      // For "Always" (-1), pass undefined to mute indefinitely
      // For timed mutes, calculate the future date
      const until = hours === -1 ? undefined : new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
      await conversationsApi.mute(conversation.id, until);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['privateConversation', userId] });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      setShowMuteModal(false);
      Alert.alert('Success', 'Notifications muted');
    },
    onError: () => {
      Alert.alert('Error', 'Failed to mute notifications');
    },
  });

  const unmuteMutation = useMutation({
    mutationFn: async () => {
      if (!conversation?.id) throw new Error('No conversation');
      // Pass undefined/null to unmute - backend sets IsMuted = until.HasValue
      await conversationsApi.mute(conversation.id, undefined);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['privateConversation', userId] });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      Alert.alert('Success', 'Notifications unmuted');
    },
    onError: () => {
      Alert.alert('Error', 'Failed to unmute notifications');
    },
  });

  const handleStartChat = async () => {
    try {
      const response = await conversationsApi.getOrCreatePrivate(userId);
      navigation.navigate('Chat', { conversationId: response.data.id });
    } catch (error) {
      Alert.alert('Error', 'Failed to start conversation');
    }
  };

  const handleVoiceCall = async () => {
    try {
      const response = await conversationsApi.getOrCreatePrivate(userId);
      navigation.navigate('Call', {
        conversationId: response.data.id,
        type: 'Voice',
      });
    } catch (error) {
      Alert.alert('Error', 'Failed to start call');
    }
  };

  const handleVideoCall = async () => {
    try {
      const response = await conversationsApi.getOrCreatePrivate(userId);
      navigation.navigate('Call', {
        conversationId: response.data.id,
        type: 'Video',
      });
    } catch (error) {
      Alert.alert('Error', 'Failed to start call');
    }
  };

  const handleMediaGallery = useCallback(async () => {
    if (conversation?.id) {
      navigation.navigate('MediaGallery', { conversationId: conversation.id });
    } else {
      try {
        const response = await conversationsApi.getOrCreatePrivate(userId);
        navigation.navigate('MediaGallery', { conversationId: response.data.id });
      } catch (error) {
        Alert.alert('Error', 'Failed to open media gallery');
      }
    }
  }, [conversation?.id, navigation, userId]);

  const handleMuteToggle = useCallback(() => {
    if (conversation?.isMuted) {
      unmuteMutation.mutate();
    } else {
      setShowMuteModal(true);
    }
  }, [conversation?.isMuted, unmuteMutation]);

  const handleMuteOption = useCallback((hours: number) => {
    muteMutation.mutate(hours);
  }, [muteMutation]);

  const handleBlock = () => {
    Alert.alert(
      'Block User',
      `Block ${user?.displayName || user?.fullName}? They won't be able to message or call you.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: () => blockMutation.mutate(),
        },
      ]
    );
  };

  const handleReport = useCallback(() => {
    setShowReportModal(true);
  }, []);

  const submitReport = useCallback(() => {
    if (!reportReason) {
      Alert.alert('Error', 'Please select a reason for reporting');
      return;
    }

    // In a real app, this would send to the backend
    Alert.alert(
      'Report Submitted',
      'Thank you for your report. We will review it and take appropriate action.',
      [{ text: 'OK', onPress: () => {
        setShowReportModal(false);
        setReportReason('');
        setReportDetails('');
      }}]
    );
  }, [reportReason]);

  const formatLastSeen = () => {
    if (!user?.lastSeen) return 'Last seen recently';
    if (user.isOnline) return 'Online';
    return `Last seen ${formatDistanceToNow(new Date(user.lastSeen), { addSuffix: true })}`;
  };

  const REPORT_REASONS = [
    'Spam',
    'Harassment or bullying',
    'Inappropriate content',
    'Impersonation',
    'Other',
  ];

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Avatar
          uri={user?.profilePictureUrl}
          name={user?.displayName || user?.fullName || ''}
          size={120}
        />
        <Text style={styles.name}>
          {user?.displayName || user?.fullName}
        </Text>
        <Text style={styles.status}>
          {formatLastSeen()}
        </Text>

        <View style={styles.actions}>
          <TouchableOpacity style={styles.actionButton} onPress={handleStartChat}>
            <View style={styles.actionIcon}>
              <Icon name="message" size={24} color={colors.secondary} />
            </View>
            <Text style={styles.actionLabel}>Message</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionButton} onPress={handleVoiceCall}>
            <View style={styles.actionIcon}>
              <Icon name="phone" size={24} color={colors.secondary} />
            </View>
            <Text style={styles.actionLabel}>Audio</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionButton} onPress={handleVideoCall}>
            <View style={styles.actionIcon}>
              <Icon name="video" size={24} color={colors.secondary} />
            </View>
            <Text style={styles.actionLabel}>Video</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About</Text>
        <Text style={styles.aboutText}>
          {user?.about || 'Hey there! I am using IM'}
        </Text>

        {/* Service Number */}
        {user?.serviceNumber && (
          <View style={styles.infoRow}>
            <Icon name="card-account-details-outline" size={20} color={colors.textSecondary} />
            <View style={styles.infoContent}>
              <Text style={styles.infoLabel}>Service Number</Text>
              <Text style={styles.infoValue}>{user.serviceNumber}</Text>
            </View>
          </View>
        )}

        {/* Rank/Position */}
        {user?.rankPosition && (
          <View style={styles.infoRow}>
            <Icon name="account-tie" size={20} color={colors.textSecondary} />
            <View style={styles.infoContent}>
              <Text style={styles.infoLabel}>Rank / Position</Text>
              <Text style={styles.infoValue}>{user.rankPosition}</Text>
            </View>
          </View>
        )}

        {/* Department */}
        {user?.department && (
          <View style={styles.infoRow}>
            <Icon name="office-building" size={20} color={colors.textSecondary} />
            <View style={styles.infoContent}>
              <Text style={styles.infoLabel}>Department</Text>
              <Text style={styles.infoValue}>{user.department}</Text>
            </View>
          </View>
        )}
      </View>

      <View style={styles.section}>
        <TouchableOpacity style={styles.menuItem} onPress={handleMediaGallery}>
          <Icon name="image-multiple" size={24} color={colors.textSecondary} />
          <Text style={styles.menuLabel}>Media, links, and docs</Text>
          <Icon name="chevron-right" size={24} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <TouchableOpacity style={styles.menuItem} onPress={handleMuteToggle}>
          <Icon
            name={conversation?.isMuted ? "bell-off" : "bell"}
            size={24}
            color={colors.textSecondary}
          />
          <Text style={styles.menuLabel}>Mute notifications</Text>
          <Switch
            value={conversation?.isMuted || false}
            onValueChange={handleMuteToggle}
            trackColor={{ false: colors.divider, true: colors.secondary }}
            thumbColor={colors.surface}
          />
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <TouchableOpacity
          style={styles.dangerItem}
          onPress={handleBlock}
        >
          <Icon name="block-helper" size={24} color={colors.error} />
          <Text style={styles.dangerLabel}>
            Block {user?.displayName || user?.fullName}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.dangerItem} onPress={handleReport}>
          <Icon name="thumb-down" size={24} color={colors.error} />
          <Text style={styles.dangerLabel}>
            Report {user?.displayName || user?.fullName}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Mute Options Modal */}
      <Modal
        visible={showMuteModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowMuteModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowMuteModal(false)}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Mute notifications for...</Text>
            {MUTE_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={styles.modalOption}
                onPress={() => handleMuteOption(option.value)}
              >
                <Text style={styles.modalOptionText}>{option.label}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[styles.modalOption, styles.modalCancel]}
              onPress={() => setShowMuteModal(false)}
            >
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Report Modal */}
      <Modal
        visible={showReportModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowReportModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.reportModalContent}>
            <View style={styles.reportHeader}>
              <Text style={styles.modalTitle}>Report {user?.displayName || user?.fullName}</Text>
              <TouchableOpacity onPress={() => setShowReportModal(false)}>
                <Icon name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <Text style={styles.reportSubtitle}>Why are you reporting this user?</Text>

            {REPORT_REASONS.map((reason) => (
              <TouchableOpacity
                key={reason}
                style={[
                  styles.reportReasonItem,
                  reportReason === reason && styles.reportReasonSelected,
                ]}
                onPress={() => setReportReason(reason)}
              >
                <Icon
                  name={reportReason === reason ? "radiobox-marked" : "radiobox-blank"}
                  size={24}
                  color={reportReason === reason ? colors.secondary : colors.textSecondary}
                />
                <Text style={styles.reportReasonText}>{reason}</Text>
              </TouchableOpacity>
            ))}

            <Text style={styles.reportDetailsLabel}>Additional details (optional)</Text>
            <TextInput
              style={styles.reportInput}
              placeholder="Provide more information..."
              placeholderTextColor={colors.textMuted}
              multiline
              numberOfLines={3}
              value={reportDetails}
              onChangeText={setReportDetails}
            />

            <View style={styles.reportActions}>
              <TouchableOpacity
                style={styles.reportCancelButton}
                onPress={() => setShowReportModal(false)}
              >
                <Text style={styles.reportCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.reportSubmitButton, !reportReason && styles.reportSubmitDisabled]}
                onPress={submitReport}
                disabled={!reportReason}
              >
                <Text style={styles.reportSubmitText}>Submit Report</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
};

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    backgroundColor: colors.surface,
    padding: SPACING.xl,
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  name: {
    fontSize: FONTS.sizes.xxl,
    fontWeight: 'bold',
    color: colors.text,
    marginTop: SPACING.lg,
  },
  status: {
    fontSize: FONTS.sizes.md,
    color: colors.textSecondary,
    marginTop: SPACING.xs,
  },
  actions: {
    flexDirection: 'row',
    marginTop: SPACING.xl,
    gap: SPACING.xl,
  },
  actionButton: {
    alignItems: 'center',
  },
  actionIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.xs,
  },
  actionLabel: {
    fontSize: FONTS.sizes.sm,
    color: colors.secondary,
    fontWeight: '500',
  },
  section: {
    backgroundColor: colors.surface,
    marginBottom: SPACING.lg,
  },
  sectionTitle: {
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
    color: colors.textSecondary,
    padding: SPACING.lg,
    paddingBottom: SPACING.sm,
  },
  aboutText: {
    fontSize: FONTS.sizes.md,
    color: colors.text,
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.md,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  infoContent: {
    marginLeft: SPACING.lg,
    flex: 1,
  },
  infoLabel: {
    fontSize: FONTS.sizes.xs,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  infoValue: {
    fontSize: FONTS.sizes.md,
    color: colors.text,
    fontWeight: '500',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.lg,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  menuLabel: {
    flex: 1,
    fontSize: FONTS.sizes.md,
    color: colors.text,
    marginLeft: SPACING.lg,
  },
  dangerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.lg,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  dangerLabel: {
    fontSize: FONTS.sizes.md,
    color: colors.error,
    marginLeft: SPACING.lg,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    width: '85%',
    maxWidth: 400,
    padding: SPACING.lg,
  },
  modalTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: SPACING.sm,
  },
  modalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  modalOptionText: {
    fontSize: FONTS.sizes.md,
    color: colors.text,
  },
  modalCancel: {
    borderBottomWidth: 0,
    marginTop: SPACING.sm,
    justifyContent: 'center',
  },
  modalCancelText: {
    fontSize: FONTS.sizes.md,
    color: colors.secondary,
    fontWeight: '600',
  },
  // Report modal styles
  reportModalContent: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    width: '100%',
    maxHeight: '80%',
    padding: SPACING.lg,
    position: 'absolute',
    bottom: 0,
  },
  reportHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  reportSubtitle: {
    fontSize: FONTS.sizes.sm,
    color: colors.textSecondary,
    marginBottom: SPACING.md,
  },
  reportReasonItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.md,
  },
  reportReasonSelected: {
    backgroundColor: colors.background,
    marginHorizontal: -SPACING.lg,
    paddingHorizontal: SPACING.lg,
  },
  reportReasonText: {
    fontSize: FONTS.sizes.md,
    color: colors.text,
    marginLeft: SPACING.md,
  },
  reportDetailsLabel: {
    fontSize: FONTS.sizes.sm,
    color: colors.textSecondary,
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
  },
  reportInput: {
    backgroundColor: colors.background,
    borderRadius: 8,
    padding: SPACING.md,
    fontSize: FONTS.sizes.md,
    color: colors.text,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  reportActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: SPACING.xl,
    gap: SPACING.md,
  },
  reportCancelButton: {
    flex: 1,
    paddingVertical: SPACING.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.divider,
    alignItems: 'center',
  },
  reportCancelText: {
    fontSize: FONTS.sizes.md,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  reportSubmitButton: {
    flex: 1,
    paddingVertical: SPACING.md,
    borderRadius: 8,
    backgroundColor: colors.error,
    alignItems: 'center',
  },
  reportSubmitDisabled: {
    opacity: 0.5,
  },
  reportSubmitText: {
    fontSize: FONTS.sizes.md,
    color: colors.textInverse,
    fontWeight: '600',
  },
});

export default ContactInfoScreen;
