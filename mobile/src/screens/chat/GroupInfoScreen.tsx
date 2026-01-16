import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  TextInput,
  FlatList,
  Modal,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { launchImageLibrary } from 'react-native-image-picker';
import Avatar from '../../components/Avatar';
import { conversationsApi } from '../../services/api';
import { useChatStore } from '../../stores/chatStore';
import { useAuthStore } from '../../stores/authStore';
import { RootStackParamList } from '../../navigation/RootNavigator';
import { Participant } from '../../types';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { FONTS, SPACING, BORDER_RADIUS } from '../../utils/theme';

type GroupInfoRouteProp = RouteProp<RootStackParamList, 'GroupInfo'>;
type GroupInfoNavigationProp = NativeStackNavigationProp<RootStackParamList>;

const GroupInfoScreen: React.FC = () => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const route = useRoute<GroupInfoRouteProp>();
  const navigation = useNavigation<GroupInfoNavigationProp>();
  const queryClient = useQueryClient();
  const { conversationId } = route.params;
  const { userId } = useAuthStore();
  const { getConversation } = useChatStore();

  const [isEditingName, setIsEditingName] = useState(false);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');

  const conversation = getConversation(conversationId);

  const { data: participants } = useQuery({
    queryKey: ['participants', conversationId],
    queryFn: async () => {
      const response = await conversationsApi.getParticipants(conversationId);
      return response.data as Participant[];
    },
  });

  const currentUserParticipant = participants?.find((p) => p.userId === userId);
  // Owner and Admin roles both have admin privileges
  const isAdmin = currentUserParticipant?.role === 'Admin' || currentUserParticipant?.role === 'Owner';

  // Helper to check if a participant has admin privileges
  const hasAdminRole = (role?: string) => role === 'Admin' || role === 'Owner';

  // Sort participants to show owners first, then admins, then members
  const sortedParticipants = useMemo(() => {
    if (!participants) return [];
    return [...participants].sort((a, b) => {
      // Owner comes first
      if (a.role === 'Owner' && b.role !== 'Owner') return -1;
      if (a.role !== 'Owner' && b.role === 'Owner') return 1;
      // Then Admin
      if (hasAdminRole(a.role) && !hasAdminRole(b.role)) return -1;
      if (!hasAdminRole(a.role) && hasAdminRole(b.role)) return 1;
      return 0;
    });
  }, [participants]);

  const updateNameMutation = useMutation({
    mutationFn: async () => {
      await conversationsApi.update(conversationId, {
        name: groupName,
      });
    },
    onSuccess: () => {
      setIsEditingName(false);
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      Alert.alert('Success', 'Group name updated');
    },
    onError: () => {
      Alert.alert('Error', 'Failed to update group name');
    },
  });

  const updateDescriptionMutation = useMutation({
    mutationFn: async () => {
      await conversationsApi.update(conversationId, {
        description: groupDescription,
      });
    },
    onSuccess: () => {
      setIsEditingDescription(false);
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      Alert.alert('Success', 'Group description updated');
    },
    onError: () => {
      Alert.alert('Error', 'Failed to update group description');
    },
  });

  const leaveMutation = useMutation({
    mutationFn: async () => {
      await conversationsApi.leave(conversationId);
    },
    onSuccess: () => {
      navigation.popToTop();
    },
  });

  const handleChangeGroupPicture = useCallback(async () => {
    if (!isAdmin) {
      Alert.alert('Permission Denied', 'Only admins can change the group picture');
      return;
    }

    const result = await launchImageLibrary({
      mediaType: 'photo',
      quality: 0.8,
      maxWidth: 500,
      maxHeight: 500,
    });

    if (result.assets && result.assets[0]) {
      try {
        const formData = new FormData();
        formData.append('file', {
          uri: result.assets[0].uri,
          type: result.assets[0].type || 'image/jpeg',
          name: result.assets[0].fileName || 'group-picture.jpg',
        } as any);

        await conversationsApi.updateGroupPicture(conversationId, formData);
        queryClient.invalidateQueries({ queryKey: ['conversations'] });
        Alert.alert('Success', 'Group picture updated');
      } catch (error) {
        Alert.alert('Error', 'Failed to update group picture');
      }
    }
  }, [isAdmin, conversationId, queryClient]);

  const handleLeaveGroup = () => {
    Alert.alert(
      'Leave Group',
      'Are you sure you want to leave this group?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: () => leaveMutation.mutate(),
        },
      ]
    );
  };

  const handleRemoveParticipant = (participantUserId: string, name: string) => {
    Alert.alert(
      'Remove Participant',
      `Remove ${name} from this group?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await conversationsApi.removeParticipant(conversationId, participantUserId);
              queryClient.invalidateQueries({ queryKey: ['participants', conversationId] });
            } catch (error) {
              Alert.alert('Error', 'Failed to remove participant');
            }
          },
        },
      ]
    );
  };

  const handleMakeAdmin = async (participantUserId: string, currentRole: string) => {
    try {
      const newRole = currentRole === 'Admin' ? 'Member' : 'Admin';
      await conversationsApi.updateParticipantRole(conversationId, participantUserId, newRole);
      queryClient.invalidateQueries({ queryKey: ['participants', conversationId] });
      Alert.alert('Success', `Role updated to ${newRole}`);
    } catch (error) {
      Alert.alert('Error', 'Failed to update role');
    }
  };

  const handleMediaGallery = useCallback(() => {
    navigation.navigate('MediaGallery', { conversationId });
  }, [navigation, conversationId]);

  const renderParticipant = ({ item }: { item: Participant }) => {
    const isItemOwner = item.role === 'Owner';
    const isItemAdmin = hasAdminRole(item.role);
    const isCurrentUser = item.userId === userId;

    // Get badge text based on role
    const getRoleBadge = () => {
      if (item.role === 'Owner') return 'Owner';
      if (item.role === 'Admin') return 'Admin';
      return null;
    };

    const roleBadge = getRoleBadge();

    return (
      <TouchableOpacity
        style={styles.participantItem}
        onPress={() => {
          if (!isCurrentUser) {
            navigation.navigate('ContactInfo', { userId: item.userId });
          }
        }}
        onLongPress={() => {
          // Only admin/owner can manage others, and owner cannot be removed/demoted
          if (isAdmin && !isCurrentUser && !isItemOwner) {
            Alert.alert(
              item.displayName || item.fullName || 'Participant',
              'Choose an action',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: item.role === 'Admin' ? 'Remove Admin' : 'Make Admin',
                  onPress: () => handleMakeAdmin(item.userId, item.role || 'Member'),
                },
                {
                  text: 'Remove from Group',
                  style: 'destructive',
                  onPress: () => handleRemoveParticipant(item.userId, item.displayName || item.fullName || ''),
                },
              ]
            );
          }
        }}
      >
        <Avatar
          uri={item.profilePictureUrl}
          name={item.displayName || item.fullName || ''}
          size={50}
          isOnline={item.isOnline}
        />
        <View style={styles.participantInfo}>
          <View style={styles.participantNameRow}>
            <Text style={styles.participantName}>
              {isCurrentUser ? 'You' : item.displayName || item.fullName}
            </Text>
            {roleBadge && (
              <View style={[
                styles.adminBadgeContainer,
                isItemOwner && styles.ownerBadgeContainer
              ]}>
                <Icon
                  name={isItemOwner ? "crown" : "shield-account"}
                  size={14}
                  color={isItemOwner ? colors.warning : colors.secondary}
                />
                <Text style={[
                  styles.adminBadge,
                  isItemOwner && styles.ownerBadge
                ]}>
                  {roleBadge}
                </Text>
              </View>
            )}
          </View>
          {item.about && (
            <Text style={styles.participantAbout} numberOfLines={1}>
              {item.about}
            </Text>
          )}
        </View>
        {isAdmin && !isCurrentUser && !isItemOwner && (
          <Icon name="chevron-right" size={24} color={colors.textMuted} />
        )}
      </TouchableOpacity>
    );
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.avatarContainer}
          onPress={handleChangeGroupPicture}
          disabled={!isAdmin}
        >
          <Avatar
            uri={conversation?.iconUrl}
            name={conversation?.name || 'Group'}
            size={100}
          />
          {isAdmin && (
            <View style={styles.editAvatarBadge}>
              <Icon name="camera" size={20} color={colors.textInverse} />
            </View>
          )}
        </TouchableOpacity>

        {/* Group Name */}
        <View style={styles.nameContainer}>
          {isEditingName ? (
            <View style={styles.editNameContainer}>
              <TextInput
                style={styles.editNameInput}
                value={groupName}
                onChangeText={setGroupName}
                placeholder="Group name"
                placeholderTextColor={colors.textMuted}
                autoFocus
              />
              <View style={styles.editNameButtons}>
                <TouchableOpacity
                  style={styles.editNameCancel}
                  onPress={() => setIsEditingName(false)}
                >
                  <Icon name="close" size={24} color={colors.textSecondary} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.editNameSave}
                  onPress={() => updateNameMutation.mutate()}
                >
                  <Icon name="check" size={24} color={colors.secondary} />
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.nameRow}
              onPress={() => {
                if (isAdmin) {
                  setGroupName(conversation?.name || '');
                  setIsEditingName(true);
                }
              }}
              disabled={!isAdmin}
            >
              <Text style={styles.groupName}>{conversation?.name}</Text>
              {isAdmin && (
                <Icon name="pencil" size={18} color={colors.textMuted} style={styles.editIcon} />
              )}
            </TouchableOpacity>
          )}
        </View>

        <Text style={styles.memberCount}>
          {participants?.length} participants
        </Text>
      </View>

      {/* Description Section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Description</Text>
          <TouchableOpacity
            onPress={() => {
              setGroupDescription(conversation?.description || '');
              setIsEditingDescription(true);
            }}
          >
            <Icon name="pencil" size={20} color={colors.secondary} />
          </TouchableOpacity>
        </View>
        <Text style={styles.descriptionText}>
          {conversation?.description || 'No description. Tap the pencil to add one.'}
        </Text>
      </View>

      {/* Media Section */}
      <View style={styles.section}>
        <TouchableOpacity style={styles.menuItem} onPress={handleMediaGallery}>
          <Icon name="image-multiple" size={24} color={colors.textSecondary} />
          <Text style={styles.menuLabel}>Media, links, and docs</Text>
          <Icon name="chevron-right" size={24} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Participants Section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>
            {participants?.length} Participants
          </Text>
          {isAdmin && (
            <TouchableOpacity
              style={styles.addButton}
              onPress={() => navigation.navigate('AddParticipants', {
                conversationId,
                existingParticipantIds: participants?.map(p => p.userId) || [],
              })}
            >
              <Icon name="account-plus" size={24} color={colors.secondary} />
            </TouchableOpacity>
          )}
        </View>

        <FlatList
          data={sortedParticipants}
          renderItem={renderParticipant}
          keyExtractor={(item) => item.userId}
          scrollEnabled={false}
        />
      </View>

      {/* Actions Section */}
      <View style={styles.actionsSection}>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={handleLeaveGroup}
        >
          <Icon name="exit-to-app" size={24} color={colors.error} />
          <Text style={styles.leaveText}>Leave Group</Text>
        </TouchableOpacity>
      </View>

      {/* Edit Description Modal */}
      <Modal
        visible={isEditingDescription}
        transparent
        animationType="fade"
        onRequestClose={() => setIsEditingDescription(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Edit Description</Text>
            <TextInput
              style={styles.descriptionInput}
              value={groupDescription}
              onChangeText={setGroupDescription}
              placeholder="Enter group description..."
              placeholderTextColor={colors.textMuted}
              multiline
              numberOfLines={4}
              autoFocus
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => setIsEditingDescription(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalSaveButton}
                onPress={() => updateDescriptionMutation.mutate()}
              >
                <Text style={styles.modalSaveText}>Save</Text>
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
  avatarContainer: {
    position: 'relative',
    marginBottom: SPACING.lg,
  },
  editAvatarBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.secondary,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: colors.surface,
  },
  nameContainer: {
    alignItems: 'center',
    marginBottom: SPACING.xs,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  groupName: {
    fontSize: FONTS.sizes.xxl,
    fontWeight: 'bold',
    color: colors.text,
  },
  editIcon: {
    marginLeft: SPACING.sm,
  },
  editNameContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  editNameInput: {
    fontSize: FONTS.sizes.xl,
    fontWeight: 'bold',
    color: colors.text,
    borderBottomWidth: 2,
    borderBottomColor: colors.secondary,
    paddingVertical: SPACING.xs,
    minWidth: 150,
    textAlign: 'center',
  },
  editNameButtons: {
    flexDirection: 'row',
    marginLeft: SPACING.sm,
  },
  editNameCancel: {
    padding: SPACING.xs,
  },
  editNameSave: {
    padding: SPACING.xs,
  },
  memberCount: {
    fontSize: FONTS.sizes.sm,
    color: colors.textMuted,
  },
  section: {
    backgroundColor: colors.surface,
    marginBottom: SPACING.lg,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  sectionTitle: {
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
  },
  descriptionText: {
    fontSize: FONTS.sizes.md,
    color: colors.text,
    padding: SPACING.lg,
    paddingTop: SPACING.md,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  menuLabel: {
    flex: 1,
    fontSize: FONTS.sizes.md,
    color: colors.text,
    marginLeft: SPACING.lg,
  },
  addButton: {
    padding: SPACING.xs,
  },
  participantItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  participantInfo: {
    flex: 1,
    marginLeft: SPACING.md,
  },
  participantNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  participantName: {
    fontSize: FONTS.sizes.lg,
    fontWeight: '500',
    color: colors.text,
  },
  adminBadgeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.secondary + '20',
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.sm,
    marginLeft: SPACING.sm,
  },
  ownerBadgeContainer: {
    backgroundColor: colors.warning + '20',
  },
  adminBadge: {
    fontSize: FONTS.sizes.xs,
    color: colors.secondary,
    fontWeight: '600',
    marginLeft: 4,
  },
  ownerBadge: {
    color: colors.warning,
  },
  participantAbout: {
    fontSize: FONTS.sizes.sm,
    color: colors.textSecondary,
    marginTop: 2,
  },
  actionsSection: {
    backgroundColor: colors.surface,
    marginBottom: SPACING.xxl,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  leaveText: {
    fontSize: FONTS.sizes.lg,
    color: colors.error,
    marginLeft: SPACING.md,
    fontWeight: '500',
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
    borderRadius: BORDER_RADIUS.lg,
    width: '90%',
    maxWidth: 400,
    padding: SPACING.lg,
  },
  modalTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: SPACING.lg,
  },
  descriptionInput: {
    fontSize: FONTS.sizes.md,
    color: colors.text,
    backgroundColor: colors.background,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    minHeight: 100,
    textAlignVertical: 'top',
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: SPACING.lg,
    gap: SPACING.md,
  },
  modalCancelButton: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.lg,
  },
  modalCancelText: {
    fontSize: FONTS.sizes.md,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  modalSaveButton: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    backgroundColor: colors.secondary,
    borderRadius: BORDER_RADIUS.md,
  },
  modalSaveText: {
    fontSize: FONTS.sizes.md,
    color: colors.textInverse,
    fontWeight: '500',
  },
});

export default GroupInfoScreen;
