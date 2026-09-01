import React, { useState } from 'react';
import { Award, Users, TrendingUp, Calendar, Sun, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import { getWeatherCategory } from '../utils/weatherApi';
import { MonthlyAIAnalysisModal } from './MonthlyAIAnalysisModal';

interface MonthlySummaryBannerProps {
  year: string;
  month: number;
  entries: {
    date?: string;
    dateStr?: string;
    enter: number;
    exit: number;
  }[];
  weatherData: Record<string, any>;
  selectedCourse?: string;
  onPrevMonth?: () => void;
  onNextMonth?: () => void;
  onPrevYear?: () => void;
  onNextYear?: () => void;
  prevYearEntries?: {
    date?: string;
    dateStr?: string;
    enter: number;
    exit: number;
  }[];
  isAdmin?: boolean;
}

export const MonthlySummaryBanner: React.FC<MonthlySummaryBannerProps> = ({
  year,
  month,
  entries,
  weatherData,
  selectedCourse = 'all',
  onPrevMonth,
  onNextMonth,
  onPrevYear,
  onNextYear,
  prevYearEntries = [],
  isAdmin = false
}) => {
  const [isAIModalOpen, setIsAIModalOpen] = useState(false);

  const mStr = month.toString().padStart(2, '0');
  const monthPrefix = `${year}-${mStr}`;
  
  // その月に該当するエントリーのみ抽出
  const monthEntries = entries.filter(e => {
    const d = e.date || e.dateStr || '';
    return d.startsWith(monthPrefix);
  });
  
  if (monthEntries.length === 0) return null;

  const totalEnter = monthEntries.reduce((sum, e) => sum + (e.enter || 0), 0);
  const daysCount = monthEntries.length;
  const avgEnter = daysCount > 0 ? Math.round(totalEnter / daysCount) : 0;

  // ピーク日の算出
  let peakEntry = monthEntries[0];
  for (const e of monthEntries) {
    if (e.enter > (peakEntry?.enter || 0)) {
      peakEntry = e;
    }
  }

  // 天候傾向（晴れ・良好天候日数）の算出
  let sunnyDays = 0;
  monthEntries.forEach(e => {
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

  // YoY (前年同期比) 計算
  const prevTotalEnter = prevYearEntries.reduce((sum, e) => sum + (e.enter || 0), 0);
  const diffEnter = totalEnter - prevTotalEnter;
  const diffPercent = prevTotalEnter > 0 ? ((diffEnter / prevTotalEnter) * 100).toFixed(1) : null;
  const isIncrease = diffEnter >= 0;

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

  const buttonStyle = {
    padding: '0.4rem 0.6rem',
    borderRadius: '6px',
    border: '1px solid var(--border-color)',
    backgroundColor: 'var(--bg-primary)',
    color: 'var(--text-primary)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '0.25rem',
    fontSize: '0.8rem',
    fontWeight: 600,
    transition: 'all 0.2s ease',
  };

  return (
    <div
      className="monthly-summary-banner"
      style={{
        margin: '0 0 1.75rem 0',
        padding: '1.5rem 1.75rem',
        borderRadius: '16px',
        background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(59, 130, 246, 0.03) 100%)',
        border: '1px solid rgba(59, 130, 246, 0.35)',
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
        background: 'radial-gradient(circle, rgba(59, 130, 246, 0.18) 0%, transparent 70%)',
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
        borderBottom: '1px solid rgba(59, 130, 246, 0.22)',
        paddingBottom: '0.9rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{
            width: '46px',
            height: '46px',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#ffffff',
            boxShadow: '0 4px 12px rgba(59, 130, 246, 0.3)'
          }}>
            <Calendar size={24} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <span style={{
                fontSize: '0.82rem',
                fontWeight: 800,
                padding: '0.2rem 0.65rem',
                borderRadius: '999px',
                backgroundColor: '#3b82f6',
                color: '#ffffff',
                letterSpacing: '0.04em'
              }}>
                MONTHLY HIGHLIGHTS
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
              {year}年 {month}月 入山者数 総合サマリー
            </h2>
          </div>
        </div>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: '0.5rem',
          position: 'relative',
          zIndex: 10
        }}>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {isAdmin && (
              <button
                style={{
                  ...buttonStyle,
                  backgroundColor: '#3b82f6',
                  color: 'white',
                  border: 'none',
                  boxShadow: '0 2px 8px rgba(59, 130, 246, 0.4)'
                }}
                onClick={() => setIsAIModalOpen(true)}
              >
                <Sparkles size={14} /> AI月次解析
              </button>
            )}
            {onPrevYear && (
              <button style={buttonStyle} onClick={onPrevYear}>
                <ChevronLeft size={14} /> 前の年
              </button>
            )}
            {onNextYear && (
              <button style={buttonStyle} onClick={onNextYear}>
                次の年 <ChevronRight size={14} />
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {onPrevMonth && (
              <button style={buttonStyle} onClick={onPrevMonth}>
                <ChevronLeft size={14} /> 前の月
              </button>
            )}
            {onNextMonth && (
              <button style={buttonStyle} onClick={onNextMonth}>
                次の月 <ChevronRight size={14} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* KPI 4連タイルグリッド */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
        gap: '1rem',
        alignItems: 'stretch'
      }}>
        {/* タイル1: 月間総入山者数 */}
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
              月間 総入山者数
            </span>
            <Users size={18} style={{ color: '#3b82f6' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem', margin: '0.2rem 0' }}>
            <span style={{
              fontSize: '2.1rem',
              fontWeight: 900,
              background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              lineHeight: 1.1
            }}>
              {formatNumber(totalEnter)}
            </span>
            <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>人</span>
          </div>
          <div style={{ fontSize: '0.8rem', marginTop: '0.45rem', fontWeight: 600, display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center' }}>
            {prevTotalEnter > 0 ? (
              <span style={{
                backgroundColor: isIncrease ? 'rgba(59, 130, 246, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                color: isIncrease ? '#2563eb' : '#dc2626',
                padding: '0.2rem 0.5rem',
                borderRadius: '6px',
                fontSize: '0.78rem'
              }}>
                前年同月比 {isIncrease ? '+' : '▲'}{Math.abs(diffEnter)}人 ({isIncrease ? '+' : ''}{diffPercent}%)
              </span>
            ) : (
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>前年同期データなし</span>
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
            <TrendingUp size={18} style={{ color: '#8b5cf6' }} />
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
        </div>

        {/* タイル3: 月間最大ピーク日 */}
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
              月間最多 ピーク日
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
        </div>

        {/* タイル4: 天候の傾向 */}
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
        </div>
      </div>
      
      <MonthlyAIAnalysisModal
        isOpen={isAIModalOpen}
        onClose={() => setIsAIModalOpen(false)}
        analysisData={{
          year,
          month,
          totalEnter,
          prevTotalEnter: prevYearEntries.length > 0 ? prevTotalEnter : null,
          diffEnter: prevYearEntries.length > 0 ? diffEnter : null,
          diffPercent,
          peakDate: peakEntry?.date || peakEntry?.dateStr,
          peakCount: peakEntry?.enter || 0
        }}
      />
    </div>
  );
};
