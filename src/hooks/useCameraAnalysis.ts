import { useState, useEffect, useCallback } from 'react';
import {
  saveCameraAnalysisToFirestore,
  loadCameraAnalysisFromFirestore,
} from '../utils/firebaseStorage';

export interface ImageAnalysis {
  fileName: string;
  is_sunny: boolean;
  summit_visible?: boolean;
  cloud_cover: number;
  visibility: 'clear' | 'cloudy' | 'foggy' | 'missing';
  reason: string;
  status?: string;
}

export interface DailyCameraSummary {
  mountainCategory: 'clear' | 'cloudy' | 'foggy' | 'unknown';
  clearCount: number;
  cloudyCount: number;
  foggyCount: number;
  sunnyCount: number;
  sunnyRatio: number;
  validCount: number;
  avgCloudCover: number | null;
  morningClearAfternoonFoggy: boolean;
  byCamera: Record<'oshidomari' | 'kutsugata' | 'senposhi', 'clear' | 'cloudy' | 'foggy' | 'unknown'>;
}

/**
 * ブラウザの localStorage 5MB上限を圧迫していた過去の巨大気象キャッシュ等を掃除して空き容量を確保する
 */
export function cleanupObsoleteLocalStorageCaches(): void {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      // サーバー同梱の weather-daily.json があるため、1MB超のローカル日別気象キャッシュは不要
      if (
        k.startsWith('tozan_weather_daily_cache_') ||
        k.startsWith('tozan_weather_hourly_cache_v')
      ) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
  } catch (e) {
    console.warn('localStorage cleanup warning:', e);
  }
}

/**
 * カメラAI解析データを localStorage ＆ Cloud Firestore の両方へ確実に永続保存する共通関数
 */
export async function persistCameraAnalysisResults(
  updatedMap: Record<string, ImageAnalysis[]>,
  isCleared = false
): Promise<boolean> {
  // 1. まず不要な気象キャッシュを掃除してから localStorage に保存
  cleanupObsoleteLocalStorageCaches();
  try {
    if (isCleared) {
      localStorage.removeItem('tozan_weather_analysis_cache');
      localStorage.setItem('tozan_weather_analysis_cleared', 'true');
    } else {
      localStorage.setItem('tozan_weather_analysis_cleared', 'false');
      localStorage.setItem('tozan_weather_analysis_cache', JSON.stringify(updatedMap));
    }
  } catch (storageErr) {
    console.warn('localStorage容量不足のため追加クリーンアップを実行します:', storageErr);
    try {
      // 万が一まだ容量不足ならAIレポートキャッシュ以外の古いキーを整理して再試行
      cleanupObsoleteLocalStorageCaches();
      localStorage.setItem('tozan_weather_analysis_cache', JSON.stringify(updatedMap));
    } catch (e2) {
      console.warn('localStorage保存スキップ（Cloud Firestoreへ保存します）:', e2);
    }
  }

  notifyCameraAnalysisUpdated();

  // 2. Cloud Firestore に自動保存（別タブ・別端末・リロードでも消えない永久保存）
  const cloudOk = await saveCameraAnalysisToFirestore(updatedMap);
  return cloudOk;
}

/**
 * 1日分のカメラAI解析配列（7回×3地点＝21枚、または従来の5回＝15枚）から、
 * その日の山頂視界・雲量・日差しサマリーを厳密に評価する共通関数
 */
export function evaluateDailyCameraVisibility(camData?: ImageAnalysis[]): DailyCameraSummary {
  const defaultByCam: DailyCameraSummary['byCamera'] = {
    oshidomari: 'unknown',
    kutsugata: 'unknown',
    senposhi: 'unknown',
  };

  if (!camData || camData.length === 0) {
    return {
      mountainCategory: 'unknown',
      clearCount: 0,
      cloudyCount: 0,
      foggyCount: 0,
      sunnyCount: 0,
      sunnyRatio: 0,
      validCount: 0,
      avgCloudCover: null,
      morningClearAfternoonFoggy: false,
      byCamera: defaultByCam,
    };
  }

  const validCams = camData.filter(
    c => c.status !== 'missing' && c.visibility !== 'missing' && c.cloud_cover >= 0
  );
  if (validCams.length === 0) {
    return {
      mountainCategory: 'unknown',
      clearCount: 0,
      cloudyCount: 0,
      foggyCount: 0,
      sunnyCount: 0,
      sunnyRatio: 0,
      validCount: 0,
      avgCloudCover: null,
      morningClearAfternoonFoggy: false,
      byCamera: defaultByCam,
    };
  }

  const cams = ['oshidomari', 'kutsugata', 'senposhi'] as const;
  const byCamera: DailyCameraSummary['byCamera'] = { ...defaultByCam };

  cams.forEach(cam => {
    const cData = validCams.filter(c => c.fileName.includes(cam));
    if (cData.length === 0) return;
    const clear = cData.filter(c => c.visibility === 'clear' && c.summit_visible !== false).length;
    const foggy = cData.filter(c => c.visibility === 'foggy').length;
    if (clear >= cData.length * 0.35) {
      byCamera[cam] = 'clear';
    } else if (foggy >= cData.length * 0.5) {
      byCamera[cam] = 'foggy';
    } else {
      byCamera[cam] = 'cloudy';
    }
  });

  const camValues = Object.values(byCamera);
  let mountainCategory: 'clear' | 'cloudy' | 'foggy' | 'unknown' = 'unknown';
  if (camValues.includes('clear')) {
    mountainCategory = 'clear';
  } else if (camValues.every(r => r === 'foggy' || r === 'unknown')) {
    mountainCategory = 'foggy';
  } else {
    mountainCategory = 'cloudy';
  }

  const clearCount = validCams.filter(c => c.visibility === 'clear' && c.summit_visible !== false).length;
  const foggyCount = validCams.filter(c => c.visibility === 'foggy').length;
  const cloudyCount = validCams.length - clearCount - foggyCount;
  const sunnyCount = validCams.filter(c => c.is_sunny).length;
  const sunnyRatio = Math.round((sunnyCount / validCams.length) * 100) / 100;

  const totalCloud = validCams.reduce(
    (sum, c) => sum + (typeof c.cloud_cover === 'number' ? c.cloud_cover : 5),
    0
  );
  const avgCloudCover = Math.round((totalCloud / validCams.length) * 10) / 10;

  // 朝（05, 07, 08, 09時）にclearがあり、昼〜午後（11, 13, 14, 15時）がほぼfoggy/cloudyに悪化した日を検知
  const morningCams = validCams.filter(
    c =>
      c.fileName.startsWith('05_') ||
      c.fileName.startsWith('07_') ||
      c.fileName.startsWith('08_') ||
      c.fileName.startsWith('09_')
  );
  const afternoonCams = validCams.filter(
    c =>
      c.fileName.startsWith('11_') ||
      c.fileName.startsWith('13_') ||
      c.fileName.startsWith('14_') ||
      c.fileName.startsWith('15_')
  );
  const morningHasClear = morningCams.some(c => c.visibility === 'clear' && c.summit_visible !== false);
  const afternoonAllBad =
    afternoonCams.length > 0 &&
    afternoonCams.every(c => c.visibility === 'foggy' || (c.visibility === 'cloudy' && c.cloud_cover >= 8));
  const morningClearAfternoonFoggy = morningHasClear && afternoonAllBad;

  return {
    mountainCategory,
    clearCount,
    cloudyCount,
    foggyCount,
    sunnyCount,
    sunnyRatio,
    validCount: validCams.length,
    avgCloudCover,
    morningClearAfternoonFoggy,
    byCamera,
  };
}

export const CAMERA_ANALYSIS_UPDATED_EVENT = 'tozan-camera-analysis-updated';

export function notifyCameraAnalysisUpdated() {
  window.dispatchEvent(new CustomEvent(CAMERA_ANALYSIS_UPDATED_EVENT));
}

export const useCameraAnalysis = () => {
  const [analysisResults, setAnalysisResults] = useState<Record<string, ImageAnalysis[]>>({});
  const [isLoading, setIsLoading] = useState(true);

  const loadAnalysis = useCallback(async () => {
    cleanupObsoleteLocalStorageCaches();

    const isClearedLocal = localStorage.getItem('tozan_weather_analysis_cleared') === 'true';
    let localData: Record<string, ImageAnalysis[]> = {};
    try {
      const cached = localStorage.getItem('tozan_weather_analysis_cache');
      if (cached) localData = JSON.parse(cached);
    } catch {}

    // 1. まずローカルデータがあれば即時反映
    if (Object.keys(localData).length > 0) {
      setAnalysisResults(localData);
    }

    // 2. 静的JSON と Cloud Firestore を並列ロードしてマージ
    const [staticData, cloudPayload] = await Promise.all([
      isClearedLocal
        ? Promise.resolve({} as Record<string, ImageAnalysis[]>)
        : fetch(`/cams/analysis_results.json?t=${Date.now()}`)
            .then(r => (r.ok ? r.json() : {}))
            .catch(() => ({} as Record<string, ImageAnalysis[]>)),
      loadCameraAnalysisFromFirestore(),
    ]);

    const cloudRecords = (cloudPayload?.records as Record<string, ImageAnalysis[]>) || {};
    const merged: Record<string, ImageAnalysis[]> = cloudPayload?.cleared
      ? { ...cloudRecords, ...localData }
      : { ...staticData, ...cloudRecords, ...localData };

    setAnalysisResults(merged);
    setIsLoading(false);

    // クラウドから取得した最新データをローカルキャッシュにも同期しておく
    if (Object.keys(merged).length > 0) {
      try {
        localStorage.setItem('tozan_weather_analysis_cache', JSON.stringify(merged));
      } catch {}
    }
  }, []);

  useEffect(() => {
    loadAnalysis();
    const handleUpdate = () => {
      try {
        const cached = localStorage.getItem('tozan_weather_analysis_cache');
        if (cached) {
          setAnalysisResults(JSON.parse(cached));
        } else if (localStorage.getItem('tozan_weather_analysis_cleared') === 'true') {
          setAnalysisResults({});
        }
      } catch {}
    };
    window.addEventListener(CAMERA_ANALYSIS_UPDATED_EVENT, handleUpdate);
    window.addEventListener('storage', handleUpdate);
    return () => {
      window.removeEventListener(CAMERA_ANALYSIS_UPDATED_EVENT, handleUpdate);
      window.removeEventListener('storage', handleUpdate);
    };
  }, [loadAnalysis]);

  return { analysisResults, isLoading, reloadAnalysis: loadAnalysis };
};
