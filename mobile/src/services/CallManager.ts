import { Platform } from 'react-native';
import RNCallKeep from 'react-native-callkeep';
import { v4 as uuidv4 } from 'uuid';

// Call state tracking
interface ActiveCall {
  callId: string;
  uuid: string;
  callerName: string;
  isVideo: boolean;
  isOutgoing: boolean;
  startTime?: Date;
}

class CallManagerClass {
  private isInitialized = false;
  private activeCalls: Map<string, ActiveCall> = new Map();

  // Callbacks
  private onAnswerCall: ((callId: string) => void) | null = null;
  private onEndCall: ((callId: string) => void) | null = null;
  private onMuteCall: ((callId: string, muted: boolean) => void) | null = null;
  private onHoldCall: ((callId: string, hold: boolean) => void) | null = null;

  /**
   * Initialize CallKeep (CallKit on iOS only)
   * On Android, we use native CallNotificationService and IncomingCallActivity instead.
   * CallKeep's VoiceConnectionService crashes on Android 10+ due to READ_PHONE_NUMBERS
   * permission requirements that are not met when started from background.
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    // Only initialize CallKeep on iOS
    // On Android, native handling is done by CallNotificationService
    if (Platform.OS !== 'ios') {
      console.log('CallManager: Skipping CallKeep initialization on Android - using native handling');
      this.isInitialized = true;
      return;
    }

    const options = {
      ios: {
        appName: 'IM',
        supportsVideo: true,
        maximumCallGroups: '1',
        maximumCallsPerCallGroup: '1',
        includesCallsInRecents: true,
        ringtoneSound: 'ringtone.caf',
      },
      android: {
        alertTitle: 'Permissions Required',
        alertDescription: 'IM needs access to manage phone calls',
        cancelButton: 'Cancel',
        okButton: 'OK',
        imageName: 'ic_launcher',
        // Self-managed mode for VoIP apps
        selfManaged: true,
        // Additional required permissions
        additionalPermissions: [],
        // Foreground service notification
        foregroundService: {
          channelId: 'calls',
          channelName: 'Incoming Calls',
          notificationTitle: 'IM Call',
          notificationIcon: 'ic_call',
        },
      },
    };

    try {
      await RNCallKeep.setup(options);
      this.isInitialized = true;
      this.setupEventListeners();
      console.log('CallManager initialized successfully');
    } catch (error) {
      console.error('CallManager initialization failed:', error);
      throw error;
    }
  }

  /**
   * Set up event listeners for CallKeep events (iOS only)
   */
  private setupEventListeners(): void {
    // Only set up listeners on iOS - Android uses native handling
    if (Platform.OS !== 'ios') {
      return;
    }

    // Answer call from native UI
    RNCallKeep.addEventListener('answerCall', ({ callUUID }) => {
      console.log('CallKeep: answerCall', callUUID);
      const call = this.getCallByUUID(callUUID);
      if (call && this.onAnswerCall) {
        this.onAnswerCall(call.callId);
      }
    });

    // End call from native UI
    RNCallKeep.addEventListener('endCall', ({ callUUID }) => {
      console.log('CallKeep: endCall', callUUID);
      const call = this.getCallByUUID(callUUID);
      if (call) {
        if (this.onEndCall) {
          this.onEndCall(call.callId);
        }
        this.activeCalls.delete(call.callId);
      }
    });

    // Mute toggle from native UI
    RNCallKeep.addEventListener('didPerformSetMutedCallAction', ({ callUUID, muted }) => {
      console.log('CallKeep: didPerformSetMutedCallAction', callUUID, muted);
      const call = this.getCallByUUID(callUUID);
      if (call && this.onMuteCall) {
        this.onMuteCall(call.callId, muted);
      }
    });

    // Hold toggle from native UI (iOS)
    RNCallKeep.addEventListener('didToggleHoldCallAction', ({ callUUID, hold }) => {
      console.log('CallKeep: didToggleHoldCallAction', callUUID, hold);
      const call = this.getCallByUUID(callUUID);
      if (call && this.onHoldCall) {
        this.onHoldCall(call.callId, hold);
      }
    });

    // DTMF (dial pad) - not typically used in VoIP but required
    RNCallKeep.addEventListener('didPerformDTMFAction', ({ callUUID, digits }) => {
      console.log('CallKeep: DTMF', callUUID, digits);
    });

    // Audio route changed (speaker, bluetooth, etc.)
    RNCallKeep.addEventListener('didChangeAudioRoute', ({ output, reason }) => {
      console.log('CallKeep: Audio route changed', output, reason);
    });

    // Call activated (audio session is ready)
    RNCallKeep.addEventListener('didActivateAudioSession', () => {
      console.log('CallKeep: Audio session activated');
    });

    // Call deactivated
    RNCallKeep.addEventListener('didDeactivateAudioSession', () => {
      console.log('CallKeep: Audio session deactivated');
    });

    // Provider reset (iOS only)
    RNCallKeep.addEventListener('didResetProvider', () => {
      console.log('CallKeep: Provider reset');
      this.activeCalls.clear();
    });
  }

  /**
   * Display incoming call (iOS only - Android uses native handling)
   */
  async displayIncomingCall(
    callId: string,
    callerName: string,
    isVideo: boolean = false,
    callerNumber?: string
  ): Promise<string> {
    // On Android, native CallNotificationService handles incoming calls
    if (Platform.OS !== 'ios') {
      console.log('CallManager: Skipping displayIncomingCall on Android - native handling');
      return '';
    }

    await this.ensureInitialized();

    const uuid = uuidv4();

    const call: ActiveCall = {
      callId,
      uuid,
      callerName,
      isVideo,
      isOutgoing: false,
    };

    this.activeCalls.set(callId, call);

    // Display the incoming call - this wakes the device
    RNCallKeep.displayIncomingCall(
      uuid,
      callerNumber || callerName,
      callerName,
      'generic',
      isVideo
    );

    console.log('CallManager: Displayed incoming call', { callId, uuid, callerName, isVideo });
    return uuid;
  }

  /**
   * Start an outgoing call (iOS only - Android uses native handling)
   */
  async startOutgoingCall(
    callId: string,
    callerName: string,
    isVideo: boolean = false,
    callerNumber?: string
  ): Promise<string> {
    // On Android, we don't need to register with CallKeep
    if (Platform.OS !== 'ios') {
      console.log('CallManager: Skipping startOutgoingCall on Android');
      return '';
    }

    await this.ensureInitialized();

    const uuid = uuidv4();

    const call: ActiveCall = {
      callId,
      uuid,
      callerName,
      isVideo,
      isOutgoing: true,
    };

    this.activeCalls.set(callId, call);

    RNCallKeep.startCall(uuid, callerNumber || callerName, callerName, 'generic', isVideo);

    console.log('CallManager: Started outgoing call', { callId, uuid, callerName, isVideo });
    return uuid;
  }

  /**
   * Report that the call is connected (iOS only)
   */
  reportConnectedCall(callId: string): void {
    if (Platform.OS !== 'ios') return;

    const call = this.activeCalls.get(callId);
    if (call) {
      call.startTime = new Date();
      RNCallKeep.setCurrentCallActive(call.uuid);
      console.log('CallManager: Call connected', callId);
    }
  }

  /**
   * End a call (iOS only - Android uses native handling)
   */
  async endCall(callId: string): Promise<void> {
    if (Platform.OS !== 'ios') {
      console.log('CallManager: Skipping endCall on Android - native handling');
      return;
    }

    const call = this.activeCalls.get(callId);
    if (call) {
      RNCallKeep.endCall(call.uuid);
      this.activeCalls.delete(callId);
      console.log('CallManager: Ended call', callId);
    }
  }

  /**
   * End all active calls (iOS only)
   */
  async endAllCalls(): Promise<void> {
    if (Platform.OS === 'ios') {
      RNCallKeep.endAllCalls();
    }
    this.activeCalls.clear();
    console.log('CallManager: Ended all calls');
  }

  /**
   * Reject an incoming call (iOS only)
   */
  async rejectCall(callId: string): Promise<void> {
    if (Platform.OS !== 'ios') {
      this.activeCalls.delete(callId);
      return;
    }

    const call = this.activeCalls.get(callId);
    if (call) {
      RNCallKeep.rejectCall(call.uuid);
      this.activeCalls.delete(callId);
      console.log('CallManager: Rejected call', callId);
    }
  }

  /**
   * Set call muted state (iOS only)
   */
  setMuted(callId: string, muted: boolean): void {
    if (Platform.OS !== 'ios') return;

    const call = this.activeCalls.get(callId);
    if (call) {
      RNCallKeep.setMutedCall(call.uuid, muted);
      console.log('CallManager: Set muted', callId, muted);
    }
  }

  /**
   * Set call on hold (iOS only)
   */
  setOnHold(callId: string, onHold: boolean): void {
    if (Platform.OS !== 'ios') return;

    const call = this.activeCalls.get(callId);
    if (call) {
      RNCallKeep.setOnHold(call.uuid, onHold);
      console.log('CallManager: Set on hold', callId, onHold);
    }
  }

  /**
   * Update call info (iOS only)
   */
  updateDisplay(callId: string, callerName: string, callerNumber?: string): void {
    if (Platform.OS !== 'ios') return;

    const call = this.activeCalls.get(callId);
    if (call) {
      RNCallKeep.updateDisplay(call.uuid, callerName, callerNumber || callerName);
      call.callerName = callerName;
      console.log('CallManager: Updated display', callId, callerName);
    }
  }

  /**
   * Check if there's an active call
   */
  hasActiveCall(): boolean {
    return this.activeCalls.size > 0;
  }

  /**
   * Get all active calls
   */
  getActiveCalls(): ActiveCall[] {
    return Array.from(this.activeCalls.values());
  }

  /**
   * Get call by ID
   */
  getCall(callId: string): ActiveCall | undefined {
    return this.activeCalls.get(callId);
  }

  /**
   * Set callback handlers
   */
  setCallbacks(callbacks: {
    onAnswerCall?: (callId: string) => void;
    onEndCall?: (callId: string) => void;
    onMuteCall?: (callId: string, muted: boolean) => void;
    onHoldCall?: (callId: string, hold: boolean) => void;
  }): void {
    if (callbacks.onAnswerCall) this.onAnswerCall = callbacks.onAnswerCall;
    if (callbacks.onEndCall) this.onEndCall = callbacks.onEndCall;
    if (callbacks.onMuteCall) this.onMuteCall = callbacks.onMuteCall;
    if (callbacks.onHoldCall) this.onHoldCall = callbacks.onHoldCall;
  }

  /**
   * Configure audio session for VoIP (iOS only)
   */
  async configureAudioSession(): Promise<void> {
    if (Platform.OS === 'ios') {
      // iOS audio session configuration is handled by CallKit
      RNCallKeep.setAvailable(true);
    }
    // On Android, audio is handled by LiveKit/WebRTC directly
  }

  /**
   * Check if CallKeep is available on this device
   */
  async isAvailable(): Promise<boolean> {
    // On Android, we use native handling instead of CallKeep
    if (Platform.OS === 'android') {
      return true; // Native handling is always available
    }
    return true; // iOS always supports CallKit
  }

  /**
   * Request phone account permission (not used on Android with native handling)
   */
  async requestPhoneAccountPermission(): Promise<boolean> {
    // Android uses native handling, no need for phone account
    return true;
  }

  /**
   * Open phone account settings (not used on Android with native handling)
   */
  openPhoneAccountSettings(): void {
    // Not needed with native handling on Android
  }

  /**
   * Get call by UUID
   */
  private getCallByUUID(uuid: string): ActiveCall | undefined {
    for (const call of this.activeCalls.values()) {
      if (call.uuid === uuid) {
        return call;
      }
    }
    return undefined;
  }

  /**
   * Ensure CallKeep is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }
  }

  /**
   * Remove all event listeners (cleanup) - iOS only
   */
  cleanup(): void {
    if (Platform.OS === 'ios') {
      RNCallKeep.removeEventListener('answerCall');
      RNCallKeep.removeEventListener('endCall');
      RNCallKeep.removeEventListener('didPerformSetMutedCallAction');
      RNCallKeep.removeEventListener('didToggleHoldCallAction');
      RNCallKeep.removeEventListener('didPerformDTMFAction');
      RNCallKeep.removeEventListener('didChangeAudioRoute');
      RNCallKeep.removeEventListener('didActivateAudioSession');
      RNCallKeep.removeEventListener('didDeactivateAudioSession');
      RNCallKeep.removeEventListener('didResetProvider');
    }
    this.isInitialized = false;
    this.activeCalls.clear();
  }
}

// Export singleton instance
export const CallManager = new CallManagerClass();
export default CallManager;
