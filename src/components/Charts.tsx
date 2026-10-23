import {
  Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart, Cell
} from 'recharts';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
// @ts-ignore
import * as JapaneseHolidays from 'japanese-holidays';
import { getWeatherDescription, getWindDirection, getWeatherCategory, getWeatherCategoryColor } from '../utils/weatherApi';
import { evaluateDailyCameraVisibility, type ImageAnalysis } from '../hooks/useCameraAnalysis';

interface ChartProps {
  dailyData: any[];
  hourlyData: any[];
  weatherData: Record<string, any>;
  cameraAnalysis?: Record<string, ImageAnalysis[]>;
  onSelectDate?: (dateStr: string) => void;
}

export const Charts: React.FC<ChartProps> = ({ dailyData, weatherData, cameraAnalysis = {}, onSelectDate }) => {
  // Merge weather data into daily data (アメダス実測 × 3方向カメラ7回 ハイブリッド判定)
  const mergedDailyData = dailyData.map(d => {
    const weather = weatherData[d.date];
    const camData = cameraAnalysis[d.date] || [];
    
    // 山頂の天候を評価（新・山頂ピーク厳格判定ルールに基づく共通関数を使用）
    const camSummary = evaluateDailyCameraVisibility(camData);
    const mountainCategory = camSummary.mountainCategory;

    const wDesc = weather && weather.weatherCode !== undefined
      ? getWeatherDescription(weather.weatherCode, weather.precipitation, weather.sunshineDuration, d.date, camData)
      : null;
    const category = weather && weather.weatherCode !== undefined
      ? getWeatherCategory(weather.weatherCode, weather.precipitation, weather.sunshineDuration, d.date, camData)
      : 'Unknown';

    // 麓は晴れだが山頂がガス・雲隠れの場合は「オレンジ枠線＋淡色塗り（白抜き風）」で視覚的に区別
    let barColor = getWeatherCategoryColor(category);
    let barStroke = barColor;
    let barStrokeWidth = 0;

    if (category === 'Sunny') {
      if (mountainCategory === 'clear') {
        barColor = '#f59e0b'; // 麓も晴れ × 山頂も快晴（濃いオレンジ塗りつぶし）
        barStroke = '#d97706';
      } else if (mountainCategory === 'foggy' || mountainCategory === 'cloudy') {
        barColor = 'rgba(251, 191, 36, 0.28)'; // 麓は晴れ × 山頂雲隠れ・ガス（オレンジ枠線・中空風）
        barStroke = '#f59e0b';
        barStrokeWidth = 2;
      }
    }

    return {
      ...d,
      displayDate: format(parseISO(d.date), 'M/d (E)', { locale: ja }),
      tempMax: weather ? weather.tempMax : null,
      tempMin: weather ? weather.tempMin : null,
      weatherCode: weather ? weather.weatherCode : null,
      weatherCategory: category,
      mountainCategory,
      avgCloudCover: camSummary.avgCloudCover,
      weatherText: wDesc ? `${wDesc.emoji} ${wDesc.text}` : '',
      precipitation: weather ? weather.precipitation : null,
      sunshineDuration: weather ? weather.sunshineDuration : null,
      windSpeedMax: weather ? weather.windSpeedMax : null,
      windDirection: weather && weather.windDirection !== undefined ? getWindDirection(weather.windDirection) : null,
      kutsugata: weather?.kutsugata || null,
      motodomari: weather?.motodomari || null,
      color: barColor,
      strokeColor: barStroke,
      strokeWidth: barStrokeWidth,
    };
  });

  // 極端な大雨・荒天日 (日降水量 20mm以上 または HeavyRain判定)
  const heavyRainDays = mergedDailyData.filter(d => d.weatherCategory === 'HeavyRain' || (d.precipitation && d.precipitation >= 20.0));

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="chart-tooltip">
          <p style={{ fontWeight: 'bold', marginBottom: '8px' }}>{label}</p>
          {data.weatherCategory === 'HeavyRain' && (
            <p style={{ color: '#ef4444', fontWeight: 'bold', margin: '4px 0', fontSize: '0.85rem' }}>
              ⚠️ 大雨・荒天アラート日 (降水 {data.precipitation} mm)
            </p>
          )}
          {data.weatherText && (
            <div style={{ marginBottom: '8px', fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
              <p style={{ margin: '2px 0', color: 'var(--text-primary)', fontWeight: 700 }}>
                島の天候判定: {data.weatherText}
              </p>
              
              {data.mountainCategory && data.mountainCategory !== 'unknown' && (
                <p style={{ margin: '4px 0', padding: '2px 6px', borderRadius: '4px', display: 'inline-block', backgroundColor: data.mountainCategory === 'clear' ? 'rgba(245, 158, 11, 0.15)' : data.mountainCategory === 'foggy' ? 'rgba(148, 163, 184, 0.2)' : 'rgba(203, 213, 225, 0.15)', color: data.mountainCategory === 'clear' ? '#d97706' : data.mountainCategory === 'foggy' ? '#64748b' : '#475569', fontWeight: 700, fontSize: '0.82rem' }}>
                  📷 3方向カメラ山頂視界: {data.mountainCategory === 'clear' ? '🏔️ 山頂快晴 (Clear)' : data.mountainCategory === 'foggy' ? '🌫️ 山体ガス (Foggy)' : '☁️ 山頂雲隠れ (Cloudy)'}
                  {data.avgCloudCover !== null && data.avgCloudCover !== undefined ? ` / 平均雲量 ${data.avgCloudCover}` : ''}
                </p>
              )}

              <p style={{ margin: '2px 0' }}>
                ☀️ 日照時間: {data.sunshineDuration !== undefined && data.sunshineDuration !== null ? `${data.sunshineDuration} 時間 (沓形アメダス実測)` : '-'}
              </p>
              <p style={{ margin: '2px 0' }}>☔ 降水量(最大): {data.precipitation} mm</p>
              <p style={{ margin: '2px 0' }}>💨 最大風速: {data.windDirection} {data.windSpeedMax} m/s</p>
              {data.kutsugata && data.motodomari && (
                <div style={{ marginTop: '4px', padding: '4px 6px', backgroundColor: 'rgba(148, 163, 184, 0.12)', borderRadius: '4px', fontSize: '0.78rem' }}>
                  <div>・本泊(北): 降水 {data.motodomari.precipitation}mm / 最高 {data.motodomari.tempMax}℃ / 風 {data.motodomari.windSpeedMax}m/s({data.motodomari.windDirectionText})</div>
                  <div>・沓形(西): 降水 {data.kutsugata.precipitation}mm / 最高 {data.kutsugata.tempMax}℃ / 風 {data.kutsugata.windSpeedMax}m/s({data.kutsugata.windDirectionText})</div>
                </div>
              )}
            </div>
          )}
          {payload.map((entry: any, index: number) => {
            if (entry.value === null || entry.value === undefined) return null;
            return (
              <p key={index} style={{ color: entry.color === 'rgba(251, 191, 36, 0.28)' ? '#d97706' : entry.color, fontWeight: 700, margin: '4px 0' }}>
                {entry.name}: {entry.value} {entry.name.includes('気温') ? '℃' : '人'}
              </p>
            );
          })}
        </div>
      );
    }
    return null;
  };

  const renderCustomTick = (props: any) => {
    const { x, y, payload } = props;
    const item = mergedDailyData.find(d => d.displayDate === payload.value);
    let fill = 'var(--text-secondary)';
    
    if (item) {
      const d = new Date(item.date);
      const day = d.getDay();
      const isHoliday = JapaneseHolidays.isHoliday(d);
      
      if (isHoliday || day === 0) {
        fill = '#ef4444'; // Red for Sunday/Holiday
      } else if (day === 6) {
        fill = '#3b82f6'; // Blue for Saturday
      }
    }
    
    return (
      <g transform={`translate(${x},${y})`}>
        <text x={0} y={0} dy={20} textAnchor="middle" fill={fill} fontSize={14} fontWeight={600} fontFamily="inherit">
          {payload.value}
        </text>
      </g>
    );
  };

  return (
    <div>
      <div className="card">
        <h2 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span>📊 日別入山者数 ＆ 天候（アメダス実測 × 3方向カメラハイブリッド判定）</span>
        </h2>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
          💡 グラフの棒（バー）をクリックすると、その日の「詳細な時間帯別グラフと本泊・沓形アメダス実測内訳」が表示されます。
        </p>

        {/* 棒グラフの色に対応する天候凡例バー (カラーバッジ) */}
        <div style={{
          display: 'flex',
          flexWrap: 'nowrap',
          alignItems: 'center',
          gap: '1rem',
          padding: '0.65rem 1.1rem',
          backgroundColor: 'var(--bg-primary)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-md)',
          marginBottom: '1.25rem',
          boxShadow: 'var(--shadow-sm)',
          overflowX: 'auto',
          whiteSpace: 'nowrap'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-secondary)', flexShrink: 0 }}>
            <span>🎨 天候カラー凡例:</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', fontSize: '0.82rem', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'default' }} title="快晴 / 好天 (山頂視界良好)">
              <span style={{ width: '13px', height: '13px', borderRadius: '3px', backgroundColor: '#fbbf24', display: 'inline-block', boxShadow: '0 0 4px rgba(251, 191, 36, 0.4)', flexShrink: 0 }} />
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>☀️ 晴れ</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'default' }} title="麓晴れ・山頂笠雲/ガス (カメラ判定時)">
              <span style={{ width: '13px', height: '13px', borderRadius: '3px', backgroundColor: 'rgba(251, 191, 36, 0.28)', border: '2px solid #f59e0b', display: 'inline-block', boxSizing: 'border-box', flexShrink: 0 }} />
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>🌤️ 麓晴れ・山頂ガス</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'default' }} title="日照4h未満・無降水">
              <span style={{ width: '13px', height: '13px', borderRadius: '3px', backgroundColor: '#94a3b8', display: 'inline-block', boxShadow: '0 0 4px rgba(148, 163, 184, 0.4)', flexShrink: 0 }} />
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>☁️ 曇り</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'default' }} title="日降水量3mm以上 または 小雨曇天">
              <span style={{ width: '13px', height: '13px', borderRadius: '3px', backgroundColor: '#3b82f6', display: 'inline-block', boxShadow: '0 0 4px rgba(59, 130, 246, 0.4)', flexShrink: 0 }} />
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>☔ 雨</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'default' }} title="日降水量20mm以上 または 最大1時間10mm以上">
              <span style={{ width: '13px', height: '13px', borderRadius: '3px', backgroundColor: '#ef4444', display: 'inline-block', boxShadow: '0 0 4px rgba(239, 68, 68, 0.4)', flexShrink: 0 }} />
              <span style={{ fontWeight: 600, color: '#ef4444' }}>🚨 大雨・荒天</span>
            </div>
          </div>
        </div>

        <div className="chart-container">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={mergedDailyData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
              <XAxis dataKey="displayDate" stroke="var(--text-secondary)" tick={renderCustomTick} />
              <YAxis yAxisId="left" stroke="var(--text-secondary)" tick={{ fill: 'var(--text-secondary)', fontSize: 13, fontWeight: 600 }} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ paddingTop: '15px', fontWeight: 600 }} />
              <Bar 
                yAxisId="left" 
                dataKey="enter" 
                name="入山者数" 
                radius={[4, 4, 0, 0]}
                cursor="pointer"
                onClick={(data: any) => {
                  if (data && data.date && onSelectDate) {
                    onSelectDate(data.date);
                  }
                }}
              >
                {mergedDailyData.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={entry.color}
                    stroke={entry.strokeColor}
                    strokeWidth={entry.strokeWidth || 0}
                  />
                ))}
              </Bar>
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {heavyRainDays.length > 0 && (
          <div style={{
            marginTop: '1.25rem',
            padding: '1rem 1.25rem',
            backgroundColor: 'rgba(239, 68, 68, 0.08)',
            borderLeft: '4px solid #ef4444',
            borderRadius: '8px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, color: '#ef4444', marginBottom: '0.6rem', fontSize: '0.95rem' }}>
              <span>⚠️ 大雨・荒天による入山者減少アラート日 (日降水量 20mm以上)</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
              {heavyRainDays.map(d => (
                <button 
                  key={d.date} 
                  onClick={() => onSelectDate?.(d.date)}
                  style={{
                  padding: '0.35rem 0.75rem',
                  backgroundColor: '#ef4444',
                  color: '#ffffff',
                  borderRadius: '6px',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  border: 'none',
                  cursor: 'pointer',
                  boxShadow: '0 2px 4px rgba(239, 68, 68, 0.25)',
                  transition: 'transform 0.1s ease, boxShadow 0.1s ease'
                }}
                onMouseOver={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 4px 8px rgba(239, 68, 68, 0.35)'; }}
                onMouseOut={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 2px 4px rgba(239, 68, 68, 0.25)'; }}
                >
                  <span>🌧️ {d.displayDate}</span>
                  <span>|</span>
                  <span>降水 <strong>{d.precipitation} mm</strong></span>
                  <span>|</span>
                  <span>入山 <strong>{d.enter}人</strong></span>
                </button>
              ))}
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.55rem 0 0 0' }}>
              ※ 人数が少ない日は、大雨や強風・荒天により入山が困難であったケースが一目で分かります（該当の棒グラフも赤色でハイライトされています）。
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
