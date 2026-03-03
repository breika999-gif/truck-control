/**
 * accountManager.ts — Google AccountPicker JS bridge.
 *
 * Uses the Android native AccountManagerModule to show the system
 * Google account chooser and persists the chosen email to AsyncStorage.
 *
 * On non-Android platforms the module is not available; functions return null.
 */
import { NativeModules, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@truckai/google_account';

export interface GoogleAccount {
  email: string;
}

/**
 * Open the Android system Google account picker.
 * Saves the selected email to AsyncStorage and returns it.
 * Throws if the user cancels or no activity is available.
 */
export async function pickGoogleAccount(): Promise<GoogleAccount> {
  if (Platform.OS !== 'android') {
    throw new Error('AccountPicker is only available on Android');
  }
  const email: string = await NativeModules.AccountManager.pickGoogleAccount();
  await AsyncStorage.setItem(STORAGE_KEY, email);
  return { email };
}

/** Load previously saved Google account from AsyncStorage. */
export async function loadSavedAccount(): Promise<GoogleAccount | null> {
  const email = await AsyncStorage.getItem(STORAGE_KEY);
  return email ? { email } : null;
}

/** Remove the saved Google account from AsyncStorage. */
export async function clearAccount(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}
