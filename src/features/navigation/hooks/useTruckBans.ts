import { useState, useEffect, useCallback } from 'react';
import i18n from '../../../i18n';
import { BACKEND_URL } from '../../../shared/constants/config';
import { getBackendAuthHeaders } from '../../../shared/services/backendApi';

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

    try {
      const authHeaders = await getBackendAuthHeaders();
      const resp = await fetch(`${BACKEND_URL}/api/truck-bans?date=${encodeURIComponent(date)}`, {
        headers: authHeaders,
      });
      const payload = await resp.json();
      if (!resp.ok || !payload.ok) {
        throw new Error(payload.error || i18n.t('bans.serverError'));
      }
      const rawBans = payload.bans;

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
