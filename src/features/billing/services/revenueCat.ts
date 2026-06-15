import Purchases, {
  type CustomerInfo,
  type MakePurchaseResult,
  type PurchasesOffering,
  type PurchasesPackage,
} from 'react-native-purchases';
import { Platform } from 'react-native';
import { REVENUECAT_ANDROID_API_KEY } from '../../../shared/constants/config';

export const PRO_ENTITLEMENT_ID = 'pro';

let configured = false;

export interface BillingState {
  configured: boolean;
  isPro: boolean;
  customerInfo: CustomerInfo | null;
  offering: PurchasesOffering | null;
  packages: PurchasesPackage[];
  error: string | null;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown billing error';
}

function isUserCancelled(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const maybeCode = 'code' in error ? String(error.code) : '';
  const maybeCancelled = 'userCancelled' in error ? Boolean(error.userCancelled) : false;
  return maybeCancelled || maybeCode.toLowerCase().includes('cancel');
}

export function hasProEntitlement(customerInfo: CustomerInfo | null): boolean {
  return Boolean(customerInfo?.entitlements.active[PRO_ENTITLEMENT_ID]);
}

export function getRevenueCatApiKey(): string {
  if (Platform.OS === 'android') return REVENUECAT_ANDROID_API_KEY;
  return '';
}

export function configureRevenueCat(appUserID?: string | null): boolean {
  if (configured) return true;
  const apiKey = getRevenueCatApiKey();
  if (!apiKey) return false;

  Purchases.setLogLevel(__DEV__ ? Purchases.LOG_LEVEL.DEBUG : Purchases.LOG_LEVEL.INFO).catch(() => undefined);
  Purchases.configure({
    apiKey,
    appUserID: appUserID || undefined,
  });
  configured = true;
  return true;
}

export async function loadBillingState(appUserID?: string | null): Promise<BillingState> {
  const isConfigured = configureRevenueCat(appUserID);
  if (!isConfigured) {
    return {
      configured: false,
      isPro: false,
      customerInfo: null,
      offering: null,
      packages: [],
      error: 'RevenueCat API key is missing',
    };
  }

  try {
    const [customerInfo, offerings] = await Promise.all([
      Purchases.getCustomerInfo(),
      Purchases.getOfferings(),
    ]);
    const offering = offerings.current;
    return {
      configured: true,
      isPro: hasProEntitlement(customerInfo),
      customerInfo,
      offering,
      packages: offering?.availablePackages ?? [],
      error: null,
    };
  } catch (error) {
    return {
      configured: true,
      isPro: false,
      customerInfo: null,
      offering: null,
      packages: [],
      error: errorMessage(error),
    };
  }
}

export async function purchaseProPackage(pkg: PurchasesPackage): Promise<CustomerInfo | null> {
  try {
    const result: MakePurchaseResult = await Purchases.purchasePackage(pkg);
    return result.customerInfo;
  } catch (error) {
    if (isUserCancelled(error)) return null;
    throw error;
  }
}

export async function restoreProPurchases(): Promise<CustomerInfo> {
  return Purchases.restorePurchases();
}
