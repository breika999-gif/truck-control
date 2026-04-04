import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'gemini_user_memory';
const MAX_ITEMS = 30;

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

export async function addMemory(item: Omit<MemoryItem, 'ts'>): Promise<void> {
  const items = await getMemory();
  const updated = [...items, { ...item, ts: new Date().toISOString() }];
  // keep only last MAX_ITEMS
  const trimmed = updated.slice(-MAX_ITEMS);
  await AsyncStorage.setItem(KEY, JSON.stringify(trimmed));
}

export async function getMemorySummary(): Promise<string[]> {
  const items = await getMemory();
  return items.map(i => i.text);
}
