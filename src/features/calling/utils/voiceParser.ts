export type VoiceAction = 'call' | 'whatsapp_chat' | 'whatsapp_call' | 'sms';

export type ParsedVoiceCommand =
  | {
      action?: VoiceAction;
      type: 'repeat';
    }
  | {
      action: VoiceAction;
      name: string;
      type: 'name';
    };

const ORDINAL_TO_INDEX: Record<string, number> = {
  '1': 0,
  '1ви': 0,
  '1вия': 0,
  'едно': 0,
  'един': 0,
  'първи': 0,
  'първия': 0,
  'първият': 0,
  'първата': 0,
  '2': 1,
  '2ри': 1,
  '2рия': 1,
  'две': 1,
  'два': 1,
  'втори': 1,
  'втория': 1,
  'вторият': 1,
  'втората': 1,
  '3': 2,
  '3ти': 2,
  '3тия': 2,
  'три': 2,
  'трети': 2,
  'третия': 2,
  'третият': 2,
  'третата': 2,
  '4': 3,
  '4ти': 3,
  '4тия': 3,
  'четири': 3,
  'четвърти': 3,
  'четвъртия': 3,
  '5': 4,
  '5ти': 4,
  '5тия': 4,
  'пети': 4,
  'петия': 4,
};

const CALL_PATTERNS = [
  'обади се на',
  'обади се',
  'обади на',
  'звънни на',
  'звънни',
  'звънна на',
  'звънна',
  'набери',
  'позвъни на',
  'позвъни',
  'дай на',
];

const SMS_PATTERNS = [
  'прати sms на',
  'изпрати sms на',
  'прати смс на',
  'изпрати смс на',
  'пиши sms на',
  'пиши смс на',
  'sms на',
  'смс на',
];

const WHATSAPP_MESSAGE_PATTERNS = [
  'прати съобщение на',
  'изпрати съобщение на',
  'пиши в whatsapp на',
  'пиши във whatsapp на',
  'пиши по whatsapp на',
  'пиши в уатсап на',
  'пиши във уатсап на',
  'пиши по уатсап на',
  'пиши на',
  'пиши',
  'прати гласово на',
  'изпрати гласово на',
  'прати voice на',
  'изпрати voice на',
  'прати на',
  'прати',
  'изпрати на',
  'изпрати',
];

const WHATSAPP_CHANNEL_PATTERNS = [
  'в whatsapp',
  'по whatsapp',
  'на whatsapp',
  'във whatsapp',
  'whatsapp',
  'в уатсап',
  'по уатсап',
  'на уатсап',
  'уатсап',
  'ватсап',
];

const REPEAT_PATTERNS = [
  'пак',
  'отново',
  'повтори',
];

const FILLER_PATTERNS = [
  'на',
  'по',
  'във',
  'в',
  'до',
  'моля',
  'последния',
  'последната',
  'последното',
  'последен',
  'последна',
  'последно',
];

const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sht',
  ъ: 'a',
  ь: 'y',
  ю: 'yu',
  я: 'ya',
};

export function normalizeSpokenText(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function transliterateToLatin(text: string) {
  return Array.from(text)
    .map(char => CYRILLIC_TO_LATIN[char] || char)
    .join('');
}

export function normalizeForContactMatch(text: string) {
  return transliterateToLatin(normalizeSpokenText(text))
    .replace(/x/g, 'ks')
    .replace(/w/g, 'v')
    .replace(/q/g, 'k')
    .replace(/ph/g, 'f')
    .replace(/ts/g, 'c')
    .replace(/tz/g, 'c')
    .replace(/yu/g, 'iu')
    .replace(/ya/g, 'ia')
    .replace(/y/g, 'i');
}

function includesPhrase(text: string, phrase: string) {
  return ` ${text} `.includes(` ${phrase} `);
}

function levenshteinDistance(left: string, right: string) {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const matrix = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

  for (let row = 0; row < rows; row += 1) {
    matrix[row][0] = row;
  }

  for (let col = 0; col < cols; col += 1) {
    matrix[0][col] = col;
  }

  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1;
      matrix[row][col] = Math.min(
        matrix[row - 1][col] + 1,
        matrix[row][col - 1] + 1,
        matrix[row - 1][col - 1] + cost,
      );
    }
  }

  return matrix[rows - 1][cols - 1];
}

function tokenizeForContactMatch(text: string) {
  return normalizeForContactMatch(text)
    .split(' ')
    .filter(token => token.length > 0);
}

function getFirstNormalizedContactToken(text: string) {
  return tokenizeForContactMatch(text)[0] || '';
}

export function sharesInitialContactStem(candidate: string, query: string) {
  const stemLength = 3;
  const candidateToken = getFirstNormalizedContactToken(candidate);
  const queryToken = getFirstNormalizedContactToken(query);

  if (candidateToken.length < stemLength || queryToken.length < stemLength) {
    return false;
  }

  return candidateToken.slice(0, stemLength) === queryToken.slice(0, stemLength);
}

function includesWholeNormalizedPhrase(candidate: string, query: string) {
  if (!candidate || !query) {
    return false;
  }

  return includesPhrase(candidate, query);
}

function tokensCloseEnough(candidateToken: string, queryToken: string) {
  if (!candidateToken || !queryToken) {
    return false;
  }

  if (candidateToken.includes(queryToken) || queryToken.includes(candidateToken)) {
    return true;
  }

  if (candidateToken.length < 4 || queryToken.length < 4) {
    return false;
  }

  const distance = levenshteinDistance(candidateToken, queryToken);
  const maxLength = Math.max(candidateToken.length, queryToken.length);
  if (maxLength <= 5) {
    return distance <= 1;
  }

  if (maxLength <= 8) {
    return distance <= 2;
  }

  return distance <= 3;
}

function scoreTokenPair(candidateToken: string, queryToken: string) {
  if (!candidateToken || !queryToken) {
    return 0;
  }

  if (candidateToken === queryToken) {
    return 240;
  }

  if (candidateToken.startsWith(queryToken) || queryToken.startsWith(candidateToken)) {
    return 190;
  }

  if (candidateToken.includes(queryToken) || queryToken.includes(candidateToken)) {
    return 150;
  }

  if (!tokensCloseEnough(candidateToken, queryToken)) {
    return 0;
  }

  const distance = levenshteinDistance(candidateToken, queryToken);
  return Math.max(70, 130 - distance * 20);
}

export function scoreContactNameMatch(candidate: string, query: string) {
  const normalizedCandidate = normalizeForContactMatch(candidate);
  const normalizedQuery = normalizeForContactMatch(query);

  if (!normalizedCandidate || !normalizedQuery) {
    return 0;
  }

  if (normalizedCandidate === normalizedQuery) {
    return 1200;
  }

  if (includesWholeNormalizedPhrase(normalizedCandidate, normalizedQuery)) {
    return normalizedCandidate.startsWith(`${normalizedQuery} `) ? 1000 : 920;
  }

  const candidateTokens = tokenizeForContactMatch(candidate);
  const queryTokens = tokenizeForContactMatch(query);
  if (candidateTokens.length === 0 || queryTokens.length === 0) {
    return 0;
  }

  let totalScore = 0;
  for (const queryToken of queryTokens) {
    let bestTokenScore = 0;
    for (const candidateToken of candidateTokens) {
      bestTokenScore = Math.max(bestTokenScore, scoreTokenPair(candidateToken, queryToken));
    }

    if (bestTokenScore === 0) {
      return 0;
    }

    totalScore += bestTokenScore;
  }

  if (candidateTokens[0] === queryTokens[0]) {
    totalScore += 120;
  } else if (candidateTokens[0]?.startsWith(queryTokens[0])) {
    totalScore += 70;
  }

  return totalScore;
}

export function matchesContactName(candidate: string, query: string) {
  return scoreContactNameMatch(candidate, query) > 0;
}

function detectAction(normalizedText: string): VoiceAction | null {
  const hasSmsPattern = SMS_PATTERNS.some(pattern => includesPhrase(normalizedText, pattern));
  if (hasSmsPattern) {
    return 'sms';
  }

  const hasCallPattern = CALL_PATTERNS.some(pattern => includesPhrase(normalizedText, pattern));
  const hasWhatsAppChannel = WHATSAPP_CHANNEL_PATTERNS.some(pattern =>
    includesPhrase(normalizedText, pattern),
  );
  const hasWhatsAppMessagePattern = WHATSAPP_MESSAGE_PATTERNS.some(pattern =>
    includesPhrase(normalizedText, pattern),
  );

  if (hasWhatsAppChannel && hasCallPattern) {
    return 'whatsapp_call';
  }

  if (hasWhatsAppMessagePattern || hasWhatsAppChannel) {
    return 'whatsapp_chat';
  }

  if (hasCallPattern) {
    return 'call';
  }

  return null;
}

export function hasExplicitVoiceAction(text: string) {
  return detectAction(normalizeSpokenText(text)) !== null;
}

function stripKnownPhrases(normalizedText: string) {
  const allPatterns = [
    ...CALL_PATTERNS,
    ...SMS_PATTERNS,
    ...WHATSAPP_MESSAGE_PATTERNS,
    ...WHATSAPP_CHANNEL_PATTERNS,
    ...REPEAT_PATTERNS,
  ].sort((left, right) => right.length - left.length);
  let cleaned = ` ${normalizedText} `;

  for (const pattern of allPatterns) {
    while (cleaned.includes(` ${pattern} `)) {
      cleaned = cleaned.replace(` ${pattern} `, ' ');
    }
  }

  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  while (cleaned.length > 0) {
    const next = cleaned.split(' ')[0];
    if (!FILLER_PATTERNS.includes(next)) {
      break;
    }
    cleaned = cleaned.slice(next.length).trim();
  }

  return cleaned;
}

function parseRepeatCommand(normalizedText: string): ParsedVoiceCommand | null {
  const hasRepeatPattern = REPEAT_PATTERNS.some(pattern => includesPhrase(normalizedText, pattern));
  if (!hasRepeatPattern) {
    return null;
  }

  const hasSmsPattern = SMS_PATTERNS.some(pattern => includesPhrase(normalizedText, pattern));
  const hasCallPattern = CALL_PATTERNS.some(pattern => includesPhrase(normalizedText, pattern));
  const hasWhatsAppChannel = WHATSAPP_CHANNEL_PATTERNS.some(pattern =>
    includesPhrase(normalizedText, pattern),
  );
  const hasWriteVerb = includesPhrase(normalizedText, 'пиши');
  const hasVoiceVerb = includesPhrase(normalizedText, 'гласово');

  let action: VoiceAction | undefined;
  if (hasSmsPattern) {
    action = 'sms';
  } else if (hasWhatsAppChannel && hasCallPattern) {
    action = 'whatsapp_call';
  } else if (hasWhatsAppChannel || hasWriteVerb || hasVoiceVerb) {
    action = 'whatsapp_chat';
  } else if (hasCallPattern) {
    action = 'call';
  }

  return {
    action,
    type: 'repeat',
  };
}

export function parseVoiceCommand(text: string): ParsedVoiceCommand | null {
  const normalizedText = normalizeSpokenText(text);
  if (!normalizedText) {
    return null;
  }

  const repeatedCommand = parseRepeatCommand(normalizedText);
  if (repeatedCommand) {
    return repeatedCommand;
  }

  const action = detectAction(normalizedText);
  const cleanedName = stripKnownPhrases(normalizedText);
  if (cleanedName) {
    if (!action && cleanedName.split(' ').length > 3) {
      return null;
    }

    return {
      action: action || 'call',
      name: cleanedName,
      type: 'name',
    };
  }

  return null;
}

export function parseContactChoice(
  text: string,
  contacts: Array<{ displayName?: string }>,
): number | null {
  const normalizedText = normalizeSpokenText(text);
  if (!normalizedText || contacts.length === 0) {
    return null;
  }

  const normalizedChoice = normalizeForContactMatch(normalizedText);
  const exactNameIndex = contacts.findIndex(
    contact => normalizeForContactMatch(contact.displayName || '') === normalizedChoice,
  );
  if (exactNameIndex >= 0) {
    return exactNameIndex;
  }

  const partialNameMatches = contacts.filter(contact =>
    matchesContactName(contact.displayName || '', normalizedText),
  );
  if (partialNameMatches.length === 1) {
    return contacts.findIndex(contact => contact === partialNameMatches[0]);
  }

  const tokens = normalizedText.split(' ');
  for (const token of tokens) {
    const ordinalIndex = ORDINAL_TO_INDEX[token];
    if (ordinalIndex !== undefined && ordinalIndex < contacts.length) {
      return ordinalIndex;
    }

    if (/^\d+$/.test(token)) {
      const numericIndex = Number(token) - 1;
      if (numericIndex >= 0 && numericIndex < contacts.length) {
        return numericIndex;
      }
    }
  }

  return null;
}

export function buildContactChoicesPrompt(
  contacts: Array<{ displayName?: string }>,
) {
  const count = contacts.length;
  const spokenNames = contacts
    .map(contact => contact.displayName?.trim())
    .filter((name): name is string => Boolean(name))
    .slice(0, 3);

  if (spokenNames.length === 0) {
    return `Намерих ${count} контакта. Кажи номер или цялото име.`;
  }

  const moreCount = count - spokenNames.length;
  const moreText = moreCount > 0 ? ` и още ${moreCount}` : '';
  return `Намерих ${count} контакта: ${spokenNames.join(', ')}${moreText}. Кажи номер или име.`;
}
