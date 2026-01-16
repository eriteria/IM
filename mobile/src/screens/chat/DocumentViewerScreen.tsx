import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  Platform,
  Alert,
  ActivityIndicator,
  Share,
  Modal,
  Dimensions,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import RNFS from 'react-native-fs';
import { WebView } from 'react-native-webview';
import { RootStackParamList } from '../../navigation/RootNavigator';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { AppConfig } from '../../config';

// Define constants directly to avoid import issues
const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
};

const FONTS = {
  sizes: {
    xs: 10,
    sm: 12,
    md: 14,
    lg: 16,
    xl: 18,
  },
};

const BORDER_RADIUS = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
};

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Helper to convert relative media URLs to full URLs
const getFullMediaUrl = (url: string | undefined): string => {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  const baseUrl = AppConfig.apiUrl;
  return `${baseUrl}${url}`;
};

// Get file extension from filename or URL
const getFileExtension = (filename: string): string => {
  const parts = filename.split('.');
  return parts.length > 1 ? parts.pop()?.toLowerCase() || '' : '';
};

// Get icon based on file type
const getDocumentIcon = (extension: string): string => {
  switch (extension) {
    case 'pdf':
      return 'file-pdf-box';
    case 'doc':
    case 'docx':
      return 'file-word-box';
    case 'xls':
    case 'xlsx':
      return 'file-excel-box';
    case 'ppt':
    case 'pptx':
      return 'file-powerpoint-box';
    case 'txt':
      return 'file-document-outline';
    case 'zip':
    case 'rar':
    case '7z':
      return 'folder-zip';
    case 'mp3':
    case 'wav':
    case 'aac':
      return 'file-music';
    default:
      return 'file-document';
  }
};

// Get icon color based on file type
const getDocumentIconColor = (extension: string): string => {
  switch (extension) {
    case 'pdf':
      return '#E53935';
    case 'doc':
    case 'docx':
      return '#1976D2';
    case 'xls':
    case 'xlsx':
      return '#388E3C';
    case 'ppt':
    case 'pptx':
      return '#E64A19';
    case 'txt':
      return '#757575';
    default:
      return '#607D8B';
  }
};

// Check if file type can be previewed in-app
const canPreview = (extension: string): boolean => {
  // PDFs and Office documents can be viewed via Google Docs Viewer
  // Images and text files can be viewed directly
  return [
    'pdf', 'txt', 'png', 'jpg', 'jpeg', 'gif', 'webp',
    'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'
  ].includes(extension);
};

// Get Google Docs Viewer URL for documents
const getGoogleDocsViewerUrl = (url: string): string => {
  return `https://docs.google.com/gview?embedded=true&url=${encodeURIComponent(url)}`;
};

// Check if file should use Google Docs Viewer
const shouldUseGoogleDocs = (extension: string): boolean => {
  return ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(extension);
};

// Format file size
const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

type DocumentViewerRouteProp = RouteProp<RootStackParamList, 'DocumentViewer'>;

const DocumentViewerScreen: React.FC = () => {
  const route = useRoute<DocumentViewerRouteProp>();
  const navigation = useNavigation();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { mediaUrl, fileName, fileSize, senderName, timestamp } = route.params;

  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [isDownloaded, setIsDownloaded] = useState(false);
  const [localPath, setLocalPath] = useState<string | null>(null);
  // Auto-show full preview for previewable documents
  const [showFullPreview, setShowFullPreview] = useState(true);
  const [isLoading, setIsLoading] = useState(true);

  const fullUrl = getFullMediaUrl(mediaUrl);
  const extension = getFileExtension(fileName);
  const iconName = getDocumentIcon(extension);
  const iconColor = getDocumentIconColor(extension);
  const previewable = canPreview(extension);

  // Check if file already exists locally
  useEffect(() => {
    const checkLocalFile = async () => {
      const downloadPath = `${RNFS.DocumentDirectoryPath}/${fileName}`;
      const exists = await RNFS.exists(downloadPath);
      if (exists) {
        setIsDownloaded(true);
        setLocalPath(downloadPath);
      }
    };
    checkLocalFile();
  }, [fileName]);

  const handleDownload = async () => {
    setIsDownloading(true);
    setDownloadProgress(0);

    try {
      const downloadPath = `${RNFS.DocumentDirectoryPath}/${fileName}`;

      const downloadResult = RNFS.downloadFile({
        fromUrl: fullUrl,
        toFile: downloadPath,
        progress: (res) => {
          const progress = (res.bytesWritten / res.contentLength) * 100;
          setDownloadProgress(progress);
        },
        progressDivider: 1,
      });

      const result = await downloadResult.promise;

      if (result.statusCode === 200) {
        setIsDownloaded(true);
        setLocalPath(downloadPath);
        Alert.alert('Success', 'Document downloaded successfully');
      } else {
        Alert.alert('Error', 'Failed to download document');
      }
    } catch (error) {
      console.error('Download error:', error);
      Alert.alert('Error', 'Failed to download document');
    } finally {
      setIsDownloading(false);
    }
  };

  const handleOpen = async () => {
    if (!localPath) {
      // Download first if not downloaded
      await handleDownload();
      return;
    }

    if (Platform.OS === 'ios') {
      // Use QuickLook on iOS
      const Linking = require('react-native').Linking;
      Linking.openURL(`file://${localPath}`);
    } else {
      // Use intent on Android
      try {
        const FileViewer = require('react-native-file-viewer').default;
        await FileViewer.open(localPath);
      } catch (error) {
        console.error('Error opening file:', error);
        Alert.alert('Error', 'No app found to open this file type');
      }
    }
  };

  const handleShare = async () => {
    try {
      if (localPath && isDownloaded) {
        await Share.share({
          url: Platform.OS === 'ios' ? `file://${localPath}` : localPath,
        });
      } else {
        await Share.share({
          url: fullUrl,
          message: Platform.OS === 'android' ? fullUrl : undefined,
        });
      }
    } catch (error) {
      console.error('Share error:', error);
    }
  };

  const renderPreview = () => {
    // Use Google Docs Viewer for PDFs and Office documents
    if (shouldUseGoogleDocs(extension)) {
      const viewerUrl = getGoogleDocsViewerUrl(fullUrl);
      return (
        <WebView
          source={{ uri: viewerUrl }}
          style={styles.webView}
          startInLoadingState
          onLoadStart={() => setIsLoading(true)}
          onLoadEnd={() => setIsLoading(false)}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          scalesPageToFit={true}
          originWhitelist={['*']}
          renderLoading={() => (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
                Loading document...
              </Text>
            </View>
          )}
          onError={(syntheticEvent) => {
            const { nativeEvent } = syntheticEvent;
            console.warn('WebView error:', nativeEvent);
          }}
        />
      );
    }

    // For text files, we could potentially show inline
    if (extension === 'txt') {
      return (
        <WebView
          source={{ uri: fullUrl }}
          style={styles.webView}
          startInLoadingState
          onLoadStart={() => setIsLoading(true)}
          onLoadEnd={() => setIsLoading(false)}
          renderLoading={() => (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
                Loading text file...
              </Text>
            </View>
          )}
        />
      );
    }

    // For non-previewable files, show a large icon
    return (
      <View style={styles.iconPreviewContainer}>
        <View style={[styles.largeIconContainer, { backgroundColor: iconColor + '20' }]}>
          <Icon name={iconName} size={100} color={iconColor} />
        </View>
        <Text style={[styles.previewFileName, { color: colors.text }]} numberOfLines={2}>
          {fileName}
        </Text>
        <Text style={[styles.previewMeta, { color: colors.textSecondary }]}>
          {extension.toUpperCase()} {fileSize ? `• ${formatFileSize(fileSize)}` : ''}
        </Text>
        {!previewable && (
          <Text style={[styles.noPreviewText, { color: colors.textMuted }]}>
            Preview not available for this file type
          </Text>
        )}
      </View>
    );
  };

  // Close the preview and go back
  const handleClosePreview = () => {
    navigation.goBack();
  };

  // Full screen preview modal
  const renderFullPreviewModal = () => (
    <Modal
      visible={showFullPreview}
      animationType="slide"
      onRequestClose={handleClosePreview}
    >
      <View style={[styles.fullPreviewContainer, { backgroundColor: colors.background }]}>
        <View style={[styles.fullPreviewHeader, { backgroundColor: colors.surface }]}>
          <TouchableOpacity onPress={handleClosePreview} style={styles.closeButton}>
            <Icon name="close" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.fullPreviewTitle, { color: colors.text }]} numberOfLines={1}>
            {fileName}
          </Text>
          <View style={styles.headerActions}>
            <TouchableOpacity onPress={handleDownload} style={styles.headerActionButton}>
              <Icon name="download" size={24} color={colors.text} />
            </TouchableOpacity>
            <TouchableOpacity onPress={handleShare} style={styles.shareButton}>
              <Icon name="share-variant" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>
        </View>
        <View style={styles.fullPreviewContent}>
          {renderPreview()}
        </View>
      </View>
    </Modal>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />

      {/* Semi-transparent overlay background */}
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={() => navigation.goBack()}
      />

      {/* Bottom sheet style container */}
      <View style={[styles.bottomSheet, { backgroundColor: colors.surface }]}>
        {/* Handle bar */}
        <View style={styles.handleContainer}>
          <View style={[styles.handle, { backgroundColor: colors.divider }]} />
        </View>

        {/* Document preview section */}
        <TouchableOpacity
          style={styles.previewSection}
          onPress={() => previewable && setShowFullPreview(true)}
          activeOpacity={previewable ? 0.7 : 1}
        >
          <View style={[styles.previewCard, { backgroundColor: colors.background }]}>
            {previewable && shouldUseGoogleDocs(extension) ? (
              <View style={styles.pdfPreview}>
                <WebView
                  source={{ uri: getGoogleDocsViewerUrl(fullUrl) }}
                  style={styles.miniWebView}
                  scrollEnabled={false}
                  javaScriptEnabled={true}
                  domStorageEnabled={true}
                  onLoadEnd={() => setIsLoading(false)}
                />
                {isLoading && (
                  <View style={styles.previewLoadingOverlay}>
                    <ActivityIndicator size="small" color={colors.primary} />
                  </View>
                )}
                <View style={styles.tapToExpandOverlay}>
                  <Icon name="arrow-expand" size={20} color="#fff" />
                  <Text style={styles.tapToExpandText}>Tap to view</Text>
                </View>
              </View>
            ) : (
              <View style={styles.documentPreview}>
                <View style={[styles.iconContainer, { backgroundColor: iconColor + '20' }]}>
                  <Icon name={iconName} size={48} color={iconColor} />
                </View>
              </View>
            )}
          </View>
        </TouchableOpacity>

        {/* Document info */}
        <View style={styles.infoSection}>
          <Text style={[styles.fileName, { color: colors.text }]} numberOfLines={2}>
            {fileName}
          </Text>
          <View style={styles.metaRow}>
            <Text style={[styles.metaText, { color: colors.textSecondary }]}>
              {extension.toUpperCase()}
            </Text>
            {fileSize && (
              <>
                <Text style={[styles.metaDot, { color: colors.textSecondary }]}>•</Text>
                <Text style={[styles.metaText, { color: colors.textSecondary }]}>
                  {formatFileSize(fileSize)}
                </Text>
              </>
            )}
            {senderName && (
              <>
                <Text style={[styles.metaDot, { color: colors.textSecondary }]}>•</Text>
                <Text style={[styles.metaText, { color: colors.textSecondary }]}>
                  From {senderName}
                </Text>
              </>
            )}
          </View>
        </View>

        {/* Download Progress */}
        {isDownloading && (
          <View style={styles.progressSection}>
            <View style={[styles.progressBar, { backgroundColor: colors.divider }]}>
              <View style={[styles.progress, { width: `${downloadProgress}%`, backgroundColor: colors.primary }]} />
            </View>
            <Text style={[styles.progressText, { color: colors.textSecondary }]}>
              Downloading... {Math.round(downloadProgress)}%
            </Text>
          </View>
        )}

        {/* Action buttons */}
        <View style={styles.actionsContainer}>
          {previewable && (
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: colors.background }]}
              onPress={() => setShowFullPreview(true)}
            >
              <Icon name="eye" size={24} color={colors.primary} />
              <Text style={[styles.actionText, { color: colors.primary }]}>Preview</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: colors.primary }]}
            onPress={isDownloaded ? handleOpen : handleDownload}
            disabled={isDownloading}
          >
            {isDownloading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Icon
                  name={isDownloaded ? "open-in-new" : "download"}
                  size={24}
                  color="#fff"
                />
                <Text style={[styles.actionText, { color: '#fff' }]}>
                  {isDownloaded ? 'Open' : 'Download'}
                </Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: colors.background }]}
            onPress={handleShare}
          >
            <Icon name="share-variant" size={24} color={colors.primary} />
            <Text style={[styles.actionText, { color: colors.primary }]}>Share</Text>
          </TouchableOpacity>
        </View>

        {/* Downloaded badge */}
        {isDownloaded && !isDownloading && (
          <View style={styles.downloadedBadge}>
            <Icon name="check-circle" size={16} color={colors.success} />
            <Text style={[styles.downloadedText, { color: colors.success }]}>
              Downloaded to device
            </Text>
          </View>
        )}
      </View>

      {renderFullPreviewModal()}
    </View>
  );
};

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
    },
    overlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
    },
    bottomSheet: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingBottom: Platform.OS === 'ios' ? 34 : 20,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: -4 },
      shadowOpacity: 0.1,
      shadowRadius: 8,
      elevation: 10,
    },
    handleContainer: {
      alignItems: 'center',
      paddingVertical: SPACING.md,
    },
    handle: {
      width: 40,
      height: 4,
      borderRadius: 2,
    },
    previewSection: {
      paddingHorizontal: SPACING.lg,
      marginBottom: SPACING.md,
    },
    previewCard: {
      borderRadius: BORDER_RADIUS.lg,
      overflow: 'hidden',
      height: 180,
    },
    pdfPreview: {
      flex: 1,
      position: 'relative',
    },
    miniWebView: {
      flex: 1,
    },
    previewLoadingOverlay: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: 'rgba(255,255,255,0.8)',
    },
    tapToExpandOverlay: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      backgroundColor: 'rgba(0,0,0,0.6)',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: SPACING.sm,
      gap: SPACING.xs,
    },
    tapToExpandText: {
      color: '#fff',
      fontSize: FONTS.sizes.sm,
    },
    documentPreview: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    iconContainer: {
      width: 80,
      height: 80,
      borderRadius: 16,
      justifyContent: 'center',
      alignItems: 'center',
    },
    infoSection: {
      paddingHorizontal: SPACING.lg,
      marginBottom: SPACING.md,
    },
    fileName: {
      fontSize: FONTS.sizes.lg,
      fontWeight: '600',
      marginBottom: SPACING.xs,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
    },
    metaText: {
      fontSize: FONTS.sizes.sm,
    },
    metaDot: {
      marginHorizontal: SPACING.xs,
    },
    progressSection: {
      paddingHorizontal: SPACING.lg,
      marginBottom: SPACING.md,
    },
    progressBar: {
      height: 4,
      borderRadius: 2,
      overflow: 'hidden',
      marginBottom: SPACING.xs,
    },
    progress: {
      height: '100%',
    },
    progressText: {
      fontSize: FONTS.sizes.xs,
      textAlign: 'center',
    },
    actionsContainer: {
      flexDirection: 'row',
      paddingHorizontal: SPACING.lg,
      gap: SPACING.sm,
      marginBottom: SPACING.md,
    },
    actionButton: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: SPACING.md,
      borderRadius: BORDER_RADIUS.lg,
      gap: SPACING.xs,
    },
    actionText: {
      fontSize: FONTS.sizes.sm,
      fontWeight: '600',
    },
    downloadedBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: SPACING.xs,
      paddingBottom: SPACING.sm,
    },
    downloadedText: {
      fontSize: FONTS.sizes.sm,
    },
    // Full preview modal styles
    fullPreviewContainer: {
      flex: 1,
    },
    fullPreviewHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingTop: Platform.OS === 'ios' ? 50 : SPACING.md,
      paddingBottom: SPACING.md,
      paddingHorizontal: SPACING.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    closeButton: {
      padding: SPACING.sm,
    },
    fullPreviewTitle: {
      flex: 1,
      fontSize: FONTS.sizes.md,
      fontWeight: '600',
      marginHorizontal: SPACING.sm,
    },
    shareButton: {
      padding: SPACING.sm,
    },
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    headerActionButton: {
      padding: SPACING.sm,
    },
    fullPreviewContent: {
      flex: 1,
    },
    webView: {
      flex: 1,
    },
    loadingContainer: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: 'center',
      alignItems: 'center',
    },
    loadingText: {
      marginTop: SPACING.md,
      fontSize: FONTS.sizes.sm,
    },
    iconPreviewContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: SPACING.xl,
    },
    largeIconContainer: {
      width: 160,
      height: 160,
      borderRadius: 32,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: SPACING.xl,
    },
    previewFileName: {
      fontSize: FONTS.sizes.xl,
      fontWeight: '600',
      textAlign: 'center',
      marginBottom: SPACING.sm,
    },
    previewMeta: {
      fontSize: FONTS.sizes.md,
      marginBottom: SPACING.md,
    },
    noPreviewText: {
      fontSize: FONTS.sizes.sm,
      fontStyle: 'italic',
    },
  });

export default DocumentViewerScreen;
