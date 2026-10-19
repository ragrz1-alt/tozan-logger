import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Sun, RefreshCw, Database, CheckCircle2, Trash2, Download, Play, Square, Calendar, Eye } from 'lucide-react';
import {
  type ImageAnalysis,
  evaluateDailyCameraVisibility,
  notifyCameraAnalysisUpdated,
} from '../hooks/useCameraAnalysis';

interface WeatherData {
  date: string;
  tempMax: number;
  tempMin: number;
  precipitation: number;
  weatherCode: number;
  windSpeedMax: number;
  windDirection: number;
  sunshineDuration: number;
  isHeavyRain: boolean;
}

const LOCATIONS = [
  { id: 'oshidomari', name: '鴛泊(北)' },
  { id: 'kutsugata', name: '沓形(西)' },
  { id: 'senposhi', name: '仙法志(南)' },
];
const TIMES = ['05', '08', '11', '14', '17'];

// レート制限 (500 RPD / 15 RPM) に最適化されたモデルチェーン
const CAMERA_MODELS = [
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite (推奨: 500回/日・15回/分)' },
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite (予備: 500回/日・15回/分)' },
  { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash (高精度・上限20回/日)' },
];

const STRICT_SYSTEM_PROMPT = `あなたは北海道・利尻山（独立峰・標高1,721m）の山岳気象・視界判定の専門AIアナリストです。
定点ライブカメラ（oshidomari=北側・鴛泊、kutsugata=西側・沓形、senposhi=南側・仙法志）の画像から、登山者にとって最も重要な「利尻山の山体および山頂（ピーク）が見えているか」と「空全体の雲量」を厳密に区別して判定してください。

【最重要：判定の厳格ルール】
1. 手前の海・港・市街地・道路の天気に惑わされないでください。常に画角中央〜奥にそびえる「利尻山の山体・山頂ピーク」を基準に視界(visibility)を判定してください。
2. summit_visible (boolean):
   - true: 利尻山の山頂（最高峰の尖ったピーク部分）が雲や霧に隠れず、明確に輪郭まで見えている場合のみ true。
   - false: 山頂部に笠雲・山岳波雲・ガスがかかって隠れている場合や、山全体が見えない場合は必ず false。
3. visibility ('clear' | 'cloudy' | 'foggy'):
   - 'clear' (山頂快晴・視界良好): 山頂ピークから稜線・山麓まで雲に隠れずクッキリ見えている状態（summit_visible が true であることが絶対条件。空に青空が見えていても、山頂ピークが雲に隠れていれば絶対に 'clear' にしてはいけません）。
   - 'cloudy' (山頂雲隠れ・一部視認): 山の裾野〜中腹（稜線の一部）は見えているが、山頂（ピーク）付近が雲や笠雲に隠れている状態。または高曇りで山全体の輪郭は見えるが厚い雲で日差しがない状態。
   - 'foggy' (山体ガス・視界不良・山体不可視): 低い雲・濃霧（ガス）・悪天候により、利尻山の山体全体（または中腹から上の大部分）が白や灰色の雲に覆われて見えない状態。※カメラ手前の町や海が見えていても、肝心の「山」が見えなければ必ず 'foggy' と判定してください。
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

export const LiveCamPoCPanel: React.FC = () => {
  // 全対象期間 (2026-07-28 〜 2026-10-19)
  const availableDates = useMemo(() => generateDateList('2026-07-28', '2026-10-19'), []);

  const [selectedDate, setSelectedDate] = useState<string>('2026-08-01');
  const [rangeStart, setRangeStart] = useState<string>('2026-08-01');
  const [rangeEnd, setRangeEnd] = useState<string>('2026-08-31');
  const [overwriteExisting, setOverwriteExisting] = useState<boolean>(false);
  const [selectedModel, setSelectedModel] = useState<string>('gemini-3.5-flash-lite');

  const [weatherMap, setWeatherMap] = useState<Record<string, WeatherData>>({});
  const [isLoadingWeather, setIsLoadingWeather] = useState(true);

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{
    current: number;
    total: number;
    currentDate: string;
    activeModel: string;
  } | null>(null);
  const stopRequestedRef = useRef<boolean>(false);

  const [analysisResults, setAnalysisResults] = useState<Record<string, ImageAnalysis[]>>({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch('/data/weather-daily.json')
      .then(res => res.json())
      .then(data => {
        setWeatherMap(data);
        setIsLoadingWeather(false);
      })
      .catch(err => {
        console.error('Weather load error:', err);
        setIsLoadingWeather(false);
      });

    const isCleared = localStorage.getItem('tozan_weather_analysis_cleared') === 'true';
    const cached = localStorage.getItem('tozan_weather_analysis_cache');
    const localData = cached ? JSON.parse(cached) : {};

    if (isCleared) {
      setAnalysisResults(localData);
      return;
    }

    fetch(`/cams/analysis_results.json?t=${Date.now()}`)
      .then(res => res.json())
      .then(data => {
        setAnalysisResults({ ...data, ...localData });
      })
      .catch(() => {
        setAnalysisResults(localData);
      });
  }, []);

  const currentWeather = weatherMap[selectedDate];
  const currentResults = analysisResults[selectedDate];
  const dailySummary = useMemo(() => evaluateDailyCameraVisibility(currentResults), [currentResults]);

  // 解析済み日数のカウント
  const analyzedDaysCount = useMemo(() => {
    return availableDates.filter(d => analysisResults[d] && analysisResults[d].some(c => c.status === 'ok')).length;
  }, [availableDates, analysisResults]);

  // 選択範囲内のサマリー統計
  const rangeSummary = useMemo(() => {
    const datesInRange = availableDates.filter(d => d >= rangeStart && d <= rangeEnd);
    let clearDays = 0;
    let cloudyDays = 0;
    let foggyDays = 0;
    let analyzedInRange = 0;

    datesInRange.forEach(d => {
      const res = analysisResults[d];
      if (!res || !res.some(c => c.status === 'ok')) return;
      analyzedInRange++;
      const evalRes = evaluateDailyCameraVisibility(res);
      if (evalRes.mountainCategory === 'clear') clearDays++;
      else if (evalRes.mountainCategory === 'foggy') foggyDays++;
      else if (evalRes.mountainCategory === 'cloudy') cloudyDays++;
    });

    return {
      totalInRange: datesInRange.length,
      analyzedInRange,
      clearDays,
      cloudyDays,
      foggyDays,
    };
  }, [availableDates, rangeStart, rangeEnd, analysisResults]);

  const fetchAsBase64 = async (
    url: string
  ): Promise<{ fileName: string; data: string; mimeType: string; isMissing: boolean }> => {
    const fileName = url.split('/').pop() || '';
    try {
      const res = await fetch(url);
      if (!res.ok) {
        return { fileName, data: '', mimeType: '', isMissing: true };
      }
      const blob = await res.blob();
      if (blob.type.includes('html')) {
        return { fileName, data: '', mimeType: '', isMissing: true };
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

  // 1日分の解析を実行するコア関数（モデル自動フォールバック付き）
  const analyzeSingleDateCore = async (targetDate: string): Promise<{ results: ImageAnalysis[]; usedModel: string }> => {
    const imageUrls: string[] = [];
    for (const time of TIMES) {
      for (const loc of LOCATIONS) {
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
          reason: '画像取得エラーのため解析スキップ',
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

    // 選択されたモデルを先頭に、フォールバック候補を並べる
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

        // 二重ロック補正（山頂が見えないのにclearにした場合や、山全体が雲に隠れているのにcloudyにした場合を厳格補正）
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

  const saveDateResults = (dateStr: string, dateResults: ImageAnalysis[]) => {
    setAnalysisResults(prev => {
      const updated = { ...prev, [dateStr]: dateResults };
      try {
        const cached = localStorage.getItem('tozan_weather_analysis_cache');
        const localData = cached ? JSON.parse(cached) : {};
        localData[dateStr] = dateResults;
        localStorage.setItem('tozan_weather_analysis_cache', JSON.stringify(localData));
        notifyCameraAnalysisUpdated();
      } catch (storageErr) {
        console.warn('localStorageへの保存エラー:', storageErr);
      }
      return updated;
    });
  };

  // 単日解析の実行
  const runSingleDayAnalysis = async () => {
    setIsAnalyzing(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const { results, usedModel } = await analyzeSingleDateCore(selectedDate);
      saveDateResults(selectedDate, results);
      setStatusMsg(`✅ ${selectedDate} の高精度雲量・山頂視界解析が完了しました！（使用モデル: ${usedModel}）`);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // 範囲一括連続解析の実行
  const runRangeBatchAnalysis = async () => {
    if (rangeStart > rangeEnd) {
      setErrorMsg('開始日は終了日以前の日付を指定してください。');
      return;
    }

    const candidates = availableDates.filter(d => d >= rangeStart && d <= rangeEnd);
    const targetList = overwriteExisting
      ? candidates
      : candidates.filter(d => !analysisResults[d] || !analysisResults[d].some(c => c.status === 'ok'));

    if (targetList.length === 0) {
      setStatusMsg('指定範囲内の日付はすべて解析済みです。再解析する場合は「解析済みの日も新ルールで上書き再解析する」にチェックを入れてください。');
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
          setStatusMsg(`⏸️ ユーザー操作により一括解析を中断しました。（${completedCount} / ${targetList.length} 日完了）`);
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
        saveDateResults(dateStr, results);
        completedCount++;

        setBatchProgress({
          current: i + 1,
          total: targetList.length,
          currentDate: dateStr,
          activeModel: usedModel,
        });

        // 次の日がある場合は15 RPM制限（1分15回＝4秒/回）を守るため 4.2秒待機
        if (i < targetList.length - 1 && !stopRequestedRef.current) {
          await new Promise(r => setTimeout(r, 4200));
        }
      }

      if (!stopRequestedRef.current) {
        setStatusMsg(`🎉 指定範囲（${completedCount}日間）の一括AI解析がすべて完了しました！右上の「JSON保存」からファイル書き出しも可能です。`);
      }
    } catch (err: any) {
      setErrorMsg(`一括解析中にエラーが発生しました (${ completedCount }日完了時点): ${err.message}`);
    } finally {
      setIsAnalyzing(false);
      setBatchProgress(null);
      stopRequestedRef.current = false;
    }
  };

  // 全解析データの完全クリア
  const handleClearAllAnalysis = () => {
    if (
      !window.confirm(
        '現在保持しているすべての雲量・視界解析データをクリア（初期化）しますか？\nクリア後、新しい高精度プロンプトで1日単位または期間一括で再解析できます。'
      )
    ) {
      return;
    }
    localStorage.removeItem('tozan_weather_analysis_cache');
    localStorage.setItem('tozan_weather_analysis_cleared', 'true');
    setAnalysisResults({});
    notifyCameraAnalysisUpdated();
    setStatusMsg('🗑️ 既存の雲量解析データをすべてクリアしました。新しいプロンプトルールで再解析を実行してください。');
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
    setStatusMsg('💾 analysis_results.json をダウンロードしました。public/cams/analysis_results.json に配置すると永続反映されます。');
  };

  const applyQuickRange = (start: string, end: string) => {
    setRangeStart(start);
    setRangeEnd(end);
    setSelectedDate(start);
  };

  const getVisibilityBadge = (vis: string, summitVisible?: boolean) => {
    switch (vis) {
      case 'clear':
        return (
          <span
            style={{
              backgroundColor: '#10b981',
              color: '#fff',
              padding: '0.2rem 0.5rem',
              borderRadius: '4px',
              fontSize: '0.75rem',
              fontWeight: 'bold',
            }}
          >
            🏔️ 山頂快晴 (Clear)
          </span>
        );
      case 'cloudy':
        return (
          <span
            style={{
              backgroundColor: '#64748b',
              color: '#fff',
              padding: '0.2rem 0.5rem',
              borderRadius: '4px',
              fontSize: '0.75rem',
              fontWeight: 'bold',
            }}
          >
            ☁️ {summitVisible === false ? '山頂雲隠れ' : '曇り'} (Cloudy)
          </span>
        );
      case 'foggy':
        return (
          <span
            style={{
              backgroundColor: '#cbd5e1',
              color: '#334155',
              padding: '0.2rem 0.5rem',
              borderRadius: '4px',
              fontSize: '0.75rem',
              fontWeight: 'bold',
            }}
          >
            🌫️ 山体ガス・不可視 (Foggy)
          </span>
        );
      case 'missing':
        return (
          <span
            style={{
              backgroundColor: '#f87171',
              color: '#fff',
              padding: '0.2rem 0.5rem',
              borderRadius: '4px',
              fontSize: '0.75rem',
              fontWeight: 'bold',
            }}
          >
            カメラ未記録
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="card" style={{ borderTop: '4px solid #3b82f6', marginBottom: '2rem' }}>
      {/* ヘッダー＆全体ステータス・クリア・JSON保存ボタン */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: '1rem',
          marginBottom: '1.25rem',
          paddingBottom: '1rem',
          borderBottom: '1px solid var(--border-color)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <div style={{ backgroundColor: '#3b82f6', color: '#fff', padding: '0.5rem', borderRadius: '0.6rem', display: 'flex' }}>
            <Database size={24} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <h3 style={{ fontSize: '1.35rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                🏔️ 山頂視界・雲量AI 一括解析マネージャー [管理者専用]
              </h3>
              <span
                style={{
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  padding: '0.2rem 0.6rem',
                  borderRadius: '999px',
                  backgroundColor: 'rgba(16, 185, 129, 0.15)',
                  color: '#10b981',
                }}
              >
                新・山頂ピーク厳格判定ルール適用済 ({analyzedDaysCount} / {availableDates.length}日 解析済)
              </span>
            </div>
            <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
              Google AI Studioのレート制限（Flash Lite: 500回/日・15回/分）に最適化。期間（範囲）指定での一括連続解析やデータクリア・JSON出力に対応しています。
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
          <button
            onClick={handleExportJson}
            disabled={isAnalyzing || Object.keys(analysisResults).length === 0}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.5rem 0.9rem',
              borderRadius: '8px',
              border: '1px solid #10b981',
              backgroundColor: 'rgba(16, 185, 129, 0.1)',
              color: '#10b981',
              fontWeight: 700,
              fontSize: '0.85rem',
              cursor: isAnalyzing ? 'not-allowed' : 'pointer',
            }}
            title="現在の解析結果を analysis_results.json としてダウンロードします"
          >
            <Download size={16} />
            <span>JSON書き出し保存</span>
          </button>

          <button
            onClick={handleClearAllAnalysis}
            disabled={isAnalyzing}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.5rem 0.9rem',
              borderRadius: '8px',
              border: '1px solid #ef4444',
              backgroundColor: 'rgba(239, 68, 68, 0.08)',
              color: '#ef4444',
              fontWeight: 700,
              fontSize: '0.85rem',
              cursor: isAnalyzing ? 'not-allowed' : 'pointer',
            }}
          >
            <Trash2 size={16} />
            <span>既存データを全クリア</span>
          </button>
        </div>
      </div>

      {/* 1. 期間（範囲）一括解析パネル */}
      <div
        style={{
          padding: '1.25rem',
          backgroundColor: 'var(--bg-secondary)',
          borderRadius: '12px',
          border: '1px solid var(--border-color)',
          marginBottom: '1.25rem',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '0.75rem',
            marginBottom: '0.85rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 800, fontSize: '0.95rem' }}>
            <Calendar size={18} style={{ color: '#3b82f6' }} />
            <span>📅 期間（範囲）選択・一括連続バッチ解析</span>
          </div>

          {/* 使用モデル選択 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem' }}>
            <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>使用AIモデル:</span>
            <select
              value={selectedModel}
              onChange={e => setSelectedModel(e.target.value)}
              disabled={isAnalyzing}
              style={{
                padding: '0.35rem 0.6rem',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                fontWeight: 700,
                fontSize: '0.82rem',
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

        {/* クイック期間選択ボタン群 */}
        <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', marginBottom: '0.85rem' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', alignSelf: 'center', marginRight: '0.25rem' }}>
            クイック範囲選択:
          </span>
          {[
            { label: '7月後半 (7/28〜7/31)', start: '2026-07-28', end: '2026-07-31' },
            { label: '8月前半 (8/1〜8/15)', start: '2026-08-01', end: '2026-08-15' },
            { label: '8月後半 (8/16〜8/31)', start: '2026-08-16', end: '2026-08-31' },
            { label: '8月すべて (31日間)', start: '2026-08-01', end: '2026-08-31' },
            { label: '9月すべて (30日間)', start: '2026-09-01', end: '2026-09-30' },
            { label: '10月 (10/1〜10/19)', start: '2026-10-01', end: '2026-10-19' },
            { label: '全期間 (7/28〜10/19・計84日)', start: '2026-07-28', end: '2026-10-19' },
          ].map(q => {
            const isSelected = rangeStart === q.start && rangeEnd === q.end;
            return (
              <button
                key={q.label}
                onClick={() => applyQuickRange(q.start, q.end)}
                disabled={isAnalyzing}
                style={{
                  padding: '0.35rem 0.7rem',
                  borderRadius: '999px',
                  border: isSelected ? '1px solid #3b82f6' : '1px solid var(--border-color)',
                  backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.15)' : 'var(--bg-primary)',
                  color: isSelected ? '#3b82f6' : 'var(--text-primary)',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  cursor: isAnalyzing ? 'not-allowed' : 'pointer',
                }}
              >
                {q.label}
              </button>
            );
          })}
        </div>

        {/* 開始日〜終了日 ＆ 実行ボタン */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
            <div>
              <label style={{ fontSize: '0.8rem', fontWeight: 700, marginRight: '0.35rem' }}>開始日:</label>
              <select
                value={rangeStart}
                onChange={e => setRangeStart(e.target.value)}
                disabled={isAnalyzing}
                style={{
                  padding: '0.4rem 0.6rem',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  fontWeight: 600,
                }}
              >
                {availableDates.map(d => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <span>〜</span>
            <div>
              <label style={{ fontSize: '0.8rem', fontWeight: 700, marginRight: '0.35rem' }}>終了日:</label>
              <select
                value={rangeEnd}
                onChange={e => setRangeEnd(e.target.value)}
                disabled={isAnalyzing}
                style={{
                  padding: '0.4rem 0.6rem',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  fontWeight: 600,
                }}
              >
                {availableDates.map(d => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                fontSize: '0.82rem',
                fontWeight: 600,
                cursor: 'pointer',
                marginLeft: '0.5rem',
              }}
            >
              <input
                type="checkbox"
                checked={overwriteExisting}
                onChange={e => setOverwriteExisting(e.target.checked)}
                disabled={isAnalyzing}
              />
              <span>解析済みの日も強制上書き再解析する</span>
            </label>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            {!isAnalyzing ? (
              <button
                onClick={runRangeBatchAnalysis}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                  padding: '0.6rem 1.25rem',
                  borderRadius: '8px',
                  border: 'none',
                  background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                  color: '#fff',
                  fontWeight: 800,
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(59, 130, 246, 0.35)',
                }}
              >
                <Play size={16} />
                <span>
                  選択範囲を一括解析 ({rangeStart.slice(5)}〜{rangeEnd.slice(5)} / {rangeSummary.totalInRange}日分)
                </span>
              </button>
            ) : (
              <button
                onClick={() => {
                  stopRequestedRef.current = true;
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                  padding: '0.6rem 1.25rem',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: '#ef4444',
                  color: '#fff',
                  fontWeight: 800,
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                }}
              >
                <Square size={16} />
                <span>一括解析を安全に中断する</span>
              </button>
            )}
          </div>
        </div>

        {/* 選択範囲の山頂視界サマリーバー */}
        <div
          style={{
            marginTop: '0.9rem',
            paddingTop: '0.75rem',
            borderTop: '1px solid var(--border-color)',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '1.25rem',
            fontSize: '0.82rem',
            alignItems: 'center',
          }}
        >
          <span style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>
            📊 選択範囲 ({rangeStart} 〜 {rangeEnd}) の集計:
          </span>
          <span>
            解析済: <strong>{rangeSummary.analyzedInRange}</strong> / {rangeSummary.totalInRange} 日
          </span>
          <span style={{ color: '#10b981', fontWeight: 700 }}>
            🏔️ 山頂快晴(Clear): {rangeSummary.clearDays}日
          </span>
          <span style={{ color: '#64748b', fontWeight: 700 }}>
            ☁️ 山頂雲隠れ・曇(Cloudy): {rangeSummary.cloudyDays}日
          </span>
          <span style={{ color: '#94a3b8', fontWeight: 700 }}>
            🌫️ 山体ガス・不可視(Foggy): {rangeSummary.foggyDays}日
          </span>
        </div>

        {/* 一括解析中の進捗バー */}
        {batchProgress && (
          <div
            style={{
              marginTop: '1rem',
              padding: '0.85rem 1rem',
              backgroundColor: 'var(--bg-primary)',
              borderRadius: '8px',
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
      </div>

      {/* 2. 個別日インスペクター＆単日解析バー */}
      <div
        style={{
          padding: '0.9rem 1.1rem',
          backgroundColor: 'var(--bg-secondary)',
          borderRadius: '10px',
          marginBottom: '1.25rem',
          display: 'flex',
          gap: '1rem',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Eye size={17} style={{ color: 'var(--accent-primary)' }} />
            <label style={{ fontSize: '0.88rem', fontWeight: 800 }}>表示・個別解析する日:</label>
          </div>
          <select
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            disabled={isAnalyzing}
            style={{
              padding: '0.45rem 0.75rem',
              borderRadius: '6px',
              border: '1px solid var(--border-color)',
              backgroundColor: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              fontWeight: 700,
            }}
          >
            {availableDates.map(d => {
              const hasOk = analysisResults[d] && analysisResults[d].some(c => c.status === 'ok');
              return (
                <option key={d} value={d}>
                  {d} {hasOk ? '✓ 解析済' : '（未解析）'}
                </option>
              );
            })}
          </select>

          <button
            onClick={runSingleDayAnalysis}
            disabled={isAnalyzing}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.45rem 0.95rem',
              borderRadius: '8px',
              border: '1px solid #3b82f6',
              backgroundColor: 'var(--bg-primary)',
              color: '#3b82f6',
              fontWeight: 700,
              fontSize: '0.85rem',
              cursor: isAnalyzing ? 'wait' : 'pointer',
              opacity: isAnalyzing ? 0.6 : 1,
            }}
          >
            <RefreshCw size={15} className={isAnalyzing && !batchProgress ? 'animate-spin' : ''} />
            <span>この1日だけ再解析 (15枚)</span>
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          {currentResults && currentResults.some(c => c.status === 'ok') ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.85rem' }}>
              <span style={{ color: '#10b981', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <CheckCircle2 size={16} /> 解析済
              </span>
              <span>|</span>
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
                <span>(平均雲量: {dailySummary.avgCloudCover}/10)</span>
              )}
            </div>
          ) : (
            <span style={{ fontSize: '0.85rem', color: '#64748b', fontWeight: 'bold' }}>未解析</span>
          )}
        </div>
      </div>

      {statusMsg && (
        <div
          style={{
            padding: '0.75rem 1rem',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            color: '#059669',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            borderRadius: '8px',
            marginBottom: '1.25rem',
            fontSize: '0.88rem',
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
            marginBottom: '1.25rem',
            fontSize: '0.88rem',
            fontWeight: 600,
          }}
        >
          ⚠️ {errorMsg}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 1fr) 3fr', gap: '1.5rem' }}>
        {/* 気象データ（マクロ）パネル */}
        <div style={{ padding: '1rem', border: '1px solid var(--border-color)', borderRadius: '8px', height: 'fit-content' }}>
          <h4 style={{ fontSize: '1rem', fontWeight: 800, margin: '0 0 1rem 0', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Sun size={18} style={{ color: '#f59e0b' }} />
            麓の気象庁データ ({selectedDate})
          </h4>
          {currentWeather ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.9rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>最高気温</span>
                <strong>{currentWeather.tempMax}℃</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>降水量</span>
                <strong style={{ color: currentWeather.precipitation > 0 ? '#3b82f6' : 'inherit' }}>
                  {currentWeather.precipitation} mm
                </strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>最大風速</span>
                <strong>{currentWeather.windSpeedMax} m/s</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>風向き</span>
                <strong>
                  {getWindDirString(currentWeather.windDirection)} ({currentWeather.windDirection}°)
                </strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>日照時間</span>
                <strong>{currentWeather.sunshineDuration} 時間</strong>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              {isLoadingWeather ? '読み込み中...' : 'データなし'}
            </div>
          )}
        </div>

        {/* 画像＆解析結果（ミクロ）パネル */}
        <div>
          {TIMES.map(time => (
            <div key={time} style={{ marginBottom: '2rem' }}>
              <h5
                style={{
                  fontSize: '1.05rem',
                  fontWeight: 800,
                  margin: '0 0 0.75rem 0',
                  borderBottom: '2px solid var(--border-color)',
                  paddingBottom: '0.3rem',
                }}
              >
                {time}:00 のカメラ状況 ({selectedDate})
              </h5>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                {LOCATIONS.map(loc => {
                  const fileName = `${time}_${loc.id}.jpg`;
                  const imageUrl = `/cams/${selectedDate}/${fileName}`;
                  const result = currentResults?.find(r => r.fileName === fileName);
                  const isMissing = result?.status === 'missing' || result?.visibility === 'missing';

                  return (
                    <div
                      key={loc.id}
                      style={{
                        border: '1px solid var(--border-color)',
                        borderRadius: '6px',
                        overflow: 'hidden',
                        backgroundColor: 'var(--bg-primary)',
                        opacity: isMissing ? 0.6 : 1,
                      }}
                    >
                      <div
                        style={{
                          padding: '0.4rem 0.6rem',
                          backgroundColor: 'var(--bg-secondary)',
                          fontWeight: 'bold',
                          fontSize: '0.85rem',
                          borderBottom: '1px solid var(--border-color)',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <span>{loc.name}</span>
                        {result && !isMissing && result.summit_visible !== undefined && (
                          <span
                            style={{
                              fontSize: '0.7rem',
                              padding: '0.1rem 0.4rem',
                              borderRadius: '4px',
                              backgroundColor: result.summit_visible ? 'rgba(16, 185, 129, 0.15)' : 'rgba(148, 163, 184, 0.2)',
                              color: result.summit_visible ? '#059669' : 'var(--text-secondary)',
                            }}
                          >
                            {result.summit_visible ? '山頂露出: ◯' : '山頂隠れ: ×'}
                          </span>
                        )}
                      </div>
                      <div style={{ position: 'relative', aspectRatio: '16/9', backgroundColor: '#000' }}>
                        {!isMissing && (
                          <img
                            src={imageUrl}
                            alt={loc.name}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            onError={e => {
                              (e.target as any).style.display = 'none';
                            }}
                          />
                        )}
                      </div>
                      <div style={{ padding: '0.6rem' }}>
                        {result ? (
                          isMissing ? (
                            <div
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '0.4rem',
                                alignItems: 'center',
                                padding: '0.5rem 0',
                              }}
                            >
                              {getVisibilityBadge('missing')}
                              <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
                                画像取得エラーのため解析スキップ
                              </div>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.25rem' }}>
                                {getVisibilityBadge(result.visibility, result.summit_visible)}
                                <span
                                  style={{
                                    fontSize: '0.75rem',
                                    fontWeight: 'bold',
                                    color: result.is_sunny ? '#f59e0b' : 'var(--text-secondary)',
                                  }}
                                >
                                  {result.is_sunny ? '☀️ 日差し・青空' : '☁️ 日差しなし'}
                                </span>
                              </div>
                              <div
                                style={{
                                  fontSize: '0.75rem',
                                  color: 'var(--text-secondary)',
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                }}
                              >
                                <span>空の雲量: {result.cloud_cover}/10</span>
                              </div>
                              <div style={{ fontSize: '0.72rem', color: 'var(--text-primary)', marginTop: '0.2rem', lineHeight: 1.35 }}>
                                {result.reason}
                              </div>
                            </div>
                          )
                        ) : (
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textAlign: 'center', padding: '1rem 0' }}>
                            未解析
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
      </div>
    </div>
  );
};
