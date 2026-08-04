import {
  Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart, Cell
} from 'recharts';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { getWeatherDescription, getWindDirection, getWeatherCategory, getWeatherCategoryColor } from '../utils/weatherApi';

interface ChartProps {
  dailyData: any[];
  hourlyData: any[];
  weatherData: Record<string, any>;
  onSelectDate?: (dateStr: string) => void;
}

export const Charts: React.FC<ChartProps> = ({ dailyData, weatherData, onSelectDate }) => {
  // Merge weather data into daily data
  const mergedDailyData = dailyData.map(d => {
    const weather = weatherData[d.date];
    const wDesc = weather && weather.weatherCode !== undefined
      ? getWeatherDescription(weather.weatherCode, weather.precipitation, weather.sunshineDuration)
      : null;
    const category = weather && weather.weatherCode !== undefined
      ? getWeatherCategory(weather.weatherCode, weather.precipitation, weather.sunshineDuration)
      : 'Unknown';
    return {
      ...d,
      displayDate: format(parseISO(d.date), 'M/d (E)', { locale: ja }),
      tempMax: weather ? weather.tempMax : null,
      weatherCode: weather ? weather.weatherCode : null,
      weatherCategory: category,
      weatherText: wDesc ? `${wDesc.emoji} ${wDesc.text}` : '',
      precipitation: weather ? weather.precipitation : null,
      sunshineDuration: weather ? weather.sunshineDuration : null,
      windSpeedMax: weather ? weather.windSpeedMax : null,
      windDirection: weather && weather.windDirection !== undefined ? getWindDirection(weather.windDirection) : null,
      color: getWeatherCategoryColor(category),
    };
  });

  // 極端な大雨・荒天日 (日降水量 20mm以上)
  const heavyRainDays = mergedDailyData.filter(d => d.precipitation && d.precipitation >= 20.0);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="chart-tooltip">
          <p style={{ fontWeight: 'bold', marginBottom: '8px' }}>{label}</p>
          {data.precipitation && data.precipitation >= 20 && (
            <p style={{ color: '#ef4444', fontWeight: 'bold', margin: '4px 0', fontSize: '0.85rem' }}>
              ⚠️ 大雨・荒天アラート日 (降水 {data.precipitation} mm)
            </p>
          )}
          {data.weatherText && (
            <div style={{ marginBottom: '8px', fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              <p style={{ margin: '2px 0', color: 'var(--text-primary)', fontWeight: 600 }}>天候: {data.weatherText}</p>
              <p style={{ margin: '2px 0' }}>
                ☀️ 日照時間: {data.sunshineDuration !== undefined && data.sunshineDuration !== null ? `${data.sunshineDuration} 時間` : '-'}
              </p>
              <p style={{ margin: '2px 0' }}>☔ 降水量: {data.precipitation} mm</p>
              <p style={{ margin: '2px 0' }}>💨 風: {data.windDirection} {data.windSpeedMax} m/s</p>
            </div>
          )}
          {payload.map((entry: any, index: number) => {
            if (entry.value === null || entry.value === undefined) return null;
            return (
              <p key={index} style={{ color: entry.color, margin: '4px 0' }}>
                {entry.name}: {entry.value} {entry.name.includes('気温') ? '℃' : '人'}
              </p>
            );
          })}
        </div>
      );
    }
    return null;
  };

  return (
    <div>
      <div className="card">
        <h2 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span>📊 日別入山者数 ＆ 天候</span>
        </h2>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
          💡 グラフの棒（バー）をクリックすると、その日の「詳細な時間帯別グラフと気象データ内訳」が表示されます。
        </p>

        {/* 棒グラフの色に対応する天候凡例バー (カラーバッジ) */}
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
          padding: '0.85rem 1.25rem',
          backgroundColor: 'var(--bg-primary)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-md)',
          marginBottom: '1.25rem',
          boxShadow: 'var(--shadow-sm)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
            <span>🎨 棒グラフ天候カラー凡例:</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '1.1rem', fontSize: '0.83rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span style={{ width: '13px', height: '13px', borderRadius: '3px', backgroundColor: '#fbbf24', display: 'inline-block', boxShadow: '0 0 4px rgba(251, 191, 36, 0.4)' }} />
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>晴れ</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span style={{ width: '13px', height: '13px', borderRadius: '3px', backgroundColor: '#94a3b8', display: 'inline-block', boxShadow: '0 0 4px rgba(148, 163, 184, 0.4)' }} />
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>曇り</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span style={{ width: '13px', height: '13px', borderRadius: '3px', backgroundColor: '#3b82f6', display: 'inline-block', boxShadow: '0 0 4px rgba(59, 130, 246, 0.4)' }} />
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>雨・雪</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span style={{ width: '13px', height: '13px', borderRadius: '3px', backgroundColor: '#ef4444', display: 'inline-block', boxShadow: '0 0 4px rgba(239, 68, 68, 0.4)' }} />
              <span style={{ fontWeight: 600, color: '#ef4444' }}>⚠️ 大雨・荒天 (20mm以上)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span style={{ width: '13px', height: '13px', borderRadius: '3px', backgroundColor: '#10b981', display: 'inline-block', boxShadow: '0 0 4px rgba(16, 185, 129, 0.4)' }} />
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>気象未取得・標準</span>
            </div>
          </div>
        </div>

        <div className="chart-container">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={mergedDailyData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
              <XAxis dataKey="displayDate" stroke="var(--text-secondary)" tick={{ fill: 'var(--text-secondary)' }} />
              <YAxis yAxisId="left" stroke="var(--text-secondary)" tick={{ fill: 'var(--text-secondary)' }} />
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
                  <Cell key={`cell-${index}`} fill={entry.color} />
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
                <div key={d.date} style={{
                  padding: '0.35rem 0.75rem',
                  backgroundColor: '#ef4444',
                  color: '#ffffff',
                  borderRadius: '6px',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  boxShadow: '0 2px 4px rgba(239, 68, 68, 0.25)'
                }}>
                  <span>🌧️ {d.displayDate}</span>
                  <span>|</span>
                  <span>降水 <strong>{d.precipitation} mm</strong></span>
                  <span>|</span>
                  <span>入山 <strong>{d.enter}人</strong></span>
                </div>
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
