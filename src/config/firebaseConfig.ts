// Firebase project configuration
// ご自身の Firebase プロジェクトの設定 (.env や UIからの設定) を管理します。

export interface FirebaseConfigType {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

const STORAGE_KEY = 'tozan_custom_firebase_config';

const defaultEnvConfig: FirebaseConfigType = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
};

export const getFirebaseConfig = (): FirebaseConfigType => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && (parsed.projectId || parsed.apiKey)) {
        return { ...defaultEnvConfig, ...parsed };
      }
    }
  } catch (e) {
    console.error('Failed to parse custom firebase config:', e);
  }
  return defaultEnvConfig;
};

export const saveCustomFirebaseConfig = (config: Partial<FirebaseConfigType>) => {
  try {
    const current = getFirebaseConfig();
    const updated = { ...current, ...config };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (e) {
    console.error('Failed to save custom firebase config:', e);
  }
};

export const clearCustomFirebaseConfig = () => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.error('Failed to clear custom firebase config:', e);
  }
};

export const isFirebaseConfigured = (): boolean => {
  const config = getFirebaseConfig();
  return Boolean(config.apiKey && config.projectId);
};
