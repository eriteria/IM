import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '../stores/authStore';
import { getAuthTokens, saveAuthTokens } from '../utils/storage';
import { AppConfig } from '../config';

// API URL is now centralized in AppConfig
const API_URL = AppConfig.apiBaseUrl;

interface RefreshTokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

const createApiClient = (): AxiosInstance => {
  const client = axios.create({
    baseURL: API_URL,
    timeout: 30000,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  // Request interceptor
  client.interceptors.request.use(
    async (config: InternalAxiosRequestConfig) => {
      const tokens = await getAuthTokens();
      if (tokens?.accessToken) {
        config.headers.Authorization = `Bearer ${tokens.accessToken}`;
      }
      return config;
    },
    (error) => Promise.reject(error)
  );

  // Response interceptor
  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

      if (error.response?.status === 401 && !originalRequest._retry) {
        originalRequest._retry = true;

        try {
          const tokens = await getAuthTokens();
          if (tokens?.refreshToken) {
            const response = await axios.post<RefreshTokenResponse>(
              `${API_URL}/auth/refresh`,
              { refreshToken: tokens.refreshToken }
            );

            const newTokens = response.data;
            await saveAuthTokens({
              accessToken: newTokens.accessToken,
              refreshToken: newTokens.refreshToken,
            });

            useAuthStore.getState().updateTokens({
              accessToken: newTokens.accessToken,
              refreshToken: newTokens.refreshToken,
              expiresAt: newTokens.expiresAt,
            });

            originalRequest.headers.Authorization = `Bearer ${newTokens.accessToken}`;
            return client(originalRequest);
          }
        } catch (refreshError) {
          // Logout user if refresh fails
          useAuthStore.getState().logout();
          return Promise.reject(refreshError);
        }
      }

      return Promise.reject(error);
    }
  );

  return client;
};

export const api = createApiClient();

// Auth API
export const authApi = {
  requestLoginToken: (serviceNumber: string) =>
    api.post('/auth/request-token', { serviceNumber }),

  verifyLoginToken: (serviceNumber: string, token: string) =>
    api.post('/auth/verify-token', { serviceNumber, token }),

  logout: () => api.post('/auth/logout'),

  refreshToken: (refreshToken: string) =>
    api.post('/auth/refresh', { refreshToken }),
};

// Users API
export const usersApi = {
  getAll: () => api.get('/users'),

  getMe: () => api.get('/users/me'),

  getUser: (id: string) => api.get(`/users/${id}`),

  search: (query: string) => api.get('/users/search', { params: { query } }),

  updateProfile: (data: {
    displayName?: string;
    about?: string;
    profilePictureUrl?: string;
  }) => api.put('/users/profile', data),

  updatePrivacy: (data: {
    showLastSeen?: boolean;
    showProfilePhoto?: boolean;
    showAbout?: boolean;
    readReceipts?: boolean;
  }) => api.put('/users/privacy', data),

  updatePublicKey: (publicKey: string) =>
    api.put('/users/public-key', { publicKey }),

  blockUser: (userId: string) => api.post(`/users/block/${userId}`),

  unblockUser: (userId: string) => api.delete(`/users/block/${userId}`),

  getBlockedUsers: () => api.get('/users/blocked'),
};

// Conversations API
export const conversationsApi = {
  getAll: () => api.get('/conversations'),

  get: (id: string) => api.get(`/conversations/${id}`),

  getOrCreatePrivate: (otherUserId: string) =>
    api.post(`/conversations/private/${otherUserId}`),

  createPrivate: (otherUserId: string) =>
    api.post(`/conversations/private/${otherUserId}`),

  createGroup: (data: {
    name: string;
    description?: string;
    iconUrl?: string;
    memberIds: string[];
  }) => api.post('/conversations/group', data),

  update: (id: string, data: {
    name?: string;
    description?: string;
    iconUrl?: string;
  }) => api.put(`/conversations/${id}`, data),

  updateGroupPicture: (id: string, formData: FormData) =>
    api.put(`/conversations/${id}/icon`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),

  addParticipant: (id: string, userId: string) =>
    api.post(`/conversations/${id}/participants`, { userId }),

  removeParticipant: (id: string, userId: string) =>
    api.delete(`/conversations/${id}/participants/${userId}`),

  leave: (id: string) => api.post(`/conversations/${id}/leave`),

  updateParticipantRole: (id: string, userId: string, role: string) =>
    api.put(`/conversations/${id}/participants/${userId}/role`, { role }),

  setMessageExpiry: (id: string, expiry: number) =>
    api.put(`/conversations/${id}/expiry`, { expiry }),

  mute: (id: string, until?: string) =>
    api.put(`/conversations/${id}/mute`, { until }),

  archive: (id: string, archive: boolean) =>
    api.put(`/conversations/${id}/archive`, null, { params: { archive } }),

  getMessages: (id: string, page: number = 1, pageSize: number = 50) =>
    api.get(`/conversations/${id}/messages`, { params: { page, pageSize } }),

  getParticipants: (id: string) => api.get(`/conversations/${id}/participants`),
};

// Messages API
export const messagesApi = {
  get: (id: string) => api.get(`/messages/${id}`),

  markDelivered: (id: string) => api.post(`/messages/${id}/delivered`),

  markRead: (id: string) => api.post(`/messages/${id}/read`),

  edit: (id: string, content: string) =>
    api.put(`/messages/${id}`, { content }),

  delete: (id: string, forEveryone: boolean = false) =>
    api.delete(`/messages/${id}`, { params: { forEveryone } }),

  search: (query: string, page: number = 1, pageSize: number = 20) =>
    api.get('/messages/search', { params: { query, page, pageSize } }),

  forward: (messageId: string, conversationIds: string[]) =>
    api.post('/messages/forward', { messageId, conversationIds }),
};

// Calls API
export const callsApi = {
  getHistory: (page: number = 1, pageSize: number = 20) =>
    api.get('/calls', { params: { page, pageSize } }),

  get: (id: string) => api.get(`/calls/${id}`),

  getActive: (conversationId: string) =>
    api.get(`/calls/active/${conversationId}`),

  initiate: (conversationId: string, type: 'Voice' | 'Video') =>
    api.post('/calls/initiate', { conversationId, type }),

  join: (id: string) => api.post(`/calls/${id}/join`),

  decline: (id: string) => api.post(`/calls/${id}/decline`),

  end: (id: string) => api.post(`/calls/${id}/end`),

  updateStatus: (id: string, data: { isMuted?: boolean; isVideoEnabled?: boolean }) =>
    api.put(`/calls/${id}/status`, data),

  deleteCall: (id: string) => api.delete(`/calls/${id}`),

  clearHistory: () => api.delete('/calls/history'),
};

// Contacts API
export const contactsApi = {
  getAll: () => api.get('/contacts'),

  getFavorites: () => api.get('/contacts/favorites'),

  add: (contactUserId: string, nickname?: string) =>
    api.post('/contacts', { contactUserId, nickname }),

  update: (contactUserId: string, data: { nickname?: string; isFavorite?: boolean }) =>
    api.put(`/contacts/${contactUserId}`, data),

  remove: (contactUserId: string) => api.delete(`/contacts/${contactUserId}`),

  sync: (phoneNumbers: string[]) =>
    api.post('/contacts/sync', { phoneNumbers }),
};

// Status API
export const statusApi = {
  getContactStatuses: () => api.get('/status'),

  getMyStatuses: () => api.get('/status/mine'),

  create: (data: {
    textContent?: string;
    mediaUrl?: string;
    mediaType?: string;
    backgroundColor?: string;
  }) => api.post('/status', data),

  view: (id: string) => api.post(`/status/${id}/view`),

  getViews: (id: string) => api.get(`/status/${id}/views`),

  delete: (id: string) => api.delete(`/status/${id}`),
};

// Files API
export const filesApi = {
  upload: (formData: FormData) =>
    api.post('/files/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000, // 120 second timeout for file uploads (documents can be large)
    }),

  // Upload file with progress callback
  uploadWithProgress: (formData: FormData, onProgress?: (progress: number) => void) =>
    api.post('/files/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000, // 120 second timeout for file uploads
      onUploadProgress: (progressEvent) => {
        if (onProgress && progressEvent.total) {
          const progress = progressEvent.loaded / progressEvent.total;
          onProgress(progress);
        }
      },
    }),

  // Upload file from path - creates FormData internally
  uploadFile: async (filePath: string, mimeType: string) => {
    const formData = new FormData();
    const fileName = filePath.split('/').pop() || 'file';
    // Ensure file:// prefix for Android
    const fileUri = filePath.startsWith('file://') ? filePath : `file://${filePath}`;
    console.log('uploadFile: uploading', fileUri, 'mimeType:', mimeType);
    formData.append('file', {
      uri: fileUri,
      type: mimeType,
      name: fileName,
    } as any);
    return api.post('/files/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60000, // 60 second timeout for file uploads
    });
  },

  delete: (id: string) => api.delete(`/files/${id}`),

  getConversationMedia: (conversationId: string, page: number = 1, pageSize: number = 20) =>
    api.get(`/files/conversation/${conversationId}`, { params: { page, pageSize } }),
};

// Notifications API
export const notificationsApi = {
  register: (token: string, platform: string, deviceId?: string) =>
    api.post('/notifications/register', { token, platform, deviceId }),

  unregister: (token: string) =>
    api.post('/notifications/unregister', { token }),

  // Register VoIP push token (iOS only) - for incoming calls that wake the device
  registerVoip: (token: string, platform: string, deviceId?: string) =>
    api.post('/notifications/register-voip', { token, platform, deviceId }),
};

// Channels API
export const channelsApi = {
  getAll: () => api.get('/channels'),

  get: (id: string) => api.get(`/channels/${id}`),

  create: (data: {
    name: string;
    shortName: string;
    description?: string;
    iconUrl?: string;
  }) => api.post('/channels', data),

  update: (id: string, data: {
    name?: string;
    shortName?: string;
    description?: string;
    iconUrl?: string;
  }) => api.put(`/channels/${id}`, data),

  delete: (id: string) => api.delete(`/channels/${id}`),

  follow: (id: string) => api.post(`/channels/${id}/follow`),

  unfollow: (id: string) => api.delete(`/channels/${id}/follow`),

  getFollowing: () => api.get('/channels/following'),

  // Channel Posts
  getPosts: (id: string, page: number = 1, pageSize: number = 20) =>
    api.get(`/channels/${id}/posts`, { params: { page, pageSize } }),

  createPost: (channelId: string, data: {
    content?: string;
    type?: string;
    mediaUrl?: string;
    mediaMimeType?: string;
    mediaSize?: number;
    mediaDuration?: number;
    thumbnailUrl?: string;
  }) => api.post(`/channels/${channelId}/posts`, data),

  deletePost: (postId: string) => api.delete(`/channels/posts/${postId}`),

  pinPost: (postId: string, pin: boolean = true) =>
    api.put(`/channels/posts/${postId}/pin`, null, { params: { pin } }),

  reactToPost: (postId: string, emoji: string) =>
    api.post(`/channels/posts/${postId}/react`, { emoji }),

  viewPost: (postId: string) => api.post(`/channels/posts/${postId}/view`),
};

export default api;
