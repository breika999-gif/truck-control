import { useState, useRef, useCallback, useEffect } from 'react';
import { Keyboard, ScrollView, Platform, PermissionsAndroid, Dimensions } from 'react-native';
import AudioRecorderPlayer from 'react-native-audio-recorder-player';
import type { ChatMessage, POICard } from '../../../shared/services/backendApi';

export interface AITachoResult {
  drivenHours: number;
  remainingHours: number;
  breakNeeded: boolean;
  suggestedStop?: { lat: number; lng: number; name: string };
}

export const useChatPanelsState = () => {
  const [gptHistory, setGptHistory]           = useState<ChatMessage[]>([]);
  const [geminiHistory, setGeminiHistory]     = useState<ChatMessage[]>([]);
  const [gptChatOpen, setGptChatOpen]         = useState(false);
  const [geminiChatOpen, setGeminiChatOpen]   = useState(false);
  const [chatInput, setChatInput]             = useState('');
  const chatInputRef                          = useRef('');

  const [selectedParking, setSelectedParking] = useState<POICard | null>(null);
  const [selectedFuel, setSelectedFuel]       = useState<POICard | null>(null);
  const [businessResults, setBusinessResults] = useState<POICard[]>([]);
  const [tachographResult, setTachographResult] = useState<AITachoResult | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const isRecordingRef = useRef(false);
  const [micLoading, setMicLoading]   = useState(false);
  const [kbHeight, setKbHeight]       = useState(0);

  const gptScrollRef    = useRef<ScrollView>(null);
  const geminiScrollRef = useRef<ScrollView>(null);

  const syncKeyboardHeight = useCallback((event?: { endCoordinates?: { height?: number } }) => {
    const eventHeight = event?.endCoordinates?.height;
    const metricsHeight = Keyboard.metrics()?.height;
    const nextHeight = Number.isFinite(eventHeight) && Number(eventHeight) > 0
      ? eventHeight
      : Number.isFinite(metricsHeight) && Number(metricsHeight) > 0
        ? metricsHeight
        : Math.round(Dimensions.get('window').height * 0.42);
    setKbHeight(Math.max(0, Math.round(nextHeight || 0)));
  }, []);

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    const willShow = Keyboard.addListener('keyboardWillShow', syncKeyboardHeight);
    const show = Keyboard.addListener('keyboardDidShow', syncKeyboardHeight);
    const willChange = Keyboard.addListener('keyboardWillChangeFrame', syncKeyboardHeight);
    const didChange = Keyboard.addListener('keyboardDidChangeFrame', syncKeyboardHeight);
    const willHide = Keyboard.addListener('keyboardWillHide', () => setKbHeight(0));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKbHeight(0));
    return () => {
      willShow.remove();
      show.remove();
      willChange.remove();
      didChange.remove();
      willHide.remove();
      hide.remove();
      if (isRecordingRef.current) {
        AudioRecorderPlayer.stopRecorder().catch(() => {});
        AudioRecorderPlayer.removeRecordBackListener();
      }
    };
  }, [syncKeyboardHeight]);

  useEffect(() => {
    chatInputRef.current = chatInput;
  }, [chatInput]);

  const handleChat = useCallback(async (
    sendGptText: (text: string) => Promise<void>,
    sendGeminiText: (text: string) => Promise<void>,
    isGptChatOpen: boolean
  ) => {
    const text = chatInputRef.current.trim();
    if (!text) return;
    chatInputRef.current = '';
    setChatInput('');
    Keyboard.dismiss();
    if (isGptChatOpen) {
      await sendGptText(text);
    } else {
      await sendGeminiText(text);
    }
  }, []);

  const handleMicStart = useCallback(async (audioRecorderPlayer: typeof AudioRecorderPlayer) => {
    try {
      if (Platform.OS === 'android') {
        const grants = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
          PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
        ]);
        if (grants['android.permission.RECORD_AUDIO'] !== PermissionsAndroid.RESULTS.GRANTED) return;
      }
      setIsRecording(true);
      await audioRecorderPlayer.startRecorder();
      audioRecorderPlayer.addRecordBackListener(() => {});
    } catch {
      setIsRecording(false);
      // console.warn('[Mic] startRecorder failed:', err);
    }
  }, []);

  const handleMicStop = useCallback(async (
    audioRecorderPlayer: typeof AudioRecorderPlayer,
    onChat: () => Promise<void>
  ) => {
    if (!isRecording) return;
    setIsRecording(false);
    setMicLoading(true);
    try {
      const uri = await audioRecorderPlayer.stopRecorder();
      audioRecorderPlayer.removeRecordBackListener();

      const { transcribeAudio } = await import('../../../shared/services/backendApi');
      const text = await transcribeAudio(uri);

      if (text) {
        chatInputRef.current = text;
        setChatInput(text);
        await onChat();
      }
    } catch {
      // console.warn('[Mic] stopRecorder failed:', err);
    } finally {
      setMicLoading(false);
    }
  }, [isRecording]);

  return {
    gptHistory, setGptHistory,
    geminiHistory, setGeminiHistory,
    gptChatOpen, setGptChatOpen,
    geminiChatOpen, setGeminiChatOpen,
    chatInput, setChatInput,
    selectedParking, setSelectedParking,
    selectedFuel, setSelectedFuel,
    businessResults, setBusinessResults,
    tachographResult, setTachographResult,
    isRecording, setIsRecording,
    micLoading, setMicLoading,
    kbHeight, setKbHeight,
    gptScrollRef, geminiScrollRef,
    handleChat,
    handleMicStart,
    handleMicStop,
  };
};
