import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { format } from 'date-fns';
import { Message } from '../types';
import { useTheme } from '../context';
import { FONTS, SPACING, BORDER_RADIUS, COLORS } from '../utils/theme';
import AudioPlayer from './AudioPlayer';
import { AppConfig } from '../config';

// Helper to convert relative media URLs to full URLs
const getFullMediaUrl = (url: string | undefined): string => {
  if (!url) return '';
  // If already a full URL, return as is
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  // Convert relative path to full URL using API base URL
  // Remove /api suffix from apiBaseUrl since mediaUrl already starts with /api
  const baseUrl = AppConfig.apiUrl;
  return `${baseUrl}${url}`;
};

// Helper to check if a file is an image
const isImageFile = (mimeType: string | undefined): boolean => {
  if (!mimeType) return false;
  return mimeType.startsWith('image/');
};

// Helper to check if a file is a PDF
const isPdfFile = (mimeType: string | undefined, fileName: string | undefined): boolean => {
  if (mimeType === 'application/pdf') return true;
  if (fileName?.toLowerCase().endsWith('.pdf')) return true;
  return false;
};

// Helper to get document icon based on file extension
const getDocumentIcon = (fileName: string | undefined): string => {
  if (!fileName) return 'file-document';
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  const iconMap: { [key: string]: string } = {
    pdf: 'file-pdf-box',
    doc: 'file-word',
    docx: 'file-word',
    xls: 'file-excel',
    xlsx: 'file-excel',
    ppt: 'file-powerpoint',
    pptx: 'file-powerpoint',
    txt: 'file-document-outline',
    zip: 'folder-zip',
    rar: 'folder-zip',
  };
  return iconMap[ext] || 'file-document';
};

interface MessageBubbleProps {
  message: Message;
  isMine: boolean;
  showSenderName?: boolean;
  onLongPress?: () => void;
  onMediaPress?: () => void;
  onReplyPress?: () => void;
  onCallBack?: (type: 'Voice' | 'Video') => void;
}

const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  isMine,
  showSenderName = false,
  onLongPress,
  onMediaPress,
  onReplyPress,
  onCallBack,
}) => {
  const { colors, isDark } = useTheme();

  if (message.isDeleted) {
    return (
      <View style={[styles.container, isMine ? styles.containerMine : styles.containerOther]}>
        <View style={[styles.bubble, styles.deletedBubble, { backgroundColor: colors.divider }]}>
          <Icon name="cancel" size={16} color={colors.textMuted} />
          <Text style={[styles.deletedText, { color: colors.textMuted }]}>
            This message was deleted
          </Text>
        </View>
      </View>
    );
  }

  // Render missed call messages
  if (message.type === 'MissedCall' || message.type === 'MissedVideoCall') {
    const isVideoCall = message.type === 'MissedVideoCall';
    const isMissedByMe = !isMine; // If I'm not the sender, I missed the call

    return (
      <View style={[styles.container, styles.containerCenter]}>
        <View style={[styles.missedCallBubble, { backgroundColor: colors.divider }]}>
          <Icon
            name={isVideoCall ? 'video-off' : 'phone-missed'}
            size={18}
            color={isMissedByMe ? colors.error : colors.textSecondary}
          />
          <View style={styles.missedCallContent}>
            <Text style={[styles.missedCallText, { color: isMissedByMe ? colors.error : colors.textSecondary }]}>
              {isMissedByMe
                ? `Missed ${isVideoCall ? 'video' : 'voice'} call`
                : `${isVideoCall ? 'Video' : 'Voice'} call - No answer`}
            </Text>
            <Text style={[styles.missedCallTime, { color: colors.textMuted }]}>
              {format(new Date(message.createdAt), 'HH:mm')}
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.callBackButton, { backgroundColor: colors.primary + '20' }]}
            onPress={() => onCallBack?.(isVideoCall ? 'Video' : 'Voice')}
          >
            <Icon name={isVideoCall ? 'video' : 'phone'} size={18} color={colors.primary} />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Render system messages (e.g., "User joined the group")
  if (message.type === 'System') {
    return (
      <View style={[styles.container, styles.containerCenter]}>
        <View style={[styles.systemBubble, { backgroundColor: colors.divider }]}>
          <Text style={[styles.systemText, { color: colors.textSecondary }]}>
            {message.content}
          </Text>
        </View>
      </View>
    );
  }

  const getStatusIcon = (): string => {
    if (!isMine) return '';

    // Failed status - show error icon
    if (message.status === 'Failed') return 'alert-circle-outline';

    // Sending status - show clock/waiting icon
    if (message.status === 'Sending') return 'clock-outline';

    // Check recipient statuses for delivered/read
    const hasStatuses = message.statuses && message.statuses.length > 0;

    if (hasStatuses) {
      const allRead = message.statuses.every((s) => s.status === 'Read');
      const anyDelivered = message.statuses.some(
        (s) => s.status === 'Delivered' || s.status === 'Read'
      );

      // All recipients have read - double blue tick
      if (allRead) return 'check-all';
      // At least one delivered - double grey tick
      if (anyDelivered) return 'check-all';
    }

    // Sent but not delivered - single grey tick
    if (message.status === 'Sent') return 'check';

    // Default to sending state
    return 'clock-outline';
  };

  const getStatusColor = (): string => {
    if (!isMine) return colors.tick;

    // Failed status - show error color
    if (message.status === 'Failed') return colors.error;

    // Check if all recipients have read
    const hasStatuses = message.statuses && message.statuses.length > 0;
    if (hasStatuses) {
      const allRead = message.statuses.every((s) => s.status === 'Read');
      if (allRead) return colors.tickBlue;
    }

    // Default grey tick for sending/sent/delivered
    return colors.tick;
  };

  const renderMedia = () => {
    // Check if we have a local URI (uploading) or server URL
    const hasLocalUri = !!message.localMediaUri;
    const hasMediaUrl = !!message.mediaUrl;
    const isUploading = hasLocalUri && message.uploadProgress !== undefined && message.uploadProgress < 1;
    const uploadProgress = message.uploadProgress ?? 0;

    // For uploading messages, show preview with progress
    if (!hasMediaUrl && !hasLocalUri) return null;

    // Get the appropriate URI for preview
    const previewUri = hasLocalUri ? message.localMediaUri : getFullMediaUrl(message.mediaThumbnailUrl || message.mediaUrl);

    switch (message.type) {
      case 'Image':
        return (
          <TouchableOpacity
            onPress={!isUploading ? onMediaPress : undefined}
            activeOpacity={isUploading ? 1 : 0.7}
            style={styles.mediaContainer}
          >
            <Image
              source={{ uri: previewUri }}
              style={styles.imageMedia}
            />
            {isUploading && (
              <View style={styles.uploadOverlay}>
                <View style={styles.uploadProgressContainer}>
                  <ActivityIndicator size="small" color="#fff" />
                  <Text style={styles.uploadProgressText}>
                    {Math.round(uploadProgress * 100)}%
                  </Text>
                </View>
                <View style={styles.uploadProgressBar}>
                  <View
                    style={[
                      styles.uploadProgressFill,
                      { width: `${uploadProgress * 100}%` }
                    ]}
                  />
                </View>
              </View>
            )}
          </TouchableOpacity>
        );
      case 'Video':
        return (
          <TouchableOpacity
            onPress={!isUploading ? onMediaPress : undefined}
            activeOpacity={isUploading ? 1 : 0.7}
            style={styles.mediaContainer}
          >
            <Image
              source={{ uri: previewUri }}
              style={styles.imageMedia}
            />
            {isUploading ? (
              <View style={styles.uploadOverlay}>
                <View style={styles.uploadProgressContainer}>
                  <ActivityIndicator size="small" color="#fff" />
                  <Text style={styles.uploadProgressText}>
                    {Math.round(uploadProgress * 100)}%
                  </Text>
                </View>
                <View style={styles.uploadProgressBar}>
                  <View
                    style={[
                      styles.uploadProgressFill,
                      { width: `${uploadProgress * 100}%` }
                    ]}
                  />
                </View>
              </View>
            ) : (
              <View style={styles.videoOverlay}>
                <Icon name="play-circle" size={48} color="#FFFFFF" />
              </View>
            )}
          </TouchableOpacity>
        );
      case 'Audio':
        return (
          <View style={styles.audioWrapper}>
            {isUploading ? (
              <View style={styles.audioUploadContainer}>
                <Icon name="microphone" size={24} color={colors.primary} />
                <View style={styles.audioUploadProgress}>
                  <Text style={[styles.audioUploadText, { color: colors.text }]}>
                    Uploading voice note...
                  </Text>
                  <View style={[styles.audioProgressBar, { backgroundColor: colors.divider }]}>
                    <View
                      style={[
                        styles.audioProgressFill,
                        { width: `${uploadProgress * 100}%`, backgroundColor: colors.primary }
                      ]}
                    />
                  </View>
                </View>
              </View>
            ) : (
              <AudioPlayer
                uri={getFullMediaUrl(message.mediaUrl)}
                duration={message.mediaDuration || 0}
                isMine={isMine}
              />
            )}
          </View>
        );
      case 'Document':
        return (
          <TouchableOpacity
            onPress={!isUploading ? onMediaPress : undefined}
            activeOpacity={isUploading ? 1 : 0.7}
            style={[
              styles.documentContainer,
              { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)' }
            ]}
          >
            <View style={[styles.documentIconContainer, { backgroundColor: colors.primary + '20' }]}>
              <Icon
                name={getDocumentIcon(message.content)}
                size={28}
                color={colors.primary}
              />
            </View>
            <View style={styles.documentInfo}>
              <Text style={[styles.documentName, { color: colors.text }]} numberOfLines={1}>
                {message.content || 'Document'}
              </Text>
              {isUploading ? (
                <View style={styles.documentUploadProgress}>
                  <Text style={[styles.documentUploadText, { color: colors.textSecondary }]}>
                    Uploading {Math.round(uploadProgress * 100)}%
                  </Text>
                  <View style={[styles.documentProgressBar, { backgroundColor: colors.divider }]}>
                    <View
                      style={[
                        styles.documentProgressFill,
                        { width: `${uploadProgress * 100}%`, backgroundColor: colors.primary }
                      ]}
                    />
                  </View>
                </View>
              ) : (
                <Text style={[styles.documentSize, { color: colors.textSecondary }]}>
                  {message.mediaSize ? formatFileSize(message.mediaSize) : ''}
                </Text>
              )}
            </View>
            {isUploading ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Icon name="eye" size={24} color={colors.primary} />
            )}
          </TouchableOpacity>
        );
      default:
        return null;
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const renderReply = () => {
    if (!message.replyToMessage) return null;

    return (
      <TouchableOpacity
        onPress={onReplyPress}
        style={[
          styles.replyContainer,
          { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)' }
        ]}
      >
        <View style={[styles.replyBar, { backgroundColor: colors.primary }]} />
        <View style={styles.replyContent}>
          <Text style={[styles.replySender, { color: colors.primary }]} numberOfLines={1}>
            {message.replyToMessage.senderName}
          </Text>
          <Text style={[styles.replyText, { color: colors.textSecondary }]} numberOfLines={1}>
            {message.replyToMessage.isDeleted
              ? 'This message was deleted'
              : message.replyToMessage.type === 'Audio'
              ? '🎤 Voice message'
              : message.replyToMessage.type === 'Image'
              ? '📷 Photo'
              : message.replyToMessage.type === 'Video'
              ? '🎥 Video'
              : message.replyToMessage.type === 'Document'
              ? '📄 Document'
              : message.replyToMessage.content || message.replyToMessage.type}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  // For audio messages, render without the outer bubble styling
  if (message.type === 'Audio') {
    return (
      <View style={[styles.container, isMine ? styles.containerMine : styles.containerOther]}>
        <View style={styles.audioMessageContainer}>
          {showSenderName && !isMine && message.senderName && (
            <Text style={[styles.senderName, { color: colors.primary }]}>
              {message.senderName}
            </Text>
          )}

          {renderReply()}

          <AudioPlayer
            uri={getFullMediaUrl(message.mediaUrl)}
            duration={message.mediaDuration || 0}
            isMine={isMine}
          />

          <View style={styles.audioFooter}>
            <Text style={[styles.time, { color: colors.textSecondary }]}>
              {format(new Date(message.createdAt), 'HH:mm')}
            </Text>
            {isMine && (
              <Icon
                name={getStatusIcon()}
                size={16}
                color={getStatusColor()}
                style={styles.statusIcon}
              />
            )}
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, isMine ? styles.containerMine : styles.containerOther]}>
      <TouchableOpacity
        onLongPress={onLongPress}
        activeOpacity={0.8}
        style={[
          styles.bubble,
          isMine
            ? [styles.bubbleMine, { backgroundColor: colors.chatBubbleSent }]
            : [styles.bubbleOther, { backgroundColor: colors.chatBubbleReceived }],
        ]}
      >
        {/* Sender name for group messages */}
        {showSenderName && !isMine && message.senderName && (
          <Text style={[styles.senderName, { color: colors.primary }]}>
            {message.senderName}
          </Text>
        )}

        {/* Service Number watermark - shown below sender name or at top for own messages */}
        {message.senderServiceNumber && (
          <Text style={[
            styles.serviceNumberWatermark,
            { color: colors.textMuted },
            isMine && styles.serviceNumberRight
          ]}>
            SN: {message.senderServiceNumber}
          </Text>
        )}

        {/* Enhanced forwarded indicator with original sender info */}
        {message.isForwarded && (
          <View style={[styles.forwardedContainer, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)' }]}>
            <Icon name="share-variant" size={12} color={colors.primary} />
            <Text style={[styles.forwardedLabel, { color: colors.primary }]}>
              Forwarded
            </Text>
            {message.originalSenderServiceNumber && message.senderServiceNumber &&
             message.originalSenderServiceNumber !== message.senderServiceNumber && (
              <Text style={[styles.forwardedChain, { color: colors.textSecondary }]}>
                {message.originalSenderServiceNumber} → {message.senderServiceNumber}
                {message.forwardCount && message.forwardCount > 1 ? ` (${message.forwardCount}x)` : ''}
              </Text>
            )}
          </View>
        )}

        {renderReply()}
        {renderMedia()}

        {/* Media originator watermark for attachments */}
        {message.mediaUrl && message.mediaOriginatorServiceNumber && message.mediaOriginatorServiceNumber !== message.senderServiceNumber && (
          <Text style={[styles.mediaOriginatorWatermark, { color: colors.textMuted }]}>
            Media by: SN {message.mediaOriginatorServiceNumber}
          </Text>
        )}

        {message.content && message.type === 'Text' && (
          <Text style={[styles.content, { color: colors.text }]}>
            {message.content}
          </Text>
        )}

        {/* Reactions display */}
        {message.reactions && message.reactions.length > 0 && (
          <View style={styles.reactionsContainer}>
            {/* Group reactions by emoji and count */}
            {Object.entries(
              message.reactions.reduce((acc, r) => {
                acc[r.emoji] = (acc[r.emoji] || 0) + 1;
                return acc;
              }, {} as Record<string, number>)
            ).map(([emoji, count]) => (
              <View key={emoji} style={[styles.reactionBadge, { backgroundColor: colors.divider }]}>
                <Text style={styles.reactionEmoji}>{emoji}</Text>
                {count > 1 && (
                  <Text style={[styles.reactionCount, { color: colors.textSecondary }]}>{count}</Text>
                )}
              </View>
            ))}
          </View>
        )}

        <View style={styles.footer}>
          {message.isEdited && (
            <Text style={[styles.editedText, { color: colors.textMuted }]}>edited</Text>
          )}
          <Text style={[styles.time, { color: colors.textSecondary }]}>
            {format(new Date(message.createdAt), 'HH:mm')}
          </Text>
          {isMine && (
            <Icon
              name={getStatusIcon()}
              size={16}
              color={getStatusColor()}
              style={styles.statusIcon}
            />
          )}
        </View>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    flexDirection: 'row',
  },
  containerMine: {
    justifyContent: 'flex-end',
  },
  containerOther: {
    justifyContent: 'flex-start',
  },
  containerCenter: {
    justifyContent: 'center',
  },
  missedCallBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.lg,
    maxWidth: '85%',
  },
  missedCallContent: {
    flex: 1,
    marginHorizontal: SPACING.sm,
  },
  missedCallText: {
    fontSize: FONTS.sizes.sm,
    fontWeight: '500',
  },
  missedCallTime: {
    fontSize: FONTS.sizes.xs,
    marginTop: 2,
  },
  callBackButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  systemBubble: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.lg,
    maxWidth: '85%',
  },
  systemText: {
    fontSize: FONTS.sizes.sm,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  bubble: {
    maxWidth: '80%',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.lg,
  },
  bubbleMine: {
    borderBottomRightRadius: BORDER_RADIUS.sm,
  },
  bubbleOther: {
    borderBottomLeftRadius: BORDER_RADIUS.sm,
  },
  deletedBubble: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  deletedText: {
    fontStyle: 'italic',
    marginLeft: SPACING.xs,
    fontSize: FONTS.sizes.sm,
  },
  senderName: {
    fontWeight: 'bold',
    fontSize: FONTS.sizes.sm,
    marginBottom: SPACING.xs,
  },
  replyContainer: {
    flexDirection: 'row',
    borderRadius: BORDER_RADIUS.sm,
    marginBottom: SPACING.sm,
    overflow: 'hidden',
  },
  replyBar: {
    width: 4,
  },
  replyContent: {
    flex: 1,
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
  },
  replySender: {
    fontWeight: 'bold',
    fontSize: FONTS.sizes.xs,
    marginBottom: 2,
  },
  replyText: {
    fontSize: FONTS.sizes.xs,
    lineHeight: 16,
  },
  mediaContainer: {
    marginBottom: SPACING.xs,
    borderRadius: BORDER_RADIUS.md,
    overflow: 'hidden',
  },
  imageMedia: {
    width: 200,
    height: 200,
    borderRadius: BORDER_RADIUS.md,
  },
  videoOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  audioWrapper: {
    marginBottom: SPACING.xs,
    marginHorizontal: -SPACING.md + SPACING.xs,
  },
  audioMessageContainer: {
    maxWidth: '80%',
  },
  audioFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 4,
    paddingHorizontal: SPACING.sm,
  },
  documentContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.xs,
    minWidth: 200,
  },
  documentIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.sm,
  },
  documentInfo: {
    flex: 1,
    marginRight: SPACING.sm,
  },
  documentName: {
    fontSize: FONTS.sizes.sm,
    fontWeight: '500',
  },
  documentSize: {
    fontSize: FONTS.sizes.xs,
    marginTop: 2,
  },
  serviceNumberWatermark: {
    fontSize: FONTS.sizes.xs - 1,
    fontStyle: 'italic',
    opacity: 0.7,
    marginBottom: SPACING.xs,
  },
  serviceNumberRight: {
    textAlign: 'right',
  },
  forwardedContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.xs,
    gap: SPACING.xs,
  },
  forwardedLabel: {
    fontSize: FONTS.sizes.xs,
    fontWeight: '600',
    fontStyle: 'italic',
  },
  forwardedChain: {
    fontSize: FONTS.sizes.xs - 1,
    fontStyle: 'italic',
  },
  mediaOriginatorWatermark: {
    fontSize: FONTS.sizes.xs - 1,
    fontStyle: 'italic',
    opacity: 0.7,
    marginBottom: SPACING.xs,
  },
  reactionsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: SPACING.xs,
    marginBottom: SPACING.xs,
  },
  reactionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 12,
    marginRight: 4,
    marginBottom: 4,
  },
  reactionEmoji: {
    fontSize: 14,
  },
  reactionCount: {
    fontSize: 11,
    marginLeft: 2,
  },
  content: {
    fontSize: FONTS.sizes.md,
    lineHeight: 20,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: SPACING.xs,
  },
  editedText: {
    fontSize: FONTS.sizes.xs,
    fontStyle: 'italic',
    marginRight: SPACING.xs,
  },
  time: {
    fontSize: FONTS.sizes.xs,
  },
  statusIcon: {
    marginLeft: SPACING.xs,
  },
  // Upload progress styles
  uploadOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    padding: SPACING.md,
  },
  uploadProgressContainer: {
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  uploadProgressText: {
    color: '#fff',
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
    marginTop: SPACING.xs,
  },
  uploadProgressBar: {
    width: '80%',
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  uploadProgressFill: {
    height: '100%',
    backgroundColor: COLORS.secondary,
    borderRadius: 2,
  },
  // Audio upload styles
  audioUploadContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.md,
    paddingHorizontal: SPACING.lg,
  },
  audioUploadProgress: {
    flex: 1,
    marginLeft: SPACING.md,
  },
  audioUploadText: {
    fontSize: FONTS.sizes.sm,
    marginBottom: SPACING.xs,
  },
  audioProgressBar: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  audioProgressFill: {
    height: '100%',
    borderRadius: 2,
  },
  // Document upload styles
  documentUploadProgress: {
    flex: 1,
  },
  documentUploadText: {
    fontSize: FONTS.sizes.xs,
    marginBottom: 4,
  },
  documentProgressBar: {
    height: 3,
    borderRadius: 1.5,
    overflow: 'hidden',
  },
  documentProgressFill: {
    height: '100%',
    borderRadius: 1.5,
  },
});

export default MessageBubble;
