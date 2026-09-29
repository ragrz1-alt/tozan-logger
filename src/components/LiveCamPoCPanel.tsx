import React, { useState, useEffect } from 'react';
import { Sun, RefreshCw, Database, CheckCircle2 } from 'lucide-react';

// === 型定義 ===
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

interface ImageAnalysis {
  fileName: string;
  is_sunny: boolean;
  cloud_cover: number;
  visibility: 'clear' | 'cloudy' | 'foggy';
  reason: string;
}

const LOCATIONS = [
  { id: 'oshidomari', name: '鴛泊(北)' },
  { id: 'kutsugata', name: '沓形(西)' },
  { id: 'senposhi', name: '仙法志(南)' }
];
const TIMES = ['05', '08', '11', '14', '17'];

// --- Utility: 方角計算 ---
function getWindDirString(deg: number) {
  const dirs = ['北', '北北東', '北東', '東北東', '東', '東南東', '南東', '南南東', '南', '南南西', '南西', '西南西', '西', '西北西', '北西', '北北西'];
  return dirs[Math.round(deg / 22.5) % 16] || '不明';
}

export const LiveCamPoCPanel: React.FC = () => {
  const [selectedDate, setSelectedDate] = useState<string>('2026-08-01');
  const [weatherMap, setWeatherMap] = useState<Record<string, WeatherData>>({});
  const [isLoadingWeather, setIsLoadingWeather] = useState(true);
  
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResults, setAnalysisResults] = useState<Record<string, ImageAnalysis[]>>({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // 利用可能な日付リスト (簡易的に固定)
  const availableDates = [];
  const startD = new Date('2026-07-28');
  const endD = new Date('2026-09-17');
  for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
    availableDates.push(d.toISOString().split('T')[0]);
  }

  // 天気データとAI解析結果のロード
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

    // キャッシュ(localStorage)とサーバーサイドバッチの両方から結果をロード
    const cached = localStorage.getItem('tozan_weather_analysis_cache');
    const localData = cached ? JSON.parse(cached) : {};

    fetch(`/cams/analysis_results.json?t=${Date.now()}`)
      .then(res => res.json())
      .then(data => {
        setAnalysisResults({ ...localData, ...data });
      })
      .catch(err => {
        console.warn('サーバー側のカメラ解析結果が見つかりません。ローカルキャッシュのみ使用します。', err);
        setAnalysisResults(localData);
      });
  }, []);

  const currentWeather = weatherMap[selectedDate];
  const currentResults = analysisResults[selectedDate];

  const fetchAsBase64 = async (url: string): Promise<{ fileName: string, data: string, mimeType: string, isMissing: boolean } | null> => {
    const fileName = url.split('/').pop() || '';
    try {
      const res = await fetch(url);
      if (!res.ok) {
        return { fileName, data: '', mimeType: '', isMissing: true };
      }
      const blob = await res.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const b64 = (reader.result as string).split(',')[1];
          resolve({ fileName, data: b64, mimeType: blob.type, isMissing: false });
        };
        reader.readAsDataURL(blob);
      });
    } catch {
      return { fileName, data: '', mimeType: '', isMissing: true };
    }
  };

  const runAnalysisFromWeb = async () => {
    setIsAnalyzing(true);
    setErrorMsg(null);
    try {
      const imageUrls: string[] = [];
      for (const time of TIMES) {
        for (const loc of LOCATIONS) {
          imageUrls.push(`/cams/${selectedDate}/${time}_${loc.id}.jpg`);
        }
      }

      const fetchResults = (await Promise.all(imageUrls.map(fetchAsBase64))).filter(Boolean) as any[];
      const validImages = fetchResults.filter(r => !r.isMissing);
      
      const dateResults: any[] = [];
      
      // 欠損画像は最初からmissingステータスとして結果に入れておく
      fetchResults.filter(r => r.isMissing).forEach(r => {
        dateResults.push({
          fileName: r.fileName,
          is_sunny: false,
          cloud_cover: -1,
          visibility: 'missing',
          reason: '画像取得エラーのため解析スキップ',
          status: 'missing'
        });
      });

      if (validImages.length === 0) {
        throw new Error('指定日の画像が見つかりませんでした。');
      }

      const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
      if (!apiKey) throw new Error('VITE_GEMINI_API_KEY が設定されていません。');

      const parts: any[] = [
        { text: "あなたは山の天候を判定するアシスタントです。提供された複数の画像の天候と視界を解析し、結果のJSON配列として返してください。fileNameは必ず結果に含めてください。" }
      ];
      for (const img of validImages) {
        parts.push({ text: `ファイル名: ${img.fileName}` });
        parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
      }

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: "あなたは山の天候を判定するアシスタントです。ガス(foggy)、雲(cloudy)、快晴(clear)を正確に区別してください。" }]
          },
          contents: [{ role: "user", parts }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  fileName: { type: "STRING" },
                  is_sunny: { type: "BOOLEAN" },
                  cloud_cover: { type: "INTEGER" },
                  visibility: { type: "STRING" },
                  reason: { type: "STRING" }
                },
                required: ["fileName", "is_sunny", "cloud_cover", "visibility", "reason"]
              }
            },
            temperature: 0.1
          }
        })
      });

      if (!response.ok) {
        const errJson = await response.json();
        throw new Error(`API Error: ${errJson.error?.message || response.statusText}`);
      }

      const data = await response.json();
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) throw new Error('AIから有効なレスポンスが返りませんでした。');

      // AIはマークダウンの ```json を返すことがあるため除去
      const cleanText = rawText.replace(/```json|```/g, '').trim();
      const resultJson: ImageAnalysis[] = JSON.parse(cleanText);
      
      for (const res of resultJson) {
        (res as any).status = 'ok';
        dateResults.push(res);
      }
      
      const newResults = { ...analysisResults, [selectedDate]: dateResults };
      setAnalysisResults(newResults);
      localStorage.setItem('tozan_weather_analysis_cache', JSON.stringify(newResults));

    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const getVisibilityBadge = (vis: string) => {
    switch(vis) {
      case 'clear': return <span style={{backgroundColor: '#10b981', color: '#fff', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold'}}>良好 (Clear)</span>;
      case 'cloudy': return <span style={{backgroundColor: '#64748b', color: '#fff', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold'}}>曇り (Cloudy)</span>;
      case 'foggy': return <span style={{backgroundColor: '#cbd5e1', color: '#334155', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold'}}>ガス (Foggy)</span>;
      case 'missing': return <span style={{backgroundColor: '#f87171', color: '#fff', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold'}}>カメラ停止</span>;
      default: return null;
    }
  };

  return (
    <div className="card" style={{ borderTop: '4px solid #3b82f6', marginBottom: '2rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1.25rem' }}>
        <div style={{ backgroundColor: '#3b82f6', color: '#fff', padding: '0.45rem', borderRadius: '0.5rem', display: 'flex' }}>
          <Database size={22} />
        </div>
        <div>
          <h3 style={{ fontSize: '1.35rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
            🧪 山の天候解析 WEB実験室 [管理者専用]
          </h3>
          <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
            過去の定点カメラ画像とマクロな気象データ（風・雨）をAIで照合し、局地的な天候パターンを発見するPoC
          </p>
        </div>
      </div>

      {/* コントロールパネル */}
      <div style={{ padding: '1rem', backgroundColor: 'var(--bg-secondary)', borderRadius: '8px', marginBottom: '1.5rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <label style={{ fontSize: '0.85rem', fontWeight: 'bold', marginRight: '0.5rem' }}>対象日:</label>
          <select 
            value={selectedDate} 
            onChange={e => setSelectedDate(e.target.value)}
            style={{ padding: '0.4rem', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)' }}
          >
            {availableDates.map(d => (
              <option key={d} value={d}>{d} {analysisResults[d] && analysisResults[d].length > 0 ? '✓' : ''}</option>
            ))}
          </select>
        </div>
        
        <button
          onClick={runAnalysisFromWeb}
          disabled={isAnalyzing}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.4rem',
            padding: '0.5rem 1rem', borderRadius: '8px',
            border: 'none', backgroundColor: '#3b82f6', color: '#fff', fontWeight: 'bold',
            cursor: isAnalyzing ? 'wait' : 'pointer', opacity: isAnalyzing ? 0.7 : 1
          }}
        >
          <RefreshCw size={16} className={isAnalyzing ? 'animate-spin' : ''} />
          <span>{isAnalyzing ? 'AI解析中...' : 'この日の画像を解析する (15枚バッチ処理)'}</span>
        </button>
        
        {currentResults && (
          <span style={{ fontSize: '0.85rem', color: '#10b981', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <CheckCircle2 size={16} /> 解析完了（キャッシュ済）
          </span>
        )}
      </div>

      {errorMsg && (
        <div style={{ padding: '0.75rem', backgroundColor: '#fef2f2', color: '#ef4444', borderRadius: '8px', marginBottom: '1.5rem', fontSize: '0.85rem' }}>
          エラー: {errorMsg}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(250px, 1fr) 3fr', gap: '1.5rem' }}>
        {/* 気象データ（マクロ）パネル */}
        <div style={{ padding: '1rem', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
          <h4 style={{ fontSize: '1rem', fontWeight: 800, margin: '0 0 1rem 0', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Sun size={18} style={{ color: '#f59e0b' }} />
            気象庁データ (利尻)
          </h4>
          {currentWeather ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.9rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>最高気温</span>
                <strong>{currentWeather.tempMax}℃</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>降水量</span>
                <strong style={{ color: currentWeather.precipitation > 0 ? '#3b82f6' : 'inherit' }}>{currentWeather.precipitation} mm</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>最大風速</span>
                <strong>{currentWeather.windSpeedMax} m/s</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>風向き</span>
                <strong>{getWindDirString(currentWeather.windDirection)} ({currentWeather.windDirection}°)</strong>
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
              <h5 style={{ fontSize: '1.05rem', fontWeight: 800, margin: '0 0 0.75rem 0', borderBottom: '2px solid var(--border-color)', paddingBottom: '0.3rem' }}>
                {time}:00 のカメラ状況
              </h5>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                {LOCATIONS.map(loc => {
                  const fileName = `${time}_${loc.id}.jpg`;
                  const imageUrl = `/cams/${selectedDate}/${fileName}`;
                  const result = (currentResults as any)?.find((r: any) => r.fileName === fileName);
                  const isMissing = result?.status === 'missing' || result?.visibility === 'missing';
                  
                  return (
                    <div key={loc.id} style={{ border: '1px solid var(--border-color)', borderRadius: '6px', overflow: 'hidden', backgroundColor: 'var(--bg-primary)', opacity: isMissing ? 0.6 : 1 }}>
                      <div style={{ padding: '0.4rem 0.6rem', backgroundColor: 'var(--bg-secondary)', fontWeight: 'bold', fontSize: '0.85rem', borderBottom: '1px solid var(--border-color)' }}>
                        {loc.name}
                      </div>
                      <div style={{ position: 'relative', aspectRatio: '16/9', backgroundColor: '#000' }}>
                        {!isMissing && (
                          <img src={imageUrl} alt={loc.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => { (e.target as any).style.display = 'none'; }} />
                        )}
                      </div>
                      <div style={{ padding: '0.6rem' }}>
                        {result ? (
                          isMissing ? (
                             <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', alignItems: 'center', padding: '0.5rem 0' }}>
                              {getVisibilityBadge('missing')}
                              <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textAlign: 'center' }}>画像取得エラーのため解析スキップ</div>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                {getVisibilityBadge(result.visibility)}
                                <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: result.is_sunny ? '#f59e0b' : 'var(--text-secondary)' }}>
                                  {result.is_sunny ? '☀️ 晴れ' : '☁️ 日差しなし'}
                                </span>
                              </div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between' }}>
                                <span>雲量: {result.cloud_cover}/10</span>
                              </div>
                              <div style={{ fontSize: '0.7rem', color: 'var(--text-primary)', marginTop: '0.2rem', lineHeight: 1.3 }}>
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
