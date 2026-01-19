import React, { useState, useRef, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Dimensions } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Video from 'react-native-video';
import { useTheme } from '../context';
import { FONTS, SPACING, BORDER_RADIUS } from '../utils/theme';

// Types for react-native-video v5
interface OnProgressData {
  currentTime: number;
  playableDuration: number;
  seekableDuration: number;
}

interface OnLoadData {
  duration: number;
  currentTime: number;
  naturalSize: { width: number; height: number };
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface AudioPlayerProps {
  uri: string;
  duration?: number;
  isMine?: boolean;
  waveformData?: number[];
}

const PLAYBACK_SPEEDS = [1, 1.5, 2];

const AudioPlayer: React.FC<AudioPlayerProps> = ({ uri, duration = 0, isMine = false, waveformData }) => {
  const { colors, isDark } = useTheme();
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentPosition, setCurrentPosition] = useState(0);
  const [totalDuration, setTotalDuration] = useState(duration);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [isPaused, setIsPaused] = useState(true);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);

  const videoRef = useRef<any>(null);
  const progressAnim = useRef(new Animated.Value(0)).current;

  // Debug: Log the URI being used
  useEffect(() => {
    console.log('AudioPlayer URI:', uri);
  }, [uri]);

  // Generate consistent waveform data based on URI hash or use provided data
  // Reduced to 25 bars to fit within the bubble
  const waveformBars = useMemo(() => {
    if (waveformData && waveformData.length > 0) {
      // Resample if too many bars
      if (waveformData.length > 25) {
        const step = waveformData.length / 25;
        return Array.from({ length: 25 }, (_, i) => waveformData[Math.floor(i * step)]);
      }
      return waveformData;
    }
    // Generate pseudo-random waveform based on uri for consistency
    const seed = uri.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return Array.from({ length: 25 }, (_, i) => {
      const value = Math.sin(seed + i * 0.5) * 0.3 + 0.5 + Math.cos(seed * i * 0.1) * 0.2;
      return Math.max(0.15, Math.min(1, value));
    });
  }, [uri, waveformData]);

  useEffect(() => {
    const progress = totalDuration > 0 ? currentPosition / totalDuration : 0;
    progressAnim.setValue(progress);
  }, [currentPosition, totalDuration]);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handlePlayPause = () => {
    if (isPlaying) {
      setIsPaused(true);
      setIsPlaying(false);
    } else {
      setIsPaused(false);
      setIsPlaying(true);
    }
  };

  const handleProgress = (data: OnProgressData) => {
    console.log('AudioPlayer progress:', data.currentTime, '/', totalDuration);
    setCurrentPosition(data.currentTime);
  };

  const handleLoad = (data: OnLoadData) => {
    console.log('AudioPlayer loaded, duration:', data.duration);
    setTotalDuration(data.duration);
    setIsLoaded(true);
    setHasError(false);
  };

  const handleError = (error: any) => {
    console.error('AudioPlayer error:', error);
    setHasError(true);
    setIsPlaying(false);
    setIsPaused(true);
  };

  const handleEnd = () => {
    console.log('AudioPlayer ended');
    setIsPlaying(false);
    setIsPaused(true);
    setCurrentPosition(0);
    videoRef.current?.seek(0);
  };

  const handleSeek = (position: number) => {
    videoRef.current?.seek(position);
    setCurrentPosition(position);
  };

  const handleWaveformPress = (event: any) => {
    const { locationX } = event.nativeEvent;
    const waveformWidth = SCREEN_WIDTH * 0.7 - 120; // Approximate waveform width
    const seekPercent = Math.max(0, Math.min(1, locationX / waveformWidth));
    const seekTime = seekPercent * totalDuration;
    handleSeek(seekTime);
  };

  const togglePlaybackSpeed = () => {
    const currentIndex = PLAYBACK_SPEEDS.indexOf(playbackSpeed);
    const nextSpeed = PLAYBACK_SPEEDS[(currentIndex + 1) % PLAYBACK_SPEEDS.length];
    setPlaybackSpeed(nextSpeed);
  };

  const progress = totalDuration > 0 ? currentPosition / totalDuration : 0;

  return (
    <View style={[
      styles.container,
      { backgroundColor: isMine ? colors.chatBubbleSent : colors.chatBubbleReceived }
    ]}>
      {/* Hidden Video component for audio playback with speed control */}
      <Video
        ref={videoRef}
        source={{ uri }}
        paused={isPaused}
        rate={playbackSpeed}
        onProgress={handleProgress}
        onLoad={handleLoad}
        onEnd={handleEnd}
        onError={handleError}
        progressUpdateInterval={250}
        playInBackground={false}
        playWhenInactive={false}
        ignoreSilentSwitch="ignore"
        // @ts-ignore - audioOnly is valid in react-native-video v5.x but types may not include it
        audioOnly={true}
        style={styles.hiddenVideo}
      />

      {/* Play/Pause Button */}
      <TouchableOpacity
        style={[
          styles.playButton,
          { backgroundColor: isMine ? colors.primary : colors.secondary }
        ]}
        onPress={handlePlayPause}
      >
        <Icon
          name={isPlaying ? 'pause' : 'play'}
          size={24}
          color={colors.textInverse}
          style={isPlaying ? undefined : { marginLeft: 2 }}
        />
      </TouchableOpacity>

      {/* Waveform */}
      <TouchableOpacity
        style={styles.waveformContainer}
        onPress={handleWaveformPress}
        activeOpacity={0.9}
      >
        <View style={styles.waveform}>
          {waveformBars.map((height, index) => {
            const barProgress = index / waveformBars.length;
            const isPlayed = barProgress <= progress;

            return (
              <View
                key={index}
                style={[
                  styles.waveformBar,
                  {
                    height: Math.max(4, height * 24),
                    backgroundColor: isPlayed
                      ? (isMine ? colors.primary : colors.secondary)
                      : (isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)'),
                  },
                ]}
              />
            );
          })}
        </View>

        {/* Time and Speed display */}
        <View style={styles.timeRow}>
          <Text style={[styles.time, { color: isMine ? colors.chatBubbleSentText : colors.chatBubbleReceivedText }]}>
            {isPlaying || currentPosition > 0
              ? formatTime(currentPosition)
              : formatTime(totalDuration)}
          </Text>

          {/* Speed control button */}
          <TouchableOpacity
            onPress={togglePlaybackSpeed}
            style={[
              styles.speedButton,
              { backgroundColor: isMine ? colors.primary + '20' : colors.secondary + '20' }
            ]}
          >
            <Text style={[styles.speedText, { color: isMine ? colors.primary : colors.secondary }]}>
              {playbackSpeed}x
            </Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>

      {/* Microphone icon (WhatsApp style) */}
      <View style={[styles.micIcon, { backgroundColor: isMine ? colors.primary + '20' : colors.secondary + '20' }]}>
        <Icon
          name="microphone"
          size={16}
          color={isMine ? colors.primary : colors.secondary}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    padding: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    minWidth: 220,
    maxWidth: SCREEN_WIDTH * 0.7,
  },
  hiddenVideo: {
    width: 0,
    height: 0,
    position: 'absolute',
  },
  playButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.sm,
  },
  waveformContainer: {
    flex: 1,
    marginRight: SPACING.sm,
    overflow: 'hidden',
  },
  waveform: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 28,
    gap: 2,
    overflow: 'hidden',
  },
  waveformBar: {
    width: 3,
    borderRadius: 1.5,
    minHeight: 4,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  time: {
    fontSize: FONTS.sizes.xs,
  },
  speedButton: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: BORDER_RADIUS.sm,
    minWidth: 32,
    alignItems: 'center',
  },
  speedText: {
    fontSize: FONTS.sizes.xs,
    fontWeight: '700',
  },
  micIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default AudioPlayer;
