import React, { useState, useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceArea,
  ReferenceLine,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import {
  TrendingUp,
  AlertTriangle,
  Ship,
  Moon,
  Clock,
  BarChart3,
  Mountain,
  Compass,
  Layers,
  CloudRain,
  Wind,
  Sun,
  Target,
  Sparkles,
} from 'lucide-react';
import { isEntryEnter, type LogEntry } from '../utils/logParser';
import { getWeatherDescription, type WeatherData } from '../utils/weatherApi';
import { evaluateDailyCameraVisibility, type ImageAnalysis } from '../hooks/useCameraAnalysis';
import { buildPeriodFactSheet, isDateMatchingPeriod } from '../utils/aiAnalytics';
import { MonthlyAIAnalysisModal } from './MonthlyAIAnalysisModal';

interface StakeholderAnalyticsProps {
  entries: LogEntry[];
  weatherData: Record<string, WeatherData>;
  cameraAnalysis?: Record<string, ImageAnalysis[]>;
  availableYears?: string[];
  onSelectDate?: (dateStr: string) => void;
  isAdmin?: boolean;
}

const getSunlightZone = (monthFilter: string) => {
  if (monthFilter === '6') {
    return {
      sunriseX: '03:00',
      sunsetX: '19:00',
      sunriseText: '03:50頃',
      sunsetText: '19:20頃',
      desc: '6月（夏至期）：最も行動可能時間が長いシーズン',
    };
  }
  if (monthFilter === '7') {
    return {
      sunriseX: '03:00',
      sunsetX: '19:00',
      sunriseText: '04:15頃',
      sunsetText: '19:10頃',
      desc: '7月（盛夏期）：4時台の早朝入山に最適な長日照帯',
    };
  }
  if (monthFilter === '8') {
    return {
      sunriseX: '03:00',
      sunsetX: '18:00',
      sunriseText: '04:45頃',
      sunsetText: '18:35頃',
      desc: '8月（夏後半）：日没が18時台半ばへ早まる移行月',
    };
  }
  if (monthFilter === '9') {
    return {
      sunriseX: '04:00',
      sunsetX: '17:00',
      sunriseText: '05:18頃',
      sunsetText: '17:35頃',
      desc: '9月（初秋期）：17時台で暗闇となるため早出・早期下山が必須',
    };
  }
  if (monthFilter === '10' || monthFilter === 'winter' || ['11', '12', '1', '2', '3'].includes(monthFilter)) {
    return {
      sunriseX: '06:00',
      sunsetX: '16:00',
      sunriseText: '06:15頃',
      sunsetText: '16:30頃',
      desc: '秋〜冬期（10〜3月）：短日照帯・気象×ライブカメラ観測期間',
    };
  }
  return {
    sunriseX: '03:00',
    sunsetX: '18:00',
    sunriseText: '04:25頃',
    sunsetText: '18:40頃',
    desc: 'シーズン平均（6〜9月）：標準日照帯（04:25頃 日出 / 18:40頃 日没）',
  };
};

type MainTabType = 'dynamics' | 'risk' | 'weather' | 'strategy';

export const StakeholderAnalytics: React.FC<StakeholderAnalyticsProps> = ({
  entries,
  weatherData,
  cameraAnalysis = {},
  availableYears = [],
  onSelectDate,
  isAdmin = false,
}) => {
  const defaultYear = availableYears.length > 0 ? availableYears[availableYears.length - 1] : '2026';

  const [activeTab, setActiveTab] = useState<MainTabType>('dynamics');
  const [targetCourse, setTargetCourse] = useState<'all' | 'oshidomari' | 'kutsugata'>('all');
  const [targetYear, setTargetYear] = useState<string>(defaultYear);
  // 'all' (6-9月), 'winter' (10-5月), 'year' (1-12月), または '1'〜'12'
  const [targetMonth, setTargetMonth] = useState<string>('all');
  const [isAIModalOpen, setIsAIModalOpen] = useState(false);

  const courseName =
    targetCourse === 'oshidomari'
      ? '鴛泊コース'
      : targetCourse === 'kutsugata'
      ? '沓形コース'
      : '利尻山 全体合算';

  // targetMonth を buildPeriodFactSheet 用の数値コードに変換
  // null: 6〜9月夏山通期, -1: 10〜5月秋冬春期, -2: 1〜12月年間通期, 1..12: 各月
  const activeMonthForSheet: number | null = useMemo(() => {
    if (targetMonth === 'all') return null;
    if (targetMonth === 'winter') return -1;
    if (targetMonth === 'year') return -2;
    return parseInt(targetMonth, 10);
  }, [targetMonth]);

  const activeYearForSheet = targetYear === 'all' ? defaultYear : targetYear;

  const periodDisplayBadge = useMemo(() => {
    if (targetMonth === 'all') return '夏山通期(6〜9月)';
    if (targetMonth === 'winter') return '秋冬春期(10〜5月)';
    if (targetMonth === 'year') return '年間通期(1〜12月)';
    return `${targetMonth}月`;
  }, [targetMonth]);

  // コース・年度・月でフィルタリングした生ログ
  const filteredEntries = useMemo(() => {
    return entries.filter(e => {
      if (targetCourse === 'oshidomari') {
        if ((e.course || 'oshidomari') !== 'oshidomari') return false;
      } else if (targetCourse === 'kutsugata') {
        if (e.course !== 'kutsugata') return false;
      }
      return isDateMatchingPeriod(e.dateStr, targetYear, activeMonthForSheet);
    });
  }, [entries, targetCourse, targetYear, activeMonthForSheet]);

  // 日別集計配列の生成（冬期や10月以降などカウンターログがない日も気象・カメラデータがあれば含める）
  const dailyList = useMemo(() => {
    const map: Record<string, { date: string; enter: number; exit: number; total: number }> = {};
    filteredEntries.forEach(e => {
      if (!map[e.dateStr]) {
        map[e.dateStr] = { date: e.dateStr, enter: 0, exit: 0, total: 0 };
      }
      if (isEntryEnter(e)) {
        map[e.dateStr].enter++;
      } else {
        map[e.dateStr].exit++;
      }
      map[e.dateStr].total++;
    });

    // 10月〜5月や年間通期が選ばれた場合、またはカメラ解析がある日は気象・カメラの日付も統合
    const todayJst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().split('T')[0];
    const extraDates = new Set<string>([...Object.keys(weatherData), ...Object.keys(cameraAnalysis)]);
    extraDates.forEach(dStr => {
      if (dStr > todayJst) return;
      if (!map[dStr] && isDateMatchingPeriod(dStr, targetYear, activeMonthForSheet)) {
        const hasCam = cameraAnalysis[dStr] && cameraAnalysis[dStr].some(c => c.status === 'ok');
        const m = parseInt(dStr.substring(5, 7), 10);
        if (hasCam || activeMonthForSheet !== null || m < 6 || m > 9) {
          map[dStr] = { date: dStr, enter: 0, exit: 0, total: 0 };
        }
      }
    });

    return Object.values(map).sort((a, b) => a.date.localeCompare(b.date));
  }, [filteredEntries, weatherData, cameraAnalysis, targetYear, activeMonthForSheet]);

  // 共通ファクトシートエンジン（4大ピラーの全指標を一括算出）
  const factSheet = useMemo(() => {
    return buildPeriodFactSheet({
      year: activeYearForSheet,
      month: activeMonthForSheet,
      courseName,
      selectedCourse: targetCourse,
      totalEnter: dailyList.reduce((s, d) => s + d.enter, 0),
      prevTotalEnter: null,
      diffEnter: null,
      diffPercent: null,
      peakDate: undefined,
      peakCount: 0,
      notes: '',
      dailyEntries: dailyList,
      rawEntries: filteredEntries,
      weatherData,
      cameraAnalysis,
    });
  }, [activeYearForSheet, activeMonthForSheet, courseName, targetCourse, dailyList, filteredEntries, weatherData, cameraAnalysis]);

  // 時間帯別データ & 深夜・ハザード集計
  const detailedStats = useMemo(() => {
    const hourlyEnter: Record<number, number> = {};
    const hourlyExit: Record<number, number> = {};
    for (let h = 0; h < 24; h++) {
      hourlyEnter[h] = 0;
      hourlyExit[h] = 0;
    }

    const midnightDayMap: Record<string, number> = {};
    let eveningEnterCount = 0; // 17〜20時

    filteredEntries.forEach(e => {
      const isEnter = isEntryEnter(e);
      if (isEnter) {
        hourlyEnter[e.hour] = (hourlyEnter[e.hour] || 0) + 1;
        if (e.hour >= 17 && e.hour < 21) eveningEnterCount++;
        if (e.hour >= 21 || e.hour === 0) {
          midnightDayMap[e.dateStr] = (midnightDayMap[e.dateStr] || 0) + 1;
        }
      } else {
        hourlyExit[e.hour] = (hourlyExit[e.hour] || 0) + 1;
      }
    });

    const hourlyChartData = Array.from({ length: 24 }, (_, h) => ({
      hourLabel: `${h.toString().padStart(2, '0')}:00`,
      enterCount: hourlyEnter[h],
      exitCount: hourlyExit[h],
    }));

    const topDays = [...dailyList]
      .filter(d => d.enter > 0 || d.exit > 0)
      .sort((a, b) => b.enter - a.enter)
      .slice(0, 10);

    const topMidnightDays = Object.entries(midnightDayMap)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    // ハザード日リスト（冬期の暴風・大雨も網羅）
    const hazardDays: Array<{
      date: string;
      enter: number;
      exit: number;
      rain: number;
      wind: number;
      level: 1 | 2;
      reason: string;
      mountainCat: string;
    }> = [];

    dailyList.forEach(d => {
      const w = weatherData[d.date];
      const rain = w?.precipitation || 0;
      const wind = w?.windSpeedMax || 0;
      if (rain >= 25.0 || wind >= 15.0) {
        const level: 1 | 2 = rain >= 50.0 || wind >= 20.0 ? 2 : 1;
        const reasons: string[] = [];
        if (rain >= 50) reasons.push('災害級大雨(50mm+)');
        else if (rain >= 25) reasons.push('大雨(25mm+)');
        if (wind >= 20) reasons.push('暴風(20m/s+)');
        else if (wind >= 15) reasons.push('強風(15m/s+)');
        const camEval = evaluateDailyCameraVisibility(cameraAnalysis[d.date]);
        hazardDays.push({
          date: d.date,
          enter: d.enter,
          exit: d.exit,
          rain,
          wind,
          level,
          reason: reasons.join(' / '),
          mountainCat: camEval.mountainCategory,
        });
      }
    });
    hazardDays.sort((a, b) => b.level - a.level || b.rain - a.rain || b.wind - a.wind);

    return {
      hourlyChartData,
      topDays,
      topMidnightDays,
      eveningEnterCount,
      hazardDays,
    };
  }, [filteredEntries, dailyList, weatherData, cameraAnalysis]);

  const sunZone = getSunlightZone(targetMonth);

  // 追加カメラ（姫沼・オタドマリ沼）のデータが存在するかチェック
  const hasExtendedCamStats = useMemo(
    () => factSheet.windDirectionCameraStats.some(w => w.himenumaSamples > 0 || w.otadomariSamples > 0),
    [factSheet.windDirectionCameraStats]
  );

  const badgeStyle = (bg: string, color: string) => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.25rem',
    padding: '0.2rem 0.55rem',
    borderRadius: '6px',
    fontSize: '0.76rem',
    fontWeight: 700,
    backgroundColor: bg,
    color,
  });

  return (
    <div
      className="card"
      style={{
        marginTop: '1rem',
        border: '1px solid var(--border-color)',
        backgroundColor: 'var(--bg-secondary)',
        overflow: 'hidden',
        borderRadius: '16px',
        padding: 0,
      }}
    >
      {/* ===== 1. コンパクト統合ヘッダー ＆ グローバル条件バー ===== */}
      <div
        style={{
          background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(16, 185, 129, 0.08))',
          padding: '1.25rem 1.5rem',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '10px',
              background: 'linear-gradient(135deg, #3b82f6, #10b981)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
            }}
          >
            <BarChart3 size={22} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <h2 style={{ fontSize: '1.3rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                利尻山 総合利用・気象視界解析ダッシュボード
              </h2>
              <span
                style={{
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  padding: '0.15rem 0.6rem',
                  borderRadius: '999px',
                  backgroundColor: 'var(--bg-primary)',
                  color: 'var(--accent-primary)',
                  border: '1px solid var(--border-color)',
                }}
              >
                {courseName} / {targetYear === 'all' ? '全年度累計' : `${targetYear}年`} / {periodDisplayBadge}
              </span>
            </div>
            <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              ①動態ピーク ②遅発・遅延下山リスク ③通年気象・6地点山頂視界クロス分析 ④誘客チャンス喪失日
            </p>
          </div>
        </div>

        {/* フィルター群（コース・年度・月/冬期通年・AI解析ボタン） */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.6rem' }}>
          {/* コース切替 */}
          <div
            style={{
              display: 'flex',
              backgroundColor: 'var(--bg-primary)',
              borderRadius: '8px',
              padding: '0.2rem',
              border: '1px solid var(--border-color)',
            }}
          >
            {[
              { id: 'all', label: '全体合算', icon: Layers, color: '#6366f1' },
              { id: 'oshidomari', label: '鴛泊', icon: Mountain, color: '#10b981' },
              { id: 'kutsugata', label: '沓形', icon: Compass, color: '#3b82f6' },
            ].map(c => {
              const Icon = c.icon;
              const active = targetCourse === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => setTargetCourse(c.id as any)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.3rem',
                    padding: '0.35rem 0.65rem',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    borderRadius: '6px',
                    border: 'none',
                    cursor: 'pointer',
                    backgroundColor: active ? c.color : 'transparent',
                    color: active ? '#fff' : 'var(--text-primary)',
                  }}
                >
                  <Icon size={13} />
                  <span>{c.label}</span>
                </button>
              );
            })}
          </div>

          {/* 年度選択 */}
          <select
            value={targetYear}
            onChange={e => setTargetYear(e.target.value)}
            style={{
              padding: '0.4rem 0.65rem',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
              backgroundColor: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              fontWeight: 700,
              fontSize: '0.82rem',
            }}
          >
            <option value="all">全年度 (累計)</option>
            {availableYears.map(y => (
              <option key={y} value={y}>
                {y}年
              </option>
            ))}
          </select>

          {/* 月・シーズンフィルター（夏山6-9月ボタン ＋ 10月・冬期・年間セレクト） */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              backgroundColor: 'var(--bg-primary)',
              borderRadius: '8px',
              padding: '0.2rem',
              border: '1px solid var(--border-color)',
              gap: '0.15rem',
            }}
          >
            {[
              { id: 'all', label: '夏山(6-9月)' },
              { id: '6', label: '6月' },
              { id: '7', label: '7月' },
              { id: '8', label: '8月' },
              { id: '9', label: '9月' },
              { id: '10', label: '10月' },
            ].map(m => {
              const active = targetMonth === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => {
                    setTargetMonth(m.id);
                    if (m.id === '10') setActiveTab('weather');
                  }}
                  style={{
                    padding: '0.35rem 0.55rem',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    borderRadius: '6px',
                    border: 'none',
                    cursor: 'pointer',
                    backgroundColor: active ? '#3b82f6' : 'transparent',
                    color: active ? '#fff' : 'var(--text-primary)',
                  }}
                >
                  {m.label}
                </button>
              );
            })}

            <select
              value={['winter', 'year', '11', '12', '1', '2', '3', '4', '5'].includes(targetMonth) ? targetMonth : ''}
              onChange={e => {
                if (e.target.value) {
                  setTargetMonth(e.target.value);
                  setActiveTab('weather');
                }
              }}
              style={{
                padding: '0.3rem 0.45rem',
                fontSize: '0.76rem',
                fontWeight: 700,
                borderRadius: '6px',
                border: ['winter', 'year', '11', '12', '1', '2', '3', '4', '5'].includes(targetMonth)
                  ? '1px solid #3b82f6'
                  : '1px solid transparent',
                backgroundColor: ['winter', 'year', '11', '12', '1', '2', '3', '4', '5'].includes(targetMonth)
                  ? 'rgba(59, 130, 246, 0.14)'
                  : 'var(--bg-secondary)',
                color: ['winter', 'year', '11', '12', '1', '2', '3', '4', '5'].includes(targetMonth)
                  ? '#2563eb'
                  : 'var(--text-secondary)',
                cursor: 'pointer',
              }}
              title="冬期・通年の気象×ライブカメラクロス分析期間を選択"
            >
              <option value="">❄️ 冬期・年間分析...</option>
              <option value="year">📅 年間通期 (1〜12月)</option>
              <option value="winter">⛄ 秋冬春期 (10〜5月)</option>
              <option value="11">11月 (初冬)</option>
              <option value="12">12月 (厳冬)</option>
              <option value="1">1月 (厳冬)</option>
              <option value="2">2月 (厳冬)</option>
              <option value="3">3月 (残雪春山)</option>
              <option value="4">4月 (残雪春山)</option>
              <option value="5">5月 (春山)</option>
            </select>
          </div>

          {isAdmin && (
            <button
              onClick={() => setIsAIModalOpen(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                padding: '0.45rem 0.85rem',
                borderRadius: '8px',
                border: 'none',
                background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                color: '#fff',
                fontWeight: 700,
                fontSize: '0.82rem',
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(59, 130, 246, 0.35)',
              }}
            >
              <Sparkles size={14} />
              <span>AI解析レポート</span>
            </button>
          )}
        </div>
      </div>

      {/* ===== 2. フラットで見やすい4大解析ピラータブ ===== */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
          gap: '0.5rem',
          padding: '0.75rem 1.25rem',
          backgroundColor: 'var(--bg-primary)',
          borderBottom: '1px solid var(--border-color)',
        }}
      >
        {[
          {
            id: 'dynamics' as const,
            label: '① 動態・ピーク分析 (事実)',
            sub: '集中日・時間帯・コース分担',
            icon: TrendingUp,
            color: '#3b82f6',
          },
          {
            id: 'risk' as const,
            label: '② 安全・リスク分析 (遅発・遅延)',
            sub: '10:30以降入山・17時以降下山・深夜',
            icon: AlertTriangle,
            color: '#ef4444',
          },
          {
            id: 'weather' as const,
            label: '③ 気象・雲量・ハザード分析',
            sub: '通年対応・全方位AI視界・風向非対称',
            icon: Sun,
            color: '#f59e0b',
          },
          {
            id: 'strategy' as const,
            label: '④ 誘客チャンス喪失日・次年度課題',
            sub: '好天×少人数日の原因・狙い目週',
            icon: Target,
            color: '#10b981',
          },
        ].map(tab => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                padding: '0.7rem 1rem',
                borderRadius: '10px',
                border: active ? `2px solid ${tab.color}` : '1px solid var(--border-color)',
                backgroundColor: active ? `${tab.color}15` : 'var(--bg-secondary)',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.15s ease',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                  fontWeight: 800,
                  fontSize: '0.9rem',
                  color: active ? tab.color : 'var(--text-primary)',
                }}
              >
                <Icon size={17} />
                <span>{tab.label}</span>
              </div>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>{tab.sub}</div>
            </button>
          );
        })}
      </div>

      {/* ===== 3. 各タブのメインコンテンツ ===== */}
      <div style={{ padding: '1.5rem' }}>
        {/* オフシーズン（カウンター撤去期）選択時の案内バナー */}
        {factSheet.totalEnter === 0 && factSheet.daysCount > 0 && activeTab !== 'weather' && (
          <div
            style={{
              padding: '0.9rem 1.25rem',
              marginBottom: '1.25rem',
              borderRadius: '10px',
              backgroundColor: 'rgba(59, 130, 246, 0.08)',
              border: '1px solid rgba(59, 130, 246, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '0.75rem',
              fontSize: '0.86rem',
            }}
          >
            <div>
              ❄️ <strong>現在は登山カウンター休止期間（{periodDisplayBadge}）が選択されています。</strong>
              アメダス気象データと6地点ライブカメラAI雲量・山頂視界のクロス分析は「③ 気象・雲量・ハザード分析」タブで確認できます。
            </div>
            <button
              onClick={() => setActiveTab('weather')}
              style={{
                padding: '0.4rem 0.9rem',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: '#3b82f6',
                color: '#fff',
                fontWeight: 700,
                fontSize: '0.82rem',
                cursor: 'pointer',
              }}
            >
              ③ 気象×カメラ視界分析を開く ➔
            </button>
          </div>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* タブ①：動態・ピーク分析（事実ベース） */}
        {/* ------------------------------------------------------------------ */}
        {activeTab === 'dynamics' && (
          <div>
            {/* 4連KPI */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '1rem',
                marginBottom: '1.5rem',
              }}
            >
              <div style={{ padding: '1rem', backgroundColor: 'var(--bg-primary)', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 700 }}>総入山者数 / 日平均</div>
                <div style={{ fontSize: '1.75rem', fontWeight: 900, color: '#3b82f6', marginTop: '0.25rem' }}>
                  {factSheet.totalEnter.toLocaleString()} <span style={{ fontSize: '0.9rem' }}>人</span>
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                  1日平均 <strong>{factSheet.avgEnter}人</strong> (対象 {factSheet.daysCount}日)
                </div>
              </div>

              <div style={{ padding: '1rem', backgroundColor: 'var(--bg-primary)', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 700 }}>休日・お盆 vs 平日平均</div>
                <div style={{ fontSize: '1.55rem', fontWeight: 900, color: 'var(--text-primary)', marginTop: '0.25rem' }}>
                  休日 {factSheet.holidayAvgEnter}人 <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>/ 平日 {factSheet.weekdayAvgEnter}人</span>
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                  上位5日間への集中率: <strong>{factSheet.top5ConcentrationRatio}%</strong>
                </div>
              </div>

              <div style={{ padding: '1rem', backgroundColor: 'var(--bg-primary)', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 700 }}>平均行動タイムライン</div>
                <div style={{ fontSize: '1.45rem', fontWeight: 900, color: '#10b981', marginTop: '0.25rem' }}>
                  {factSheet.avgDurationStr}
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                  平均入山 <strong>{factSheet.avgEnterTimeStr}</strong> → 平均下山 <strong>{factSheet.avgExitTimeStr}</strong>
                </div>
              </div>

              <div style={{ padding: '1rem', backgroundColor: 'var(--bg-primary)', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 700 }}>コース分担内訳</div>
                <div style={{ fontSize: '1.35rem', fontWeight: 900, color: 'var(--text-primary)', marginTop: '0.25rem' }}>
                  鴛泊 {factSheet.oshidomariEnter.toLocaleString()} <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>/ 沓形 {factSheet.kutsugataEnter.toLocaleString()}</span>
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                  鴛泊シェア:{' '}
                  <strong>
                    {factSheet.totalEnter > 0 ? Math.round((factSheet.oshidomariEnter / factSheet.totalEnter) * 100) : 0}%
                  </strong>
                </div>
              </div>
            </div>

            {/* 時間帯別分布グラフ（日出・日没ゾーン付き） */}
            <div
              style={{
                padding: '1.25rem',
                backgroundColor: 'var(--bg-primary)',
                borderRadius: '12px',
                border: '1px solid var(--border-color)',
                marginBottom: '1.5rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontWeight: 800, fontSize: '1rem' }}>
                  <Clock size={18} style={{ color: '#3b82f6' }} />
                  <span>00:00〜23:00 時間帯別 入山・下山分布 （日出・日没明暗ゾーン付き）</span>
                </div>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}>{sunZone.desc}</span>
              </div>

              <div style={{ height: '300px', width: '100%' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={detailedStats.hourlyChartData} margin={{ top: 24, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
                    <XAxis dataKey="hourLabel" stroke="var(--text-secondary)" tick={{ fontSize: 12, fontWeight: 600 }} />
                    <YAxis stroke="var(--text-secondary)" tick={{ fontSize: 12 }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'var(--bg-secondary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '8px',
                      }}
                    />
                    <Legend />
                    <ReferenceArea x1="00:00" x2={sunZone.sunriseX} fill="rgba(100, 116, 139, 0.12)" strokeOpacity={0} />
                    <ReferenceArea x1={sunZone.sunriseX} x2={sunZone.sunsetX} fill="rgba(250, 204, 21, 0.12)" strokeOpacity={0} />
                    <ReferenceArea x1={sunZone.sunsetX} x2="23:00" fill="rgba(239, 68, 68, 0.12)" strokeOpacity={0} />
                    <ReferenceLine
                      x={sunZone.sunriseX}
                      stroke="#d97706"
                      strokeDasharray="4 4"
                      label={{ value: `🌅日出(${sunZone.sunriseText})`, position: 'top', fill: '#d97706', fontSize: 11, fontWeight: 700 }}
                    />
                    <ReferenceLine
                      x={sunZone.sunsetX}
                      stroke="#ef4444"
                      strokeDasharray="4 4"
                      label={{ value: `🌙日没(${sunZone.sunsetText})`, position: 'top', fill: '#ef4444', fontSize: 11, fontWeight: 700 }}
                    />
                    <Bar dataKey="enterCount" fill="#3b82f6" radius={[4, 4, 0, 0]} name="入山者数 (IN)" />
                    <Bar dataKey="exitCount" fill="#10b981" radius={[4, 4, 0, 0]} name="下山者数 (OUT)" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* 利用集中日 TOP10 テーブル */}
            <div style={{ backgroundColor: 'var(--bg-primary)', borderRadius: '12px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
              <div style={{ padding: '0.9rem 1.25rem', borderBottom: '1px solid var(--border-color)', fontWeight: 800, fontSize: '0.98rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>🏔️ 利用集中日（混雑・踏圧ピーク）TOP 10</span>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 500 }}>行をクリックするとその日の24時間詳細が開きます</span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ backgroundColor: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                      <th style={{ padding: '0.65rem 1rem' }}>順位</th>
                      <th style={{ padding: '0.65rem 1rem' }}>日付</th>
                      <th style={{ padding: '0.65rem 1rem' }}>入山 (IN)</th>
                      <th style={{ padding: '0.65rem 1rem' }}>下山 (OUT)</th>
                      <th style={{ padding: '0.65rem 1rem' }}>麓の天候</th>
                      <th style={{ padding: '0.65rem 1rem' }}>山頂視界 (AI)</th>
                      <th style={{ padding: '0.65rem 1rem' }}>気温 / 降水 / 風速</th>
                      <th style={{ padding: '0.65rem 1rem' }}>詳細</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailedStats.topDays.map((d, idx) => {
                      const w = weatherData[d.date];
                      const wDesc = w ? getWeatherDescription(w.weatherCode, w.precipitation, w.sunshineDuration, d.date) : null;
                      const camEval = evaluateDailyCameraVisibility(cameraAnalysis[d.date]);
                      return (
                        <tr
                          key={d.date}
                          onClick={() => onSelectDate?.(d.date)}
                          style={{ borderBottom: '1px solid var(--border-color)', cursor: onSelectDate ? 'pointer' : 'default' }}
                        >
                          <td style={{ padding: '0.65rem 1rem', fontWeight: 800, color: idx < 3 ? '#f59e0b' : 'var(--text-secondary)' }}>
                            #{idx + 1}
                          </td>
                          <td style={{ padding: '0.65rem 1rem', fontWeight: 700 }}>
                            {format(parseISO(d.date), 'yyyy/MM/dd (E)', { locale: ja })}
                          </td>
                          <td style={{ padding: '0.65rem 1rem', fontWeight: 800, color: '#3b82f6' }}>{d.enter} 人</td>
                          <td style={{ padding: '0.65rem 1rem', fontWeight: 700, color: '#10b981' }}>{d.exit} 人</td>
                          <td style={{ padding: '0.65rem 1rem' }}>{wDesc ? `${wDesc.emoji} ${wDesc.text}` : '-'}</td>
                          <td style={{ padding: '0.65rem 1rem' }}>
                            {camEval.mountainCategory === 'clear' && <span style={badgeStyle('rgba(16,185,129,0.15)', '#059669')}>🏔️ 山頂快晴</span>}
                            {camEval.mountainCategory === 'cloudy' && <span style={badgeStyle('rgba(100,116,139,0.15)', '#64748b')}>☁️ 山頂雲隠れ</span>}
                            {camEval.mountainCategory === 'foggy' && <span style={badgeStyle('rgba(148,163,184,0.25)', '#475569')}>🌫️ 終日ガス</span>}
                            {camEval.mountainCategory === 'unknown' && <span style={{ color: 'var(--text-secondary)', fontSize: '0.78rem' }}>-</span>}
                          </td>
                          <td style={{ padding: '0.65rem 1rem', color: 'var(--text-secondary)' }}>
                            {w ? `${w.tempMax}℃ / ${w.precipitation}mm / ${w.windSpeedMax}m/s` : '-'}
                          </td>
                          <td style={{ padding: '0.65rem 1rem' }}>
                            <span style={badgeStyle('rgba(59,130,246,0.12)', '#2563eb')}>詳細 ➔</span>
                          </td>
                        </tr>
                      );
                    })}
                    {detailedStats.topDays.length === 0 && (
                      <tr>
                        <td colSpan={8} style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                          選択された期間に入山カウンター記録はありません（③ 気象・雲量・ハザード分析タブをご利用ください）。
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* タブ②：安全・リスク分析（遅発入山・遅延下山・夜間） */}
        {/* ------------------------------------------------------------------ */}
        {activeTab === 'risk' && (
          <div>
            {/* リスク 4連KPI */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '1rem',
                marginBottom: '1.5rem',
              }}
            >
              <div style={{ padding: '1rem', backgroundColor: 'rgba(59, 130, 246, 0.08)', borderRadius: '12px', border: '1px solid rgba(59, 130, 246, 0.3)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', color: '#2563eb', fontWeight: 800 }}>
                  <Ship size={15} /> 遅発入山 (10:30〜14:00)
                </div>
                <div style={{ fontSize: '1.8rem', fontWeight: 900, color: '#2563eb', marginTop: '0.25rem' }}>
                  {factSheet.lateEnterTotal} <span style={{ fontSize: '0.9rem' }}>人 ({factSheet.lateEnterRatio}%)</span>
                </div>
                <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                  フェリー午前便到着後や天候回復待ちの午後スタート層
                </div>
              </div>

              <div style={{ padding: '1rem', backgroundColor: 'rgba(239, 68, 68, 0.08)', borderRadius: '12px', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', color: '#ef4444', fontWeight: 800 }}>
                  <AlertTriangle size={15} /> 遅延下山 (17:00〜23:59)
                </div>
                <div style={{ fontSize: '1.8rem', fontWeight: 900, color: '#ef4444', marginTop: '0.25rem' }}>
                  {factSheet.lateExitTotal} <span style={{ fontSize: '0.9rem' }}>人 ({factSheet.lateExitRatio}%)</span>
                </div>
                <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                  薄暮・夕方以降にずれ込んだ下山者総数
                </div>
              </div>

              <div style={{ padding: '1rem', backgroundColor: 'rgba(220, 38, 38, 0.1)', borderRadius: '12px', border: '1px solid rgba(220, 38, 38, 0.4)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', color: '#b91c1c', fontWeight: 800 }}>
                  🌙 うち日没時刻以降の下山
                </div>
                <div style={{ fontSize: '1.8rem', fontWeight: 900, color: '#b91c1c', marginTop: '0.25rem' }}>
                  {factSheet.afterSunsetExitTotal} <span style={{ fontSize: '0.9rem' }}>人</span>
                </div>
                <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                  各時期の日没時刻を過ぎて暗闇下山となった高リスク数
                </div>
              </div>

              <div style={{ padding: '1rem', backgroundColor: 'rgba(245, 158, 11, 0.08)', borderRadius: '12px', border: '1px solid rgba(245, 158, 11, 0.3)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', color: '#d97706', fontWeight: 800 }}>
                  <Moon size={15} /> 深夜・未明入山 (21:00〜00:59)
                </div>
                <div style={{ fontSize: '1.8rem', fontWeight: 900, color: '#d97706', marginTop: '0.25rem' }}>
                  {factSheet.midnightEnterTotal} <span style={{ fontSize: '0.9rem' }}>人</span>
                </div>
                <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                  3〜4時の一般早出層を除いた夜間スタート層 (夕暮れ入山: {detailedStats.eveningEnterCount}人)
                </div>
              </div>
            </div>

            {/* 週別の遅発入山・遅延下山・日没後下山のトレンド比較グラフ */}
            <div
              style={{
                padding: '1.25rem',
                backgroundColor: 'var(--bg-primary)',
                borderRadius: '12px',
                border: '1px solid var(--border-color)',
                marginBottom: '1.5rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <span style={{ fontWeight: 800, fontSize: '0.98rem' }}>
                  📈 週別の「遅発入山 (10:30〜14:00)」と「遅延下山 (17:00以降 / 日没後)」推移
                </span>
                <span style={{ fontSize: '0.8rem', color: '#ef4444', fontWeight: 700 }}>
                  ※ 8月後半〜9月は日没が18時→17時台へ早まるため日没後下山リスクが急上昇します
                </span>
              </div>
              <div style={{ height: '260px', width: '100%' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={factSheet.weeklyStats} margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
                    <XAxis dataKey="weekLabel" stroke="var(--text-secondary)" tick={{ fontSize: 11, fontWeight: 600 }} interval={0} angle={-20} textAnchor="end" height={45} />
                    <YAxis stroke="var(--text-secondary)" unit="人" tick={{ fontSize: 12 }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'var(--bg-secondary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '8px',
                      }}
                    />
                    <Legend />
                    <Bar dataKey="lateEnterCount" fill="#3b82f6" name="遅発入山 (10:30〜14:00)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="lateExitCount" fill="#ef4444" name="遅延下山 (17:00以降)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="afterSunsetExitCount" fill="#7f1d1d" name="うち日没後暗闇下山" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* 遅延下山（17:00以降）多発日 ＆ 原因自動分類テーブル */}
            <div
              style={{
                backgroundColor: 'var(--bg-primary)',
                borderRadius: '12px',
                border: '1px solid var(--border-color)',
                overflow: 'hidden',
                marginBottom: '1.5rem',
              }}
            >
              <div style={{ padding: '0.9rem 1.25rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                <span style={{ fontWeight: 800, fontSize: '0.98rem', color: '#ef4444' }}>
                  🌙 「遅い時間の下山（17:00以降）」多発日 TOP 8 ＆ 遅延原因の自動診断
                </span>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  「入山自体が遅かった（🚢スタート遅れ型）」か「山中で時間がかかった（🥾山中停滞・バテ・悪天型）」かを自動判定
                </span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.86rem', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ backgroundColor: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                      <th style={{ padding: '0.65rem 0.9rem' }}>日付</th>
                      <th style={{ padding: '0.65rem 0.9rem' }}>17時以降下山 (遅延率)</th>
                      <th style={{ padding: '0.65rem 0.9rem' }}>日没後下山</th>
                      <th style={{ padding: '0.65rem 0.9rem' }}>当日遅発入山</th>
                      <th style={{ padding: '0.65rem 0.9rem' }}>平均入山 → 下山 (滞在)</th>
                      <th style={{ padding: '0.65rem 0.9rem' }}>天候・風速</th>
                      <th style={{ padding: '0.65rem 0.9rem' }}>遅延原因の自動分類</th>
                      <th style={{ padding: '0.65rem 0.9rem' }}>詳細</th>
                    </tr>
                  </thead>
                  <tbody>
                    {factSheet.topLateExitDays.map(d => (
                      <tr
                        key={d.date}
                        onClick={() => onSelectDate?.(d.date)}
                        style={{ borderBottom: '1px solid var(--border-color)', cursor: onSelectDate ? 'pointer' : 'default' }}
                      >
                        <td style={{ padding: '0.65rem 0.9rem', fontWeight: 700 }}>{d.displayDate}</td>
                        <td style={{ padding: '0.65rem 0.9rem', fontWeight: 800, color: '#ef4444' }}>
                          {d.lateExitCount}人 <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>({d.lateExitRatio}%)</span>
                        </td>
                        <td style={{ padding: '0.65rem 0.9rem', fontWeight: 700, color: d.afterSunsetExitCount > 0 ? '#b91c1c' : 'var(--text-secondary)' }}>
                          {d.afterSunsetExitCount}人
                        </td>
                        <td style={{ padding: '0.65rem 0.9rem', fontWeight: 700, color: '#2563eb' }}>{d.lateEnterCount}人</td>
                        <td style={{ padding: '0.65rem 0.9rem' }}>
                          {d.avgEnterTimeStr} → {d.avgExitTimeStr} <strong>({d.estDurationStr})</strong>
                        </td>
                        <td style={{ padding: '0.65rem 0.9rem', color: 'var(--text-secondary)' }}>
                          {d.weatherText} ({d.windSpeed}m/s)
                        </td>
                        <td style={{ padding: '0.65rem 0.9rem' }}>
                          <span
                            style={
                              d.causeType === '🚢 スタート遅れ型'
                                ? badgeStyle('rgba(59,130,246,0.14)', '#2563eb')
                                : d.causeType === '⚠️ 複合リスク型'
                                ? badgeStyle('rgba(239,68,68,0.16)', '#dc2626')
                                : badgeStyle('rgba(245,158,11,0.16)', '#d97706')
                            }
                            title={d.causeReason}
                          >
                            {d.causeType}
                          </span>
                        </td>
                        <td style={{ padding: '0.65rem 0.9rem' }}>
                          <span style={badgeStyle('rgba(59,130,246,0.12)', '#2563eb')}>詳細 ➔</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 2カラムコンパクトテーブル：遅発入山多発日 ＆ 深夜未明入山多発日 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1.25rem' }}>
              <div style={{ backgroundColor: 'var(--bg-primary)', borderRadius: '12px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
                <div style={{ padding: '0.8rem 1rem', borderBottom: '1px solid var(--border-color)', fontWeight: 800, fontSize: '0.92rem', color: '#2563eb' }}>
                  🚢 遅発入山（10:30〜14:00）が多い日 TOP 6
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ backgroundColor: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                      <th style={{ padding: '0.55rem 0.85rem' }}>日付</th>
                      <th style={{ padding: '0.55rem 0.85rem' }}>遅発入山数</th>
                      <th style={{ padding: '0.55rem 0.85rem' }}>当日総入山</th>
                      <th style={{ padding: '0.55rem 0.85rem' }}>天候</th>
                    </tr>
                  </thead>
                  <tbody>
                    {factSheet.topLateEnterDays.map(d => (
                      <tr
                        key={d.date}
                        onClick={() => onSelectDate?.(d.date)}
                        style={{ borderBottom: '1px solid var(--border-color)', cursor: onSelectDate ? 'pointer' : 'default' }}
                      >
                        <td style={{ padding: '0.55rem 0.85rem', fontWeight: 700 }}>{d.displayDate}</td>
                        <td style={{ padding: '0.55rem 0.85rem', fontWeight: 800, color: '#2563eb' }}>{d.count} 人</td>
                        <td style={{ padding: '0.55rem 0.85rem' }}>{d.totalEnter} 人</td>
                        <td style={{ padding: '0.55rem 0.85rem', color: 'var(--text-secondary)' }}>{d.weatherText}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ backgroundColor: 'var(--bg-primary)', borderRadius: '12px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
                <div style={{ padding: '0.8rem 1rem', borderBottom: '1px solid var(--border-color)', fontWeight: 800, fontSize: '0.92rem', color: '#d97706' }}>
                  🌌 深夜・未明入山（21:00〜00:59）が多い日 TOP 6
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ backgroundColor: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                      <th style={{ padding: '0.55rem 0.85rem' }}>日付</th>
                      <th style={{ padding: '0.55rem 0.85rem' }}>深夜未明入山</th>
                      <th style={{ padding: '0.55rem 0.85rem' }}>天候</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailedStats.topMidnightDays.slice(0, 6).map(d => {
                      const w = weatherData[d.date];
                      const wDesc = w ? getWeatherDescription(w.weatherCode, w.precipitation, w.sunshineDuration, d.date) : null;
                      return (
                        <tr
                          key={d.date}
                          onClick={() => onSelectDate?.(d.date)}
                          style={{ borderBottom: '1px solid var(--border-color)', cursor: onSelectDate ? 'pointer' : 'default' }}
                        >
                          <td style={{ padding: '0.55rem 0.85rem', fontWeight: 700 }}>
                            {format(parseISO(d.date), 'M/d(E)', { locale: ja })}
                          </td>
                          <td style={{ padding: '0.55rem 0.85rem', fontWeight: 800, color: '#d97706' }}>{d.count} 人</td>
                          <td style={{ padding: '0.55rem 0.85rem', color: 'var(--text-secondary)' }}>
                            {wDesc ? `${wDesc.emoji}${wDesc.text}` : '-'}
                          </td>
                        </tr>
                      );
                    })}
                    {detailedStats.topMidnightDays.length === 0 && (
                      <tr>
                        <td colSpan={3} style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                          該当データなし
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* タブ③：気象・雲量・ハザード分析（通年・冬期・6地点カメラ対応） */}
        {/* ------------------------------------------------------------------ */}
        {activeTab === 'weather' && (
          <div>
            {/* 4連KPI */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '1rem',
                marginBottom: '1.5rem',
              }}
            >
              <div style={{ padding: '1rem', backgroundColor: 'var(--bg-primary)', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 700 }}>☀️ 島の晴天日数 / 晴天率</div>
                <div style={{ fontSize: '1.75rem', fontWeight: 900, color: '#f59e0b', marginTop: '0.25rem' }}>
                  {factSheet.baseSunnyDays}日 <span style={{ fontSize: '0.95rem' }}>({factSheet.baseSunnyRate}%)</span>
                </div>
                <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                  アメダス実測×多方向カメラ統合判定 ({factSheet.daysCount}日中)
                </div>
              </div>

              <div style={{ padding: '1rem', backgroundColor: 'var(--bg-primary)', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 700 }}>🏔️ AIカメラ 山頂視界内訳</div>
                <div style={{ fontSize: '1.45rem', fontWeight: 900, color: '#10b981', marginTop: '0.25rem' }}>
                  山頂快晴 {factSheet.summitClearDays}日
                </div>
                <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                  山頂雲隠れ: {factSheet.summitCloudyDays}日 / 終日ガス: {factSheet.summitFoggyDays}日 (解析{factSheet.camAnalyzedDays}日)
                </div>
              </div>

              <div style={{ padding: '1rem', backgroundColor: 'var(--bg-primary)', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 700 }}>🌫️ 麓晴れ×山頂ガス / 午後急変</div>
                <div style={{ fontSize: '1.45rem', fontWeight: 900, color: '#64748b', marginTop: '0.25rem' }}>
                  ギャップ {factSheet.sunnyBaseButFoggySummitDays}日
                </div>
                <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                  朝快晴→午後ガス急変: <strong>{factSheet.morningClearAfternoonBadDays.length}日</strong>
                </div>
              </div>

              <div style={{ padding: '1rem', backgroundColor: 'rgba(239, 68, 68, 0.08)', borderRadius: '12px', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
                <div style={{ fontSize: '0.8rem', color: '#ef4444', fontWeight: 700 }}>⛈️ 大雨・強風ハザード日</div>
                <div style={{ fontSize: '1.75rem', fontWeight: 900, color: '#ef4444', marginTop: '0.25rem' }}>
                  {detailedStats.hazardDays.length}日 <span style={{ fontSize: '0.9rem' }}>(計 {factSheet.hazardDaysEnterTotal}人入山)</span>
                </div>
                <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                  降水25mm以上 または 最大風速15m/s以上の警戒日
                </div>
              </div>
            </div>

            {/* 【提案A】時間帯別「山頂視界ゴールデンタイム」曲線（7時間帯: 05, 07, 09, 11, 13, 15, 17時） */}
            <div
              style={{
                padding: '1.25rem',
                backgroundColor: 'var(--bg-primary)',
                borderRadius: '12px',
                border: '1px solid var(--border-color)',
                marginBottom: '1.5rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.85rem' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontWeight: 800, fontSize: '1rem', color: 'var(--text-primary)' }}>
                    <Sun size={18} style={{ color: '#f59e0b' }} />
                    <span>🌅 時間帯別「山頂視界ゴールデンタイム」曲線 （7時間帯AIカメラ実測）</span>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                    利尻山特有の「朝〜午前は山頂が抜けやすく、昼過ぎから湧き上がり雲（対流雲）や季節風でガスに包まれる」確率を定量化
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                  <span style={badgeStyle('rgba(16, 185, 129, 0.15)', '#059669')}>
                    🌅 午前(05〜09時) 山頂快晴率: {factSheet.morningSummitClearRate}%
                  </span>
                  <span style={badgeStyle('rgba(100, 116, 139, 0.16)', '#475569')}>
                    ☁️ 午後(13〜15時) 山頂快晴率: {factSheet.afternoonSummitClearRate}%
                  </span>
                </div>
              </div>

              {factSheet.camAnalyzedDays > 0 ? (
                <div style={{ height: '260px', width: '100%' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={factSheet.hourlyCameraGoldenTime} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
                      <XAxis dataKey="hourSlot" stroke="var(--text-secondary)" tick={{ fontSize: 12, fontWeight: 700 }} />
                      <YAxis stroke="var(--text-secondary)" unit="%" domain={[0, 100]} tick={{ fontSize: 12 }} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'var(--bg-secondary)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '8px',
                        }}
                        formatter={(val: any, name: any) => [`${val}%`, name]}
                      />
                      <Legend />
                      <Bar dataKey="summitClearRate" fill="#10b981" name="🏔️ 山頂快晴率 (1700m) (%)" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="midMountainOrAboveRate" fill="#3b82f6" name="🎿 中腹1000m+視界率 (%)" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="sunnyRate" fill="#f59e0b" name="☀️ 日差し・青空率 (%)" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="foggyRate" fill="#94a3b8" name="🌫️ ガス不可視率 (%)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div style={{ padding: '1.25rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.86rem' }}>
                  この期間のカメラAI解析データがまだありません。「山頂視界AI解析」タブで解析を実行すると、時間帯別の山頂視界ゴールデンタイム曲線が自動描画されます。
                </div>
              )}
            </div>

            {/* 【提案C】全方位カメラ（北:鴛泊・鴛泊港 / 北東:姫沼 / 西:沓形 / 南東:オタドマリ / 南:仙法志）視界比較 ＆ アメダス風向別・非対称マトリクス */}
            <div
              style={{
                backgroundColor: 'var(--bg-primary)',
                borderRadius: '12px',
                border: '1px solid var(--border-color)',
                overflow: 'hidden',
                marginBottom: '1.5rem',
              }}
            >
              <div style={{ padding: '0.9rem 1.25rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                <span style={{ fontWeight: 800, fontSize: '0.98rem', color: '#2563eb', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <Compass size={18} />
                  <span>🧭 全方位カメラ（最大6地点）視界比較 ＆ アメダス風向別・非対称マトリクス</span>
                </span>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  風向によって「風上側は海霧や雪雲がかかるが、風下側は山頂まで抜ける」独立峰特有の非対称性を実測比較
                </span>
              </div>

              {factSheet.camAnalyzedDays > 0 ? (
                <div style={{ padding: '1rem 1.25rem' }}>
                  {/* 地点別カメラ通期比較カード */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '0.85rem', marginBottom: '1rem' }}>
                    {factSheet.cameraDirectionTotals.map(cd => (
                      <div
                        key={cd.camId}
                        style={{
                          padding: '0.85rem 1rem',
                          borderRadius: '10px',
                          backgroundColor: 'var(--bg-secondary)',
                          border: '1px solid var(--border-color)',
                        }}
                      >
                        <div style={{ fontWeight: 800, fontSize: '0.88rem', color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
                          📷 {cd.camLabel} <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 500 }}>({cd.sampleCount}枚)</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '1.25rem', fontWeight: 900, color: '#10b981' }}>
                            🏔️山頂快晴 {cd.summitClearRate}%
                          </span>
                          <span style={{ fontSize: '0.82rem', color: '#2563eb', fontWeight: 800 }}>
                            🎿1000m+視界 {cd.midMountainOrAboveRate}%
                          </span>
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                          📏平均視界上限: <strong>約{cd.avgVisibleElevationM}m</strong> ｜ ☀️日差し {cd.sunnyRate}% ｜ 平均雲量 <strong>{cd.avgCloudCover}</strong>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* 風向別×方角別カメラ非対称テーブル */}
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
                      <thead>
                        <tr style={{ backgroundColor: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                          <th style={{ padding: '0.6rem 0.9rem' }}>主風向グループ (アメダス実測)</th>
                          <th style={{ padding: '0.6rem 0.9rem' }}>該当日数</th>
                          <th style={{ padding: '0.6rem 0.9rem' }}>北：鴛泊・港 (快晴率 / 雲量)</th>
                          {hasExtendedCamStats && <th style={{ padding: '0.6rem 0.9rem' }}>北東：姫沼 (快晴率 / 雲量)</th>}
                          <th style={{ padding: '0.6rem 0.9rem' }}>西：沓形 (快晴率 / 雲量)</th>
                          {hasExtendedCamStats && <th style={{ padding: '0.6rem 0.9rem' }}>南東：オタドマリ (快晴率 / 雲量)</th>}
                          <th style={{ padding: '0.6rem 0.9rem' }}>南：仙法志 (快晴率 / 雲量)</th>
                          <th style={{ padding: '0.6rem 0.9rem' }}>風向別の最も視界が良い方角</th>
                        </tr>
                      </thead>
                      <tbody>
                        {factSheet.windDirectionCameraStats.map(wg => (
                          <tr key={wg.windGroupKey} style={{ borderBottom: '1px solid var(--border-color)' }}>
                            <td style={{ padding: '0.6rem 0.9rem', fontWeight: 800 }}>{wg.windGroupLabel}</td>
                            <td style={{ padding: '0.6rem 0.9rem', fontWeight: 700 }}>{wg.daysCount} 日</td>
                            <td style={{ padding: '0.6rem 0.9rem' }}>
                              {wg.daysCount > 0 ? (
                                <span>
                                  <strong style={{ color: '#10b981' }}>{wg.oshidomariClearRate}%</strong>{' '}
                                  <span style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>(雲量 {wg.oshidomariAvgCloud})</span>
                                </span>
                              ) : (
                                '-'
                              )}
                            </td>
                            {hasExtendedCamStats && (
                              <td style={{ padding: '0.6rem 0.9rem' }}>
                                {wg.himenumaSamples > 0 ? (
                                  <span>
                                    <strong style={{ color: '#059669' }}>{wg.himenumaClearRate}%</strong>{' '}
                                    <span style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>(雲量 {wg.himenumaAvgCloud})</span>
                                  </span>
                                ) : (
                                  '-'
                                )}
                              </td>
                            )}
                            <td style={{ padding: '0.6rem 0.9rem' }}>
                              {wg.daysCount > 0 ? (
                                <span>
                                  <strong style={{ color: '#3b82f6' }}>{wg.kutsugataClearRate}%</strong>{' '}
                                  <span style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>(雲量 {wg.kutsugataAvgCloud})</span>
                                </span>
                              ) : (
                                '-'
                              )}
                            </td>
                            {hasExtendedCamStats && (
                              <td style={{ padding: '0.6rem 0.9rem' }}>
                                {wg.otadomariSamples > 0 ? (
                                  <span>
                                    <strong style={{ color: '#8b5cf6' }}>{wg.otadomariClearRate}%</strong>{' '}
                                    <span style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>(雲量 {wg.otadomariAvgCloud})</span>
                                  </span>
                                ) : (
                                  '-'
                                )}
                              </td>
                            )}
                            <td style={{ padding: '0.6rem 0.9rem' }}>
                              {wg.daysCount > 0 ? (
                                <span>
                                  <strong style={{ color: '#f59e0b' }}>{wg.senposhiClearRate}%</strong>{' '}
                                  <span style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>(雲量 {wg.senposhiAvgCloud})</span>
                                </span>
                              ) : (
                                '-'
                              )}
                            </td>
                            <td style={{ padding: '0.6rem 0.9rem' }}>
                              {wg.daysCount > 0 ? (
                                <span style={badgeStyle('rgba(16, 185, 129, 0.14)', '#059669')}>{wg.bestDirectionLabel}</span>
                              ) : (
                                <span style={{ color: 'var(--text-secondary)', fontSize: '0.78rem' }}>該当データなし</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div style={{ padding: '1.25rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.86rem' }}>
                  カメラAI解析データが蓄積されると、風向別のカメラ視界非対称マトリクスが表示されます。
                </div>
              )}
            </div>

            {/* 大雨・強風ハザード発生日の実績テーブル */}
            <div style={{ backgroundColor: 'var(--bg-primary)', borderRadius: '12px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
              <div style={{ padding: '0.9rem 1.25rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                <span style={{ fontWeight: 800, fontSize: '0.98rem', color: '#ef4444', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <CloudRain size={18} />
                  <span>自然要因ハザード発生日（大雨・強風）の気象・視界・入山実績一覧</span>
                </span>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  🔴 レベル2: 雨50mm+ または 風20m/s+ / 🟠 レベル1: 雨25mm+ または 風15m/s+
                </span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.86rem', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ backgroundColor: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                      <th style={{ padding: '0.65rem 1rem' }}>日付</th>
                      <th style={{ padding: '0.65rem 1rem' }}>警戒レベル</th>
                      <th style={{ padding: '0.65rem 1rem' }}>ハザード要因</th>
                      <th style={{ padding: '0.65rem 1rem' }}>降水量</th>
                      <th style={{ padding: '0.65rem 1rem' }}>最大風速</th>
                      <th style={{ padding: '0.65rem 1rem' }}>山頂視界(AI)</th>
                      <th style={{ padding: '0.65rem 1rem' }}>当日入山者数</th>
                      <th style={{ padding: '0.65rem 1rem' }}>詳細</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailedStats.hazardDays.map(h => (
                      <tr
                        key={h.date}
                        onClick={() => onSelectDate?.(h.date)}
                        style={{
                          borderBottom: '1px solid var(--border-color)',
                          backgroundColor: h.level === 2 ? 'rgba(239,68,68,0.06)' : 'transparent',
                          cursor: onSelectDate ? 'pointer' : 'default',
                        }}
                      >
                        <td style={{ padding: '0.65rem 1rem', fontWeight: 700 }}>
                          {format(parseISO(h.date), 'yyyy/MM/dd (E)', { locale: ja })}
                        </td>
                        <td style={{ padding: '0.65rem 1rem' }}>
                          {h.level === 2 ? (
                            <span style={badgeStyle('rgba(239,68,68,0.16)', '#dc2626')}>🔴 レベル2 (災害級)</span>
                          ) : (
                            <span style={badgeStyle('rgba(249,115,22,0.16)', '#ea580c')}>🟠 レベル1 (警戒級)</span>
                          )}
                        </td>
                        <td style={{ padding: '0.65rem 1rem', fontWeight: 700 }}>{h.reason}</td>
                        <td style={{ padding: '0.65rem 1rem', color: '#3b82f6', fontWeight: 700 }}>{h.rain} mm</td>
                        <td style={{ padding: '0.65rem 1rem', color: '#8b5cf6', fontWeight: 700 }}>
                          <Wind size={13} style={{ display: 'inline', marginRight: '2px' }} />
                          {h.wind} m/s
                        </td>
                        <td style={{ padding: '0.65rem 1rem' }}>
                          {h.mountainCat === 'foggy'
                            ? '🌫️ ガス不可視'
                            : h.mountainCat === 'cloudy'
                            ? '☁️ 山頂雲隠れ'
                            : h.mountainCat === 'clear'
                            ? '🏔️ 快晴'
                            : '-'}
                        </td>
                        <td style={{ padding: '0.65rem 1rem', fontWeight: 800, color: h.enter >= 20 ? '#ef4444' : 'var(--text-primary)' }}>
                          {h.enter} 人
                        </td>
                        <td style={{ padding: '0.65rem 1rem' }}>
                          <span style={badgeStyle('rgba(59,130,246,0.12)', '#2563eb')}>詳細 ➔</span>
                        </td>
                      </tr>
                    ))}
                    {detailedStats.hazardDays.length === 0 && (
                      <tr>
                        <td colSpan={8} style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                          選択された期間に該当する大雨・強風ハザード日はありません。
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* タブ④：誘客チャンス喪失日 ＆ 次年度課題（戦略ベース） */}
        {/* ------------------------------------------------------------------ */}
        {activeTab === 'strategy' && (
          <div>
            {/* シーズン特性・誘客基準ポリシーバナー */}
            <div
              style={{
                padding: '0.9rem 1.15rem',
                marginBottom: '1.25rem',
                borderRadius: '10px',
                backgroundColor: 'rgba(16, 185, 129, 0.07)',
                border: '1px solid rgba(16, 185, 129, 0.28)',
                fontSize: '0.82rem',
                lineHeight: 1.55,
                color: 'var(--text-primary)',
              }}
            >
              <div style={{ fontWeight: 800, color: '#059669', marginBottom: '0.25rem' }}>
                📌 誘客チャンス判定基準（6月下旬〜9月コアシーズン集中 × 9月秋山条件付き誘客）
              </div>
              <div>
                ・<strong>🌱 6月上旬〜中旬（6/1〜6/19）および10〜5月（オフシーズン）</strong>：残雪・冬期等で一般登山誘客には向かないため、誘客ターゲット・機会損失日から<strong>自動除外</strong>しています。
                <br />
                ・<strong>🏔️ 6月下旬（6/20）〜8月</strong>：夏山コアシーズン。AIカメラで日中（07〜13時）に山頂快晴が確認された少人数日を <strong>「👑 特A級チャンス喪失日（山頂絶景×穴場）」</strong> として最優先抽出します。
                <br />
                ・<strong>🍁 9月（シルバーウィーク含む）</strong>：近年の温暖化・初雪の遅れにより有力な登山シーズン対象ですが、<strong>日没が17時台前半と非常に早い</strong>ため、安易な誘客ではなく<strong>「前泊＋早朝5時前入山・15時下山」をセットにした安全条件付き誘客</strong>として区分しています。
              </div>
            </div>

            {/* 4連KPI */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '1rem',
                marginBottom: '1.5rem',
              }}
            >
              <div style={{ padding: '1rem', backgroundColor: 'rgba(16, 185, 129, 0.08)', borderRadius: '12px', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                <div style={{ fontSize: '0.8rem', color: '#059669', fontWeight: 800 }}>✨ 登山日和（好天）日数</div>
                <div style={{ fontSize: '1.8rem', fontWeight: 900, color: '#059669', marginTop: '0.25rem' }}>
                  {factSheet.goodWeatherDaysCount} <span style={{ fontSize: '0.95rem' }}>日</span>
                </div>
                <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                  晴れ・降水2mm以下・風12.5m/s以下・山頂ガスなし
                </div>
              </div>

              <div style={{ padding: '1rem', backgroundColor: 'rgba(59, 130, 246, 0.08)', borderRadius: '12px', border: '1px solid rgba(59, 130, 246, 0.3)' }}>
                <div style={{ fontSize: '0.8rem', color: '#2563eb', fontWeight: 800 }}>📉 コア期チャンス喪失日 (6/20〜9/30)</div>
                <div style={{ fontSize: '1.8rem', fontWeight: 900, color: '#2563eb', marginTop: '0.25rem' }}>
                  {factSheet.opportunityLossDays.length} <span style={{ fontSize: '0.95rem' }}>日</span>
                </div>
                <div style={{ fontSize: '0.76rem', color: '#059669', fontWeight: 700, marginTop: '0.2rem' }}>
                  👑 うち山頂快晴の特A級絶景穴場日: {factSheet.superPrimeOpportunityCount}日
                </div>
              </div>

              <div style={{ padding: '1rem', backgroundColor: 'rgba(245, 158, 11, 0.08)', borderRadius: '12px', border: '1px solid rgba(245, 158, 11, 0.3)' }}>
                <div style={{ fontSize: '0.8rem', color: '#d97706', fontWeight: 800 }}>🍁 9月条件付誘客 / 🚢 前日荒天ラグ</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 900, color: '#d97706', marginTop: '0.25rem' }}>
                  秋山 {factSheet.opportunityLossDays.filter(o => o.causeBadge.includes('秋山')).length}日{' '}
                  <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                    / 荒天ラグ {factSheet.opportunityLossDays.filter(o => o.causeBadge === '🚢 前日荒天・交通影響疑い').length}日
                  </span>
                </div>
                <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                  9月早出条件付き穴場日と前日欠航警戒ラグ日の内訳
                </div>
              </div>

              <div style={{ padding: '1rem', backgroundColor: 'rgba(139, 92, 246, 0.08)', borderRadius: '12px', border: '1px solid rgba(139, 92, 246, 0.3)' }}>
                <div style={{ fontSize: '0.8rem', color: '#7c3aed', fontWeight: 800 }}>🎯 来年度の最重点誘客ターゲット週</div>
                <div style={{ fontSize: '1.6rem', fontWeight: 900, color: '#7c3aed', marginTop: '0.25rem' }}>
                  {factSheet.bestPromoWeek || '該当なし'}
                </div>
                <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                  6月下旬〜9月のコア期で好天が多いのに空いている狙い目週
                </div>
              </div>
            </div>

            {/* 週別の「天候勝率 × 集客効率」マトリクステーブル */}
            <div
              style={{
                backgroundColor: 'var(--bg-primary)',
                borderRadius: '12px',
                border: '1px solid var(--border-color)',
                overflow: 'hidden',
                marginBottom: '1.5rem',
              }}
            >
              <div style={{ padding: '0.9rem 1.25rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                <span style={{ fontWeight: 800, fontSize: '0.98rem', color: '#059669' }}>
                  📅 週別の「好天・視界率（天候勝率）× 集客効率」比較テーブル
                </span>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  6月上旬〜中旬（残雪期）および10〜5月を除外し、6月下旬〜9月のコアシーズンから重点誘客週を判定しています
                </span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.86rem', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ backgroundColor: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                      <th style={{ padding: '0.6rem 1rem' }}>週</th>
                      <th style={{ padding: '0.6rem 1rem' }}>好天日数 (勝率)</th>
                      <th style={{ padding: '0.6rem 1rem' }}>山頂快晴日数 (AI)</th>
                      <th style={{ padding: '0.6rem 1rem' }}>週合計入山者</th>
                      <th style={{ padding: '0.6rem 1rem' }}>全日程平均</th>
                      <th style={{ padding: '0.6rem 1rem' }}>好天1日あたり平均</th>
                      <th style={{ padding: '0.6rem 1rem' }}>日没目安</th>
                      <th style={{ padding: '0.6rem 1rem' }}>次年度に向けた位置づけ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {factSheet.weeklyStats.map(w => (
                      <tr
                        key={w.weekLabel}
                        style={{
                          borderBottom: '1px solid var(--border-color)',
                          backgroundColor: w.isTargetPromoWeek
                            ? 'rgba(16, 185, 129, 0.08)'
                            : w.isEarlyPreSeasonWeek
                            ? 'rgba(148, 163, 184, 0.06)'
                            : 'transparent',
                          opacity: w.isEarlyPreSeasonWeek ? 0.78 : 1,
                        }}
                      >
                        <td style={{ padding: '0.6rem 1rem', fontWeight: 800 }}>{w.weekLabel}</td>
                        <td style={{ padding: '0.6rem 1rem', fontWeight: 700, color: w.goodWeatherRate >= 50 ? '#059669' : 'var(--text-primary)' }}>
                          {w.goodWeatherDays} / {w.daysCount}日 ({w.goodWeatherRate}%)
                        </td>
                        <td style={{ padding: '0.6rem 1rem', fontWeight: 700, color: w.summitClearDays > 0 ? '#10b981' : 'var(--text-secondary)' }}>
                          {w.summitClearDays > 0 ? `🏔️ ${w.summitClearDays}日` : '-'}
                        </td>
                        <td style={{ padding: '0.6rem 1rem', fontWeight: 700 }}>{w.totalEnter.toLocaleString()} 人</td>
                        <td style={{ padding: '0.6rem 1rem' }}>{w.avgEnterPerDay} 人/日</td>
                        <td style={{ padding: '0.6rem 1rem', fontWeight: 800, color: '#2563eb' }}>
                          {w.goodWeatherDays > 0 ? `${w.avgEnterOnGoodWeather} 人/好天日` : '-'}
                        </td>
                        <td style={{ padding: '0.6rem 1rem', color: w.isSeptemberWeek ? '#dc2626' : 'var(--text-secondary)', fontWeight: w.isSeptemberWeek ? 700 : 400 }}>
                          {w.sunsetApprox}
                        </td>
                        <td style={{ padding: '0.6rem 1rem' }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                            {w.isEarlyPreSeasonWeek ? (
                              <span style={badgeStyle('rgba(148, 163, 184, 0.2)', '#475569')}>
                                🌱 オフシーズン・残雪期 (一般誘客対象外)
                              </span>
                            ) : w.isTargetPromoWeek ? (
                              <>
                                <span style={badgeStyle('rgba(16,185,129,0.2)', '#059669')}>
                                  🎯 最重点誘客ターゲット週 (好天×穴場)
                                </span>
                                {w.isSeptemberWeek && (
                                  <span style={badgeStyle('rgba(245,158,11,0.18)', '#b45309')}>
                                    🍁 秋山・早出条件付き誘客
                                  </span>
                                )}
                              </>
                            ) : w.weekLabel === factSheet.highestRiskWeek ? (
                              <span style={badgeStyle('rgba(239,68,68,0.15)', '#dc2626')}>⚠️ 安全管理・遅発遅延の重点警戒週</span>
                            ) : w.avgEnterPerDay >= factSheet.avgEnter * 1.25 && factSheet.avgEnter > 0 ? (
                              <span style={badgeStyle('rgba(59,130,246,0.12)', '#2563eb')}>🔥 繁忙ピーク週 (混雑・踏圧対策)</span>
                            ) : w.isSeptemberWeek ? (
                              <span style={badgeStyle('rgba(245,158,11,0.14)', '#d97706')}>
                                🍁 秋山シーズン週 (⚠️日没17時台・早出必須)
                              </span>
                            ) : (
                              <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>コアシーズン標準週</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 登山日和だったのに少なかった日（チャンス喪失日）一覧テーブル */}
            <div style={{ backgroundColor: 'var(--bg-primary)', borderRadius: '12px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
              <div style={{ padding: '0.9rem 1.25rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                <span style={{ fontWeight: 800, fontSize: '0.98rem', color: '#2563eb' }}>
                  🔍 コアシーズン（6/20〜9/30）の「チャンス喪失日（好天×少人数）」一覧 ＆ 👑特A級絶景格付け
                </span>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  日中コアタイム（07〜13時）に山頂快晴だった日を「👑特A級」として最上位に表示しています
                </span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ backgroundColor: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                      <th style={{ padding: '0.65rem 0.9rem' }}>日付 / ランク</th>
                      <th style={{ padding: '0.65rem 0.9rem' }}>区分</th>
                      <th style={{ padding: '0.65rem 0.9rem' }}>実績 (コア期待値比)</th>
                      <th style={{ padding: '0.65rem 0.9rem' }}>当日の天候・山頂視界</th>
                      <th style={{ padding: '0.65rem 0.9rem' }}>前日の天候 (交通ラグ判定)</th>
                      <th style={{ padding: '0.65rem 0.9rem' }}>考えられる要因分類・誘客条件</th>
                      <th style={{ padding: '0.65rem 0.9rem' }}>詳細</th>
                    </tr>
                  </thead>
                  <tbody>
                    {factSheet.opportunityLossDays.map(o => (
                      <tr
                        key={o.date}
                        onClick={() => onSelectDate?.(o.date)}
                        style={{
                          borderBottom: '1px solid var(--border-color)',
                          backgroundColor: o.isSuperPrime ? 'rgba(16, 185, 129, 0.05)' : 'transparent',
                          cursor: onSelectDate ? 'pointer' : 'default',
                        }}
                      >
                        <td style={{ padding: '0.65rem 0.9rem', fontWeight: 800 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                            <span>{o.displayDate}</span>
                            {o.isSuperPrime && (
                              <span style={badgeStyle('rgba(245, 158, 11, 0.18)', '#b45309')}>
                                👑 特A級 (山頂絶景)
                              </span>
                            )}
                          </div>
                        </td>
                        <td style={{ padding: '0.65rem 0.9rem' }}>
                          <span
                            style={
                              o.dayType === '休日・祝日'
                                ? badgeStyle('rgba(239,68,68,0.12)', '#dc2626')
                                : badgeStyle('rgba(100,116,139,0.12)', '#475569')
                            }
                          >
                            {o.dayType}
                          </span>
                        </td>
                        <td style={{ padding: '0.65rem 0.9rem', fontWeight: 800, color: '#2563eb' }}>
                          {o.enter}人 <span style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', fontWeight: 600 }}>(期待{o.expectedEnter}人の{o.gapRatio}%)</span>
                        </td>
                        <td style={{ padding: '0.65rem 0.9rem' }}>
                          <div>{o.weatherText} ({o.tempMax}℃ / 風{o.windSpeed}m/s)</div>
                          {o.mountainCategory === 'clear' ? (
                            <span style={{ color: '#059669', fontWeight: 700, fontSize: '0.76rem' }}>
                              🏔️ 山頂快晴 (コアタイム{o.coreTimeClearCount}枚快晴)
                            </span>
                          ) : o.coreTimeClearCount > 0 ? (
                            <span style={{ color: '#059669', fontWeight: 600, fontSize: '0.75rem' }}>
                              🌤️ 日中山頂可視 ({o.coreTimeClearCount}枚)
                            </span>
                          ) : null}
                        </td>
                        <td style={{ padding: '0.65rem 0.9rem', color: o.prevRain >= 10 || o.prevWind >= 13 ? '#ef4444' : 'var(--text-secondary)', fontWeight: o.prevRain >= 10 || o.prevWind >= 13 ? 700 : 400 }}>
                          {o.prevDateWeatherText} (雨{o.prevRain}mm / 風{o.prevWind}m/s)
                        </td>
                        <td style={{ padding: '0.65rem 0.9rem' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                            <span
                              style={
                                o.causeBadge === '🚢 前日荒天・交通影響疑い'
                                  ? badgeStyle('rgba(245,158,11,0.16)', '#d97706')
                                  : o.causeBadge === '🍁 秋山好天・条件付き誘客 (⚠️早出必須)'
                                  ? badgeStyle('rgba(234,88,12,0.15)', '#c2410c')
                                  : o.causeBadge === '🏖️ 連休前後・反動減'
                                  ? badgeStyle('rgba(139,92,246,0.15)', '#7c3aed')
                                  : badgeStyle('rgba(16,185,129,0.15)', '#059669')
                              }
                            >
                              {o.causeBadge}
                            </span>
                            <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>{o.causeDetail}</span>
                          </div>
                        </td>
                        <td style={{ padding: '0.65rem 0.9rem' }}>
                          <span style={badgeStyle('rgba(59,130,246,0.12)', '#2563eb')}>詳細 ➔</span>
                        </td>
                      </tr>
                    ))}
                    {factSheet.opportunityLossDays.length === 0 && (
                      <tr>
                        <td colSpan={7} style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                          選択されたコア期間（6/20〜9/30）に顕著な機会損失日はありませんでした。
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* AI解析モーダル */}
      <MonthlyAIAnalysisModal
        isOpen={isAIModalOpen}
        onClose={() => setIsAIModalOpen(false)}
        analysisData={{
          year: activeYearForSheet,
          month: activeMonthForSheet,
          courseName,
          selectedCourse: targetCourse,
          totalEnter: factSheet.totalEnter,
          prevTotalEnter: null,
          diffEnter: null,
          diffPercent: null,
          peakDate: detailedStats.topDays[0]?.date,
          peakCount: detailedStats.topDays[0]?.enter || 0,
          dailyEntries: dailyList,
          rawEntries: filteredEntries,
          weatherData,
          cameraAnalysis,
        }}
      />
    </div>
  );
};
