/**
 * useWakeWord — Hands-free voice assistant for truck drivers.
 *
 * Continuously listens for "Колега, <команда>" and fires onCommand(text).
 * Active only when `active` prop is true (NAVIGATING phase) to save battery.
 * Pauses automatically while TTS is speaking to avoid the app hearing itself.
 *
 * Uses Android's built-in SpeechRecognizer via @react-native-voice/voice.
 * No external wake-word model or API key needed — Google's on-device/cloud BG ASR.
 */

import { useEffect, useRef, useCallback } from 'react';
import Voice, {
  type SpeechResultsEvent,
  type SpeechErrorEvent,
} from '@react-native-voice/voice';
import Tts from 'react-native-tts';

/** Matches "колега", "колего", "колеге", "Колега" etc. */
const WAKE_RE = /колег[аоеaoe]?/i;

const RESTART_DELAY_MS = 600;   // after result / end
const ERROR_DELAY_MS   = 2_000; // after error (avoid tight loops on permission issues)

export type UseWakeWordArgs = {
  /** Only listen while this is true. Pass `navigating` from MapScreen. */
  active: boolean;
  /** Called with the spoken command (everything after the wake word). */
  onCommand: (text: string) => void;
};

export function useWakeWord({ active, onCommand }: UseWakeWordArgs): void {
  const activeRef      = useRef(active);
  const ttsBusyRef     = useRef(false);
  const listeningRef   = useRef(false);
  const timerRef       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCommandRef   = useRef(onCommand);

  // Keep refs current
  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => { onCommandRef.current = onCommand; }, [onCommand]);

  // ── Core helpers ───────────────────────────────────────────────────────────

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startListening = useCallback(async () => {
    if (!activeRef.current || ttsBusyRef.current || listeningRef.current) return;
    try {
      await Voice.start('bg-BG');
      listeningRef.current = true;
    } catch {
      // e.g. permission denied or recognizer busy — retry later
      timerRef.current = setTimeout(startListening, ERROR_DELAY_MS);
    }
  }, []); // stable — reads everything via refs

  const scheduleRestart = useCallback((delayMs: number) => {
    clearTimer();
    listeningRef.current = false;
    if (activeRef.current && !ttsBusyRef.current) {
      timerRef.current = setTimeout(startListening, delayMs);
    }
  }, [clearTimer, startListening]);

  // ── Voice event handlers ───────────────────────────────────────────────────

  useEffect(() => {
    Voice.onSpeechResults = (e: SpeechResultsEvent) => {
      const raw = (e.value?.[0] ?? '').trim();

      if (WAKE_RE.test(raw)) {
        // Strip wake word — keep the actual command
        const cmd = raw.replace(WAKE_RE, '').replace(/^[,\s]+/, '').trim();
        onCommandRef.current(cmd || raw); // fallback: full text if no command after wake word
      }

      scheduleRestart(RESTART_DELAY_MS);
    };

    Voice.onSpeechError = (_e: SpeechErrorEvent) => {
      scheduleRestart(ERROR_DELAY_MS);
    };

    // Safety net — onSpeechResults should fire first, but if it doesn't:
    Voice.onSpeechEnd = () => {
      if (listeningRef.current) scheduleRestart(RESTART_DELAY_MS);
    };

    return () => {
      Voice.destroy().then(Voice.removeAllListeners).catch(() => {});
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // stable — all callbacks accessed via refs

  // ── TTS integration — pause while the app is speaking ─────────────────────

  useEffect(() => {
    const onStart = () => {
      ttsBusyRef.current = true;
      clearTimer();
      listeningRef.current = false;
      Voice.stop().catch(() => {});
    };

    const onFinish = () => {
      ttsBusyRef.current = false;
      if (activeRef.current) {
        timerRef.current = setTimeout(startListening, 500);
      }
    };

    // react-native-tts uses addEventListener / removeEventListener
    Tts.addEventListener('tts-start',  onStart  as () => void);
    Tts.addEventListener('tts-finish', onFinish as () => void);
    Tts.addEventListener('tts-cancel', onFinish as () => void);

    return () => {
      Tts.removeEventListener('tts-start',  onStart  as () => void);
      Tts.removeEventListener('tts-finish', onFinish as () => void);
      Tts.removeEventListener('tts-cancel', onFinish as () => void);
    };
  }, [clearTimer, startListening]);

  // ── Start / stop based on active flag ─────────────────────────────────────

  useEffect(() => {
    if (active) {
      startListening();
    } else {
      clearTimer();
      listeningRef.current = false;
      Voice.stop().catch(() => {});
    }
  }, [active, clearTimer, startListening]);
}
