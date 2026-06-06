import { useState, useEffect, useCallback } from 'react';
import i18n from '../../../i18n';

export interface Ban {
  flag: string;
  country: string;
  time: string;
  alert: boolean;
  note: string;
}

export function useTruckBans(date: string) {
  const [bans, setBans] = useState<Ban[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBans = useCallback(async () => {
    setLoading(true);
    setError(null);

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': 'https://www.trafficban.com/',
    };

    try {
      // 1. Establish session (homepage fetch for cookies)
      await fetch('https://www.trafficban.com/', { headers });

      // 2. Extract dynamic parameter name from JS list file
      const jsUrl = 'https://www.trafficban.com/res/js/js.ban.list.for.date.html';
      const jsResp = await fetch(jsUrl, { headers });
      const jsText = await jsResp.text();
      
      const m = jsText.match(/\?([A-Za-z0-9]{5,15})=/);
      const paramName = m ? m[1] : 'KHcYF42A';

      // 3. Get session key for the specific date
      const keyUrl = `https://www.trafficban.com/res/json/json.get.key.html?d=${date}`;
      const keyResp = await fetch(keyUrl, { headers });
      const keyData = await keyResp.json();
      const key = keyData.key;

      if (!key) {
        throw new Error(i18n.t('bans.sessionKeyFailed'));
      }

      // 4. Fetch the actual bans using the dynamic param and key
      const bansUrl = `https://www.trafficban.com/res/json/json.ban.list.for.date.html?${paramName}=${key}&d=${date}`;
      const bansResp = await fetch(bansUrl, { headers });
      const rawBans = await bansResp.json();

      if (!Array.isArray(rawBans)) {
        throw new Error(i18n.t('bans.invalidData'));
      }

      const formatted: Ban[] = rawBans.map((b: any) => ({
        flag: b.fl || '',
        country: b.cr || '',
        time: b.tm || '',
        alert: !!b.al,
        note: b.al ? i18n.t('bans.important') : '',
      }));

      setBans(formatted);
    } catch (err: any) {
      setError(err.message || i18n.t('bans.serverError'));
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    fetchBans();
  }, [fetchBans]);

  return { bans, loading, error, refetch: fetchBans };
}
