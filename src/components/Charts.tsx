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
              ⚠️ 極端な大雨・荒天アラート日 (降水 {data.precipitation} mm)
            </p>
          )}
          {data.weatherText && (
            <div style={{ marginBottom: '8px', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              <p>天候: {data.weatherText}</p>
              {data.sunshineDuration !== undefined && data.sunshineDuration !== null && (
                <p>日照時間: {data.sunshineDuration} h</p>
              )}
              <p>降水量: {data.precipitation} mm</p>
              <p>風: {data.windDirection} {data.windSpeedMax} m/s</p>
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
        <h2 className="card-title">日別入山者数 ＆ 天候</h2>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
          💡 グラフのバーをクリックすると、その日の時間帯別グラフと内訳データが表示されます。
        </p>

        <div className="chart-container">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={mergedDailyData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
              <XAxis dataKey="displayDate" stroke="var(--text-secondary)" tick={{ fill: 'var(--text-secondary)' }} />
              <YAxis yAxisId="left" stroke="var(--text-secondary)" tick={{ fill: 'var(--text-secondary)' }} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ paddingTop: '20px' }} />
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
              <span>⚠️ 極端な大雨・荒天による入山者減少アラート日 (日降水量 20mm以上)</span>
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
              ※ 極端に人数が少ない日は、豪雨や強風・荒天により入山が困難であったケースが一目で分かります（該当の棒グラフも赤色で警告ハイライトされています）。
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
