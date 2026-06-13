import { useEffect, useRef, useState, type MutableRefObject } from 'react';

import { loadSavedAccount, type GoogleAccount } from '../../../shared/services/accountManager';
import {
  fetchTachoSummary,
  listStarred,
  type SavedPOI,
  type TachoSummary,
} from '../../../shared/services/backendApi';

type UseSessionBootstrapArgs = {
  setTachoSummaryRef: MutableRefObject<(summary: TachoSummary) => void>;
};

export function useSessionBootstrap({ setTachoSummaryRef }: UseSessionBootstrapArgs) {
  const [starredPOIs, setStarredPOIs] = useState<SavedPOI[]>([]);
  const [googleUser, setGoogleUser] = useState<GoogleAccount | null>(null);
  const googleUserRef = useRef<GoogleAccount | null>(null);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    googleUserRef.current = googleUser;
  }, [googleUser]);

  useEffect(() => {
    loadSavedAccount().then(acc => {
      if (!isMountedRef.current) return;
      const email = acc?.email;
      if (acc) {
        setGoogleUser(acc);
        listStarred(email).then(places => {
          if (isMountedRef.current) setStarredPOIs(places);
        });
      }
      fetchTachoSummary(email).then(summary => {
        if (!summary || !isMountedRef.current) return;
        setTachoSummaryRef.current(summary);
      });
    });
  }, [setTachoSummaryRef]);

  return {
    googleUser,
    setGoogleUser,
    googleUserRef,
    showAccountModal,
    setShowAccountModal,
    starredPOIs,
    setStarredPOIs,
  };
}
