# Audio Routing Management - Detailed Breakdown

This document provides a comprehensive breakdown of how audio routing is managed in the IM mobile application.

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Audio Routing for Voice/Video Calls](#audio-routing-for-voicevideo-calls)
4. [Push-to-Talk (PTT) Audio System](#push-to-talk-ptt-audio-system)
5. [Call Sound Management](#call-sound-management)
6. [Platform-Specific Implementation](#platform-specific-implementation)
7. [Audio Device Detection and Routing](#audio-device-detection-and-routing)
8. [Audio Flow Diagrams](#audio-flow-diagrams)

---

## Overview

The IM app handles three distinct types of audio:

1. **Voice/Video Calls** - Real-time communication using LiveKit/WebRTC
2. **Push-to-Talk (PTT)** - Walkie-talkie style voice messages with real-time streaming
3. **Call Sounds** - Ringtones, dial tones, busy signals, and call ended tones

Each audio type has its own routing strategy and implementation to ensure optimal audio quality and user experience.

---

## Architecture

### High-Level Components

```
┌─────────────────────────────────────────────────────────────┐
│                    React Native Layer                        │
├─────────────────────────────────────────────────────────────┤
│  CallScreen.tsx  │  PTTButton  │  CallSoundService          │
├─────────────────────────────────────────────────────────────┤
│  Services:                                                   │
│  - CallManager.ts (CallKit integration - iOS only)          │
│  - NativeCallSound.ts (Android sound bridge)                │
│  - NativePTTAudio.ts (PTT audio bridge)                     │
│  - PTTStreamService.ts (PTT capture & streaming)            │
├─────────────────────────────────────────────────────────────┤
│                    Native Modules                            │
├───────────────────────┬─────────────────────────────────────┤
│   Android (Kotlin)    │         iOS (Objective-C)          │
├───────────────────────┼─────────────────────────────────────┤
│ CallSoundModule.kt    │  PTTAudioModule.m                   │
│ PTTAudioModule.kt     │  AppDelegate.mm (CallKit)           │
│ CallNotification      │                                     │
│ Service.kt            │                                     │
├───────────────────────┴─────────────────────────────────────┤
│                    System Audio APIs                         │
├─────────────────────────────────────────────────────────────┤
│  Android: AudioManager, AudioTrack, MediaPlayer             │
│  iOS: AVAudioSession, AudioQueue, CallKit                   │
└─────────────────────────────────────────────────────────────┘
```

### Key Libraries

- **react-native-incall-manager** - Audio routing control (speaker/earpiece switching)
- **livekit-client** - WebRTC for real-time voice/video calls
- **react-native-live-audio-stream** - Audio capture for PTT
- **react-native-callkeep** - iOS CallKit integration
- **react-native-audio-recorder-player** - iOS sound playback

---

## Audio Routing for Voice/Video Calls

### Call Initialization Flow

**Location:** `mobile/src/screens/call/CallScreen.tsx`

#### 1. Audio Session Setup

```typescript
// Line 295: Start InCallManager with appropriate media type
InCallManager.start({ media: type === 'Video' ? 'video' : 'audio' });

// Line 296-302: Set initial speaker mode
const shouldUseSpeaker = type === 'Video' || !isIncoming;
InCallManager.setSpeakerphoneOn(shouldUseSpeaker);
setIsSpeakerOn(shouldUseSpeaker);
```

**Initial Routing Strategy:**
- **Video calls:** Always speaker (so user can see screen while talking)
- **Outgoing voice calls:** Speaker initially (user hears dial tone clearly), switches to earpiece when connected
- **Incoming voice calls:** Earpiece (traditional phone experience)

#### 2. Wired Headset Detection

```typescript
// Line 305-318: Check for wired headset on mount
const checkAudioDevices = async () => {
  const headsetInfo = await InCallManager.getIsWiredHeadsetPluggedIn();
  if (headsetInfo.isWiredHeadsetPluggedIn) {
    setAudioRoute('headphones');
    setIsSpeakerOn(false);
    console.log('[CallScreen] Wired headset detected');
  }
};
```

#### 3. LiveKit Room Connection

```typescript
// Line 774: Connect to LiveKit server
await newRoom.connect(liveKitUrl, roomToken);

// Line 824-826: Enable microphone and camera
await newRoom.localParticipant.setMicrophoneEnabled(true);
if (type === 'Video') {
  await newRoom.localParticipant.setCameraEnabled(true);
}
```

**WebRTC Audio Handling:**
- LiveKit automatically manages WebRTC audio tracks
- Native WebRTC layer handles audio encoding/decoding
- Audio routing controlled via InCallManager

#### 4. Dynamic Routing on Call Connect

```typescript
// Line 558-564: Switch to earpiece when outgoing voice call connects
if (!isIncoming && type === 'Voice') {
  console.log('[CallScreen] Switching to earpiece for connected voice call');
  InCallManager.setSpeakerphoneOn(false);
  setIsSpeakerOn(false);
  setAudioRoute('earpiece');
}
```

### User-Controlled Audio Routing

#### Toggle Speaker Function

```typescript
// Line 1004-1009: Manual speaker toggle
const toggleSpeaker = () => {
  const newSpeakerState = !isSpeakerOn;
  InCallManager.setSpeakerphoneOn(newSpeakerState);
  setIsSpeakerOn(newSpeakerState);
  setAudioRoute(newSpeakerState ? 'speaker' : 'earpiece');
};
```

#### Cycle Audio Routes (Advanced)

```typescript
// Line 1104-1140: Cycle through available audio routes
const cycleAudioRoute = async () => {
  const availableRoutes = ['earpiece', 'speaker'];
  
  // Add bluetooth if available
  if (isBluetoothAvailable) {
    availableRoutes.splice(1, 0, 'bluetooth');
  }
  
  const currentIndex = availableRoutes.indexOf(audioRoute);
  const nextIndex = (currentIndex + 1) % availableRoutes.length;
  const nextRoute = availableRoutes[nextIndex];
  
  switch (nextRoute) {
    case 'speaker':
      InCallManager.setSpeakerphoneOn(true);
      break;
    case 'bluetooth':
    case 'earpiece':
      InCallManager.setSpeakerphoneOn(false);
      break;
  }
  
  setAudioRoute(nextRoute);
};
```

**Routing Priority:**
1. Wired headset (if plugged in)
2. Bluetooth (if available and selected)
3. Speaker (if enabled)
4. Earpiece (default for voice calls)

### Call Cleanup

```typescript
// Line 338: Stop InCallManager on unmount
InCallManager.stop();
```

---

## Push-to-Talk (PTT) Audio System

PTT audio uses a custom real-time streaming system separate from LiveKit/WebRTC.

### Architecture

```
┌──────────────────────────────────────────────────────────┐
│  PTT Capture (Send)                                       │
│  ┌────────────────────────────────────────────────────┐  │
│  │ react-native-live-audio-stream                     │  │
│  │ - Captures audio: 16kHz, mono, 16-bit PCM         │  │
│  │ - Buffer size: 4096 bytes                         │  │
│  │ - Audio source: VOICE_COMMUNICATION (Android)     │  │
│  └────────────────────────────────────────────────────┘  │
│                          ↓                                │
│  ┌────────────────────────────────────────────────────┐  │
│  │ PTTStreamService.ts                                │  │
│  │ - Base64 encodes chunks                           │  │
│  │ - Sends via SignalR to server                     │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│  PTT Playback (Receive)                                   │
│  ┌────────────────────────────────────────────────────┐  │
│  │ SignalR receives chunks from server                │  │
│  │ - Queued in playbackQueue                         │  │
│  └────────────────────────────────────────────────────┘  │
│                          ↓                                │
│  ┌────────────────────────────────────────────────────┐  │
│  │ NativePTTAudio bridge                              │  │
│  │ - Decodes Base64                                   │  │
│  │ - Adds to concurrent queue                        │  │
│  └────────────────────────────────────────────────────┘  │
│                          ↓                                │
│  ┌────────────────────────────────────────────────────┐  │
│  │ Platform-specific playback                         │  │
│  │ Android: AudioTrack with playback thread          │  │
│  │ iOS: AudioQueue with buffer callbacks             │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

### Android PTT Audio (PTTAudioModule.kt)

**Location:** `mobile/android/app/src/main/java/com/im/PTTAudioModule.kt`

#### Audio Configuration
```kotlin
companion object {
    private const val SAMPLE_RATE = 16000
    private const val CHANNEL_CONFIG = AudioFormat.CHANNEL_OUT_MONO
    private const val AUDIO_FORMAT = AudioFormat.ENCODING_PCM_16BIT
}
```

#### AudioTrack Setup (Line 55-71)
```kotlin
audioTrack = AudioTrack.Builder()
    .setAudioAttributes(
        AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()
    )
    .setAudioFormat(
        AudioFormat.Builder()
            .setEncoding(AUDIO_FORMAT)
            .setSampleRate(SAMPLE_RATE)
            .setChannelMask(CHANNEL_CONFIG)
            .build()
    )
    .setBufferSizeInBytes(bufferSize * 2)
    .setTransferMode(AudioTrack.MODE_STREAM)
    .build()
```

**Key Points:**
- `USAGE_VOICE_COMMUNICATION` - Routes audio through voice call path for optimal quality
- `MODE_STREAM` - Allows real-time streaming of audio chunks
- Buffer size doubled for smooth playback

#### Playback Thread (Line 102-114)
```kotlin
playbackThread = thread(start = true, name = "PTTPlaybackThread") {
    while (isPlaying.get()) {
        val chunk = audioQueue.poll()
        if (chunk != null) {
            audioTrack?.write(chunk, 0, chunk.size)
        } else {
            Thread.sleep(10)  // Prevent busy waiting
        }
    }
}
```

**Threading Model:**
- Dedicated playback thread processes audio queue
- Uses `ConcurrentLinkedQueue` for thread-safe chunk management
- `AtomicBoolean` for lock-free state tracking

### iOS PTT Audio (PTTAudioModule.m)

**Location:** `mobile/ios/IM/PTTAudioModule.m`

#### Audio Session Configuration (Line 82-101)
```objective-c
AVAudioSession *session = [AVAudioSession sharedInstance];
[session setCategory:AVAudioSessionCategoryPlayAndRecord
                mode:AVAudioSessionModeVoiceChat
             options:AVAudioSessionCategoryOptionDefaultToSpeaker |
                     AVAudioSessionCategoryOptionAllowBluetooth
               error:&error];
```

**Audio Session Settings:**
- `PlayAndRecord` - Allows simultaneous audio I/O
- `VoiceChat` mode - Optimized for voice communication
- `DefaultToSpeaker` - Routes to speaker by default
- `AllowBluetooth` - Enables Bluetooth audio devices

#### AudioQueue Setup (Line 104-143)
```objective-c
AudioStreamBasicDescription format;
format.mSampleRate = 16000.0;
format.mFormatID = kAudioFormatLinearPCM;
format.mFormatFlags = kLinearPCMFormatFlagIsSignedInteger | 
                      kLinearPCMFormatFlagIsPacked;
format.mBitsPerChannel = 16;
format.mChannelsPerFrame = 1;
format.mBytesPerFrame = 2;
format.mFramesPerPacket = 1;
format.mBytesPerPacket = 2;

AudioQueueNewOutput(&format, HandleOutputBuffer, 
                    (__bridge void *)self, NULL, NULL, 0, &_audioQueue);
```

#### Buffer Callback (Line 23-47)
```objective-c
static void HandleOutputBuffer(void *inUserData,
                               AudioQueueRef inAQ,
                               AudioQueueBufferRef inBuffer) {
    PTTAudioModule *module = (__bridge PTTAudioModule *)inUserData;
    
    @synchronized (module.audioDataQueue) {
        if (module.audioDataQueue.count > 0) {
            NSData *audioData = module.audioDataQueue.firstObject;
            [module.audioDataQueue removeObjectAtIndex:0];
            
            UInt32 bytesToCopy = MIN(audioData.length, 
                                     inBuffer->mAudioDataBytesCapacity);
            memcpy(inBuffer->mAudioData, audioData.bytes, bytesToCopy);
            inBuffer->mAudioDataByteSize = bytesToCopy;
            
            AudioQueueEnqueueBuffer(inAQ, inBuffer, 0, NULL);
        } else {
            // Fill with silence when no data
            memset(inBuffer->mAudioData, 0, kBufferSize);
            inBuffer->mAudioDataByteSize = kBufferSize;
            AudioQueueEnqueueBuffer(inAQ, inBuffer, 0, NULL);
        }
    }
}
```

**Callback-Based Model:**
- iOS uses callback-driven architecture
- 3 buffers allocated for smooth playback
- Automatic buffer re-enqueueing
- Synchronized queue access prevents race conditions

---

## Call Sound Management

### CallSoundService Architecture

**Location:** `mobile/src/services/CallSoundService.ts`

The `CallSoundService` manages four types of call sounds:

1. **Outgoing Tone** (Dial Tone) - Played when calling someone
2. **Incoming Ringtone** - Played when receiving a call
3. **Busy Tone** - Played when call cannot connect
4. **Ended Tone** - Short beep when call ends

### Android Sound Implementation

**Location:** `mobile/android/app/src/main/java/com/im/CallSoundModule.kt`

#### Sound Type Routing Strategy

```kotlin
// Line 53-63: Different audio attributes based on sound type
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
```

**Routing Logic:**
- **Outgoing ringtone:** `USAGE_NOTIFICATION_RINGTONE` 
  - Ensures it plays through speaker even during call setup
  - Volume set to maximum on STREAM_RING
- **Other tones:** `USAGE_VOICE_COMMUNICATION_SIGNALLING`
  - Routes through call audio path
  - Respects call audio routing (earpiece/speaker)

#### Volume Management (Line 66-71)
```kotlin
if (soundName == "ringtone_outgoing") {
    val audioManager = reactApplicationContext
        .getSystemService(Context.AUDIO_SERVICE) as AudioManager
    val maxVolume = audioManager.getStreamMaxVolume(AudioManager.STREAM_RING)
    audioManager.setStreamVolume(AudioManager.STREAM_RING, maxVolume, 0)
}
```

#### System Ringtone Integration (Line 124-156)
```kotlin
@ReactMethod
fun playDefaultRingtone(promise: Promise) {
    val ringtoneUri = RingtoneManager
        .getDefaultUri(RingtoneManager.TYPE_RINGTONE)
    systemRingtone = RingtoneManager.getRingtone(reactApplicationContext, ringtoneUri)
    
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        systemRingtone?.isLooping = true
    }
    
    val audioManager = reactApplicationContext
        .getSystemService(Context.AUDIO_SERVICE) as AudioManager
    val maxVolume = audioManager.getStreamMaxVolume(AudioManager.STREAM_RING)
    audioManager.setStreamVolume(AudioManager.STREAM_RING, maxVolume, 0)
    
    systemRingtone?.play()
}
```

**Features:**
- Uses user's configured system ringtone
- Automatic looping on Android 9+ (API 28+)
- Volume maximized for incoming calls

### iOS Sound Implementation

**Location:** `mobile/src/services/CallSoundService.ts`

iOS uses `react-native-audio-recorder-player` for sound playback:

```typescript
// Line 50-104: iOS sound playback
private async playIOSSound(soundName: string, loop: boolean): Promise<void> {
  const player = await getIOSAudioPlayer();
  const soundPath = `${soundFileName}.mp3`;
  
  await player.startPlayer(soundPath);
  
  if (loop) {
    player.addPlayBackListener((e: any) => {
      if (e.currentPosition >= e.duration - 100) {
        player.seekToPlayer(0);  // Restart for looping
      }
    });
  }
}
```

**Note:** iOS incoming calls are typically handled by CallKit, which manages its own ringtone.

### Sound Files

Sound files are stored in:
- **Android:** `mobile/android/app/src/main/res/raw/`
- **iOS:** `mobile/ios/IM/` (bundled resources)

Required files:
- `ringtone_outgoing.mp3` - Dial tone
- `ringtone_incoming.mp3` - Incoming call
- `tone_busy.mp3` - Busy signal
- `tone_ended.mp3` - Call end beep

---

## Platform-Specific Implementation

### Android Audio Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Android Audio Stack                    │
├─────────────────────────────────────────────────────────┤
│  AudioManager                                            │
│  - Controls stream volumes (STREAM_RING, STREAM_VOICE)  │
│  - Audio routing (speaker/earpiece/bluetooth)           │
│  - Audio focus management                               │
├─────────────────────────────────────────────────────────┤
│  MediaPlayer (CallSoundModule)                           │
│  - Plays sound resources from res/raw                   │
│  - Supports looping                                     │
│  - Audio attributes control routing                     │
├─────────────────────────────────────────────────────────┤
│  AudioTrack (PTTAudioModule)                             │
│  - Low-latency PCM audio streaming                      │
│  - VOICE_COMMUNICATION usage                            │
│  - MODE_STREAM for real-time playback                   │
├─────────────────────────────────────────────────────────┤
│  WebRTC (LiveKit)                                        │
│  - Native WebRTC audio engine                           │
│  - Acoustic Echo Cancellation (AEC)                     │
│  - Noise Suppression (NS)                               │
│  - Automatic Gain Control (AGC)                         │
└─────────────────────────────────────────────────────────┘
```

#### Audio Usage Types

| Usage Type | Purpose | Routing Behavior |
|------------|---------|------------------|
| `USAGE_VOICE_COMMUNICATION` | PTT playback, WebRTC | Routes to current call audio device |
| `USAGE_NOTIFICATION_RINGTONE` | Outgoing dial tone | Always speaker during setup |
| `USAGE_VOICE_COMMUNICATION_SIGNALLING` | Busy/ended tones | Follows call routing |

### iOS Audio Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     iOS Audio Stack                      │
├─────────────────────────────────────────────────────────┤
│  AVAudioSession                                          │
│  - Category: PlayAndRecord                              │
│  - Mode: VoiceChat                                      │
│  - Options: DefaultToSpeaker, AllowBluetooth            │
├─────────────────────────────────────────────────────────┤
│  CallKit (RNCallKeep)                                    │
│  - Native iOS call UI                                   │
│  - System ringtone handling                             │
│  - Audio session lifecycle management                   │
│  - Integration with phone app                           │
├─────────────────────────────────────────────────────────┤
│  AudioQueue (PTTAudioModule)                             │
│  - Low-level PCM audio playback                         │
│  - Buffer-based callback system                         │
│  - 3-buffer architecture for smooth playback            │
├─────────────────────────────────────────────────────────┤
│  WebRTC (LiveKit)                                        │
│  - Native WebRTC audio engine                           │
│  - iOS-optimized audio processing                       │
│  - Automatic audio session management                   │
└─────────────────────────────────────────────────────────┘
```

#### AVAudioSession Categories

| Category | Mode | Options | Use Case |
|----------|------|---------|----------|
| `PlayAndRecord` | `VoiceChat` | `DefaultToSpeaker, AllowBluetooth` | PTT audio |
| `Playback` | `Default` | None | Sound playback |
| Managed by CallKit | `VoiceChat` | Automatic | Voice/Video calls |

### CallKit Integration (iOS Only)

**Location:** `mobile/src/services/CallManager.ts`

CallManager handles iOS CallKit integration:

```typescript
// Line 42-69: CallKit configuration
const options = {
  ios: {
    appName: 'IM',
    supportsVideo: true,
    maximumCallGroups: '1',
    maximumCallsPerCallGroup: '1',
    includesCallsInRecents: true,
    ringtoneSound: 'ringtone.caf',
  }
};

await RNCallKeep.setup(options);
```

#### Audio Route Change Events (Line 136-138)
```typescript
RNCallKeep.addEventListener('didChangeAudioRoute', ({ output, reason }) => {
  console.log('CallKeep: Audio route changed', output, reason);
});
```

**CallKit Audio Benefits:**
- Native iOS call UI
- System-level audio routing
- Bluetooth device integration
- Integration with car audio systems
- Automatic proximity sensor handling

**Note:** Android uses native `CallNotificationService` instead of CallKeep due to permission issues on Android 10+.

---

## Audio Device Detection and Routing

### Wired Headset Detection

```typescript
// CallScreen.tsx Line 305-318
const checkAudioDevices = async () => {
  const headsetInfo = await InCallManager.getIsWiredHeadsetPluggedIn();
  if (headsetInfo.isWiredHeadsetPluggedIn) {
    setAudioRoute('headphones');
    setIsSpeakerOn(false);
  }
};
```

### Bluetooth Detection

Bluetooth availability is tracked via state:
```typescript
const [isBluetoothAvailable, setIsBluetoothAvailable] = useState(false);
```

**Note:** Full Bluetooth event handling requires additional InCallManager event listeners (not currently implemented in the codebase).

### Audio Route Priority

1. **Wired headset** - Highest priority, automatically selected when plugged in
2. **Bluetooth** - Selected via user action (cycle audio routes)
3. **Speaker** - Selected via user action or default for video calls
4. **Earpiece** - Default for voice calls, traditional phone experience

### Manual Audio Route Selection

Users can manually control audio routing via:
- **Long press** speaker button - Toggle speaker on/off
- **Tap** speaker button - Cycle through available routes

```typescript
// Line 1583: Speaker button with long press
<TouchableOpacity onLongPress={toggleSpeaker}>
```

---

## Audio Flow Diagrams

### Voice/Video Call Audio Flow

```
┌─────────────────┐
│   Call Starts   │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  InCallManager.start()              │
│  - Initialize audio session         │
│  - Set initial routing (speaker/    │
│    earpiece based on call type)     │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  LiveKit Connection                 │
│  - Connect to room                  │
│  - Enable microphone                │
│  - Enable camera (video only)       │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  Remote Participant Joins           │
│  - Stop ringtone/dial tone          │
│  - Switch to earpiece (voice call)  │
│  - Subscribe to remote audio tracks │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  Active Call                         │
│  - WebRTC handles audio I/O         │
│  - User can toggle speaker          │
│  - Automatic device routing         │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  Call Ends                           │
│  - Play end tone                    │
│  - InCallManager.stop()             │
│  - Cleanup LiveKit room             │
└─────────────────────────────────────┘
```

### PTT Audio Flow

```
Sender Side:
┌────────────────┐
│ User Presses   │
│  PTT Button    │
└───────┬────────┘
        │
        ▼
┌──────────────────────────────┐
│ react-native-live-audio-     │
│ stream captures audio        │
│ - 16kHz, mono, 16-bit PCM    │
│ - 4096 byte chunks           │
└───────┬──────────────────────┘
        │
        ▼
┌──────────────────────────────┐
│ PTTStreamService             │
│ - Base64 encode chunks       │
│ - Send via SignalR           │
└───────┬──────────────────────┘
        │
        ▼
┌──────────────────────────────┐
│ Server broadcasts to         │
│ conversation participants    │
└──────────────────────────────┘

Receiver Side:
┌──────────────────────────────┐
│ SignalR receives chunk       │
└───────┬──────────────────────┘
        │
        ▼
┌──────────────────────────────┐
│ NativePTTAudio.playChunk()   │
│ - Base64 decode              │
│ - Add to playback queue      │
└───────┬──────────────────────┘
        │
        ▼
┌──────────────────────────────┐
│ Platform-Specific Playback   │
│ Android: AudioTrack thread   │
│ iOS: AudioQueue callback     │
└───────┬──────────────────────┘
        │
        ▼
┌──────────────────────────────┐
│ Audio Output                 │
│ - Speaker/Earpiece/Headset   │
└──────────────────────────────┘
```

### Call Sound Flow

```
Outgoing Call:
┌────────────────┐
│ Initiate Call  │
└───────┬────────┘
        │
        ▼
┌───────────────────────────────┐
│ callSoundService.             │
│ playOutgoingTone()            │
│ - Loop until answered/failed  │
└───────┬───────────────────────┘
        │
        ├──► Participant Joins
        │    └──► Stop tone
        │
        └──► No Answer (30s)
             └──► Stop tone, play busy tone

Incoming Call:
┌────────────────┐
│ Receive Call   │
└───────┬────────┘
        │
        ▼
┌───────────────────────────────┐
│ Android: CallNotification     │
│ Service plays system ringtone │
│                               │
│ iOS: CallKit handles ringtone │
└───────┬───────────────────────┘
        │
        ├──► User Answers
        │    └──► Stop ringtone, connect
        │
        └──► User Declines
             └──► Stop ringtone, end call
```

---

## Configuration and Best Practices

### Audio Quality Settings

**PTT Audio:**
- Sample Rate: 16kHz (optimal for voice)
- Channels: Mono (reduces bandwidth)
- Bit Depth: 16-bit (good quality/size balance)
- Buffer Size: 4096 bytes (low latency)

**LiveKit/WebRTC:**
- Uses adaptive bitrate
- Automatic codec selection (Opus)
- Built-in echo cancellation
- Noise suppression enabled
- Automatic gain control

### Platform Considerations

**Android:**
- Different audio attributes for different sound types
- Manual volume management for ringtones
- Explicit audio focus handling
- Background service for call notifications

**iOS:**
- CallKit integration for native experience
- AVAudioSession category management critical
- Background audio requires proper configuration
- App Transport Security for HTTPS calls

### Debugging Audio Issues

**Common Issues and Solutions:**

1. **No audio on Android:**
   - Check `RECORD_AUDIO` and `MODIFY_AUDIO_SETTINGS` permissions
   - Verify audio source is `VOICE_COMMUNICATION`
   - Check if app has audio focus

2. **Routing stuck on speaker:**
   - Verify `InCallManager.setSpeakerphoneOn()` calls
   - Check for conflicting audio session settings
   - Ensure headset detection is working

3. **PTT audio choppy:**
   - Increase buffer size if network is slow
   - Check playback queue size
   - Verify thread priority on Android

4. **iOS ringtone not playing:**
   - Ensure sound files are in app bundle
   - Check AVAudioSession configuration
   - Verify CallKit setup for incoming calls

### Performance Optimization

**Memory Management:**
- PTT audio queues cleared on stop
- MediaPlayer/AudioTrack released properly
- LiveKit room cleaned up on disconnect

**Thread Management:**
- Android PTT uses dedicated playback thread
- iOS uses main thread for UI, background queue for audio
- Avoid blocking main thread with audio operations

**Battery Optimization:**
- Use `VOICE_COMMUNICATION` audio source (low power)
- Stop audio services when not in use
- Minimize wake locks and background processing

---

## Summary

The IM app implements a sophisticated audio routing system that handles three distinct audio types:

1. **Voice/Video Calls** use LiveKit/WebRTC with InCallManager for device routing
2. **PTT Audio** uses custom native modules for low-latency real-time streaming
3. **Call Sounds** use platform-specific MediaPlayer/AudioRecorderPlayer

Each system is optimized for its use case:
- **Calls** prioritize quality and automatic device handling
- **PTT** prioritizes low latency and real-time performance
- **Sounds** prioritize reliability and proper routing

The architecture is platform-aware, using iOS CallKit for native integration while handling Android's stricter background restrictions with custom services.

---

## Related Files Reference

### React Native Layer
- `mobile/src/screens/call/CallScreen.tsx` - Main call UI and audio routing logic
- `mobile/src/services/CallManager.ts` - CallKit integration (iOS)
- `mobile/src/services/CallSoundService.ts` - Call sound management
- `mobile/src/services/NativeCallSound.ts` - Android sound bridge
- `mobile/src/services/NativePTTAudio.ts` - PTT audio bridge
- `mobile/src/services/PTTStreamService.ts` - PTT capture and streaming

### Android Native
- `mobile/android/app/src/main/java/com/im/CallSoundModule.kt`
- `mobile/android/app/src/main/java/com/im/PTTAudioModule.kt`
- `mobile/android/app/src/main/java/com/im/CallNotificationService.kt`

### iOS Native
- `mobile/ios/IM/PTTAudioModule.m`
- `mobile/ios/IM/AppDelegate.mm` - CallKit setup

### Dependencies
- `react-native-incall-manager` - Audio routing control
- `livekit-client` - WebRTC for calls
- `react-native-live-audio-stream` - PTT capture
- `react-native-callkeep` - iOS CallKit
- `react-native-audio-recorder-player` - iOS sound playback

---

*Document Version: 1.0*  
*Last Updated: 2026-02-06*
