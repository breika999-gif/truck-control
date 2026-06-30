import { AppState, Linking, NativeModules, Platform } from 'react-native';
import { retrievePlace, suggestPlaces } from '../../features/navigation/api/geocoding';

type Coords = [number, number];

export interface IncomingNavigationTarget {
  coords: Coords;
  name: string;
  source: 'link' | 'share';
  raw: string;
}

type NativeShareIntent = {
  getInitialShare?: () => Promise<{ action?: string; text?: string; url?: string }>;
  clearInitialShare?: () => Promise<boolean>;
};

const shareIntent = NativeModules.ShareIntent as NativeShareIntent | undefined;

function isValidLatLng(lat: number, lng: number): boolean {
  return Number.isFinite(lat)
    && Number.isFinite(lng)
    && Math.abs(lat) <= 90
    && Math.abs(lng) <= 180;
}

function cleanUrl(value: string): string {
  return value.replace(/[)\].,;]+$/g, '');
}

function firstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s<>"']+/i);
  return match ? cleanUrl(match[0]) : null;
}

function decodeLoose(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

function parseCoords(raw: string): Coords | null {
  const variants = [raw, decodeLoose(raw)];
  for (const text of variants) {
    const latLngParams = text.match(/[?&]lat=(-?\d+(?:\.\d+)?).*?[?&](?:lng|lon|longitude)=(-?\d+(?:\.\d+)?)/);
    if (latLngParams) {
      const lat = Number(latLngParams[1]);
      const lng = Number(latLngParams[2]);
      if (isValidLatLng(lat, lng)) return [lng, lat];
    }
    const patterns = [
      /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
      /[?&](?:q|query|destination|ll)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
      /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
      /\b(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)\b/,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (!match) continue;
      const lat = Number(match[1]);
      const lng = Number(match[2]);
      if (isValidLatLng(lat, lng)) return [lng, lat];
    }
  }
  return null;
}

function inferName(raw: string): string {
  const withoutUrl = raw.replace(/https?:\/\/[^\s<>"']+/gi, ' ');
  const line = withoutUrl
    .split(/\r?\n/)
    .map(part => part.trim())
    .find(part => part.length > 2 && !/^google maps$/i.test(part));
  return line?.slice(0, 80) || 'Shared location';
}

async function resolveShortMapsUrl(url: string): Promise<string | null> {
  if (!/\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs)\//i.test(url)) {
    return null;
  }
  try {
    const response = await fetch(url, { method: 'GET' });
    return response.url || null;
  } catch {
    return null;
  }
}

async function resolveBySearch(raw: string, proximity?: Coords | null): Promise<IncomingNavigationTarget | null> {
  const query = inferName(raw);
  if (!query || query === 'Shared location') return null;
  const suggestions = await suggestPlaces(query, undefined, proximity ?? undefined);
  const first = suggestions[0];
  if (!first) return null;
  const place = await retrievePlace(first.place_id);
  if (!place) return null;
  return {
    coords: place.center,
    name: place.text || place.place_name || query,
    source: 'share',
    raw,
  };
}

export async function parseIncomingNavigation(
  raw: string,
  proximity?: Coords | null,
): Promise<IncomingNavigationTarget | null> {
  const text = raw.trim();
  if (!text) return null;

  const direct = parseCoords(text);
  if (direct) {
    return { coords: direct, name: inferName(text), source: text.startsWith('truck') ? 'link' : 'share', raw: text };
  }

  const url = firstUrl(text);
  if (url) {
    const expanded = await resolveShortMapsUrl(url);
    if (expanded) {
      const coords = parseCoords(expanded);
      if (coords) return { coords, name: inferName(text), source: 'share', raw: text };
    }
  }

  return resolveBySearch(text, proximity);
}

export function subscribeIncomingUrls(handler: (url: string) => void): () => void {
  Linking.getInitialURL().then(url => {
    if (url) handler(url);
  }).catch(() => {});
  const sub = Linking.addEventListener('url', event => handler(event.url));
  return () => sub.remove();
}

export function subscribeIncomingShares(handler: (text: string) => void): () => void {
  if (Platform.OS !== 'android' || !shareIntent?.getInitialShare) return () => {};
  let active = true;
  let last = '';

  const check = () => {
    shareIntent.getInitialShare?.().then(payload => {
      if (!active) return;
      const raw = `${payload.url || ''}\n${payload.text || ''}`.trim();
      if (!raw || raw === last) return;
      last = raw;
      handler(raw);
      shareIntent.clearInitialShare?.().catch(() => {});
    }).catch(() => {});
  };

  check();
  const sub = AppState.addEventListener('change', state => {
    if (state === 'active') check();
  });
  return () => {
    active = false;
    sub.remove();
  };
}
