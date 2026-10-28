import { GoogleGenAI } from '@google/genai';
import { format, parseISO, subDays } from 'date-fns';
import { ja } from 'date-fns/locale';
// @ts-ignore
import * as JapaneseHolidays from 'japanese-holidays';
import { isEntryEnter, type LogEntry } from './logParser';
import { getWeatherCategory, getWeatherDescription, type WeatherData } from './weatherApi';
import {
  evaluateDailyCameraVisibility,
  getEffectiveElevation,
  type ImageAnalysis,
  type CameraId,
} from '../hooks/useCameraAnalysis';

export interface AIAnalysisRequest {
  year: string;
  month: number | null; // null: 6〜9月夏山通期, -1: 10〜5月秋冬春期, -2: 1〜12月年間通期, 1..12: 各月
  courseName?: string;
  selectedCourse?: string;
  totalEnter: number;
  prevTotalEnter: number | null;
  diffEnter: number | null;
  diffPercent: string | null;
  peakDate: string | undefined;
  peakCount: number;
  notes: string;
  useWebSearch?: boolean;
  dailyEntries?: { date?: string; dateStr?: string; enter: number; exit: number }[];
  rawEntries?: LogEntry[];
  weatherData?: Record<string, WeatherData>;
  cameraAnalysis?: Record<string, ImageAnalysis[]>;
}

export interface OpportunityLossDay {
  date: string;
  displayDate: string;
  dayType: '休日・祝日' | '平日';
  enter: number;
  expectedEnter: number;
  gapRatio: number; // 期待値に対する達成率 (%)
  weatherText: string;
  tempMax: number;
  windSpeed: number;
  mountainCategory: 'clear' | 'cloudy' | 'foggy' | 'unknown';
  isSuperPrime: boolean; // 👑 特A級（日中コアタイム山頂快晴 × 好天 × 少人数）
  coreTimeClearCount: number; // 07〜13時における山頂快晴カメラ枚数
  prevDateWeatherText: string;
  prevRain: number;
  prevWind: number;
  causeBadge:
    | '🚢 前日荒天・交通影響疑い'
    | '🏖️ 連休前後・反動減'
    | '🍁 秋山好天・条件付き誘客 (⚠️早出必須)'
    | '📅 オフピーク・誘客穴場日';
  causeDetail: string;
}

export interface LateExitRiskDay {
  date: string;
  displayDate: string;
  totalEnter: number;
  lateEnterCount: number; // 10:30〜14:00
  lateExitCount: number;  // 17:00〜23:59
  afterSunsetExitCount: number; // 日没時刻以降
  lateExitRatio: number;
  avgEnterTimeStr: string;
  avgExitTimeStr: string;
  estDurationMinutes: number;
  estDurationStr: string;
  weatherText: string;
  windSpeed: number;
  rain: number;
  causeType: '🚢 スタート遅れ型' | '🥾 山中停滞・バテ・悪天型' | '⚠️ 複合リスク型';
  causeReason: string;
}

export interface WeeklyEfficiencyStat {
  weekLabel: string;
  daysCount: number;
  goodWeatherDays: number;
  summitClearDays: number;
  goodWeatherRate: number;
  totalEnter: number;
  avgEnterPerDay: number;
  avgEnterOnGoodWeather: number;
  lateEnterCount: number;
  lateExitCount: number;
  afterSunsetExitCount: number;
  sunsetApprox: string;
  isTargetPromoWeek: boolean;
  isEarlyPreSeasonWeek: boolean; // 6月上旬〜中旬（残雪・立ち上がり期：誘客対象外）
  isSeptemberWeek: boolean; // 9月（温暖化によりシーズン対象だが日没早期化で条件付き誘客）
}

export interface HourlyCameraVisibilityStat {
  hourSlot: string; // '05:00' | '07:00' | '09:00' | '11:00' | '13:00' | '15:00' | '17:00'
  sampleCount: number;
  summitClearRate: number; // 山頂快晴率 (%)
  midMountainOrAboveRate: number; // 中腹1000m以上視界確立率 (%)
  avgVisibleElevationM: number; // 平均視界上限高度 (m)
  sunnyRate: number; // 日差し・青空率 (%)
  foggyRate: number; // ガス不可視率 (%)
  avgCloudCover: number; // 平均雲量 (0.0〜10.0)
}

export interface CameraDirectionTotalStat {
  camId: CameraId;
  camLabel: string;
  sampleCount: number;
  summitClearRate: number;
  midMountainOrAboveRate: number; // 中腹1000m以上視界確立率 (%)
  avgVisibleElevationM: number; // 平均視界上限高度 (m)
  sunnyRate: number;
  foggyRate: number;
  avgCloudCover: number;
}

export interface WindDirectionCameraStat {
  windGroupKey: string;
  windGroupLabel: string;
  daysCount: number;
  oshidomariClearRate: number;
  himenumaClearRate: number;
  kutsugataClearRate: number;
  otadomariClearRate: number;
  senposhiClearRate: number;
  oshidomariAvgCloud: number;
  himenumaAvgCloud: number;
  kutsugataAvgCloud: number;
  otadomariAvgCloud: number;
  senposhiAvgCloud: number;
  himenumaSamples: number;
  otadomariSamples: number;
  bestDirectionLabel: string;
}

export interface PeriodFactSheet {
  periodLabel: string;
  courseName: string;
  totalEnter: number;
  daysCount: number;
  avgEnter: number;
  weekdayAvgEnter: number;
  holidayAvgEnter: number;
  top5ConcentrationRatio: number;
  oshidomariEnter: number;
  kutsugataEnter: number;
  avgEnterTimeStr: string;
  avgExitTimeStr: string;
  avgDurationStr: string;
  avgDurationMinutes: number;
  // リスク指標
  lateEnterTotal: number;
  lateEnterRatio: number;
  lateExitTotal: number;
  lateExitRatio: number;
  afterSunsetExitTotal: number;
  midnightEnterTotal: number;
  hazardDaysEnterTotal: number;
  hazardDaysCount: number;
  topLateExitDays: LateExitRiskDay[];
  topLateEnterDays: { date: string; displayDate: string; count: number; totalEnter: number; weatherText: string }[];
  // 気象・雲量指標
  baseSunnyDays: number;
  baseSunnyRate: number;
  camAnalyzedDays: number;
  summitClearDays: number;
  summitCloudyDays: number;
  summitFoggyDays: number;
  sunnyBaseButFoggySummitDays: number;
  morningClearAfternoonBadDays: string[];
  // カメラAI新分析指標（提案A・C・6地点拡張）
  hourlyCameraGoldenTime: HourlyCameraVisibilityStat[];
  morningSummitClearRate: number; // 05〜09時平均山頂快晴率 (%)
  afternoonSummitClearRate: number; // 13〜15時平均山頂快晴率 (%)
  cameraDirectionTotals: CameraDirectionTotalStat[];
  windDirectionCameraStats: WindDirectionCameraStat[];
  // 誘客チャンス喪失・週別効率（6/20〜9/30コアシーズン基準＋提案B）
  goodWeatherDaysCount: number;
  superPrimeOpportunityCount: number;
  opportunityLossDays: OpportunityLossDay[];
  weeklyStats: WeeklyEfficiencyStat[];
  bestPromoWeek: string | null;
  highestRiskWeek: string | null;
  promptSummaryText: string;
}

const REPORT_MODELS = [
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
];

function getSunsetHourForDate(dateStr: string): { hourFloat: number; label: string } {
  const m = parseInt(dateStr.substring(5, 7), 10);
  const d = parseInt(dateStr.substring(8, 10), 10);
  if (m === 5) return { hourFloat: 18.9, label: '18:55頃' };
  if (m === 6) return { hourFloat: 19.3, label: '19:18頃' };
  if (m === 7) {
    if (d <= 15) return { hourFloat: 19.2, label: '19:12頃' };
    return { hourFloat: 19.0, label: '19:00頃' };
  }
  if (m === 8) {
    if (d <= 10) return { hourFloat: 18.7, label: '18:42頃' };
    if (d <= 20) return { hourFloat: 18.4, label: '18:24頃' };
    return { hourFloat: 18.1, label: '18:06頃' };
  }
  if (m === 9) {
    if (d <= 10) return { hourFloat: 17.8, label: '17:48頃' };
    if (d <= 20) return { hourFloat: 17.5, label: '17:30頃' };
    return { hourFloat: 17.2, label: '17:12頃' };
  }
  if (m === 10) return { hourFloat: 16.6, label: '16:35頃' };
  if (m === 11 || m === 12 || m === 1) return { hourFloat: 16.1, label: '16:05頃' };
  if (m === 2) return { hourFloat: 16.9, label: '16:55頃' };
  if (m === 3) return { hourFloat: 17.6, label: '17:35頃' };
  if (m === 4) return { hourFloat: 18.3, label: '18:20頃' };
  return { hourFloat: 18.0, label: '18:00頃' };
}

function formatHourFloat(h: number): string {
  if (!h || h <= 0) return '--:--';
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

export function isHolidayOrWeekend(dateStr: string): boolean {
  const d = parseISO(dateStr);
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return true;
  if (JapaneseHolidays.isHoliday(d)) return true;
  // お盆期間 (8/11〜8/15) も観光・登山カレンダー上の繁忙休日扱いに含める
  const md = dateStr.substring(5, 10);
  if (md >= '08-11' && md <= '08-15') return true;
  return false;
}

/**
 * 日付文字列が選択された年・月（または通期・冬期・年間）に該当するかを判定するヘルパー
 */
export function isDateMatchingPeriod(dateStr: string, year: string, month: number | null): boolean {
  if (!dateStr || dateStr.length < 10) return false;
  if (year !== 'all' && !dateStr.startsWith(year)) return false;
  const m = parseInt(dateStr.substring(5, 7), 10);
  if (month === null) {
    // 夏山シーズン通期 (6〜9月)
    return m >= 6 && m <= 9;
  }
  if (month === -1) {
    // 秋冬春・オフシーズン期 (10〜12月 または 1〜5月)
    return m >= 10 || m <= 5;
  }
  if (month === -2) {
    // 年間通期 (1〜12月)
    return m >= 1 && m <= 12;
  }
  return m === month;
}

/**
 * 対象期間（特定月 または シーズン通期・冬期・年間）の「4大解析ピラー」ファクトシートを決定論的に計算するエンジン
 */
export function buildPeriodFactSheet(data: AIAnalysisRequest): PeriodFactSheet {
  const {
    year,
    month,
    courseName = '利尻山 全体',
    dailyEntries = [],
    rawEntries = [],
    weatherData = {},
    cameraAnalysis = {},
  } = data;

  const yearLabel = year === 'all' ? '全年度' : `${year}年`;
  const periodLabel =
    month === null
      ? `${yearLabel} 夏山シーズン通期(6〜9月)`
      : month === -1
      ? `${yearLabel} 秋冬春期(10〜5月・気象×カメラ解析)`
      : month === -2
      ? `${yearLabel} 年間通期(1〜12月)`
      : `${yearLabel}${month}月`;

  // 1. まず dailyEntries からマップを作成し、さらに気象データ・カメラAI解析が存在する日付も補完統合する
  // （※10月〜5月の冬期など、登山カウンターが撤去されていても気象×カメラのクロス分析が100%機能するようにする）
  const dailyMap: Record<string, { date: string; enter: number; exit: number }> = {};

  dailyEntries.forEach(e => {
    const dStr = e.date || e.dateStr || '';
    if (!isDateMatchingPeriod(dStr, year, month)) return;
    dailyMap[dStr] = {
      date: dStr,
      enter: e.enter || 0,
      exit: e.exit || 0,
    };
  });

  // 気象データまたはカメラAI解析結果がある日も対象期間内ならカレンダーに追加（冬期・10月以降の気象×カメラ分析用）
  const todayJst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().split('T')[0];
  const extraDateCandidates = new Set<string>([
    ...Object.keys(weatherData),
    ...Object.keys(cameraAnalysis),
  ]);
  extraDateCandidates.forEach(dStr => {
    if (dStr > todayJst) return; // 未来日は除外
    if (!dailyMap[dStr] && isDateMatchingPeriod(dStr, year, month)) {
      // 夏山通期(month === null)でカウンターログがある年度はカウンター稼働期間を優先し、
      // 10月以降やカメラ解析実施日・指定月選択時は気象/カメラ日を含める
      const hasCam = cameraAnalysis[dStr] && cameraAnalysis[dStr].some(c => c.status === 'ok');
      const m = parseInt(dStr.substring(5, 7), 10);
      if (hasCam || month !== null || m < 6 || m > 9 || dailyEntries.length === 0) {
        dailyMap[dStr] = { date: dStr, enter: 0, exit: 0 };
      }
    }
  });

  const filteredDaily = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

  // 対象期間のrawEntries抽出
  const filteredRaw = rawEntries.filter(e => isDateMatchingPeriod(e.dateStr, year, month));

  const daysCount = filteredDaily.length;
  const totalEnter = filteredDaily.reduce((s, d) => s + d.enter, 0);
  const avgEnter = daysCount > 0 ? Math.round(totalEnter / daysCount) : 0;

  // 平日 vs 休日・祝日平均
  const holidayDays = filteredDaily.filter(d => isHolidayOrWeekend(d.date));
  const weekdayDays = filteredDaily.filter(d => !isHolidayOrWeekend(d.date));
  const holidayAvgEnter =
    holidayDays.length > 0
      ? Math.round(holidayDays.reduce((s, d) => s + d.enter, 0) / holidayDays.length)
      : avgEnter;
  const weekdayAvgEnter =
    weekdayDays.length > 0
      ? Math.round(weekdayDays.reduce((s, d) => s + d.enter, 0) / weekdayDays.length)
      : avgEnter;

  // 6月上旬〜中旬（6/1〜6/19）および10月〜5月（オフシーズン・冬期）は一般登山誘客の対象外とする
  const isEarlyPreSeasonDate = (dateStr: string): boolean => {
    const md = dateStr.substring(5, 10);
    return md < '06-20' || md > '09-30';
  };

  const coreSeasonDaily = filteredDaily.filter(d => !isEarlyPreSeasonDate(d.date));
  const baseForExpected = coreSeasonDaily.length > 0 ? coreSeasonDaily : filteredDaily;
  const coreAvgEnter =
    baseForExpected.length > 0
      ? Math.round(baseForExpected.reduce((s, d) => s + d.enter, 0) / baseForExpected.length)
      : avgEnter;
  const coreHolidays = baseForExpected.filter(d => isHolidayOrWeekend(d.date));
  const coreWeekdays = baseForExpected.filter(d => !isHolidayOrWeekend(d.date));
  const coreHolidayAvgEnter =
    coreHolidays.length > 0
      ? Math.round(coreHolidays.reduce((s, d) => s + d.enter, 0) / coreHolidays.length)
      : coreAvgEnter;
  const coreWeekdayAvgEnter =
    coreWeekdays.length > 0
      ? Math.round(coreWeekdays.reduce((s, d) => s + d.enter, 0) / coreWeekdays.length)
      : coreAvgEnter;

  // 上位5日集中率
  const sortedByEnter = [...filteredDaily].sort((a, b) => b.enter - a.enter);
  const top5Sum = sortedByEnter.slice(0, 5).reduce((s, d) => s + d.enter, 0);
  const top5ConcentrationRatio = totalEnter > 0 ? Math.round((top5Sum / totalEnter) * 1000) / 10 : 0;

  // コース別・時間帯別・日別の詳細集計 (rawEntriesから)
  let oshidomariEnter = 0;
  let kutsugataEnter = 0;
  let totalRawEnter = 0;
  let totalRawExit = 0;
  let enterHourSum = 0;
  let exitHourSum = 0;

  let lateEnterTotal = 0; // 10:30〜14:00
  let lateExitTotal = 0;  // 17:00〜23:59
  let afterSunsetExitTotal = 0;
  let midnightEnterTotal = 0; // 21:00〜00:59

  const dayRawStats: Record<
    string,
    {
      enterCount: number;
      exitCount: number;
      enterHourSum: number;
      exitHourSum: number;
      lateEnter: number;
      lateExit: number;
      afterSunsetExit: number;
      midnightEnter: number;
    }
  > = {};

  filteredDaily.forEach(d => {
    dayRawStats[d.date] = {
      enterCount: 0,
      exitCount: 0,
      enterHourSum: 0,
      exitHourSum: 0,
      lateEnter: 0,
      lateExit: 0,
      afterSunsetExit: 0,
      midnightEnter: 0,
    };
  });

  filteredRaw.forEach(entry => {
    const isEnter = isEntryEnter(entry);
    const parts = entry.timeStr.split(':').map(Number);
    const preciseHour = parts[0] + (parts[1] || 0) / 60 + (parts[2] || 0) / 3600;
    const sunsetInfo = getSunsetHourForDate(entry.dateStr);

    if (!dayRawStats[entry.dateStr]) {
      dayRawStats[entry.dateStr] = {
        enterCount: 0,
        exitCount: 0,
        enterHourSum: 0,
        exitHourSum: 0,
        lateEnter: 0,
        lateExit: 0,
        afterSunsetExit: 0,
        midnightEnter: 0,
      };
    }
    const ds = dayRawStats[entry.dateStr];

    if (isEnter) {
      totalRawEnter++;
      ds.enterCount++;
      if (preciseHour >= 3.0 && preciseHour <= 16.0) {
        enterHourSum += preciseHour;
        ds.enterHourSum += preciseHour;
      }
      if (entry.course === 'kutsugata') kutsugataEnter++;
      else oshidomariEnter++;

      if (preciseHour >= 10.5 && preciseHour < 14.0) {
        lateEnterTotal++;
        ds.lateEnter++;
      }
      if (entry.hour >= 21 || entry.hour === 0) {
        midnightEnterTotal++;
        ds.midnightEnter++;
      }
    } else {
      totalRawExit++;
      ds.exitCount++;
      if (preciseHour >= 8.0 && preciseHour <= 22.0) {
        exitHourSum += preciseHour;
        ds.exitHourSum += preciseHour;
      }
      if (entry.hour >= 17) {
        lateExitTotal++;
        ds.lateExit++;
      }
      if (preciseHour >= sunsetInfo.hourFloat) {
        afterSunsetExitTotal++;
        ds.afterSunsetExit++;
      }
    }
  });

  const avgEnterHour = totalRawEnter > 0 ? enterHourSum / totalRawEnter : 6.0;
  const avgExitHour = totalRawExit > 0 ? exitHourSum / totalRawExit : 14.5;
  const avgEnterTimeStr = totalRawEnter > 0 ? formatHourFloat(avgEnterHour) : '--:--';
  const avgExitTimeStr = totalRawExit > 0 ? formatHourFloat(avgExitHour) : '--:--';
  const avgDurationMinutes =
    totalRawEnter > 0 && avgExitHour > avgEnterHour ? Math.round((avgExitHour - avgEnterHour) * 60) : 0;
  const avgDurationStr =
    avgDurationMinutes > 0
      ? `約${Math.floor(avgDurationMinutes / 60)}時間${avgDurationMinutes % 60}分`
      : '記録なし(冬期/期間外)';

  const lateEnterRatio = totalRawEnter > 0 ? Math.round((lateEnterTotal / totalRawEnter) * 1000) / 10 : 0;
  const lateExitRatio = totalRawExit > 0 ? Math.round((lateExitTotal / totalRawExit) * 1000) / 10 : 0;

  // 遅発入山TOP5
  const topLateEnterDays = Object.entries(dayRawStats)
    .filter(([, st]) => st.lateEnter > 0)
    .map(([date, st]) => {
      const w = weatherData[date];
      const wDesc = w ? getWeatherDescription(w.weatherCode, w.precipitation, w.sunshineDuration, date, cameraAnalysis[date]) : null;
      return {
        date,
        displayDate: format(parseISO(date), 'M/d(E)', { locale: ja }),
        count: st.lateEnter,
        totalEnter: st.enterCount,
        weatherText: wDesc ? `${wDesc.emoji}${wDesc.text}` : '不明',
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  // 遅延下山（17時以降）TOP8 ＆ 原因自動分類
  const topLateExitDays: LateExitRiskDay[] = Object.entries(dayRawStats)
    .filter(([, st]) => st.lateExit > 0)
    .map(([date, st]) => {
      const w = weatherData[date];
      const wDesc = w ? getWeatherDescription(w.weatherCode, w.precipitation, w.sunshineDuration, date, cameraAnalysis[date]) : null;
      const dayAvgEnter = st.enterCount > 0 ? st.enterHourSum / st.enterCount : avgEnterHour;
      const dayAvgExit = st.exitCount > 0 ? st.exitHourSum / st.exitCount : avgExitHour;
      const durMin = dayAvgExit > dayAvgEnter ? Math.round((dayAvgExit - dayAvgEnter) * 60) : 510;
      const durStr = `約${Math.floor(durMin / 60)}時間${durMin % 60}分`;
      const ratio = st.exitCount > 0 ? Math.round((st.lateExit / st.exitCount) * 1000) / 10 : 0;

      const isLateStart = st.lateEnter >= Math.max(3, st.lateExit * 0.4) || dayAvgEnter >= avgEnterHour + 0.6;
      const isLongDuration = durMin >= 550 || (w && (w.precipitation >= 10 || w.windSpeedMax >= 13));

      let causeType: LateExitRiskDay['causeType'] = '🥾 山中停滞・バテ・悪天型';
      let causeReason = '朝は標準時間に入山しているが、山中での行動時間が長引き日没前後にずれ込んだパターン';

      if (isLateStart && isLongDuration) {
        causeType = '⚠️ 複合リスク型';
        causeReason = `遅発入山(${st.lateEnter}人)に加え、山中滞在時間も${durStr}と長期化`;
      } else if (isLateStart) {
        causeType = '🚢 スタート遅れ型';
        causeReason = `10:30以降の遅発入山(${st.lateEnter}人)や出発の遅れがそのまま夕方下山に直結`;
      } else if (w && (w.precipitation >= 10 || w.windSpeedMax >= 13)) {
        causeType = '🥾 山中停滞・バテ・悪天型';
        causeReason = `強風(${w.windSpeedMax}m/s)・降雨(${w.precipitation}mm)による歩行ペース低下で滞在${durStr}に長期化`;
      }

      return {
        date,
        displayDate: format(parseISO(date), 'M/d(E)', { locale: ja }),
        totalEnter: st.enterCount,
        lateEnterCount: st.lateEnter,
        lateExitCount: st.lateExit,
        afterSunsetExitCount: st.afterSunsetExit,
        lateExitRatio: ratio,
        avgEnterTimeStr: formatHourFloat(dayAvgEnter),
        avgExitTimeStr: formatHourFloat(dayAvgExit),
        estDurationMinutes: durMin,
        estDurationStr: durStr,
        weatherText: wDesc ? `${wDesc.emoji}${wDesc.text}` : '不明',
        windSpeed: w?.windSpeedMax || 0,
        rain: w?.precipitation || 0,
        causeType,
        causeReason,
      };
    })
    .sort((a, b) => b.lateExitCount - a.lateExitCount)
    .slice(0, 8);

  // 気象・雲量・ハザード・チャンス喪失日の日次スキャン
  let baseSunnyDays = 0;
  let camAnalyzedDays = 0;
  let summitClearDays = 0;
  let summitCloudyDays = 0;
  let summitFoggyDays = 0;
  let sunnyBaseButFoggySummitDays = 0;
  const morningClearAfternoonBadDays: string[] = [];

  let hazardDaysCount = 0;
  let hazardDaysEnterTotal = 0;
  let goodWeatherDaysCount = 0;
  let superPrimeOpportunityCount = 0;
  const opportunityLossDays: OpportunityLossDay[] = [];

  // 提案A: 7時間帯ごとの山頂視界ゴールデンタイム集計バケット
  const GOLDEN_SLOTS = ['05', '07', '09', '11', '13', '15', '17'] as const;
  const slotBuckets: Record<
    string,
    { total: number; clear: number; midOrAbove: number; elevSum: number; sunny: number; foggy: number; cloudSum: number }
  > = {};
  GOLDEN_SLOTS.forEach(s => {
    slotBuckets[s] = { total: 0, clear: 0, midOrAbove: 0, elevSum: 0, sunny: 0, foggy: 0, cloudSum: 0 };
  });

  // 提案C: 最大6地点カメラ全体集計 ＆ 風向別×方角別カメラ非対称集計バケット
  const CAM_DIRS: { id: CameraId; label: string; isCore: boolean }[] = [
    { id: 'oshidomari', label: '北：鴛泊(長官・ポン山)', isCore: true },
    { id: 'ferry', label: '北：鴛泊港(北稜俯瞰)', isCore: false },
    { id: 'himenuma', label: '北東：姫沼(オチュウシナイ沢)', isCore: false },
    { id: 'kutsugata', label: '西：沓形(三眺山)', isCore: true },
    { id: 'otadomari', label: '南東：オタドマリ(ヤムナイ沢)', isCore: false },
    { id: 'senposhi', label: '南：仙法志(南稜)', isCore: true },
  ];

  const dirTotalsMap: Record<
    CameraId,
    { total: number; clear: number; midOrAbove: number; elevSum: number; sunny: number; foggy: number; cloudSum: number }
  > = {
    oshidomari: { total: 0, clear: 0, midOrAbove: 0, elevSum: 0, sunny: 0, foggy: 0, cloudSum: 0 },
    ferry: { total: 0, clear: 0, midOrAbove: 0, elevSum: 0, sunny: 0, foggy: 0, cloudSum: 0 },
    himenuma: { total: 0, clear: 0, midOrAbove: 0, elevSum: 0, sunny: 0, foggy: 0, cloudSum: 0 },
    kutsugata: { total: 0, clear: 0, midOrAbove: 0, elevSum: 0, sunny: 0, foggy: 0, cloudSum: 0 },
    otadomari: { total: 0, clear: 0, midOrAbove: 0, elevSum: 0, sunny: 0, foggy: 0, cloudSum: 0 },
    senposhi: { total: 0, clear: 0, midOrAbove: 0, elevSum: 0, sunny: 0, foggy: 0, cloudSum: 0 },
  };

  const WIND_GROUPS = [
    { key: 'east_se', label: '東〜南東風 (ヤマセ・オホーツク気流)' },
    { key: 'south_sw', label: '南〜南西風 (夏季節風・暖湿流)' },
    { key: 'west_nw', label: '西〜北西風 (日本海風・冬型季節風)' },
    { key: 'north_ne', label: '北〜北東風 (宗谷海峡・高気圧圏)' },
  ] as const;

  const windCamMap: Record<
    string,
    {
      daysCount: number;
      oshidomari: { total: number; clear: number; cloudSum: number };
      himenuma: { total: number; clear: number; cloudSum: number };
      kutsugata: { total: number; clear: number; cloudSum: number };
      otadomari: { total: number; clear: number; cloudSum: number };
      senposhi: { total: number; clear: number; cloudSum: number };
    }
  > = {};
  WIND_GROUPS.forEach(wg => {
    windCamMap[wg.key] = {
      daysCount: 0,
      oshidomari: { total: 0, clear: 0, cloudSum: 0 },
      himenuma: { total: 0, clear: 0, cloudSum: 0 },
      kutsugata: { total: 0, clear: 0, cloudSum: 0 },
      otadomari: { total: 0, clear: 0, cloudSum: 0 },
      senposhi: { total: 0, clear: 0, cloudSum: 0 },
    };
  });

  const getWindGroupKey = (deg?: number): string => {
    if (deg === undefined || deg === null) return 'south_sw';
    if (deg >= 45 && deg < 135) return 'east_se';
    if (deg >= 135 && deg < 225) return 'south_sw';
    if (deg >= 225 && deg < 315) return 'west_nw';
    return 'north_ne';
  };

  // 週別集計マップ
  const weeklyMap: Record<
    string,
    {
      daysCount: number;
      earlyDaysCount: number;
      goodWeatherDays: number;
      summitClearDays: number;
      totalEnter: number;
      goodWeatherEnterSum: number;
      lateEnter: number;
      lateExit: number;
      afterSunsetExit: number;
      sampleDate: string;
    }
  > = {};

  filteredDaily.forEach(d => {
    const w = weatherData[d.date];
    const cam = cameraAnalysis[d.date];
    const camEval = evaluateDailyCameraVisibility(cam);
    const rawSt = dayRawStats[d.date] || {
      enterCount: d.enter,
      exitCount: d.exit,
      lateEnter: 0,
      lateExit: 0,
      afterSunsetExit: 0,
    };

    const mNum = parseInt(d.date.substring(5, 7), 10);
    const dayNum = parseInt(d.date.substring(8, 10), 10);
    const wNum = Math.min(Math.ceil(dayNum / 7), 5);
    const weekLabel = month !== null && month > 0 ? `第${wNum}週` : `${mNum}月第${wNum}週`;
    const isEarlyDate = isEarlyPreSeasonDate(d.date);

    if (!weeklyMap[weekLabel]) {
      weeklyMap[weekLabel] = {
        daysCount: 0,
        earlyDaysCount: 0,
        goodWeatherDays: 0,
        summitClearDays: 0,
        totalEnter: 0,
        goodWeatherEnterSum: 0,
        lateEnter: 0,
        lateExit: 0,
        afterSunsetExit: 0,
        sampleDate: d.date,
      };
    }
    const wk = weeklyMap[weekLabel];
    wk.daysCount++;
    if (isEarlyDate) wk.earlyDaysCount++;
    wk.totalEnter += d.enter;
    wk.lateEnter += rawSt.lateEnter;
    wk.lateExit += rawSt.lateExit;
    wk.afterSunsetExit += rawSt.afterSunsetExit;

    // カメラ有効データの時間帯別(提案A)・方向別＆風向別(提案C)集計
    const validDayCams = (cam || []).filter(
      c => c.status !== 'missing' && c.visibility !== 'missing' && c.cloud_cover >= 0
    );
    if (validDayCams.length > 0) {
      const wgKey = getWindGroupKey(w?.windDirection);
      const wgBucket = windCamMap[wgKey];
      if (wgBucket) wgBucket.daysCount++;

      const has07 = validDayCams.some(c => c.fileName.startsWith('07_'));
      const has09 = validDayCams.some(c => c.fileName.startsWith('09_'));
      const has13 = validDayCams.some(c => c.fileName.startsWith('13_'));
      const has15 = validDayCams.some(c => c.fileName.startsWith('15_'));

      validDayCams.forEach(c => {
        const hrPrefix = c.fileName.substring(0, 2);
        const isClear = c.visibility === 'clear' && c.summit_visible !== false;
        const isSunny = c.is_sunny === true || isClear || (c.cloud_cover >= 0 && c.cloud_cover <= 4);
        const isFoggy = c.visibility === 'foggy';
        const cloud = c.cloud_cover >= 0 ? c.cloud_cover : 5;
        const elevM = getEffectiveElevation(c).elevationM;
        const isMidOrAbove = elevM >= 1000;

        // 7時間帯スロットへの割り当て
        const targetSlots: string[] = [];
        if (slotBuckets[hrPrefix]) {
          targetSlots.push(hrPrefix);
        } else if (hrPrefix === '08') {
          if (!has07) targetSlots.push('07');
          if (!has09) targetSlots.push('09');
        } else if (hrPrefix === '14') {
          if (!has13) targetSlots.push('13');
          if (!has15) targetSlots.push('15');
        }

        targetSlots.forEach(slotKey => {
          const sb = slotBuckets[slotKey];
          if (sb) {
            sb.total++;
            if (isClear) sb.clear++;
            if (isMidOrAbove) sb.midOrAbove++;
            sb.elevSum += elevM;
            if (isSunny) sb.sunny++;
            if (isFoggy) sb.foggy++;
            sb.cloudSum += cloud;
          }
        });

        // 6地点カメラ識別
        const camDir: CameraId | null = c.fileName.includes('_oshidomari')
          ? 'oshidomari'
          : c.fileName.includes('_ferry')
          ? 'ferry'
          : c.fileName.includes('_himenuma')
          ? 'himenuma'
          : c.fileName.includes('_kutsugata')
          ? 'kutsugata'
          : c.fileName.includes('_otadomari')
          ? 'otadomari'
          : c.fileName.includes('_senposhi')
          ? 'senposhi'
          : null;

        if (camDir) {
          const dt = dirTotalsMap[camDir];
          dt.total++;
          if (isClear) dt.clear++;
          if (isMidOrAbove) dt.midOrAbove++;
          dt.elevSum += elevM;
          if (isSunny) dt.sunny++;
          if (isFoggy) dt.foggy++;
          dt.cloudSum += cloud;

          if (wgBucket) {
            // ferryは同じ北側(鴛泊)バケットにも合算して北側の統計精度を高める
            const windDirKey = camDir === 'ferry' ? 'oshidomari' : camDir;
            wgBucket[windDirKey].total++;
            if (isClear) wgBucket[windDirKey].clear++;
            wgBucket[windDirKey].cloudSum += cloud;
          }
        }
      });
    }

    // 島の天気カテゴリ（アメダス実測×カメラハイブリッド判定）
    const baseCat =
      w && w.weatherCode !== undefined
        ? getWeatherCategory(w.weatherCode, w.precipitation, w.sunshineDuration, d.date, cam)
        : 'Unknown';
    const isBaseSunny = baseCat === 'Sunny';
    if (isBaseSunny) baseSunnyDays++;

    // カメラ山頂視界
    if (camEval.mountainCategory !== 'unknown') {
      camAnalyzedDays++;
      if (camEval.mountainCategory === 'clear') {
        summitClearDays++;
        wk.summitClearDays++;
      } else if (camEval.mountainCategory === 'cloudy') {
        summitCloudyDays++;
      } else if (camEval.mountainCategory === 'foggy') {
        summitFoggyDays++;
        if (isBaseSunny) sunnyBaseButFoggySummitDays++;
      }
      if (camEval.morningClearAfternoonFoggy) {
        morningClearAfternoonBadDays.push(`${format(parseISO(d.date), 'M/d(E)', { locale: ja })}`);
      }
    }

    // ハザード日 (雨30mm以上 または 風15m/s以上)
    if (w && (w.precipitation >= 30.0 || w.windSpeedMax >= 15.0)) {
      hazardDaysCount++;
      hazardDaysEnterTotal += d.enter;
    }

    // 「登山日和（好天日）」の定義
    const isGoodClimbingDay =
      isBaseSunny &&
      (w?.precipitation || 0) <= 2.0 &&
      (w?.windSpeedMax || 0) <= 12.5 &&
      camEval.mountainCategory !== 'foggy';

    if (isGoodClimbingDay) {
      goodWeatherDaysCount++;
      wk.goodWeatherDays++;
      wk.goodWeatherEnterSum += d.enter;

      // 6/20〜9/30のコアシーズンのみ誘客チャンス喪失日を判定
      if (!isEarlyDate) {
        const isHol = isHolidayOrWeekend(d.date);
        const expected = isHol
          ? Math.max(coreHolidayAvgEnter, coreAvgEnter)
          : Math.max(coreWeekdayAvgEnter, Math.round(coreAvgEnter * 0.85));

        if (expected > 5 && (d.enter <= expected * 0.75 || d.enter <= coreAvgEnter * 0.7)) {
          const prevDateStr = format(subDays(parseISO(d.date), 1), 'yyyy-MM-dd');
          const prevW = weatherData[prevDateStr];
          const prevWDesc =
            prevW && prevW.weatherCode !== undefined
              ? getWeatherDescription(prevW.weatherCode, prevW.precipitation, prevW.sunshineDuration, prevDateStr, cameraAnalysis[prevDateStr])
              : null;
          const prevRain = prevW?.precipitation || 0;
          const prevWind = prevW?.windSpeedMax || 0;

          const wDesc =
            w && w.weatherCode !== undefined
              ? getWeatherDescription(w.weatherCode, w.precipitation, w.sunshineDuration, d.date, cam)
              : null;

          const coreTimeClearCount = validDayCams.filter(c => {
            const hr = c.fileName.substring(0, 2);
            return (
              ['07', '08', '09', '11', '13'].includes(hr) &&
              c.visibility === 'clear' &&
              c.summit_visible !== false
            );
          }).length;
          const isSuperPrime = camEval.mountainCategory === 'clear' || coreTimeClearCount >= 3;
          if (isSuperPrime) superPrimeOpportunityCount++;

          let causeBadge: OpportunityLossDay['causeBadge'] = '📅 オフピーク・誘客穴場日';
          let causeDetail =
            '前日・当日ともに穏やかな好天。6月下旬〜8月のコアシーズンにおける平日・端境期の純粋な需要ギャップ（来年度の有力な誘客ターゲット日）';

          if (prevRain >= 10.0 || prevWind >= 13.0) {
            causeBadge = '🚢 前日荒天・交通影響疑い';
            causeDetail = `当日は登山日和に回復したが、前日の荒天（降水${prevRain}mm / 最大風速${prevWind}m/s）によるフェリー欠航警戒や前泊キャンセルが影響した可能性大${
              mNum === 9 ? '（※9月のため日没17時台・早出条件付き）' : ''
            }`;
          } else if (mNum === 9) {
            causeBadge = '🍁 秋山好天・条件付き誘客 (⚠️早出必須)';
            causeDetail =
              '近年は温暖化・降雪の遅れで9月も絶好の秋山シーズン。ただし日没が17時台前半と早いため、「前泊＋早朝5時前入山・15時下山」をセットにした安全条件付き誘客が必須（当日午前フェリー着での入山誘導はNG）';
          } else if (isHol) {
            causeBadge = '🏖️ 連休前後・反動減';
            causeDetail =
              '休日・好天にもかかわらず入山者が伸び悩んだ特異日（連休最終日の移動日や島外イベント競合等の可能性）';
          }

          opportunityLossDays.push({
            date: d.date,
            displayDate: format(parseISO(d.date), 'M/d(E)', { locale: ja }),
            dayType: isHol ? '休日・祝日' : '平日',
            enter: d.enter,
            expectedEnter: expected,
            gapRatio: Math.round((d.enter / Math.max(expected, 1)) * 100),
            weatherText: wDesc ? `${wDesc.emoji}${wDesc.text}` : '☀️晴れ',
            tempMax: w?.tempMax || 0,
            windSpeed: w?.windSpeedMax || 0,
            mountainCategory: camEval.mountainCategory,
            isSuperPrime,
            coreTimeClearCount,
            prevDateWeatherText: prevWDesc ? `${prevWDesc.emoji}${prevWDesc.text}` : '不明',
            prevRain,
            prevWind,
            causeBadge,
            causeDetail,
          });
        }
      }
    }
  });

  opportunityLossDays.sort((a, b) => {
    if (a.isSuperPrime !== b.isSuperPrime) return a.isSuperPrime ? -1 : 1;
    return a.gapRatio - b.gapRatio || a.enter - b.enter;
  });

  // 提案A: 時間帯別山頂視界ゴールデンタイム配列の構築
  const hourlyCameraGoldenTime: HourlyCameraVisibilityStat[] = GOLDEN_SLOTS.map(s => {
    const sb = slotBuckets[s];
    const total = sb.total;
    return {
      hourSlot: `${s}:00`,
      sampleCount: total,
      summitClearRate: total > 0 ? Math.round((sb.clear / total) * 100) : 0,
      midMountainOrAboveRate: total > 0 ? Math.round((sb.midOrAbove / total) * 100) : 0,
      avgVisibleElevationM: total > 0 ? Math.round(sb.elevSum / total) : 0,
      sunnyRate: total > 0 ? Math.round((sb.sunny / total) * 100) : 0,
      foggyRate: total > 0 ? Math.round((sb.foggy / total) * 100) : 0,
      avgCloudCover: total > 0 ? Math.round((sb.cloudSum / total) * 10) / 10 : 0,
    };
  });

  const morningTotal = slotBuckets['05'].total + slotBuckets['07'].total + slotBuckets['09'].total;
  const morningClear = slotBuckets['05'].clear + slotBuckets['07'].clear + slotBuckets['09'].clear;
  const morningSummitClearRate = morningTotal > 0 ? Math.round((morningClear / morningTotal) * 100) : 0;

  const afternoonTotal = slotBuckets['13'].total + slotBuckets['15'].total;
  const afternoonClear = slotBuckets['13'].clear + slotBuckets['15'].clear;
  const afternoonSummitClearRate = afternoonTotal > 0 ? Math.round((afternoonClear / afternoonTotal) * 100) : 0;

  // 提案C: 最大6地点カメラ全体比較（コア3地点は常時、追加3地点はサンプルが存在する場合に表示）
  const cameraDirectionTotals: CameraDirectionTotalStat[] = CAM_DIRS.filter(
    cd => cd.isCore || dirTotalsMap[cd.id].total > 0
  ).map(cd => {
    const dt = dirTotalsMap[cd.id];
    return {
      camId: cd.id,
      camLabel: cd.label,
      sampleCount: dt.total,
      summitClearRate: dt.total > 0 ? Math.round((dt.clear / dt.total) * 100) : 0,
      midMountainOrAboveRate: dt.total > 0 ? Math.round((dt.midOrAbove / dt.total) * 100) : 0,
      avgVisibleElevationM: dt.total > 0 ? Math.round(dt.elevSum / dt.total) : 0,
      sunnyRate: dt.total > 0 ? Math.round((dt.sunny / dt.total) * 100) : 0,
      foggyRate: dt.total > 0 ? Math.round((dt.foggy / dt.total) * 100) : 0,
      avgCloudCover: dt.total > 0 ? Math.round((dt.cloudSum / dt.total) * 10) / 10 : 0,
    };
  });

  const windDirectionCameraStats: WindDirectionCameraStat[] = WIND_GROUPS.map(wg => {
    const wb = windCamMap[wg.key];
    const oRate = wb.oshidomari.total > 0 ? Math.round((wb.oshidomari.clear / wb.oshidomari.total) * 100) : 0;
    const hRate = wb.himenuma.total > 0 ? Math.round((wb.himenuma.clear / wb.himenuma.total) * 100) : 0;
    const kRate = wb.kutsugata.total > 0 ? Math.round((wb.kutsugata.clear / wb.kutsugata.total) * 100) : 0;
    const otaRate = wb.otadomari.total > 0 ? Math.round((wb.otadomari.clear / wb.otadomari.total) * 100) : 0;
    const sRate = wb.senposhi.total > 0 ? Math.round((wb.senposhi.clear / wb.senposhi.total) * 100) : 0;

    const oCloud = wb.oshidomari.total > 0 ? Math.round((wb.oshidomari.cloudSum / wb.oshidomari.total) * 10) / 10 : 0;
    const hCloud = wb.himenuma.total > 0 ? Math.round((wb.himenuma.cloudSum / wb.himenuma.total) * 10) / 10 : 0;
    const kCloud = wb.kutsugata.total > 0 ? Math.round((wb.kutsugata.cloudSum / wb.kutsugata.total) * 10) / 10 : 0;
    const otaCloud = wb.otadomari.total > 0 ? Math.round((wb.otadomari.cloudSum / wb.otadomari.total) * 10) / 10 : 0;
    const sCloud = wb.senposhi.total > 0 ? Math.round((wb.senposhi.cloudSum / wb.senposhi.total) * 10) / 10 : 0;

    let bestDirectionLabel = 'データ収集待ち';
    if (wb.daysCount > 0) {
      const pairs = [
        { name: '鴛泊(北)', rate: oRate, cloud: oCloud, total: wb.oshidomari.total },
        { name: '姫沼(北東)', rate: hRate, cloud: hCloud, total: wb.himenuma.total },
        { name: '沓形(西)', rate: kRate, cloud: kCloud, total: wb.kutsugata.total },
        { name: 'オタドマリ(南東)', rate: otaRate, cloud: otaCloud, total: wb.otadomari.total },
        { name: '仙法志(南)', rate: sRate, cloud: sCloud, total: wb.senposhi.total },
      ]
        .filter(p => p.total > 0)
        .sort((a, b) => b.rate - a.rate || a.cloud - b.cloud);
      if (pairs.length > 0) {
        bestDirectionLabel = `🏆 ${pairs[0].name}側が好視界 (快晴率${pairs[0].rate}% / 雲量${pairs[0].cloud})`;
      }
    }

    return {
      windGroupKey: wg.key,
      windGroupLabel: wg.label,
      daysCount: wb.daysCount,
      oshidomariClearRate: oRate,
      himenumaClearRate: hRate,
      kutsugataClearRate: kRate,
      otadomariClearRate: otaRate,
      senposhiClearRate: sRate,
      oshidomariAvgCloud: oCloud,
      himenumaAvgCloud: hCloud,
      kutsugataAvgCloud: kCloud,
      otadomariAvgCloud: otaCloud,
      senposhiAvgCloud: sCloud,
      himenumaSamples: wb.himenuma.total,
      otadomariSamples: wb.otadomari.total,
      bestDirectionLabel,
    };
  });

  const baseSunnyRate = daysCount > 0 ? Math.round((baseSunnyDays / daysCount) * 100) : 0;

  // 週別統計の整形と「最重点誘客ターゲット週」「最高リスク週」の特定
  const weeklyStats: WeeklyEfficiencyStat[] = Object.entries(weeklyMap).map(([weekLabel, st]) => {
    const goodWeatherRate = st.daysCount > 0 ? Math.round((st.goodWeatherDays / st.daysCount) * 100) : 0;
    const avgEnterPerDay = st.daysCount > 0 ? Math.round(st.totalEnter / st.daysCount) : 0;
    const avgEnterOnGoodWeather =
      st.goodWeatherDays > 0 ? Math.round(st.goodWeatherEnterSum / st.goodWeatherDays) : avgEnterPerDay;
    const sunsetInfo = getSunsetHourForDate(st.sampleDate);
    const isEarlyPreSeasonWeek = st.earlyDaysCount > st.daysCount / 2;
    const isSeptemberWeek = st.sampleDate.substring(5, 7) === '09';

    return {
      weekLabel,
      daysCount: st.daysCount,
      goodWeatherDays: st.goodWeatherDays,
      summitClearDays: st.summitClearDays,
      goodWeatherRate,
      totalEnter: st.totalEnter,
      avgEnterPerDay,
      avgEnterOnGoodWeather,
      lateEnterCount: st.lateEnter,
      lateExitCount: st.lateExit,
      afterSunsetExitCount: st.afterSunsetExit,
      sunsetApprox: sunsetInfo.label,
      isTargetPromoWeek: false,
      isEarlyPreSeasonWeek,
      isSeptemberWeek,
    };
  });

  let bestPromoWeek: string | null = null;
  const promoCandidates = weeklyStats.filter(w => !w.isEarlyPreSeasonWeek && w.goodWeatherDays >= 2);
  if (promoCandidates.length > 0) {
    promoCandidates.sort((a, b) => a.avgEnterOnGoodWeather - b.avgEnterOnGoodWeather);
    bestPromoWeek = promoCandidates[0].weekLabel;
    const targetObj = weeklyStats.find(w => w.weekLabel === bestPromoWeek);
    if (targetObj) targetObj.isTargetPromoWeek = true;
  }

  let highestRiskWeek: string | null = null;
  if (weeklyStats.length > 0) {
    const riskSorted = [...weeklyStats].sort(
      (a, b) => b.lateExitCount * 2 + b.lateEnterCount - (a.lateExitCount * 2 + a.lateEnterCount)
    );
    if (riskSorted[0].lateExitCount + riskSorted[0].lateEnterCount > 0) {
      highestRiskWeek = riskSorted[0].weekLabel;
    }
  }

  // AIプロンプトへ注入する構造化テキストの組み立て
  const prevText =
    data.prevTotalEnter !== null
      ? `前年同期: ${data.prevTotalEnter}人 (前年比: ${data.diffPercent}%, 増減: ${data.diffEnter}人)`
      : '前年同期のデータなし';

  const top5DaysText = sortedByEnter
    .filter(d => d.enter > 0)
    .slice(0, 5)
    .map((d, idx) => {
      const w = weatherData[d.date];
      const wDesc = w ? getWeatherDescription(w.weatherCode, w.precipitation, w.sunshineDuration, d.date, cameraAnalysis[d.date]) : null;
      return `  ${idx + 1}位: ${format(parseISO(d.date), 'M/d(E)', { locale: ja })} ${d.enter}人 (${wDesc ? wDesc.text : '不明'})`;
    })
    .join('\n') || '  ・カウンター記録期間外（気象・ライブカメラ解析モード）';

  const oppLossText =
    opportunityLossDays.length > 0
      ? opportunityLossDays
          .slice(0, 8)
          .map(
            o =>
              `  ・${o.displayDate}[${o.dayType}]${o.isSuperPrime ? '【👑特A級:山頂絶景】' : ''}: 入山${o.enter}人 (コア期待値${o.expectedEnter}人の${o.gapRatio}%) | 当日:${o.weatherText}(最高${o.tempMax}℃, 風${o.windSpeed}m/s, 山頂視界:${o.mountainCategory}) | 前日:${o.prevDateWeatherText}(降水${o.prevRain}mm, 風${o.prevWind}m/s) ➔ 判定:${o.causeBadge} (${o.causeDetail})`
          )
          .join('\n')
      : '  ・該当する顕著な機会損失日はありませんでした。';

  const lateExitText =
    topLateExitDays.length > 0
      ? topLateExitDays
          .slice(0, 5)
          .map(
            l =>
              `  ・${l.displayDate}: 17時以降下山 ${l.lateExitCount}人 (うち日没後${l.afterSunsetExitCount}人, 遅延率${l.lateExitRatio}%) | 平均入山${l.avgEnterTimeStr}→平均下山${l.avgExitTimeStr}(滞在${l.estDurationStr}) | 遅発入山${l.lateEnterCount}人 | 天気:${l.weatherText}(降水${l.rain}mm,風${l.windSpeed}m/s) ➔ 原因分類:${l.causeType}`
          )
          .join('\n')
      : '  ・17時以降の遅延下山はありませんでした。';

  const weeklyText = weeklyStats
    .map(
      w =>
        `  ・${w.weekLabel} (日没${w.sunsetApprox}): 計${w.totalEnter}人 (日平均${w.avgEnterPerDay}人) | 登山日和${w.goodWeatherDays}/${w.daysCount}日(晴天率${w.goodWeatherRate}%, 山頂快晴${w.summitClearDays}日, 好天日平均${w.avgEnterOnGoodWeather}人) | 遅発入山:${w.lateEnterCount}人, 遅延下山:${w.lateExitCount}人(日没後${w.afterSunsetExitCount}人)${
          w.isEarlyPreSeasonWeek
            ? ' [🌱オフシーズン/冬期・残雪期:一般誘客対象外]'
            : w.isTargetPromoWeek
            ? w.isSeptemberWeek
              ? ' ★来年度誘客ターゲット週 [🍁秋山・日没早期化のため早出条件付き誘客]'
              : ' ★来年度最重点誘客ターゲット週 (コアシーズン好天×穴場)'
            : w.isSeptemberWeek
            ? ' [🍁秋山シーズン:日没17時台・早出注意]'
            : ''
        }`
    )
    .join('\n');

  const goldenTimeText = hourlyCameraGoldenTime
    .filter(h => h.sampleCount > 0)
    .map(
      h =>
        `  ・${h.hourSlot}: 山頂快晴率 ${h.summitClearRate}% / 日差し率 ${h.sunnyRate}% / ガス率 ${h.foggyRate}% / 平均雲量 ${h.avgCloudCover}`
    )
    .join('\n');

  const windAsymmetryText = windDirectionCameraStats
    .filter(wg => wg.daysCount > 0)
    .map(
      wg =>
        `  ・${wg.windGroupLabel} (${wg.daysCount}日): 鴛泊(北)快晴率${wg.oshidomariClearRate}%[雲量${wg.oshidomariAvgCloud}]${
          wg.himenumaSamples > 0 ? ` / 姫沼(北東)快晴率${wg.himenumaClearRate}%[雲量${wg.himenumaAvgCloud}]` : ''
        } / 沓形(西)快晴率${wg.kutsugataClearRate}%[雲量${wg.kutsugataAvgCloud}]${
          wg.otadomariSamples > 0 ? ` / オタドマリ(南東)快晴率${wg.otadomariClearRate}%[雲量${wg.otadomariAvgCloud}]` : ''
        } / 仙法志(南)快晴率${wg.senposhiClearRate}%[雲量${wg.senposhiAvgCloud}] ➔ ${wg.bestDirectionLabel}`
    )
    .join('\n');

  const promptSummaryText = `
【対象期間・コース】: ${periodLabel} / ${courseName}

【第1の柱：事実ベースの動態データ】
・総入山者数: ${totalEnter}人 (${prevText})
・対象日数: ${daysCount}日間 / 1日平均: ${avgEnter}人 (休日・祝日・お盆平均: ${holidayAvgEnter}人 vs 平日平均: ${weekdayAvgEnter}人)
・コアシーズン(6/20〜9/30)基準平均: 1日平均 ${coreAvgEnter}人 (休日 ${coreHolidayAvgEnter}人 / 平日 ${coreWeekdayAvgEnter}人)
・コース内訳: 鴛泊コース ${oshidomariEnter}人 / 沓形コース ${kutsugataEnter}人
・上位5日間への集中率: ${top5ConcentrationRatio}%
・平均行動タイムライン: 平均入山 ${avgEnterTimeStr} → 平均下山 ${avgExitTimeStr} (推定山中滞在: ${avgDurationStr})
・入山集中日TOP5:
${top5DaysText}

【第2の柱：安全・リスク解析データ（遅発入山・遅延下山・夜間・荒天）】
・遅発入山 (10:30〜14:00・フェリー午前便到着後など): 計 ${lateEnterTotal}人 (全入山の ${lateEnterRatio}%)
・遅延下山 (17:00〜23:59): 計 ${lateExitTotal}人 (全下山の ${lateExitRatio}%)、うち日没時刻以降の下山: ${afterSunsetExitTotal}人
・深夜・未明入山 (21:00〜00:59): 計 ${midnightEnterTotal}人
・大雨(30mm以上)/強風(15m/s以上)ハザード日: ${hazardDaysCount}日発生 (ハザード日の強行入山合計: ${hazardDaysEnterTotal}人)
・遅延下山が多発した特異日TOP5と原因分類（スタート遅れ型 vs 山中停滞・バテ・悪天型）:
${lateExitText}

【第3の柱：気象庁アメダス実測 × 全方位7時間帯AIカメラ解析データ】
・島の晴天日数: ${baseSunnyDays}日 / ${daysCount}日 (${baseSunnyRate}%)
・好天（降水2mm以下・風12.5m/s以下・山頂ガスなし）日数: ${goodWeatherDaysCount}日
・AIカメラ山頂視界内訳 (解析済 ${camAnalyzedDays}日分): 山頂快晴(Clear) ${summitClearDays}日 / 山頂雲隠れ(Cloudy) ${summitCloudyDays}日 / 山体ガス不可視(Foggy) ${summitFoggyDays}日
・麓は晴れだが山頂がガスだったギャップ日数: ${sunnyBaseButFoggySummitDays}日
・朝(5〜9時)は山頂快晴で午後(11〜15時)にガスへ急変した警戒日: ${morningClearAfternoonBadDays.length > 0 ? morningClearAfternoonBadDays.join(', ') : '該当なし'}
・【提案A】時間帯別「山頂視界ゴールデンタイム」推移 (午前05-09時平均快晴率: ${morningSummitClearRate}% vs 午後13-15時平均快晴率: ${afternoonSummitClearRate}%):
${goldenTimeText || '  ・カメラ解析データ未集計'}
・【提案C】アメダス風向別 × 多方向カメラ（北:鴛泊・鴛泊港 / 北東:姫沼 / 西:沓形 / 南東:オタドマリ沼 / 南:仙法志）山頂視界非対称データ:
${windAsymmetryText || '  ・カメラ解析データ未集計'}

【第4の柱：週別推移 ＆ コアシーズン(6/20〜9/30)誘客チャンス喪失日データ】
・週別の天候勝率 × 集客効率 × リスク推移:
${weeklyText}
・コアシーズン(6/20〜9/30)における「誘客チャンス喪失日（好天×少人数）」リスト（うち山頂快晴の👑特A級穴場日: ${superPrimeOpportunityCount}日）:
${oppLossText}
`.trim();

  return {
    periodLabel,
    courseName,
    totalEnter,
    daysCount,
    avgEnter,
    weekdayAvgEnter,
    holidayAvgEnter,
    top5ConcentrationRatio,
    oshidomariEnter,
    kutsugataEnter,
    avgEnterTimeStr,
    avgExitTimeStr,
    avgDurationStr,
    avgDurationMinutes,
    lateEnterTotal,
    lateEnterRatio,
    lateExitTotal,
    lateExitRatio,
    afterSunsetExitTotal,
    midnightEnterTotal,
    hazardDaysEnterTotal,
    hazardDaysCount,
    topLateExitDays,
    topLateEnterDays,
    baseSunnyDays,
    baseSunnyRate,
    camAnalyzedDays,
    summitClearDays,
    summitCloudyDays,
    summitFoggyDays,
    sunnyBaseButFoggySummitDays,
    morningClearAfternoonBadDays,
    hourlyCameraGoldenTime,
    morningSummitClearRate,
    afternoonSummitClearRate,
    cameraDirectionTotals,
    windDirectionCameraStats,
    goodWeatherDaysCount,
    superPrimeOpportunityCount,
    opportunityLossDays,
    weeklyStats,
    bestPromoWeek,
    highestRiskWeek,
    promptSummaryText,
  };
}

export function getAIReportCacheKey(year: string, month: number | null, course: string = 'all'): string {
  return `tozan_ai_report_v2_${year}_${month ?? 'season'}_${course}`;
}

export function getCachedAIReport(
  year: string,
  month: number | null,
  course: string = 'all'
): { report: string; createdAt: string; modelUsed: string; notes: string } | null {
  try {
    const raw = localStorage.getItem(getAIReportCacheKey(year, month, course));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveCachedAIReport(
  year: string,
  month: number | null,
  course: string = 'all',
  payload: { report: string; createdAt: string; modelUsed: string; notes: string }
) {
  try {
    localStorage.setItem(getAIReportCacheKey(year, month, course), JSON.stringify(payload));
  } catch (e) {
    console.warn('AIレポートのキャッシュ保存に失敗しました:', e);
  }
}

export async function generateMonthlyAnalysis(
  data: AIAnalysisRequest
): Promise<{ report: string; modelUsed: string; factSheet: PeriodFactSheet }> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('VITE_GEMINI_API_KEY が設定されていません。環境変数 (.env) を確認してください。');
  }

  const ai = new GoogleGenAI({ apiKey });
  const factSheet = buildPeriodFactSheet(data);

  const prompt = `
あなたは北海道・利尻山（利尻礼文サロベツ国立公園）の山岳管理・観光誘客・気象視界分析・遭難防止対策を統括するプロフェッショナル・チーフデータアナリストです。
以下の「システム自動集計ファクトシート（4大解析ピラー）」と「管理者からの補足メモ」に基づき、自治体・環境省・観光協会・山岳遭難対策協議会・ガイド・宿泊事業者がそのまま意思決定・会議資料として使える水準の【総合解析レポート】を作成してください。
（※対象期間が10月〜5月の秋冬春期で登山カウンター数値が0人の場合は、第3の柱である「気象庁アメダス実測×多方向ライブカメラAI雲量・山頂視界の季節特性・風向別非対称性・冬山/観光展望の傾向分析」を中心に詳しく論じてください。）

${factSheet.promptSummaryText}

■ 管理者からの補足情報 (ローカルな特記事項など):
${data.notes || '特記事項なし'}

【レポートの構成指示（必ず以下の4章構成で、具体的な日付・週・人数・%を引用して論理的に記述してください）】

## 1. 📊 事実ベースの動態・期間総括（Fact-Based Summary）
- 対象期間の利用動態（またはオフシーズン・冬期の気象観測条件）を総括してください。

## 2. ⚠️ 安全・遭難リスク＆気象ハザード解析
- 遅発入山・遅延下山（カウンター稼働期）および大雨・暴風ハザード日の発生実態とリスクを分析してください。

## 3. 🌤️ 気象 × 全方位7時間帯AIカメラ視界（ゴールデンタイム＆風向非対称）解析
- **麓と山頂の視界ギャップ**: 「島の晴天率」と「AIカメラによる山頂快晴率・ガス率」のギャップを解説してください。
- **時間帯別「山頂視界ゴールデンタイム」曲線**: 朝（05〜09時）と午後（13〜15時）の山頂快晴率・雲量の推移から見える視界変化の特徴を論じてください。
- **風向×全方位カメラ（北:鴛泊・鴛泊港 / 北東:姫沼 / 西:沓形 / 南東:オタドマリ沼 / 南:仙法志）の非対称性**: 風向によってどの方角・展望地から利尻山が晴れやすく、どこに雲がかかりやすいかの特徴と、登山コース選択や島内周遊・観光案内への活用法を解説してください。

## 4. 🎯 次年度・次期へ向けた戦略提言（誘客・展望案内・安全対策）
- 抽出されたデータに基づき、来年度の誘客・観光展望ガイド・安全管理に向けた具体的なアクションプランを提言してください。

出力はMarkdown形式で、見出し・太字・箇条書き・引用ブロック（> ）を効果的に使い、プロフェッショナルで読みやすい構成にしてください。
`.trim();

  let lastError: any = null;

  for (const modelName of REPORT_MODELS) {
    try {
      const config: any = {
        temperature: 0.4,
      };
      if (data.useWebSearch) {
        config.tools = [{ googleSearch: {} }];
      }

      const response = await ai.models.generateContent({
        model: modelName,
        contents: prompt,
        config,
      });

      const reportText = response.text || '解析結果を生成できませんでした。';

      saveCachedAIReport(data.year, data.month, data.selectedCourse || 'all', {
        report: reportText,
        createdAt: new Date().toLocaleString('ja-JP'),
        modelUsed: modelName,
        notes: data.notes,
      });

      return {
        report: reportText,
        modelUsed: modelName,
        factSheet,
      };
    } catch (error: any) {
      console.warn(`[AI Report] モデル ${modelName} でエラーが発生しました。予備モデルへフォールバックします:`, error);
      lastError = error;
    }
  }

  console.error('AI Analysis Error (All models failed):', lastError);
  throw new Error(
    'すべてのAIモデルで解析上限または通信エラーが発生しました。しばらく待ってから再試行してください。'
  );
}
