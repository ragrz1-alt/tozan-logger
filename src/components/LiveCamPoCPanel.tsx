import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Sun,
  RefreshCw,
  CheckCircle2,
  Play,
  Square,
  Eye,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
  Sparkles,
  VideoOff,
  Maximize2,
  X,
  Mountain,
  Snowflake,
  Clock,
} from 'lucide-react';
import {
  useCameraAnalysis,
  type ImageAnalysis,
  type SeasonMode,
  type BcFieldStatus,
  type SnowLineStatus,
  evaluateDailyCameraVisibility,
  persistCameraAnalysisResults,
  getSeasonModeForDate,
  getTargetHoursForDate,
  getEffectiveElevation,
  estimateEastAspectElevation,
  isValidCameraAnalysis,
} from '../hooks/useCameraAnalysis';
import { fetchWeatherData, type WeatherData } from '../utils/weatherApi';
import { getCamImageUrl } from '../utils/camUrl';
import {
  fetchCamHistory,
  partitionCamerasForDisplay,
  type CamHistory,
} from '../utils/cameraStatus';
import {
  CAMERA_LOCATIONS,
  getTodayJstStr,
  getWindDirString,
  getAvailableDatesFromHistory,
  isDayAnalyzedForDate,
  analyzeSingleDateWithAi,
} from '../utils/cameraAiClient';
import { InactiveCamerasNotice } from './InactiveCamerasNotice';
import { CameraAiAdminPanel } from './CameraAiAdminPanel';
import { CameraAiSummaryCards } from './CameraAiSummaryCards';
import { CameraAiMatrixTable } from './CameraAiMatrixTable';

export interface LiveCamPoCPanelProps {
  isAdmin?: boolean;
}

function getVisibilityBadge(vis: string, summitVisible?: boolean) {
  switch (vis) {
    case 'clear':
      return (
        <span style={{ backgroundColor: '#f59e0b', color: '#fff', padding: '0.16rem 0.48rem', borderRadius: '4px', fontSize: '0.73rem', fontWeight: 'bold' }}>
          ☀️ 山頂快晴
        </span>
      );
    case 'cloudy':
      return (
        <span style={{ backgroundColor: '#10b981', color: '#fff', padding: '0.16rem 0.48rem', borderRadius: '4px', fontSize: '0.73rem', fontWeight: 'bold' }}>
          ☁️ {summitVisible === false ? '山頂雲隠れ(中腹視認)' : '曇り'}
        </span>
      );
    case 'foggy':
      return (
        <span style={{ backgroundColor: '#cbd5e1', color: '#334155', padding: '0.16rem 0.48rem', borderRadius: '4px', fontSize: '0.73rem', fontWeight: 'bold' }}>
          🌫️ 山体ガス・不可視
        </span>
      );
    case 'missing':
      return (
        <span style={{ backgroundColor: 'rgba(148, 163, 184, 0.25)', color: 'var(--text-secondary)', padding: '0.16rem 0.48rem', borderRadius: '4px', fontSize: '0.71rem', fontWeight: 'bold' }}>
          未記録
        </span>
      );
    default:
      return null;
  }
}

function getElevationBadge(elevM: number, bcStatus: BcFieldStatus) {
  if (bcStatus === 'alpine_clear' || elevM >= 1500) {
    return (
      <span style={{ backgroundColor: 'rgba(245, 158, 11, 0.16)', color: '#d97706', border: '1px solid rgba(245, 158, 11, 0.4)', padding: '0.12rem 0.45rem', borderRadius: '4px', fontSize: '0.71rem', fontWeight: 700 }}>
        ☀️ 視界: 1700m (山頂まで快晴)
      </span>
    );
  }
  if (bcStatus === 'mid_mountain_ok' || elevM >= 800) {
    return (
      <span style={{ backgroundColor: 'rgba(16, 185, 129, 0.15)', color: '#059669', border: '1px solid rgba(16, 185, 129, 0.35)', padding: '0.12rem 0.45rem', borderRadius: '4px', fontSize: '0.71rem', fontWeight: 700 }}>
        🎿 視界: 約1000m (中腹バーン◯)
      </span>
    );
  }
  if (bcStatus === 'treeline_only' || elevM >= 300) {
    return (
      <span style={{ backgroundColor: 'rgba(59, 130, 246, 0.14)', color: '#2563eb', border: '1px solid rgba(59, 130, 246, 0.35)', padding: '0.12rem 0.45rem', borderRadius: '4px', fontSize: '0.71rem', fontWeight: 700 }}>
        🌲 視界: 約500m (森林帯のみ)
      </span>
    );
  }
  return (
    <span style={{ backgroundColor: 'rgba(148, 163, 184, 0.18)', color: 'var(--text-secondary)', padding: '0.12rem 0.45rem', borderRadius: '4px', fontSize: '0.71rem', fontWeight: 700 }}>
      🚫 視界: 0m (不可視)
    </span>
  );
}

function getSnowLineBadge(snowLine: SnowLineStatus) {
  if (snowLine === 'none') return null;
  const map: Record<Exclude<SnowLineStatus, 'none'>, { label: string; color: string; bg: string }> = {
    summit_cap: { label: '❄️ 山頂部冠雪', color: '#0284c7', bg: 'rgba(2, 132, 199, 0.12)' },
    mid_slope: { label: '❄️ 中腹まで積雪', color: '#2563eb', bg: 'rgba(37, 99, 235, 0.12)' },
    full_snow: { label: '⛄ 山麓まで全面積雪', color: '#4f46e5', bg: 'rgba(79, 70, 229, 0.12)' },
  };
  const item = map[snowLine];
  return (
    <span style={{ backgroundColor: item.bg, color: item.color, padding: '0.12rem 0.45rem', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 700 }}>
      {item.label}
    </span>
  );
}

export const LiveCamPoCPanel: React.FC<LiveCamPoCPanelProps> = ({ isAdmin = false }) => {
  // 共通フックから解析結果を取得（App.tsx と重複通信しない）
  const { analysisResults } = useCameraAnalysis();
  const analysisResultsRef = useRef<Record<string, ImageAnalysis[]>>(analysisResults);
  useEffect(() => {
    analysisResultsRef.current = analysisResults;
  }, [analysisResults]);

  const [camHistory, setCamHistory] = useState<CamHistory | null>(null);
  const historyRecords = useMemo(() => camHistory?.records || {}, [camHistory]);
  const availableDates = useMemo(() => getAvailableDatesFromHistory(camHistory), [camHistory]);

  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const today = getTodayJstStr();
    return today >= '2026-07-28' ? today : '2026-10-22';
  });
  const [selectedHourFilter, setSelectedHourFilter] = useState<string>('11');

  const autoSeasonMode = useMemo(() => getSeasonModeForDate(selectedDate), [selectedDate]);
  const [overrideSeasonMode, setOverrideSeasonMode] = useState<SeasonMode | null>(null);
  const activeSeasonMode: SeasonMode = overrideSeasonMode || autoSeasonMode;

  useEffect(() => {
    setOverrideSeasonMode(null);
  }, [selectedDate]);

  // 管理者パネル用ステート
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [rangeStart, setRangeStart] = useState('2026-10-01');
  const [rangeEnd, setRangeEnd] = useState(() => {
    const today = getTodayJstStr();
    return today >= '2026-07-28' ? today : '2026-10-22';
  });
  const [overwriteExisting, setOverwriteExisting] = useState(false);
  const [selectedModel, setSelectedModel] = useState('gemini-3.5-flash-lite');

  const [weatherMap, setWeatherMap] = useState<Record<string, WeatherData>>({});
  const [isLoadingWeather, setIsLoadingWeather] = useState(false);

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSyncingCloud, setIsSyncingCloud] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{
    current: number;
    total: number;
    currentDate: string;
    activeModel: string;
  } | null>(null);
  const stopRequestedRef = useRef(false);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({});
  const [modalImage, setModalImage] = useState<{ url: string; title: string; sub?: string } | null>(null);

  // history.json を取得して実記録日ベースで日付範囲を更新
  useEffect(() => {
    const syncLatestHistory = async () => {
      const data = await fetchCamHistory();
      if (!data) return;
      setCamHistory(data);
      const dates = getAvailableDatesFromHistory(data);
      if (dates.length > 0) {
        const latestRecorded = dates[dates.length - 1];
        setSelectedDate(latestRecorded);
        setRangeEnd(latestRecorded);
        setRangeStart(prev => (dates[0] > prev ? dates[0] : prev));
      }
    };
    void syncLatestHistory();
  }, []);

  // 気象データ取得
  const firstAvailableDate = availableDates[0] || '2026-07-28';
  const lastAvailableDate = availableDates[availableDates.length - 1] || getTodayJstStr();
  useEffect(() => {
    const loadW = async () => {
      setIsLoadingWeather(true);
      try {
        const w = await fetchWeatherData(0, 0, firstAvailableDate, lastAvailableDate);
        setWeatherMap(w);
      } catch (e) {
        console.warn('Weather load error:', e);
      } finally {
        setIsLoadingWeather(false);
      }
    };
    void loadW();
  }, [firstAvailableDate, lastAvailableDate]);

  // ストレージ使用量概算（管理者パネル表示用）
  const storageStats = useMemo(() => {
    let totalPhotos = 0;
    Object.values(historyRecords).forEach(hrs => {
      Object.values(hrs || {}).forEach(hrObj => {
        if (hrObj && typeof hrObj === 'object') {
          totalPhotos += Object.keys(hrObj).filter(k => k !== 'timestamp').length;
        }
      });
    });
    const estMB = Math.round(((totalPhotos * 38) / 1024) * 10) / 10;
    const limitMB = 1000;
    const ratio = Math.min(100, Math.round((estMB / limitMB) * 100));
    return { totalPhotos, estMB, limitMB, ratio };
  }, [historyRecords]);

  // 対象日・時間帯に有効なカメラ仕分け
  const getLocationsPartitionForDate = useCallback(
    (dateStr: string, hourStr?: string) => {
      const dayRec = historyRecords[dateStr] || {};
      const recordedCamIds = new Set<string>();
      if (hourStr) {
        const hrObj = dayRec[hourStr] || {};
        Object.keys(hrObj).forEach(k => {
          if (k !== 'timestamp') recordedCamIds.add(k);
        });
      } else {
        Object.values(dayRec).forEach(hrObj => {
          if (hrObj && typeof hrObj === 'object') {
            Object.keys(hrObj).forEach(k => {
              if (k !== 'timestamp') recordedCamIds.add(k);
            });
          }
        });
      }
      const dayAnalysis = analysisResults[dateStr] || [];
      dayAnalysis.forEach(a => {
        if (isValidCameraAnalysis(a) && (!hourStr || a.fileName.startsWith(`${hourStr}_`))) {
          CAMERA_LOCATIONS.forEach(l => {
            if (a.fileName.includes(`_${l.id}.jpg`)) recordedCamIds.add(l.id);
          });
        }
      });

      return partitionCamerasForDisplay(CAMERA_LOCATIONS, {
        dateStr,
        history: camHistory,
        recordedCamIds,
        selectedHour: hourStr,
      });
    },
    [historyRecords, analysisResults, camHistory]
  );

  const { visible: activeLocationsForSelectedDate, inactive: inactiveLocationsForSelectedDate } = useMemo(
    () => getLocationsPartitionForDate(selectedDate, undefined),
    [selectedDate, getLocationsPartitionForDate]
  );

  // 選択日の表示対象時間帯（実記録がある時間＋解析対象時間）
  const activeTimesForSelectedDate = useMemo(() => {
    const baseTimes = getTargetHoursForDate(selectedDate);
    const dayRes = analysisResults[selectedDate] || [];
    const dayRec = historyRecords[selectedDate] || {};
    const existingHours = new Set<string>(baseTimes);
    dayRes.forEach(r => {
      if (r.status === 'ok' && r.fileName.length >= 2) {
        existingHours.add(r.fileName.slice(0, 2));
      }
    });
    const todayStr = getTodayJstStr();
    const currentJstHour = new Date(Date.now() + 9 * 3600 * 1000).getUTCHours();
    return Array.from(existingHours)
      .filter(hr => !(selectedDate === todayStr && parseInt(hr, 10) > currentJstHour && !dayRec[hr]))
      .sort();
  }, [selectedDate, analysisResults, historyRecords]);

  // 日付切替時はデフォルトで見やすい日中スロット（11→09→13→15→先頭）を選択
  useEffect(() => {
    if (activeTimesForSelectedDate.length === 0) return;
    if (selectedHourFilter === 'all' || activeTimesForSelectedDate.includes(selectedHourFilter)) {
      return;
    }
    const dayRec = historyRecords[selectedDate] || {};
    const preferred = ['11', '09', '13', '15', '07', '17'];
    const best =
      preferred.find(h => activeTimesForSelectedDate.includes(h) && dayRec[h]) ||
      preferred.find(h => activeTimesForSelectedDate.includes(h)) ||
      activeTimesForSelectedDate[0];
    setSelectedHourFilter(best);
  }, [selectedDate, activeTimesForSelectedDate, historyRecords, selectedHourFilter]);

  const displayedTimes = useMemo(() => {
    if (selectedHourFilter === 'all') return activeTimesForSelectedDate;
    return activeTimesForSelectedDate.includes(selectedHourFilter)
      ? [selectedHourFilter]
      : activeTimesForSelectedDate.slice(0, 1);
  }, [activeTimesForSelectedDate, selectedHourFilter]);

  const currentWeather = weatherMap[selectedDate];
  const currentResults = analysisResults[selectedDate];
  const dailySummary = useMemo(
    () => evaluateDailyCameraVisibility(currentResults, selectedDate, currentWeather?.windDirection),
    [currentResults, selectedDate, currentWeather?.windDirection]
  );
  const eastEstimate = useMemo(
    () => estimateEastAspectElevation(dailySummary.byCameraElevation, currentWeather?.windDirection),
    [dailySummary.byCameraElevation, currentWeather?.windDirection]
  );

  const timePhaseSummary = useMemo(() => {
    const valid = (currentResults || []).filter(isValidCameraAnalysis);
    const evalGroup = (hours: string[]) => {
      const items = valid.filter(c => hours.some(h => c.fileName.startsWith(`${h}_`)));
      if (items.length === 0) return { label: '記録なし', maxElev: null as number | null, hasClear: false };
      const hasClear = items.some(c => c.visibility === 'clear' && c.summit_visible !== false);
      const maxElev = Math.max(...items.map(c => getEffectiveElevation(c).elevationM));
      if (hasClear || maxElev >= 1700) return { label: '🏔️ 山頂快晴 (1700m)', maxElev: 1700, hasClear: true };
      if (maxElev >= 1000) return { label: '🎿 中腹視界◯ (1000m)', maxElev: 1000, hasClear: false };
      if (maxElev >= 500) return { label: '🌲 山麓・樹林帯のみ (500m)', maxElev: 500, hasClear: false };
      return { label: '🌫️ ガス・不可視 (0m)', maxElev: 0, hasClear: false };
    };
    return {
      earlyMorning: evalGroup(['03', '05', '07']),
      coreMidday: evalGroup(['09', '11', '13']),
      afternoonEvening: evalGroup(['15', '17', '19']),
    };
  }, [currentResults]);

  const unanalyzedDates = useMemo(() => {
    return availableDates.filter(d => !isDayAnalyzedForDate(analysisResults[d], d, camHistory));
  }, [availableDates, analysisResults, camHistory]);

  const analyzedDaysCount = availableDates.length - unanalyzedDates.length;
  const unanalyzedRangeLabel = useMemo(() => {
    if (unanalyzedDates.length === 0) return '';
    const first = unanalyzedDates[0].slice(5).replace('-', '/');
    const last = unanalyzedDates[unanalyzedDates.length - 1].slice(5).replace('-', '/');
    return first === last ? first : `${first}〜${last}`;
  }, [unanalyzedDates]);

  const currentIdx = availableDates.indexOf(selectedDate);
  const prevDate = currentIdx > 0 ? availableDates[currentIdx - 1] : null;
  const nextDate = currentIdx >= 0 && currentIdx < availableDates.length - 1 ? availableDates[currentIdx + 1] : null;

  const isCurrentDayAnalyzed = isDayAnalyzedForDate(currentResults, selectedDate, camHistory);

  const saveDateResults = async (dateStr: string, dateResults: ImageAnalysis[]): Promise<boolean> => {
    const updated = { ...analysisResultsRef.current, [dateStr]: dateResults };
    analysisResultsRef.current = updated;
    setIsSyncingCloud(true);
    try {
      return await persistCameraAnalysisResults(updated, false);
    } finally {
      setIsSyncingCloud(false);
    }
  };

  const runSingleDayAnalysis = async () => {
    setIsAnalyzing(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const { results, usedModel } = await analyzeSingleDateWithAi(selectedDate, {
        history: camHistory,
        preferredModel: selectedModel,
      });
      const cloudOk = await saveDateResults(selectedDate, results);
      setStatusMsg(
        `✅ ${selectedDate} のAI解析（有効画像 ${results.filter(r => r.status === 'ok').length}枚）が完了し、${
          cloudOk ? 'クラウド(Firestore)へ保存しました！' : 'ローカルへ保存しました。'
        }（モデル: ${usedModel}）`
      );
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsAnalyzing(false);
    }
  };

  const executeBatchList = async (targetList: string[]) => {
    if (targetList.length === 0) {
      setStatusMsg('対象となる未解析の日付はありません。');
      return;
    }

    setIsAnalyzing(true);
    stopRequestedRef.current = false;
    setErrorMsg(null);
    setStatusMsg(null);
    let completedCount = 0;

    try {
      for (let i = 0; i < targetList.length; i++) {
        if (stopRequestedRef.current) {
          setStatusMsg(`⏸️ 一括解析を中断しました。（${completedCount} / ${targetList.length} 日完了・保存済）`);
          break;
        }
        const dateStr = targetList[i];
        setSelectedDate(dateStr);
        setBatchProgress({
          current: i + 1,
          total: targetList.length,
          currentDate: dateStr,
          activeModel: selectedModel,
        });

        const { results, usedModel } = await analyzeSingleDateWithAi(dateStr, {
          history: camHistory,
          preferredModel: selectedModel,
        });
        await saveDateResults(dateStr, results);
        completedCount++;

        setBatchProgress({
          current: i + 1,
          total: targetList.length,
          currentDate: dateStr,
          activeModel: usedModel,
        });

        if (i < targetList.length - 1 && !stopRequestedRef.current) {
          await new Promise(r => setTimeout(r, 4200));
        }
      }

      if (!stopRequestedRef.current) {
        setStatusMsg(`🎉 ${completedCount}日分の一括AI解析が完了し、クラウドへ自動保存されました！`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(`一括解析中にエラーが発生しました (${completedCount}日完了時点・完了分は保存済): ${msg}`);
    } finally {
      setIsAnalyzing(false);
      setBatchProgress(null);
      stopRequestedRef.current = false;
    }
  };

  const runCustomRangeBatch = () => {
    if (rangeStart > rangeEnd) {
      setErrorMsg('開始日は終了日以前の日付を指定してください。');
      return;
    }
    const candidates = availableDates.filter(d => d >= rangeStart && d <= rangeEnd);
    const targetList = overwriteExisting
      ? candidates
      : candidates.filter(d => !isDayAnalyzedForDate(analysisResultsRef.current[d], d, camHistory));

    if (targetList.length === 0) {
      setStatusMsg('指定範囲内の日付はすべて解析済みです。');
      return;
    }
    void executeBatchList(targetList);
  };

  const handleClearAllAnalysis = async () => {
    if (!window.confirm('現在保持しているすべての雲量・視界解析データ（クラウド保存分含む）を初期化しますか？')) {
      return;
    }
    analysisResultsRef.current = {};
    setIsSyncingCloud(true);
    await persistCameraAnalysisResults({}, true);
    setIsSyncingCloud(false);
    setStatusMsg('🗑️ 既存の雲量解析データをクラウド・ローカルともにすべてクリアしました。');
  };

  const handleExportJson = () => {
    const dataStr = JSON.stringify(analysisResults, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'analysis_results.json';
    a.click();
    URL.revokeObjectURL(url);
    setStatusMsg('💾 バックアップ用 analysis_results.json をダウンロードしました。');
  };

  return (
    <div className="card" style={{ borderTop: '4px solid #3b82f6', marginBottom: '2rem' }}>
      {/* ===== 1. シンプルなヘッダー ＆ 季節モード切替 ===== */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
          marginBottom: '1.25rem',
          paddingBottom: '1rem',
          borderBottom: '1px solid var(--border-color)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div
            style={{
              background:
                activeSeasonMode === 'winter_bc'
                  ? 'linear-gradient(135deg, #2563eb, #8b5cf6)'
                  : 'linear-gradient(135deg, #3b82f6, #10b981)',
              color: '#fff',
              padding: '0.55rem',
              borderRadius: '0.65rem',
              display: 'flex',
            }}
          >
            <Sparkles size={22} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <h3 style={{ fontSize: '1.3rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                🏔️ 利尻山 山頂視界・雲量AI解析アーカイブ
              </h3>
              <span
                style={{
                  fontSize: '0.76rem',
                  fontWeight: 700,
                  padding: '0.2rem 0.65rem',
                  borderRadius: '999px',
                  backgroundColor: 'rgba(16, 185, 129, 0.15)',
                  color: '#10b981',
                }}
              >
                解析済: {analyzedDaysCount} / {availableDates.length}日
              </span>
            </div>
            <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
              {activeSeasonMode === 'winter_bc'
                ? '🎿 冬山・BC分析モード（11〜4月）：標高別視界（0〜1700m）・東面推定・積雪ラインを評価'
                : '🏔️ 夏山・観光分析モード（5〜10月）：山頂（1,721m）露出・雲量・時間帯推移を評価'}
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          <div
            style={{
              display: 'inline-flex',
              backgroundColor: 'var(--bg-secondary)',
              padding: '0.2rem',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
              gap: '0.2rem',
            }}
          >
            <button
              onClick={() => setOverrideSeasonMode('summer')}
              style={{
                padding: '0.32rem 0.65rem',
                borderRadius: '6px',
                border: 'none',
                fontSize: '0.78rem',
                fontWeight: 700,
                cursor: 'pointer',
                backgroundColor: activeSeasonMode === 'summer' ? '#10b981' : 'transparent',
                color: activeSeasonMode === 'summer' ? '#fff' : 'var(--text-secondary)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.3rem',
              }}
            >
              <Mountain size={13} />
              <span>夏山 (5-10月)</span>
            </button>
            <button
              onClick={() => setOverrideSeasonMode('winter_bc')}
              style={{
                padding: '0.32rem 0.65rem',
                borderRadius: '6px',
                border: 'none',
                fontSize: '0.78rem',
                fontWeight: 700,
                cursor: 'pointer',
                backgroundColor: activeSeasonMode === 'winter_bc' ? '#2563eb' : 'transparent',
                color: activeSeasonMode === 'winter_bc' ? '#fff' : 'var(--text-secondary)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.3rem',
              }}
            >
              <Snowflake size={13} />
              <span>冬山・BC (11-4月)</span>
            </button>
          </div>

          {isAdmin && (
            <>
              {!isAnalyzing ? (
                unanalyzedDates.length > 0 ? (
                  <button
                    onClick={() => executeBatchList(unanalyzedDates)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.45rem',
                      padding: '0.52rem 1rem',
                      borderRadius: '10px',
                      border: 'none',
                      background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                      color: '#fff',
                      fontWeight: 800,
                      fontSize: '0.82rem',
                      cursor: 'pointer',
                      boxShadow: '0 4px 12px rgba(59, 130, 246, 0.35)',
                    }}
                  >
                    <Play size={15} />
                    <span>未解析をまとめて解析 ({unanalyzedRangeLabel}・{unanalyzedDates.length}日)</span>
                  </button>
                ) : (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      padding: '0.45rem 0.85rem',
                      borderRadius: '10px',
                      backgroundColor: 'rgba(16, 185, 129, 0.12)',
                      border: '1px solid rgba(16, 185, 129, 0.3)',
                      color: '#059669',
                      fontWeight: 700,
                      fontSize: '0.8rem',
                    }}
                  >
                    <CheckCircle2 size={15} />
                    <span>全日程解析済</span>
                  </div>
                )
              ) : (
                <button
                  onClick={() => {
                    stopRequestedRef.current = true;
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.45rem',
                    padding: '0.52rem 1rem',
                    borderRadius: '10px',
                    border: 'none',
                    backgroundColor: '#ef4444',
                    color: '#fff',
                    fontWeight: 800,
                    fontSize: '0.82rem',
                    cursor: 'pointer',
                  }}
                >
                  <Square size={15} />
                  <span>解析を中断</span>
                </button>
              )}

              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  padding: '0.48rem 0.8rem',
                  borderRadius: '8px',
                  border: showAdvanced ? '1px solid #3b82f6' : '1px solid var(--border-color)',
                  backgroundColor: showAdvanced ? 'rgba(59, 130, 246, 0.1)' : 'var(--bg-secondary)',
                  color: showAdvanced ? '#3b82f6' : 'var(--text-secondary)',
                  fontWeight: 600,
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                }}
              >
                <SlidersHorizontal size={14} />
                <span>{showAdvanced ? '管理設定を閉じる' : '管理設定'}</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* 管理者一括解析中の進捗バー */}
      {isAdmin && batchProgress && (
        <div
          style={{
            marginBottom: '1.25rem',
            padding: '0.85rem 1rem',
            backgroundColor: 'var(--bg-secondary)',
            borderRadius: '10px',
            border: '1px solid #3b82f6',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem', fontSize: '0.85rem', fontWeight: 700 }}>
            <span style={{ color: '#3b82f6' }}>
              🔄 一括解析中: {batchProgress.currentDate} を処理しています... (モデル: {batchProgress.activeModel})
            </span>
            <span>
              {batchProgress.current} / {batchProgress.total} 日 ({Math.round((batchProgress.current / batchProgress.total) * 100)}%)
            </span>
          </div>
          <div style={{ width: '100%', height: '10px', backgroundColor: 'var(--border-color)', borderRadius: '999px', overflow: 'hidden' }}>
            <div
              style={{
                width: `${Math.round((batchProgress.current / batchProgress.total) * 100)}%`,
                height: '100%',
                background: 'linear-gradient(90deg, #3b82f6, #10b981)',
                transition: 'width 0.3s ease',
              }}
            />
          </div>
        </div>
      )}

      {/* 管理者専用パネル */}
      {isAdmin && showAdvanced && (
        <CameraAiAdminPanel
          availableDates={availableDates}
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
          overwriteExisting={overwriteExisting}
          selectedModel={selectedModel}
          isAnalyzing={isAnalyzing}
          isSyncingCloud={isSyncingCloud}
          hasAnyResults={Object.keys(analysisResults).length > 0}
          storageStats={storageStats}
          onRangeStartChange={setRangeStart}
          onRangeEndChange={setRangeEnd}
          onOverwriteChange={setOverwriteExisting}
          onModelChange={setSelectedModel}
          onRunCustomRange={runCustomRangeBatch}
          onExportJson={handleExportJson}
          onClearAll={handleClearAllAnalysis}
        />
      )}

      {statusMsg && (
        <div style={{ padding: '0.75rem 1rem', backgroundColor: 'rgba(16, 185, 129, 0.1)', color: '#059669', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.86rem', fontWeight: 600 }}>
          {statusMsg}
        </div>
      )}

      {errorMsg && (
        <div style={{ padding: '0.75rem 1rem', backgroundColor: '#fef2f2', color: '#ef4444', border: '1px solid #f87171', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.86rem', fontWeight: 600 }}>
          ⚠️ {errorMsg}
        </div>
      )}

      {/* ===== 2. 日付選択 ＆ アメダス気象 ＆ 季節別KPIカード ===== */}
      <div
        style={{
          padding: '1.1rem 1.25rem',
          backgroundColor: 'var(--bg-secondary)',
          borderRadius: '12px',
          border: '1px solid var(--border-color)',
          marginBottom: '1.5rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.9rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <Eye size={18} style={{ color: 'var(--accent-primary)' }} />
            <span style={{ fontSize: '0.92rem', fontWeight: 800 }}>確認する日付:</span>

            <button
              onClick={() => prevDate && setSelectedDate(prevDate)}
              disabled={!prevDate || isAnalyzing}
              style={{
                padding: '0.4rem 0.6rem',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                cursor: !prevDate || isAnalyzing ? 'not-allowed' : 'pointer',
                opacity: !prevDate || isAnalyzing ? 0.4 : 1,
                display: 'flex',
                alignItems: 'center',
              }}
              title="前の日へ"
            >
              <ChevronLeft size={16} />
            </button>

            <select
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              disabled={isAnalyzing}
              style={{
                padding: '0.45rem 0.85rem',
                borderRadius: '8px',
                border: '2px solid #3b82f6',
                backgroundColor: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                fontWeight: 800,
                fontSize: '0.92rem',
                cursor: 'pointer',
              }}
            >
              {[...availableDates].reverse().map(d => {
                const hasOk = isDayAnalyzedForDate(analysisResults[d], d, camHistory);
                return (
                  <option key={d} value={d}>
                    {d} {hasOk ? '✓ AI解析済' : '（未解析）'}
                  </option>
                );
              })}
            </select>

            <button
              onClick={() => nextDate && setSelectedDate(nextDate)}
              disabled={!nextDate || isAnalyzing}
              style={{
                padding: '0.4rem 0.6rem',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                cursor: !nextDate || isAnalyzing ? 'not-allowed' : 'pointer',
                opacity: !nextDate || isAnalyzing ? 0.4 : 1,
                display: 'flex',
                alignItems: 'center',
              }}
              title="次の日へ"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            {isCurrentDayAnalyzed ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.86rem', flexWrap: 'wrap' }}>
                <span style={{ color: '#10b981', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                  <CheckCircle2 size={16} /> AI解析済
                </span>
                {dailySummary.dominantSnowLine !== 'none' && getSnowLineBadge(dailySummary.dominantSnowLine)}
              </div>
            ) : (
              <span style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                📅 この日のAI解析はまだ完了していません
              </span>
            )}

            {isAdmin && (
              <button
                onClick={runSingleDayAnalysis}
                disabled={isAnalyzing}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  padding: '0.42rem 0.85rem',
                  borderRadius: '8px',
                  border: '1px solid #3b82f6',
                  backgroundColor: 'var(--bg-primary)',
                  color: '#3b82f6',
                  fontWeight: 700,
                  fontSize: '0.82rem',
                  cursor: isAnalyzing ? 'wait' : 'pointer',
                  opacity: isAnalyzing ? 0.6 : 1,
                }}
              >
                <RefreshCw size={14} className={isAnalyzing && !batchProgress ? 'animate-spin' : ''} />
                <span>{isCurrentDayAnalyzed ? 'この日を再解析' : 'この日をAI解析する'}</span>
              </button>
            )}
          </div>
        </div>

        <div
          style={{
            paddingTop: '0.7rem',
            borderTop: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '1.15rem',
            fontSize: '0.84rem',
          }}
        >
          <span style={{ fontWeight: 700, color: '#d97706', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
            <Sun size={15} /> {selectedDate} アメダス気象:
          </span>
          {currentWeather ? (
            <>
              <span>気温: <strong>{currentWeather.tempMax}℃</strong> / {currentWeather.tempMin}℃</span>
              <span>日降水量: <strong style={{ color: currentWeather.precipitation > 0 ? '#3b82f6' : 'inherit' }}>{currentWeather.precipitation} mm</strong></span>
              <span>最大風速: <strong>{currentWeather.windSpeedMax} m/s</strong> ({getWindDirString(currentWeather.windDirection)})</span>
              <span>日照(沓形): <strong>{currentWeather.sunshineDuration ?? '-'} h</strong></span>
            </>
          ) : (
            <span style={{ color: 'var(--text-secondary)' }}>{isLoadingWeather ? '気象データ読込中...' : '気象データなし'}</span>
          )}
        </div>

        {currentResults && currentResults.some(isValidCameraAnalysis) && (
          <CameraAiSummaryCards
            activeSeasonMode={activeSeasonMode}
            dailySummary={dailySummary}
            eastEstimate={eastEstimate}
            timePhaseSummary={timePhaseSummary}
          />
        )}
      </div>

      {/* ===== 3. 時間帯 × 斜面方角別 視界・雲底高度マトリクス ===== */}
      {currentResults && currentResults.some(isValidCameraAnalysis) && (
        <CameraAiMatrixTable
          selectedDate={selectedDate}
          activeTimes={activeTimesForSelectedDate}
          activeLocations={activeLocationsForSelectedDate}
          inactiveLocations={inactiveLocationsForSelectedDate}
          currentResults={currentResults}
          selectedHourFilter={selectedHourFilter}
          onSelectHour={setSelectedHourFilter}
          onOpenModalImage={setModalImage}
        />
      )}

      {/* ===== 4. 時間帯切替ピル ＋ 選択時間帯のカメラ画像＆AI判定一覧 ===== */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {inactiveLocationsForSelectedDate.length > 0 && (!currentResults || !currentResults.some(isValidCameraAnalysis)) && (
          <InactiveCamerasNotice items={inactiveLocationsForSelectedDate} compact />
        )}

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '0.65rem',
            padding: '0.7rem 0.95rem',
            backgroundColor: 'var(--bg-secondary)',
            borderRadius: '10px',
            border: '1px solid var(--border-color)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.86rem', fontWeight: 800 }}>
            <Clock size={16} style={{ color: '#3b82f6' }} />
            <span>カメラ画像・個別AI判定を表示する時間帯:</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
            {activeTimesForSelectedDate.map(hr => {
              const isSelected = selectedHourFilter === hr;
              return (
                <button
                  key={hr}
                  onClick={() => setSelectedHourFilter(hr)}
                  style={{
                    padding: '0.32rem 0.7rem',
                    borderRadius: '999px',
                    border: isSelected ? '1px solid #3b82f6' : '1px solid var(--border-color)',
                    backgroundColor: isSelected ? '#3b82f6' : 'var(--bg-primary)',
                    color: isSelected ? '#fff' : 'var(--text-primary)',
                    fontWeight: 700,
                    fontSize: '0.78rem',
                    cursor: 'pointer',
                  }}
                >
                  {hr}:00
                </button>
              );
            })}
            <button
              onClick={() => setSelectedHourFilter('all')}
              style={{
                padding: '0.32rem 0.75rem',
                borderRadius: '999px',
                border: selectedHourFilter === 'all' ? '1px solid #10b981' : '1px solid var(--border-color)',
                backgroundColor: selectedHourFilter === 'all' ? '#10b981' : 'var(--bg-primary)',
                color: selectedHourFilter === 'all' ? '#fff' : 'var(--text-secondary)',
                fontWeight: 700,
                fontSize: '0.78rem',
                cursor: 'pointer',
              }}
            >
              すべて表示 ({activeTimesForSelectedDate.length}枠)
            </button>
          </div>
        </div>

        {displayedTimes.map(time => {
          const locationsForSlot = getLocationsPartitionForDate(selectedDate, time).visible;
          return (
            <div key={time}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  marginBottom: '0.65rem',
                  paddingBottom: '0.35rem',
                  borderBottom: '2px solid var(--border-color)',
                }}
              >
                <span style={{ backgroundColor: 'var(--accent-primary, #3b82f6)', color: '#fff', fontWeight: 800, fontSize: '0.85rem', padding: '0.15rem 0.6rem', borderRadius: '6px' }}>
                  {time}:00
                </span>
                <span style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {selectedDate} {time}時台の視界・カメラ画像 ({locationsForSlot.length}地点)
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(265px, 1fr))', gap: '1rem' }}>
                {locationsForSlot.map(loc => {
                  const fileName = `${time}_${loc.id}.jpg`;
                  const relPath = `cams/${selectedDate}/${fileName}`;
                  const cdnUrl = getCamImageUrl(relPath);
                  const localUrl = `/${relPath}`;
                  const imgKey = `${selectedDate}_${fileName}`;
                  const isBroken = !!brokenImages[imgKey];

                  const result = currentResults?.find(r => r.fileName === fileName);
                  const isMissingResult =
                    result?.status === 'missing' ||
                    result?.status === 'camera_error' ||
                    result?.visibility === 'missing' ||
                    result?.visibility === 'camera_error';
                  const elevInfo = result && !isMissingResult ? getEffectiveElevation(result) : null;

                  return (
                    <div
                      key={loc.id}
                      style={{
                        border: '1px solid var(--border-color)',
                        borderRadius: '10px',
                        overflow: 'hidden',
                        backgroundColor: 'var(--bg-primary)',
                        display: 'flex',
                        flexDirection: 'column',
                      }}
                    >
                      <div
                        style={{
                          padding: '0.45rem 0.75rem',
                          backgroundColor: 'var(--bg-secondary)',
                          fontWeight: 700,
                          fontSize: '0.84rem',
                          borderBottom: '1px solid var(--border-color)',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                          <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: loc.color, display: 'inline-block' }} />
                          {loc.name}
                        </span>
                        {result && !isMissingResult && result.summit_visible !== undefined && (
                          <span
                            style={{
                              fontSize: '0.71rem',
                              padding: '0.1rem 0.45rem',
                              borderRadius: '4px',
                              backgroundColor: result.summit_visible ? 'rgba(16, 185, 129, 0.15)' : 'rgba(148, 163, 184, 0.2)',
                              color: result.summit_visible ? '#059669' : 'var(--text-secondary)',
                              fontWeight: 700,
                            }}
                          >
                            {result.summit_visible ? '山頂露出: ◯' : '山頂隠れ: ×'}
                          </span>
                        )}
                      </div>

                      <div
                        style={{
                          position: 'relative',
                          aspectRatio: '16/9',
                          backgroundColor: isBroken ? 'var(--bg-secondary)' : '#0f172a',
                          cursor: !isBroken ? 'pointer' : 'default',
                          overflow: 'hidden',
                        }}
                        onClick={() => {
                          if (!isBroken) {
                            setModalImage({
                              url: cdnUrl,
                              title: `${loc.name} (${loc.bcSlopeName}) - ${selectedDate} ${time}:00`,
                              sub: result?.reason,
                            });
                          }
                        }}
                      >
                        {!isBroken ? (
                          <>
                            <img
                              src={cdnUrl}
                              alt={`${loc.name} ${selectedDate} ${time}:00`}
                              loading="lazy"
                              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                              onError={e => {
                                const imgEl = e.currentTarget;
                                if (!imgEl.dataset.triedLocal) {
                                  imgEl.dataset.triedLocal = 'true';
                                  imgEl.src = localUrl;
                                } else {
                                  setBrokenImages(prev => ({ ...prev, [imgKey]: true }));
                                }
                              }}
                            />
                            <div style={{ position: 'absolute', top: '0.4rem', right: '0.4rem', backgroundColor: 'rgba(0, 0, 0, 0.55)', color: '#fff', padding: '0.25rem', borderRadius: '4px', display: 'flex' }}>
                              <Maximize2 size={13} />
                            </div>
                          </>
                        ) : (
                          <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', gap: '0.35rem', padding: '0.75rem', textAlign: 'center' }}>
                            <VideoOff size={26} style={{ opacity: 0.45 }} />
                            <span style={{ fontSize: '0.76rem', fontWeight: 600 }}>この時間の記録画像はありません</span>
                          </div>
                        )}
                      </div>

                      <div style={{ padding: '0.65rem 0.75rem', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                        {result && !isMissingResult && elevInfo ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.25rem' }}>
                              {getVisibilityBadge(result.visibility, result.summit_visible)}
                              <span style={{ fontSize: '0.73rem', fontWeight: 700, color: result.is_sunny ? '#f59e0b' : 'var(--text-secondary)' }}>
                                {result.is_sunny ? '☀️ 日差し' : '☁️ 日差しなし'} (雲量 {result.cloud_cover}/10)
                              </span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
                              {getElevationBadge(elevInfo.elevationM, elevInfo.bcStatus)}
                              {getSnowLineBadge(elevInfo.snowLine)}
                            </div>
                            <div style={{ fontSize: '0.73rem', color: 'var(--text-primary)', marginTop: '0.1rem', lineHeight: 1.4 }}>
                              {result.reason}
                            </div>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                            <span>
                              {isBroken
                                ? 'カメラ未記録（解析対象外）'
                                : isAdmin
                                ? 'AI未解析（上の「この日をAI解析する」で判定可能）'
                                : 'AI解析データ準備中'}
                            </span>
                            {isMissingResult && getVisibilityBadge('missing')}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* 画像拡大モーダル */}
      {modalImage && (
        <div
          style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0, 0, 0, 0.85)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.25rem' }}
          onClick={() => setModalImage(null)}
        >
          <div
            style={{ maxWidth: '900px', width: '100%', backgroundColor: 'var(--bg-secondary)', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ padding: '0.85rem 1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', fontWeight: 700 }}>
              <span>{modalImage.title}</span>
              <button onClick={() => setModalImage(null)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex' }}>
                <X size={22} />
              </button>
            </div>
            <div style={{ backgroundColor: '#000', display: 'flex', justifyContent: 'center' }}>
              <img src={modalImage.url} alt={modalImage.title} style={{ maxWidth: '100%', maxHeight: '75vh', objectFit: 'contain' }} />
            </div>
            {modalImage.sub && (
              <div style={{ padding: '0.75rem 1.25rem', fontSize: '0.88rem', color: 'var(--text-primary)' }}>
                🤖 <strong>AI判定理由:</strong> {modalImage.sub}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
