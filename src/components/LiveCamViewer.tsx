import React, { useState, useEffect } from 'react';
import { ExternalLink, Maximize2, X, Thermometer, Wind, Droplets, Mountain, VideoOff } from 'lucide-react';
import type { HourlyWeatherData } from '../utils/weatherApi';
import { getHistoryJsonUrl, getCamImageUrl } from '../utils/camUrl';

interface LiveCamViewerProps {
  dateStr: string;
  hourlyWeather?: Record<string, HourlyWeatherData>;
}

interface CamHistory {
  updatedAt: string;
  cameras: Record<string, { name: string; videoId: string; url: string }>;
  records: Record<string, Record<string, Record<string, string>>>;
}

const CAMERAS = [
  {
    id: 'oshidomari',
    name: '鴛泊（富士岬）',
    videoId: 'bAWueJBFcT0',
    url: 'https://www.youtube.com/watch?v=bAWueJBFcT0',
    color: '#3b82f6',
    badge: '鴛泊'
  },
  {
    id: 'kutsugata',
    name: '沓形（沓形）',
    videoId: '',
    url: 'https://rishiri-town.jp/wp-content/themes/rishiri/images/MtRishiri/mt-rishiri.jpg',
    color: '#10b981',
    badge: '沓形'
  },
  {
    id: 'senposhi',
    name: '仙法志（御崎）',
    videoId: '5BG3KJVFRVM',
    url: 'https://www.youtube.com/watch?v=5BG3KJVFRVM',
    color: '#f59e0b',
    badge: '仙法志'
  }
];

const HOURS = [
  '00', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11',
  '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23'
];

export const LiveCamViewer: React.FC<LiveCamViewerProps> = ({ dateStr, hourlyWeather }) => {
  const [selectedHour, setSelectedHour] = useState<string>('12');
  const [history, setHistory] = useState<CamHistory | null>(null);
  const [modalImage, setModalImage] = useState<{ url: string; title: string } | null>(null);

  // カメラ履歴 metadata をロード（GitHub Rawから即時取得、失敗時はローカルフォールバック）
  useEffect(() => {
    const fetchHistory = async () => {
      try {
        let res = await fetch(getHistoryJsonUrl());
        if (!res.ok) {
          res = await fetch('/cams/history.json?t=' + Date.now());
        }
        if (res.ok) {
          const data: CamHistory = await res.json();
          setHistory(data);
        }
      } catch (err) {
        console.warn('history.json のロードに失敗しました:', err);
      }
    };
    fetchHistory();
  }, [dateStr]);

  // 利用可能な時間帯をチェック
  const dateRecords = history?.records?.[dateStr] || {};
  const hasRecordForHour = (hr: string) => {
    return !!dateRecords[hr] && Object.keys(dateRecords[hr]).length > 0;
  };

  const currentHourWeather = hourlyWeather?.[selectedHour] || hourlyWeather?.[parseInt(selectedHour, 10).toString()];

  // 時間選択のデフォルト調整 (該当日の12時をデフォルト優先。なければ日中12時に近い記録ある時間を優先、それもなければ12時)
  useEffect(() => {
    const preferredHours = [
      '12', '11', '13', '10', '14', '09', '15', '08', '16', '07', '17',
      '06', '18', '05', '19', '04', '20', '03', '21', '02', '22', '01', '23', '00'
    ];
    const avail = preferredHours.find(hr => hasRecordForHour(hr));
    if (avail) {
      setSelectedHour(avail);
    } else {
      setSelectedHour('12');
    }
  }, [dateStr, history]);

  return (
    <div className="card" style={{
      marginTop: '1.5rem',
      padding: '1.5rem',
      backgroundColor: 'var(--bg-secondary)',
      border: '1px solid var(--border-color)',
      borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-md)'
    }}>
      {/* ヘッダー */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '1rem',
        marginBottom: '1.25rem',
        borderBottom: '1px solid var(--border-color)',
        paddingBottom: '1rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <div style={{
            background: 'linear-gradient(135deg, #3b82f6, #10b981)',
            padding: '0.5rem',
            borderRadius: '0.6rem',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <Mountain size={24} />
          </div>
          <div>
            <h4 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              利尻山 ライブカメラ コンディション対比
            </h4>
          </div>
        </div>
      </div>

      {/* 時間セレクター */}
      <div style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
            時刻を選択 ({selectedHour}時台の定時記録)
          </span>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            ●マークは定時撮影ログが存在する時間帯です
          </span>
        </div>
        <div className="hours-grid">
          {HOURS.map(hr => {
            const hasRec = hasRecordForHour(hr);
            const isSelected = selectedHour === hr;
            return (
              <button
                key={hr}
                onClick={() => setSelectedHour(hr)}
                style={{
                  padding: '0.42rem 0.15rem',
                  border: isSelected ? '2px solid #3b82f6' : '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.14)' : 'var(--bg-primary)',
                  color: isSelected ? '#3b82f6' : 'var(--text-primary)',
                  fontWeight: isSelected ? 700 : 600,
                  fontSize: '0.84rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.2rem',
                  boxShadow: isSelected ? '0 2px 8px rgba(59, 130, 246, 0.28)' : 'none',
                  transition: 'all 0.15s ease'
                }}
              >
                <span>{hr}:00</span>
                {hasRec && (
                  <span style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    backgroundColor: '#10b981',
                    display: 'inline-block',
                    flexShrink: 0
                  }} />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 気象データ連携バナー */}
      {currentHourWeather && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
          padding: '0.75rem 1.25rem',
          backgroundColor: 'rgba(59, 130, 246, 0.08)',
          border: '1px solid rgba(59, 130, 246, 0.2)',
          borderRadius: 'var(--radius-md)',
          marginBottom: '1.25rem',
          fontSize: '0.9rem'
        }}>
          <span style={{ fontWeight: 700, color: 'var(--accent-primary)' }}>
            {selectedHour}時台の気象情報:
          </span>
          <span>{currentHourWeather.weatherEmoji} <strong>{currentHourWeather.weatherText}</strong></span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <Thermometer size={16} /> 気温 <strong>{currentHourWeather.temp}℃</strong>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <Wind size={16} /> 風速 <strong>{currentHourWeather.windSpeed}m/s</strong>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <Droplets size={16} /> 降水量 <strong>{currentHourWeather.precipitation}mm</strong>
          </span>
        </div>
      )}

      {/* 画像カード（鴛泊・沓形 2カラム構成） */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        gap: '1.25rem'
      }}>
        {CAMERAS.map(cam => {
          const todayStr = new Date().toISOString().substring(0, 10);
          const isToday = dateStr === todayStr;
          const imgPath = dateRecords[selectedHour]?.[cam.id];
          const displayUrl = imgPath
            ? getCamImageUrl(imgPath)
            : (isToday && !cam.videoId ? `${cam.url}?t=${Date.now()}` : null);

          return (
            <div
              key={cam.id}
              style={{
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                overflow: 'hidden',
                backgroundColor: 'var(--bg-primary)',
                display: 'flex',
                flexDirection: 'column'
              }}
            >
              {/* カードヘッダー */}
              <div style={{
                padding: '0.75rem 1rem',
                backgroundColor: 'var(--bg-secondary)',
                borderBottom: '1px solid var(--border-color)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <div>
                  <span style={{
                    backgroundColor: cam.color,
                    color: '#fff',
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    padding: '0.2rem 0.5rem',
                    borderRadius: '0.25rem',
                    marginRight: '0.5rem'
                  }}>
                    {cam.badge}
                  </span>
                  <strong style={{ fontSize: '0.95rem' }}>{cam.name}</strong>
                </div>
                <a
                  href={cam.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    color: 'var(--text-secondary)',
                    textDecoration: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                    fontSize: '0.8rem'
                  }}
                  title={cam.url.includes('youtube') ? 'YouTubeで開く' : '利尻町公式カメラを開く'}
                >
                  <ExternalLink size={14} /> {cam.url.includes('youtube') ? 'YouTube' : '公式カメラ'}
                </a>
              </div>

              {/* 画像エリアまたは未記録プレースホルダー */}
              <div
                style={{
                  position: 'relative',
                  width: '100%',
                  paddingTop: '56.25%', // 16:9 アスペクト比
                  backgroundColor: displayUrl ? '#000' : 'var(--bg-secondary)',
                  cursor: displayUrl ? 'pointer' : 'default',
                  overflow: 'hidden'
                }}
                onClick={() => {
                  if (displayUrl) {
                    setModalImage({ url: displayUrl, title: `${cam.name} - ${dateStr} ${selectedHour}時台` });
                  }
                }}
              >
                {displayUrl ? (
                  <>
                    <img
                      src={displayUrl}
                      alt={`${cam.name} ${selectedHour}時`}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        transition: 'transform 0.3s ease'
                      }}
                    />
                    <div style={{
                      position: 'absolute',
                      top: '0.5rem',
                      right: '0.5rem',
                      backgroundColor: 'rgba(0, 0, 0, 0.6)',
                      color: '#fff',
                      padding: '0.3rem',
                      borderRadius: '0.3rem',
                      display: 'flex'
                    }}>
                      <Maximize2 size={14} />
                    </div>
                  </>
                ) : (
                  <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--text-secondary)',
                    gap: '0.6rem',
                    padding: '1rem',
                    textAlign: 'center'
                  }}>
                    <VideoOff size={34} style={{ opacity: 0.4 }} />
                    <div style={{ fontWeight: 600, fontSize: '0.92rem' }}>この時間のカメラ画像はありません</div>
                    <div style={{ fontSize: '0.78rem', opacity: 0.75 }}>未撮影（またはアーカイブ対象外の時間）</div>
                  </div>
                )}
              </div>

              {/* カードフッター */}
              <div style={{
                padding: '0.6rem 1rem',
                fontSize: '0.8rem',
                color: 'var(--text-secondary)'
              }}>
                <span>対象日時: {dateStr} {selectedHour}時台</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* モーダルライトボックス (拡大表示) */}
      {modalImage && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            zIndex: 9999,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1.5rem'
          }}
          onClick={() => setModalImage(null)}
        >
          <div style={{
            maxWidth: '900px',
            width: '100%',
            backgroundColor: 'var(--bg-secondary)',
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
            boxShadow: 'var(--shadow-lg)',
            display: 'flex',
            flexDirection: 'column'
          }} onClick={e => e.stopPropagation()}>
            <div style={{
              padding: '1rem 1.25rem',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              borderBottom: '1px solid var(--border-color)',
              fontWeight: 700,
              fontSize: '1rem'
            }}>
              <span>{modalImage.title}</span>
              <button
                onClick={() => setModalImage(null)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-secondary)',
                  display: 'flex',
                  alignItems: 'center'
                }}
              >
                <X size={24} />
              </button>
            </div>
            <div style={{ width: '100%', backgroundColor: '#000', display: 'flex', justifyContent: 'center' }}>
              <img
                src={modalImage.url}
                alt={modalImage.title}
                style={{ maxWidth: '100%', maxHeight: '75vh', objectFit: 'contain' }}
              />
            </div>
            <div style={{ padding: '0.75rem 1.25rem', fontSize: '0.85rem', color: 'var(--text-secondary)', textAlign: 'right' }}>
              クリックまたは ESC 相当で閉じます
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
