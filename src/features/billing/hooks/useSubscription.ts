import React from 'react';
import type { CustomerInfo, PurchasesPackage } from 'react-native-purchases';
import {
  hasProEntitlement,
  loadBillingState,
  purchaseProPackage,
  restoreProPurchases,
  type BillingState,
} from '../services/revenueCat';

const EMPTY_STATE: BillingState = {
  configured: false,
  isPro: false,
  customerInfo: null,
  offering: null,
  packages: [],
  error: null,
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown billing error';
}

export function useSubscription(appUserID?: string | null) {
  const [state, setState] = React.useState<BillingState>(EMPTY_STATE);
  const [loading, setLoading] = React.useState(true);
  const [busyPackageId, setBusyPackageId] = React.useState<string | null>(null);
  const [restoring, setRestoring] = React.useState(false);

  const applyCustomerInfo = React.useCallback((customerInfo: CustomerInfo | null) => {
    setState(prev => ({
      ...prev,
      customerInfo,
      isPro: hasProEntitlement(customerInfo),
      error: null,
    }));
  }, []);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    const next = await loadBillingState(appUserID);
    setState(next);
    setLoading(false);
  }, [appUserID]);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadBillingState(appUserID).then(next => {
      if (!cancelled) setState(next);
    }).catch(error => {
      if (!cancelled) setState(prev => ({ ...prev, error: toErrorMessage(error) }));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [appUserID]);

  const purchase = React.useCallback(async (pkg: PurchasesPackage) => {
    setBusyPackageId(pkg.identifier);
    try {
      const customerInfo = await purchaseProPackage(pkg);
      if (customerInfo) applyCustomerInfo(customerInfo);
    } catch (error) {
      setState(prev => ({ ...prev, error: toErrorMessage(error) }));
    } finally {
      setBusyPackageId(null);
    }
  }, [applyCustomerInfo]);

  const restore = React.useCallback(async () => {
    setRestoring(true);
    try {
      const customerInfo = await restoreProPurchases();
      applyCustomerInfo(customerInfo);
    } catch (error) {
      setState(prev => ({ ...prev, error: toErrorMessage(error) }));
    } finally {
      setRestoring(false);
    }
  }, [applyCustomerInfo]);

  return {
    ...state,
    loading,
    busyPackageId,
    restoring,
    refresh,
    purchase,
    restore,
  };
}
