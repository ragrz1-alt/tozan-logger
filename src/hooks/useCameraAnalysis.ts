import { useState, useEffect, useCallback } from 'react';

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
  validCount: number;
  avgCloudCover: number | null;
  morningClearAfternoonFoggy: boolean;
  byCamera: Record<'oshidomari' | 'kutsugata' | 'senposhi', 'clear' | 'cloudy' | 'foggy' | 'unknown'>;
}

/**
 * 1日分のカメラAI解析配列から、その日の山頂視界・雲量サマリーを厳密に評価する共通関数
 */
export function evaluateDailyCameraVisibility(camData?: ImageAnalysis[]): DailyCameraSummary {
  const defaultByCam = {
    oshidomari: 'unknown' as const,
    kutsugata: 'unknown' as const,
    senposhi: 'unknown' as const,
  };

  if (!camData || camData.length === 0) {
    return {
      mountainCategory: 'unknown',
      clearCount: 0,
      cloudyCount: 0,
      foggyCount: 0,
      validCount: 0,
      avgCloudCover: null,
      morningClearAfternoonFoggy: false,
      byCamera: defaultByCam,
    };
  }

  const validCams = camData.filter(c => c.status !== 'missing' && c.visibility !== 'missing' && c.cloud_cover >= 0);
  if (validCams.length === 0) {
    return {
      mountainCategory: 'unknown',
      clearCount: 0,
      cloudyCount: 0,
      foggyCount: 0,
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
    if (clear >= cData.length * 0.4) {
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

  const totalCloud = validCams.reduce((sum, c) => sum + (typeof c.cloud_cover === 'number' ? c.cloud_cover : 5), 0);
  const avgCloudCover = Math.round((totalCloud / validCams.length) * 10) / 10;

  // 朝（05時・08時）にclearがあり、昼〜午後（11時・14時）がほぼfoggy/cloudyに悪化した日を検知
  const morningCams = validCams.filter(c => c.fileName.startsWith('05_') || c.fileName.startsWith('08_'));
  const afternoonCams = validCams.filter(c => c.fileName.startsWith('11_') || c.fileName.startsWith('14_'));
  const morningHasClear = morningCams.some(c => c.visibility === 'clear' && c.summit_visible !== false);
  const afternoonAllBad = afternoonCams.length > 0 && afternoonCams.every(c => c.visibility === 'foggy' || (c.visibility === 'cloudy' && c.cloud_cover >= 8));
  const morningClearAfternoonFoggy = morningHasClear && afternoonAllBad;

  return {
    mountainCategory,
    clearCount,
    cloudyCount,
    foggyCount,
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

  const loadAnalysis = useCallback(() => {
    const isCleared = localStorage.getItem('tozan_weather_analysis_cleared') === 'true';
    const cached = localStorage.getItem('tozan_weather_analysis_cache');
    const localData: Record<string, ImageAnalysis[]> = cached ? JSON.parse(cached) : {};

    if (isCleared) {
      // クリアフラグが立っている場合はサーバーの古いJSONを無視し、新しく解析されたlocalDataのみを使用する
      setAnalysisResults(localData);
      setIsLoading(false);
      return;
    }

    fetch(`/cams/analysis_results.json?t=${Date.now()}`)
      .then(res => res.json())
      .then(data => {
        setAnalysisResults({ ...data, ...localData });
        setIsLoading(false);
      })
      .catch(err => {
        console.warn('サーバー側のカメラ解析結果が見つかりません。ローカルキャッシュのみ使用します。', err);
        setAnalysisResults(localData);
        setIsLoading(false);
      });
  }, []);

  useEffect(() => {
    loadAnalysis();
    const handleUpdate = () => loadAnalysis();
    window.addEventListener(CAMERA_ANALYSIS_UPDATED_EVENT, handleUpdate);
    window.addEventListener('storage', handleUpdate);
    return () => {
      window.removeEventListener(CAMERA_ANALYSIS_UPDATED_EVENT, handleUpdate);
      window.removeEventListener('storage', handleUpdate);
    };
  }, [loadAnalysis]);

  return { analysisResults, isLoading, reloadAnalysis: loadAnalysis };
};
