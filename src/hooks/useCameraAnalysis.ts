import { useState, useEffect, useCallback } from 'react';
import {
  saveCameraAnalysisToFirestore,
  loadCameraAnalysisFromFirestore,
} from '../utils/firebaseStorage';

export type CameraId = 'oshidomari' | 'ferry' | 'himenuma' | 'kutsugata' | 'otadomari' | 'senposhi';
export type SeasonMode = 'summer' | 'winter_bc';
export type BcFieldStatus = 'alpine_clear' | 'mid_mountain_ok' | 'treeline_only' | 'whiteout';
export type SnowLineStatus = 'none' | 'summit_cap' | 'mid_slope' | 'full_snow';

export interface ImageAnalysis {
  fileName: string;
  is_sunny: boolean;
  summit_visible?: boolean;
  cloud_cover: number;
  visibility: 'clear' | 'cloudy' | 'foggy' | 'missing' | 'camera_error';
  visible_elevation_m?: number; // 1700 | 1000 | 500 | 0
  bc_field_status?: BcFieldStatus;
  snow_line?: SnowLineStatus;
  reason: string;
  status?: string;
}

/**
 * AIカメラ解析結果が統計・視界集計の母数として有効かどうかを判定する。
 * (未取得 missing や 暗転/カメラ故障 camera_error は母数から除外する)
 */
export function isValidCameraAnalysis(c?: ImageAnalysis | null): boolean {
  if (!c) return false;
  return (
    c.status !== 'missing' &&
    c.status !== 'camera_error' &&
    c.visibility !== 'missing' &&
    c.visibility !== 'camera_error' &&
    typeof c.cloud_cover === 'number' &&
    c.cloud_cover >= 0
  );
}

export interface DailyCameraSummary {
  seasonMode: SeasonMode;
  mountainCategory: 'clear' | 'cloudy' | 'foggy' | 'unknown';
  clearCount: number;
  cloudyCount: number;
  foggyCount: number;
  sunnyCount: number;
  sunnyRatio: number;
  validCount: number;
  avgCloudCover: number | null;
  morningClearAfternoonFoggy: boolean;
  byCamera: Record<CameraId, 'clear' | 'cloudy' | 'foggy' | 'unknown'>;
  // 標高別視界・冬山BC拡張サマリー
  maxVisibleElevationM: number | null;
  avgVisibleElevationM: number | null;
  coreTimeElevationM: number | null; // 09〜13時コアタイムの最高視界高度
  dominantBcStatus: BcFieldStatus | 'unknown';
  dominantSnowLine: SnowLineStatus;
  byCameraElevation: Record<CameraId, number | null>;
  eastAspectEstimatedElevationM: number | null; // 東面（アフトロマナイ沢）推定視界高度
}

/**
 * 日付文字列 (YYYY-MM-DD) から季節分析モードを判定する
 * - 5月〜10月: 'summer' (🏔️ 夏山・観光分析モード)
 * - 11月〜4月: 'winter_bc' (🎿 冬山・BC分析モード)
 */
export function getSeasonModeForDate(dateStr?: string): SeasonMode {
  if (!dateStr) return 'summer';
  const parts = dateStr.split('-');
  const month = parseInt(parts[1] || '7', 10);
  if ([11, 12, 1, 2, 3, 4].includes(month)) {
    return 'winter_bc';
  }
  return 'summer';
}

/**
 * 季節・月ごとの目的に合わせたAI解析対象時間帯（2時間おき）を返す
 * - 5〜8月（極昼・盛夏期）: 03, 05, 07, 09, 11, 13, 15, 17, 19 (9回) ※2026-10-28以前の過去日は05〜17
 * - 9〜10月（秋山・紅葉期）: 05, 07, 09, 11, 13, 15, 17 (7回)
 * - 11〜2月（初冬・厳冬BC期）: 07, 09, 11, 13, 15 (5回: 暗闇ノイズを除外しBC行動帯に集中)
 * - 3〜4月（春山・残雪BC期）: 05, 07, 09, 11, 13, 15, 17 (7回)
 */
export function getTargetHoursForDate(dateStr?: string): string[] {
  if (!dateStr) return ['05', '07', '09', '11', '13', '15', '17'];
  // 2026-10-28より前の既存アーカイブ期間は05〜17時の7スロット記録
  if (dateStr < '2026-10-28') {
    return ['05', '07', '09', '11', '13', '15', '17'];
  }
  const month = parseInt(dateStr.split('-')[1] || '10', 10);
  if ([5, 6, 7, 8].includes(month)) {
    return ['03', '05', '07', '09', '11', '13', '15', '17', '19'];
  }
  if ([11, 12, 1, 2].includes(month)) {
    return ['07', '09', '11', '13', '15'];
  }
  return ['05', '07', '09', '11', '13', '15', '17'];
}

/**
 * 1枚の解析結果から「推定視界高度 (0/500/1000/1700m)」「BCフィールド判定」「冠雪ライン」を取得する
 * （過去の解析済みデータに対しても、視界・理由テキストから後方互換で自動推定する）
 */
export function getEffectiveElevation(cam: ImageAnalysis): {
  elevationM: number;
  bcStatus: BcFieldStatus;
  snowLine: SnowLineStatus;
} {
  let elevationM = cam.visible_elevation_m;
  let bcStatus = cam.bc_field_status;

  if (typeof elevationM !== 'number' || !bcStatus) {
    if (cam.visibility === 'clear' && cam.summit_visible !== false) {
      elevationM = 1700;
      bcStatus = 'alpine_clear';
    } else if (cam.visibility === 'cloudy') {
      const r = cam.reason || '';
      if (r.includes('山麓のみ') || r.includes('裾野のみ') || r.includes('下部のみ')) {
        elevationM = 500;
        bcStatus = 'treeline_only';
      } else {
        elevationM = 1000;
        bcStatus = 'mid_mountain_ok';
      }
    } else {
      const r = cam.reason || '';
      if (r.includes('裾野') || r.includes('山麓') || r.includes('森林帯')) {
        elevationM = 500;
        bcStatus = 'treeline_only';
      } else {
        elevationM = 0;
        bcStatus = 'whiteout';
      }
    }
  }

  let snowLine: SnowLineStatus = cam.snow_line || 'none';
  if (!cam.snow_line && cam.reason) {
    if (cam.reason.includes('全面積雪') || cam.reason.includes('山麓まで雪')) {
      snowLine = 'full_snow';
    } else if (cam.reason.includes('中腹まで雪') || cam.reason.includes('中腹まで冠雪')) {
      snowLine = 'mid_slope';
    } else if (cam.reason.includes('冠雪') || cam.reason.includes('雪化粧') || cam.reason.includes('積雪')) {
      snowLine = 'summit_cap';
    }
  }

  return { elevationM, bcStatus, snowLine };
}

/**
 * 標高数値 (0〜1700m) から BCフィールドランクへ変換するヘルパー
 */
export function elevationToBcStatus(elevM: number | null): BcFieldStatus | 'unknown' {
  if (elevM === null || elevM < 0) return 'unknown';
  if (elevM >= 1500) return 'alpine_clear';
  if (elevM >= 800) return 'mid_mountain_ok';
  if (elevM >= 300) return 'treeline_only';
  return 'whiteout';
}

/**
 * カメラが存在しない「東面（アフトロマナイ沢方面）」の視界高度を
 * 南東（オタドマリ沼＝ヤムナイ沢）と北東（姫沼＝オチュウシナイ沢／冬季休止時はフェリー・本泊）から推定する
 */
export function estimateEastAspectElevation(
  byCamElev: Record<CameraId, number | null>,
  windDirectionDeg?: number
): { elevationM: number | null; bcStatus: BcFieldStatus | 'unknown'; note: string } {
  const seElev = byCamElev.otadomari;
  const neElev =
    byCamElev.himenuma !== null
      ? byCamElev.himenuma
      : byCamElev.ferry !== null
      ? byCamElev.ferry
      : byCamElev.oshidomari;

  const candidates = [seElev, neElev].filter((v): v is number => v !== null);
  if (candidates.length === 0) {
    return { elevationM: null, bcStatus: 'unknown', note: '周辺カメラ記録なし' };
  }

  // 西〜北西風 (240°〜330°) の時は東面（アフトロマナイ沢）が風下リーサイドになるため、南東・北東の良好側を採用
  const isWestNorthwestWind =
    typeof windDirectionDeg === 'number' && windDirectionDeg >= 240 && windDirectionDeg <= 330;

  let rawElev: number;
  if (candidates.length === 2) {
    rawElev = isWestNorthwestWind
      ? Math.max(candidates[0], candidates[1])
      : Math.round((candidates[0] + candidates[1]) / 2);
  } else {
    rawElev = candidates[0];
  }

  // 4段階 (1700 / 1000 / 500 / 0) に丸める
  const snapped = rawElev >= 1450 ? 1700 : rawElev >= 750 ? 1000 : rawElev >= 250 ? 500 : 0;
  const note =
    byCamElev.himenuma !== null
      ? '北東(姫沼・オチュウシナイ沢)＋南東(オタドマリ・ヤムナイ沢)から算出'
      : '北(鴛泊港)＋南東(オタドマリ・ヤムナイ沢)から補完算出';

  return {
    elevationM: snapped,
    bcStatus: elevationToBcStatus(snapped),
    note,
  };
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

const LOCAL_CACHE_KEY = 'tozan_weather_analysis_cache';
const LOCAL_CLEARED_KEY = 'tozan_weather_analysis_cleared';
const MAX_LOCAL_CACHED_DAYS = 45;

/**
 * localStorage 5MB上限を圧迫しないよう、直近 MAX_LOCAL_CACHED_DAYS 日分に絞ってキャッシュ保存する
 */
function saveCameraAnalysisToLocalCache(map: Record<string, ImageAnalysis[]>, isCleared = false): void {
  try {
    if (isCleared) {
      localStorage.removeItem(LOCAL_CACHE_KEY);
      localStorage.setItem(LOCAL_CLEARED_KEY, 'true');
      return;
    }
    localStorage.setItem(LOCAL_CLEARED_KEY, 'false');
    const sortedDates = Object.keys(map).sort();
    const trimToDays = (days: number) => {
      const targetDates = sortedDates.slice(-days);
      const trimmed: Record<string, ImageAnalysis[]> = {};
      for (const d of targetDates) {
        trimmed[d] = map[d];
      }
      return JSON.stringify(trimmed);
    };

    try {
      localStorage.setItem(LOCAL_CACHE_KEY, trimToDays(MAX_LOCAL_CACHED_DAYS));
    } catch {
      cleanupObsoleteLocalStorageCaches();
      try {
        localStorage.setItem(LOCAL_CACHE_KEY, trimToDays(20));
      } catch (e2) {
        console.warn('localStorage保存スキップ（Cloud Firestoreへ保存します）:', e2);
      }
    }
  } catch (e) {
    console.warn('localStorage cache warning:', e);
  }
}

let sharedAnalysisResults: Record<string, ImageAnalysis[]> = {};
let hasCompletedCloudLoad = false;
let inFlightLoadPromise: Promise<Record<string, ImageAnalysis[]>> | null = null;

/**
 * カメラAI解析データを インメモリ共有キャッシュ・localStorage・Cloud Firestore のすべてに反映する共通関数
 */
export async function persistCameraAnalysisResults(
  updatedMap: Record<string, ImageAnalysis[]>,
  isCleared = false
): Promise<boolean> {
  cleanupObsoleteLocalStorageCaches();
  sharedAnalysisResults = updatedMap;
  hasCompletedCloudLoad = true;
  saveCameraAnalysisToLocalCache(updatedMap, isCleared);
  notifyCameraAnalysisUpdated();

  const cloudOk = await saveCameraAnalysisToFirestore(updatedMap);
  return cloudOk;
}

/**
 * 1日分のカメラAI解析配列から、
 * その日の山頂視界・雲量・日差し・標高別視界上限（BC視界）・東面推定を厳密に評価する共通関数
 */
export function evaluateDailyCameraVisibility(
  camData?: ImageAnalysis[],
  dateStr?: string,
  windDirectionDeg?: number
): DailyCameraSummary {
  const seasonMode = getSeasonModeForDate(dateStr);
  const defaultByCam: DailyCameraSummary['byCamera'] = {
    oshidomari: 'unknown',
    ferry: 'unknown',
    himenuma: 'unknown',
    kutsugata: 'unknown',
    otadomari: 'unknown',
    senposhi: 'unknown',
  };
  const defaultByCamElev: DailyCameraSummary['byCameraElevation'] = {
    oshidomari: null,
    ferry: null,
    himenuma: null,
    kutsugata: null,
    otadomari: null,
    senposhi: null,
  };

  if (!camData || camData.length === 0) {
    return {
      seasonMode,
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
      maxVisibleElevationM: null,
      avgVisibleElevationM: null,
      coreTimeElevationM: null,
      dominantBcStatus: 'unknown',
      dominantSnowLine: 'none',
      byCameraElevation: defaultByCamElev,
      eastAspectEstimatedElevationM: null,
    };
  }

  const validCams = camData.filter(isValidCameraAnalysis);
  if (validCams.length === 0) {
    return {
      seasonMode,
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
      maxVisibleElevationM: null,
      avgVisibleElevationM: null,
      coreTimeElevationM: null,
      dominantBcStatus: 'unknown',
      dominantSnowLine: 'none',
      byCameraElevation: defaultByCamElev,
      eastAspectEstimatedElevationM: null,
    };
  }

  const cams: CameraId[] = ['oshidomari', 'ferry', 'himenuma', 'kutsugata', 'otadomari', 'senposhi'];
  const byCamera: DailyCameraSummary['byCamera'] = { ...defaultByCam };
  const byCameraElevation: DailyCameraSummary['byCameraElevation'] = { ...defaultByCamElev };

  cams.forEach(cam => {
    const cData = validCams.filter(c => c.fileName.includes(`_${cam}.jpg`));
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

    // カメラごとの日中の代表的な視界高度（上位平均または最高到達視界高度）
    const elevs = cData.map(c => getEffectiveElevation(c).elevationM).sort((a, b) => b - a);
    // 上位半分の平均をその斜面の有効視界高度とし、4段階にスナップ
    const topHalf = elevs.slice(0, Math.max(1, Math.ceil(elevs.length / 2)));
    const avgTop = topHalf.reduce((s, v) => s + v, 0) / topHalf.length;
    byCameraElevation[cam] = avgTop >= 1450 ? 1700 : avgTop >= 750 ? 1000 : avgTop >= 250 ? 500 : 0;
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

  // 標高視界・積雪ラインの集計
  const allElevInfos = validCams.map(c => getEffectiveElevation(c));
  const maxVisibleElevationM = Math.max(...allElevInfos.map(e => e.elevationM));
  const avgVisibleElevationM = Math.round(
    allElevInfos.reduce((s, e) => s + e.elevationM, 0) / allElevInfos.length
  );

  // コアタイム（09, 11, 13時）の視界高度
  const coreCams = validCams.filter(
    c => c.fileName.startsWith('09_') || c.fileName.startsWith('11_') || c.fileName.startsWith('13_')
  );
  const coreTimeElevationM =
    coreCams.length > 0
      ? Math.max(...coreCams.map(c => getEffectiveElevation(c).elevationM))
      : maxVisibleElevationM;

  const dominantBcStatus = elevationToBcStatus(coreTimeElevationM ?? maxVisibleElevationM);

  // 冠雪ラインの代表値
  const snowOrder: SnowLineStatus[] = ['full_snow', 'mid_slope', 'summit_cap', 'none'];
  let dominantSnowLine: SnowLineStatus = 'none';
  for (const s of snowOrder) {
    if (allElevInfos.some(e => e.snowLine === s)) {
      dominantSnowLine = s;
      break;
    }
  }

  const eastEst = estimateEastAspectElevation(byCameraElevation, windDirectionDeg);

  // 朝（03, 05, 07, 08, 09時）にclearがあり、昼〜午後（11, 13, 14, 15時）がほぼfoggy/cloudyに悪化した日を検知
  const morningCams = validCams.filter(
    c =>
      c.fileName.startsWith('03_') ||
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
    seasonMode,
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
    maxVisibleElevationM,
    avgVisibleElevationM,
    coreTimeElevationM,
    dominantBcStatus,
    dominantSnowLine,
    byCameraElevation,
    eastAspectEstimatedElevationM: eastEst.elevationM,
  };
}

export const CAMERA_ANALYSIS_UPDATED_EVENT = 'tozan-camera-analysis-updated';

export function notifyCameraAnalysisUpdated() {
  window.dispatchEvent(new CustomEvent(CAMERA_ANALYSIS_UPDATED_EVENT));
}

export const useCameraAnalysis = () => {
  const [analysisResults, setAnalysisResults] = useState<Record<string, ImageAnalysis[]>>(() => {
    if (Object.keys(sharedAnalysisResults).length > 0) {
      return sharedAnalysisResults;
    }
    try {
      const cached = localStorage.getItem(LOCAL_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached) as Record<string, ImageAnalysis[]>;
        sharedAnalysisResults = parsed;
        return parsed;
      }
    } catch {}
    return {};
  });
  const [isLoading, setIsLoading] = useState(!hasCompletedCloudLoad);

  const loadAnalysis = useCallback(async (forceRefresh = false) => {
    if (!forceRefresh && hasCompletedCloudLoad) {
      setAnalysisResults(sharedAnalysisResults);
      setIsLoading(false);
      return;
    }

    if (!forceRefresh && inFlightLoadPromise) {
      const result = await inFlightLoadPromise;
      setAnalysisResults(result);
      setIsLoading(false);
      return;
    }

    const fetchTask = (async (): Promise<Record<string, ImageAnalysis[]>> => {
      cleanupObsoleteLocalStorageCaches();

      const isClearedLocal = localStorage.getItem(LOCAL_CLEARED_KEY) === 'true';
      let localData: Record<string, ImageAnalysis[]> = {};
      try {
        const cached = localStorage.getItem(LOCAL_CACHE_KEY);
        if (cached) localData = JSON.parse(cached);
      } catch {}

      const [staticData, cloudPayload] = await Promise.all([
        isClearedLocal
          ? Promise.resolve({} as Record<string, ImageAnalysis[]>)
          : fetch(`/cams/analysis_results.json?t=${Date.now()}`)
              .then(r => (r.ok ? r.json() : {}))
              .catch(() => ({} as Record<string, ImageAnalysis[]>)),
        loadCameraAnalysisFromFirestore(),
      ]);

      const cloudRecords = (cloudPayload?.records as Record<string, ImageAnalysis[]>) || {};
      let merged: Record<string, ImageAnalysis[]>;

      if (cloudPayload?.cleared && Object.keys(cloudRecords).length === 0) {
        merged = {};
        saveCameraAnalysisToLocalCache({}, true);
      } else {
        // クラウド(Firestore)の最新結果を優先し、ローカルキャッシュが古い結果で上書きするのを防ぐ
        merged = cloudPayload?.cleared
          ? { ...localData, ...cloudRecords }
          : { ...staticData, ...localData, ...cloudRecords };
        if (Object.keys(merged).length > 0) {
          saveCameraAnalysisToLocalCache(merged, false);
        }
      }

      sharedAnalysisResults = merged;
      hasCompletedCloudLoad = true;
      return merged;
    })();

    inFlightLoadPromise = fetchTask;
    try {
      const merged = await fetchTask;
      setAnalysisResults(merged);
      setIsLoading(false);
    } finally {
      if (inFlightLoadPromise === fetchTask) {
        inFlightLoadPromise = null;
      }
    }
  }, []);

  useEffect(() => {
    void loadAnalysis(false);
    const handleInternalUpdate = () => {
      setAnalysisResults(sharedAnalysisResults);
    };
    const handleStorageUpdate = (e: StorageEvent) => {
      if (e.key !== LOCAL_CACHE_KEY && e.key !== LOCAL_CLEARED_KEY) return;
      try {
        if (localStorage.getItem(LOCAL_CLEARED_KEY) === 'true') {
          sharedAnalysisResults = {};
          setAnalysisResults({});
          return;
        }
        const cached = localStorage.getItem(LOCAL_CACHE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached) as Record<string, ImageAnalysis[]>;
          sharedAnalysisResults = parsed;
          setAnalysisResults(parsed);
        }
      } catch {}
    };
    window.addEventListener(CAMERA_ANALYSIS_UPDATED_EVENT, handleInternalUpdate);
    window.addEventListener('storage', handleStorageUpdate);
    return () => {
      window.removeEventListener(CAMERA_ANALYSIS_UPDATED_EVENT, handleInternalUpdate);
      window.removeEventListener('storage', handleStorageUpdate);
    };
  }, [loadAnalysis]);

  const reloadAnalysis = useCallback(() => loadAnalysis(true), [loadAnalysis]);

  return { analysisResults, isLoading, reloadAnalysis };
};
