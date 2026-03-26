import { useEffect, useRef, useCallback, type MutableRefObject } from 'react';

let Sound: any = null;
try {
  const _s = require('react-native-sound');
  Sound = _s?.default ?? _s;
  if (typeof Sound?.setCategory !== 'function') Sound = null;
} catch { Sound = null; }

type SoundKey =
  | 'speed'
  | 'camera'
  | 'attention'
  | 'warn'
  | 'voiceOpen'
  | 'voiceSuccess'
  | 'voiceFailure';

interface SoundInstance {
  stop: (cb?: () => void) => void;
  play: (cb?: (success: boolean) => void) => void;
  setCurrentTime: (seconds: number) => void;
  release: () => void;
}

// Files live in android/app/src/main/res/raw/ — react-native-sound loads by filename
const SOUND_ASSETS: Record<SoundKey, string> = {
  speed:        'driving_faster_than_allowed',
  camera:       'safety_cam_3',
  attention:    'attention1',
  warn:         'warn1',
  voiceOpen:    'lb_voice_open',
  voiceSuccess: 'lb_voice_success',
  voiceFailure: 'lb_voice_failure',
};

export function useSoundAlerts(mutedRef: MutableRefObject<boolean>) {
  const soundsRef = useRef<Record<SoundKey, SoundInstance | null>>({
    speed: null,
    camera: null,
    attention: null,
    warn: null,
    voiceOpen: null,
    voiceSuccess: null,
    voiceFailure: null,
  });

  useEffect(() => {
    if (!Sound) return;
    Sound.setCategory('Playback');

    (Object.keys(SOUND_ASSETS) as SoundKey[]).forEach((key) => {
      try {
        if (!Sound) { soundsRef.current[key] = null; return; }
        soundsRef.current[key] = new Sound(
          SOUND_ASSETS[key],
          Sound.MAIN_BUNDLE,
          (error: unknown) => { if (error) soundsRef.current[key] = null; },
        ) as SoundInstance;
      } catch {
        soundsRef.current[key] = null;
      }
    });

    return () => {
      (Object.keys(soundsRef.current) as SoundKey[]).forEach((key) => {
        try {
          soundsRef.current[key]?.release();
        } catch {}
        soundsRef.current[key] = null;
      });
    };
  }, []);

  const playSound = useCallback((key: SoundKey) => {
    if (mutedRef.current) return;
    const sound = soundsRef.current[key];
    if (!sound) return;

    try {
      sound.stop(() => {
        try {
          sound.setCurrentTime(0);
          sound.play(() => {
            try {
              sound.setCurrentTime(0);
            } catch {}
          });
        } catch {}
      });
    } catch {}
  }, [mutedRef]);

  const playSpeedAlert = useCallback(() => { playSound('speed'); }, [playSound]);
  const playCameraAlert = useCallback(() => { playSound('camera'); }, [playSound]);
  const playAttention = useCallback(() => { playSound('attention'); }, [playSound]);
  const playWarn = useCallback(() => { playSound('warn'); }, [playSound]);
  const playVoiceOpen = useCallback(() => { playSound('voiceOpen'); }, [playSound]);
  const playVoiceSuccess = useCallback(() => { playSound('voiceSuccess'); }, [playSound]);
  const playVoiceFailure = useCallback(() => { playSound('voiceFailure'); }, [playSound]);

  return {
    playSpeedAlert,
    playCameraAlert,
    playAttention,
    playWarn,
    playVoiceOpen,
    playVoiceSuccess,
    playVoiceFailure,
  };
}
