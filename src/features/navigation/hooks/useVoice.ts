import { useState, useRef, useEffect, useCallback } from 'react';
import Tts from 'react-native-tts';
import { RouteStep, bgInstruction } from '../api/directions';
import { ttsSpeak } from '../utils/mapUtils';

export function useVoice(navigating: boolean, currentStep: number, route?: { steps: RouteStep[] } | null) {
  const [voiceMuted, setVoiceMuted] = useState(false);
  const voiceMutedRef = useRef(false);
  const lastSpokenStepRef = useRef(-1);

  // Sync ref
  useEffect(() => { voiceMutedRef.current = voiceMuted; }, [voiceMuted]);

  // ── TTS initialisation — Bulgarian voice with auto-detection ────────────
  useEffect(() => {
    const initTts = async () => {
      try {
        const voices = await Tts.voices();
        const bgVoice = voices?.find(
          (v: { language?: string; id: string }) =>
            v.language?.toLowerCase().startsWith('bg'),
        );
        if (bgVoice) {
          await Tts.setDefaultLanguage(bgVoice.language ?? 'bg-BG');
          await Tts.setDefaultVoice(bgVoice.id);
        } else {
          await Tts.setDefaultLanguage('bg-BG').catch(() =>
            Tts.setDefaultLanguage('bg').catch(() =>
              Tts.setDefaultLanguage('en-US').catch(() => {}),
            ),
          );
        }
      } catch (err) {
        console.error('[useVoice] TTS init error:', err);
      }
      Tts.setDefaultRate(0.48);
      Tts.setDefaultPitch(1.0);
    };
    initTts();
  }, []);

  const speak = useCallback((text: string) => {
    if (!voiceMutedRef.current) {
      Tts.stop();
      try {
        // Direct Tts.speak (not ttsSpeak) is intentional here: we call Tts.stop()
        // first to cut off any in-progress speech, then speak the new text
        // immediately. ttsSpeak adds extra queue logic that would race with stop().
        Tts.speak(text);
      } catch (err) {
        console.error('[useVoice] Tts.speak error:', err);
      }
    }
  }, []);

  // ── Speak turn instruction when step advances ─────────────────────────────
  useEffect(() => {
    if (!navigating || voiceMuted) return;
    if (currentStep === lastSpokenStepRef.current) return;

    lastSpokenStepRef.current = currentStep;
    const step = route?.steps?.[currentStep];
    if (!step) return;

    // Priority: 1) Mapbox maneuver.instruction
    //           2) bgInstruction() — generated Bulgarian fallback
    //           3) voiceInstructions announcement
    const text =
      step.maneuver.instruction ||
      bgInstruction(step) ||
      step.voiceInstructions?.[0]?.announcement;

    if (text) {
      Tts.stop();
      speak(text);
    }
  }, [currentStep, navigating, voiceMuted, route, speak]);

  return {
    voiceMuted,
    setVoiceMuted,
    voiceMutedRef,
    lastSpokenStepRef,
    speak, // Manually speak text
  };
}
