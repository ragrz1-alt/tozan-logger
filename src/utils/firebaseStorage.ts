import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  doc, 
  getDoc,
  setDoc,
  getDocs, 
  writeBatch, 
  type Firestore
} from 'firebase/firestore';
import type { LogEntry } from './logParser';
import { getFirebaseConfig, isFirebaseConfigured } from '../config/firebaseConfig';

const COLLECTION_NAME = 'counter_logs';
const META_DOC_ID = '__meta_status__';

export interface CloudMetaStatus {
  updatedAt: number;     // 最終更新タイムスタンプ (ミリ秒)
  totalCount: number;    // 保存された総件数
  version: string;       // バージョン識別
}

const getDB = (): Firestore | null => {
  if (!isFirebaseConfigured()) {
    return null;
  }
  try {
    const config = getFirebaseConfig();
    const app = !getApps().length ? initializeApp(config) : getApp();
    return getFirestore(app);
  } catch (error) {
    console.error('Firebase initialization failed:', error);
    return null;
  }
};

/**
 * たった 1 Read で Cloud Firestore 上の最新データ保存状態（メタデータ）を確認します。
 * (更新日時 updatedAt や総件数 totalCount を取得し、キャッシュとの比較に用います)
 */
export const checkCloudMetadata = async (): Promise<CloudMetaStatus | null> => {
  const db = getDB();
  if (!db) return null;

  try {
    const docRef = doc(db, COLLECTION_NAME, META_DOC_ID);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      return snap.data() as CloudMetaStatus;
    }
    return null;
  } catch (error) {
    console.warn('Failed to check cloud metadata:', error);
    return null;
  }
};

/**
 * ログデータを年月(YYYY-MM)ごとにグループ化し、
 * Cloud Firestore の 'counter_logs' コレクションの月別ドキュメントとして保存します。
 * (※ 日別から月別に集約することで、ドキュメント読み取り/書き込み回数を約97%削減しクォータ消費を激減させます)
 */
export const saveLogsToFirestore = async (entries: LogEntry[]): Promise<boolean> => {
  const db = getDB();
  if (!db) {
    console.warn('Firebase is not configured.');
    return false;
  }

  try {
    // ① 古い日別(YYYY-MM-DD)などで細切れに増えた大量ドキュメントをクリーンアップし、クォータと容量をリセット
    await clearLogsFromFirestore();

    // ② 年月(YYYY-MM)ごとにグループ化 (月別ドキュメント保存方式: クォータ97%削減)
    const groupedByMonth: Record<string, LogEntry[]> = {};
    entries.forEach(entry => {
      const monthStr = entry.dateStr.substring(0, 7); // 'YYYY-MM'
      if (!groupedByMonth[monthStr]) {
        groupedByMonth[monthStr] = [];
      }
      groupedByMonth[monthStr].push(entry);
    });

    const months = Object.keys(groupedByMonth);
    // 1年分(12ヶ月分)でも約数千件/数MB以下なので、安心の10ヶ月分ごとに自動分割 commit
    const batchSize = 10;
    for (let i = 0; i < months.length; i += batchSize) {
      const batch = writeBatch(db);
      const chunk = months.slice(i, i + batchSize);
      
      chunk.forEach(monthStr => {
        const docRef = doc(db, COLLECTION_NAME, monthStr);
        batch.set(docRef, {
          monthStr,
          entries: groupedByMonth[monthStr],
          updatedAt: Date.now(),
        });
      });

      await batch.commit();
      console.log(`[Firestore Sync] Saved batch ${i + 1} to ${i + chunk.length} / ${months.length} months`);
    }

    // ③ 最後にメタデータ (__meta_status__) を保存 (スマートキャッシュ判定用)
    const metaRef = doc(db, COLLECTION_NAME, META_DOC_ID);
    const updatedAt = Date.now();
    await setDoc(metaRef, {
      updatedAt,
      totalCount: entries.length,
      version: '2.0',
    });
    // ローカルにも最新同期タイムスタンプを保存
    localStorage.setItem('tozan_cloud_updated_at', String(updatedAt));
    localStorage.setItem('tozan_cloud_total_count', String(entries.length));

    return true;
  } catch (error) {
    console.error('Failed to save logs to Firestore:', error);
    return false;
  }
};

/**
 * Cloud Firestore の 'counter_logs' コレクションから全ての日付ドキュメントを読み込み、
 * 一つのソート済み LogEntry[] として返します。
 */
export const loadLogsFromFirestore = async (): Promise<LogEntry[]> => {
  const db = getDB();
  if (!db) {
    console.warn('Firebase is not configured.');
    return [];
  }

  try {
    const querySnapshot = await getDocs(collection(db, COLLECTION_NAME));
    let allEntries: LogEntry[] = [];

    querySnapshot.forEach(docSnap => {
      // メタデータドキュメントは除外
      if (docSnap.id === META_DOC_ID) return;
      
      const data = docSnap.data();
      if (data && Array.isArray(data.entries)) {
        allEntries = allEntries.concat(data.entries as LogEntry[]);
      }
    });

    // タイムスタンプ順にソート
    allEntries.sort((a, b) => a.timestamp - b.timestamp);

    // 最新タイムスタンプ・総件数をローカルに記録
    if (allEntries.length > 0) {
      localStorage.setItem('tozan_cloud_total_count', String(allEntries.length));
      localStorage.setItem('tozan_cloud_updated_at', String(Date.now()));
    }

    return allEntries;
  } catch (error) {
    console.error('Failed to load logs from Firestore:', error);
    return [];
  }
};

/**
 * Cloud Firestore の 'counter_logs' コレクション内の全ドキュメントを削除します。
 */
export const clearLogsFromFirestore = async (): Promise<boolean> => {
  const db = getDB();
  if (!db) {
    console.warn('Firebase is not configured.');
    return false;
  }

  try {
    const querySnapshot = await getDocs(collection(db, COLLECTION_NAME));
    const docs = querySnapshot.docs;

    const batchSize = 450;
    for (let i = 0; i < docs.length; i += batchSize) {
      const batch = writeBatch(db);
      const chunk = docs.slice(i, i + batchSize);
      chunk.forEach(docSnap => {
        batch.delete(docSnap.ref);
      });
      await batch.commit();
    }
    return true;
  } catch (error) {
    console.error('Failed to clear logs from Firestore:', error);
    return false;
  }
};
