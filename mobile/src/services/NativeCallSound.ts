import { NativeModules, Platform } from 'react-native';

const { CallSoundModule } = NativeModules;

/**
 * Native module to control call sounds and notifications on Android
 * Uses native MediaPlayer for reliable sound playback from raw resources
 */
export const NativeCallSound = {
  /**
   * Play a sound from raw resources
   * @param soundName - Name of the sound file (without extension)
   * @param loop - Whether to loop the sound
   */
  playSound: async (soundName: string, loop: boolean = false): Promise<boolean> => {
    if (Platform.OS === 'android' && CallSoundModule) {
      try {
        console.log('NativeCallSound.playSound:', soundName, 'loop:', loop);
        return await CallSoundModule.playSound(soundName, loop);
      } catch (error) {
        console.log('Error playing native sound:', error);
        return false;
      }
    }
    return false;
  },

  /**
   * Stop the currently playing sound
   */
  stopSound: async (): Promise<boolean> => {
    if (Platform.OS === 'android' && CallSoundModule) {
      try {
        return await CallSoundModule.stopSound();
      } catch (error) {
        console.log('Error stopping native sound:', error);
        return false;
      }
    }
    return false;
  },

  /**
   * Play the device's default phone ringtone
   * This uses the system ringtone configured by the user
   */
  playDefaultRingtone: async (): Promise<boolean> => {
    if (Platform.OS === 'android' && CallSoundModule) {
      try {
        console.log('NativeCallSound.playDefaultRingtone');
        return await CallSoundModule.playDefaultRingtone();
      } catch (error) {
        console.log('Error playing default ringtone:', error);
        return false;
      }
    }
    return false;
  },

  /**
   * Stop the default ringtone
   */
  stopDefaultRingtone: async (): Promise<boolean> => {
    if (Platform.OS === 'android' && CallSoundModule) {
      try {
        return await CallSoundModule.stopDefaultRingtone();
      } catch (error) {
        console.log('Error stopping default ringtone:', error);
        return false;
      }
    }
    return false;
  },

  /**
   * Stop the native ringtone and vibration
   * Call this when a call is answered, declined, or ended
   */
  stopRingtone: async (): Promise<boolean> => {
    if (Platform.OS === 'android' && CallSoundModule) {
      try {
        return await CallSoundModule.stopRingtone();
      } catch (error) {
        console.log('Error stopping native ringtone:', error);
        return false;
      }
    }
    return false;
  },

  /**
   * Cancel the native call notification
   */
  cancelCallNotification: async (): Promise<boolean> => {
    if (Platform.OS === 'android' && CallSoundModule) {
      try {
        return await CallSoundModule.cancelCallNotification();
      } catch (error) {
        console.log('Error cancelling call notification:', error);
        return false;
      }
    }
    return false;
  },
};

export default NativeCallSound;
