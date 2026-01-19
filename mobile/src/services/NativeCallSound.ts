import { NativeModules, Platform } from 'react-native';

const { CallSoundModule } = NativeModules;

// Log module availability at load time for debugging
if (Platform.OS === 'android') {
  if (CallSoundModule) {
    console.log('[NativeCallSound] CallSoundModule is available');
  } else {
    console.error('[NativeCallSound] WARNING: CallSoundModule is NOT available - sounds will not play on Android!');
  }
}

/**
 * Native module to control call sounds and notifications on Android
 * Uses native MediaPlayer for reliable sound playback from raw resources
 */
export const NativeCallSound = {
  /**
   * Check if the native module is available
   */
  isAvailable: (): boolean => {
    return Platform.OS === 'android' && !!CallSoundModule;
  },

  /**
   * Play a sound from raw resources
   * @param soundName - Name of the sound file (without extension)
   * @param loop - Whether to loop the sound
   */
  playSound: async (soundName: string, loop: boolean = false): Promise<boolean> => {
    if (Platform.OS !== 'android') {
      console.log('[NativeCallSound] playSound called on non-Android platform, skipping');
      return false;
    }

    if (!CallSoundModule) {
      console.error('[NativeCallSound] CallSoundModule not available - cannot play sound:', soundName);
      return false;
    }

    try {
      console.log('[NativeCallSound] playSound:', soundName, 'loop:', loop);
      const result = await CallSoundModule.playSound(soundName, loop);
      console.log('[NativeCallSound] playSound result:', result);
      return result;
    } catch (error) {
      console.error('[NativeCallSound] Error playing native sound:', soundName, error);
      return false;
    }
  },

  /**
   * Stop the currently playing sound
   */
  stopSound: async (): Promise<boolean> => {
    if (Platform.OS !== 'android' || !CallSoundModule) {
      return false;
    }
    try {
      return await CallSoundModule.stopSound();
    } catch (error) {
      console.error('[NativeCallSound] Error stopping native sound:', error);
      return false;
    }
  },

  /**
   * Play the device's default phone ringtone
   * This uses the system ringtone configured by the user
   */
  playDefaultRingtone: async (): Promise<boolean> => {
    if (Platform.OS !== 'android') {
      console.log('[NativeCallSound] playDefaultRingtone called on non-Android platform, skipping');
      return false;
    }

    if (!CallSoundModule) {
      console.error('[NativeCallSound] CallSoundModule not available - cannot play default ringtone');
      return false;
    }

    try {
      console.log('[NativeCallSound] playDefaultRingtone');
      const result = await CallSoundModule.playDefaultRingtone();
      console.log('[NativeCallSound] playDefaultRingtone result:', result);
      return result;
    } catch (error) {
      console.error('[NativeCallSound] Error playing default ringtone:', error);
      return false;
    }
  },

  /**
   * Stop the default ringtone
   */
  stopDefaultRingtone: async (): Promise<boolean> => {
    if (Platform.OS !== 'android' || !CallSoundModule) {
      return false;
    }
    try {
      return await CallSoundModule.stopDefaultRingtone();
    } catch (error) {
      console.error('[NativeCallSound] Error stopping default ringtone:', error);
      return false;
    }
  },

  /**
   * Stop the native ringtone and vibration
   * Call this when a call is answered, declined, or ended
   */
  stopRingtone: async (): Promise<boolean> => {
    if (Platform.OS !== 'android' || !CallSoundModule) {
      return false;
    }
    try {
      return await CallSoundModule.stopRingtone();
    } catch (error) {
      console.error('[NativeCallSound] Error stopping native ringtone:', error);
    }
    return false;
  },

  /**
   * Cancel the native call notification
   */
  cancelCallNotification: async (): Promise<boolean> => {
    if (Platform.OS !== 'android' || !CallSoundModule) {
      return false;
    }
    try {
      return await CallSoundModule.cancelCallNotification();
    } catch (error) {
      console.error('[NativeCallSound] Error cancelling call notification:', error);
      return false;
    }
  },
};

export default NativeCallSound;
