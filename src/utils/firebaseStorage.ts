import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  doc, 
  getDoc,
  setDoc,
  getDocs,
  deleteDoc,
  type Firestore
} from 'firebase/firestore';
import type { LogEntry } from './logParser';
import { getFirebaseConfig, isFirebaseConfigured } from '../config/firebaseConfig';

const COLLECTION_NAME = 'counter_logs';
const META_DOC_ID = 'system_meta_status';

export interface CloudMetaStatus {
  updatedAt: number;     // 最終更新タイムスタンプ (ミリ秒)
  totalCount: number;    // 保存された総件数
  version: string;       // バージョン識別
}

/**
 * オブジェクトのプロパティをアルファベット順にソートして文字列化する関数。
 * プロパティの順序違いによる差分判定の誤検知を防ぐために使用。
 */
const stableStringify = (obj: any): string => {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(stableStringify).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  let res = '{';
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const val = obj[key];
    if (val !== undefined) {
      if (res.length > 1) res += ',';
      res += JSON.stringify(key) + ':' + stableStringify(val);
    }
  }
  res += '}';
  return res;
};

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
    // ① 年月(YYYY-MM)ごとにグループ化
    const groupedByMonth: Record<string, LogEntry[]> = {};
    entries.forEach(entry => {
      const monthStr = entry.dateStr.substring(0, 7); // 'YYYY-MM'
      if (!groupedByMonth[monthStr]) {
        groupedByMonth[monthStr] = [];
      }
      groupedByMonth[monthStr].push(entry);
    });

    // ② Firestore上の現在のデータを一括取得 (メタデータ・カメラ解析データ以外)
    const querySnapshot = await getDocs(collection(db, COLLECTION_NAME));
    const existingDocsMap: Record<string, any> = {};
    querySnapshot.forEach(docSnap => {
      if (docSnap.id !== META_DOC_ID && !docSnap.id.startsWith('camera_ai_')) {
        existingDocsMap[docSnap.id] = {
          ref: docSnap.ref,
          data: docSnap.data()
        };
      }
    });

    // ③ ローカルとクラウドを比較し、差分更新 (setDoc / deleteDoc)
    const months = Object.keys(groupedByMonth);
    let savedCount = 0;
    
    // 3-1: 変更がある月 (新規または更新) を保存
    for (const monthStr of months) {
      const localEntries = groupedByMonth[monthStr];
      const existing = existingDocsMap[monthStr];
      
      let needsUpdate = true;
      if (existing && existing.data.entries) {
        // プロパティ順序に依存しない安定したJSON文字列化による差分判定
        const localJson = stableStringify(localEntries);
        const remoteJson = stableStringify(existing.data.entries);
        if (localJson === remoteJson) {
          needsUpdate = false;
        }
      }

      if (needsUpdate) {
        const docRef = doc(db, COLLECTION_NAME, monthStr);
        await setDoc(docRef, {
          monthStr,
          entries: localEntries,
          updatedAt: Date.now(),
        });
        savedCount++;
        console.log(`[Firestore Sync] Saved/Updated month ${monthStr}`);
      }
    }

    // 3-2: ローカルから完全に消えた月をクラウドからも削除
    for (const remoteMonthStr in existingDocsMap) {
      if (!groupedByMonth[remoteMonthStr]) {
        await deleteDoc(existingDocsMap[remoteMonthStr].ref);
        console.log(`[Firestore Sync] Deleted month ${remoteMonthStr}`);
      }
    }

    if (savedCount === 0) {
      console.log('[Firestore Sync] No changes detected. All months are up-to-date.');
    }

    // ③ 最後にメタデータ を保存 (スマートキャッシュ判定用)
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
      // メタデータおよびカメラ解析ドキュメントは除外
      if (docSnap.id === META_DOC_ID || docSnap.id.startsWith('camera_ai_')) return;
      
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
 * Cloud Firestore の 'counter_logs' コレクション内の全ログドキュメントを削除します。
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

    // カメラ解析ドキュメントは残し、ログドキュメントのみ削除
    for (let i = 0; i < docs.length; i++) {
      if (!docs[i].id.startsWith('camera_ai_')) {
        await deleteDoc(docs[i].ref);
      }
    }
    return true;
  } catch (error) {
    console.error('Failed to clear logs from Firestore:', error);
    return false;
  }
};

// ============================================================================
// カメラAI雲量・山頂視界解析データの Cloud Firestore 自動永続化機能
// （月別ドキュメント分割 camera_ai_month_YYYY-MM により Firestore 1MB/doc 制限を永久回避）
// ============================================================================
const CAMERA_LEGACY_DOC_ID = 'camera_ai_analysis_v2';
const CAMERA_META_DOC_ID = 'camera_ai_meta_v3';
const CAMERA_MONTH_PREFIX = 'camera_ai_month_';

/**
 * カメラAI解析結果（全体マップ）を 年月(YYYY-MM)ごとのドキュメントに分割して
 * Cloud Firestore に自動保存します（1ドキュメント1MB上限を永久に回避）。
 */
export const saveCameraAnalysisToFirestore = async (
  analysisMap: Record<string, any[]>
): Promise<boolean> => {
  const db = getDB();
  if (!db) return false;

  try {
    const dates = Object.keys(analysisMap);
    const isCleared = dates.length === 0;

    if (isCleared) {
      const querySnapshot = await getDocs(collection(db, COLLECTION_NAME));
      for (const docSnap of querySnapshot.docs) {
        if (docSnap.id.startsWith(CAMERA_MONTH_PREFIX) || docSnap.id === CAMERA_LEGACY_DOC_ID) {
          await deleteDoc(docSnap.ref);
        }
      }
      await setDoc(doc(db, COLLECTION_NAME, CAMERA_META_DOC_ID), {
        updatedAt: Date.now(),
        cleared: true,
        months: [],
        totalDays: 0,
      });
      return true;
    }

    // 年月(YYYY-MM)ごとにグループ化
    const groupedByMonth: Record<string, Record<string, any[]>> = {};
    for (const dateStr of dates) {
      const monthStr = dateStr.substring(0, 7); // 'YYYY-MM'
      if (!groupedByMonth[monthStr]) {
        groupedByMonth[monthStr] = {};
      }
      groupedByMonth[monthStr][dateStr] = analysisMap[dateStr];
    }

    // 既存の月別カメラドキュメントを取得して差分比較（不要なWriteクォータ消費を防止）
    const querySnapshot = await getDocs(collection(db, COLLECTION_NAME));
    const existingMonthDocs: Record<string, any> = {};
    querySnapshot.forEach(docSnap => {
      if (docSnap.id.startsWith(CAMERA_MONTH_PREFIX)) {
        existingMonthDocs[docSnap.id] = docSnap.data();
      }
    });

    const months = Object.keys(groupedByMonth).sort();
    for (const monthStr of months) {
      const docId = `${CAMERA_MONTH_PREFIX}${monthStr}`;
      const monthRecords = groupedByMonth[monthStr];
      const existing = existingMonthDocs[docId];

      let needsWrite = true;
      if (existing && existing.records) {
        if (stableStringify(monthRecords) === stableStringify(existing.records)) {
          needsWrite = false;
        }
      }

      if (needsWrite) {
        await setDoc(doc(db, COLLECTION_NAME, docId), {
          monthStr,
          records: monthRecords,
          updatedAt: Date.now(),
        });
      }
    }

    // メタデータ更新
    await setDoc(doc(db, COLLECTION_NAME, CAMERA_META_DOC_ID), {
      updatedAt: Date.now(),
      cleared: false,
      months,
      totalDays: dates.length,
    });

    return true;
  } catch (error) {
    console.error('Failed to save camera analysis to Firestore:', error);
    return false;
  }
};

/**
 * Cloud Firestore から保存済みのカメラAI解析結果を読み込みます。
 * 旧形式（camera_ai_analysis_v2）と新形式（camera_ai_month_YYYY-MM）の両方を自動統合します。
 */
export const loadCameraAnalysisFromFirestore = async (): Promise<{
  records: Record<string, any[]>;
  cleared: boolean;
} | null> => {
  const db = getDB();
  if (!db) return null;

  try {
    const querySnapshot = await getDocs(collection(db, COLLECTION_NAME));
    let legacyRecords: Record<string, any[]> = {};
    const monthlyRecords: Record<string, any[]> = {};
    let metaCleared: boolean | null = null;
    let legacyCleared = false;
    let foundAny = false;

    querySnapshot.forEach(docSnap => {
      const id = docSnap.id;
      const data = docSnap.data();
      if (id === CAMERA_META_DOC_ID) {
        foundAny = true;
        metaCleared = Boolean(data.cleared);
      } else if (id === CAMERA_LEGACY_DOC_ID) {
        foundAny = true;
        legacyCleared = Boolean(data.cleared);
        if (data.records && typeof data.records === 'object') {
          legacyRecords = data.records as Record<string, any[]>;
        }
      } else if (id.startsWith(CAMERA_MONTH_PREFIX)) {
        foundAny = true;
        if (data.records && typeof data.records === 'object') {
          Object.assign(monthlyRecords, data.records);
        }
      }
    });

    if (!foundAny) return null;

    const isCleared = metaCleared !== null ? metaCleared : legacyCleared;
    if (isCleared && Object.keys(monthlyRecords).length === 0) {
      return { records: {}, cleared: true };
    }

    // 旧ドキュメントのデータの上に月別分割ドキュメントの最新データをマージ
    const mergedRecords = { ...legacyRecords, ...monthlyRecords };
    return {
      records: mergedRecords,
      cleared: false,
    };
  } catch (error) {
    console.warn('Failed to load camera analysis from Firestore:', error);
    return null;
  }
};
