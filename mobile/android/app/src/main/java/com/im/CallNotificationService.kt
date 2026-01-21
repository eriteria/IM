package com.im

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.Ringtone
import android.media.RingtoneManager
import android.os.Build
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class CallNotificationService : FirebaseMessagingService() {

    companion object {
        private const val TAG = "CallNotificationService"
        private const val CALL_CHANNEL_ID = "incoming_calls"
        private const val PTT_CHANNEL_ID = "ptt_notifications"
        const val CALL_NOTIFICATION_ID = 9999
        const val PTT_NOTIFICATION_ID = 9998
        private const val RINGTONE_TIMEOUT_MS = 60000L // 60 seconds

        private var ringtone: Ringtone? = null
        private var vibrator: Vibrator? = null
        private var wakeLock: PowerManager.WakeLock? = null
        private var screenWakeLock: PowerManager.WakeLock? = null  // Store screen wake lock to prevent GC
        private var ringtoneHandler: android.os.Handler? = null
        private var ringtoneTimeoutRunnable: Runnable? = null
        private var currentCallId: String? = null
        private var currentCallerName: String? = null
        private var currentCallType: String? = null
        private var currentConversationId: String? = null
        private val mainHandler = android.os.Handler(android.os.Looper.getMainLooper())

        fun stopRingtone() {
            try {
                // Cancel timeout
                ringtoneTimeoutRunnable?.let { ringtoneHandler?.removeCallbacks(it) }
                ringtoneTimeoutRunnable = null
                ringtoneHandler = null
                currentCallId = null
                currentCallerName = null
                currentCallType = null
                currentConversationId = null

                ringtone?.stop()
                ringtone = null
                vibrator?.cancel()
                vibrator = null
                wakeLock?.let {
                    if (it.isHeld) it.release()
                }
                wakeLock = null
                screenWakeLock?.let {
                    if (it.isHeld) it.release()
                }
                screenWakeLock = null
                Log.d(TAG, "Ringtone and vibration stopped")
            } catch (e: Exception) {
                Log.e(TAG, "Error stopping ringtone: ${e.message}")
            }
        }

        fun getCurrentCallId(): String? = currentCallId

        /**
         * Called when a call ends or is cancelled - stops ringtone and closes the incoming call activity
         */
        fun endCall(context: Context, callId: String?) {
            Log.d(TAG, "endCall called for callId: $callId, currentCallId: $currentCallId")

            // Stop ringtone if this is the current call or if we should end any call
            // Use case-insensitive comparison for GUIDs
            val shouldEnd = callId == null ||
                           currentCallId == null ||
                           callId.equals(currentCallId, ignoreCase = true)

            if (shouldEnd) {
                Log.d(TAG, "Ending call - stopping ringtone and closing UI")
                stopRingtone()

                // Cancel notification
                val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                notificationManager.cancel(CALL_NOTIFICATION_ID)

                // Stop the foreground service if running
                CallForegroundService.stopService(context)

                // Dismiss the overlay service if running
                IncomingCallOverlayService.dismissOverlay(context)

                // Send broadcast to close IncomingCallActivity
                val closeIntent = Intent("com.im.CLOSE_INCOMING_CALL").apply {
                    setPackage(context.packageName)
                }
                context.sendBroadcast(closeIntent)
                Log.d(TAG, "Broadcast sent to close IncomingCallActivity")
            } else {
                Log.d(TAG, "Not ending call - callId mismatch: $callId != $currentCallId")
            }
        }
    }

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        Log.d(TAG, "Message received from: ${remoteMessage.from}")
        Log.d(TAG, "Message data: ${remoteMessage.data}")

        val data = remoteMessage.data
        val type = data["type"]

        when (type) {
            "call" -> {
                Log.d(TAG, "Handling incoming call notification natively")

                val callId = data["callId"] ?: return
                val callerName = data["callerName"] ?: "Unknown"
                val callType = data["callType"] ?: "Voice"
                val callerId = data["callerId"] ?: ""
                val conversationId = data["conversationId"] ?: ""

                // Run on main thread to avoid threading issues
                mainHandler.post {
                    try {
                        // Check if app is in foreground - if so, let React Native handle it
                        val isAppInForeground = MainApplication.isAppInForeground
                        Log.d(TAG, "========== INCOMING CALL ==========")
                        Log.d(TAG, "Call ID: $callId")
                        Log.d(TAG, "Caller: $callerName")
                        Log.d(TAG, "App in foreground: $isAppInForeground")

                        // Also check power manager to see if screen is on
                        val powerManager = getSystemService(Context.POWER_SERVICE) as? PowerManager
                        val isScreenOn = powerManager?.isInteractive == true
                        Log.d(TAG, "Screen is on: $isScreenOn")

                        if (isAppInForeground) {
                            // App is in foreground, just show notification as backup
                            // Don't show native incoming call screen to avoid duplicate screens
                            // React Native will handle showing the in-app call screen via SignalR
                            Log.d(TAG, "App is in foreground, letting React Native handle the call")
                            showCallNotification(callId, callerName, callType, callerId, conversationId)
                            // Also start ringtone as backup in case React Native doesn't handle it
                            startRingtone(callId, callType, callerName, conversationId)
                            return@post
                        }

                        Log.d(TAG, "App is in BACKGROUND - using native call handling")

                        // App is in background or closed - use native handling
                        // Wake up the device first
                        wakeDevice()

                        // Start playing ringtone (use default phone ringtone for video calls)
                        startRingtone(callId, callType, callerName, conversationId)

                        // Strategy for launching the incoming call screen:
                        // 1. If overlay permission granted -> Use overlay (works on ALL Android versions, even 16+)
                        // 2. If screen is off -> Full-screen intent from notification will work
                        // 3. Android 10-15 -> Use foreground service for BAL exemption
                        // 4. Android 16+ without overlay -> Fall back to notification only (user taps notification)

                        // Strategy for launching the incoming call screen when app is in background:
                        // - Screen OFF: Use full-screen intent on notification (works automatically)
                        // - Screen ON + Overlay permission: Use overlay service (works on ALL versions including 16+)
                        // - Screen ON + Android 10-15: Use foreground service (has BAL exemption)
                        // - Screen ON + Android 9-: Launch activity directly
                        // - Screen ON + Android 16+ without overlay: Notification only (user taps to answer)
                        //
                        // IMPORTANT: Only use ONE method at a time to avoid duplicate launches and flashing

                        val canUseOverlay = IncomingCallOverlayService.canDrawOverlays(applicationContext)
                        Log.d(TAG, "Can draw overlays: $canUseOverlay")

                        if (!isScreenOn) {
                            // Screen is off - use full-screen intent (it will launch automatically)
                            // ALSO start foreground service to keep the app process alive
                            // This prevents the activity from being killed on Android 16+
                            Log.d(TAG, "Screen is off - using full-screen intent + foreground service")
                            showCallNotification(callId, callerName, callType, callerId, conversationId, true)
                            // Start foreground service to keep app alive while IncomingCallActivity is shown
                            // Pass launchActivity=false because full-screen intent will launch the activity
                            CallForegroundService.startIncomingCall(
                                applicationContext,
                                callId,
                                callerId,
                                callerName,
                                callType,
                                conversationId,
                                launchActivity = false  // Don't launch activity - full-screen intent will do it
                            )
                        } else if (Build.VERSION.SDK_INT >= 35 && canUseOverlay) {
                            // Android 15+ with screen ON and overlay permission: Use overlay service
                            // This bypasses all BAL restrictions via SYSTEM_ALERT_WINDOW
                            Log.d(TAG, "Android 15+ with screen on - using overlay service (bypasses BAL)")
                            showCallNotification(callId, callerName, callType, callerId, conversationId, false)
                            IncomingCallOverlayService.showIncomingCall(
                                applicationContext,
                                callId,
                                callerId,
                                callerName,
                                callType,
                                conversationId
                            )
                        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && Build.VERSION.SDK_INT < 35) {
                            // Android 10-14 with screen ON: Use foreground service for BAL exemption
                            // Don't use full-screen intent to avoid duplicate launches
                            Log.d(TAG, "Screen is on, Android 10-14 - using foreground service for BAL exemption")
                            showCallNotification(callId, callerName, callType, callerId, conversationId, false)
                            CallForegroundService.startIncomingCall(
                                applicationContext,
                                callId,
                                callerId,
                                callerName,
                                callType,
                                conversationId
                            )
                        } else if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
                            // Android 9 and below - launch activity directly
                            Log.d(TAG, "Android 9 or below - launching activity directly")
                            showCallNotification(callId, callerName, callType, callerId, conversationId, false)
                            launchIncomingCallActivity(callId, callerName, callType, callerId, conversationId)
                        } else {
                            // Android 15+ with screen ON but NO overlay permission - notification only
                            Log.w(TAG, "Android 15+ with screen on, no overlay permission - notification only (user taps to answer)")
                            showCallNotification(callId, callerName, callType, callerId, conversationId, true)
                        }
                        Log.d(TAG, "========== END INCOMING CALL SETUP ==========")
                    } catch (e: Exception) {
                        Log.e(TAG, "Error handling incoming call: ${e.message}", e)
                    }
                }
            }
            "call_ended" -> {
                Log.d(TAG, "Handling call ended notification")
                val callId = data["callId"]
                val callerName = data["callerName"]
                val callType = data["callType"]
                val conversationId = data["conversationId"]
                mainHandler.post {
                    // First end the call (stop ringtone, close UI)
                    endCall(applicationContext, callId)

                    // Show missed call notification if caller info is available
                    if (!callerName.isNullOrEmpty()) {
                        showMissedCallNotification(callerName, callType ?: "Voice", conversationId)
                    }
                }
            }
            "ptt" -> {
                Log.d(TAG, "Handling PTT notification natively")
                val conversationId = data["conversationId"] ?: return
                val senderId = data["senderId"] ?: ""
                val senderName = data["senderName"] ?: "Someone"

                mainHandler.post {
                    try {
                        // Wake the device if screen is off
                        val powerManager = getSystemService(Context.POWER_SERVICE) as? PowerManager
                        val isScreenOn = powerManager?.isInteractive == true

                        if (!isScreenOn) {
                            wakeDevice()
                        }

                        // Show PTT notification
                        showPTTNotification(conversationId, senderId, senderName)

                        // Emit event to React Native if app is in foreground
                        if (MainApplication.isAppInForeground) {
                            Log.d(TAG, "App is in foreground, emitting PTT event to React Native")
                            CallEventModule.emitPTTReceived(applicationContext, conversationId, senderId, senderName)
                        }
                    } catch (e: Exception) {
                        Log.e(TAG, "Error handling PTT notification: ${e.message}", e)
                    }
                }
            }
            else -> {
                // Let the JS side handle non-call notifications
                super.onMessageReceived(remoteMessage)
            }
        }
    }

    @Suppress("DEPRECATION")
    private fun wakeDevice() {
        try {
            val powerManager = getSystemService(Context.POWER_SERVICE) as? PowerManager
            if (powerManager == null) {
                Log.e(TAG, "PowerManager is null, cannot wake device")
                return
            }

            // Release any existing wake locks first
            try {
                wakeLock?.let { if (it.isHeld) it.release() }
                screenWakeLock?.let { if (it.isHeld) it.release() }
            } catch (e: Exception) {
                Log.w(TAG, "Error releasing previous wake locks: ${e.message}")
            }

            // Acquire a partial wake lock to keep CPU running
            wakeLock = powerManager.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "IM:CallWakeLock"
            )
            wakeLock?.acquire(60 * 1000L) // 60 seconds timeout

            // For Android 10+ (API 29+), we rely on the Activity flags to turn on the screen
            // For older versions, use the deprecated wake lock
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
                @Suppress("DEPRECATION")
                screenWakeLock = powerManager.newWakeLock(
                    PowerManager.SCREEN_BRIGHT_WAKE_LOCK or
                    PowerManager.ACQUIRE_CAUSES_WAKEUP,
                    "IM:ScreenWakeLock"
                )
                screenWakeLock?.acquire(10 * 1000L) // Short timeout just to turn on screen
                Log.d(TAG, "Screen wake lock acquired (legacy)")
            } else {
                // On Android 10+, we'll rely on turnScreenOn in the Activity
                // But we can still check if screen is off and log it
                if (!powerManager.isInteractive) {
                    Log.d(TAG, "Screen is off, Activity will turn it on")
                }
            }

            Log.d(TAG, "Device wake lock acquired")
        } catch (e: Exception) {
            Log.e(TAG, "Error waking device: ${e.message}", e)
        }
    }

    private fun startRingtone(callId: String, callType: String = "Voice", callerName: String? = null, conversationId: String? = null) {
        try {
            // Store current call info
            currentCallId = callId
            currentCallerName = callerName
            currentCallType = callType
            currentConversationId = conversationId

            // Use default device ringtone for all call types (voice and video)
            val ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)

            Log.d(TAG, "Using default ringtone URI: $ringtoneUri for $callType call")

            ringtone = RingtoneManager.getRingtone(applicationContext, ringtoneUri)

            // Set audio attributes for call
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                ringtone?.isLooping = true
            }

            // Use the device's current ringer volume instead of forcing max volume
            // This respects the user's notification/ringer settings
            ringtone?.play()
            Log.d(TAG, "Ringtone started playing for call: $callId (type: $callType) from $callerName")

            // Start vibration
            startVibration()

            // Set up timeout to stop ringtone after 60 seconds
            ringtoneHandler = android.os.Handler(android.os.Looper.getMainLooper())
            ringtoneTimeoutRunnable = Runnable {
                Log.d(TAG, "Ringtone timeout reached for call: $callId - showing missed call from $currentCallerName")
                // Store caller info before endCall clears it
                val savedCallerName = currentCallerName ?: "Unknown"
                val savedCallType = currentCallType ?: "Voice"
                val savedConversationId = currentConversationId
                // Use endCall to properly clean up everything including the activity
                endCall(applicationContext, callId)
                // Show missed call notification with saved info
                showMissedCallNotification(savedCallerName, savedCallType, savedConversationId)
            }
            ringtoneHandler?.postDelayed(ringtoneTimeoutRunnable!!, RINGTONE_TIMEOUT_MS)

        } catch (e: Exception) {
            Log.e(TAG, "Error starting ringtone: ${e.message}")
        }
    }

    @Suppress("DEPRECATION")
    private fun startVibration() {
        try {
            // Check if the device should vibrate based on ringer mode
            val audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
            val ringerMode = audioManager.ringerMode

            // Only vibrate if the device is in vibrate mode or normal mode with vibration enabled
            // Skip vibration if the device is in silent mode
            if (ringerMode == AudioManager.RINGER_MODE_SILENT) {
                Log.d(TAG, "Device is in silent mode, skipping vibration")
                return
            }

            vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val vibratorManager = getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
                vibratorManager.defaultVibrator
            } else {
                getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
            }

            // Vibration pattern: wait 0ms, vibrate 500ms, wait 250ms, repeat
            val pattern = longArrayOf(0, 500, 250, 500, 250, 500, 250, 500)

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator?.vibrate(VibrationEffect.createWaveform(pattern, 0))
            } else {
                vibrator?.vibrate(pattern, 0)
            }

            Log.d(TAG, "Vibration started (ringer mode: $ringerMode)")
        } catch (e: Exception) {
            Log.e(TAG, "Error starting vibration: ${e.message}")
        }
    }

    /**
     * Directly launch IncomingCallActivity for better reliability
     * This is called in addition to the full-screen notification
     *
     * NOTE: On Android 10+ (API 29+), direct activity launch from background is blocked
     * by BAL (Background Activity Launch) restrictions. We only attempt this on older
     * Android versions. For Android 10+, we rely entirely on the full-screen intent
     * from the notification.
     */
    private fun launchIncomingCallActivity(
        callId: String,
        callerName: String,
        callType: String,
        callerId: String,
        conversationId: String
    ) {
        // On Android 10+ (API 29+), direct activity launch from background services
        // is blocked by BAL restrictions. Skip the attempt and rely on full-screen intent.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            Log.d(TAG, "Android 10+ detected - skipping direct activity launch (BAL restricted)")
            Log.d(TAG, "Relying on notification's full-screen intent to launch IncomingCallActivity")
            return
        }

        // For Android 9 and below, try to launch directly
        try {
            val intent = Intent(this, IncomingCallActivity::class.java).apply {
                // FLAG_ACTIVITY_NEW_TASK is required when starting from a Service
                // FLAG_ACTIVITY_CLEAR_TOP ensures we don't create multiple instances
                // FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS keeps it out of recent apps
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_CLEAR_TOP or
                        Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS or
                        Intent.FLAG_ACTIVITY_NO_USER_ACTION
                putExtra(IncomingCallActivity.EXTRA_CALL_ID, callId)
                putExtra(IncomingCallActivity.EXTRA_CALLER_ID, callerId)
                putExtra(IncomingCallActivity.EXTRA_CALLER_NAME, callerName)
                putExtra(IncomingCallActivity.EXTRA_CALL_TYPE, callType)
                putExtra(IncomingCallActivity.EXTRA_CONVERSATION_ID, conversationId)
            }

            startActivity(intent)
            Log.d(TAG, "IncomingCallActivity launched directly for call: $callId (Android 9 or below)")
        } catch (e: Exception) {
            Log.e(TAG, "Error launching IncomingCallActivity: ${e.message}", e)
        }
    }

    private fun showCallNotification(
        callId: String,
        callerName: String,
        callType: String,
        callerId: String,
        conversationId: String,
        useFullScreenIntent: Boolean = true
    ) {
        val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        // Create notification channel for Android O+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // Delete existing channel to ensure updated settings are applied
            notificationManager.deleteNotificationChannel(CALL_CHANNEL_ID)

            val channel = NotificationChannel(
                CALL_CHANNEL_ID,
                "Incoming Calls",
                NotificationManager.IMPORTANCE_HIGH
            )
            channel.description = "Incoming call notifications"
            // Respect device Do Not Disturb settings - don't bypass DND
            channel.setBypassDnd(false)
            channel.lockscreenVisibility = NotificationCompat.VISIBILITY_PUBLIC
            channel.enableVibration(true)
            channel.vibrationPattern = longArrayOf(0, 500, 250, 500)
            // Don't set sound here - we're playing it manually with Ringtone
            channel.setSound(null, null)
            notificationManager.createNotificationChannel(channel)
            Log.d(TAG, "Notification channel created/updated: $CALL_CHANNEL_ID")
        }

        // Check if we can use full-screen intents on Android 14+
        val canUseFullScreenIntent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            notificationManager.canUseFullScreenIntent()
        } else {
            true // Assumed granted on older Android versions
        }
        Log.d(TAG, "Can use full-screen intent: $canUseFullScreenIntent (SDK: ${Build.VERSION.SDK_INT})")

        // Create intent to open native IncomingCallActivity (lightweight, no React Native)
        val fullScreenIntent = Intent(this, IncomingCallActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP or
                    Intent.FLAG_ACTIVITY_NO_USER_ACTION
            putExtra(IncomingCallActivity.EXTRA_CALL_ID, callId)
            putExtra(IncomingCallActivity.EXTRA_CALLER_ID, callerId)
            putExtra(IncomingCallActivity.EXTRA_CALLER_NAME, callerName)
            putExtra(IncomingCallActivity.EXTRA_CALL_TYPE, callType)
            putExtra(IncomingCallActivity.EXTRA_CONVERSATION_ID, conversationId)
        }

        val fullScreenPendingIntent = PendingIntent.getActivity(
            this,
            0,
            fullScreenIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Create decline intent
        val declineIntent = Intent(this, CallActionReceiver::class.java).apply {
            action = "DECLINE_CALL"
            putExtra("callId", callId)
        }

        val declinePendingIntent = PendingIntent.getBroadcast(
            this,
            1,
            declineIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Create answer intent - goes to CallActionReceiver to join via API first
        val answerIntent = Intent(this, CallActionReceiver::class.java).apply {
            action = "ANSWER_CALL"
            putExtra("callId", callId)
            putExtra("callerId", callerId)
            putExtra("callerName", callerName)
            putExtra("callType", callType)
            putExtra("conversationId", conversationId)
        }

        val answerPendingIntent = PendingIntent.getBroadcast(
            this,
            2,
            answerIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val callTypeText = if (callType.equals("Video", ignoreCase = true)) "video" else "voice"

        val notificationBuilder = NotificationCompat.Builder(this, CALL_CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(callerName)
            .setContentText("Incoming $callTypeText call")
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setContentIntent(fullScreenPendingIntent)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Decline", declinePendingIntent)
            .addAction(android.R.drawable.ic_menu_call, "Answer", answerPendingIntent)

        // Only set full-screen intent if we have permission AND it's requested
        // (we skip full-screen intent when using overlay to avoid launching both)
        if (canUseFullScreenIntent && useFullScreenIntent) {
            notificationBuilder.setFullScreenIntent(fullScreenPendingIntent, true)
            Log.d(TAG, "Full-screen intent set on notification")
        } else if (!useFullScreenIntent) {
            Log.d(TAG, "Full-screen intent skipped - using overlay instead")
        } else {
            Log.w(TAG, "Full-screen intent NOT available - user needs to grant permission in settings")
        }

        val notification = notificationBuilder.build()

        notificationManager.notify(CALL_NOTIFICATION_ID, notification)
        Log.d(TAG, "Call notification displayed for $callerName with ID: $CALL_NOTIFICATION_ID")
    }

    private fun showPTTNotification(conversationId: String, senderId: String, senderName: String) {
        val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        // Create PTT notification channel for Android O+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val existingChannel = notificationManager.getNotificationChannel(PTT_CHANNEL_ID)
            if (existingChannel == null) {
                val channel = NotificationChannel(
                    PTT_CHANNEL_ID,
                    "Push-to-Talk",
                    NotificationManager.IMPORTANCE_HIGH
                )
                channel.description = "Push-to-Talk notifications"
                channel.lockscreenVisibility = NotificationCompat.VISIBILITY_PUBLIC
                channel.enableVibration(true)
                channel.vibrationPattern = longArrayOf(0, 200)
                notificationManager.createNotificationChannel(channel)
                Log.d(TAG, "PTT notification channel created: $PTT_CHANNEL_ID")
            }
        }

        // Create intent to open the app to the PTT screen
        val intent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            putExtra("navigateTo", "ptt")
            putExtra("conversationId", conversationId)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }

        val pendingIntent = PendingIntent.getActivity(
            this,
            3,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notificationBuilder = NotificationCompat.Builder(this, PTT_CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("$senderName is speaking")
            .setContentText("Tap to join the PTT channel")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .setTimeoutAfter(15000) // Auto dismiss after 15 seconds

        val notification = notificationBuilder.build()
        notificationManager.notify(PTT_NOTIFICATION_ID, notification)
        Log.d(TAG, "PTT notification displayed for $senderName")
    }

    private fun showMissedCallNotification(callerName: String, callType: String, conversationId: String?) {
        val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val missedCallChannelId = "missed_calls"

        // Create missed call notification channel for Android O+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val existingChannel = notificationManager.getNotificationChannel(missedCallChannelId)
            if (existingChannel == null) {
                val channel = NotificationChannel(
                    missedCallChannelId,
                    "Missed Calls",
                    NotificationManager.IMPORTANCE_HIGH
                )
                channel.description = "Missed call notifications"
                channel.lockscreenVisibility = NotificationCompat.VISIBILITY_PUBLIC
                channel.enableVibration(true)
                channel.vibrationPattern = longArrayOf(0, 200, 100, 200)
                notificationManager.createNotificationChannel(channel)
                Log.d(TAG, "Missed call notification channel created")
            }
        }

        // Build the notification
        val missedCallText = if (callType.equals("Video", ignoreCase = true)) {
            "Missed video call"
        } else {
            "Missed voice call"
        }

        // Create intent to open the app
        val intent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            if (!conversationId.isNullOrEmpty()) {
                putExtra("navigateTo", "chat")
                putExtra("conversationId", conversationId)
            }
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }

        val pendingIntent = PendingIntent.getActivity(
            this,
            4,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notificationBuilder = NotificationCompat.Builder(this, missedCallChannelId)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(callerName)
            .setContentText(missedCallText)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MISSED_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)

        // Use a unique notification ID based on timestamp to allow multiple missed calls
        val notificationId = (System.currentTimeMillis() % Int.MAX_VALUE).toInt()
        notificationManager.notify(notificationId, notificationBuilder.build())
        Log.d(TAG, "Missed call notification displayed for $callerName")
    }

    override fun onNewToken(token: String) {
        Log.d(TAG, "New FCM token: $token")
        // Token refresh is handled by JS side
    }
}
