import React, { useState, useEffect } from 'react';
import type { DailyDetails } from '../utils/logParser';
import { getWeatherDescription, getWindDirection, type WeatherData, type HourlyWeatherData } from '../utils/weatherApi';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Calendar, Users, ArrowUpRight, ArrowDownRight, X, Wind, Droplets, Thermometer, Timer, Camera, ChevronLeft, ChevronRight } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { LiveCamViewer } from './LiveCamViewer';
import { HourlyCamModal } from './HourlyCamModal';

interface DailyDetailViewProps {
  details: DailyDetails;
  weather?: WeatherData;
  hourlyWeather?: Record<string, HourlyWeatherData>;
  onClose: () => void;
  onSelectDate?: (dateStr: string) => void;
  prevDate?: string;
  nextDate?: string;
}

export const DailyDetailView: React.FC<DailyDetailViewProps> = ({ details, weather, hourlyWeather, onClose, onSelectDate, prevDate, nextDate }) => {
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

  const displayHours = details.hourly; // 24時間フル表示 (00:00〜23:00)

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
          {payload
            .slice()
            .sort((a: any) => (a.dataKey === 'enter' ? -1 : 1))
            .map((entry: any, index: number) => (
              <p key={index} style={{ color: entry.color, margin: '4px 0', fontWeight: 'bold' }}>
                {entry.name}: {entry.value} 人
              </p>
            ))}
        </div>
      );
    }
    return null;
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        backgroundColor: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(5px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem',
        overflowY: 'auto'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="card"
        style={{
          border: '2px solid var(--accent-primary)',
          position: 'relative',
          margin: 'auto',
          backgroundColor: 'var(--bg-secondary)',
          width: '100%',
          maxWidth: '960px',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
          borderRadius: '16px',
          padding: '2rem'
        }}
      >
        <button 
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '1.25rem',
            right: '1.25rem',
            background: 'var(--bg-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: '50%',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            padding: '0.4rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: 'var(--shadow-sm)',
            transition: 'all 0.15s ease'
          }}
          title="閉じる (Esc)"
        >
          <X size={22} />
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

      {/* 「前の日」「次の日」移動ボタン（入山/下山の差分のうえあたりに配置） */}
      {(prevDate || nextDate) && (
        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          gap: '0.6rem',
          marginBottom: '0.85rem',
          flexWrap: 'wrap'
        }}>
          {prevDate ? (
            <button
              onClick={() => onSelectDate?.(prevDate)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.45rem 0.95rem',
                backgroundColor: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: '9999px',
                fontSize: '0.88rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
              }}
              title={`${prevDate} の詳細アナリティクスを見る`}
            >
              <ChevronLeft size={16} />
              <span>前の日 ({format(parseISO(prevDate), 'MM/dd')})</span>
            </button>
          ) : (
            <button
              disabled
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.45rem 0.95rem',
                backgroundColor: 'var(--bg-primary)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: '9999px',
                fontSize: '0.88rem',
                fontWeight: 600,
                opacity: 0.4,
                cursor: 'not-allowed'
              }}
            >
              <ChevronLeft size={16} />
              <span>前の日 なし</span>
            </button>
          )}

          {nextDate ? (
            <button
              onClick={() => onSelectDate?.(nextDate)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.45rem 0.95rem',
                backgroundColor: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: '9999px',
                fontSize: '0.88rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
              }}
              title={`${nextDate} の詳細アナリティクスを見る`}
            >
              <span>次の日 ({format(parseISO(nextDate), 'MM/dd')})</span>
              <ChevronRight size={16} />
            </button>
          ) : (
            <button
              disabled
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.45rem 0.95rem',
                backgroundColor: 'var(--bg-primary)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: '9999px',
                fontSize: '0.88rem',
                fontWeight: 600,
                opacity: 0.4,
                cursor: 'not-allowed'
              }}
            >
              <span>次の日 なし</span>
              <ChevronRight size={16} />
            </button>
          )}
        </div>
      )}

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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.85rem', marginTop: '1.75rem' }}>
        <h4 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <span>📈 時間帯別 通行グラフ (00:00〜23:00) ＆ 天気要因分析</span>
        </h4>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
          <span>💡 早い時間帯(左)は<strong>入山</strong>、午後〜夕方(右)は<strong>下山</strong>がピークになります</span>
        </div>
      </div>

      {/* 左側に ■入山者数、右側に ■下山者数 を完全固定配置したスタイリッシュ凡例 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '2.5rem',
        marginBottom: '0.75rem',
        padding: '0.5rem 1rem',
        backgroundColor: 'var(--bg-primary)',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-md)',
        fontSize: '0.9rem',
        fontWeight: 700
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-primary)' }}>
          <span style={{ width: '14px', height: '14px', borderRadius: '3px', backgroundColor: 'var(--enter-color)', display: 'inline-block', boxShadow: '0 0 4px var(--enter-color)' }} />
          <span>入山者数</span>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600 }}>(早い時間帯に集中)</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-primary)' }}>
          <span style={{ width: '14px', height: '14px', borderRadius: '3px', backgroundColor: 'var(--exit-color)', display: 'inline-block', boxShadow: '0 0 4px var(--exit-color)' }} />
          <span>下山者数</span>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600 }}>(午後〜夕方に集中)</span>
        </div>
      </div>

      <div className="chart-container" style={{ height: '300px', marginBottom: '1.75rem' }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={details.hourly} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
            <XAxis dataKey="hour" stroke="var(--text-secondary)" tick={{ fill: 'var(--text-secondary)' }} />
            <YAxis stroke="var(--text-secondary)" tick={{ fill: 'var(--text-secondary)' }} />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="enter" name="入山者数" fill="var(--enter-color)" radius={[4, 4, 0, 0]} />
            <Bar dataKey="exit" name="下山者数" fill="var(--exit-color)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Hourly Breakdown Table with Weather */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.6rem' }}>
        <h4 style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0 }}>
          時間帯別 内訳＆気象要因テーブル <span style={{ fontSize: '0.85rem', fontWeight: 400, color: 'var(--text-secondary)' }}>(24時間フル表示)</span>
        </h4>
        <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
          ※ 入山・下山者がいない時間帯も気象状況を確認できるよう00:00〜23:00の全24時間を表示しています
        </span>
      </div>
      {displayHours.length === 0 ? (
        <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '1rem' }}>この日の通行記録はありません。</p>
      ) : (
        <div style={{ overflowX: 'auto', marginBottom: '2rem' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.95rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                <th style={{ padding: '0.6rem' }}>時間帯</th>
                <th style={{ padding: '0.6rem' }}>天気 (1h)</th>
                <th style={{ padding: '0.6rem' }}>気温 / 降水</th>
                <th style={{ padding: '0.6rem' }}>風向 / 風速</th>
                <th style={{ padding: '0.6rem', color: 'var(--enter-color)' }}>入山者数</th>
                <th style={{ padding: '0.6rem', color: 'var(--exit-color)' }}>下山者数</th>
                <th style={{ padding: '0.6rem' }}>合計</th>
                <th style={{ padding: '0.6rem', textAlign: 'center' }}>山の状況 (カメラ)</th>
              </tr>
            </thead>
            <tbody>
              {displayHours.map((h, i) => {
                const hw = hourlyWeather && hourlyWeather[h.hour];
                const hwDesc = hw ? getWeatherDescription(hw.weatherCode, hw.precipitation) : null;
                const hrStr = h.hour.toString().padStart(2, '0');
                const hrRecords = camHistory?.records?.[details.dateStr]?.[hrStr];
                const hasCamRecord = !!hrRecords && Object.keys(hrRecords).length > 0;

                return (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: i % 2 === 0 ? 'var(--bg-primary)' : 'transparent' }}>
                    <td style={{ padding: '0.55rem 0.6rem', fontWeight: 600 }}>{h.hour}</td>
                    <td style={{ padding: '0.55rem 0.6rem' }}>
                      {hwDesc ? `${hwDesc.emoji} ${hwDesc.text}` : hw ? `${hw.weatherEmoji} ${hw.weatherText}` : '-'}
                    </td>
                    <td style={{ padding: '0.55rem 0.6rem', color: 'var(--text-secondary)' }}>
                      {hw ? `${hw.temp}℃ / ${hw.precipitation}mm` : '-'}
                    </td>
                    <td style={{
                      padding: '0.55rem 0.6rem',
                      color: hw && hw.windSpeed >= 15 ? '#ef4444' : hw && hw.windSpeed >= 10 ? '#f97316' : 'var(--text-secondary)',
                      fontWeight: hw && hw.windSpeed >= 10 ? 700 : 400
                    }}>
                      {hw ? (
                        <span>
                          {hw.windSpeed >= 15 && '⚠️ '}
                          {hw.windSpeed >= 10 && hw.windSpeed < 15 && '💨 '}
                          {hw.windDirectionText || '-'} {hw.windSpeed}m/s
                        </span>
                      ) : '-'}
                    </td>
                    <td style={{ padding: '0.55rem 0.6rem', fontWeight: 600, color: 'var(--enter-color)' }}>{h.enter} 人</td>
                    <td style={{ padding: '0.55rem 0.6rem', color: 'var(--exit-color)' }}>{h.exit} 人</td>
                    <td style={{ padding: '0.55rem 0.6rem', fontWeight: 700 }}>{h.enter + h.exit} 人</td>
                    <td style={{ padding: '0.55rem 0.6rem', textAlign: 'center' }}>
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
                          title={`${h.hour}時台の鴛泊・沓形・仙法志カメラ状況を確認`}
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
    </div>
  );
};
