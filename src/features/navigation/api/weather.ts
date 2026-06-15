export interface ParkingWeather {
  tempC: number;
  icon: string;
  label: string;
}

type AbortSignalWithTimeout = typeof AbortSignal & {
  timeout?: (milliseconds: number) => AbortSignal;
};

function timeoutSignal(milliseconds: number): AbortSignal {
  const nativeSignal = (AbortSignal as AbortSignalWithTimeout).timeout?.(milliseconds);
  if (nativeSignal) return nativeSignal;
  const controller = new AbortController();
  setTimeout(() => controller.abort(), milliseconds);
  return controller.signal;
}

function decodeWmo(code: number): { icon: string; label: string } {
  if (code === 0) return { icon: '☀', label: 'ясно' };
  if (code <= 2) return { icon: '🌤', label: 'частично облачно' };
  if (code === 3) return { icon: '⛅', label: 'облачно' };
  if (code >= 51 && code <= 67) return { icon: '🌧', label: 'дъжд' };
  if (code >= 71 && code <= 77) return { icon: '❄', label: 'сняг' };
  if (code >= 80 && code <= 82) return { icon: '🌧', label: 'дъжд' };
  if (code >= 95) return { icon: '🌩', label: 'гръмотевица' };
  if (code >= 45 && code <= 48) return { icon: '🌫', label: 'мъгла' };
  return { icon: '🌤', label: '' };
}

export async function fetchParkingWeather(
  lat: number,
  lng: number,
): Promise<ParkingWeather | null> {
  try {
    const url =
      'https://api.open-meteo.com/v1/forecast' +
      `?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
      '&current=temperature_2m,weathercode' +
      '&timezone=auto&forecast_days=1';
    const res = await fetch(url, { signal: timeoutSignal(4000) });
    if (!res.ok) return null;
    const json = await res.json();
    const temp: number = json.current?.temperature_2m ?? 0;
    const code: number = json.current?.weathercode ?? 0;
    const { icon, label } = decodeWmo(code);
    return { tempC: Math.round(temp), icon, label };
  } catch {
    return null;
  }
}
