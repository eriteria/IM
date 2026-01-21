package com.im

import android.content.Intent
import android.os.Bundle
import android.util.Log
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  companion object {
    private const val TAG = "MainActivity"
    // Store pending call data for when React Native is ready
    var pendingCallIntent: Intent? = null
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "IM"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  override fun onCreate(savedInstanceState: Bundle?) {
    // Switch from SplashTheme to AppTheme before calling super.onCreate
    setTheme(R.style.AppTheme)
    super.onCreate(savedInstanceState)
    handleCallIntent(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    handleCallIntent(intent)
  }

  private fun handleCallIntent(intent: Intent) {
    val type = intent.getStringExtra("type")
    if (type == "call") {
      val callId = intent.getStringExtra("callId") ?: return
      val action = intent.getStringExtra("action") ?: "incoming"
      val roomToken = intent.getStringExtra("roomToken")
      val liveKitUrl = intent.getStringExtra("liveKitUrl")

      Log.d(TAG, "Handling call intent: callId=$callId, action=$action")
      Log.d(TAG, "Room token present: ${roomToken != null}, liveKitUrl: $liveKitUrl")

      // Stop native ringtone when opening app from notification
      CallNotificationService.stopRingtone()

      // Store the intent for React Native to pick up later
      // We DON'T try to send the event immediately - React Native might not be ready
      // The CallEventModule.getPendingCallData() will be called by JS when it's ready
      pendingCallIntent = intent

      // Also store as PendingCallInfo for more reliable retrieval
      val callerId = intent.getStringExtra("callerId") ?: ""
      val callerName = intent.getStringExtra("callerName") ?: "Unknown"
      val callType = intent.getStringExtra("callType") ?: "Voice"
      val conversationId = intent.getStringExtra("conversationId") ?: ""
      val roomId = intent.getStringExtra("roomId")

      CallEventModule.storePendingCallInfo(
        action, callId, callerId, callerName, callType, conversationId,
        roomToken, roomId, liveKitUrl
      )

      Log.d(TAG, "Call intent stored for React Native to pick up when ready")
    }
  }

}
