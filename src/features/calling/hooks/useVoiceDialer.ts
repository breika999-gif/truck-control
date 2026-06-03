import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DeviceEventEmitter,
  NativeModules,
  PermissionsAndroid,
} from 'react-native';
import Contacts, { type Contact } from 'react-native-contacts';
import RNImmediatePhoneCall from 'react-native-immediate-phone-call';
import Tts from 'react-native-tts';

import {
  type VoiceAction,
  buildContactChoicesPrompt,
  hasExplicitVoiceAction,
  normalizeForContactMatch,
  normalizeSpokenText,
  parseContactChoice,
  parseVoiceCommand,
  scoreContactNameMatch,
  sharesInitialContactStem,
} from '../utils/voiceParser';

const LAST_COMMAND_STORAGE_KEY = 'trucknav.calling.last-command';
const CONTACT_USAGE_STORAGE_KEY = 'trucknav.calling.contact-usage';
const AUTO_RETRY_DELAY_MS = 900;
const MATCH_SELECTION_LISTEN_BASE_DELAY_MS = 1700;
const MATCH_SELECTION_LISTEN_PER_CHAR_MS = 28;
const MATCH_SELECTION_LISTEN_MAX_DELAY_MS = 6000;
const CALL_ONLY_MODE = true;
const LOCAL_NAME_WORD_LIMIT = 3;
const AUTO_RETRY_ERROR_CODES = new Set([6, 7, 11]);
const CANCEL_COMMANDS = new Set(['отказ', 'откажи', 'спри', 'стоп', 'край', 'затвори']);
const FAVORITE_GROUPS = [
  ['баща', 'татко', 'тати'],
  ['майка', 'мама', 'мамче', 'мамчето'],
  ['шефа', 'шеф'],
  ['майстора', 'майстор'],
];
const FAVORITE_GROUPS_NORMALIZED = FAVORITE_GROUPS.map(group =>
  group.map(term => normalizeForContactMatch(term)),
);

interface SpeechModuleShape {
  startListening?: (language: string) => void;
  stopListening?: () => void;
}

interface WhatsAppCallModuleShape {
  startVoiceCall?: (phoneNumber: string, contactRecordId: string | null) => Promise<boolean>;
}

const SpeechModule = NativeModules.SpeechModule as SpeechModuleShape | undefined;
const WhatsAppCallModule = NativeModules.WhatsAppCallModule as WhatsAppCallModuleShape | undefined;

export interface ContactMatch {
  displayName: string;
  phoneNumbers: Array<{ number: string }>;
  recordID: string;
}

export interface UseVoiceDialerResult {
  isListening: boolean;
  isCalling: boolean;
  statusText: string;
  matches: ContactMatch[];
  lastCommand: string | null;
  startListening: () => void;
  stopListening: () => void;
  selectMatch: (index: number) => void;
  cancel: () => void;
}

interface RankedContact {
  contact: ContactMatch;
  initialStemMatch: boolean;
  score: number;
  usageCount: number;
}

interface LastCommand {
  action: VoiceAction;
  contactName: string;
  phoneNumber: string;
  recordID?: string;
}

interface SpeechErrorEvent {
  code?: number;
  message?: string;
}

function normalizePhoneForCall(phone: string): string {
  return phone.replace(/[^\d+]/g, '');
}

function normalizePhoneForWhatsApp(phone: string): string {
  const digitsOnly = phone.replace(/\D/g, '');
  if (digitsOnly.startsWith('00')) return digitsOnly.slice(2);
  if (digitsOnly.length === 10 && digitsOnly.startsWith('0')) return `359${digitsOnly.slice(1)}`;
  return digitsOnly;
}

function toContactMatch(contact: Contact): ContactMatch {
  return {
    displayName: contact.displayName ?? '',
    phoneNumbers: contact.phoneNumbers.map(phone => ({ number: phone.number ?? '' })),
    recordID: contact.recordID ?? '',
  };
}

function getContactStorageKey(contact: ContactMatch | LastCommand): string {
  if (contact.recordID) return `record:${contact.recordID}`;
  const phone = 'phoneNumbers' in contact
    ? contact.phoneNumbers[0]?.number ?? ''
    : contact.phoneNumber;
  return `phone:${normalizePhoneForCall(phone)}`;
}

export function useVoiceDialer(): UseVoiceDialerResult {
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isListeningRef = useRef(false);
  const matchesRef = useRef<ContactMatch[]>([]);
  const pendingActionRef = useRef<VoiceAction>('call');
  const lastCommandRef = useRef<LastCommand | null>(null);
  const usageCountsRef = useRef<Record<string, number>>({});
  const ttsReadyRef = useRef(false);
  const mountedRef = useRef(true);
  const processVoiceCommandRef = useRef<(text: string) => Promise<void>>(async () => {});
  const startListeningRef = useRef<() => Promise<void>>(async () => {});
  const retryRef = useRef<(message: string) => void>(() => {});

  const [isListening, setIsListening] = useState(false);
  const [isCalling, setIsCalling] = useState(false);
  const [statusText, setStatusText] = useState('Кажи с кого да се свържа');
  const [matches, setMatches] = useState<ContactMatch[]>([]);
  const [lastCommand, setLastCommand] = useState<LastCommand | null>(null);

  const setListeningState = useCallback((value: boolean) => {
    isListeningRef.current = value;
    if (mountedRef.current) setIsListening(value);
  }, []);

  const clearRetry = useCallback(() => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  }, []);

  const clearSelectionListening = useCallback(() => {
    if (selectionTimeoutRef.current) {
      clearTimeout(selectionTimeoutRef.current);
      selectionTimeoutRef.current = null;
    }
  }, []);

  const clearMatches = useCallback(() => {
    matchesRef.current = [];
    pendingActionRef.current = 'call';
    if (mountedRef.current) setMatches([]);
  }, []);

  const speak = useCallback((message: string) => {
    if (ttsReadyRef.current) Tts.speak(message);
  }, []);

  const persistLastCommand = useCallback(async (command: LastCommand) => {
    lastCommandRef.current = command;
    if (mountedRef.current) setLastCommand(command);
    await AsyncStorage.setItem(LAST_COMMAND_STORAGE_KEY, JSON.stringify(command)).catch(() => undefined);
  }, []);

  const bumpContactUsage = useCallback(async (command: LastCommand) => {
    const key = getContactStorageKey(command);
    usageCountsRef.current = {
      ...usageCountsRef.current,
      [key]: (usageCountsRef.current[key] ?? 0) + 1,
    };
    await AsyncStorage
      .setItem(CONTACT_USAGE_STORAGE_KEY, JSON.stringify(usageCountsRef.current))
      .catch(() => undefined);
  }, []);

  const cancel = useCallback(() => {
    clearRetry();
    clearSelectionListening();
    clearMatches();
    SpeechModule?.stopListening?.();
    setListeningState(false);
    setIsCalling(false);
    setStatusText('Отказано');
    Tts.stop();
  }, [clearMatches, clearRetry, clearSelectionListening, setListeningState]);

  const executeAction = useCallback(async (contact: ContactMatch, action: VoiceAction) => {
    const displayName = contact.displayName || 'контакта';
    const normalizedPhone = normalizePhoneForCall(contact.phoneNumbers[0]?.number ?? '');
    if (!normalizedPhone) {
      setStatusText('Контактът няма валиден номер');
      speak('Контактът няма валиден номер');
      return;
    }

    const command: LastCommand = {
      action,
      contactName: displayName,
      phoneNumber: normalizedPhone,
      recordID: contact.recordID || undefined,
    };
    clearRetry();
    clearSelectionListening();
    clearMatches();
    setListeningState(false);
    setIsCalling(true);
    await persistLastCommand(command);
    await bumpContactUsage(command);

    if (action === 'whatsapp_call') {
      const whatsappPhone = normalizePhoneForWhatsApp(normalizedPhone);
      try {
        speak(`Звъня по WhatsApp на ${displayName}`);
        setStatusText(`Свързвам по WhatsApp с ${displayName}...`);
        await WhatsAppCallModule?.startVoiceCall?.(whatsappPhone, contact.recordID || null);
        return;
      } catch {
        setIsCalling(false);
        setStatusText('Не намерих WhatsApp обаждане за този контакт');
        speak('Не намерих WhatsApp обаждане за този контакт');
        return;
      }
    }

    try {
      const callPermission = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.CALL_PHONE,
      );
      if (callPermission !== PermissionsAndroid.RESULTS.GRANTED) {
        setIsCalling(false);
        setStatusText('Липсва достъп за обаждания');
        speak('Липсва достъп за обаждания');
        return;
      }
      speak(`Набирам ${displayName}`);
      setStatusText(`Свързвам с ${displayName}...`);
      RNImmediatePhoneCall.immediatePhoneCall(normalizedPhone);
    } catch {
      setIsCalling(false);
      setStatusText('Не успях да набера');
      speak('Не успях да набера');
    }
  }, [bumpContactUsage, clearMatches, clearRetry, clearSelectionListening, persistLastCommand, setListeningState, speak]);

  const scheduleSelectionListening = useCallback((prompt: string) => {
    clearSelectionListening();
    const delay = Math.min(
      MATCH_SELECTION_LISTEN_MAX_DELAY_MS,
      MATCH_SELECTION_LISTEN_BASE_DELAY_MS + prompt.length * MATCH_SELECTION_LISTEN_PER_CHAR_MS,
    );
    selectionTimeoutRef.current = setTimeout(() => {
      selectionTimeoutRef.current = null;
      if (matchesRef.current.length > 0 && !isListeningRef.current) {
        void startListeningRef.current();
      }
    }, delay);
  }, [clearSelectionListening]);

  const rankContacts = useCallback((contacts: ContactMatch[], query: string): RankedContact[] => {
    const normalizedQuery = normalizeForContactMatch(query);
    const ranked = contacts
      .map(contact => {
        if (!contact.phoneNumbers[0]?.number.trim()) return null;
        const baseScore = scoreContactNameMatch(contact.displayName, query);
        const initialStemMatch = sharesInitialContactStem(contact.displayName, query);
        if (baseScore <= 0 && !initialStemMatch) return null;

        let favoriteBoost = 0;
        for (const group of FAVORITE_GROUPS_NORMALIZED) {
          const queryMatches = group.some(term => normalizedQuery.includes(term));
          const contactName = normalizeForContactMatch(contact.displayName);
          const contactMatches = group.some(term => contactName.includes(term));
          if (queryMatches && contactMatches) favoriteBoost += 520;
          else if (contactMatches) favoriteBoost += 90;
        }

        const usageCount = usageCountsRef.current[getContactStorageKey(contact)] ?? 0;
        return {
          contact,
          initialStemMatch,
          score: baseScore + (initialStemMatch ? 180 : 0) + Math.min(usageCount, 8) * 60 + favoriteBoost,
          usageCount,
        };
      })
      .filter((item): item is RankedContact => item !== null)
      .sort((left, right) =>
        right.score - left.score ||
        right.usageCount - left.usageCount ||
        left.contact.displayName.localeCompare(right.contact.displayName, 'bg'),
      );

    if (ranked.length === 0) return ranked;
    const minimumScore = Math.max(220, ranked[0].score - 190);
    const primary = ranked.filter(item => item.score >= minimumScore);
    return [
      ...primary,
      ...ranked.filter(item => !primary.includes(item) && item.initialStemMatch),
    ];
  }, []);

  const findContact = useCallback(async (name: string, action: VoiceAction) => {
    setStatusText(`Търся ${name}...`);
    try {
      const contacts = (await Contacts.getAll()).map(toContactMatch);
      const found = rankContacts(contacts, name).map(item => item.contact);
      if (found.length === 1) {
        await executeAction(found[0], action);
        return;
      }
      if (found.length > 1) {
        matchesRef.current = found;
        pendingActionRef.current = action;
        setMatches(found);
        const prompt = buildContactChoicesPrompt(found);
        setStatusText('Избери контакт');
        speak(prompt);
        scheduleSelectionListening(prompt);
        return;
      }
      setStatusText('Не намерих контакт. Кажи пак.');
      speak('Не намерих контакт');
      retryRef.current('Не намерих контакт. Слушам пак...');
    } catch {
      setStatusText('Грешка при четене на контактите');
    }
  }, [executeAction, rankContacts, scheduleSelectionListening, speak]);

  const repeatLastCommand = useCallback(async () => {
    const command = lastCommandRef.current;
    if (!command) {
      setStatusText('Няма последно обаждане');
      speak('Няма последно обаждане');
      return;
    }
    await executeAction({
      displayName: command.contactName,
      phoneNumbers: [{ number: command.phoneNumber }],
      recordID: command.recordID ?? '',
    }, command.action);
  }, [executeAction, speak]);

  const processVoiceCommand = useCallback(async (text: string) => {
    const normalized = normalizeSpokenText(text);
    if (CANCEL_COMMANDS.has(normalized)) {
      cancel();
      return;
    }

    if (matchesRef.current.length > 0) {
      const selected = parseContactChoice(text, matchesRef.current);
      if (selected !== null) {
        await executeAction(matchesRef.current[selected], pendingActionRef.current);
        return;
      }
    }

    const parsed = parseVoiceCommand(text);
    if (parsed?.type === 'repeat') {
      await repeatLastCommand();
      return;
    }
    if (parsed?.type === 'name') {
      const action = parsed.action === 'whatsapp_call' ? 'whatsapp_call' : 'call';
      if (CALL_ONLY_MODE && hasExplicitVoiceAction(text) && parsed.action !== action) {
        setStatusText('Режимът е само за обаждания');
        speak('Режимът е само за обаждания');
        return;
      }
      await findContact(parsed.name, action);
      return;
    }
    if (normalized && normalized.split(' ').length <= LOCAL_NAME_WORD_LIMIT) {
      await findContact(normalized, 'call');
      return;
    }
    setStatusText('Кажи име за обаждане');
    retryRef.current('Кажи име за обаждане. Слушам пак...');
  }, [cancel, executeAction, findContact, repeatLastCommand, speak]);

  const startListeningSession = useCallback(async () => {
    if (isListeningRef.current || isCalling) return;
    if (!SpeechModule?.startListening) {
      setStatusText('Speech модулът не е зареден');
      return;
    }
    clearRetry();
    clearSelectionListening();
    const granted = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      PermissionsAndroid.PERMISSIONS.READ_CONTACTS,
    ]);
    if (granted[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] !== PermissionsAndroid.RESULTS.GRANTED) {
      setStatusText('Липсва достъп до микрофона');
      return;
    }
    if (granted[PermissionsAndroid.PERMISSIONS.READ_CONTACTS] !== PermissionsAndroid.RESULTS.GRANTED) {
      setStatusText('Липсва достъп до контактите');
      return;
    }
    setListeningState(true);
    setStatusText(matchesRef.current.length > 0 ? 'Кажи номер или име' : 'Слушам...');
    SpeechModule.startListening('bg-BG');
  }, [clearRetry, clearSelectionListening, isCalling, setListeningState]);

  const stopListening = useCallback(() => {
    clearRetry();
    clearSelectionListening();
    SpeechModule?.stopListening?.();
    setListeningState(false);
    setStatusText('Спряно');
  }, [clearRetry, clearSelectionListening, setListeningState]);

  const selectMatch = useCallback((index: number) => {
    const contact = matchesRef.current[index];
    if (contact) void executeAction(contact, pendingActionRef.current);
  }, [executeAction]);

  useEffect(() => {
    processVoiceCommandRef.current = processVoiceCommand;
    startListeningRef.current = startListeningSession;
    retryRef.current = (message: string) => {
      clearRetry();
      setStatusText(message);
      retryTimeoutRef.current = setTimeout(() => {
        void startListeningRef.current();
      }, AUTO_RETRY_DELAY_MS);
    };
  }, [clearRetry, processVoiceCommand, startListeningSession]);

  useEffect(() => {
    mountedRef.current = true;
    void Tts.getInitStatus()
      .then(() => {
        Tts.setDefaultLanguage('bg-BG');
        Tts.setDefaultRate(0.45);
        Tts.setDefaultPitch(1);
        ttsReadyRef.current = true;
      })
      .catch(() => undefined);
    void AsyncStorage.getItem(LAST_COMMAND_STORAGE_KEY).then(raw => {
      if (!raw) return;
      const command = JSON.parse(raw) as LastCommand;
      lastCommandRef.current = command;
      if (mountedRef.current) setLastCommand(command);
    }).catch(() => undefined);
    void AsyncStorage.getItem(CONTACT_USAGE_STORAGE_KEY).then(raw => {
      if (raw) usageCountsRef.current = JSON.parse(raw) as Record<string, number>;
    }).catch(() => undefined);

    const speechStart = DeviceEventEmitter.addListener('onSpeechStart', () => {
      setListeningState(true);
      setStatusText('Слушам...');
    });
    const speechEnd = DeviceEventEmitter.addListener('onSpeechEnd', () => {
      setStatusText('Разпознавам...');
    });
    const speechResults = DeviceEventEmitter.addListener('onSpeechResults', event => {
      setListeningState(false);
      const text = event?.value?.[0];
      if (typeof text === 'string' && text.trim()) void processVoiceCommandRef.current(text);
      else retryRef.current('Не чух. Слушам пак...');
    });
    const speechError = DeviceEventEmitter.addListener('onSpeechError', (event: SpeechErrorEvent) => {
      setListeningState(false);
      const message = event?.message ?? 'Гласова грешка';
      if (typeof event?.code === 'number' && AUTO_RETRY_ERROR_CODES.has(event.code)) {
        retryRef.current(`${message} Слушам пак...`);
      } else {
        setStatusText(message);
      }
    });
    const assistantLaunch = DeviceEventEmitter.addListener('assistantLaunch', () => {
      void startListeningRef.current();
    });
    const handleTtsFinish = () => {
      if (matchesRef.current.length > 0 && !isListeningRef.current) {
        clearSelectionListening();
        void startListeningRef.current();
      }
    };
    const ttsFinishSubscription = Tts.addEventListener(
      'tts-finish',
      handleTtsFinish,
    ) as unknown as { remove: () => void } | undefined;

    return () => {
      mountedRef.current = false;
      speechStart.remove();
      speechEnd.remove();
      speechResults.remove();
      speechError.remove();
      assistantLaunch.remove();
      ttsFinishSubscription?.remove();
      clearRetry();
      clearSelectionListening();
      SpeechModule?.stopListening?.();
    };
  }, [clearRetry, clearSelectionListening, setListeningState]);

  return {
    isListening,
    isCalling,
    statusText,
    matches,
    lastCommand: lastCommand?.contactName ?? null,
    startListening: () => { void startListeningSession(); },
    stopListening,
    selectMatch,
    cancel,
  };
}
