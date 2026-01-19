package com.im

import android.app.NotificationManager
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.Ringtone
import android.media.RingtoneManager
import android.os.Build
import android.util.Log
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise

class CallSoundModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "CallSoundModule"
        private var mediaPlayer: MediaPlayer? = null
        private var systemRingtone: Ringtone? = null
    }

    override fun getName(): String = "CallSoundModule"

    @ReactMethod
    fun playSound(soundName: String, loop: Boolean, promise: Promise) {
        try {
            Log.d(TAG, "Playing sound: $soundName, loop: $loop")

            // Stop any currently playing sound
            stopMediaPlayer()

            // Get the resource ID for the sound
            val resourceId = reactApplicationContext.resources.getIdentifier(
                soundName,
                "raw",
                reactApplicationContext.packageName
            )

            if (resourceId == 0) {
                Log.e(TAG, "Sound resource not found: $soundName")
                promise.reject("ERROR", "Sound resource not found: $soundName")
                return
            }

            Log.d(TAG, "Found resource ID: $resourceId for $soundName")

            // Use different audio attributes based on sound type
            // For outgoing ringtone (dial tone), use NOTIFICATION_RINGTONE to ensure it plays through speaker
            // For other tones (busy, ended), use voice communication signalling
            val audioAttributes = if (soundName == "ringtone_outgoing") {
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
            } else {
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION_SIGNALLING)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
            }

            // Set volume to max for outgoing ringtone
            if (soundName == "ringtone_outgoing") {
                val audioManager = reactApplicationContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
                val maxVolume = audioManager.getStreamMaxVolume(AudioManager.STREAM_RING)
                audioManager.setStreamVolume(AudioManager.STREAM_RING, maxVolume, 0)
                Log.d(TAG, "Set STREAM_RING volume to max: $maxVolume")
            }

            mediaPlayer = MediaPlayer.create(reactApplicationContext, resourceId).apply {
                setAudioAttributes(audioAttributes)
                isLooping = loop
                setVolume(1.0f, 1.0f)

                setOnCompletionListener { mp ->
                    if (!loop) {
                        Log.d(TAG, "Sound completed: $soundName")
                        mp.release()
                        if (mediaPlayer == mp) {
                            mediaPlayer = null
                        }
                    }
                }

                setOnErrorListener { mp, what, extra ->
                    Log.e(TAG, "MediaPlayer error: what=$what, extra=$extra")
                    mp.release()
                    if (mediaPlayer == mp) {
                        mediaPlayer = null
                    }
                    true
                }

                start()
            }

            Log.d(TAG, "Sound started playing: $soundName")
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "Error playing sound: ${e.message}")
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun stopSound(promise: Promise) {
        try {
            Log.d(TAG, "Stopping sound")
            stopMediaPlayer()
            stopSystemRingtone()
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "Error stopping sound: ${e.message}")
            promise.reject("ERROR", e.message)
        }
    }

    /**
     * Play the system default phone ringtone
     */
    @ReactMethod
    fun playDefaultRingtone(promise: Promise) {
        try {
            Log.d(TAG, "Playing default system ringtone")

            // Stop any currently playing sounds
            stopMediaPlayer()
            stopSystemRingtone()

            // Get the default ringtone URI
            val ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
            Log.d(TAG, "Default ringtone URI: $ringtoneUri")

            systemRingtone = RingtoneManager.getRingtone(reactApplicationContext, ringtoneUri)

            // Set looping on Android P+
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                systemRingtone?.isLooping = true
            }

            // Set volume to max for calls
            val audioManager = reactApplicationContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            val maxVolume = audioManager.getStreamMaxVolume(AudioManager.STREAM_RING)
            audioManager.setStreamVolume(AudioManager.STREAM_RING, maxVolume, 0)

            systemRingtone?.play()
            Log.d(TAG, "Default ringtone started playing")
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "Error playing default ringtone: ${e.message}")
            promise.reject("ERROR", e.message)
        }
    }

    /**
     * Stop the system ringtone
     */
    @ReactMethod
    fun stopDefaultRingtone(promise: Promise) {
        try {
            Log.d(TAG, "Stopping default ringtone")
            stopSystemRingtone()
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "Error stopping default ringtone: ${e.message}")
            promise.reject("ERROR", e.message)
        }
    }

    private fun stopSystemRingtone() {
        systemRingtone?.let { ringtone ->
            try {
                if (ringtone.isPlaying) {
                    ringtone.stop()
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error stopping system ringtone: ${e.message}")
            }
            systemRingtone = null
        }
    }

    private fun stopMediaPlayer() {
        Log.d(TAG, "stopMediaPlayer called, mediaPlayer is ${if (mediaPlayer == null) "null" else "not null"}")
        mediaPlayer?.let { mp ->
            try {
                Log.d(TAG, "Stopping media player, isPlaying: ${mp.isPlaying}")
                // Always try to stop, regardless of isPlaying state
                // The player might be in a prepared but not playing state
                try {
                    mp.stop()
                    Log.d(TAG, "Media player stopped")
                } catch (stopError: Exception) {
                    Log.d(TAG, "Stop failed (might already be stopped): ${stopError.message}")
                }
                mp.release()
                Log.d(TAG, "Media player released")
            } catch (e: Exception) {
                Log.e(TAG, "Error releasing media player: ${e.message}")
            }
            mediaPlayer = null
        }
    }

    @ReactMethod
    fun stopRingtone(promise: Promise) {
        try {
            Log.d(TAG, "Stopping ringtone from React Native")
            CallNotificationService.stopRingtone()

            // Also stop any media player sound
            stopMediaPlayer()

            // Also stop system ringtone
            stopSystemRingtone()

            // Also cancel the notification
            val notificationManager = reactApplicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.cancel(CallNotificationService.CALL_NOTIFICATION_ID)

            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "Error stopping ringtone: ${e.message}")
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun cancelCallNotification(promise: Promise) {
        try {
            val notificationManager = reactApplicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.cancel(CallNotificationService.CALL_NOTIFICATION_ID)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }
}
