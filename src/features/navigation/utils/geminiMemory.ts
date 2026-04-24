import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'gemini_user_memory';
const MAX_ITEMS = 10;

export interface MemoryItem {
  text: string;       // e.g. "Обича да спи в Найт Стар край Букурещ"
  ts: string;         // ISO timestamp
  category: 'parking' | 'route' | 'preference' | 'general';
}

export async function getMemory(): Promise<MemoryItem[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

async function consolidateMemory(): Promise<void> {
  const items = await getMemory();
  const byCategory: Record<string, MemoryItem[]> = {};
  for (const item of items) {
    if (!byCategory[item.category]) byCategory[item.category] = [];
    byCategory[item.category].push(item);
  }

  const consolidated: MemoryItem[] = [];
  for (const [category, catItems] of Object.entries(byCategory)) {
    if (catItems.length <= 3) {
      consolidated.push(...catItems);
    } else {
      // Обедини в един запис — последните 3 + summary на по-старите
      const recent = catItems.slice(-3);
      const older = catItems.slice(0, -3);
      const olderText = older.map(i => i.text).join('; ');
      consolidated.push({
        text: `[${older.length} по-стари: ${olderText}] | ${recent.map(i => i.text).join('; ')}`,
        ts: recent[recent.length - 1].ts,
        category: category as MemoryItem['category'],
      });
    }
  }

  await AsyncStorage.setItem(KEY, JSON.stringify(consolidated));
}

export async function addMemory(item: Omit<MemoryItem, 'ts'>): Promise<void> {
  const items = await getMemory();
  const updated = [...items, { ...item, ts: new Date().toISOString() }];
  const trimmed = updated.slice(-MAX_ITEMS);
  await AsyncStorage.setItem(KEY, JSON.stringify(trimmed));
  await consolidateMemory();
}

export async function getMemorySummary(): Promise<string[]> {
  const items = await getMemory();
  return items.slice(-8).map(i => i.text);
}
