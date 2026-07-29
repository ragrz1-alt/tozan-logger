import React from 'react';
import { X, ExternalLink, Thermometer, Wind, Droplets, Mountain } from 'lucide-react';
import type { HourlyWeatherData } from '../utils/weatherApi';
import { getCamImageUrl } from '../utils/camUrl';

interface HourlyCamModalProps {
  dateStr: string;
  hour: string;
  hourlyWeather?: HourlyWeatherData;
  historyRecords?: Record<string, string>; // { oshidomari: "...", kutsugata: "..." }
  onClose: () => void;
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
    name: '沓形（栄浜）',
    videoId: 'P9stiZVACSg',
    url: 'https://www.youtube.com/watch?v=P9stiZVACSg',
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
  },
  {
    id: 'oniwaki',
    name: '鬼脇（オタドマリ）',
    videoId: 'enBReBFAk7U',
    url: 'https://www.youtube.com/watch?v=enBReBFAk7U',
    color: '#8b5cf6',
    badge: '鬼脇'
  }
];

export const HourlyCamModal: React.FC<HourlyCamModalProps> = ({
  dateStr,
  hour,
  hourlyWeather,
  historyRecords,
  onClose
}) => {
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem'
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{
          maxWidth: '850px',
          width: '100%',
          backgroundColor: 'var(--bg-secondary)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-lg)',
          border: '2px solid var(--accent-primary)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '90vh'
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* モーダルヘッダー */}
        <div
          style={{
            padding: '1rem 1.25rem',
            backgroundColor: 'var(--bg-primary)',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <div
              style={{
                backgroundColor: 'var(--accent-primary)',
                color: '#fff',
                padding: '0.4rem',
                borderRadius: '0.4rem',
                display: 'flex'
              }}
            >
              <Mountain size={20} />
            </div>
            <div>
              <h4 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0 }}>
                {dateStr} 【 {hour}時台 】 利尻山 状況確認
              </h4>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0 }}>
                時間帯別通行ログ・気象要因テーブルからのカメラ照合
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              padding: '0.25rem',
              display: 'flex',
              alignItems: 'center'
            }}
            title="閉じる"
          >
            <X size={24} />
          </button>
        </div>

        {/* コンテンツエリア (スクロール可能) */}
        <div style={{ padding: '1.25rem', overflowY: 'auto' }}>
          {/* 天気サマリーバナー */}
          {hourlyWeather && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '1rem',
                padding: '0.75rem 1rem',
                backgroundColor: 'rgba(59, 130, 246, 0.08)',
                border: '1px solid rgba(59, 130, 246, 0.2)',
                borderRadius: 'var(--radius-md)',
                marginBottom: '1.25rem',
                fontSize: '0.9rem'
              }}
            >
              <span style={{ fontWeight: 700, color: 'var(--accent-primary)' }}>
                {hour}時台の天気データ:
              </span>
              <span>
                {hourlyWeather.weatherEmoji} <strong>{hourlyWeather.weatherText}</strong>
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <Thermometer size={16} /> 気温 <strong>{hourlyWeather.temp}℃</strong>
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <Wind size={16} /> 風速 <strong>{hourlyWeather.windSpeed}m/s</strong>
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <Droplets size={16} /> 降水量 <strong>{hourlyWeather.precipitation}mm</strong>
              </span>
            </div>
          )}

          {/* 画像グリッド */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: '1.25rem'
            }}
          >
            {CAMERAS.map(cam => {
              const imgPath = historyRecords?.[cam.id];

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
                  <div
                    style={{
                      padding: '0.6rem 0.8rem',
                      backgroundColor: 'var(--bg-secondary)',
                      borderBottom: '1px solid var(--border-color)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}
                  >
                    <div>
                      <span
                        style={{
                          backgroundColor: cam.color,
                          color: '#fff',
                          fontSize: '0.7rem',
                          fontWeight: 700,
                          padding: '0.2rem 0.5rem',
                          borderRadius: '0.25rem',
                          marginRight: '0.5rem'
                        }}
                      >
                        {cam.badge}
                      </span>
                      <strong style={{ fontSize: '0.9rem' }}>{cam.name}</strong>
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
                    >
                      <ExternalLink size={14} /> YouTube
                    </a>
                  </div>

                  <div
                    style={{
                      position: 'relative',
                      width: '100%',
                      paddingTop: '56.25%',
                      backgroundColor: imgPath ? '#000' : 'var(--bg-secondary)',
                      overflow: 'hidden'
                    }}
                  >
                    {imgPath ? (
                      <img
                        src={getCamImageUrl(imgPath)}
                        alt={`${cam.name} ${hour}時`}
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover'
                        }}
                      />
                    ) : (
                      <div
                        style={{
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
                        }}
                      >
                        <div style={{ fontWeight: 600, fontSize: '0.92rem' }}>この時間のカメラ画像はありません</div>
                        <div style={{ fontSize: '0.78rem', opacity: 0.75 }}>未撮影（またはアーカイブ対象外の時間）</div>
                      </div>
                    )}
                  </div>

                  <div
                    style={{
                      padding: '0.5rem 0.8rem',
                      fontSize: '0.8rem',
                      color: 'var(--text-secondary)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}
                  >
                    <span>{dateStr} {hour}時台</span>
                    <span
                      style={{
                        color: imgPath ? '#10b981' : 'var(--text-secondary)',
                        fontWeight: imgPath ? 600 : 400
                      }}
                    >
                      {imgPath ? '● アーカイブ記録済' : '○ 記録なし'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* モーダルフッター */}
        <div
          style={{
            padding: '0.75rem 1.25rem',
            backgroundColor: 'var(--bg-primary)',
            borderTop: '1px solid var(--border-color)',
            textAlign: 'right'
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: '0.5rem 1.25rem',
              backgroundColor: 'var(--text-secondary)',
              color: '#fff',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
};
