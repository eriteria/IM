export interface User {
  id: string;
  serviceNumber: string;
  fullName: string;
  phoneNumber: string;
  displayName?: string;
  profilePictureUrl?: string;
  about?: string;
  lastSeen?: string;
  isOnline: boolean;
  department?: string;
  rankPosition?: string;
}

export interface UserProfile extends User {
  showLastSeen: boolean;
  showProfilePhoto: boolean;
  showAbout: boolean;
  readReceipts: boolean;
  publicKey?: string;
}

export interface Contact {
  id: string;
  contactUserId: string;
  nickname?: string;
  displayName?: string;
  fullName?: string;
  profilePictureUrl?: string;
  about?: string;
  isOnline?: boolean;
  isFavorite: boolean;
  user?: User;
}

export interface Conversation {
  id: string;
  type: 'Private' | 'Group';
  name?: string;
  description?: string;
  iconUrl?: string;
  defaultMessageExpiry: MessageExpiry;
  isArchived: boolean;
  isMuted: boolean;
  mutedUntil?: string;
  lastMessageAt?: string;
  lastMessage?: Message;
  unreadCount: number;
  participants: Participant[];
  createdAt: string;
  isDeleted?: boolean;
  deletedAt?: string;
}

export interface Participant {
  userId: string;
  displayName?: string;
  fullName?: string;
  profilePictureUrl?: string;
  phoneNumber?: string;
  role: 'Member' | 'Admin' | 'Owner';
  isOnline: boolean;
  lastSeen?: string;
  joinedAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  senderName?: string;
  senderProfilePicture?: string;
  type: MessageType;
  content?: string;
  mediaUrl?: string;
  mediaThumbnailUrl?: string;
  mediaMimeType?: string;
  mediaSize?: number;
  mediaDuration?: number;
  replyToMessageId?: string;
  replyToMessage?: Message;
  isForwarded: boolean;
  isEdited: boolean;
  editedAt?: string;
  isDeleted: boolean;
  status: MessageStatus;
  createdAt: string;
  expiresAt?: string;
  statuses: MessageStatusInfo[];
  // Service Number watermarks
  senderServiceNumber?: string;
  originalSenderServiceNumber?: string;  // For forwarded messages
  mediaOriginatorServiceNumber?: string;  // For media attachments
  forwardCount?: number;
  originalCreatedAt?: string;
  // Reactions
  reactions?: MessageReaction[];
  // Upload progress (0-1) for optimistic messages
  uploadProgress?: number;
  // Local file URI for preview before upload completes
  localMediaUri?: string;
}

export interface MessageReaction {
  id: string;
  userId: string;
  userName?: string;
  userServiceNumber?: string;
  emoji: string;
  createdAt: string;
}

export type DeleteType = 'ForMe' | 'ForEveryone' | 'AdminDelete' | 'AutoExpired';

export interface MessageStatusInfo {
  userId: string;
  status: MessageStatus;
  deliveredAt?: string;
  readAt?: string;
}

export type MessageType =
  | 'Text'
  | 'Image'
  | 'Video'
  | 'Audio'
  | 'Document'
  | 'Location'
  | 'Contact'
  | 'Sticker'
  | 'MissedCall'
  | 'MissedVideoCall'
  | 'System';

export type MessageStatus = 'Sending' | 'Sent' | 'Delivered' | 'Read' | 'Failed';

export type MessageExpiry = 24 | 168 | 720 | 2160 | 0; // hours or 0 for never

export interface Call {
  id: string;
  conversationId: string;
  initiatorId: string;
  initiatorName?: string;
  initiatorProfilePicture?: string;
  type: 'Voice' | 'Video';
  status: CallStatus;
  startedAt: string;
  endedAt?: string;
  duration?: number;
  roomId?: string;
  participants: CallParticipant[];
}

export interface CallParticipant {
  userId: string;
  displayName?: string;
  profilePictureUrl?: string;
  status: CallStatus;
  isMuted: boolean;
  isVideoEnabled: boolean;
  joinedAt?: string;
}

export type CallStatus =
  | 'Ringing'
  | 'Connecting'
  | 'Ongoing'
  | 'InProgress'
  | 'Ended'
  | 'Missed'
  | 'Declined'
  | 'Busy';

export type CallType = 'Voice' | 'Video';

export interface Status {
  id: string;
  userId: string;
  userDisplayName?: string;
  userProfilePicture?: string;
  textContent?: string;
  mediaUrl?: string;
  mediaType?: string;
  backgroundColor?: string;
  createdAt: string;
  expiresAt: string;
  viewCount: number;
  isViewed: boolean;
  views: StatusView[];
}

export interface StatusView {
  viewerId: string;
  viewerName?: string;
  viewerProfilePicture?: string;
  viewedAt: string;
}

export interface UserStatuses {
  user: User;
  statuses: Status[];
  hasUnviewed: boolean;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

export interface LoginResponse {
  userId: string;
  displayName: string;
  phoneNumber: string;
  profilePictureUrl?: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

export interface ValidateServiceNumberResponse {
  isValid: boolean;
  fullName?: string;
  department?: string;
  rankPosition?: string;
  nominalRollId?: string;
}

export interface MediaFile {
  id: string;
  fileName: string;
  fileUrl: string;
  thumbnailUrl?: string;
  mimeType: string;
  fileSize: number;
}
