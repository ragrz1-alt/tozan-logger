import { GoogleGenAI } from '@google/genai';
import { format, parseISO, subDays } from 'date-fns';
import { ja } from 'date-fns/locale';
// @ts-ignore
import * as JapaneseHolidays from 'japanese-holidays';
import { isEntryEnter, type LogEntry } from './logParser';
import { getWeatherCategory, getWeatherDescription, type WeatherData } from './weatherApi';
import { evaluateDailyCameraVisibility, type ImageAnalysis } from '../hooks/useCameraAnalysis';

export interface AIAnalysisRequest {
  year: string;
  month: number | null; // null の場合はシーズン通期 (6月〜9月)
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
  prevDateWeatherText: string;
  prevRain: number;
  prevWind: number;
  causeBadge: '🚢 前日荒天・交通影響疑い' | '🏖️ 連休前後・反動減' | '📅 オフピーク・誘客穴場日';
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
  // 誘客チャンス喪失・週別効率
  goodWeatherDaysCount: number;
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
 * 対象期間（特定月 または シーズン通期）の「4大解析ピラー」ファクトシートを決定論的に計算するエンジン
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

  const periodPrefix = month !== null ? `${year}-${month.toString().padStart(2, '0')}` : `${year}-`;
  const periodLabel = month !== null ? `${year}年${month}月` : `${year}年 シーズン通期(6〜9月)`;

  // 対象期間のdaily抽出
  const filteredDaily = dailyEntries
    .map(e => ({
      date: e.date || e.dateStr || '',
      enter: e.enter || 0,
      exit: e.exit || 0,
    }))
    .filter(e => {
      if (!e.date) return false;
      if (month !== null) return e.date.startsWith(periodPrefix);
      if (!e.date.startsWith(year)) return false;
      const m = parseInt(e.date.substring(5, 7), 10);
      return m >= 6 && m <= 9;
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  // 対象期間のrawEntries抽出
  const filteredRaw = rawEntries.filter(e => {
    if (month !== null) return e.dateStr.startsWith(periodPrefix);
    if (!e.dateStr.startsWith(year)) return false;
    const m = parseInt(e.dateStr.substring(5, 7), 10);
    return m >= 6 && m <= 9;
  });

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
      // 4時〜18時の通常行動帯で平均時刻を算出（深夜異常値で平均が歪むのを防ぐ）
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
  const avgEnterTimeStr = formatHourFloat(avgEnterHour);
  const avgExitTimeStr = formatHourFloat(avgExitHour);
  const avgDurationMinutes =
    avgExitHour > avgEnterHour ? Math.round((avgExitHour - avgEnterHour) * 60) : 510;
  const avgDurationStr = `約${Math.floor(avgDurationMinutes / 60)}時間${avgDurationMinutes % 60}分`;

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

  // 遅延下山（17時以降）TOP8 ＆ 原因自動分類（スタート遅れ型 vs 山中停滞・バテ・悪天型）
  const topLateExitDays: LateExitRiskDay[] = Object.entries(dayRawStats)
    .filter(([, st]) => st.lateExit > 0)
    .map(([date, st]) => {
      const w = weatherData[date];
      const wDesc = w ? getWeatherDescription(w.weatherCode, w.precipitation, w.sunshineDuration, date, cameraAnalysis[date]) : null;
      const dayAvgEnter = st.enterCount > 0 ? st.enterHourSum / st.enterCount : avgEnterHour;
      const dayAvgExit = st.exitCount > 0 ? st.exitHourSum / st.exitCount : avgExitHour;
      const durMin = dayAvgExit > dayAvgEnter ? Math.round((dayAvgExit - dayAvgEnter) * 60) : avgDurationMinutes;
      const durStr = `約${Math.floor(durMin / 60)}時間${durMin % 60}分`;
      const ratio = st.exitCount > 0 ? Math.round((st.lateExit / st.exitCount) * 1000) / 10 : 0;

      const isLateStart = st.lateEnter >= Math.max(3, st.lateExit * 0.4) || dayAvgEnter >= avgEnterHour + 0.6;
      const isLongDuration = durMin >= avgDurationMinutes + 40 || (w && (w.precipitation >= 10 || w.windSpeedMax >= 13));

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
  const opportunityLossDays: OpportunityLossDay[] = [];

  // 週別集計マップ
  const weeklyMap: Record<
    string,
    {
      daysCount: number;
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
    const weekLabel = month !== null ? `第${wNum}週` : `${mNum}月第${wNum}週`;

    if (!weeklyMap[weekLabel]) {
      weeklyMap[weekLabel] = {
        daysCount: 0,
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
    wk.totalEnter += d.enter;
    wk.lateEnter += rawSt.lateEnter;
    wk.lateExit += rawSt.lateExit;
    wk.afterSunsetExit += rawSt.afterSunsetExit;

    // 島の天気カテゴリ（アメダス実測×3方向カメラハイブリッド判定）
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

    // 「登山日和（好天日）」の定義:
    // 麓がSunny かつ 降水2mm以下 かつ 風速12.5m/s以下 かつ 山頂がfoggyではない（clearまたはcloudyまたは未解析）
    const isGoodClimbingDay =
      isBaseSunny &&
      (w?.precipitation || 0) <= 2.0 &&
      (w?.windSpeedMax || 0) <= 12.5 &&
      camEval.mountainCategory !== 'foggy';

    if (isGoodClimbingDay) {
      goodWeatherDaysCount++;
      wk.goodWeatherDays++;
      wk.goodWeatherEnterSum += d.enter;

      // 期待入山者数（休日なら休日平均、平日なら平日平均、ただし全体の月平均も考慮）
      const isHol = isHolidayOrWeekend(d.date);
      const expected = isHol ? Math.max(holidayAvgEnter, avgEnter) : Math.max(weekdayAvgEnter, Math.round(avgEnter * 0.85));

      // 登山日和なのに期待値の75%以下（または月平均の70%以下）しか入っていない日を「チャンス喪失日（誘客課題日）」として抽出
      if (expected > 5 && (d.enter <= expected * 0.75 || d.enter <= avgEnter * 0.7)) {
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

        let causeBadge: OpportunityLossDay['causeBadge'] = '📅 オフピーク・誘客穴場日';
        let causeDetail = '前日・当日ともに穏やかな好天。カレンダー上の端境期・平日による純粋な需要ギャップ（来年度の有力な誘客ターゲット日）';

        if (prevRain >= 10.0 || prevWind >= 13.0) {
          causeBadge = '🚢 前日荒天・交通影響疑い';
          causeDetail = `当日は登山日和に回復したが、前日の荒天（降水${prevRain}mm / 最大風速${prevWind}m/s）によるフェリー欠航警戒や前泊キャンセルが影響した可能性大`;
        } else if (isHol) {
          causeBadge = '🏖️ 連休前後・反動減';
          causeDetail = '休日・好天にもかかわらず入山者が伸び悩んだ特異日（連休最終日の移動日や島外イベント競合等の可能性）';
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
          prevDateWeatherText: prevWDesc ? `${prevWDesc.emoji}${prevWDesc.text}` : '不明',
          prevRain,
          prevWind,
          causeBadge,
          causeDetail,
        });
      }
    }
  });

  // チャンス喪失日はギャップが大きい順（達成率が低い順）にソート
  opportunityLossDays.sort((a, b) => a.gapRatio - b.gapRatio || a.enter - b.enter);

  const baseSunnyRate = daysCount > 0 ? Math.round((baseSunnyDays / daysCount) * 100) : 0;

  // 週別統計の整形と「最重点誘客ターゲット週」「最高リスク週」の特定
  const weeklyStats: WeeklyEfficiencyStat[] = Object.entries(weeklyMap).map(([weekLabel, st]) => {
    const goodWeatherRate = st.daysCount > 0 ? Math.round((st.goodWeatherDays / st.daysCount) * 100) : 0;
    const avgEnterPerDay = st.daysCount > 0 ? Math.round(st.totalEnter / st.daysCount) : 0;
    const avgEnterOnGoodWeather =
      st.goodWeatherDays > 0 ? Math.round(st.goodWeatherEnterSum / st.goodWeatherDays) : avgEnterPerDay;
    const sunsetInfo = getSunsetHourForDate(st.sampleDate);

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
    };
  });

  // 好天日が2日以上あり、かつ好天時の平均入山者数が最も少ない週を「来年度の最重点誘客ターゲット週」とする
  let bestPromoWeek: string | null = null;
  const promoCandidates = weeklyStats.filter(w => w.goodWeatherDays >= 2);
  if (promoCandidates.length > 0) {
    promoCandidates.sort((a, b) => a.avgEnterOnGoodWeather - b.avgEnterOnGoodWeather);
    bestPromoWeek = promoCandidates[0].weekLabel;
    const targetObj = weeklyStats.find(w => w.weekLabel === bestPromoWeek);
    if (targetObj) targetObj.isTargetPromoWeek = true;
  }

  // 遅延下山＋遅発入山が最も多い週を「最高リスク週」とする
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
    .slice(0, 5)
    .map((d, idx) => {
      const w = weatherData[d.date];
      const wDesc = w ? getWeatherDescription(w.weatherCode, w.precipitation, w.sunshineDuration, d.date) : null;
      return `  ${idx + 1}位: ${format(parseISO(d.date), 'M/d(E)', { locale: ja })} ${d.enter}人 (${wDesc ? wDesc.text : '不明'})`;
    })
    .join('\n');

  const oppLossText =
    opportunityLossDays.length > 0
      ? opportunityLossDays
          .slice(0, 6)
          .map(
            o =>
              `  ・${o.displayDate}[${o.dayType}]: 入山${o.enter}人 (期待値${o.expectedEnter}人の${o.gapRatio}%) | 当日:${o.weatherText}(最高${o.tempMax}℃, 風${o.windSpeed}m/s, 山頂視界:${o.mountainCategory}) | 前日:${o.prevDateWeatherText}(降水${o.prevRain}mm, 風${o.prevWind}m/s) ➔ 判定:${o.causeBadge} (${o.causeDetail})`
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
        `  ・${w.weekLabel} (日没${w.sunsetApprox}): 計${w.totalEnter}人 (日平均${w.avgEnterPerDay}人) | 登山日和${w.goodWeatherDays}/${w.daysCount}日(晴天率${w.goodWeatherRate}%, 好天日平均${w.avgEnterOnGoodWeather}人) | 遅発入山(10:30-14:00):${w.lateEnterCount}人, 遅延下山(17時以降):${w.lateExitCount}人(日没後${w.afterSunsetExitCount}人)${w.isTargetPromoWeek ? ' ★来年度誘客ターゲット候補週' : ''}`
    )
    .join('\n');

  const promptSummaryText = `
【対象期間・コース】: ${periodLabel} / ${courseName}

【第1の柱：事実ベースの動態データ】
・総入山者数: ${totalEnter}人 (${prevText})
・計測日数: ${daysCount}日間 / 1日平均: ${avgEnter}人 (休日・祝日・お盆平均: ${holidayAvgEnter}人 vs 平日平均: ${weekdayAvgEnter}人)
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

【第3の柱：気象 × 山頂AIカメラ雲量・視界解析データ】
・麓の晴天日数: ${baseSunnyDays}日 / ${daysCount}日 (${baseSunnyRate}%)
・登山日和（降水2mm以下・風12.5m/s以下・山頂ガスなし）日数: ${goodWeatherDaysCount}日
・AIカメラ山頂視界内訳 (解析済 ${camAnalyzedDays}日分): 山頂快晴(Clear) ${summitClearDays}日 / 山頂雲隠れ(Cloudy) ${summitCloudyDays}日 / 山体ガス不可視(Foggy) ${summitFoggyDays}日
・麓は晴れだが山頂がガスだったギャップ日数: ${sunnyBaseButFoggySummitDays}日
・朝(5時・8時)は山頂快晴で午後(11時・14時)にガスへ急変した警戒日: ${morningClearAfternoonBadDays.length > 0 ? morningClearAfternoonBadDays.join(', ') : '該当なし'}

【第4の柱：週別推移 ＆ 誘客チャンス喪失日（好天×少人数）データ】
・週別の天候勝率 × 集客効率 × リスク推移:
${weeklyText}
・登山日和（好天）だったのに人が少なかった「誘客チャンス喪失日（穴場日）」リスト（前日天候ラグ判定付き）:
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
    goodWeatherDaysCount,
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
あなたは北海道・利尻山（利尻礼文サロベツ国立公園）の山岳管理・観光誘客・遭難防止対策を統括するプロフェッショナル・チーフデータアナリストです。
以下の「システム自動集計ファクトシート（4大解析ピラー）」と「管理者からの補足メモ」に基づき、自治体・環境省・観光協会・山岳遭難対策協議会・ガイド・宿泊事業者がそのまま意思決定・会議資料として使える水準の【総合解析レポート】を作成してください。

${factSheet.promptSummaryText}

■ 管理者からの補足情報 (ローカルな特記事項など):
${data.notes || '特記事項なし'}

【レポートの構成指示（必ず以下の4章構成で、具体的な日付・週・人数・%を引用して論理的に記述してください）】

## 1. 📊 事実ベースの動態総括（Fact-Based Summary）
- 総入山者数・前年同期比の結論と、平日vs休日差、コース分担（鴛泊・沓形）、上位5日集中率から見える今期の利用構造を端的に総括してください。

## 2. ⚠️ 安全・遭難リスク解析（遅発入山・遅延下山・夜間・荒天強行）
- **遅発入山（10:30〜14:00）の傾向**: 発生規模（人数・%）や多発日の特徴（フェリー到着便連動や天候回復待ちの駆け込み入山など）を分析してください。
- **遅延下山（17時以降・日没後）の原因切り分けと週次トレンド**:
  - 単なる件数ではなく、データにある**「🚢 スタート遅れ型（入山自体が遅い）」**と**「🥾 山中停滞・バテ・悪天型（朝早く登ったのに行動時間が長引いた危険日）」**の違いを具体的な日付を挙げて解説してください。
  - また、週が進むにつれて（特に8月後半〜9月の日没早期化に伴い）遅い下山や日没後下山がどう変化しているか警告してください。
- **荒天強行・深夜未明入山**: ハザード日や深夜帯の入山実態とリスクを指摘してください。

## 3. 🌤️ 気象 × 山頂視界（雲量）のミクロ・マクロ解析
- 「麓の晴天率」と「AIカメラによる山頂快晴率・ガス率」のギャップ（麓は晴れだが山頂はガスだった日や、朝晴れて昼から崩れた日）が登山者の行動やリスクにどう影響したか解説してください。

## 4. 🎯 次年度へ向けた戦略提言（誘客チャンス喪失日の攻略 ＆ 安全対策重点カレンダー）
- **【誘客戦略：好天なのに少なかった「チャンス喪失日・課題週」の分析】**:
  - 抽出された「チャンス喪失日（登山日和なのに期待値を下回った日）」と「週別の晴天率×集客効率」をもとに、**①前日荒天（フェリー欠航・足止めラグ）が原因だった日**と、**②純粋なカレンダー上の穴場週・平日ギャップだった日**を切り分けて解説してください。
  - その上で、「来年度のどの週・どの曜日に、どのようなターゲット層（道内リピーター、シニア・平日休暇層、島内滞留客など）へどんな誘客施策・キャンペーンを打つべきか」を具体的に提案してください。
- **【安全管理戦略：来年度の重点パトロール・声かけ時期】**:
  - 来年度の同期間において、いつ・どの時間帯にどのような安全対策（登山口での声かけ、フェリー・宿での早出啓発、ヘッドランプ確認など）を強化すべきか提言してください。

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
