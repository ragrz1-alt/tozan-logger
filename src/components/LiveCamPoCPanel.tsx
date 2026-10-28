import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Sun,
  RefreshCw,
  CheckCircle2,
  Trash2,
  Download,
  Play,
  Square,
  Calendar,
  Eye,
  Cloud,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
  Sparkles,
  VideoOff,
  Maximize2,
  X,
  HardDrive,
  Compass,
  Mountain,
  Snowflake,
} from 'lucide-react';
import {
  type ImageAnalysis,
  type CameraId,
  type SeasonMode,
  type BcFieldStatus,
  type SnowLineStatus,
  evaluateDailyCameraVisibility,
  cleanupObsoleteLocalStorageCaches,
  persistCameraAnalysisResults,
  getSeasonModeForDate,
  getTargetHoursForDate,
  getEffectiveElevation,
  estimateEastAspectElevation,
} from '../hooks/useCameraAnalysis';
import { loadCameraAnalysisFromFirestore } from '../utils/firebaseStorage';
import { fetchWeatherData, type WeatherData } from '../utils/weatherApi';
import { getHistoryJsonUrl, getCamImageUrl } from '../utils/camUrl';

export interface LiveCamPoCPanelProps {
  isAdmin?: boolean;
}

const ALL_LOCATIONS: {
  id: CameraId;
  name: string;
  shortName: string;
  bcSlopeName: string;
  color: string;
  isCore: boolean;
}[] = [
  {
    id: 'oshidomari',
    name: '鴛泊(本泊・北)',
    shortName: '本泊(北)',
    bcSlopeName: '北面：長官山・ポン山・大空沢',
    color: '#3b82f6',
    isCore: true,
  },
  {
    id: 'ferry',
    name: '鴛泊港(フェリー・北)',
    shortName: 'フェリー(北)',
    bcSlopeName: '北〜北北東面：鴛泊北稜俯瞰',
    color: '#0284c7',
    isCore: false,
  },
  {
    id: 'himenuma',
    name: '姫沼(北東)',
    shortName: '姫沼(北東)',
    bcSlopeName: '北東面：オチュウシナイ沢方面',
    color: '#059669',
    isCore: false,
  },
  {
    id: 'kutsugata',
    name: '沓形(西)',
    shortName: '沓形(西)',
    bcSlopeName: '西面：三眺山・見返台方面',
    color: '#10b981',
    isCore: true,
  },
  {
    id: 'otadomari',
    name: 'オタドマリ沼(南東)',
    shortName: 'オタドマリ(南東)',
    bcSlopeName: '南東面：ヤムナイ沢・南東稜方面',
    color: '#8b5cf6',
    isCore: false,
  },
  {
    id: 'senposhi',
    name: '仙法志(南)',
    shortName: '仙法志(南)',
    bcSlopeName: '南面：南稜・仙法志稜方面',
    color: '#f59e0b',
    isCore: true,
  },
];

// 対象日の解析が完了しているかの判定ヘルパー（季節別のスロット数に対応）
function isDayAnalyzedForDate(records?: ImageAnalysis[]): boolean {
  if (!records || records.length === 0) return false;
  const hasOk = records.some(c => c.status === 'ok');
  const hasCoreSlot = records.some(
    c =>
      c.fileName.startsWith('07_') ||
      c.fileName.startsWith('09_') ||
      c.fileName.startsWith('11_') ||
      c.fileName.startsWith('13_') ||
      c.fileName.startsWith('15_')
  );
  return hasOk && hasCoreSlot;
}

// レート制限 (500 RPD / 15 RPM) に最適化されたモデルチェーン
const CAMERA_MODELS = [
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite (推奨: 500回/日・15回/分)' },
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite (予備: 500回/日・15回/分)' },
  { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash (高精度・上限20回/日)' },
];

const STRICT_SYSTEM_PROMPT = `あなたは北海道・利尻山（独立峰・標高1,721m）の山岳気象・視界判定・バックカントリー(BC)フィールド解析の専門AIアナリストです。
定点ライブカメラ6地点：
- oshidomari = 北側・本泊（長官山・ポン山・大空沢方面）
- ferry = 北側・鴛泊港（北稜全体俯瞰）
- himenuma = 北東・姫沼（オチュウシナイ沢方面）
- kutsugata = 西側・沓形（三眺山・西面方面）
- otadomari = 南東・オタドマリ沼（ヤムナイ沢・南東稜方面）
- senposhi = 南側・仙法志（南稜・仙法志稜方面）
の画像から、登山者・BC滑走者・観光関係者にとって重要な「山頂ピークの露出」「標高何メートルまで視界があるか（雲底高度）」「冠雪・積雪ライン」「空全体の雲量」を厳密に判定してください。

【最重要：判定の厳格ルール】
1. 手前の海・港・沼・市街地・道路の天気に惑わされないでください。常に画角中央〜奥にそびえる「利尻山の山体・斜面・山頂ピーク」を基準に判定してください。
2. summit_visible (boolean):
   - true: 利尻山の最高峰ピーク（標高1,721mの尖った山頂部）が雲や霧に隠れず、明確に輪郭まで見えている場合のみ true。
   - false: 山頂部に笠雲・山岳波雲・雪雲・ガスがかかって隠れている場合や、山全体が見えない場合は必ず false。
3. visibility ('clear' | 'cloudy' | 'foggy'):
   - 'clear' (山頂快晴): 山頂ピーク(1,721m)から稜線・山麓までクッキリ見えている状態（summit_visible が true であることが絶対条件）。
   - 'cloudy' (山頂雲隠れ・中腹視認): 山の裾野〜中腹（稜線の一部やオープンバーン）は見えているが、山頂ピーク付近が雲や笠雲に隠れている状態。または高曇りで山全体の輪郭は見えるが厚い雲で日差しがない状態。
   - 'foggy' (山体ガス・視界不良・不可視): 低い雲・濃霧・吹雪・悪天候により、利尻山の山体全体（または中腹から上の大部分）が白や灰色の雲に覆われて見えない状態。※カメラ手前の町や海・沼が見えていても、肝心の「山」が見えなければ必ず 'foggy' と判定してください。
4. visible_elevation_m (1700 | 1000 | 500 | 0 の4段階の整数) ＆ bc_field_status ('alpine_clear' | 'mid_mountain_ok' | 'treeline_only' | 'whiteout'):
   - 1700 / 'alpine_clear': 山頂ピーク（1,500〜1,721m）まで雲に隠れず視界が抜けている状態（summit_visible = true のとき）。
   - 1000 / 'mid_mountain_ok': 山頂ピークは雲の中だが、中腹のオープンバーン・稜線中段（標高800〜1,300m付近：長官山・三眺山・中腹斜面）までは雲底より下にあって明確に視認できる状態。
   - 500 / 'treeline_only': 中腹以上（標高600m以上）は厚い雲やガス・吹雪に隠れているが、下部の森林限界〜山麓・裾野（標高300〜600m付近）の斜面輪郭は見えている状態。
   - 0 / 'whiteout': 山麓から山体がまったく見えない状態（濃霧・全面ガス・吹雪・ホワイトアウト・暗闇）。
5. snow_line ('none' | 'summit_cap' | 'mid_slope' | 'full_snow'):
   - 'none': 山体に積雪・冠雪が見られない状態（または山体が見えず積雪が確認できない場合）。
   - 'summit_cap': 山頂部・高標高帯（目安1,200m以上）のみ白く冠雪している状態（初冠雪・残雪末期）。
   - 'mid_slope': 中腹（目安500〜1,000m付近）まで白く雪が積もっている状態。
   - 'full_snow': 山麓・裾野・海岸線近くまで山全体が真っ白に全面積雪している状態（厳冬期〜春山期）。
6. cloud_cover (0〜10の整数):
   - 0〜2: 快晴 / 3〜5: 晴れ / 6〜8: 曇り / 9〜10: 全天曇天・濃霧・吹雪
7. is_sunny (boolean):
   - 青空が明確に見える、または山体・地表に直射日光が当たっている場合は true。
8. reason (string):
   - 山頂や中腹（何m付近まで）の見え方、雲のかかり方、積雪の様子を40〜70文字程度で簡潔・具体的に記述してください。`;

function getWindDirString(deg: number) {
  const dirs = ['北', '北北東', '北東', '東北東', '東', '東南東', '南東', '南南東', '南', '南南西', '南西', '西南西', '西', '西北西', '北西', '北北西'];
  return dirs[Math.round(deg / 22.5) % 16] || '不明';
}

function generateDateList(startStr: string, endStr: string): string[] {
  const list: string[] = [];
  const startD = new Date(startStr);
  const endD = new Date(endStr);
  for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
    list.push(d.toISOString().split('T')[0]);
  }
  return list;
}

function getTodayJstStr(): string {
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  return jst.toISOString().split('T')[0];
}

export const LiveCamPoCPanel: React.FC<LiveCamPoCPanelProps> = ({ isAdmin = false }) => {
  const [latestEndDate, setLatestEndDate] = useState<string>(() => {
    const today = getTodayJstStr();
    return today >= '2026-07-28' ? today : '2026-10-22';
  });

  // 全対象期間 (2026-07-28 〜 最新キャプチャ日/今日)
  const availableDates = useMemo(() => generateDateList('2026-07-28', latestEndDate), [latestEndDate]);

  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const today = getTodayJstStr();
    return today >= '2026-07-28' ? today : '2026-10-22';
  });

  // 季節モード（選択日の月から自動判定しつつ、手動で夏山ビュー/冬山BCビューのプレビュー切替も可能）
  const autoSeasonMode = useMemo(() => getSeasonModeForDate(selectedDate), [selectedDate]);
  const [overrideSeasonMode, setOverrideSeasonMode] = useState<SeasonMode | null>(null);
  const activeSeasonMode: SeasonMode = overrideSeasonMode || autoSeasonMode;

  // 日付変更時は自動モードに戻す
  useEffect(() => {
    setOverrideSeasonMode(null);
  }, [selectedDate]);

  const [historyRecords, setHistoryRecords] = useState<Record<string, Record<string, Record<string, string>>>>({});

  // 詳細設定（任意期間指定・モデル変更・データ管理・容量確認）の開閉ステート
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  const [rangeStart, setRangeStart] = useState<string>('2026-10-01');
  const [rangeEnd, setRangeEnd] = useState<string>(() => {
    const today = getTodayJstStr();
    return today >= '2026-07-28' ? today : '2026-10-22';
  });
  const [overwriteExisting, setOverwriteExisting] = useState<boolean>(false);

  const [selectedModel, setSelectedModel] = useState<string>('gemini-3.5-flash-lite');
  const [analysisResults, setAnalysisResults] = useState<Record<string, ImageAnalysis[]>>({});
  const analysisResultsRef = useRef<Record<string, ImageAnalysis[]>>({});

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

  // 画像読み込み失敗（未記録）状態管理 ＆ 拡大モーダル
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({});
  const [modalImage, setModalImage] = useState<{ url: string; title: string; sub?: string } | null>(null);

  useEffect(() => {
    analysisResultsRef.current = analysisResults;
  }, [analysisResults]);

  // history.json から最新のキャプチャ最終日＆全記録状況を取得して反映
  useEffect(() => {
    const syncLatestHistory = async () => {
      try {
        let res = await fetch(getHistoryJsonUrl());
        if (!res.ok) {
          res = await fetch(`/cams/history.json?t=${Date.now()}`);
        }
        if (!res.ok) return;
        const data = await res.json();
        const records = data?.records || {};
        setHistoryRecords(records);
        const dates = Object.keys(records).sort();
        if (dates.length > 0) {
          const maxD = dates[dates.length - 1];
          const today = getTodayJstStr();
          const bestEnd = maxD > today ? maxD : today;
          setLatestEndDate(bestEnd);
          setRangeEnd(bestEnd);
          setSelectedDate(bestEnd);
        }
      } catch {}
    };
    syncLatestHistory();
  }, []);

  // 1. 初期読み込み：localStorage + 静的JSON + Cloud Firestore をマージし、不要な旧気象キャッシュを掃除
  useEffect(() => {
    const initLoad = async () => {
      cleanupObsoleteLocalStorageCaches();

      const isClearedLocal = localStorage.getItem('tozan_weather_analysis_cleared') === 'true';
      let localData: Record<string, ImageAnalysis[]> = {};
      try {
        const cached = localStorage.getItem('tozan_weather_analysis_cache');
        if (cached) localData = JSON.parse(cached);
      } catch {}

      if (Object.keys(localData).length > 0) {
        setAnalysisResults(localData);
        analysisResultsRef.current = localData;
      }

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
      analysisResultsRef.current = merged;

      if (Object.keys(merged).length > 0) {
        try {
          localStorage.setItem('tozan_weather_analysis_cache', JSON.stringify(merged));
        } catch {}
      }
    };
    initLoad();
  }, []);

  // 2. 気象データのロード
  useEffect(() => {
    const loadW = async () => {
      setIsLoadingWeather(true);
      try {
        const w = await fetchWeatherData(0, 0, '2026-07-28', latestEndDate);
        setWeatherMap(w);
      } catch (e) {
        console.warn('Weather load error:', e);
      } finally {
        setIsLoadingWeather(false);
      }
    };
    loadW();
  }, [latestEndDate]);

  // 無料枠ストレージ容量計算
  const storageStats = useMemo(() => {
    let totalPhotos = 0;
    const recordDates = Object.keys(historyRecords);
    if (recordDates.length > 0) {
      recordDates.forEach(d => {
        const hrs = historyRecords[d] || {};
        Object.values(hrs).forEach(hrObj => {
          if (hrObj && typeof hrObj === 'object') {
            totalPhotos += Object.keys(hrObj).filter(k => k !== 'timestamp').length;
          }
        });
      });
    } else {
      totalPhotos = availableDates.length * 14 * 3;
    }
    const estMB = Math.round(((totalPhotos * 38) / 1024) * 10) / 10;
    const limitMB = 1000;
    const ratio = Math.min(100, Math.round((estMB / limitMB) * 100));
    return { totalPhotos, estMB, limitMB, ratio };
  }, [historyRecords, availableDates.length]);

  // 対象日に有効なカメラリストを返す（6地点体制対応・過去3地点日の自動判別）
  const getLocationsForDate = (dateStr: string) => {
    const dayRec = historyRecords[dateStr] || {};
    const recordedCamIds = new Set<string>();
    Object.values(dayRec).forEach(hrObj => {
      if (hrObj && typeof hrObj === 'object') {
        Object.keys(hrObj).forEach(k => {
          if (k !== 'timestamp') recordedCamIds.add(k);
        });
      }
    });
    const dayAnalysis = analysisResults[dateStr] || [];
    dayAnalysis.forEach(a => {
      if (a.status === 'ok') {
        ALL_LOCATIONS.forEach(l => {
          if (a.fileName.includes(`_${l.id}.jpg`)) recordedCamIds.add(l.id);
        });
      }
    });

    const isSixCam =
      dateStr >= '2026-10-28' ||
      recordedCamIds.has('ferry') ||
      recordedCamIds.has('himenuma') ||
      recordedCamIds.has('otadomari');
    return isSixCam ? ALL_LOCATIONS : ALL_LOCATIONS.filter(l => l.isCore || recordedCamIds.has(l.id));
  };

  const activeLocationsForSelectedDate = useMemo(
    () => getLocationsForDate(selectedDate),
    [selectedDate, historyRecords, analysisResults]
  );

  // 選択日のAI解析対象時間帯（5-8月: 9回, 9-10月・3-4月: 7回, 11-2月: 5回）
  const activeTimesForSelectedDate = useMemo(() => {
    const baseTimes = getTargetHoursForDate(selectedDate);
    // すでに解析済みの結果に特定の時間帯が含まれている場合はそれも補完表示する
    const dayRes = analysisResults[selectedDate] || [];
    const existingHours = new Set<string>(baseTimes);
    dayRes.forEach(r => {
      if (r.status === 'ok' && r.fileName.length >= 2) {
        existingHours.add(r.fileName.slice(0, 2));
      }
    });
    return Array.from(existingHours).sort();
  }, [selectedDate, analysisResults]);

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

  // 時間帯フェーズ別の視界要約（夏山用 / 冬山BC用）
  const timePhaseSummary = useMemo(() => {
    const valid = (currentResults || []).filter(
      c => c.status !== 'missing' && c.visibility !== 'missing' && c.cloud_cover >= 0
    );
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

  // 未解析の日付リスト（実際のデータから動的に算出）
  const unanalyzedDates = useMemo(() => {
    return availableDates.filter(d => !isDayAnalyzedForDate(analysisResults[d]));
  }, [availableDates, analysisResults]);

  const analyzedDaysCount = availableDates.length - unanalyzedDates.length;

  // 前の日・次の日ナビゲーション用
  const currentIdx = availableDates.indexOf(selectedDate);
  const prevDate = currentIdx > 0 ? availableDates[currentIdx - 1] : null;
  const nextDate = currentIdx >= 0 && currentIdx < availableDates.length - 1 ? availableDates[currentIdx + 1] : null;

  // 1. まず GitHub Pages CDN (最新画像) から取得し、失敗時のみローカルへフォールバック
  const fetchAsBase64 = async (
    relPath: string
  ): Promise<{ fileName: string; data: string; mimeType: string; isMissing: boolean }> => {
    const fileName = relPath.split('/').pop() || '';
    const cdnUrl = getCamImageUrl(relPath);
    try {
      let res = await fetch(cdnUrl);
      let blob = res.ok ? await res.blob() : null;
      if (!res.ok || !blob || blob.type.includes('html')) {
        res = await fetch(relPath);
        if (!res.ok) {
          return { fileName, data: '', mimeType: '', isMissing: true };
        }
        blob = await res.blob();
        if (blob.type.includes('html')) {
          return { fileName, data: '', mimeType: '', isMissing: true };
        }
      }
      return new Promise(resolve => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const b64 = (reader.result as string).split(',')[1];
          resolve({ fileName, data: b64, mimeType: blob.type || 'image/jpeg', isMissing: false });
        };
        reader.readAsDataURL(blob);
      });
    } catch {
      return { fileName, data: '', mimeType: '', isMissing: true };
    }
  };

  // 画像チャンク1つ分を Gemini API で高精度解析するサブ関数
  const analyzeImageChunk = async (
    targetDate: string,
    seasonMode: SeasonMode,
    chunkImages: { fileName: string; data: string; mimeType: string }[],
    apiKey: string
  ): Promise<{ items: ImageAnalysis[]; usedModel: string }> => {
    const seasonLabel =
      seasonMode === 'winter_bc'
        ? '冬山・バックカントリー期（11〜4月：山頂露出に加え、中腹1000mオープンバーンや森林限界500mの視界高度・積雪ラインを重視）'
        : '夏山・登山観光期（5〜10月：1721m山頂ピーク露出と雲底高度・冠雪有無を重視）';

    const parts: any[] = [
      {
        text: `対象日 ${targetDate}（${seasonLabel}）の利尻山ライブカメラ画像群（${chunkImages.length}枚）です。各画像の fileName ごとに、厳格ルールに従って summit_visible, visibility, visible_elevation_m, bc_field_status, snow_line, cloud_cover, is_sunny, reason をJSON配列で返してください。`,
      },
    ];
    for (const img of chunkImages) {
      parts.push({ text: `ファイル名: ${img.fileName}` });
      parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
    }

    const fallbackChain = [
      selectedModel,
      ...CAMERA_MODELS.map(m => m.id).filter(id => id !== selectedModel),
    ];

    let lastErr: Error | null = null;

    for (const modelName of fallbackChain) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              systemInstruction: {
                parts: [{ text: STRICT_SYSTEM_PROMPT }],
              },
              contents: [{ role: 'user', parts }],
              generationConfig: {
                responseMimeType: 'application/json',
                maxOutputTokens: 8192,
                responseSchema: {
                  type: 'ARRAY',
                  items: {
                    type: 'OBJECT',
                    properties: {
                      fileName: { type: 'STRING' },
                      summit_visible: { type: 'BOOLEAN' },
                      is_sunny: { type: 'BOOLEAN' },
                      cloud_cover: { type: 'INTEGER' },
                      visibility: { type: 'STRING', enum: ['clear', 'cloudy', 'foggy'] },
                      visible_elevation_m: { type: 'INTEGER' },
                      bc_field_status: {
                        type: 'STRING',
                        enum: ['alpine_clear', 'mid_mountain_ok', 'treeline_only', 'whiteout'],
                      },
                      snow_line: {
                        type: 'STRING',
                        enum: ['none', 'summit_cap', 'mid_slope', 'full_snow'],
                      },
                      reason: { type: 'STRING' },
                    },
                    required: [
                      'fileName',
                      'summit_visible',
                      'is_sunny',
                      'cloud_cover',
                      'visibility',
                      'visible_elevation_m',
                      'bc_field_status',
                      'snow_line',
                      'reason',
                    ],
                  },
                },
                temperature: 0.1,
              },
            }),
          }
        );

        if (!response.ok) {
          const errJson = await response.json().catch(() => ({}));
          const status = response.status;
          const msg = errJson.error?.message || response.statusText;
          if (status === 429 || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED')) {
            lastErr = new Error(`モデル ${modelName} のレート制限に達しました。次の予備モデルへ切り替えます...`);
            continue;
          }
          throw new Error(`API Error (${status}): ${msg}`);
        }

        const data = await response.json();
        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawText) throw new Error('AIから有効なレスポンスが返りませんでした。');

        const cleanText = rawText.replace(/```json|```/g, '').trim();
        const resultJson: ImageAnalysis[] = JSON.parse(cleanText);
        const normalized: ImageAnalysis[] = [];

        for (const res of resultJson) {
          if (res.summit_visible === false && res.visibility === 'clear') {
            res.visibility = 'cloudy';
          }
          if (
            res.visibility === 'cloudy' &&
            (res.reason.includes('山全体が雲に隠れ') ||
              res.reason.includes('山は全く見え') ||
              res.reason.includes('山体が見え'))
          ) {
            res.visibility = 'foggy';
            res.summit_visible = false;
          }

          // 論理整合性の自動補正（山頂露出なら1700m、山頂雲隠れなら最大1000m、不可視なら0〜500m）
          if (res.summit_visible && res.visibility === 'clear') {
            res.visible_elevation_m = 1700;
            res.bc_field_status = 'alpine_clear';
          } else if (res.visibility === 'cloudy') {
            if (res.visible_elevation_m === 1700 || !res.visible_elevation_m) {
              res.visible_elevation_m = 1000;
              res.bc_field_status = 'mid_mountain_ok';
            }
          } else if (res.visibility === 'foggy') {
            if (res.visible_elevation_m && res.visible_elevation_m >= 1000) {
              res.visible_elevation_m = 0;
              res.bc_field_status = 'whiteout';
            }
          }

          res.status = 'ok';
          normalized.push(res);
        }

        return { items: normalized, usedModel: modelName };
      } catch (err: any) {
        lastErr = err;
      }
    }

    throw lastErr || new Error('すべてのAIモデルで解析に失敗しました。');
  };

  // 1日分の解析を実行するコア関数（6地点・最大54枚の時は自動的に前半/後半チャンクに分割してGemini 3.5 Flash Liteの精度を100%引き出す）
  const analyzeSingleDateCore = async (targetDate: string): Promise<{ results: ImageAnalysis[]; usedModel: string }> => {
    const targetLocations = getLocationsForDate(targetDate);
    const targetHours = getTargetHoursForDate(targetDate);
    const seasonMode = getSeasonModeForDate(targetDate);

    const imageUrls: string[] = [];
    for (const time of targetHours) {
      for (const loc of targetLocations) {
        imageUrls.push(`/cams/${targetDate}/${time}_${loc.id}.jpg`);
      }
    }

    const fetchResults = await Promise.all(imageUrls.map(fetchAsBase64));
    const validImages = fetchResults.filter(r => !r.isMissing);
    const dateResults: ImageAnalysis[] = [];

    fetchResults
      .filter(r => r.isMissing)
      .forEach(r => {
        dateResults.push({
          fileName: r.fileName,
          is_sunny: false,
          summit_visible: false,
          cloud_cover: -1,
          visibility: 'missing',
          visible_elevation_m: 0,
          bc_field_status: 'whiteout',
          snow_line: 'none',
          reason: '画像未記録のため解析スキップ',
          status: 'missing',
        });
      });

    if (validImages.length === 0) {
      return { results: dateResults, usedModel: 'skip' };
    }

    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
    if (!apiKey) throw new Error('VITE_GEMINI_API_KEY が設定されていません。');

    // Gemini 3.5 Flash Lite で1枚あたりの視覚注意力と出力トークン余裕を最大化するため、最大21枚ずつのチャンクに分けて送信
    const CHUNK_SIZE = 21;
    let lastUsedModel = selectedModel;

    for (let i = 0; i < validImages.length; i += CHUNK_SIZE) {
      const chunk = validImages.slice(i, i + CHUNK_SIZE);
      const { items, usedModel } = await analyzeImageChunk(targetDate, seasonMode, chunk, apiKey);
      lastUsedModel = usedModel;
      dateResults.push(...items);

      if (i + CHUNK_SIZE < validImages.length) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }

    return { results: dateResults, usedModel: lastUsedModel };
  };

  const saveDateResults = async (dateStr: string, dateResults: ImageAnalysis[]): Promise<boolean> => {
    const updated = { ...analysisResultsRef.current, [dateStr]: dateResults };
    analysisResultsRef.current = updated;
    setAnalysisResults(updated);
    setIsSyncingCloud(true);
    try {
      const cloudOk = await persistCameraAnalysisResults(updated, false);
      return cloudOk;
    } finally {
      setIsSyncingCloud(false);
    }
  };

  // 単日解析の実行
  const runSingleDayAnalysis = async () => {
    setIsAnalyzing(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const { results, usedModel } = await analyzeSingleDateCore(selectedDate);
      const cloudOk = await saveDateResults(selectedDate, results);
      setStatusMsg(
        `✅ ${selectedDate} の視界・標高・雲量AI解析（${activeTimesForSelectedDate.length}時間帯×${activeLocationsForSelectedDate.length}地点）が完了し、${
          cloudOk ? 'クラウド(月別分割Firestore)へ自動保存されました！' : 'ローカルへ保存されました。'
        }（モデル: ${usedModel}）`
      );
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // 共通バッチ解析ランナー
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
          setStatusMsg(`⏸️ 一括解析を中断しました。（${completedCount} / ${targetList.length} 日完了・クラウド保存済）`);
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

        const { results, usedModel } = await analyzeSingleDateCore(dateStr);
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
        setStatusMsg(`🎉 ${completedCount}日分の一括AI解析が完了し、すべてクラウド(Firestore月別分割)へ自動保存されました！`);
      }
    } catch (err: any) {
      setErrorMsg(`一括解析中にエラーが発生しました (${completedCount}日完了時点・完了分は保存済): ${err.message}`);
    } finally {
      setIsAnalyzing(false);
      setBatchProgress(null);
      stopRequestedRef.current = false;
    }
  };

  const runUnanalyzedBatch = () => {
    executeBatchList(unanalyzedDates);
  };

  const runCustomRangeBatch = () => {
    if (rangeStart > rangeEnd) {
      setErrorMsg('開始日は終了日以前の日付を指定してください。');
      return;
    }
    const candidates = availableDates.filter(d => d >= rangeStart && d <= rangeEnd);
    const targetList = overwriteExisting
      ? candidates
      : candidates.filter(d => !isDayAnalyzedForDate(analysisResultsRef.current[d]));

    if (targetList.length === 0) {
      setStatusMsg('指定範囲内の日付はすべて解析済みです。再解析する場合は「解析済みの日も上書き再解析する」にチェックを入れてください。');
      return;
    }
    executeBatchList(targetList);
  };

  const handleClearAllAnalysis = async () => {
    if (
      !window.confirm(
        '現在保持しているすべての雲量・視界解析データ（クラウド保存分含む）を初期化しますか？'
      )
    ) {
      return;
    }
    analysisResultsRef.current = {};
    setAnalysisResults({});
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

  const getVisibilityBadge = (vis: string, summitVisible?: boolean) => {
    switch (vis) {
      case 'clear':
        return (
          <span
            style={{
              backgroundColor: '#f59e0b',
              color: '#fff',
              padding: '0.16rem 0.48rem',
              borderRadius: '4px',
              fontSize: '0.73rem',
              fontWeight: 'bold',
            }}
          >
            ☀️ 山頂快晴
          </span>
        );
      case 'cloudy':
        return (
          <span
            style={{
              backgroundColor: '#10b981',
              color: '#fff',
              padding: '0.16rem 0.48rem',
              borderRadius: '4px',
              fontSize: '0.73rem',
              fontWeight: 'bold',
            }}
          >
            ☁️ {summitVisible === false ? '山頂雲隠れ(中腹視認)' : '曇り'}
          </span>
        );
      case 'foggy':
        return (
          <span
            style={{
              backgroundColor: '#cbd5e1',
              color: '#334155',
              padding: '0.16rem 0.48rem',
              borderRadius: '4px',
              fontSize: '0.73rem',
              fontWeight: 'bold',
            }}
          >
            🌫️ 山体ガス・不可視
          </span>
        );
      case 'missing':
        return (
          <span
            style={{
              backgroundColor: 'rgba(148, 163, 184, 0.25)',
              color: 'var(--text-secondary)',
              padding: '0.16rem 0.48rem',
              borderRadius: '4px',
              fontSize: '0.71rem',
              fontWeight: 'bold',
            }}
          >
            未記録
          </span>
        );
      default:
        return null;
    }
  };

  const getElevationBadge = (elevM: number, bcStatus: BcFieldStatus) => {
    if (bcStatus === 'alpine_clear' || elevM >= 1500) {
      return (
        <span
          style={{
            backgroundColor: 'rgba(245, 158, 11, 0.16)',
            color: '#d97706',
            border: '1px solid rgba(245, 158, 11, 0.4)',
            padding: '0.12rem 0.45rem',
            borderRadius: '4px',
            fontSize: '0.71rem',
            fontWeight: 700,
          }}
        >
          ☀️ 視界: 1700m (山頂まで快晴)
        </span>
      );
    }
    if (bcStatus === 'mid_mountain_ok' || elevM >= 800) {
      return (
        <span
          style={{
            backgroundColor: 'rgba(16, 185, 129, 0.15)',
            color: '#059669',
            border: '1px solid rgba(16, 185, 129, 0.35)',
            padding: '0.12rem 0.45rem',
            borderRadius: '4px',
            fontSize: '0.71rem',
            fontWeight: 700,
          }}
        >
          🎿 視界: 約1000m (中腹バーン◯)
        </span>
      );
    }
    if (bcStatus === 'treeline_only' || elevM >= 300) {
      return (
        <span
          style={{
            backgroundColor: 'rgba(59, 130, 246, 0.14)',
            color: '#2563eb',
            border: '1px solid rgba(59, 130, 246, 0.35)',
            padding: '0.12rem 0.45rem',
            borderRadius: '4px',
            fontSize: '0.71rem',
            fontWeight: 700,
          }}
        >
          🌲 視界: 約500m (森林帯のみ)
        </span>
      );
    }
    return (
      <span
        style={{
          backgroundColor: 'rgba(148, 163, 184, 0.18)',
          color: 'var(--text-secondary)',
          padding: '0.12rem 0.45rem',
          borderRadius: '4px',
          fontSize: '0.71rem',
          fontWeight: 700,
        }}
      >
        🚫 視界: 0m (不可視)
      </span>
    );
  };

  const getSnowLineBadge = (snowLine: SnowLineStatus) => {
    if (snowLine === 'none') return null;
    const map: Record<Exclude<SnowLineStatus, 'none'>, { label: string; color: string; bg: string }> = {
      summit_cap: { label: '❄️ 山頂部冠雪', color: '#0284c7', bg: 'rgba(2, 132, 199, 0.12)' },
      mid_slope: { label: '❄️ 中腹まで積雪', color: '#2563eb', bg: 'rgba(37, 99, 235, 0.12)' },
      full_snow: { label: '⛄ 山麓まで全面積雪', color: '#4f46e5', bg: 'rgba(79, 70, 229, 0.12)' },
    };
    const item = map[snowLine];
    return (
      <span
        style={{
          backgroundColor: item.bg,
          color: item.color,
          padding: '0.12rem 0.45rem',
          borderRadius: '4px',
          fontSize: '0.7rem',
          fontWeight: 700,
        }}
      >
        {item.label}
      </span>
    );
  };

  const unanalyzedRangeLabel = useMemo(() => {
    if (unanalyzedDates.length === 0) return '';
    const first = unanalyzedDates[0].slice(5).replace('-', '/');
    const last = unanalyzedDates[unanalyzedDates.length - 1].slice(5).replace('-', '/');
    return first === last ? first : `${first}〜${last}`;
  }, [unanalyzedDates]);

  const isCurrentDayAnalyzed = isDayAnalyzedForDate(currentResults);

  return (
    <div className="card" style={{ borderTop: '4px solid #3b82f6', marginBottom: '2rem' }}>
      {/* ===== 1. 公開・管理者共通ヘッダー ＆ 季節モード切替 ===== */}
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
              {isAdmin && (
                <>
                  <span
                    style={{
                      fontSize: '0.73rem',
                      fontWeight: 600,
                      padding: '0.18rem 0.55rem',
                      borderRadius: '999px',
                      backgroundColor: 'rgba(59, 130, 246, 0.1)',
                      color: '#2563eb',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.25rem',
                    }}
                  >
                    <Cloud size={12} />
                    {isSyncingCloud ? 'クラウド保存中...' : '月別分割クラウド保存 ON'}
                  </span>
                  <span
                    style={{
                      fontSize: '0.73rem',
                      fontWeight: 600,
                      padding: '0.18rem 0.55rem',
                      borderRadius: '999px',
                      backgroundColor:
                        storageStats.ratio >= 80 ? 'rgba(245, 158, 11, 0.15)' : 'rgba(100, 116, 139, 0.12)',
                      color: storageStats.ratio >= 80 ? '#d97706' : 'var(--text-secondary)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.25rem',
                    }}
                    title="GitHub無料枠 (1,000MB) に対するカメラ画像アーカイブ推定使用量"
                  >
                    <HardDrive size={12} />
                    容量: 約{storageStats.estMB}MB / {storageStats.limitMB}MB ({storageStats.ratio}%)
                  </span>
                </>
              )}
            </div>
            <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
              {activeSeasonMode === 'winter_bc'
                ? '🎿 冬山・BC分析モード（11〜4月）：6地点カメラ＋東面（アフトロマナイ沢）推定から、標高別視界（0〜1700m）と冠雪ラインを評価します。'
                : '🏔️ 夏山・観光分析モード（5〜10月）：早朝登山アタック〜日中の登頂コア〜夕焼けまで、6方角からの山頂（1,721m）露出と雲量を評価します。'}
            </p>
          </div>
        </div>

        {/* 右側：夏山モード / 冬山BCモード 表示切替ピル ＋ 管理者専用ツールバー */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          {/* 季節表示モード切替（選択日の月に応じて自動切替・手動で比較も可能） */}
          <div
            style={{
              display: 'inline-flex',
              backgroundColor: 'var(--bg-secondary)',
              padding: '0.2rem',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
              gap: '0.2rem',
            }}
            title="選択した日付の月に応じて自動で切り替わりますが、手動で夏山表示・冬山BC表示を切り替えて確認することも可能です"
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

          {/* 管理者モード時のみ表示されるAI解析実行・管理ボタン */}
          {isAdmin && (
            <>
              {!isAnalyzing ? (
                unanalyzedDates.length > 0 ? (
                  <button
                    onClick={runUnanalyzedBatch}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.45rem',
                      padding: '0.55rem 1.05rem',
                      borderRadius: '10px',
                      border: 'none',
                      background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                      color: '#fff',
                      fontWeight: 800,
                      fontSize: '0.84rem',
                      cursor: 'pointer',
                      boxShadow: '0 4px 12px rgba(59, 130, 246, 0.35)',
                    }}
                  >
                    <Play size={15} />
                    <span>
                      未解析分をまとめて解析 ({unanalyzedRangeLabel}・{unanalyzedDates.length}日分)
                    </span>
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
                    <span>最新日まで全日程解析済</span>
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
                    padding: '0.55rem 1.05rem',
                    borderRadius: '10px',
                    border: 'none',
                    backgroundColor: '#ef4444',
                    color: '#fff',
                    fontWeight: 800,
                    fontSize: '0.84rem',
                    cursor: 'pointer',
                  }}
                >
                  <Square size={15} />
                  <span>解析を安全に中断する</span>
                </button>
              )}

              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  padding: '0.5rem 0.8rem',
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
                <span>{showAdvanced ? '管理設定を閉じる' : '詳細・容量管理'}</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* 一括解析中の進捗バー（管理者モード実行時） */}
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

      {/* ===== 管理者専用折りたたみ設定（期間指定バッチ・AIモデル選択・JSON出力・容量ガードモニター） ===== */}
      {isAdmin && showAdvanced && (
        <div
          style={{
            padding: '1rem 1.25rem',
            backgroundColor: 'var(--bg-secondary)',
            borderRadius: '10px',
            border: '1px solid var(--border-color)',
            marginBottom: '1.25rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.9rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontWeight: 700, fontSize: '0.88rem' }}>
              <Calendar size={16} style={{ color: '#3b82f6' }} />
              <span>【管理者専用】任意期間の再解析・詳細メンテナンス・無料枠容量モニター</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem' }}>
              <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>使用AIモデル:</span>
              <select
                value={selectedModel}
                onChange={e => setSelectedModel(e.target.value)}
                disabled={isAnalyzing}
                style={{
                  padding: '0.3rem 0.55rem',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  fontWeight: 600,
                  fontSize: '0.8rem',
                }}
              >
                {CAMERA_MODELS.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', fontSize: '0.82rem' }}>
              <label style={{ fontWeight: 600 }}>期間指定:</label>
              <select
                value={rangeStart}
                onChange={e => setRangeStart(e.target.value)}
                disabled={isAnalyzing}
                style={{
                  padding: '0.35rem 0.55rem',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                }}
              >
                {availableDates.map(d => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <span>〜</span>
              <select
                value={rangeEnd}
                onChange={e => setRangeEnd(e.target.value)}
                disabled={isAnalyzing}
                style={{
                  padding: '0.35rem 0.55rem',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                }}
              >
                {availableDates.map(d => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>

              <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer', marginLeft: '0.25rem' }}>
                <input
                  type="checkbox"
                  checked={overwriteExisting}
                  onChange={e => setOverwriteExisting(e.target.checked)}
                  disabled={isAnalyzing}
                />
                <span>解析済みの日も上書き再解析する</span>
              </label>

              <button
                onClick={runCustomRangeBatch}
                disabled={isAnalyzing}
                style={{
                  padding: '0.4rem 0.85rem',
                  borderRadius: '6px',
                  border: '1px solid #3b82f6',
                  backgroundColor: 'rgba(59, 130, 246, 0.12)',
                  color: '#2563eb',
                  fontWeight: 700,
                  fontSize: '0.8rem',
                  cursor: isAnalyzing ? 'not-allowed' : 'pointer',
                }}
              >
                指定期間を実行
              </button>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                onClick={handleExportJson}
                disabled={isAnalyzing || Object.keys(analysisResults).length === 0}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  padding: '0.4rem 0.75rem',
                  borderRadius: '6px',
                  border: '1px solid #10b981',
                  backgroundColor: 'rgba(16, 185, 129, 0.08)',
                  color: '#059669',
                  fontWeight: 600,
                  fontSize: '0.78rem',
                  cursor: isAnalyzing ? 'not-allowed' : 'pointer',
                }}
              >
                <Download size={14} />
                <span>JSONバックアップ出力</span>
              </button>

              <button
                onClick={handleClearAllAnalysis}
                disabled={isAnalyzing}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  padding: '0.4rem 0.75rem',
                  borderRadius: '6px',
                  border: '1px solid rgba(239, 68, 68, 0.4)',
                  backgroundColor: 'transparent',
                  color: '#ef4444',
                  fontWeight: 600,
                  fontSize: '0.78rem',
                  cursor: isAnalyzing ? 'not-allowed' : 'pointer',
                }}
              >
                <Trash2 size={14} />
                <span>全解析データ初期化</span>
              </button>
            </div>
          </div>

          <div
            style={{
              padding: '0.75rem 1rem',
              backgroundColor: 'var(--bg-primary)',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
              fontSize: '0.78rem',
              color: 'var(--text-secondary)',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '0.75rem',
            }}
          >
            <div>
              <strong style={{ color: 'var(--text-primary)' }}>① GitHub 画像アーカイブ (上限目安 1,000MB):</strong>
              <div>
                現在 <strong>{storageStats.totalPhotos.toLocaleString()}枚</strong> (約<strong>{storageStats.estMB}MB</strong> / {storageStats.ratio}%使用)。
                800MB到達時に古い年度の画像をZIP退避すれば永久に無料運用可能です。
              </div>
            </div>
            <div>
              <strong style={{ color: 'var(--text-primary)' }}>② Firebase Hosting (上限 10,000MB):</strong>
              <div>
                <span style={{ color: '#10b981', fontWeight: 700 }}>✓ カメラJPG除外ガード適用済</span>。
                Hosting使用量は常に <strong>5MB未満</strong> に維持されます。
              </div>
            </div>
            <div>
              <strong style={{ color: 'var(--text-primary)' }}>③ Cloud Firestore (上限 1,024MB / 1doc 1MB):</strong>
              <div>
                <span style={{ color: '#10b981', fontWeight: 700 }}>✓ 月別ドキュメント分割適用済</span>。
                1ヶ月約0.2MBのため10年以上無制限に自動保存できます。
              </div>
            </div>
          </div>
        </div>
      )}

      {statusMsg && (
        <div
          style={{
            padding: '0.75rem 1rem',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            color: '#059669',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            borderRadius: '8px',
            marginBottom: '1rem',
            fontSize: '0.86rem',
            fontWeight: 600,
          }}
        >
          {statusMsg}
        </div>
      )}

      {errorMsg && (
        <div
          style={{
            padding: '0.75rem 1rem',
            backgroundColor: '#fef2f2',
            color: '#ef4444',
            border: '1px solid #f87171',
            borderRadius: '8px',
            marginBottom: '1rem',
            fontSize: '0.86rem',
            fontWeight: 600,
          }}
        >
          ⚠️ {errorMsg}
        </div>
      )}

      {/* ===== 2. 日付選択 ＆ アメダス気象 ＆ 1日の季節別コンディション総括ボード ===== */}
      <div
        style={{
          padding: '1.1rem 1.25rem',
          backgroundColor: 'var(--bg-secondary)',
          borderRadius: '12px',
          border: '1px solid var(--border-color)',
          marginBottom: '1.5rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
        }}
      >
        {/* 上段：日付セレクター・前後日移動・（管理者のみ）単日再解析ボタン */}
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
                const hasOk = isDayAnalyzedForDate(analysisResults[d]);
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
                📅 この日のAI解析はまだ実行されていません（カメラ画像は下部で閲覧可能）
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

        {/* 中段：選択日のアメダス気象データ（本泊×沓形） */}
        <div
          style={{
            paddingTop: '0.7rem',
            paddingBottom: '0.2rem',
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
              <span>
                気温: <strong>{currentWeather.tempMax}℃</strong> / {currentWeather.tempMin}℃
              </span>
              <span>
                日降水量: <strong style={{ color: currentWeather.precipitation > 0 ? '#3b82f6' : 'inherit' }}>{currentWeather.precipitation} mm</strong>
              </span>
              <span>
                最大風速: <strong>{currentWeather.windSpeedMax} m/s</strong> ({getWindDirString(currentWeather.windDirection)})
              </span>
              <span>
                日照(沓形): <strong>{currentWeather.sunshineDuration ?? '-'} h</strong>
              </span>
              {currentWeather.motodomari && currentWeather.kutsugata && (
                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  [本泊: 降水{currentWeather.motodomari.precipitation}mm・風{currentWeather.motodomari.windSpeedMax}m/s / 沓形: 降水{currentWeather.kutsugata.precipitation}mm・風{currentWeather.kutsugata.windSpeedMax}m/s]
                </span>
              )}
            </>
          ) : (
            <span style={{ color: 'var(--text-secondary)' }}>{isLoadingWeather ? '気象データ読込中...' : '気象データなし'}</span>
          )}
        </div>

        {/* 下段：閲覧者・関係者向けの「1日の季節別コンディションKPIカード群」（解析済みの日に表示） */}
        {isCurrentDayAnalyzed && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '0.75rem',
              paddingTop: '0.5rem',
            }}
          >
            {activeSeasonMode === 'summer' ? (
              <>
                {/* 夏山KPI①: 1日総合判定＆平均雲量 */}
                <div
                  style={{
                    padding: '0.75rem 0.95rem',
                    backgroundColor: 'var(--bg-primary)',
                    borderRadius: '10px',
                    border: '1px solid var(--border-color)',
                  }}
                >
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 700, marginBottom: '0.25rem' }}>
                    🏔️ 1日の山頂視界 総合判定
                  </div>
                  <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                    {dailySummary.mountainCategory === 'clear'
                      ? '🏔️ 山頂快晴日 (ピーク視認)'
                      : dailySummary.mountainCategory === 'foggy'
                      ? '🌫️ 終日ガス・山体不可視'
                      : '☁️ 曇り・山頂雲隠れ (中腹視認)'}
                  </div>
                  <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                    平均雲量: <strong>{dailySummary.avgCloudCover ?? '-'} / 10</strong> ・ 山頂露出:{' '}
                    <strong>{dailySummary.clearCount}</strong> / {dailySummary.validCount}枚
                  </div>
                </div>

                {/* 夏山KPI②: 登山行動3フェーズ別の視界推移 */}
                <div
                  style={{
                    padding: '0.75rem 0.95rem',
                    backgroundColor: 'var(--bg-primary)',
                    borderRadius: '10px',
                    border: '1px solid var(--border-color)',
                  }}
                >
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 700, marginBottom: '0.25rem' }}>
                    ⏰ 時間帯フェーズ別の視界推移
                  </div>
                  <div style={{ fontSize: '0.78rem', display: 'flex', flexDirection: 'column', gap: '0.18rem' }}>
                    <div>
                      <span style={{ color: 'var(--text-secondary)' }}>🌅 早朝(03-07時):</span>{' '}
                      <strong>{timePhaseSummary.earlyMorning.label}</strong>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-secondary)' }}>⛰️ 登頂コア(09-13時):</span>{' '}
                      <strong>{timePhaseSummary.coreMidday.label}</strong>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-secondary)' }}>🌇 午後・夕景(15-19時):</span>{' '}
                      <strong>{timePhaseSummary.afternoonEvening.label}</strong>
                    </div>
                  </div>
                </div>

                {/* 夏山KPI③: 最高視界高度＆冠雪ステータス */}
                <div
                  style={{
                    padding: '0.75rem 0.95rem',
                    backgroundColor: 'var(--bg-primary)',
                    borderRadius: '10px',
                    border: '1px solid var(--border-color)',
                  }}
                >
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 700, marginBottom: '0.25rem' }}>
                    📏 本日の視界到達標高 ＆ 季節変化
                  </div>
                  <div style={{ fontSize: '1.02rem', fontWeight: 800, color: '#059669' }}>
                    最高視界上限: 約 {dailySummary.maxVisibleElevationM ?? 0} m
                  </div>
                  <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                    {dailySummary.morningClearAfternoonFoggy
                      ? '⚠️ 朝は山頂快晴 ➔ 昼からガス湧きパターン'
                      : dailySummary.dominantSnowLine !== 'none'
                      ? '❄️ 山体に冠雪・積雪を確認'
                      : '☀️ 日差し確認率: ' + Math.round(dailySummary.sunnyRatio * 100) + '%'}
                  </div>
                </div>
              </>
            ) : (
              <>
                {/* 冬山・BC KPI①: 滑走コアタイム視界高度＆最大雲底高度 */}
                <div
                  style={{
                    padding: '0.75rem 0.95rem',
                    backgroundColor: 'var(--bg-primary)',
                    borderRadius: '10px',
                    border: '1px solid rgba(37, 99, 235, 0.35)',
                  }}
                >
                  <div style={{ fontSize: '0.75rem', color: '#2563eb', fontWeight: 700, marginBottom: '0.25rem' }}>
                    🎿 BC滑走コアタイム(09-13時) 視界上限
                  </div>
                  <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                    {dailySummary.coreTimeElevationM === 1700
                      ? '🏔️ 1,700m (山頂アルパインまで視界◯)'
                      : dailySummary.coreTimeElevationM === 1000
                      ? '🎿 1,000m (中腹オープンバーン視界◯)'
                      : dailySummary.coreTimeElevationM === 500
                      ? '🌲 500m (森林限界・ツリーラン帯のみ)'
                      : '🚫 0m (ホワイトアウト・山体不可視)'}
                  </div>
                  <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                    1日最高視界高度: <strong>約{dailySummary.maxVisibleElevationM ?? 0}m</strong> / 平均雲量:{' '}
                    <strong>{dailySummary.avgCloudCover ?? '-'}</strong>
                  </div>
                </div>

                {/* 冬山・BC KPI②: 東面（アフトロマナイ沢）推定コンディション */}
                <div
                  style={{
                    padding: '0.75rem 0.95rem',
                    backgroundColor: 'var(--bg-primary)',
                    borderRadius: '10px',
                    border: '1px solid rgba(139, 92, 246, 0.35)',
                  }}
                >
                  <div
                    style={{
                      fontSize: '0.75rem',
                      color: '#7c3aed',
                      fontWeight: 700,
                      marginBottom: '0.25rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.3rem',
                    }}
                  >
                    <Compass size={14} />
                    <span>東面（アフトロマナイ沢方面）推定視界</span>
                  </div>
                  <div style={{ fontSize: '1.02rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                    {eastEstimate.elevationM !== null
                      ? `約 ${eastEstimate.elevationM} m (${
                          eastEstimate.elevationM >= 1500
                            ? '上部アルパイン◯'
                            : eastEstimate.elevationM >= 800
                            ? '中腹バーン視界◯'
                            : eastEstimate.elevationM >= 300
                            ? '樹林帯のみ'
                            : '視界不良'
                        })`
                      : 'データなし'}
                  </div>
                  <div style={{ fontSize: '0.73rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                    ※{eastEstimate.note}
                  </div>
                </div>

                {/* 冬山・BC KPI③: 冠雪・積雪ライン＆BC行動フェーズ推移 */}
                <div
                  style={{
                    padding: '0.75rem 0.95rem',
                    backgroundColor: 'var(--bg-primary)',
                    borderRadius: '10px',
                    border: '1px solid var(--border-color)',
                  }}
                >
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 700, marginBottom: '0.25rem' }}>
                    ❄️ 積雪ライン ＆ 時間帯推移
                  </div>
                  <div style={{ fontSize: '0.92rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '0.2rem' }}>
                    {dailySummary.dominantSnowLine === 'full_snow'
                      ? '⛄ 山麓(0m)まで全面積雪'
                      : dailySummary.dominantSnowLine === 'mid_slope'
                      ? '❄️ 中腹(500〜1000m)まで積雪'
                      : dailySummary.dominantSnowLine === 'summit_cap'
                      ? '🏔️ 山頂部(1200m+)のみ冠雪'
                      : '🌿 積雪なし（または雲隠れ）'}
                  </div>
                  <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                    朝出撃(07時): <strong>{timePhaseSummary.earlyMorning.maxElev ?? '-'}m</strong> ➔ 滑走(09-13時):{' '}
                    <strong>{timePhaseSummary.coreMidday.maxElev ?? '-'}m</strong> ➔ 下山(15時):{' '}
                    <strong>{timePhaseSummary.afternoonEvening.maxElev ?? '-'}m</strong>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ===== 3. ひと目でわかる！「時間帯 × 方角（6地点＋東面推定）視界・標高マトリクス早見表」 ===== */}
      {isCurrentDayAnalyzed && (
        <div
          style={{
            marginBottom: '1.75rem',
            padding: '1rem 1.15rem',
            backgroundColor: 'var(--bg-primary)',
            borderRadius: '12px',
            border: '1px solid var(--border-color)',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '0.5rem',
              marginBottom: '0.75rem',
            }}
          >
            <div style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <span>📊 {selectedDate} 時間帯 × 斜面方角別 視界・雲底高度マトリクス</span>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                （セルをクリックするとその時間のカメラ画像を拡大表示します）
              </span>
            </div>
            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', fontSize: '0.73rem', fontWeight: 700 }}>
              <span style={{ color: '#d97706' }}>☀️ 1700m: 山頂快晴</span>
              <span style={{ color: '#059669' }}>🎿 1000m: 中腹バーン◯</span>
              <span style={{ color: '#2563eb' }}>🌲 500m: 森林帯のみ</span>
              <span style={{ color: '#64748b' }}>🌫️ 0m: ガス・不可視</span>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', minWidth: '620px' }}>
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-secondary)', borderBottom: '2px solid var(--border-color)' }}>
                  <th style={{ textAlign: 'left', padding: '0.5rem 0.65rem', fontWeight: 800 }}>
                    カメラ地点 / 斜面方角
                  </th>
                  {activeTimesForSelectedDate.map(t => (
                    <th key={t} style={{ textAlign: 'center', padding: '0.5rem 0.4rem', fontWeight: 800 }}>
                      {t}:00
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeLocationsForSelectedDate.map(loc => (
                  <tr key={loc.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '0.5rem 0.65rem', fontWeight: 700 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <span
                          style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            backgroundColor: loc.color,
                            display: 'inline-block',
                          }}
                        />
                        <span>{loc.name}</span>
                      </div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 500, marginLeft: '1.1rem' }}>
                        {loc.bcSlopeName}
                      </div>
                    </td>
                    {activeTimesForSelectedDate.map(t => {
                      const fileName = `${t}_${loc.id}.jpg`;
                      const rec = currentResults?.find(r => r.fileName === fileName);
                      if (!rec || rec.status === 'missing' || rec.visibility === 'missing') {
                        return (
                          <td
                            key={t}
                            style={{
                              textAlign: 'center',
                              padding: '0.45rem 0.35rem',
                              color: 'var(--text-secondary)',
                              fontSize: '0.72rem',
                            }}
                          >
                            -
                          </td>
                        );
                      }
                      const { elevationM, bcStatus } = getEffectiveElevation(rec);
                      const bg =
                        bcStatus === 'alpine_clear'
                          ? 'rgba(245, 158, 11, 0.16)'
                          : bcStatus === 'mid_mountain_ok'
                          ? 'rgba(16, 185, 129, 0.15)'
                          : bcStatus === 'treeline_only'
                          ? 'rgba(59, 130, 246, 0.14)'
                          : 'rgba(148, 163, 184, 0.15)';
                      const fg =
                        bcStatus === 'alpine_clear'
                          ? '#d97706'
                          : bcStatus === 'mid_mountain_ok'
                          ? '#059669'
                          : bcStatus === 'treeline_only'
                          ? '#2563eb'
                          : '#64748b';
                      const icon =
                        bcStatus === 'alpine_clear'
                          ? '☀️'
                          : bcStatus === 'mid_mountain_ok'
                          ? '🎿'
                          : bcStatus === 'treeline_only'
                          ? '🌲'
                          : '🌫️';
                      return (
                        <td key={t} style={{ textAlign: 'center', padding: '0.35rem' }}>
                          <button
                            onClick={() =>
                              setModalImage({
                                url: getCamImageUrl(`cams/${selectedDate}/${fileName}`),
                                title: `${loc.name} - ${selectedDate} ${t}:00`,
                                sub: rec.reason,
                              })
                            }
                            style={{
                              width: '100%',
                              padding: '0.32rem 0.3rem',
                              borderRadius: '6px',
                              border: `1px solid ${fg}40`,
                              backgroundColor: bg,
                              color: fg,
                              fontWeight: 800,
                              fontSize: '0.74rem',
                              cursor: 'pointer',
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              lineHeight: 1.2,
                            }}
                            title={rec.reason}
                          >
                            <span>
                              {icon} {elevationM}m
                            </span>
                            <span style={{ fontSize: '0.65rem', fontWeight: 600, opacity: 0.85 }}>
                              雲量{rec.cloud_cover}
                            </span>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}

                {/* 🧭 東面（アフトロマナイ沢）仮想補完行（オタドマリまたは姫沼がある場合に表示） */}
                {activeLocationsForSelectedDate.some(l => l.id === 'otadomari' || l.id === 'himenuma') && (
                  <tr
                    style={{
                      backgroundColor: 'rgba(139, 92, 246, 0.05)',
                      borderTop: '2px dashed rgba(139, 92, 246, 0.3)',
                    }}
                  >
                    <td style={{ padding: '0.5rem 0.65rem', fontWeight: 700 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#7c3aed' }}>
                        <Compass size={13} />
                        <span>【東面推定】アフトロマナイ沢</span>
                      </div>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', fontWeight: 500, marginLeft: '1.1rem' }}>
                        北東(オチュウシナイ沢)＋南東(ヤムナイ沢)から推定
                      </div>
                    </td>
                    {activeTimesForSelectedDate.map(t => {
                      const otaRec = currentResults?.find(r => r.fileName === `${t}_otadomari.jpg`);
                      const himeRec = currentResults?.find(r => r.fileName === `${t}_himenuma.jpg`);
                      const ferryRec = currentResults?.find(r => r.fileName === `${t}_ferry.jpg`);

                      const otaElev =
                        otaRec && otaRec.status === 'ok' ? getEffectiveElevation(otaRec).elevationM : null;
                      const neRec =
                        himeRec && himeRec.status === 'ok'
                          ? himeRec
                          : ferryRec && ferryRec.status === 'ok'
                          ? ferryRec
                          : null;
                      const neElev = neRec ? getEffectiveElevation(neRec).elevationM : null;

                      const vals = [otaElev, neElev].filter((v): v is number => v !== null);
                      if (vals.length === 0) {
                        return (
                          <td key={t} style={{ textAlign: 'center', padding: '0.4rem', color: 'var(--text-secondary)', fontSize: '0.72rem' }}>
                            -
                          </td>
                        );
                      }
                      const avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
                      const snapped = avg >= 1450 ? 1700 : avg >= 750 ? 1000 : avg >= 250 ? 500 : 0;
                      return (
                        <td
                          key={t}
                          style={{
                            textAlign: 'center',
                            padding: '0.4rem',
                            fontWeight: 800,
                            fontSize: '0.74rem',
                            color: '#7c3aed',
                          }}
                        >
                          🧭 約{snapped}m
                        </td>
                      );
                    })}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===== 4. 時間帯別 カメラ画像＆AI判定一覧 ===== */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {activeTimesForSelectedDate.map(time => (
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
              <span
                style={{
                  backgroundColor: 'var(--accent-primary, #3b82f6)',
                  color: '#fff',
                  fontWeight: 800,
                  fontSize: '0.85rem',
                  padding: '0.15rem 0.6rem',
                  borderRadius: '6px',
                }}
              >
                {time}:00
              </span>
              <span style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {selectedDate} {time}時台の視界・カメラ画像 ({activeLocationsForSelectedDate.length}地点)
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(265px, 1fr))', gap: '1rem' }}>
              {activeLocationsForSelectedDate.map(loc => {
                const fileName = `${time}_${loc.id}.jpg`;
                const relPath = `cams/${selectedDate}/${fileName}`;
                const cdnUrl = getCamImageUrl(relPath);
                const localUrl = `/${relPath}`;
                const imgKey = `${selectedDate}_${fileName}`;
                const isBroken = !!brokenImages[imgKey];

                const result = currentResults?.find(r => r.fileName === fileName);
                const isMissingResult = result?.status === 'missing' || result?.visibility === 'missing';
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
                    {/* カードヘッダー */}
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
                        <span
                          style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            backgroundColor: loc.color,
                            display: 'inline-block',
                          }}
                        />
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

                    {/* 画像表示エリア */}
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
                          <div
                            style={{
                              position: 'absolute',
                              top: '0.4rem',
                              right: '0.4rem',
                              backgroundColor: 'rgba(0, 0, 0, 0.55)',
                              color: '#fff',
                              padding: '0.25rem',
                              borderRadius: '4px',
                              display: 'flex',
                            }}
                          >
                            <Maximize2 size={13} />
                          </div>
                        </>
                      ) : (
                        <div
                          style={{
                            width: '100%',
                            height: '100%',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'var(--text-secondary)',
                            gap: '0.35rem',
                            padding: '0.75rem',
                            textAlign: 'center',
                          }}
                        >
                          <VideoOff size={26} style={{ opacity: 0.45 }} />
                          <span style={{ fontSize: '0.76rem', fontWeight: 600 }}>
                            {loc.id === 'himenuma' && activeSeasonMode === 'winter_bc'
                              ? 'カメラ休止中・未記録'
                              : 'この時間の記録画像はありません'}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* AI解析結果フッター */}
                    <div style={{ padding: '0.65rem 0.75rem', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                      {result && !isMissingResult && elevInfo ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.25rem' }}>
                            {getVisibilityBadge(result.visibility, result.summit_visible)}
                            <span
                              style={{
                                fontSize: '0.73rem',
                                fontWeight: 700,
                                color: result.is_sunny ? '#f59e0b' : 'var(--text-secondary)',
                              }}
                            >
                              {result.is_sunny ? '☀️ 日差し' : '☁️ 日差しなし'} (雲量 {result.cloud_cover}/10)
                            </span>
                          </div>

                          {/* 標高別視界上限バッジ ＆ 冠雪バッジ */}
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
        ))}
      </div>

      {/* 画像拡大モーダル */}
      {modalImage && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1.25rem',
          }}
          onClick={() => setModalImage(null)}
        >
          <div
            style={{
              maxWidth: '900px',
              width: '100%',
              backgroundColor: 'var(--bg-secondary)',
              borderRadius: '12px',
              overflow: 'hidden',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div
              style={{
                padding: '0.85rem 1.25rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderBottom: '1px solid var(--border-color)',
                fontWeight: 700,
              }}
            >
              <span>{modalImage.title}</span>
              <button
                onClick={() => setModalImage(null)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-secondary)',
                  display: 'flex',
                }}
              >
                <X size={22} />
              </button>
            </div>
            <div style={{ backgroundColor: '#000', display: 'flex', justifyContent: 'center' }}>
              <img
                src={modalImage.url}
                alt={modalImage.title}
                style={{ maxWidth: '100%', maxHeight: '75vh', objectFit: 'contain' }}
              />
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
