import { create } from 'zustand';
import { Call, CallParticipant } from '../types';

interface CallState {
  activeCall: Call | null;
  incomingCall: Call | null;
  callHistory: Call[];
  roomToken: string | null;
  isMuted: boolean;
  isVideoEnabled: boolean;
  isSpeakerOn: boolean;
  showIncomingCallDrawer: boolean; // Show drawer instead of full screen when app is in foreground

  // Actions
  setActiveCall: (call: Call | null) => void;
  setIncomingCall: (call: Call | null) => void;
  setCallHistory: (calls: Call[]) => void;
  addToCallHistory: (call: Call) => void;
  setRoomToken: (token: string | null) => void;
  updateCallParticipant: (userId: string, updates: Partial<CallParticipant>) => void;
  updateCallStatus: (status: Call['status']) => void;
  toggleMute: () => void;
  toggleVideo: () => void;
  toggleSpeaker: () => void;
  resetCallState: () => void;
  clearActiveCall: () => void;
  clearIncomingCall: () => void;
  setShowIncomingCallDrawer: (show: boolean) => void;
}

export const useCallStore = create<CallState>((set, get) => ({
  activeCall: null,
  incomingCall: null,
  callHistory: [],
  roomToken: null,
  isMuted: false,
  isVideoEnabled: true,
  isSpeakerOn: false,
  showIncomingCallDrawer: false,

  setActiveCall: (call) => {
    set({ activeCall: call });
  },

  setIncomingCall: (call) => {
    console.log('=== CALL STORE: setIncomingCall ===');
    console.log('Setting incoming call:', call?.id, call?.type);
    set({ incomingCall: call });
    console.log('Incoming call state updated');
  },

  setCallHistory: (calls) => {
    set({ callHistory: calls });
  },

  addToCallHistory: (call) => {
    set((state) => ({
      callHistory: [call, ...state.callHistory],
    }));
  },

  setRoomToken: (token) => {
    set({ roomToken: token });
  },

  updateCallParticipant: (userId, updates) => {
    set((state) => {
      if (!state.activeCall) return state;
      return {
        activeCall: {
          ...state.activeCall,
          participants: state.activeCall.participants.map((p) =>
            p.userId === userId ? { ...p, ...updates } : p
          ),
        },
      };
    });
  },

  updateCallStatus: (status) => {
    set((state) => {
      if (!state.activeCall) return state;
      return {
        activeCall: {
          ...state.activeCall,
          status,
        },
      };
    });
  },

  toggleMute: () => {
    set((state) => ({ isMuted: !state.isMuted }));
  },

  toggleVideo: () => {
    set((state) => ({ isVideoEnabled: !state.isVideoEnabled }));
  },

  toggleSpeaker: () => {
    set((state) => ({ isSpeakerOn: !state.isSpeakerOn }));
  },

  resetCallState: () => {
    set({
      activeCall: null,
      incomingCall: null,
      roomToken: null,
      isMuted: false,
      isVideoEnabled: true,
      isSpeakerOn: false,
      showIncomingCallDrawer: false,
    });
  },

  clearActiveCall: () => {
    set({ activeCall: null, roomToken: null });
  },

  clearIncomingCall: () => {
    set({ incomingCall: null, showIncomingCallDrawer: false });
  },

  setShowIncomingCallDrawer: (show) => {
    set({ showIncomingCallDrawer: show });
  },
}));
