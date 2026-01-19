import { Platform } from 'react-native';
import { NativeCallSound } from './NativeCallSound';

// Sound file mappings for iOS bundle resources
const IOS_SOUND_FILES: Record<string, string> = {
  ringtone_outgoing: 'ringtone_outgoing',
  ringtone_incoming: 'ringtone_incoming',
  tone_busy: 'tone_busy',
  tone_ended: 'tone_ended',
};

// We'll use react-native-audio-recorder-player for iOS playback
// since react-native-video requires a component
let iosAudioPlayer: any = null;

/**
 * Get or create the iOS audio player instance
 */
async function getIOSAudioPlayer(): Promise<any> {
  if (!iosAudioPlayer) {
    try {
      const AudioRecorderPlayer = require('react-native-audio-recorder-player').default;
      iosAudioPlayer = new AudioRecorderPlayer();
    } catch (error) {
      console.error('Failed to initialize iOS audio player:', error);
      return null;
    }
  }
  return iosAudioPlayer;
}

/**
 * Service to handle call-related sounds (ringtones, call tones, etc.)
 * Uses native Android MediaPlayer for reliable playback on Android
 * Uses react-native-audio-recorder-player for iOS
 */
class CallSoundService {
  private isPlaying: boolean = false;
  private currentSound: 'outgoing' | 'incoming' | 'busy' | 'ended' | null = null;
  private iosLoopInterval: ReturnType<typeof setInterval> | null = null;
  private iosCurrentSoundPath: string | null = null;

  constructor() {
    // No initialization needed
  }

  /**
   * Play a sound on iOS using react-native-audio-recorder-player
   */
  private async playIOSSound(soundName: string, loop: boolean): Promise<void> {
    try {
      const player = await getIOSAudioPlayer();
      if (!player) {
        console.error('[CallSound] iOS audio player not available - cannot play sound');
        throw new Error('iOS audio player not initialized');
      }

      // Stop any currently playing sound
      await this.stopIOSSound();

      // Get the bundled sound file path
      // For iOS, bundled resources need the full path from the main bundle
      // react-native-audio-recorder-player expects paths like: 'filename.mp3' for bundle resources
      // or full file:// paths. For bundled resources, we use just the filename.
      const soundFileName = IOS_SOUND_FILES[soundName];
      if (!soundFileName) {
        console.error(`[CallSound] Unknown sound name: ${soundName}`);
        throw new Error(`Unknown sound: ${soundName}`);
      }

      // Try multiple path formats for iOS compatibility
      // Format 1: Just the filename (works for some versions)
      // Format 2: With extension
      const soundPath = `${soundFileName}.mp3`;
      this.iosCurrentSoundPath = soundPath;

      console.log('[CallSound] iOS: Playing sound:', soundPath, 'loop:', loop);

      // Start playback
      const result = await player.startPlayer(soundPath);
      console.log('[CallSound] iOS: startPlayer result:', result);

      if (loop) {
        // Set up looping by restarting when the sound ends
        player.addPlayBackListener((e: any) => {
          if (e.currentPosition >= e.duration - 100) {
            // Restart for looping
            player.seekToPlayer(0);
          }
        });
      } else {
        // For non-looping, stop when complete
        player.addPlayBackListener((e: any) => {
          if (e.currentPosition >= e.duration - 100) {
            this.stopIOSSound();
          }
        });
      }
      console.log('[CallSound] iOS: Sound playback setup complete');
    } catch (error) {
      console.error('[CallSound] Error playing iOS sound:', error);
      // Re-throw the error so callers know the sound failed to play
      throw error;
    }
  }

  /**
   * Stop iOS sound playback
   */
  private async stopIOSSound(): Promise<void> {
    try {
      const player = await getIOSAudioPlayer();
      if (player) {
        player.removePlayBackListener();
        await player.stopPlayer();
      }
      this.iosCurrentSoundPath = null;
    } catch (error) {
      console.log('Error stopping iOS sound:', error);
    }
  }

  /**
   * Play the outgoing call tone (ringback tone)
   * This is played when calling someone and waiting for them to answer
   */
  async playOutgoingTone(): Promise<void> {
    if (this.isPlaying && this.currentSound === 'outgoing') {
      console.log('[CallSound] Outgoing tone already playing, skipping');
      return; // Already playing
    }

    console.log('[CallSound] === PLAYING OUTGOING TONE (DIAL TONE) ===');
    console.log('[CallSound] Platform:', Platform.OS);

    await this.stopAllSounds();
    this.currentSound = 'outgoing';
    this.isPlaying = true;

    try {
      if (Platform.OS === 'android') {
        // Use native module for Android - plays ringtone_outgoing from raw resources
        console.log('[CallSound] Calling NativeCallSound.playSound(ringtone_outgoing, true)');
        const result = await NativeCallSound.playSound('ringtone_outgoing', true);
        console.log('[CallSound] NativeCallSound.playSound result:', result);
        if (!result) {
          throw new Error('NativeCallSound.playSound returned false - native module may not be available or sound file not found');
        }
      } else if (Platform.OS === 'ios') {
        // iOS: Use react-native-audio-recorder-player
        console.log('[CallSound] Playing iOS sound: ringtone_outgoing');
        await this.playIOSSound('ringtone_outgoing', true);
      }
      console.log('[CallSound] Outgoing tone started successfully');
    } catch (error) {
      console.error('[CallSound] Error playing outgoing tone:', error);
      this.isPlaying = false;
      this.currentSound = null;
      // Re-throw to let callers know the sound failed to play
      throw error;
    }
  }

  /**
   * Play the incoming call ringtone
   * This is played when receiving a call
   * Uses the device's default phone ringtone on Android
   */
  async playIncomingRingtone(): Promise<void> {
    if (this.isPlaying && this.currentSound === 'incoming') {
      console.log('[CallSound] Incoming ringtone already playing, skipping');
      return; // Already playing
    }

    console.log('[CallSound] === PLAYING INCOMING RINGTONE (DEFAULT PHONE RINGTONE) ===');

    await this.stopAllSounds();
    this.currentSound = 'incoming';
    this.isPlaying = true;

    try {
      if (Platform.OS === 'android') {
        // Use the device's default phone ringtone
        console.log('[CallSound] Calling NativeCallSound.playDefaultRingtone()');
        const result = await NativeCallSound.playDefaultRingtone();
        console.log('[CallSound] NativeCallSound.playDefaultRingtone result:', result);
        if (!result) {
          throw new Error('NativeCallSound.playDefaultRingtone returned false - native module may not be available');
        }
      } else if (Platform.OS === 'ios') {
        // On iOS, use the bundled ringtone (iOS handles system ringtone via CallKit)
        console.log('[CallSound] Playing iOS sound: ringtone_incoming');
        await this.playIOSSound('ringtone_incoming', true);
      }
      console.log('[CallSound] Incoming ringtone started successfully');
    } catch (error) {
      console.error('[CallSound] Error playing incoming ringtone:', error);
      this.isPlaying = false;
      this.currentSound = null;
      // Re-throw to let callers know the sound failed to play
      throw error;
    }
  }

  /**
   * Play the busy tone
   * This is played when the call cannot be connected
   */
  async playBusyTone(): Promise<void> {
    console.log('[CallSound] === PLAYING BUSY TONE ===');

    await this.stopAllSounds();
    this.currentSound = 'busy';
    this.isPlaying = true;

    try {
      if (Platform.OS === 'android') {
        // Play once, not looping
        console.log('[CallSound] Calling NativeCallSound.playSound(tone_busy, false)');
        const result = await NativeCallSound.playSound('tone_busy', false);
        console.log('[CallSound] NativeCallSound.playSound result:', result);
        if (!result) {
          throw new Error('NativeCallSound.playSound returned false - native module may not be available or sound file not found');
        }
      } else if (Platform.OS === 'ios') {
        console.log('[CallSound] Playing iOS sound: tone_busy');
        await this.playIOSSound('tone_busy', false);
      }
      console.log('[CallSound] Busy tone started successfully');

      // Auto-clear state after a short delay for non-looping sounds
      setTimeout(() => {
        if (this.currentSound === 'busy') {
          this.isPlaying = false;
          this.currentSound = null;
        }
      }, 3000);
    } catch (error) {
      console.error('[CallSound] Error playing busy tone:', error);
      this.isPlaying = false;
      this.currentSound = null;
      // Re-throw to let callers know the sound failed to play
      throw error;
    }
  }

  /**
   * Play the call ended tone
   * Note: This is a short beep sound to indicate call has ended
   */
  async playEndedTone(): Promise<void> {
    console.log('[CallSound] === PLAYING ENDED TONE ===');

    await this.stopAllSounds();
    this.currentSound = 'ended';
    this.isPlaying = true;

    try {
      if (Platform.OS === 'android') {
        console.log('[CallSound] Calling NativeCallSound.playSound(tone_ended, false)');
        const result = await NativeCallSound.playSound('tone_ended', false);
        console.log('[CallSound] NativeCallSound.playSound result:', result);
        if (!result) {
          throw new Error('NativeCallSound.playSound returned false - native module may not be available or sound file not found');
        }
      } else if (Platform.OS === 'ios') {
        console.log('[CallSound] Playing iOS sound: tone_ended');
        await this.playIOSSound('tone_ended', false);
      }
      console.log('[CallSound] Ended tone started successfully');

      // Auto-clear state after a short delay
      setTimeout(() => {
        if (this.currentSound === 'ended') {
          this.isPlaying = false;
          this.currentSound = null;
        }
      }, 2000);
    } catch (error) {
      console.error('[CallSound] Error playing ended tone:', error);
      this.isPlaying = false;
      this.currentSound = null;
      // Re-throw to let callers know the sound failed to play
      throw error;
    }
  }

  /**
   * Stop all sounds
   */
  async stopAllSounds(): Promise<void> {
    console.log('[CallSound] === STOPPING ALL SOUNDS ===');
    console.log('[CallSound] Current sound:', this.currentSound, 'isPlaying:', this.isPlaying);

    try {
      if (Platform.OS === 'android') {
        // Stop the native sound player
        console.log('[CallSound] Stopping Android native sound player...');
        await NativeCallSound.stopSound();
        // Also stop the default ringtone (in case it was started by playIncomingRingtone)
        console.log('[CallSound] Stopping Android default ringtone...');
        await NativeCallSound.stopDefaultRingtone();
        // Also stop the native notification ringtone (in case it was started by native notification service)
        console.log('[CallSound] Stopping Android native notification ringtone...');
        await NativeCallSound.stopRingtone();
        console.log('[CallSound] Android sounds stopped');
      } else if (Platform.OS === 'ios') {
        // Stop iOS sound playback
        console.log('[CallSound] Stopping iOS sound playback...');
        await this.stopIOSSound();
        console.log('[CallSound] iOS sounds stopped');
      }
    } catch (error) {
      console.log('[CallSound] Error stopping sounds:', error);
    }

    this.isPlaying = false;
    this.currentSound = null;
    console.log('[CallSound] All sounds stopped, state cleared');
  }

  /**
   * Check if any sound is currently playing
   */
  isAnyPlaying(): boolean {
    return this.isPlaying;
  }

  /**
   * Get the current playing sound type
   */
  getCurrentSound(): string | null {
    return this.currentSound;
  }
}

// Export singleton instance
export const callSoundService = new CallSoundService();
export default callSoundService;
