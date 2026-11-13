import React from 'react';
import { Compass } from 'lucide-react';
import type { DailyCameraSummary, SeasonMode } from '../hooks/useCameraAnalysis';

interface PhaseLabel {
  label: string;
  maxElev: number | null;
  hasClear: boolean;
}

interface CameraAiSummaryCardsProps {
  activeSeasonMode: SeasonMode;
  dailySummary: DailyCameraSummary;
  eastEstimate: { elevationM: number | null; note: string };
  timePhaseSummary: {
    earlyMorning: PhaseLabel;
    coreMidday: PhaseLabel;
    afternoonEvening: PhaseLabel;
  };
}

export const CameraAiSummaryCards: React.FC<CameraAiSummaryCardsProps> = ({
  activeSeasonMode,
  dailySummary,
  eastEstimate,
  timePhaseSummary,
}) => {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: '0.75rem',
        paddingTop: '0.5rem',
      }}
    >
      {activeSeasonMode === 'summer' ? (
        <>
          <div
            style={{
              padding: '0.75rem 0.95rem',
              backgroundColor: 'var(--bg-primary)',
              borderRadius: '10px',
              border: '1px solid var(--border-color)',
            }}
          >
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 700, marginBottom: '0.25rem' }}>
              🏔️ 1日の山頂視界 総合判定
            </div>
            <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-primary)' }}>
              {dailySummary.mountainCategory === 'clear'
                ? '🏔️ 山頂快晴日 (ピーク視認)'
                : dailySummary.mountainCategory === 'foggy'
                ? '🌫️ 終日ガス・山体不可視'
                : '☁️ 曇り・山頂雲隠れ (中腹視認)'}
            </div>
            <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
              平均雲量: <strong>{dailySummary.avgCloudCover ?? '-'} / 10</strong> ・ 山頂露出:{' '}
              <strong>{dailySummary.clearCount}</strong> / {dailySummary.validCount}枚
            </div>
          </div>

          <div
            style={{
              padding: '0.75rem 0.95rem',
              backgroundColor: 'var(--bg-primary)',
              borderRadius: '10px',
              border: '1px solid var(--border-color)',
            }}
          >
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 700, marginBottom: '0.25rem' }}>
              ⏰ 時間帯フェーズ別の視界推移
            </div>
            <div style={{ fontSize: '0.78rem', display: 'flex', flexDirection: 'column', gap: '0.18rem' }}>
              <div>
                <span style={{ color: 'var(--text-secondary)' }}>🌅 早朝(03-07時):</span>{' '}
                <strong>{timePhaseSummary.earlyMorning.label}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-secondary)' }}>⛰️ 登頂コア(09-13時):</span>{' '}
                <strong>{timePhaseSummary.coreMidday.label}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-secondary)' }}>🌇 午後・夕景(15-19時):</span>{' '}
                <strong>{timePhaseSummary.afternoonEvening.label}</strong>
              </div>
            </div>
          </div>

          <div
            style={{
              padding: '0.75rem 0.95rem',
              backgroundColor: 'var(--bg-primary)',
              borderRadius: '10px',
              border: '1px solid var(--border-color)',
            }}
          >
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 700, marginBottom: '0.25rem' }}>
              📏 本日の視界到達標高 ＆ 季節変化
            </div>
            <div style={{ fontSize: '1.02rem', fontWeight: 800, color: '#059669' }}>
              最高視界上限: 約 {dailySummary.maxVisibleElevationM ?? 0} m
            </div>
            <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
              {dailySummary.morningClearAfternoonFoggy
                ? '⚠️ 朝は山頂快晴 ➔ 昼からガス湧きパターン'
                : dailySummary.dominantSnowLine !== 'none'
                ? '❄️ 山体に冠雪・積雪を確認'
                : `☀️ 日差し確認率: ${Math.round(dailySummary.sunnyRatio * 100)}%`}
            </div>
          </div>
        </>
      ) : (
        <>
          <div
            style={{
              padding: '0.75rem 0.95rem',
              backgroundColor: 'var(--bg-primary)',
              borderRadius: '10px',
              border: '1px solid rgba(37, 99, 235, 0.35)',
            }}
          >
            <div style={{ fontSize: '0.75rem', color: '#2563eb', fontWeight: 700, marginBottom: '0.25rem' }}>
              🎿 BC滑走コアタイム(09-13時) 視界上限
            </div>
            <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-primary)' }}>
              {dailySummary.coreTimeElevationM === 1700
                ? '🏔️ 1,700m (山頂アルパインまで視界◯)'
                : dailySummary.coreTimeElevationM === 1000
                ? '🎿 1,000m (中腹オープンバーン視界◯)'
                : dailySummary.coreTimeElevationM === 500
                ? '🌲 500m (森林限界・ツリーラン帯のみ)'
                : '🚫 0m (ホワイトアウト・山体不可視)'}
            </div>
            <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
              1日最高視界高度: <strong>約{dailySummary.maxVisibleElevationM ?? 0}m</strong> / 平均雲量:{' '}
              <strong>{dailySummary.avgCloudCover ?? '-'}</strong>
            </div>
          </div>

          <div
            style={{
              padding: '0.75rem 0.95rem',
              backgroundColor: 'var(--bg-primary)',
              borderRadius: '10px',
              border: '1px solid rgba(139, 92, 246, 0.35)',
            }}
          >
            <div
              style={{
                fontSize: '0.75rem',
                color: '#7c3aed',
                fontWeight: 700,
                marginBottom: '0.25rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.3rem',
              }}
            >
              <Compass size={14} />
              <span>東面（アフトロマナイ沢方面）推定視界</span>
            </div>
            <div style={{ fontSize: '1.02rem', fontWeight: 800, color: 'var(--text-primary)' }}>
              {eastEstimate.elevationM !== null
                ? `約 ${eastEstimate.elevationM} m (${
                    eastEstimate.elevationM >= 1500
                      ? '上部アルパイン◯'
                      : eastEstimate.elevationM >= 800
                      ? '中腹バーン視界◯'
                      : eastEstimate.elevationM >= 300
                      ? '樹林帯のみ'
                      : '視界不良'
                  })`
                : 'データなし'}
            </div>
            <div style={{ fontSize: '0.73rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
              ※{eastEstimate.note}
            </div>
          </div>

          <div
            style={{
              padding: '0.75rem 0.95rem',
              backgroundColor: 'var(--bg-primary)',
              borderRadius: '10px',
              border: '1px solid var(--border-color)',
            }}
          >
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 700, marginBottom: '0.25rem' }}>
              ❄️ 積雪ライン ＆ 時間帯推移
            </div>
            <div style={{ fontSize: '0.92rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '0.2rem' }}>
              {dailySummary.dominantSnowLine === 'full_snow'
                ? '⛄ 山麓(0m)まで全面積雪'
                : dailySummary.dominantSnowLine === 'mid_slope'
                ? '❄️ 中腹(500〜1000m)まで積雪'
                : dailySummary.dominantSnowLine === 'summit_cap'
                ? '🏔️ 山頂部(1200m+)のみ冠雪'
                : '🌿 積雪なし（または雲隠れ）'}
            </div>
            <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
              朝出撃(07時): <strong>{timePhaseSummary.earlyMorning.maxElev ?? '-'}m</strong> ➔ 滑走(09-13時):{' '}
              <strong>{timePhaseSummary.coreMidday.maxElev ?? '-'}m</strong> ➔ 下山(15時):{' '}
              <strong>{timePhaseSummary.afternoonEvening.maxElev ?? '-'}m</strong>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
