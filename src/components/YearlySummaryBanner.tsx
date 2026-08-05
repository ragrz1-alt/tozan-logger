import React from 'react';
import { Award, Users, TrendingUp, Calendar, Sun, AlertTriangle, Info } from 'lucide-react';
import { getWeatherCategory } from '../utils/weatherApi';

interface YearlySummaryBannerProps {
  year: string;
  entries: {
    date?: string;
    dateStr?: string;
    enter: number;
    exit: number;
  }[];
  weatherData: Record<string, any>;
  selectedCourse?: string;
}

export const YearlySummaryBanner: React.FC<YearlySummaryBannerProps> = ({
  year,
  entries,
  weatherData,
  selectedCourse = 'all'
}) => {
  // その年に該当するエントリーのみ抽出
  const yearEntries = entries.filter(e => {
    const d = e.date || e.dateStr || '';
    return d.startsWith(year);
  });
  if (yearEntries.length === 0) return null;

  const totalEnter = yearEntries.reduce((sum, e) => sum + (e.enter || 0), 0);
  const daysCount = yearEntries.length;
  const avgEnter = daysCount > 0 ? Math.round(totalEnter / daysCount) : 0;

  // ピーク日の算出
  let peakEntry = yearEntries[0];
  for (const e of yearEntries) {
    if (e.enter > (peakEntry?.enter || 0)) {
      peakEntry = e;
    }
  }

  // 天候傾向（晴れ・良好天候日数）の算出
  let sunnyDays = 0;
  yearEntries.forEach(e => {
    const d = e.date || e.dateStr || '';
    const w = weatherData[d];
    if (w && w.weatherCode !== undefined) {
      const cat = getWeatherCategory(w.weatherCode, w.precipitation, w.sunshineDuration, d);
      if (cat === 'Sunny') {
        sunnyDays++;
      }
    }
  });
  const sunnyRate = daysCount > 0 ? Math.round((sunnyDays / daysCount) * 100) : 0;

  // -------------------------------------------------------------------------
  // 欠測期間（シーズン: 6月〜9月）の自動検知アルゴリズム
  // ※現在進行中の年 (例: 今年以降) は未来のデータ空白にアラートを出さないよう除外
  // -------------------------------------------------------------------------
  const currentYear = new Date().getFullYear().toString();
  const isPastYear = parseInt(year, 10) < parseInt(currentYear, 10);

  const seasonMissingDates: string[] = [];
  const existingDateSet = new Set<string>();
  yearEntries.forEach(e => {
    const d = e.date || e.dateStr || '';
    if (d) existingDateSet.add(d);
  });

  if (isPastYear) {
    const startSeason = new Date(`${year}-06-01`);
    const endSeason = new Date(`${year}-09-30`);
    let curr = new Date(startSeason);
    while (curr <= endSeason) {
      const dateStr = curr.toISOString().substring(0, 10);
      if (!existingDateSet.has(dateStr)) {
        seasonMissingDates.push(dateStr);
      }
      curr.setDate(curr.getDate() + 1);
    }
  }

  // 連続する欠測ブロックの抽出と最も長い欠測期間のハイライト生成
  let missingPeriodText = '';
  if (seasonMissingDates.length >= 3) {
    const blocks: { start: string; end: string; count: number }[] = [];
    let bStart = seasonMissingDates[0];
    let bEnd = seasonMissingDates[0];
    let count = 1;

    for (let i = 1; i < seasonMissingDates.length; i++) {
      const prevDate = new Date(bEnd);
      prevDate.setDate(prevDate.getDate() + 1);
      const expectedNext = prevDate.toISOString().substring(0, 10);
      if (seasonMissingDates[i] === expectedNext) {
        bEnd = seasonMissingDates[i];
        count++;
      } else {
        blocks.push({ start: bStart, end: bEnd, count });
        bStart = seasonMissingDates[i];
        bEnd = seasonMissingDates[i];
        count = 1;
      }
    }
    blocks.push({ start: bStart, end: bEnd, count });

    blocks.sort((a, b) => b.count - a.count);
    const mainBlock = blocks[0];
    const fmtDate = (s: string) => {
      const p = s.split('-');
      return `${parseInt(p[1], 10)}/${parseInt(p[2], 10)}`;
    };

    if (mainBlock.start === mainBlock.end) {
      missingPeriodText = `${fmtDate(mainBlock.start)}`;
    } else {
      missingPeriodText = `${fmtDate(mainBlock.start)} 〜 ${fmtDate(mainBlock.end)}`;
    }
    if (blocks.length > 1) {
      missingPeriodText += ` など`;
    }
  }

  // 欠測あり判定: 過去年のシーズン(6/1〜9/30)に3日以上のデータ空白がある場合
  const hasSeasonMissingData = isPastYear && seasonMissingDates.length >= 3;

  // コース名のラベル表示
  const courseLabelMap: Record<string, string> = {
    all: '利尻山 全体合算',
    oshidomari: '鴛泊コース',
    kutsugata: '沓形コース',
    cameras: 'ライブカメラ',
    analytics: '利用分析'
  };
  const courseName = courseLabelMap[selectedCourse] || '利尻山 全体';

  const formatNumber = (num: number) => num.toLocaleString('ja-JP');

  const formatPeakDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      return `${parseInt(parts[1], 10)}/${parseInt(parts[2], 10)}`;
    }
    return dateStr;
  };

  return (
    <div
      className="yearly-summary-banner"
      style={{
        margin: '0 0 1.75rem 0',
        padding: '1.5rem 1.75rem',
        borderRadius: '16px',
        background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.12) 0%, rgba(59, 130, 246, 0.12) 100%)',
        border: '1px solid rgba(16, 185, 129, 0.35)',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.08)',
        backdropFilter: 'blur(10px)',
        position: 'relative',
        overflow: 'hidden',
        transition: 'all 0.3s ease'
      }}
    >
      {/* 背景装飾オーブ */}
      <div style={{
        position: 'absolute',
        top: '-40px',
        right: '-40px',
        width: '180px',
        height: '180px',
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(16, 185, 129, 0.18) 0%, transparent 70%)',
        pointerEvents: 'none'
      }} />

      {/* ヘッダーセクション */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '1rem',
        marginBottom: '1.35rem',
        borderBottom: '1px solid rgba(16, 185, 129, 0.22)',
        paddingBottom: '0.9rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{
            width: '46px',
            height: '46px',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, #10b981, #3b82f6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#ffffff',
            boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)'
          }}>
            <Award size={24} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <span style={{
                fontSize: '0.82rem',
                fontWeight: 800,
                padding: '0.2rem 0.65rem',
                borderRadius: '999px',
                backgroundColor: '#10b981',
                color: '#ffffff',
                letterSpacing: '0.04em'
              }}>
                YEARLY HIGHLIGHTS
              </span>
              <span style={{
                fontSize: '0.85rem',
                fontWeight: 700,
                color: 'var(--text-secondary)'
              }}>
                {courseName}
              </span>
            </div>
            <h2 style={{
              fontSize: '1.45rem',
              fontWeight: 900,
              color: 'var(--text-primary)',
              margin: '0.25rem 0 0 0',
              letterSpacing: '-0.02em',
              lineHeight: 1.2
            }}>
              {year}年 年間 入山者数 総合サマリー
            </h2>
          </div>
        </div>
        <div style={{
          fontSize: '0.85rem',
          color: 'var(--text-secondary)',
          fontWeight: 600,
          backgroundColor: 'var(--bg-primary)',
          padding: '0.4rem 0.85rem',
          borderRadius: '8px',
          border: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem'
        }}>
          <Calendar size={15} style={{ color: 'var(--accent-primary)' }} />
          <span>計測期間: {year}年 (全 {daysCount} 日間)</span>
        </div>
      </div>

      {/* 欠測期間の美しい警告アラートバナー (シーズン 6月〜9月 で空白検知時のみ表示) */}
      {hasSeasonMissingData && (
        <div style={{
          backgroundColor: 'rgba(245, 158, 11, 0.12)',
          border: '1px solid rgba(245, 158, 11, 0.45)',
          borderRadius: '12px',
          padding: '1rem 1.25rem',
          marginBottom: '1.25rem',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '0.85rem',
          color: 'var(--text-primary)'
        }}>
          <AlertTriangle size={22} style={{ color: '#f59e0b', flexShrink: 0, marginTop: '2px' }} />
          <div>
            <div style={{ fontSize: '0.92rem', fontWeight: 800, color: '#d97706', marginBottom: '0.25rem' }}>
              ⚠️ シーズン期間（6月〜9月）に一部データの欠測・空白期間があります
            </div>
            <div style={{ fontSize: '0.84rem', lineHeight: 1.5, color: 'var(--text-secondary)' }}>
              この年は <strong style={{ color: 'var(--text-primary)' }}>【欠測期間: {missingPeriodText} （シーズン計 {seasonMissingDates.length} 日間未計測）】</strong> が含まれています。
              記載の総入山者数は <strong style={{ color: '#d97706' }}>計測が稼働していた期間のみの合計数値（参考値）</strong> であり、実際の年間入山者は記載数値より多い点にご注意ください。
            </div>
          </div>
        </div>
      )}

      {/* KPI 4連タイルグリッド (リッチ＆プロフェッショナル配置) */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
        gap: '1rem',
        alignItems: 'stretch'
      }}>
        {/* タイル1: 年間総入山者数 (圧倒的メインKPI) */}
        <div style={{
          backgroundColor: 'var(--bg-primary)',
          borderRadius: '12px',
          padding: '1.1rem 1.25rem',
          border: '1px solid var(--border-color)',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
              年間 総入山者数
            </span>
            <Users size={18} style={{ color: '#10b981' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem', margin: '0.2rem 0' }}>
            <span style={{
              fontSize: '2.1rem',
              fontWeight: 900,
              background: 'linear-gradient(135deg, #10b981, #059669)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              lineHeight: 1.1
            }}>
              {formatNumber(totalEnter)}
            </span>
            <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>人</span>
          </div>
          <div style={{ fontSize: '0.78rem', marginTop: '0.35rem', fontWeight: 600 }}>
            {hasSeasonMissingData ? (
              <span style={{ color: '#d97706', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                <AlertTriangle size={13} />
                <span>一部欠測期間あり (計測日のみ合計)</span>
              </span>
            ) : (
              <span style={{ color: '#10b981', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                <Info size={13} />
                <span>シーズン主要計測データ収録</span>
              </span>
            )}
          </div>
        </div>

        {/* タイル2: 1日平均入山者数 */}
        <div style={{
          backgroundColor: 'var(--bg-primary)',
          borderRadius: '12px',
          padding: '1.1rem 1.25rem',
          border: '1px solid var(--border-color)',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
              1日平均 入山者数
            </span>
            <TrendingUp size={18} style={{ color: '#3b82f6' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem', margin: '0.2rem 0' }}>
            <span style={{
              fontSize: '1.9rem',
              fontWeight: 900,
              color: 'var(--text-primary)',
              lineHeight: 1.1
            }}>
              {formatNumber(avgEnter)}
            </span>
            <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-secondary)' }}>人 / 日</span>
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.35rem' }}>
            計測日における1日あたり平均人数
          </div>
        </div>

        {/* タイル3: シーズン最大ピーク日 */}
        <div style={{
          backgroundColor: 'var(--bg-primary)',
          borderRadius: '12px',
          padding: '1.1rem 1.25rem',
          border: '1px solid var(--border-color)',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
              シーズン最多 ピーク日
            </span>
            <Award size={18} style={{ color: '#f59e0b' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.45rem', margin: '0.2rem 0' }}>
            <span style={{
              fontSize: '1.75rem',
              fontWeight: 900,
              color: '#f59e0b',
              lineHeight: 1.1
            }}>
              {formatPeakDate(peakEntry?.date || peakEntry?.dateStr)}
            </span>
            <span style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary)' }}>
              ({formatNumber(peakEntry?.enter || 0)}人)
            </span>
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.35rem' }}>
            計測期間中で最も賑わったピークの1日
          </div>
        </div>

        {/* タイル4: 天候の傾向 (晴天日割合) */}
        <div style={{
          backgroundColor: 'var(--bg-primary)',
          borderRadius: '12px',
          padding: '1.1rem 1.25rem',
          border: '1px solid var(--border-color)',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
              晴れ・良好天候の割合
            </span>
            <Sun size={18} style={{ color: '#fbbf24' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem', margin: '0.2rem 0' }}>
            <span style={{
              fontSize: '1.9rem',
              fontWeight: 900,
              color: 'var(--text-primary)',
              lineHeight: 1.1
            }}>
              {sunnyRate}
            </span>
            <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-secondary)' }}>% ({sunnyDays}日 / {daysCount}日)</span>
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.35rem' }}>
            実況気象分析に基づく良好天候比率
          </div>
        </div>
      </div>
    </div>
  );
};
