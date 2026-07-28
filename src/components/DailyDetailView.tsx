import React, { useState, useEffect } from 'react';
import type { DailyDetails } from '../utils/logParser';
import { getWeatherDescription, getWindDirection, type WeatherData, type HourlyWeatherData } from '../utils/weatherApi';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Calendar, Users, ArrowUpRight, ArrowDownRight, X, Wind, Droplets, Thermometer, Timer, Camera } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { LiveCamViewer } from './LiveCamViewer';
import { HourlyCamModal } from './HourlyCamModal';

interface DailyDetailViewProps {
  details: DailyDetails;
  weather?: WeatherData;
  hourlyWeather?: Record<string, HourlyWeatherData>;
  onClose: () => void;
}

export const DailyDetailView: React.FC<DailyDetailViewProps> = ({ details, weather, hourlyWeather, onClose }) => {
  const [selectedModalHour, setSelectedModalHour] = useState<string | null>(null);
  const [camHistory, setCamHistory] = useState<any | null>(null);

  useEffect(() => {
    fetch('/cams/history.json?t=' + Date.now())
      .then(res => res.ok ? res.json() : null)
      .then(data => setCamHistory(data))
      .catch(() => setCamHistory(null));
  }, [details.dateStr]);

  const displayDate = format(parseISO(details.dateStr), 'yyyy年MM月dd日 (E)', { locale: ja });
  const wDesc = weather && weather.weatherCode !== undefined
    ? getWeatherDescription(weather.weatherCode, weather.precipitation, weather.sunshineDuration)
    : null;
  const windDir = weather && weather.windDirection !== undefined ? getWindDirection(weather.windDirection) : '';

  const activeHours = details.hourly.filter(h => h.enter + h.exit > 0);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const hw = hourlyWeather && hourlyWeather[label];
      return (
        <div className="chart-tooltip">
          <p style={{ fontWeight: 'bold', marginBottom: '6px', fontSize: '1rem' }}>{label}時台</p>
          {hw && (
            <div style={{ marginBottom: '8px', fontSize: '0.85rem', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)', paddingBottom: '4px' }}>
              <p>{hw.weatherEmoji} {hw.weatherText} | 気温: {hw.temp}℃</p>
              <p>降水: {hw.precipitation}mm | 風速: {hw.windSpeed}m/s</p>
            </div>
          )}
          {payload.map((entry: any, index: number) => (
            <p key={index} style={{ color: entry.color, margin: '4px 0', fontWeight: 'bold' }}>
              {entry.name}: {entry.value} 人
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="card" style={{ border: '2px solid var(--accent-primary)', position: 'relative', marginTop: '1.5rem', backgroundColor: 'var(--bg-secondary)' }}>
      <button 
        onClick={onClose}
        style={{
          position: 'absolute',
          top: '1rem',
          right: '1rem',
          background: 'transparent',
          border: 'none',
          color: 'var(--text-secondary)',
          cursor: 'pointer',
          padding: '0.25rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
        title="閉じる"
      >
        <X size={24} />
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <Calendar className="dropzone-icon" style={{ width: 28, height: 28 }} />
        <div>
          <h3 style={{ fontSize: '1.4rem', fontWeight: 700, margin: 0 }}>{displayDate} の詳細アナリティクス</h3>
          {weather && (
            <div style={{ display: 'flex', gap: '1rem', fontSize: '0.95rem', color: 'var(--text-secondary)', marginTop: '0.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <span>天候: <strong>{wDesc ? `${wDesc.emoji} ${wDesc.text}` : '不明'}</strong></span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}><Thermometer size={16} /> 最高 <strong>{weather.tempMax}℃</strong></span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}><Droplets size={16} /> 降水量 <strong>{weather.precipitation}mm</strong></span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}><Wind size={16} /> 風 <strong>{windDir} {weather.windSpeedMax}m/s</strong></span>
            </div>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="controls-grid" style={{ marginBottom: '1.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <div className="card" style={{ margin: 0, padding: '1rem', textAlign: 'center', backgroundColor: 'var(--bg-primary)' }}>
          <div style={{ color: 'var(--enter-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', fontWeight: 600, fontSize: '0.9rem' }}>
            <ArrowUpRight size={18} /> 入山者数 (合計)
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 700, marginTop: '0.4rem' }}>
            {details.totalEnter} <span style={{ fontSize: '0.9rem', fontWeight: 400 }}>人</span>
          </div>
        </div>

        <div className="card" style={{ margin: 0, padding: '1rem', textAlign: 'center', backgroundColor: 'var(--bg-primary)' }}>
          <div style={{ color: 'var(--exit-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', fontWeight: 600, fontSize: '0.9rem' }}>
            <ArrowDownRight size={18} /> 下山者数 (合計)
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 700, marginTop: '0.4rem' }}>
            {details.totalExit} <span style={{ fontSize: '0.9rem', fontWeight: 400 }}>人</span>
          </div>
        </div>

        <div className="card" style={{ margin: 0, padding: '1rem', textAlign: 'center', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--accent-primary)' }}>
          <div style={{ color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', fontWeight: 700, fontSize: '0.9rem' }}>
            <Timer size={18} /> 推定 山中滞在時間
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, marginTop: '0.4rem', color: 'var(--accent-primary)' }}>
            {details.estDurationStr}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
            平均入山 {details.avgEnterTimeStr} → 平均下山 {details.avgExitTimeStr}
          </div>
        </div>

        <div className="card" style={{ margin: 0, padding: '1rem', textAlign: 'center', backgroundColor: 'var(--bg-primary)' }}>
          <div style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', fontWeight: 600, fontSize: '0.9rem' }}>
            <Users size={18} /> 入山/下山の差分
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 700, marginTop: '0.4rem' }}>
            {details.totalEnter - details.totalExit > 0 ? `+${details.totalEnter - details.totalExit}` : details.totalEnter - details.totalExit} <span style={{ fontSize: '0.9rem', fontWeight: 400 }}>人</span>
          </div>
        </div>
      </div>

      {/* Hourly Chart for the specific day */}
      <h4 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.75rem', marginTop: '1.5rem' }}>時間帯別 通行グラフ (00:00〜23:00) ＆ 天気要因分析</h4>
      <div className="chart-container" style={{ height: '300px', marginBottom: '1.5rem' }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={details.hourly} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
            <XAxis dataKey="hour" stroke="var(--text-secondary)" tick={{ fill: 'var(--text-secondary)' }} />
            <YAxis stroke="var(--text-secondary)" tick={{ fill: 'var(--text-secondary)' }} />
            <Tooltip content={<CustomTooltip />} />
            <Legend />
            <Bar dataKey="enter" name="入山者数" fill="var(--enter-color)" radius={[4, 4, 0, 0]} />
            <Bar dataKey="exit" name="下山者数" fill="var(--exit-color)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Hourly Breakdown Table with Weather */}
      <h4 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.75rem' }}>時間帯別 内訳＆気象要因テーブル</h4>
      {activeHours.length === 0 ? (
        <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '1rem' }}>この日の通行記録はありません。</p>
      ) : (
        <div style={{ overflowX: 'auto', marginBottom: '2rem' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.95rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                <th style={{ padding: '0.6rem' }}>時間帯</th>
                <th style={{ padding: '0.6rem' }}>天気 (1h)</th>
                <th style={{ padding: '0.6rem' }}>気温 / 降水</th>
                <th style={{ padding: '0.6rem', color: 'var(--enter-color)' }}>入山者数</th>
                <th style={{ padding: '0.6rem', color: 'var(--exit-color)' }}>下山者数</th>
                <th style={{ padding: '0.6rem' }}>合計</th>
                <th style={{ padding: '0.6rem', textAlign: 'center' }}>山の状況 (カメラ)</th>
              </tr>
            </thead>
            <tbody>
              {activeHours.map((h, i) => {
                const hw = hourlyWeather && hourlyWeather[h.hour];
                const hrStr = h.hour.toString().padStart(2, '0');
                const hrRecords = camHistory?.records?.[details.dateStr]?.[hrStr];
                const hasCamRecord = !!hrRecords && Object.keys(hrRecords).length > 0;

                return (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: i % 2 === 0 ? 'var(--bg-primary)' : 'transparent' }}>
                    <td style={{ padding: '0.6rem', fontWeight: 600 }}>{h.hour}</td>
                    <td style={{ padding: '0.6rem' }}>
                      {hw ? `${hw.weatherEmoji} ${hw.weatherText}` : '-'}
                    </td>
                    <td style={{ padding: '0.6rem', color: 'var(--text-secondary)' }}>
                      {hw ? `${hw.temp}℃ / ${hw.precipitation}mm` : '-'}
                    </td>
                    <td style={{ padding: '0.6rem', fontWeight: 600, color: 'var(--enter-color)' }}>{h.enter} 人</td>
                    <td style={{ padding: '0.6rem', color: 'var(--exit-color)' }}>{h.exit} 人</td>
                    <td style={{ padding: '0.6rem', fontWeight: 700 }}>{h.enter + h.exit} 人</td>
                    <td style={{ padding: '0.6rem', textAlign: 'center' }}>
                      {hasCamRecord ? (
                        <button
                          onClick={() => setSelectedModalHour(hrStr)}
                          style={{
                            padding: '0.35rem 0.75rem',
                            backgroundColor: 'rgba(16, 185, 129, 0.12)',
                            color: '#10b981',
                            border: '1px solid #10b981',
                            borderRadius: '9999px',
                            fontSize: '0.8rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.35rem',
                            transition: 'all 0.15s ease'
                          }}
                          title={`${h.hour}時台の鴛泊・沓形カメラ状況を確認`}
                        >
                          <Camera size={14} />
                          <span>状況を見る</span>
                          <span
                            style={{
                              width: '6px',
                              height: '6px',
                              borderRadius: '50%',
                              backgroundColor: '#10b981',
                              display: 'inline-block'
                            }}
                          />
                        </button>
                      ) : (
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 利尻山 ライブカメラ コンディション対比（鴛泊・沓形）を最下部に配置 */}
      <LiveCamViewer dateStr={details.dateStr} hourlyWeather={hourlyWeather} />

      {/* 時間帯別カメラ状況ポップアップ (案1のワンクリックモーダル) */}
      {selectedModalHour && (
        <HourlyCamModal
          dateStr={details.dateStr}
          hour={selectedModalHour}
          hourlyWeather={hourlyWeather?.[selectedModalHour] || hourlyWeather?.[parseInt(selectedModalHour, 10).toString()]}
          historyRecords={camHistory?.records?.[details.dateStr]?.[selectedModalHour]}
          onClose={() => setSelectedModalHour(null)}
        />
      )}
    </div>
  );
};
