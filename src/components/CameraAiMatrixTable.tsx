import React from 'react';
import { Compass } from 'lucide-react';
import { getEffectiveElevation, type ImageAnalysis } from '../hooks/useCameraAnalysis';
import type { CameraLocationDef } from '../utils/cameraAiClient';
import { getCamImageUrl } from '../utils/camUrl';
import type { InactiveCameraInfo } from '../utils/cameraStatus';
import { InactiveCamerasNotice } from './InactiveCamerasNotice';

interface CameraAiMatrixTableProps {
  selectedDate: string;
  activeTimes: string[];
  activeLocations: CameraLocationDef[];
  inactiveLocations: InactiveCameraInfo<CameraLocationDef>[];
  currentResults?: ImageAnalysis[];
  selectedHourFilter: string;
  onSelectHour: (hour: string) => void;
  onOpenModalImage: (img: { url: string; title: string; sub?: string }) => void;
}

const ELEVATION_STYLE_MAP = {
  alpine_clear: { bg: 'rgba(245, 158, 11, 0.16)', fg: '#d97706', icon: '☀️' },
  mid_mountain_ok: { bg: 'rgba(16, 185, 129, 0.15)', fg: '#059669', icon: '🎿' },
  treeline_only: { bg: 'rgba(59, 130, 246, 0.14)', fg: '#2563eb', icon: '🌲' },
  whiteout: { bg: 'rgba(148, 163, 184, 0.15)', fg: '#64748b', icon: '🌫️' },
} as const;

export const CameraAiMatrixTable: React.FC<CameraAiMatrixTableProps> = ({
  selectedDate,
  activeTimes,
  activeLocations,
  inactiveLocations,
  currentResults,
  selectedHourFilter,
  onSelectHour,
  onOpenModalImage,
}) => {
  return (
    <div
      style={{
        marginBottom: '1.5rem',
        padding: '1rem 1.15rem',
        backgroundColor: 'var(--bg-primary)',
        borderRadius: '12px',
        border: '1px solid var(--border-color)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.5rem',
          marginBottom: '0.75rem',
        }}
      >
        <div style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
          <span>📊 {selectedDate} 時間帯 × 斜面方角別 視界・雲底高度マトリクス</span>
          <span style={{ fontSize: '0.74rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
            （セルで写真拡大 ／ 時刻ヘッダーで下の画像欄を切替）
          </span>
        </div>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', fontSize: '0.73rem', fontWeight: 700 }}>
          <span style={{ color: '#d97706' }}>☀️ 1700m: 山頂快晴</span>
          <span style={{ color: '#059669' }}>🎿 1000m: 中腹バーン◯</span>
          <span style={{ color: '#2563eb' }}>🌲 500m: 森林帯のみ</span>
          <span style={{ color: '#64748b' }}>🌫️ 0m: ガス・不可視</span>
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', minWidth: '620px' }}>
          <thead>
            <tr style={{ backgroundColor: 'var(--bg-secondary)', borderBottom: '2px solid var(--border-color)' }}>
              <th style={{ textAlign: 'left', padding: '0.5rem 0.65rem', fontWeight: 800 }}>
                カメラ地点 / 斜面方角
              </th>
              {activeTimes.map(t => {
                const isSelected = selectedHourFilter === t;
                return (
                  <th key={t} style={{ textAlign: 'center', padding: '0.4rem 0.35rem', fontWeight: 800 }}>
                    <button
                      onClick={() => onSelectHour(t)}
                      style={{
                        border: isSelected ? '1px solid #3b82f6' : '1px solid transparent',
                        backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.14)' : 'transparent',
                        color: isSelected ? '#2563eb' : 'var(--text-primary)',
                        fontWeight: 800,
                        fontSize: '0.8rem',
                        borderRadius: '6px',
                        padding: '0.2rem 0.45rem',
                        cursor: 'pointer',
                      }}
                      title={`${t}:00の画像を下に表示`}
                    >
                      {t}:00
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {activeLocations.map(loc => (
              <tr key={loc.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                <td style={{ padding: '0.5rem 0.65rem', fontWeight: 700 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span
                      style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        backgroundColor: loc.color,
                        display: 'inline-block',
                      }}
                    />
                    <span>{loc.name}</span>
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 500, marginLeft: '1.1rem' }}>
                    {loc.bcSlopeName}
                  </div>
                </td>
                {activeTimes.map(t => {
                  const fileName = `${t}_${loc.id}.jpg`;
                  const rec = currentResults?.find(r => r.fileName === fileName);
                  if (!rec || rec.status === 'missing' || rec.visibility === 'missing') {
                    return (
                      <td
                        key={t}
                        style={{
                          textAlign: 'center',
                          padding: '0.45rem 0.35rem',
                          color: 'var(--text-secondary)',
                          fontSize: '0.72rem',
                        }}
                      >
                        -
                      </td>
                    );
                  }
                  if (rec.status === 'camera_error' || rec.visibility === 'camera_error') {
                    return (
                      <td
                        key={t}
                        style={{
                          textAlign: 'center',
                          padding: '0.45rem 0.35rem',
                          color: '#d97706',
                          fontSize: '0.74rem',
                          fontWeight: 700,
                        }}
                        title={rec.reason || 'カメラ映像障害・暗転のため統計から除外'}
                      >
                        🔧
                      </td>
                    );
                  }
                  const { elevationM, bcStatus } = getEffectiveElevation(rec);
                  const styleInfo = ELEVATION_STYLE_MAP[bcStatus] || ELEVATION_STYLE_MAP.whiteout;
                  return (
                    <td key={t} style={{ textAlign: 'center', padding: '0.35rem' }}>
                      <button
                        onClick={() => {
                          onSelectHour(t);
                          onOpenModalImage({
                            url: getCamImageUrl(`cams/${selectedDate}/${fileName}`),
                            title: `${loc.name} - ${selectedDate} ${t}:00`,
                            sub: rec.reason,
                          });
                        }}
                        style={{
                          width: '100%',
                          padding: '0.32rem 0.3rem',
                          borderRadius: '6px',
                          border: `1px solid ${styleInfo.fg}40`,
                          backgroundColor: styleInfo.bg,
                          color: styleInfo.fg,
                          fontWeight: 800,
                          fontSize: '0.74rem',
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          lineHeight: 1.2,
                        }}
                        title={rec.reason}
                      >
                        <span>
                          {styleInfo.icon} {elevationM}m
                        </span>
                        <span style={{ fontSize: '0.65rem', fontWeight: 600, opacity: 0.85 }}>
                          雲量{rec.cloud_cover}
                        </span>
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}

            {activeLocations.some(l => l.id === 'otadomari' || l.id === 'himenuma') && (
              <tr
                style={{
                  backgroundColor: 'rgba(139, 92, 246, 0.05)',
                  borderTop: '2px dashed rgba(139, 92, 246, 0.3)',
                }}
              >
                <td style={{ padding: '0.5rem 0.65rem', fontWeight: 700 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#7c3aed' }}>
                    <Compass size={13} />
                    <span>【東面推定】アフトロマナイ沢</span>
                  </div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', fontWeight: 500, marginLeft: '1.1rem' }}>
                    北東(オチュウシナイ沢)＋南東(ヤムナイ沢)から推定
                  </div>
                </td>
                {activeTimes.map(t => {
                  const otaRec = currentResults?.find(r => r.fileName === `${t}_otadomari.jpg`);
                  const himeRec = currentResults?.find(r => r.fileName === `${t}_himenuma.jpg`);
                  const ferryRec = currentResults?.find(r => r.fileName === `${t}_ferry.jpg`);

                  const otaElev =
                    otaRec && otaRec.status === 'ok' ? getEffectiveElevation(otaRec).elevationM : null;
                  const neRec =
                    himeRec && himeRec.status === 'ok'
                      ? himeRec
                      : ferryRec && ferryRec.status === 'ok'
                      ? ferryRec
                      : null;
                  const neElev = neRec ? getEffectiveElevation(neRec).elevationM : null;

                  const vals = [otaElev, neElev].filter((v): v is number => v !== null);
                  if (vals.length === 0) {
                    return (
                      <td key={t} style={{ textAlign: 'center', padding: '0.4rem', color: 'var(--text-secondary)', fontSize: '0.72rem' }}>
                        -
                      </td>
                    );
                  }
                  const avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
                  const snapped = avg >= 1450 ? 1700 : avg >= 750 ? 1000 : avg >= 250 ? 500 : 0;
                  return (
                    <td
                      key={t}
                      style={{
                        textAlign: 'center',
                        padding: '0.4rem',
                        fontWeight: 800,
                        fontSize: '0.74rem',
                        color: '#7c3aed',
                      }}
                    >
                      🧭 約{snapped}m
                    </td>
                  );
                })}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <InactiveCamerasNotice items={inactiveLocations} compact />
    </div>
  );
};
