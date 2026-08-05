import React, { useEffect, useState } from 'react';
import { fetchCurrentWeather, type CurrentWeather } from '../utils/weatherApi';
import { Thermometer, Wind, Activity, MapPin } from 'lucide-react';

const CAMERAS = [
  { name: '鴛泊', id: '8BwfUCuPcVE' },
  { name: '本泊', id: 'ag_nRE1jbXk' },
  { name: '礼文島方面', id: 'aqXQI-SRigk' },
  { name: '姫沼', id: '_CTve3fF0W4' },
  { name: 'オタドマリ沼', id: 'enBReBFAk7U' },
  { name: '仙法志御崎公園', id: '5BG3KJVFRVM' }
];

export const RishiriNowPanel: React.FC = () => {
  const [weather, setWeather] = useState<{ kutsugata: CurrentWeather | null, motodomari: CurrentWeather | null }>({ kutsugata: null, motodomari: null });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadWeather = async () => {
      setIsLoading(true);
      const data = await fetchCurrentWeather();
      setWeather(data);
      setIsLoading(false);
    };
    loadWeather();
  }, []);

  return (
    <div style={{
      animation: 'fadeIn 0.5s ease-out',
      marginTop: '1.5rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '2rem'
    }}>
      {/* リアルタイム気象データ (NOW) */}
      <div style={{
        background: 'rgba(255, 255, 255, 0.03)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '20px',
        padding: '1.5rem 2rem',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.15)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.8rem' }}>
          <Activity size={24} color="#3b82f6" />
          <h2 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.05em' }}>
            現在の気象状況 <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', fontWeight: 400 }}>(リアルタイム)</span>
          </h2>
        </div>
        
        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}>
            <div style={{ fontSize: '1rem', color: 'var(--text-secondary)' }}>取得中...</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem' }}>
            {/* 本泊 (鴛泊側) */}
            <WeatherCard title="本泊 (鴛泊方面)" data={weather.motodomari} />
            {/* 沓形 */}
            <WeatherCard title="沓形" data={weather.kutsugata} />
          </div>
        )}
      </div>

      {/* ライブカメラグリッド */}
      <div style={{
        background: 'rgba(255, 255, 255, 0.02)',
        borderRadius: '20px',
        padding: '1rem 0'
      }}>
        <h2 style={{ margin: '0 0 1.5rem 1rem', fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <MapPin size={22} color="#10b981" /> ライブカメラ (自動再生)
        </h2>
        
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: '1.5rem',
          padding: '0 0.5rem'
        }}>
          {CAMERAS.map((cam, idx) => (
            <div key={idx} style={{
              background: '#000',
              borderRadius: '16px',
              overflow: 'hidden',
              boxShadow: '0 10px 25px rgba(0,0,0,0.3)',
              position: 'relative',
              aspectRatio: '16 / 9'
            }}>
              <div style={{
                position: 'absolute',
                top: '10px',
                left: '10px',
                background: 'rgba(0,0,0,0.6)',
                backdropFilter: 'blur(4px)',
                color: '#fff',
                padding: '4px 12px',
                borderRadius: '20px',
                fontSize: '0.85rem',
                fontWeight: 700,
                zIndex: 10,
                pointerEvents: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem'
              }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#ef4444', animation: 'pulse 2s infinite' }}></div>
                {cam.name}
              </div>
              <iframe
                width="100%"
                height="100%"
                src={`https://www.youtube.com/embed/${cam.id}?autoplay=1&mute=1&playsinline=1&vq=small&loop=1&playlist=${cam.id}`}
                title={`${cam.name} Live Camera`}
                frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                referrerPolicy="strict-origin-when-cross-origin"
                allowFullScreen
                style={{ border: 'none', display: 'block' }}
              ></iframe>
            </div>
          ))}
        </div>
      </div>
      
      <style>{`
        @keyframes pulse {
          0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); }
          70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(239, 68, 68, 0); }
          100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
        }
      `}</style>
    </div>
  );
};

const WeatherCard: React.FC<{ title: string, data: CurrentWeather | null }> = ({ title, data }) => {
  if (!data) return null;
  return (
    <div style={{
      background: 'rgba(0, 0, 0, 0.2)',
      borderRadius: '16px',
      padding: '1.2rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '1rem',
      border: '1px solid rgba(255,255,255,0.05)'
    }}>
      <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-secondary)' }}>{title}</div>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '1.5rem' }}>
        
        {/* 気温 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <div style={{ padding: '8px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '12px', color: '#ef4444' }}>
            <Thermometer size={24} />
          </div>
          <div>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.1 }}>
              {data.temp.toFixed(1)}<span style={{ fontSize: '1rem', fontWeight: 600 }}>℃</span>
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>気温</div>
          </div>
        </div>
        
        {/* 風 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <div style={{ padding: '8px', background: 'rgba(16, 185, 129, 0.1)', borderRadius: '12px', color: '#10b981' }}>
            <Wind size={24} />
          </div>
          <div>
            <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.1 }}>
              {data.windDirectionText} {data.windSpeed.toFixed(1)}<span style={{ fontSize: '0.8rem', fontWeight: 600 }}>m/s</span>
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>風向・風速</div>
          </div>
        </div>
        
        {/* 天気 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginLeft: 'auto' }}>
          <div style={{ fontSize: '2rem' }}>{data.weatherEmoji}</div>
          <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>{data.weatherText}</div>
        </div>

      </div>
    </div>
  );
};
