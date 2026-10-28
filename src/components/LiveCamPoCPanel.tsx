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
} from 'lucide-react';
import {
  type ImageAnalysis,
  evaluateDailyCameraVisibility,
  cleanupObsoleteLocalStorageCaches,
  persistCameraAnalysisResults,
} from '../hooks/useCameraAnalysis';
import { loadCameraAnalysisFromFirestore } from '../utils/firebaseStorage';
import { fetchWeatherData, type WeatherData } from '../utils/weatherApi';
import { getHistoryJsonUrl, getCamImageUrl } from '../utils/camUrl';

const ALL_LOCATIONS = [
  { id: 'oshidomari', name: '鴛泊(本泊・北)', color: '#3b82f6', isCore: true },
  { id: 'ferry', name: '鴛泊港(フェリー・北)', color: '#0284c7', isCore: false },
  { id: 'himenuma', name: '姫沼(北東)', color: '#059669', isCore: false },
  { id: 'kutsugata', name: '沓形(西)', color: '#10b981', isCore: true },
  { id: 'otadomari', name: 'オタドマリ沼(南東)', color: '#8b5cf6', isCore: false },
  { id: 'senposhi', name: '仙法志(南)', color: '#f59e0b', isCore: true },
];

// 2時間おき・7回 (05, 07, 09, 11, 13, 15, 17時 × 3〜6地点)
const TIMES = ['05', '07', '09', '11', '13', '15', '17'];

// 7回解析フォーマットで解析完了しているかの判定ヘルパー
function isDayAnalyzed7Slots(records?: ImageAnalysis[]): boolean {
  if (!records || records.length === 0) return false;
  const hasOk = records.some(c => c.status === 'ok');
  const has7Slot = records.some(c => c.fileName.startsWith('07_') || c.fileName.startsWith('09_'));
  return hasOk && has7Slot;
}

// レート制限 (500 RPD / 15 RPM) に最適化されたモデルチェーン
const CAMERA_MODELS = [
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite (推奨: 500回/日・15回/分)' },
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite (予備: 500回/日・15回/分)' },
  { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash (高精度・上限20回/日)' },
];

const STRICT_SYSTEM_PROMPT = `あなたは北海道・利尻山（独立峰・標高1,721m）の山岳気象・視界判定の専門AIアナリストです。
定点ライブカメラ（oshidomari=北側・本泊、ferry=北側・鴛泊港、himenuma=北東・姫沼、kutsugata=西側・沓形、otadomari=南東・オタドマリ沼、senposhi=南側・仙法志）の画像から、登山者・観光客にとって最も重要な「利尻山の山体および山頂（ピーク）が見えているか」と「空全体の雲量」を厳密に区別して判定してください。

【最重要：判定の厳格ルール】
1. 手前の海・港・沼・市街地・道路の天気に惑わされないでください。常に画角中央〜奥にそびえる「利尻山の山体・山頂ピーク」を基準に視界(visibility)を判定してください。
2. summit_visible (boolean):
   - true: 利尻山の山頂（最高峰の尖ったピーク部分）が雲や霧に隠れず、明確に輪郭まで見えている場合のみ true。
   - false: 山頂部に笠雲・山岳波雲・ガスがかかって隠れている場合や、山全体が見えない場合は必ず false。
3. visibility ('clear' | 'cloudy' | 'foggy'):
   - 'clear' (山頂快晴・視界良好): 山頂ピークから稜線・山麓まで雲に隠れずクッキリ見えている状態（summit_visible が true であることが絶対条件。空に青空が見えていても、山頂ピークが雲に隠れていれば絶対に 'clear' にしてはいけません）。
   - 'cloudy' (山頂雲隠れ・一部視認): 山の裾野〜中腹（稜線の一部）は見えているが、山頂（ピーク）付近が雲や笠雲に隠れている状態。または高曇りで山全体の輪郭は見えるが厚い雲で日差しがない状態。
   - 'foggy' (山体ガス・視界不良・山体不可視): 低い雲・濃霧（ガス）・悪天候により、利尻山の山体全体（または中腹から上の大部分）が白や灰色の雲に覆われて見えない状態。※カメラ手前の町や海・沼が見えていても、肝心の「山」が見えなければ必ず 'foggy' と判定してください。
4. cloud_cover (0〜10の整数):
   - 0〜2: 快晴（雲がほとんどない）
   - 3〜5: 晴れ（一部に雲があるが青空が多い、または山頂のみ笠雲）
   - 6〜8: 曇り（空の大部分が雲に覆われている）
   - 9〜10: 全天曇天・濃霧（空全体が隙間なく雲または真っ白なガスに覆われている）
5. is_sunny (boolean):
   - 青空が明確に見える、または山体・地表に直射日光が当たっている場合は true。`;

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

export const LiveCamPoCPanel: React.FC = () => {
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

  const [weatherMap, setWeatherMap] = useState<Record<string, WeatherData>>({});
  const [isLoadingWeather, setIsLoadingWeather] = useState(true);

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSyncingCloud, setIsSyncingCloud] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{
    current: number;
    total: number;
    currentDate: string;
    activeModel: string;
  } | null>(null);
  const stopRequestedRef = useRef<boolean>(false);

  const [analysisResults, setAnalysisResults] = useState<Record<string, ImageAnalysis[]>>({});
  const analysisResultsRef = useRef<Record<string, ImageAnalysis[]>>({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // 画像読み込み失敗（本当に画像ファイルが存在しない枠）の記録と拡大モーダル
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({});
  const [modalImage, setModalImage] = useState<{ url: string; title: string; sub?: string } | null>(null);

  useEffect(() => {
    setBrokenImages({});
  }, [selectedDate]);

  useEffect(() => {
    cleanupObsoleteLocalStorageCaches();

    const initDatesAndWeather = async () => {
      let maxDate = getTodayJstStr();
      try {
        let hRes = await fetch(getHistoryJsonUrl());
        if (!hRes.ok) {
          hRes = await fetch('/cams/history.json?t=' + Date.now());
        }
        if (hRes.ok) {
          const hData = await hRes.json();
          const recs = hData?.records || {};
          setHistoryRecords(recs);
          const hDates = Object.keys(recs).sort();
          if (hDates.length > 0) {
            const lastH = hDates[hDates.length - 1];
            if (lastH > maxDate) maxDate = lastH;
          }
        }
      } catch {}

      setLatestEndDate(maxDate);
      setRangeEnd(prev => (prev < maxDate ? maxDate : prev));

      try {
        const wData = await fetchWeatherData(45.178, 141.242, '2026-07-28', maxDate);
        setWeatherMap(wData);
      } catch (err) {
        console.error('Weather load error:', err);
      } finally {
        setIsLoadingWeather(false);
      }
    };

    initDatesAndWeather();

    const initCameraResults = async () => {
      const isClearedLocal = localStorage.getItem('tozan_weather_analysis_cleared') === 'true';
      let localData: Record<string, ImageAnalysis[]> = {};
      try {
        const cached = localStorage.getItem('tozan_weather_analysis_cache');
        if (cached) localData = JSON.parse(cached);
      } catch {}

      if (Object.keys(localData).length > 0) {
        analysisResultsRef.current = localData;
        setAnalysisResults(localData);
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

      analysisResultsRef.current = merged;
      setAnalysisResults(merged);
      try {
        if (Object.keys(merged).length > 0) {
          localStorage.setItem('tozan_weather_analysis_cache', JSON.stringify(merged));
        }
      } catch {}
    };

    initCameraResults();
  }, []);

  // 無料枠ストレージ容量メーターの算出
  const storageStats = useMemo(() => {
    let totalPhotos = 0;
    Object.values(historyRecords).forEach(dayObj => {
      if (!dayObj) return;
      Object.values(dayObj).forEach(hrObj => {
        if (!hrObj) return;
        Object.keys(hrObj).forEach(k => {
          if (k !== 'timestamp') totalPhotos++;
        });
      });
    });
    if (totalPhotos === 0) totalPhotos = 6164; // フォールバック初期値
    const estMB = Math.round((totalPhotos * 43) / 1024); // 平均43KB/枚
    const limitMB = 1000; // GitHub Free 1,000MB 目安
    const ratio = Math.min(100, Math.round((estMB / limitMB) * 100));
    return { totalPhotos, estMB, limitMB, ratio };
  }, [historyRecords]);

  // 指定日に表示・解析すべきカメラ地点リスト（2026-10-27以前は3地点、2026-10-28以降または6地点記録日は6地点）
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

  const currentWeather = weatherMap[selectedDate];
  const currentResults = analysisResults[selectedDate];
  const dailySummary = useMemo(() => evaluateDailyCameraVisibility(currentResults), [currentResults]);

  // 未解析の日付リスト（実際のデータから動的に算出）
  const unanalyzedDates = useMemo(() => {
    return availableDates.filter(d => !isDayAnalyzed7Slots(analysisResults[d]));
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

  // 1日分の解析を実行するコア関数（モデル自動フォールバック付き・3〜6地点自動対応）
  const analyzeSingleDateCore = async (targetDate: string): Promise<{ results: ImageAnalysis[]; usedModel: string }> => {
    const targetLocations = getLocationsForDate(targetDate);
    const imageUrls: string[] = [];
    for (const time of TIMES) {
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
          reason: '画像未記録のため解析スキップ',
          status: 'missing',
        });
      });

    if (validImages.length === 0) {
      return { results: dateResults, usedModel: 'skip' };
    }

    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
    if (!apiKey) throw new Error('VITE_GEMINI_API_KEY が設定されていません。');

    const parts: any[] = [
      {
        text: `対象日 ${targetDate} の利尻山ライブカメラ画像群です。各画像の fileName ごとに、厳格ルールに従って summit_visible, visibility, cloud_cover, is_sunny, reason をJSON配列で返してください。`,
      },
    ];
    for (const img of validImages) {
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
                responseSchema: {
                  type: 'ARRAY',
                  items: {
                    type: 'OBJECT',
                    properties: {
                      fileName: { type: 'STRING' },
                      summit_visible: { type: 'BOOLEAN' },
                      is_sunny: { type: 'BOOLEAN' },
                      cloud_cover: { type: 'INTEGER' },
                      visibility: { type: 'STRING' },
                      reason: { type: 'STRING' },
                    },
                    required: ['fileName', 'summit_visible', 'is_sunny', 'cloud_cover', 'visibility', 'reason'],
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
          res.status = 'ok';
          dateResults.push(res);
        }

        return { results: dateResults, usedModel: modelName };
      } catch (err: any) {
        lastErr = err;
      }
    }

    throw lastErr || new Error('すべてのAIモデルで解析に失敗しました。');
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
        `✅ ${selectedDate} の山頂視界・雲量解析（7時間帯×${activeLocationsForSelectedDate.length}地点）が完了し、${
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

  // ワンクリック：未解析の日だけを自動抽出して一括解析
  const runUnanalyzedBatch = () => {
    executeBatchList(unanalyzedDates);
  };

  // 詳細設定用：指定した期間の一括解析
  const runCustomRangeBatch = () => {
    if (rangeStart > rangeEnd) {
      setErrorMsg('開始日は終了日以前の日付を指定してください。');
      return;
    }
    const candidates = availableDates.filter(d => d >= rangeStart && d <= rangeEnd);
    const targetList = overwriteExisting
      ? candidates
      : candidates.filter(d => !isDayAnalyzed7Slots(analysisResultsRef.current[d]));

    if (targetList.length === 0) {
      setStatusMsg('指定範囲内の日付はすべて解析済みです。再解析する場合は「解析済みの日も上書き再解析する」にチェックを入れてください。');
      return;
    }
    executeBatchList(targetList);
  };

  // 全解析データの完全クリア
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

  // analysis_results.json としてダウンロード保存
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
              backgroundColor: '#10b981',
              color: '#fff',
              padding: '0.18rem 0.5rem',
              borderRadius: '4px',
              fontSize: '0.74rem',
              fontWeight: 'bold',
            }}
          >
            🏔️ 山頂快晴
          </span>
        );
      case 'cloudy':
        return (
          <span
            style={{
              backgroundColor: '#64748b',
              color: '#fff',
              padding: '0.18rem 0.5rem',
              borderRadius: '4px',
              fontSize: '0.74rem',
              fontWeight: 'bold',
            }}
          >
            ☁️ {summitVisible === false ? '山頂雲隠れ' : '曇り'}
          </span>
        );
      case 'foggy':
        return (
          <span
            style={{
              backgroundColor: '#cbd5e1',
              color: '#334155',
              padding: '0.18rem 0.5rem',
              borderRadius: '4px',
              fontSize: '0.74rem',
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
              padding: '0.18rem 0.5rem',
              borderRadius: '4px',
              fontSize: '0.72rem',
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

  // 未解析日の範囲テキスト（例: "10/27 〜 10/28" または "10/28"）
  const unanalyzedRangeLabel = useMemo(() => {
    if (unanalyzedDates.length === 0) return '';
    const first = unanalyzedDates[0].slice(5).replace('-', '/');
    const last = unanalyzedDates[unanalyzedDates.length - 1].slice(5).replace('-', '/');
    return first === last ? first : `${first}〜${last}`;
  }, [unanalyzedDates]);

  return (
    <div className="card" style={{ borderTop: '4px solid #3b82f6', marginBottom: '2rem' }}>
      {/* ===== 1. シンプル＆クリーンなヘッダー ＋ 未解析ワンクリックバー ===== */}
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
              background: 'linear-gradient(135deg, #3b82f6, #10b981)',
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
                🏔️ 山頂視界・雲量AI 解析ビューア＆マネージャー
              </h3>
              <span
                style={{
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  padding: '0.2rem 0.65rem',
                  borderRadius: '999px',
                  backgroundColor: 'rgba(16, 185, 129, 0.15)',
                  color: '#10b981',
                }}
              >
                解析済: {analyzedDaysCount} / {availableDates.length}日
              </span>
              <span
                style={{
                  fontSize: '0.74rem',
                  fontWeight: 600,
                  padding: '0.2rem 0.55rem',
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
                  fontSize: '0.74rem',
                  fontWeight: 600,
                  padding: '0.2rem 0.55rem',
                  borderRadius: '999px',
                  backgroundColor: storageStats.ratio >= 80 ? 'rgba(245, 158, 11, 0.15)' : 'rgba(100, 116, 139, 0.12)',
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
            </div>
            <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
              1日7回（05〜17時の2時間おき・最大6地点）のカメラ画像から、山頂の露出状況と雲量をAI判定します。
            </p>
          </div>
        </div>

        {/* 右側：未解析分のワンクリック実行ボタン ＆ 詳細設定トグル */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          {!isAnalyzing ? (
            unanalyzedDates.length > 0 ? (
              <button
                onClick={runUnanalyzedBatch}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                  padding: '0.6rem 1.15rem',
                  borderRadius: '10px',
                  border: 'none',
                  background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                  color: '#fff',
                  fontWeight: 800,
                  fontSize: '0.88rem',
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(59, 130, 246, 0.35)',
                }}
              >
                <Play size={16} />
                <span>
                  未解析分をまとめて解析 ({unanalyzedRangeLabel}・{unanalyzedDates.length}日分)
                </span>
              </button>
            ) : (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  padding: '0.5rem 0.95rem',
                  borderRadius: '10px',
                  backgroundColor: 'rgba(16, 185, 129, 0.12)',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  color: '#059669',
                  fontWeight: 700,
                  fontSize: '0.84rem',
                }}
              >
                <CheckCircle2 size={16} />
                <span>最新日まで全日程の解析完了</span>
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
                padding: '0.6rem 1.15rem',
                borderRadius: '10px',
                border: 'none',
                backgroundColor: '#ef4444',
                color: '#fff',
                fontWeight: 800,
                fontSize: '0.88rem',
                cursor: 'pointer',
              }}
            >
              <Square size={16} />
              <span>解析を安全に中断する</span>
            </button>
          )}

          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              padding: '0.55rem 0.85rem',
              borderRadius: '8px',
              border: showAdvanced ? '1px solid #3b82f6' : '1px solid var(--border-color)',
              backgroundColor: showAdvanced ? 'rgba(59, 130, 246, 0.1)' : 'var(--bg-secondary)',
              color: showAdvanced ? '#3b82f6' : 'var(--text-secondary)',
              fontWeight: 600,
              fontSize: '0.82rem',
              cursor: 'pointer',
            }}
            title="期間を指定した再解析やバックアップ出力・容量管理を開きます"
          >
            <SlidersHorizontal size={15} />
            <span>{showAdvanced ? '詳細設定を閉じる' : '詳細・容量管理'}</span>
          </button>
        </div>
      </div>

      {/* 一括解析中の進捗バー */}
      {batchProgress && (
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

      {/* ===== 折りたたみ式：詳細設定（期間指定バッチ・AIモデル選択・JSONバックアップ・無料枠容量ガード状況） ===== */}
      {showAdvanced && (
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
              <span>任意期間の再解析・詳細メンテナンス・無料枠容量モニター</span>
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

          {/* 無料枠3重容量ガードのステータス表示 */}
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
                800MB到達時（約1.5〜2年後）に古い年度の画像フォルダをZIP退避すれば永久に無料運用可能です。
              </div>
            </div>
            <div>
              <strong style={{ color: 'var(--text-primary)' }}>② Firebase Hosting (上限 10,000MB):</strong>
              <div>
                <span style={{ color: '#10b981', fontWeight: 700 }}>✓ カメラJPG除外ガード適用済</span>。
                画像はGitHub Pages CDNから直接配信されるため、Hosting使用量は常に <strong>5MB未満</strong> に維持されます。
              </div>
            </div>
            <div>
              <strong style={{ color: 'var(--text-primary)' }}>③ Cloud Firestore (上限 1,024MB / 1doc 1MB):</strong>
              <div>
                <span style={{ color: '#10b981', fontWeight: 700 }}>✓ 月別ドキュメント分割 (camera_ai_month_YYYY-MM) 適用済</span>。
                1ヶ月あたり約0.2MBのため、10年以上無制限に自動保存できます。
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

      {/* ===== 2. メイン操作：日付選択 ＆ 1日の総合判定・アメダスサマリーバー ===== */}
      <div
        style={{
          padding: '1rem 1.25rem',
          backgroundColor: 'var(--bg-secondary)',
          borderRadius: '12px',
          border: '1px solid var(--border-color)',
          marginBottom: '1.5rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.9rem',
        }}
      >
        {/* 上段：日付セレクター・前後日移動・単日再解析ボタン */}
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
                const hasOk = isDayAnalyzed7Slots(analysisResults[d]);
                return (
                  <option key={d} value={d}>
                    {d} {hasOk ? '✓ 解析済' : '（未解析）'}
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
            {isDayAnalyzed7Slots(currentResults) ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.88rem' }}>
                <span style={{ color: '#10b981', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                  <CheckCircle2 size={16} /> 解析済
                </span>
                <span style={{ color: 'var(--border-color)' }}>|</span>
                <span>
                  1日総合判定:{' '}
                  <strong>
                    {dailySummary.mountainCategory === 'clear'
                      ? '🏔️ 山頂快晴'
                      : dailySummary.mountainCategory === 'foggy'
                      ? '🌫️ 終日ガス'
                      : '☁️ 曇り・山頂雲隠れ'}
                  </strong>
                </span>
                {dailySummary.avgCloudCover !== null && (
                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
                    (平均雲量: {dailySummary.avgCloudCover}/10)
                  </span>
                )}
              </div>
            ) : (
              <span style={{ fontSize: '0.85rem', color: '#f59e0b', fontWeight: 700 }}>⚠️ この日はまだAI解析されていません</span>
            )}

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
              <span>{isDayAnalyzed7Slots(currentResults) ? 'この日を再解析' : 'この日をAI解析する'}</span>
            </button>
          </div>
        </div>

        {/* 下段：選択日のアメダス気象データ（横一列コンパクト表示） */}
        <div
          style={{
            paddingTop: '0.75rem',
            borderTop: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '1.25rem',
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
      </div>

      {/* ===== 3. 時間帯別 カメラ画像＆AI判定一覧（7時間帯 × 3〜6地点） ===== */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {TIMES.map(time => (
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
                {selectedDate} {time}時台の山頂視界・カメラ画像 ({activeLocationsForSelectedDate.length}地点)
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
              {activeLocationsForSelectedDate.map(loc => {
                const fileName = `${time}_${loc.id}.jpg`;
                const relPath = `cams/${selectedDate}/${fileName}`;
                const cdnUrl = getCamImageUrl(relPath);
                const localUrl = `/${relPath}`;
                const imgKey = `${selectedDate}_${fileName}`;
                const isBroken = !!brokenImages[imgKey];

                const result = currentResults?.find(r => r.fileName === fileName);
                const isMissingResult = result?.status === 'missing' || result?.visibility === 'missing';

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
                        fontSize: '0.85rem',
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
                            fontSize: '0.72rem',
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

                    {/* 画像表示エリア（GitHub Pages CDN優先 ➔ ローカルフォールバック ➔ 未記録時は明確なプレースホルダー） */}
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
                            title: `${loc.name} - ${selectedDate} ${time}:00`,
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
                          <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>この時間の記録画像はありません</span>
                        </div>
                      )}
                    </div>

                    {/* AI解析結果フッター */}
                    <div style={{ padding: '0.65rem 0.75rem', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                      {result && !isMissingResult ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.25rem' }}>
                            {getVisibilityBadge(result.visibility, result.summit_visible)}
                            <span
                              style={{
                                fontSize: '0.75rem',
                                fontWeight: 700,
                                color: result.is_sunny ? '#f59e0b' : 'var(--text-secondary)',
                              }}
                            >
                              {result.is_sunny ? '☀️ 日差し・青空' : '☁️ 日差しなし'} (雲量 {result.cloud_cover}/10)
                            </span>
                          </div>
                          <div style={{ fontSize: '0.74rem', color: 'var(--text-primary)', marginTop: '0.15rem', lineHeight: 1.4 }}>
                            {result.reason}
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          <span>{isBroken ? 'カメラ未記録のため解析対象外' : 'AI未解析（上の「この日をAI解析する」で判定可能）'}</span>
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
