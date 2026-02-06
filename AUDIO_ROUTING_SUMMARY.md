# Audio Routing Breakdown - Quick Summary

This repository now contains comprehensive documentation on audio routing management in the IM mobile app.

## 📄 Main Document

See **[AUDIO_ROUTING_BREAKDOWN.md](./AUDIO_ROUTING_BREAKDOWN.md)** for the complete detailed breakdown.

## 🎯 Key Highlights

### Three Audio Systems

1. **Voice/Video Calls (LiveKit/WebRTC)**
   - Uses `react-native-incall-manager` for audio routing
   - iOS: Integrated with CallKit for native experience
   - Android: Custom notification service
   - Automatic speaker/earpiece switching based on call type

2. **Push-to-Talk (PTT)**
   - Custom real-time audio streaming via SignalR
   - Android: `AudioTrack` with dedicated playback thread
   - iOS: `AudioQueue` with buffer callbacks
   - 16kHz, mono, 16-bit PCM audio

3. **Call Sounds (Ringtones/Tones)**
   - Android: Native `MediaPlayer` with custom audio attributes
   - iOS: `react-native-audio-recorder-player`
   - System ringtone support on Android

### Audio Routing Priority

```
1. Wired Headset (auto-detected)
2. Bluetooth (user-selected)
3. Speaker (video calls default, user-selectable)
4. Earpiece (voice calls default)
```

### Platform Differences

**Android:**
- Uses `AudioManager`, `AudioTrack`, and `MediaPlayer`
- Different audio attributes for different sound types
- Custom `CallNotificationService` for incoming calls

**iOS:**
- Uses `AVAudioSession`, `AudioQueue`, and CallKit
- Audio session modes: `PlayAndRecord` + `VoiceChat`
- CallKit provides native call UI and ringtone handling

## 📂 Key Files

### React Native
- `mobile/src/screens/call/CallScreen.tsx` - Main call UI
- `mobile/src/services/CallManager.ts` - CallKit integration
- `mobile/src/services/CallSoundService.ts` - Sound management
- `mobile/src/services/NativePTTAudio.ts` - PTT bridge

### Android Native
- `mobile/android/app/src/main/java/com/im/CallSoundModule.kt`
- `mobile/android/app/src/main/java/com/im/PTTAudioModule.kt`

### iOS Native
- `mobile/ios/IM/PTTAudioModule.m`

## 🔍 What's Covered

- ✅ Complete architecture diagrams
- ✅ Platform-specific implementations
- ✅ Audio flow diagrams for each system
- ✅ Code examples with explanations
- ✅ Configuration and best practices
- ✅ Debugging tips
- ✅ Performance optimizations

## 🚀 Quick Start

To understand audio routing in the app:

1. Read the [Overview](./AUDIO_ROUTING_BREAKDOWN.md#overview) section
2. Check the [Architecture](./AUDIO_ROUTING_BREAKDOWN.md#architecture) diagrams
3. Deep dive into specific systems based on your needs:
   - [Voice/Video Calls](./AUDIO_ROUTING_BREAKDOWN.md#audio-routing-for-voicevideo-calls)
   - [PTT Audio](./AUDIO_ROUTING_BREAKDOWN.md#push-to-talk-ptt-audio-system)
   - [Call Sounds](./AUDIO_ROUTING_BREAKDOWN.md#call-sound-management)

---

**Document Version:** 1.0  
**Last Updated:** 2026-02-06
