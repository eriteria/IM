import React, { useEffect, useState, useRef, useCallback, useMemo, memo } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  Animated,
  Modal,
  Pressable,
  Dimensions,
  Share,
  Image,
  StatusBar,
  InteractionManager,
} from 'react-native';
import { WebView } from 'react-native-webview';
import RNFS from 'react-native-fs';
import FileViewer from 'react-native-file-viewer';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Clipboard from '@react-native-clipboard/clipboard';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import MessageBubble from '../../components/MessageBubble';
import ChatInput from '../../components/ChatInput';
import Avatar from '../../components/Avatar';
import MediaPicker, { SelectedMedia, LocationData, ContactData } from '../../components/MediaPicker';
import SwipeableMessage from '../../components/SwipeableMessage';
import MessageSelectionBar from '../../components/MessageSelectionBar';
import ReactionsPopup from '../../components/ReactionsPopup';
import TypingIndicator from '../../components/TypingIndicator';
import { useMessages } from '../../hooks/useMessages';
import { conversationsApi, filesApi } from '../../services/api';
import {
  sendMessage,
  sendTyping,
  sendStopTyping,
  markConversationRead,
  joinConversation,
  leaveConversation,
  deleteMessageWithAudit,
  addReaction,
  starMessage,
  pinMessage,
  editMessage,
} from '../../services/signalr';
import { useChatStore } from '../../stores/chatStore';
import { useAuthStore } from '../../stores/authStore';
import { RootStackParamList } from '../../navigation/RootNavigator';
import { Message, Conversation } from '../../types';
import { useTheme } from '../../context';
import { FONTS, SPACING } from '../../utils/theme';
import { formatLastSeen } from '../../utils/dateUtils';
import { AppConfig } from '../../config';
// TODO: Re-enable when proper E2E encryption is implemented
// import { encryptForConversation, decryptFromConversation } from '../../services/encryption';

type ChatScreenRouteProp = RouteProp<RootStackParamList, 'Chat'>;
type ChatScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Chat'>;

const ChatScreen: React.FC = () => {
  const route = useRoute<ChatScreenRouteProp>();
  const navigation = useNavigation<ChatScreenNavigationProp>();
  const { conversationId, openSearch } = route.params;
  const { colors } = useTheme();

  const { userId } = useAuthStore();
  const {
    prependMessages,
    getConversation,
  } = useChatStore();

  // Use the useMessages hook for offline-first message loading
  const {
    messages: conversationMessages,
    isLoading,
    isOffline,
    loadedFromCache,
    refetch,
    loadMoreMessages: loadMore,
  } = useMessages(conversationId);

  // Subscribe specifically to typing users for this conversation to ensure re-renders
  // Use shallow comparison with useCallback selector for better performance
  const typingUserIds = useChatStore(
    useCallback((state) => state.typingUsers[conversationId] || [], [conversationId])
  );

  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [showMediaPicker, setShowMediaPicker] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedMessages, setSelectedMessages] = useState<Set<string>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [showReactionsPopup, setShowReactionsPopup] = useState(false);
  const [reactionsPosition, setReactionsPosition] = useState({ x: 0, y: 0 });
  const [reactionTargetMessage, setReactionTargetMessage] = useState<Message | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [showCallMenu, setShowCallMenu] = useState(false);
  const [showDocumentPreview, setShowDocumentPreview] = useState(false);
  const [isSearchMode, setIsSearchMode] = useState(openSearch || false);
  const [searchQuery, setSearchQuery] = useState('');
  const [documentPreviewData, setDocumentPreviewData] = useState<{
    mediaUrl: string;
    fileName: string;
    fileSize?: number;
  } | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [localFilePath, setLocalFilePath] = useState<string | null>(null);
  const highlightAnim = useRef(new Animated.Value(0)).current;
  const flatListRef = useRef<FlatList>(null);

  const conversation = getConversation(conversationId);

  // Defer SignalR operations to allow UI to render first
  useEffect(() => {
    // Set active conversation immediately (synchronous, fast)
    useChatStore.getState().setActiveConversation(conversationId);
    useChatStore.getState().resetUnreadCount(conversationId);

    // Defer network operations to allow UI to be interactive first
    const handle = InteractionManager.runAfterInteractions(() => {
      joinConversation(conversationId);
      markConversationRead(conversationId);
    });

    return () => {
      handle.cancel();
      leaveConversation(conversationId);
      useChatStore.getState().setActiveConversation(null);
    };
  }, [conversationId]);

  // Memoize the other participant to avoid recalculating on every render
  const otherParticipant = useMemo(() => {
    return conversation?.participants.find((p) => p.userId !== userId);
  }, [conversation?.participants, userId]);

  // Memoize header title data to minimize re-renders
  const headerData = useMemo(() => ({
    name: conversation?.type === 'Group'
      ? conversation.name
      : otherParticipant?.displayName || otherParticipant?.fullName,
    avatarUri: conversation?.type === 'Group'
      ? conversation.iconUrl
      : otherParticipant?.profilePictureUrl,
    avatarName: conversation?.type === 'Group'
      ? conversation.name || 'Group'
      : otherParticipant?.displayName || otherParticipant?.fullName || '',
    isOnline: conversation?.type === 'Private' && otherParticipant?.isOnline,
    isGroup: conversation?.type === 'Group',
    otherUserId: otherParticipant?.userId,
    lastSeen: otherParticipant?.lastSeen,
  }), [conversation?.type, conversation?.name, conversation?.iconUrl, otherParticipant]);

  // Check if anyone is typing (excluding self)
  const isTyping = useMemo(() => {
    return typingUserIds.filter(id => id !== userId).length > 0;
  }, [typingUserIds, userId]);

  // Filter messages based on search query
  const filteredMessages = useMemo(() => {
    if (!searchQuery.trim()) return conversationMessages;
    const query = searchQuery.toLowerCase();
    return conversationMessages.filter(
      (msg) => msg.content?.toLowerCase().includes(query)
    );
  }, [conversationMessages, searchQuery]);

  useEffect(() => {
    if (isSearchMode) {
      navigation.setOptions({
        headerTitle: '',
        headerLeft: () => (
          <View style={styles.searchHeaderContainer}>
            <TouchableOpacity
              onPress={() => {
                setIsSearchMode(false);
                setSearchQuery('');
              }}
              style={styles.backButton}
            >
              <Icon name="chevron-left" size={28} color={colors.headerText} />
            </TouchableOpacity>
            <TextInput
              style={[styles.searchInput, { color: colors.headerText }]}
              placeholder="Search messages..."
              placeholderTextColor={colors.headerText + '80'}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoFocus
            />
          </View>
        ),
        headerRight: () => (
          <View style={styles.headerRight}>
            {searchQuery.length > 0 && (
              <TouchableOpacity
                style={styles.headerButton}
                onPress={() => setSearchQuery('')}
              >
                <Icon name="close" size={24} color={colors.headerText} />
              </TouchableOpacity>
            )}
          </View>
        ),
      });
    } else {
      navigation.setOptions({
        headerTitle: '',
        headerLeft: ({ canGoBack }) => (
          <View style={styles.headerLeftContainer}>
            {canGoBack && (
              <TouchableOpacity
                onPress={() => navigation.goBack()}
                style={styles.backButton}
              >
                <Icon name="chevron-left" size={28} color={colors.headerText} />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.headerTitle}
              onPress={() => {
                if (headerData.isGroup) {
                  navigation.navigate('GroupInfo', { conversationId });
                } else if (headerData.otherUserId) {
                  navigation.navigate('ContactInfo', { userId: headerData.otherUserId });
                }
              }}
            >
              <Avatar
                uri={headerData.avatarUri}
                name={headerData.avatarName}
                size={36}
              />
              <View style={styles.headerTitleText}>
                <Text style={[styles.headerName, { color: colors.headerText }]} numberOfLines={1}>
                  {headerData.name}
                </Text>
                {isTyping ? (
                  <Text style={[styles.headerStatus, { color: colors.headerText }]}>typing...</Text>
                ) : headerData.isOnline ? (
                  <Text style={[styles.headerStatus, { color: colors.headerText }]}>online</Text>
                ) : !headerData.isGroup && headerData.lastSeen ? (
                  <Text style={[styles.headerStatus, { color: colors.headerText }]}>{formatLastSeen(headerData.lastSeen)}</Text>
                ) : null}
              </View>
            </TouchableOpacity>
          </View>
        ),
        headerRight: () => (
          <View style={styles.headerRight}>
            <TouchableOpacity
              style={styles.headerButton}
              onPress={() => setIsSearchMode(true)}
            >
              <Icon name="magnify" size={24} color={colors.headerText} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.headerButton}
              onPress={() => setShowCallMenu(true)}
            >
              <Icon name="phone" size={24} color={colors.headerText} />
            </TouchableOpacity>
          </View>
        ),
      });
    }
  }, [navigation, headerData, isTyping, conversationId, colors.headerText, isSearchMode, searchQuery]);

  const handleSendMessage = async (content: string) => {
    // Add optimistic message immediately for instant display
    const tempId = useChatStore.getState().addOptimisticMessage(
      conversationId,
      {
        type: 'Text',
        content: content,
        replyToMessageId: replyingTo?.id,
        replyToMessage: replyingTo || undefined,
      },
      userId || '',
      undefined // Will use current user's name from server response
    );

    setReplyingTo(null);

    try {
      // TODO: Implement proper end-to-end encryption with key exchange
      // For now, sending in plain text to fix cross-device messaging

      await sendMessage(conversationId, {
        type: 'Text',
        content: content,
        replyToMessageId: replyingTo?.id,
      });
      // Server will broadcast the message back via SignalR with proper ID
      // The ReceiveMessage handler will replace the optimistic message
    } catch (error) {
      console.error('Failed to send message:', error);
      // Mark the optimistic message as failed
      useChatStore.getState().failOptimisticMessage(conversationId, tempId);
      Alert.alert('Error', 'Failed to send message. Please try again.');
    }
  };

  const handleTypingStart = () => {
    sendTyping(conversationId);
  };

  const handleTypingEnd = () => {
    sendStopTyping(conversationId);
  };

  const handleAttachmentPress = () => {
    setShowMediaPicker(true);
  };

  const handleMediaSelected = async (media: SelectedMedia) => {
    setShowMediaPicker(false);
    setIsUploading(true);

    // On Android, content:// URIs from DocumentPicker need special handling
    // We need to ensure the file URI and name are properly formatted
    let fileUri = media.uri;
    let fileName = media.fileName || `file_${Date.now()}`;

    // On Android, ensure proper file:// prefix for non-content URIs
    if (Platform.OS === 'android' && !fileUri.startsWith('content://') && !fileUri.startsWith('file://')) {
      fileUri = `file://${fileUri}`;
    }

    // Ensure fileName has proper extension for the mime type
    if (media.mimeType === 'application/pdf' && !fileName.toLowerCase().endsWith('.pdf')) {
      fileName = fileName.includes('.') ? fileName : `${fileName}.pdf`;
    }

    // Determine message type
    const messageType = media.type === 'image' ? 'Image'
      : media.type === 'video' ? 'Video'
      : media.type === 'audio' ? 'Audio'
      : 'Document';

    // Create optimistic message with local URI for immediate preview
    const tempId = useChatStore.getState().addOptimisticMessage(
      conversationId,
      {
        type: messageType,
        content: fileName,
        localMediaUri: media.uri, // Use local URI for preview
        mediaMimeType: media.mimeType,
        mediaSize: media.fileSize,
        uploadProgress: 0,
        replyToMessageId: replyingTo?.id,
        replyToMessage: replyingTo || undefined,
      },
      userId || '',
      undefined
    );

    setReplyingTo(null);

    try {
      console.log('[Media Upload] Uploading file:', { uri: fileUri, fileName, mimeType: media.mimeType });

      // Create form data for file upload
      const formData = new FormData();
      formData.append('file', {
        uri: fileUri,
        name: fileName,
        type: media.mimeType || 'application/octet-stream',
      } as any);

      // Upload file with progress tracking
      const uploadResponse = await filesApi.uploadWithProgress(
        formData,
        (progress) => {
          // Update upload progress in the optimistic message
          useChatStore.getState().updateMessage(conversationId, tempId, {
            uploadProgress: progress,
          });
        }
      );
      const { fileUrl } = uploadResponse.data;

      console.log('[Media Upload] Upload successful:', fileUrl);

      // Update the optimistic message with the server URL
      useChatStore.getState().updateMessage(conversationId, tempId, {
        mediaUrl: fileUrl,
        localMediaUri: undefined, // Clear local URI now that we have server URL
        uploadProgress: 1,
      });

      // Send message with media via SignalR
      await sendMessage(conversationId, {
        type: messageType,
        mediaUrl: fileUrl,
        mediaMimeType: media.mimeType,
        mediaSize: media.fileSize,
        fileName: fileName,
        replyToMessageId: replyingTo?.id,
      });
    } catch (error: any) {
      console.error('[Media Upload] Failed to send media:', error);
      // Mark the optimistic message as failed
      useChatStore.getState().failOptimisticMessage(conversationId, tempId);
      // Provide more specific error messages
      let errorMessage = 'Failed to send media. Please try again.';
      if (error.response?.status === 413) {
        errorMessage = 'File is too large. Please select a smaller file.';
      } else if (error.response?.status === 415) {
        errorMessage = 'File type not supported.';
      } else if (error.message?.includes('Network')) {
        errorMessage = 'Network error. Please check your connection and try again.';
      }
      Alert.alert('Error', errorMessage);
    } finally {
      setIsUploading(false);
    }
  };

  const handleSendVoiceNote = async (uri: string, duration: number) => {
    setIsUploading(true);

    try {
      // Create form data for file upload
      const formData = new FormData();
      formData.append('file', {
        uri: uri,
        name: `voice_note_${Date.now()}.mp4`,
        type: 'audio/mp4',
      } as any);

      // Upload file
      const uploadResponse = await filesApi.upload(formData);
      const { fileUrl } = uploadResponse.data;

      // Send message with audio and duration
      await sendMessage(conversationId, {
        type: 'Audio',
        mediaUrl: fileUrl,
        mediaDuration: duration,
        replyToMessageId: replyingTo?.id,
      });

      setReplyingTo(null);
    } catch (error) {
      console.error('Failed to send voice note:', error);
      Alert.alert('Error', 'Failed to send voice note. Please try again.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleLocationSelected = async (location: LocationData) => {
    try {
      const locationContent = `https://maps.google.com/?q=${location.latitude},${location.longitude}`;
      // TODO: Implement proper end-to-end encryption
      const metadata = JSON.stringify({
        latitude: location.latitude,
        longitude: location.longitude,
        address: location.address,
      });

      await sendMessage(conversationId, {
        type: 'Location',
        content: locationContent,
        metadata: metadata,
        replyToMessageId: replyingTo?.id,
      });

      setReplyingTo(null);
    } catch (error) {
      console.error('Failed to send location:', error);
      Alert.alert('Error', 'Failed to send location. Please try again.');
    }
  };

  const handleContactSelected = async (contact: ContactData) => {
    try {
      const contactContent = `${contact.name}\n${contact.phoneNumber}${contact.email ? '\n' + contact.email : ''}`;
      // TODO: Implement proper end-to-end encryption
      const metadata = JSON.stringify({
        name: contact.name,
        phoneNumber: contact.phoneNumber,
        email: contact.email,
      });

      await sendMessage(conversationId, {
        type: 'Contact',
        content: contactContent,
        metadata: metadata,
        replyToMessageId: replyingTo?.id,
      });

      setReplyingTo(null);
    } catch (error) {
      console.error('Failed to send contact:', error);
      Alert.alert('Error', 'Failed to send contact. Please try again.');
    }
  };

  const loadMoreMessages = async () => {
    if (isLoadingMore || !hasMore || isOffline) return;

    setIsLoadingMore(true);
    try {
      const moreAvailable = await loadMore(page + 1);
      setPage((p) => p + 1);
      setHasMore(moreAvailable);
    } catch (error) {
      console.error('Error loading more messages:', error);
    } finally {
      setIsLoadingMore(false);
    }
  };

  // Selection mode handlers - memoized for performance
  const enterSelectionMode = useCallback((message: Message) => {
    setIsSelectionMode(true);
    setSelectedMessages(new Set([message.id]));
  }, []);

  const exitSelectionMode = useCallback(() => {
    setIsSelectionMode(false);
    setSelectedMessages(new Set());
  }, []);

  const toggleMessageSelection = useCallback((messageId: string) => {
    setSelectedMessages(prev => {
      const newSelected = new Set(prev);
      if (newSelected.has(messageId)) {
        newSelected.delete(messageId);
        if (newSelected.size === 0) {
          setIsSelectionMode(false);
          return new Set();
        }
      } else {
        newSelected.add(messageId);
      }
      return newSelected;
    });
  }, []);

  const getSelectedMessage = useCallback((): Message | null => {
    if (selectedMessages.size === 1) {
      const messageId = Array.from(selectedMessages)[0];
      return conversationMessages.find((m) => m.id === messageId) || null;
    }
    return null;
  }, [selectedMessages, conversationMessages]);

  // Swipe to reply handler
  const handleSwipeToReply = useCallback((message: Message) => {
    setReplyingTo(message);
  }, []);

  // Long press for selection/forward mode
  const handleMessageLongPress = useCallback((message: Message) => {
    if (isSelectionMode) {
      toggleMessageSelection(message.id);
    } else {
      enterSelectionMode(message);
    }
  }, [isSelectionMode, toggleMessageSelection, enterSelectionMode]);

  // Double tap for reactions
  const handleDoubleTap = (message: Message, event: { x: number; y: number }) => {
    setReactionTargetMessage(message);
    setReactionsPosition({ x: event.x, y: event.y });
    setShowReactionsPopup(true);
  };

  // Action bar handlers
  const handleReply = () => {
    const message = getSelectedMessage();
    if (message) {
      setReplyingTo(message);
      exitSelectionMode();
    }
  };

  const handleForward = () => {
    if (selectedMessages.size > 0) {
      const messageId = Array.from(selectedMessages)[0];
      exitSelectionMode();
      navigation.navigate('ForwardMessage', { messageId });
    }
  };

  const handleCopy = () => {
    const message = getSelectedMessage();
    if (message?.content) {
      Clipboard.setString(message.content);
      Alert.alert('Copied', 'Message copied to clipboard');
    }
    exitSelectionMode();
  };

  const handleDelete = async () => {
    const message = getSelectedMessage();
    const isMine = message?.senderId === userId;

    Alert.alert(
      'Delete Message',
      isMine
        ? 'Delete this message for everyone or just for yourself?'
        : 'Delete this message for yourself?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete for me',
          onPress: async () => {
            for (const messageId of selectedMessages) {
              try {
                await deleteMessageWithAudit(messageId, 'ForMe');
              } catch (error) {
                console.error('Failed to delete message:', error);
              }
            }
            exitSelectionMode();
          },
        },
        ...(isMine ? [{
          text: 'Delete for everyone',
          style: 'destructive' as const,
          onPress: async () => {
            for (const messageId of selectedMessages) {
              try {
                await deleteMessageWithAudit(messageId, 'ForEveryone');
              } catch (error) {
                console.error('Failed to delete message:', error);
              }
            }
            exitSelectionMode();
          },
        }] : []),
      ]
    );
  };

  const handleStar = async () => {
    for (const messageId of selectedMessages) {
      try {
        await starMessage(messageId);
      } catch (error) {
        console.error('Failed to star message:', error);
      }
    }
    Alert.alert('Starred', 'Message(s) added to starred messages');
    exitSelectionMode();
  };

  const handleEdit = () => {
    const message = getSelectedMessage();
    if (message && message.type === 'Text' && message.content) {
      setEditingMessage(message);
      exitSelectionMode();
    }
  };

  const handleEditMessage = async (messageId: string, newContent: string) => {
    try {
      await editMessage(messageId, newContent);
      // The message will be updated via SignalR MessageEdited event
    } catch (error) {
      console.error('Failed to edit message:', error);
      Alert.alert('Error', 'Failed to edit message. Please try again.');
    }
  };

  const handleReact = async (emoji: string) => {
    if (reactionTargetMessage) {
      try {
        await addReaction(reactionTargetMessage.id, emoji);
      } catch (error) {
        console.error('Failed to add reaction:', error);
      }
    }
    setReactionTargetMessage(null);
  };

  const scrollToAndHighlightMessage = useCallback((messageId: string) => {
    const messageIndex = conversationMessages.findIndex((m) => m.id === messageId);
    if (messageIndex !== -1) {
      // Scroll to the message
      flatListRef.current?.scrollToIndex({
        index: messageIndex,
        animated: true,
        viewPosition: 0.5,
      });

      // Highlight the message with animation
      setHighlightedMessageId(messageId);
      highlightAnim.setValue(1);
      Animated.sequence([
        Animated.timing(highlightAnim, {
          toValue: 0.3,
          duration: 300,
          useNativeDriver: false,
        }),
        Animated.timing(highlightAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: false,
        }),
        Animated.timing(highlightAnim, {
          toValue: 0.3,
          duration: 300,
          useNativeDriver: false,
        }),
        Animated.timing(highlightAnim, {
          toValue: 0,
          duration: 500,
          useNativeDriver: false,
        }),
      ]).start(() => {
        setHighlightedMessageId(null);
      });
    }
  }, [conversationMessages, highlightAnim]);

  // Memoized callback for media press
  const handleMediaPress = useCallback((message: Message) => {
    if (message.mediaUrl) {
      if (message.type === 'Image' || message.type === 'Video') {
        navigation.navigate('MediaViewer', {
          mediaUrl: message.mediaUrl,
          mediaType: message.type.toLowerCase(),
          senderName: message.senderName,
          timestamp: message.createdAt,
        });
      } else if (message.type === 'Document') {
        // Show in-app document preview modal (like WhatsApp)
        setDocumentPreviewData({
          mediaUrl: message.mediaUrl,
          fileName: message.content || 'document',
          fileSize: message.mediaSize,
        });
        setLocalFilePath(null);
        setShowDocumentPreview(true);
      }
    }
  }, [navigation]);

  // Memoized callback for call
  const handleCallBack = useCallback((type: 'Voice' | 'Video') => {
    navigation.navigate('Call', { conversationId, type });
  }, [navigation, conversationId]);

  // Memoized highlight background color
  const highlightBackgroundColor = useMemo(() => {
    return highlightAnim.interpolate({
      inputRange: [0, 1],
      outputRange: ['transparent', colors.primary + '30'],
    });
  }, [highlightAnim, colors.primary]);

  const renderMessage = useCallback(({ item, index }: { item: Message; index: number }) => {
    const isMine = item.senderId === userId;
    const showSenderName =
      conversation?.type === 'Group' &&
      !isMine &&
      (index === conversationMessages.length - 1 ||
        conversationMessages[index + 1]?.senderId !== item.senderId);

    const isHighlighted = highlightedMessageId === item.id;
    const isSelected = selectedMessages.has(item.id);

    const messageContent = (
      <TouchableOpacity
        activeOpacity={isSelectionMode ? 0.7 : 1}
        onPress={() => {
          if (isSelectionMode) {
            toggleMessageSelection(item.id);
          }
        }}
        onLongPress={() => handleMessageLongPress(item)}
        delayLongPress={300}
      >
        <Animated.View
          style={[
            isHighlighted && {
              backgroundColor: highlightBackgroundColor,
              borderRadius: 12,
            },
            isSelected && {
              backgroundColor: colors.primary + '20',
              borderRadius: 12,
            },
          ]}
        >
          <MessageBubble
            message={item}
            isMine={isMine}
            showSenderName={showSenderName}
            onLongPress={() => handleMessageLongPress(item)}
            onMediaPress={() => handleMediaPress(item)}
            onReplyPress={() => {
              if (item.replyToMessageId) {
                scrollToAndHighlightMessage(item.replyToMessageId);
              }
            }}
            onCallBack={handleCallBack}
          />
        </Animated.View>
      </TouchableOpacity>
    );

    // Wrap with swipeable only when not in selection mode
    if (!isSelectionMode) {
      return (
        <SwipeableMessage
          onSwipeToReply={() => handleSwipeToReply(item)}
          enabled={!item.isDeleted}
        >
          {messageContent}
        </SwipeableMessage>
      );
    }

    return messageContent;
  }, [
    userId,
    conversation?.type,
    conversationMessages,
    highlightedMessageId,
    selectedMessages,
    isSelectionMode,
    highlightBackgroundColor,
    colors.primary,
    handleMediaPress,
    handleCallBack,
    scrollToAndHighlightMessage,
    toggleMessageSelection,
    handleMessageLongPress,
    handleSwipeToReply,
  ]);

  const renderFooter = () => {
    if (!isLoadingMore) return null;
    return (
      <View style={styles.loadingMore}>
        <ActivityIndicator size="small" color={colors.primary} />
      </View>
    );
  };

  // Filter out current user and get typing user IDs - we only want to show when OTHERS are typing
  const otherTypingUserIds = useMemo(() => {
    return typingUserIds.filter(id => id !== userId);
  }, [typingUserIds, userId]);

  // Get the names of typing users
  const typingNames = useMemo(() => {
    return otherTypingUserIds.map(id => {
      const participant = conversation?.participants.find(p => p.userId === id);
      return participant?.displayName || participant?.fullName || 'Someone';
    });
  }, [otherTypingUserIds, conversation?.participants]);

  // Document preview helpers
  const getAbsoluteUrl = (url: string | undefined): string => {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    // Use apiUrl (base URL without /api)
    const baseUrl = AppConfig.apiUrl;
    return `${baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
  };

  const getFileExtension = (fileName: string): string => {
    const parts = fileName.split('.');
    return parts.length > 1 ? parts.pop()?.toLowerCase() || '' : '';
  };

  const isPdfFile = (fileName: string): boolean => {
    return getFileExtension(fileName) === 'pdf';
  };

  const isImageFile = (fileName: string): boolean => {
    const ext = getFileExtension(fileName);
    return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext);
  };

  // Check if file can be previewed with Google Docs Viewer
  const canPreviewWithGoogleDocs = (fileName: string): boolean => {
    const ext = getFileExtension(fileName);
    return ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext);
  };

  // Get Google Docs Viewer URL for document preview
  const getGoogleDocsViewerUrl = (url: string): string => {
    return `https://docs.google.com/gview?embedded=true&url=${encodeURIComponent(url)}`;
  };

  const getDocumentIcon = (fileName: string): string => {
    const ext = getFileExtension(fileName);
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
    return iconMap[ext] || 'file-document-outline';
  };

  const formatFileSize = (bytes: number | undefined): string => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleDownloadDocument = async () => {
    if (!documentPreviewData) return;

    const { mediaUrl, fileName } = documentPreviewData;
    const absoluteUrl = getAbsoluteUrl(mediaUrl);
    const downloadDest = `${RNFS.DocumentDirectoryPath}/${fileName}`;

    setIsDownloading(true);
    setDownloadProgress(0);

    try {
      const result = await RNFS.downloadFile({
        fromUrl: absoluteUrl,
        toFile: downloadDest,
        progress: (res) => {
          const progress = res.bytesWritten / res.contentLength;
          setDownloadProgress(progress);
        },
        progressDivider: 5,
      }).promise;

      if (result.statusCode === 200) {
        setLocalFilePath(downloadDest);
        Alert.alert('Success', 'Document downloaded successfully');
      } else {
        throw new Error(`Download failed with status ${result.statusCode}`);
      }
    } catch (error) {
      console.error('Download error:', error);
      Alert.alert('Error', 'Failed to download document');
    } finally {
      setIsDownloading(false);
    }
  };

  const handleOpenDocument = async () => {
    console.log('[Document] handleOpenDocument called');

    try {
      if (!documentPreviewData) {
        console.log('[Document] No documentPreviewData');
        return;
      }

      const { mediaUrl, fileName } = documentPreviewData;
      console.log('[Document] Opening:', fileName, 'from:', mediaUrl);

      // Get absolute URL
      const absoluteUrl = getAbsoluteUrl(mediaUrl);
      console.log('[Document] Absolute URL:', absoluteUrl);

      // Get download destination
      const downloadDest = `${RNFS.DocumentDirectoryPath}/${fileName}`;
      console.log('[Document] Download dest:', downloadDest);

      // Check if already downloaded
      let filePath = localFilePath;
      if (!filePath) {
        console.log('[Document] Downloading file...');
        setIsDownloading(true);

        const downloadResult = RNFS.downloadFile({
          fromUrl: absoluteUrl,
          toFile: downloadDest,
          progress: (res) => {
            const progress = res.bytesWritten / res.contentLength;
            setDownloadProgress(progress);
          },
          progressDivider: 5,
        });

        const result = await downloadResult.promise;
        console.log('[Document] Download result:', result.statusCode);

        if (result.statusCode === 200) {
          filePath = downloadDest;
          setLocalFilePath(downloadDest);
        } else {
          throw new Error(`Download failed with status ${result.statusCode}`);
        }
        setIsDownloading(false);
      }

      console.log('[Document] Opening with FileViewer:', filePath);
      await FileViewer.open(filePath, { showOpenWithDialog: true });
      console.log('[Document] FileViewer opened');
    } catch (error: any) {
      console.error('[Document] Error:', error);
      setIsDownloading(false);
      // Check if error is about no app available
      if (error?.message?.includes('No app associated') || error?.message?.includes('No Activity found')) {
        Alert.alert('No App Available', 'There is no app installed to open this file type. Please install an appropriate app or use Share to send it to another app.');
      } else {
        Alert.alert('Error', 'Failed to open document');
      }
    }
  };

  const handleShareDocument = async () => {
    console.log('[Document] handleShareDocument called');

    try {
      if (!documentPreviewData) {
        console.log('[Document] No documentPreviewData for share');
        return;
      }

      const { mediaUrl, fileName } = documentPreviewData;
      console.log('[Document] Sharing:', fileName);

      // Get absolute URL
      const absoluteUrl = getAbsoluteUrl(mediaUrl);
      const downloadDest = `${RNFS.DocumentDirectoryPath}/${fileName}`;

      // Check if already downloaded
      let filePath = localFilePath;
      if (!filePath) {
        console.log('[Document] Downloading for share...');
        setIsDownloading(true);

        const result = await RNFS.downloadFile({
          fromUrl: absoluteUrl,
          toFile: downloadDest,
          progress: (res) => {
            const progress = res.bytesWritten / res.contentLength;
            setDownloadProgress(progress);
          },
          progressDivider: 5,
        }).promise;

        if (result.statusCode === 200) {
          filePath = downloadDest;
          setLocalFilePath(downloadDest);
        } else {
          throw new Error(`Download failed with status ${result.statusCode}`);
        }
        setIsDownloading(false);
      }

      console.log('[Document] Sharing file:', filePath);
      const shareUrl = Platform.OS === 'ios' ? filePath : `file://${filePath}`;
      await Share.share({
        url: shareUrl,
        title: fileName,
      });
      console.log('[Document] Share completed');
    } catch (error) {
      console.error('[Document] Share error:', error);
      setIsDownloading(false);
      Alert.alert('Error', 'Failed to share document');
    }
  };

  const closeDocumentPreview = () => {
    setShowDocumentPreview(false);
    setDocumentPreviewData(null);
    setIsDownloading(false);
    setDownloadProgress(0);
  };

  // Memoized FlatList props for performance
  const keyExtractor = useCallback((item: Message) => item.id, []);

  // Memoize extraData to prevent unnecessary re-renders
  const extraData = useMemo(() => ({
    selectedMessages,
    isSelectionMode,
    highlightedMessageId,
  }), [selectedMessages, isSelectionMode, highlightedMessageId]);

  // Memoize typing indicator component
  const typingIndicator = useMemo(() => {
    if (otherTypingUserIds.length > 0) {
      return <TypingIndicator isVisible={true} names={typingNames} />;
    }
    return null;
  }, [otherTypingUserIds.length, typingNames]);

  if (isLoading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
          Loading messages...
        </Text>
      </View>
    );
  }

  const selectedMessage = getSelectedMessage();
  const canCopy = selectedMessage?.type === 'Text' && !!selectedMessage?.content;
  const canEdit = selectedMessage?.senderId === userId && selectedMessage?.type === 'Text' && !selectedMessage?.isDeleted;

  return (
    <GestureHandlerRootView style={styles.flex}>
      <KeyboardAvoidingView
        style={[styles.container, { backgroundColor: colors.background }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        {/* Offline Banner */}
        {isOffline && (
          <View style={[styles.offlineBanner, { backgroundColor: colors.warning }]}>
            <Icon name="wifi-off" size={16} color={colors.textInverse} />
            <Text style={[styles.offlineBannerText, { color: colors.textInverse }]}>
              You're offline. Showing cached messages.
            </Text>
          </View>
        )}

        {/* Selection Mode Top Action Bar */}
        {isSelectionMode && (
          <MessageSelectionBar
            selectedCount={selectedMessages.size}
            onClose={exitSelectionMode}
            onDelete={handleDelete}
            onForward={handleForward}
            onCopy={handleCopy}
            onReply={handleReply}
            onStar={handleStar}
            onEdit={handleEdit}
            canCopy={canCopy}
            canReply={selectedMessages.size === 1}
            canEdit={canEdit}
          />
        )}

        <View style={styles.messagesContainer}>
          <FlatList
            ref={flatListRef}
            data={isSearchMode ? filteredMessages : conversationMessages}
            renderItem={renderMessage}
            keyExtractor={keyExtractor}
            inverted
            extraData={extraData}
            onEndReached={loadMoreMessages}
            onEndReachedThreshold={0.3}
            ListHeaderComponent={typingIndicator}
            ListFooterComponent={renderFooter}
            contentContainerStyle={styles.messagesList}
            // Performance optimizations - tuned for smaller initial load
            removeClippedSubviews={Platform.OS === 'android'}
            maxToRenderPerBatch={5}
            windowSize={5}
            initialNumToRender={15}
            updateCellsBatchingPeriod={50}
            maintainVisibleContentPosition={{
              minIndexForVisible: 0,
            }}
            onScrollToIndexFailed={(info) => {
              // If scroll fails, wait and try again
              setTimeout(() => {
                flatListRef.current?.scrollToIndex({
                  index: info.index,
                  animated: true,
                  viewPosition: 0.5,
                });
              }, 100);
            }}
          />
        </View>

        {!isSelectionMode && (
          <ChatInput
            onSendMessage={handleSendMessage}
            onAttachmentPress={handleAttachmentPress}
            onSendVoiceNote={handleSendVoiceNote}
            onTypingStart={handleTypingStart}
            onTypingEnd={handleTypingEnd}
            replyingTo={
              replyingTo
                ? {
                    id: replyingTo.id,
                    senderName: replyingTo.senderName || '',
                    content: replyingTo.content || replyingTo.type,
                  }
                : null
            }
            onCancelReply={() => setReplyingTo(null)}
            editingMessage={
              editingMessage
                ? {
                    id: editingMessage.id,
                    content: editingMessage.content || '',
                  }
                : null
            }
            onEditMessage={handleEditMessage}
            onCancelEdit={() => setEditingMessage(null)}
            disabled={isUploading}
          />
        )}

        <MediaPicker
          visible={showMediaPicker}
          onClose={() => setShowMediaPicker(false)}
          onMediaSelected={handleMediaSelected}
          onLocationSelected={handleLocationSelected}
          onContactSelected={handleContactSelected}
        />

        {/* Reactions Popup */}
        <ReactionsPopup
          visible={showReactionsPopup}
          position={reactionsPosition}
          onReact={handleReact}
          onClose={() => {
            setShowReactionsPopup(false);
            setReactionTargetMessage(null);
          }}
        />

        {/* Call Options Menu */}
        <Modal
          visible={showCallMenu}
          transparent
          animationType="fade"
          onRequestClose={() => setShowCallMenu(false)}
        >
          <Pressable
            style={styles.callMenuOverlay}
            onPress={() => setShowCallMenu(false)}
          >
            <View style={[styles.callMenuContainer, { backgroundColor: colors.surface }]}>
              <TouchableOpacity
                style={styles.callMenuItem}
                onPress={() => {
                  setShowCallMenu(false);
                  navigation.navigate('Call', {
                    conversationId,
                    type: 'Voice',
                  });
                }}
              >
                <Icon name="phone" size={24} color={colors.primary} />
                <Text style={[styles.callMenuText, { color: colors.text }]}>Voice Call</Text>
              </TouchableOpacity>

              <View style={[styles.callMenuDivider, { backgroundColor: colors.divider }]} />

              <TouchableOpacity
                style={styles.callMenuItem}
                onPress={() => {
                  setShowCallMenu(false);
                  navigation.navigate('Call', {
                    conversationId,
                    type: 'Video',
                  });
                }}
              >
                <Icon name="video" size={24} color={colors.primary} />
                <Text style={[styles.callMenuText, { color: colors.text }]}>Video Call</Text>
              </TouchableOpacity>

            </View>
          </Pressable>
        </Modal>

        {/* Document Preview Modal */}
        <Modal
          visible={showDocumentPreview}
          transparent={false}
          animationType="fade"
          onRequestClose={closeDocumentPreview}
          statusBarTranslucent
        >
          <View style={[styles.documentPreviewFullScreen, { backgroundColor: '#000' }]}>
            {/* Header with close, download, share */}
            <View style={[styles.documentPreviewHeader, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
              <TouchableOpacity
                style={styles.documentPreviewHeaderBtn}
                onPress={closeDocumentPreview}
              >
                <Icon name="close" size={24} color="#fff" />
              </TouchableOpacity>

              <View style={styles.documentPreviewHeaderTitle}>
                <Text style={styles.documentPreviewHeaderText} numberOfLines={1}>
                  {documentPreviewData?.fileName || 'Document'}
                </Text>
                {documentPreviewData?.fileSize && (
                  <Text style={styles.documentPreviewHeaderSubtext}>
                    {formatFileSize(documentPreviewData.fileSize)}
                  </Text>
                )}
              </View>

              <View style={styles.documentPreviewHeaderActions}>
                {isDownloading ? (
                  <View style={styles.documentPreviewHeaderBtn}>
                    <ActivityIndicator size="small" color="#fff" />
                  </View>
                ) : (
                  <>
                    <TouchableOpacity
                      style={styles.documentPreviewHeaderBtn}
                      onPress={handleDownloadDocument}
                    >
                      <Icon name="download" size={24} color="#fff" />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.documentPreviewHeaderBtn}
                      onPress={handleShareDocument}
                    >
                      <Icon name="share-variant" size={24} color="#fff" />
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </View>

            {/* Preview content */}
            <View style={styles.documentPreviewContent}>
              {documentPreviewData && canPreviewWithGoogleDocs(documentPreviewData.fileName) ? (
                // Use Google Docs Viewer for PDFs and Office documents
                (() => {
                  const absoluteUrl = getAbsoluteUrl(documentPreviewData.mediaUrl);
                  const viewerUrl = getGoogleDocsViewerUrl(absoluteUrl);
                  console.log('[Document Preview] mediaUrl:', documentPreviewData.mediaUrl);
                  console.log('[Document Preview] absoluteUrl:', absoluteUrl);
                  console.log('[Document Preview] viewerUrl:', viewerUrl);
                  return (
                    <WebView
                      source={{ uri: viewerUrl }}
                      style={styles.documentPreviewWebView}
                      startInLoadingState
                      originWhitelist={['*']}
                      javaScriptEnabled={true}
                      domStorageEnabled={true}
                      scalesPageToFit={true}
                      onLoadStart={() => console.log('[Document Preview] WebView loading started')}
                      onLoadEnd={() => console.log('[Document Preview] WebView loading ended')}
                      renderLoading={() => (
                        <View style={styles.documentPreviewLoading}>
                          <ActivityIndicator size="large" color="#fff" />
                          <Text style={styles.documentPreviewLoadingText}>Loading document...</Text>
                        </View>
                      )}
                      onError={(syntheticEvent) => {
                        console.log('[Document Preview] WebView error:', syntheticEvent.nativeEvent);
                      }}
                    />
                  );
                })()
              ) : documentPreviewData && isImageFile(documentPreviewData.fileName) ? (
                <Image
                  source={{ uri: getAbsoluteUrl(documentPreviewData.mediaUrl) }}
                  style={styles.documentPreviewImage}
                  resizeMode="contain"
                />
              ) : (
                // For other file types, show icon with open button
                <View style={styles.documentPreviewIconWrapper}>
                  <Icon
                    name={documentPreviewData ? getDocumentIcon(documentPreviewData.fileName) : 'file-document-outline'}
                    size={120}
                    color="rgba(255,255,255,0.8)"
                  />
                  <Text style={styles.documentPreviewFileType}>
                    {documentPreviewData ? getFileExtension(documentPreviewData.fileName).toUpperCase() : ''} Document
                  </Text>
                  {documentPreviewData?.fileSize && (
                    <Text style={styles.documentPreviewTapText}>
                      {formatFileSize(documentPreviewData.fileSize)}
                    </Text>
                  )}
                  <TouchableOpacity
                    style={styles.pdfLoadButton}
                    onPress={handleOpenDocument}
                    disabled={isDownloading}
                  >
                    {isDownloading ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <>
                        <Icon name="open-in-new" size={20} color="#fff" />
                        <Text style={styles.pdfLoadButtonText}>Open Document</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              )}
            </View>

            {/* Download progress overlay */}
            {isDownloading && (
              <View style={styles.documentPreviewProgressOverlay}>
                <View style={styles.documentPreviewProgressBar}>
                  <View
                    style={[
                      styles.documentPreviewProgressFill,
                      { width: `${downloadProgress * 100}%` },
                    ]}
                  />
                </View>
                <Text style={styles.documentPreviewProgressText}>
                  Downloading... {Math.round(downloadProgress * 100)}%
                </Text>
              </View>
            )}
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </GestureHandlerRootView>
  );
};

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerLeftContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  searchHeaderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: FONTS.sizes.md,
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
  },
  backButton: {
    paddingRight: SPACING.xs,
  },
  headerTitle: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitleText: {
    marginLeft: SPACING.sm,
  },
  headerName: {
    fontSize: FONTS.sizes.lg,
    fontWeight: 'bold',
    maxWidth: 150,
  },
  headerStatus: {
    fontSize: FONTS.sizes.xs,
    opacity: 0.8,
  },
  headerRight: {
    flexDirection: 'row',
  },
  headerButton: {
    padding: SPACING.sm,
    marginLeft: SPACING.xs,
  },
  messagesContainer: {
    flex: 1,
  },
  messagesList: {
    paddingVertical: SPACING.sm,
  },
  loadingMore: {
    padding: SPACING.md,
    alignItems: 'center',
  },
  callMenuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingTop: Platform.OS === 'ios' ? 100 : 60,
    paddingRight: SPACING.md,
  },
  callMenuContainer: {
    borderRadius: 12,
    paddingVertical: SPACING.sm,
    minWidth: 180,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  callMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
  },
  callMenuText: {
    fontSize: FONTS.sizes.md,
    marginLeft: SPACING.md,
    fontWeight: '500',
  },
  callMenuDivider: {
    height: 1,
    marginHorizontal: SPACING.md,
  },
  loadingText: {
    marginTop: SPACING.sm,
    fontSize: FONTS.sizes.sm,
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.md,
  },
  offlineBannerText: {
    marginLeft: SPACING.xs,
    fontSize: FONTS.sizes.sm,
    fontWeight: '500',
  },
  // Full-screen document preview styles
  documentPreviewFullScreen: {
    flex: 1,
  },
  documentPreviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 50 : StatusBar.currentHeight || 24,
    paddingBottom: SPACING.md,
    paddingHorizontal: SPACING.sm,
  },
  documentPreviewHeaderBtn: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  documentPreviewHeaderTitle: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: SPACING.sm,
  },
  documentPreviewHeaderText: {
    color: '#fff',
    fontSize: FONTS.sizes.md,
    fontWeight: '600',
  },
  documentPreviewHeaderSubtext: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: FONTS.sizes.xs,
    marginTop: 2,
  },
  documentPreviewHeaderActions: {
    flexDirection: 'row',
  },
  documentPreviewContent: {
    flex: 1,
  },
  documentPreviewWebView: {
    flex: 1,
    backgroundColor: '#fff',
  },
  documentPreviewImage: {
    width: '100%',
    height: '100%',
  },
  documentPreviewLoading: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.8)',
  },
  documentPreviewLoadingText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: FONTS.sizes.sm,
    marginTop: SPACING.md,
  },
  documentPreviewIconWrapper: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  documentPreviewFileType: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: FONTS.sizes.xl,
    fontWeight: '600',
    marginTop: SPACING.lg,
  },
  documentPreviewTapText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: FONTS.sizes.sm,
    marginTop: SPACING.sm,
    textAlign: 'center',
    paddingHorizontal: SPACING.xl,
  },
  documentPreviewProgressOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: SPACING.lg,
    paddingBottom: Platform.OS === 'ios' ? 40 : SPACING.lg,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  documentPreviewProgressBar: {
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  documentPreviewProgressFill: {
    height: '100%',
    backgroundColor: '#25D366',
    borderRadius: 2,
  },
  documentPreviewProgressText: {
    color: '#fff',
    fontSize: FONTS.sizes.sm,
    textAlign: 'center',
    marginTop: SPACING.sm,
  },
  // PDF preview styles
  pdfLoadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderRadius: SPACING.xl,
    marginTop: SPACING.lg,
  },
  pdfLoadButtonText: {
    color: '#fff',
    fontSize: FONTS.sizes.md,
    fontWeight: '600',
    marginLeft: SPACING.sm,
  },
});

export default ChatScreen;
