import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  StatusBar,
  Modal,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Storage keys for settings
const STORAGE_KEYS = {
  WIFI_AUTO_DOWNLOAD: '@media_auto_download_wifi',
  MOBILE_AUTO_DOWNLOAD: '@media_auto_download_mobile',
  UPLOAD_QUALITY: '@media_upload_quality',
};

// Auto-download options
type AutoDownloadOption = 'all' | 'photos' | 'none';

// Upload quality options
type UploadQualityOption = 'original' | 'high' | 'standard' | 'low';

interface AutoDownloadSettings {
  wifi: AutoDownloadOption;
  mobile: AutoDownloadOption;
}

const AUTO_DOWNLOAD_LABELS: Record<AutoDownloadOption, string> = {
  all: 'All media',
  photos: 'Photos only',
  none: 'No media',
};

const UPLOAD_QUALITY_LABELS: Record<UploadQualityOption, string> = {
  original: 'Original quality',
  high: 'High quality',
  standard: 'Standard quality',
  low: 'Data saver',
};

const UPLOAD_QUALITY_DESCRIPTIONS: Record<UploadQualityOption, string> = {
  original: 'Send media at full resolution. Uses more data.',
  high: 'High quality compression. Good balance of quality and size.',
  standard: 'Recommended. Good quality with reduced file size.',
  low: 'Maximum compression. Saves the most data.',
};
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { FONTS, SPACING, BORDER_RADIUS } from '../../utils/theme';

interface StorageInfo {
  totalSize: number;
  images: number;
  videos: number;
  audio: number;
  documents: number;
  cache: number;
}

const StorageManagementScreen: React.FC = () => {
  const navigation = useNavigation();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [storageInfo, setStorageInfo] = useState<StorageInfo>({
    totalSize: 0,
    images: 0,
    videos: 0,
    audio: 0,
    documents: 0,
    cache: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isClearing, setIsClearing] = useState<string | null>(null);

  // Media settings state
  const [autoDownloadSettings, setAutoDownloadSettings] = useState<AutoDownloadSettings>({
    wifi: 'all',
    mobile: 'photos',
  });
  const [uploadQuality, setUploadQuality] = useState<UploadQualityOption>('standard');

  // Modal states
  const [showAutoDownloadModal, setShowAutoDownloadModal] = useState(false);
  const [showUploadQualityModal, setShowUploadQualityModal] = useState(false);

  useEffect(() => {
    calculateStorageUsage();
    loadMediaSettings();
  }, []);

  const loadMediaSettings = async () => {
    try {
      const [wifiSetting, mobileSetting, qualitySetting] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.WIFI_AUTO_DOWNLOAD),
        AsyncStorage.getItem(STORAGE_KEYS.MOBILE_AUTO_DOWNLOAD),
        AsyncStorage.getItem(STORAGE_KEYS.UPLOAD_QUALITY),
      ]);

      setAutoDownloadSettings({
        wifi: (wifiSetting as AutoDownloadOption) || 'all',
        mobile: (mobileSetting as AutoDownloadOption) || 'photos',
      });
      setUploadQuality((qualitySetting as UploadQualityOption) || 'standard');
    } catch (error) {
      console.error('Error loading media settings:', error);
    }
  };

  const saveAutoDownloadSetting = async (
    network: 'wifi' | 'mobile',
    value: AutoDownloadOption
  ) => {
    try {
      const key = network === 'wifi'
        ? STORAGE_KEYS.WIFI_AUTO_DOWNLOAD
        : STORAGE_KEYS.MOBILE_AUTO_DOWNLOAD;
      await AsyncStorage.setItem(key, value);
      setAutoDownloadSettings((prev) => ({ ...prev, [network]: value }));
    } catch (error) {
      console.error('Error saving auto-download setting:', error);
      Alert.alert('Error', 'Failed to save setting');
    }
  };

  const saveUploadQuality = async (quality: UploadQualityOption) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.UPLOAD_QUALITY, quality);
      setUploadQuality(quality);
      setShowUploadQualityModal(false);
    } catch (error) {
      console.error('Error saving upload quality:', error);
      Alert.alert('Error', 'Failed to save setting');
    }
  };

  const getAutoDownloadSummary = useCallback(() => {
    return `Wi-Fi: ${AUTO_DOWNLOAD_LABELS[autoDownloadSettings.wifi]}, Mobile: ${AUTO_DOWNLOAD_LABELS[autoDownloadSettings.mobile]}`;
  }, [autoDownloadSettings]);

  const calculateStorageUsage = async () => {
    setIsLoading(true);
    try {
      // Get cache directory size
      const cacheDir = RNFS.CachesDirectoryPath;
      const cacheSize = await getDirectorySize(cacheDir);

      // Get document directory size
      const docDir = RNFS.DocumentDirectoryPath;
      const docSize = await getDirectorySize(docDir);

      // Categorize files
      let images = 0;
      let videos = 0;
      let audio = 0;
      let documents = 0;

      const categorizeFiles = async (dir: string) => {
        try {
          const files = await RNFS.readDir(dir);
          for (const file of files) {
            if (file.isDirectory()) {
              await categorizeFiles(file.path);
            } else {
              const ext = file.name.split('.').pop()?.toLowerCase() || '';
              const size = file.size || 0;

              if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'].includes(ext)) {
                images += size;
              } else if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) {
                videos += size;
              } else if (['mp3', 'wav', 'aac', 'm4a', 'ogg'].includes(ext)) {
                audio += size;
              } else if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt'].includes(ext)) {
                documents += size;
              }
            }
          }
        } catch (e) {
          // Directory might not exist or be accessible
        }
      };

      await categorizeFiles(docDir);

      setStorageInfo({
        totalSize: cacheSize + docSize,
        images,
        videos,
        audio,
        documents,
        cache: cacheSize,
      });
    } catch (error) {
      console.error('Error calculating storage:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getDirectorySize = async (path: string): Promise<number> => {
    let size = 0;
    try {
      const files = await RNFS.readDir(path);
      for (const file of files) {
        if (file.isDirectory()) {
          size += await getDirectorySize(file.path);
        } else {
          size += file.size || 0;
        }
      }
    } catch (e) {
      // Directory might not exist
    }
    return size;
  };

  const formatSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const clearCache = async () => {
    Alert.alert(
      'Clear Cache',
      'This will clear all cached data. Downloaded media will need to be re-downloaded.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            setIsClearing('cache');
            try {
              const cacheDir = RNFS.CachesDirectoryPath;
              const files = await RNFS.readDir(cacheDir);
              for (const file of files) {
                await RNFS.unlink(file.path);
              }
              await calculateStorageUsage();
              Alert.alert('Success', 'Cache cleared successfully');
            } catch (error) {
              console.error('Error clearing cache:', error);
              Alert.alert('Error', 'Failed to clear cache');
            } finally {
              setIsClearing(null);
            }
          },
        },
      ]
    );
  };

  const clearAllMedia = async () => {
    Alert.alert(
      'Clear All Media',
      'This will delete all downloaded images, videos, audio, and documents. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete All',
          style: 'destructive',
          onPress: async () => {
            setIsClearing('all');
            try {
              const docDir = RNFS.DocumentDirectoryPath;
              const mediaDirs = ['images', 'videos', 'audio', 'documents'];

              for (const dir of mediaDirs) {
                const path = `${docDir}/${dir}`;
                try {
                  await RNFS.unlink(path);
                } catch (e) {
                  // Directory might not exist
                }
              }

              // Also clear media files in root documents directory
              await clearMediaFilesByExtension(docDir);

              await calculateStorageUsage();
              Alert.alert('Success', 'All media cleared successfully');
            } catch (error) {
              console.error('Error clearing media:', error);
              Alert.alert('Error', 'Failed to clear media');
            } finally {
              setIsClearing(null);
            }
          },
        },
      ]
    );
  };

  const clearMediaFilesByExtension = async (dir: string) => {
    try {
      const files = await RNFS.readDir(dir);
      const mediaExtensions = [
        'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic',
        'mp4', 'mov', 'avi', 'mkv', 'webm',
        'mp3', 'wav', 'aac', 'm4a', 'ogg',
        'pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt'
      ];

      for (const file of files) {
        if (file.isFile()) {
          const ext = file.name.split('.').pop()?.toLowerCase() || '';
          if (mediaExtensions.includes(ext)) {
            try {
              await RNFS.unlink(file.path);
            } catch (e) {
              // File might be in use
            }
          }
        }
      }
    } catch (e) {
      // Directory error
    }
  };

  const clearMediaByType = async (type: 'images' | 'videos' | 'audio' | 'documents') => {
    const typeLabels = {
      images: 'Images',
      videos: 'Videos',
      audio: 'Audio',
      documents: 'Documents',
    };
    const typeExtensions: Record<string, string[]> = {
      images: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'],
      videos: ['mp4', 'mov', 'avi', 'mkv', 'webm'],
      audio: ['mp3', 'wav', 'aac', 'm4a', 'ogg'],
      documents: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt'],
    };

    Alert.alert(
      `Clear ${typeLabels[type]}`,
      `This will delete all downloaded ${typeLabels[type].toLowerCase()}. This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setIsClearing(type);
            try {
              const docDir = RNFS.DocumentDirectoryPath;

              // Clear media directory
              const mediaPath = `${docDir}/${type}`;
              try {
                await RNFS.unlink(mediaPath);
              } catch (e) {
                // Directory might not exist
              }

              // Also clear files by extension in root directory
              const files = await RNFS.readDir(docDir);
              const extensions = typeExtensions[type];

              for (const file of files) {
                if (file.isFile()) {
                  const ext = file.name.split('.').pop()?.toLowerCase() || '';
                  if (extensions.includes(ext)) {
                    try {
                      await RNFS.unlink(file.path);
                    } catch (e) {
                      // File might be in use
                    }
                  }
                }
              }

              await calculateStorageUsage();
              Alert.alert('Success', `${typeLabels[type]} cleared successfully`);
            } catch (error) {
              console.error(`Error clearing ${type}:`, error);
              Alert.alert('Error', `Failed to clear ${typeLabels[type].toLowerCase()}`);
            } finally {
              setIsClearing(null);
            }
          },
        },
      ]
    );
  };

  const clearAsyncStorage = async () => {
    Alert.alert(
      'Clear App Data',
      'This will clear all app preferences and cached data. You will remain logged in.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            setIsClearing('data');
            try {
              // Get keys to preserve
              const keysToKeep = ['@auth_tokens', '@user_data'];
              const allKeys = await AsyncStorage.getAllKeys();
              const keysToRemove = allKeys.filter((key) => !keysToKeep.includes(key));
              await AsyncStorage.multiRemove(keysToRemove);

              Alert.alert('Success', 'App data cleared successfully');
            } catch (error) {
              console.error('Error clearing app data:', error);
              Alert.alert('Error', 'Failed to clear app data');
            } finally {
              setIsClearing(null);
            }
          },
        },
      ]
    );
  };

  const renderStorageBar = () => {
    const total = storageInfo.totalSize || 1;
    const segments = [
      { color: '#4CAF50', size: storageInfo.images, label: 'Images' },
      { color: '#2196F3', size: storageInfo.videos, label: 'Videos' },
      { color: '#FF9800', size: storageInfo.audio, label: 'Audio' },
      { color: '#9C27B0', size: storageInfo.documents, label: 'Documents' },
      { color: '#607D8B', size: storageInfo.cache, label: 'Cache' },
    ];

    return (
      <View style={styles.storageBarContainer}>
        <View style={styles.storageBar}>
          {segments.map((segment, index) => {
            const width = (segment.size / total) * 100;
            if (width < 1) return null;
            return (
              <View
                key={index}
                style={[
                  styles.storageBarSegment,
                  { backgroundColor: segment.color, width: `${width}%` },
                ]}
              />
            );
          })}
        </View>
        <View style={styles.storageLegend}>
          {segments.map((segment, index) => (
            <View key={index} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: segment.color }]} />
              <Text style={styles.legendText}>{segment.label}</Text>
            </View>
          ))}
        </View>
      </View>
    );
  };

  const renderStorageItem = (
    icon: string,
    title: string,
    size: number,
    color: string,
    type?: 'images' | 'videos' | 'audio' | 'documents'
  ) => (
    <TouchableOpacity
      style={styles.storageItem}
      onPress={() => type && size > 0 && clearMediaByType(type)}
      disabled={!type || size === 0 || isClearing !== null}
    >
      <View style={[styles.storageItemIcon, { backgroundColor: color + '20' }]}>
        <Icon name={icon} size={24} color={color} />
      </View>
      <View style={styles.storageItemInfo}>
        <Text style={styles.storageItemTitle}>{title}</Text>
        <Text style={styles.storageItemSize}>{formatSize(size)}</Text>
      </View>
      {type && size > 0 && (
        <View style={styles.storageItemAction}>
          {isClearing === type ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Icon name="trash-can-outline" size={20} color={colors.textSecondary} />
          )}
        </View>
      )}
    </TouchableOpacity>
  );

  const renderActionButton = (
    icon: string,
    title: string,
    subtitle: string,
    onPress: () => void,
    isLoading: boolean,
    color: string = colors.text
  ) => (
    <TouchableOpacity
      style={styles.actionButton}
      onPress={onPress}
      disabled={isLoading}
    >
      <View style={styles.actionButtonContent}>
        <Icon name={icon} size={24} color={color} />
        <View style={styles.actionButtonText}>
          <Text style={[styles.actionButtonTitle, { color }]}>{title}</Text>
          <Text style={styles.actionButtonSubtitle}>{subtitle}</Text>
        </View>
      </View>
      {isLoading ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : (
        <Icon name="chevron-right" size={24} color={colors.textSecondary} />
      )}
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={colors.surface} />
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <View style={styles.headerContent}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Icon name="arrow-left" size={24} color={colors.headerText} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Storage & Data</Text>
        </View>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Total Storage */}
        <View style={styles.section}>
          <View style={styles.totalStorage}>
            <Icon name="database" size={48} color={colors.primary} />
            <View style={styles.totalStorageInfo}>
              <Text style={styles.totalStorageTitle}>Total Storage Used</Text>
              {isLoading ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Text style={styles.totalStorageSize}>
                  {formatSize(storageInfo.totalSize)}
                </Text>
              )}
            </View>
          </View>
          {!isLoading && renderStorageBar()}
        </View>

        {/* Storage Breakdown */}
        <Text style={styles.sectionTitle}>STORAGE BREAKDOWN</Text>
        <Text style={styles.sectionHint}>Tap to clear individual categories</Text>
        <View style={styles.section}>
          {renderStorageItem('image', 'Images', storageInfo.images, '#4CAF50', 'images')}
          <View style={styles.itemDivider} />
          {renderStorageItem('video', 'Videos', storageInfo.videos, '#2196F3', 'videos')}
          <View style={styles.itemDivider} />
          {renderStorageItem('music', 'Audio', storageInfo.audio, '#FF9800', 'audio')}
          <View style={styles.itemDivider} />
          {renderStorageItem('file-document', 'Documents', storageInfo.documents, '#9C27B0', 'documents')}
          <View style={styles.itemDivider} />
          {renderStorageItem('cached', 'Cache', storageInfo.cache, '#607D8B')}
        </View>

        {/* Actions */}
        <Text style={styles.sectionTitle}>MANAGE STORAGE</Text>
        <View style={styles.actionsSection}>
          {renderActionButton(
            'broom',
            'Clear Cache',
            'Free up space by clearing cached data',
            clearCache,
            isClearing === 'cache',
            colors.text
          )}
          {renderActionButton(
            'trash-can-outline',
            'Clear All Media',
            'Delete all downloaded media files',
            clearAllMedia,
            isClearing === 'all',
            colors.error
          )}
          {renderActionButton(
            'database-remove',
            'Clear App Data',
            'Reset app preferences and cached data',
            clearAsyncStorage,
            isClearing === 'data',
            colors.warning
          )}
        </View>

        {/* Network Usage Settings */}
        <Text style={styles.sectionTitle}>NETWORK USAGE</Text>
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.settingItem}
            onPress={() => setShowAutoDownloadModal(true)}
          >
            <Icon name="download" size={24} color={colors.text} />
            <View style={styles.settingItemText}>
              <Text style={styles.settingItemTitle}>Media auto-download</Text>
              <Text style={styles.settingItemSubtitle}>
                {getAutoDownloadSummary()}
              </Text>
            </View>
            <Icon name="chevron-right" size={24} color={colors.textSecondary} />
          </TouchableOpacity>
          <View style={styles.itemDivider} />
          <TouchableOpacity
            style={styles.settingItem}
            onPress={() => setShowUploadQualityModal(true)}
          >
            <Icon name="quality-high" size={24} color={colors.text} />
            <View style={styles.settingItemText}>
              <Text style={styles.settingItemTitle}>Media upload quality</Text>
              <Text style={styles.settingItemSubtitle}>
                {UPLOAD_QUALITY_LABELS[uploadQuality]}
              </Text>
            </View>
            <Icon name="chevron-right" size={24} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <View style={{ height: insets.bottom + 20 }} />
      </ScrollView>

      {/* Auto-Download Settings Modal */}
      <Modal
        visible={showAutoDownloadModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAutoDownloadModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Media auto-download</Text>
              <TouchableOpacity
                onPress={() => setShowAutoDownloadModal(false)}
                style={styles.modalCloseButton}
              >
                <Icon name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalSectionTitle}>When using Wi-Fi</Text>
            {(['all', 'photos', 'none'] as AutoDownloadOption[]).map((option) => (
              <TouchableOpacity
                key={`wifi-${option}`}
                style={styles.modalOption}
                onPress={() => saveAutoDownloadSetting('wifi', option)}
              >
                <Text style={styles.modalOptionText}>
                  {AUTO_DOWNLOAD_LABELS[option]}
                </Text>
                {autoDownloadSettings.wifi === option && (
                  <Icon name="check" size={24} color={colors.primary} />
                )}
              </TouchableOpacity>
            ))}

            <Text style={[styles.modalSectionTitle, { marginTop: SPACING.lg }]}>
              When using mobile data
            </Text>
            {(['all', 'photos', 'none'] as AutoDownloadOption[]).map((option) => (
              <TouchableOpacity
                key={`mobile-${option}`}
                style={styles.modalOption}
                onPress={() => saveAutoDownloadSetting('mobile', option)}
              >
                <Text style={styles.modalOptionText}>
                  {AUTO_DOWNLOAD_LABELS[option]}
                </Text>
                {autoDownloadSettings.mobile === option && (
                  <Icon name="check" size={24} color={colors.primary} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </Modal>

      {/* Upload Quality Modal */}
      <Modal
        visible={showUploadQualityModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowUploadQualityModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Media upload quality</Text>
              <TouchableOpacity
                onPress={() => setShowUploadQualityModal(false)}
                style={styles.modalCloseButton}
              >
                <Icon name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            {(['original', 'high', 'standard', 'low'] as UploadQualityOption[]).map(
              (option) => (
                <TouchableOpacity
                  key={option}
                  style={styles.modalOption}
                  onPress={() => saveUploadQuality(option)}
                >
                  <View style={styles.modalOptionContent}>
                    <Text style={styles.modalOptionText}>
                      {UPLOAD_QUALITY_LABELS[option]}
                    </Text>
                    <Text style={styles.modalOptionDescription}>
                      {UPLOAD_QUALITY_DESCRIPTIONS[option]}
                    </Text>
                  </View>
                  {uploadQuality === option && (
                    <Icon name="check" size={24} color={colors.primary} />
                  )}
                </TouchableOpacity>
              )
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
};

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingBottom: SPACING.md,
    backgroundColor: colors.surface,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
  },
  backButton: {
    padding: SPACING.xs,
    marginRight: SPACING.sm,
  },
  headerTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: 'bold',
    color: colors.text,
  },
  content: {
    flex: 1,
  },
  section: {
    marginHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.lg,
    marginBottom: SPACING.md,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  sectionTitle: {
    fontSize: FONTS.sizes.xs,
    fontWeight: '600',
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
    color: colors.textSecondary,
  },
  sectionHint: {
    fontSize: FONTS.sizes.xs,
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.sm,
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  totalStorage: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  totalStorageInfo: {
    marginLeft: SPACING.lg,
  },
  totalStorageTitle: {
    fontSize: FONTS.sizes.sm,
    marginBottom: SPACING.xs,
    color: colors.textSecondary,
  },
  totalStorageSize: {
    fontSize: FONTS.sizes.xxl,
    fontWeight: 'bold',
    color: colors.text,
  },
  storageBarContainer: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.lg,
  },
  storageBar: {
    height: 8,
    borderRadius: 4,
    flexDirection: 'row',
    overflow: 'hidden',
    backgroundColor: colors.divider,
  },
  storageBarSegment: {
    height: '100%',
  },
  storageLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: SPACING.md,
    gap: SPACING.md,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: SPACING.xs,
  },
  legendText: {
    fontSize: FONTS.sizes.xs,
    color: colors.textSecondary,
  },
  storageItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.md,
  },
  storageItemIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  storageItemInfo: {
    marginLeft: SPACING.md,
  },
  storageItemTitle: {
    fontSize: FONTS.sizes.md,
    fontWeight: '500',
    color: colors.text,
  },
  storageItemSize: {
    fontSize: FONTS.sizes.sm,
    marginTop: 2,
    color: colors.textSecondary,
  },
  storageItemAction: {
    marginLeft: 'auto',
    padding: SPACING.xs,
  },
  itemDivider: {
    height: 1,
    marginLeft: 72,
    backgroundColor: colors.divider,
  },
  actionsSection: {
    gap: SPACING.sm,
    marginHorizontal: SPACING.md,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.lg,
    backgroundColor: colors.surface,
  },
  actionButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  actionButtonText: {
    marginLeft: SPACING.md,
    flex: 1,
  },
  actionButtonTitle: {
    fontSize: FONTS.sizes.md,
    fontWeight: '500',
  },
  actionButtonSubtitle: {
    fontSize: FONTS.sizes.sm,
    marginTop: 2,
    color: colors.textSecondary,
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.md,
  },
  settingItemText: {
    marginLeft: SPACING.md,
    flex: 1,
  },
  settingItemTitle: {
    fontSize: FONTS.sizes.md,
    fontWeight: '500',
    color: colors.text,
  },
  settingItemSubtitle: {
    fontSize: FONTS.sizes.sm,
    marginTop: 2,
    color: colors.textSecondary,
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
    paddingBottom: SPACING.xxl,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  modalTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: 'bold',
    color: colors.text,
  },
  modalCloseButton: {
    padding: SPACING.xs,
  },
  modalSectionTitle: {
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
    color: colors.textSecondary,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.sm,
    textTransform: 'uppercase',
  },
  modalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  modalOptionContent: {
    flex: 1,
    marginRight: SPACING.md,
  },
  modalOptionText: {
    fontSize: FONTS.sizes.md,
    color: colors.text,
  },
  modalOptionDescription: {
    fontSize: FONTS.sizes.sm,
    color: colors.textSecondary,
    marginTop: SPACING.xs,
  },
});

export default StorageManagementScreen;
