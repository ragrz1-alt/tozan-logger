/**
 * public/cams/analysis_results.json を Cloud Firestore (counter_logs / camera_ai_month_YYYY-MM) へ直接同期するスクリプト
 *
 * UI側の firebaseStorage.ts (saveCameraAnalysisToFirestore) と完全互換の形式で差分アップロードします。
 * ブラウザから「JSONインポート(クラウド同期)」を手動クリックする手間をなくすためのNode同期モジュールです。
 *
 * 使い方:
 *   node scripts/sync_cams_to_firestore.mjs            # 変更のある月だけFirestoreへ書き込み
 *   node scripts/sync_cams_to_firestore.mjs --dry-run  # 書き込みせず差分だけ確認
 */

import fs from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';
import { initializeApp, getApps, getApp, deleteApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDocs,
  query,
  where,
  documentId,
  terminate,
} from 'firebase/firestore';

const COLLECTION_NAME = 'counter_logs';
const CAMERA_META_DOC_ID = 'camera_ai_meta_v3';
const CAMERA_MONTH_PREFIX = 'camera_ai_month_';
const DEFAULT_RESULTS_FILE = path.join(process.cwd(), 'public', 'cams', 'analysis_results.json');

function stableStringify(obj) {
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
}

export async function loadFirebaseEnvConfig() {
  const keys = [
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_STORAGE_BUCKET',
    'VITE_FIREBASE_MESSAGING_SENDER_ID',
    'VITE_FIREBASE_APP_ID',
  ];
  const envMap = {};
  for (const k of keys) {
    if (process.env[k]?.trim()) {
      envMap[k] = process.env[k].trim();
    }
  }
  for (const fileName of ['.env.development.local', '.env.local', '.env']) {
    try {
      const content = await fs.readFile(path.join(process.cwd(), fileName), 'utf-8');
      for (const k of keys) {
        if (envMap[k]) continue;
        const m = content.match(new RegExp(`^${k}=(.*)$`, 'm'));
        if (m && m[1].trim()) {
          envMap[k] = m[1].trim().replace(/^["']|["']$/g, '');
        }
      }
    } catch {
      // ignore missing file
    }
  }
  return {
    apiKey: envMap.VITE_FIREBASE_API_KEY || '',
    authDomain: envMap.VITE_FIREBASE_AUTH_DOMAIN || '',
    projectId: envMap.VITE_FIREBASE_PROJECT_ID || '',
    storageBucket: envMap.VITE_FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: envMap.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
    appId: envMap.VITE_FIREBASE_APP_ID || '',
  };
}

/**
 * Firestore から既存のカメラAI解析結果全体を取得する（ブラウザUIや過去実行分の取りこぼし防止用）
 */
export async function fetchFirestoreAnalysisMap() {
  const config = await loadFirebaseEnvConfig();
  if (!config.apiKey || !config.projectId) {
    return {};
  }
  const app = !getApps().length ? initializeApp(config) : getApp();
  const db = getFirestore(app);
  try {
    const q = query(
      collection(db, COLLECTION_NAME),
      where(documentId(), '>=', 'camera_ai_'),
      where(documentId(), '<=', 'camera_ai_\uf8ff')
    );
    const snapshot = await getDocs(q);
    const merged = {};
    snapshot.forEach(docSnap => {
      if (docSnap.id.startsWith(CAMERA_MONTH_PREFIX)) {
        const data = docSnap.data();
        if (data?.records && typeof data.records === 'object') {
          Object.assign(merged, data.records);
        }
      }
    });
    return merged;
  } finally {
    await terminate(db).catch(() => {});
    await deleteApp(app).catch(() => {});
  }
}

export async function syncCamsToFirestore(options = {}) {
  const { resultsFile = DEFAULT_RESULTS_FILE, dryRun = false } = options;
  const config = await loadFirebaseEnvConfig();
  if (!config.apiKey || !config.projectId) {
    throw new Error('.env または環境変数に VITE_FIREBASE_API_KEY / VITE_FIREBASE_PROJECT_ID が設定されていません。');
  }

  const raw = await fs.readFile(resultsFile, 'utf-8');
  const analysisMap = JSON.parse(raw);
  const dates = Object.keys(analysisMap).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k) && Array.isArray(analysisMap[k]));

  if (dates.length === 0) {
    console.log('ℹ️ 同期対象の解析データがありません。');
    return { updatedMonths: [], totalDays: 0 };
  }

  const groupedByMonth = {};
  for (const dateStr of dates) {
    const monthStr = dateStr.substring(0, 7);
    if (!groupedByMonth[monthStr]) groupedByMonth[monthStr] = {};
    groupedByMonth[monthStr][dateStr] = analysisMap[dateStr];
  }

  const app = !getApps().length ? initializeApp(config) : getApp();
  const db = getFirestore(app);

  try {
    const q = query(
      collection(db, COLLECTION_NAME),
      where(documentId(), '>=', 'camera_ai_'),
      where(documentId(), '<=', 'camera_ai_\uf8ff')
    );
    const snapshot = await getDocs(q);
    const existingMonthDocs = {};
    snapshot.forEach(docSnap => {
      if (docSnap.id.startsWith(CAMERA_MONTH_PREFIX)) {
        existingMonthDocs[docSnap.id] = docSnap.data();
      }
    });

    const localMonths = Object.keys(groupedByMonth).sort();
    const remoteMonthKeys = Object.keys(existingMonthDocs).map(id => id.replace(CAMERA_MONTH_PREFIX, ''));
    const allMonths = Array.from(new Set([...remoteMonthKeys, ...localMonths])).sort();
    const updatedMonths = [];
    let mergedTotalDays = 0;

    for (const monthStr of allMonths) {
      const docId = `${CAMERA_MONTH_PREFIX}${monthStr}`;
      const existing = existingMonthDocs[docId];
      const localRecords = groupedByMonth[monthStr];

      if (!localRecords) {
        // Firestore側にのみ存在する月は上書き保護し、日数だけ加算
        mergedTotalDays += existing?.records ? Object.keys(existing.records).length : 0;
        continue;
      }

      // Firestore既存日とマージ（ローカルにある日はローカル優先で上書き、クラウド側だけの日は残す）
      const mergedMonthRecords = { ...(existing?.records || {}), ...localRecords };
      mergedTotalDays += Object.keys(mergedMonthRecords).length;

      const isUnchanged =
        existing?.records && stableStringify(mergedMonthRecords) === stableStringify(existing.records);

      if (!isUnchanged) {
        updatedMonths.push(monthStr);
        if (!dryRun) {
          await setDoc(doc(db, COLLECTION_NAME, docId), {
            monthStr,
            records: mergedMonthRecords,
            updatedAt: Date.now(),
          });
          console.log(`  ☁️ Firestore更新完了: ${docId} (${Object.keys(mergedMonthRecords).length}日分)`);
        } else {
          console.log(`  🔍 [dry-run] 更新予定: ${docId} (${Object.keys(mergedMonthRecords).length}日分)`);
        }
      }
    }

    if (!dryRun && updatedMonths.length > 0) {
      await setDoc(doc(db, COLLECTION_NAME, CAMERA_META_DOC_ID), {
        updatedAt: Date.now(),
        cleared: false,
        months: allMonths,
        totalDays: mergedTotalDays,
      });
      console.log(`✅ Firestore 同期完了 (${updatedMonths.length}ヶ月更新 / 累計 ${mergedTotalDays}日分)`);
    } else if (updatedMonths.length === 0) {
      console.log(`✨ Firestore はすでに最新状態です (${mergedTotalDays}日分)`);
    } else {
      console.log(`🔍 [dry-run] 同期対象月: ${updatedMonths.join(', ')} (累計 ${mergedTotalDays}日分)`);
    }

    return { updatedMonths, totalDays: mergedTotalDays };
  } finally {
    await terminate(db).catch(() => {});
    await deleteApp(app).catch(() => {});
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const dryRun = process.argv.includes('--dry-run');
  syncCamsToFirestore({ dryRun }).catch(err => {
    console.error('Firestore Sync Error:', err);
    process.exit(1);
  });
}
