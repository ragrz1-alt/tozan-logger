import React, { useState, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend, ReferenceArea, ReferenceLine
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
  ShieldAlert,
  Info,
  Calendar,
  Sun
} from 'lucide-react';
import { isEntryEnter, type LogEntry } from '../utils/logParser';
import { getWeatherDescription, type WeatherData } from '../utils/weatherApi';

interface StakeholderAnalyticsProps {
  entries: LogEntry[];
  weatherData: Record<string, WeatherData>;
  availableYears?: string[];
  onSelectDate?: (dateStr: string) => void;
}

const getSunlightZone = (timeframe: string, monthKey: string, weekLabel: string) => {
  if (timeframe === 'weekly') {
    switch (weekLabel) {
      case '6月1週目':
      case '6月2週目': return {
        sunriseX: '03:00', sunsetX: '19:00',
        sunriseText: '03:48頃', sunsetText: '19:18頃',
        desc: '6月前半：利尻島における最長日照シーズン（03時台後半から行動可能 / 19時台まで明帯）'
      };
      case '6月3週目':
      case '6月4週目':
      case '6月5週目': return {
        sunriseX: '03:00', sunsetX: '19:00',
        sunriseText: '03:52頃', sunsetText: '19:22頃',
        desc: '夏至期：1年のうち最も日出が早く日没が遅い週（極めて長い安全行動時間帯）'
      };
      case '7月1週目': return {
        sunriseX: '03:00', sunsetX: '19:00',
        sunriseText: '04:03頃', sunsetText: '19:18頃',
        desc: '7月1週目：夏至直後・04時台前半に日の出を迎える長期日照帯'
      };
      case '7月2週目': return {
        sunriseX: '03:00', sunsetX: '19:00',
        sunriseText: '04:08頃', sunsetText: '19:15頃',
        desc: '7月2週目：盛夏シーズン開幕（4時10分頃日の出 / 19時過ぎまで明るい）'
      };
      case '7月3週目': return {
        sunriseX: '03:00', sunsetX: '19:00',
        sunriseText: '04:14頃', sunsetText: '19:10頃',
        desc: '7月3週目：海の日連休シーズン（4時半以降の早朝入山に最適な日照条件）'
      };
      case '7月4週目': return {
        sunriseX: '03:00', sunsetX: '19:00',
        sunriseText: '04:21頃', sunsetText: '19:03頃',
        desc: '7月4週目：夏の最盛期（04時台から夜明け・19時台より暗闇危険帯へ移行）'
      };
      case '7月5週目': return {
        sunriseX: '03:00', sunsetX: '19:00',
        sunriseText: '04:28頃', sunsetText: '18:55頃',
        desc: '7月最終週：日没が19時前にシフト開始（18時台後半での下山完了が必須）'
      };
      case '8月1週目': return {
        sunriseX: '03:00', sunsetX: '18:00',
        sunriseText: '04:35頃', sunsetText: '18:46頃',
        desc: '8月1週目：盛夏から後半へ（4時台後半に日出 / 18時45分頃日没）'
      };
      case '8月2週目': return {
        sunriseX: '03:00', sunsetX: '18:00',
        sunriseText: '04:43頃', sunsetText: '18:36頃',
        desc: '8月2週目：お盆ピーク期（日の出が4時台後半となり早朝行動の遅れに注意）'
      };
      case '8月3週目': return {
        sunriseX: '03:00', sunsetX: '18:00',
        sunriseText: '04:51頃', sunsetText: '18:24頃',
        desc: '8月3週目：日照時間の明確な短縮期（18時半前から薄闇化）'
      };
      case '8月4週目':
      case '8月5週目': return {
        sunriseX: '04:00', sunsetX: '18:00',
        sunriseText: '04:58頃', sunsetText: '18:12頃',
        desc: '8月下旬：日の出がほぼ5時に接近・日没は18時台前半に急変'
      };
      case '9月1週目': return {
        sunriseX: '04:00', sunsetX: '18:00',
        sunriseText: '05:06頃', sunsetText: '17:58頃',
        desc: '9月1週目：秋山シーズン移行期（日出5時台 / 日没は18時を下回る）'
      };
      case '9月2週目': return {
        sunriseX: '04:00', sunsetX: '17:00',
        sunriseText: '05:14頃', sunsetText: '17:45頃',
        desc: '9月2週目：早日没の警戒週（17時台後半から完全に日没後暗闇帯）'
      };
      case '9月3週目': return {
        sunriseX: '04:00', sunsetX: '17:00',
        sunriseText: '05:22頃', sunsetText: '17:31頃',
        desc: '9月3週目：秋の連休期（17時半以降の下山はヘッドランプ必須）'
      };
      case '9月4週目':
      case '9月5週目': return {
        sunriseX: '04:00', sunsetX: '17:00',
        sunriseText: '05:30頃', sunsetText: '17:16頃',
        desc: '9月下旬：シーズン最短日照期（日出5時半〜日没17時15分頃の短い安全行動帯）'
      };
    }
  }

  if (timeframe === 'monthly') {
    if (monthKey === '06') return {
      sunriseX: '03:00', sunsetX: '19:00',
      sunriseText: '03:50頃', sunsetText: '19:20頃',
      desc: '6月集計：夏至期・1年の中で最も行動可能時間が長いシーズン'
    };
    if (monthKey === '07') return {
      sunriseX: '03:00', sunsetX: '19:00',
      sunriseText: '04:15頃', sunsetText: '19:10頃',
      desc: '7月集計：盛夏期・4時台の早朝行動に最適な長い日照帯'
    };
    if (monthKey === '08') return {
      sunriseX: '03:00', sunsetX: '18:00',
      sunriseText: '04:45頃', sunsetText: '18:35頃',
      desc: '8月集計：お盆・夏後半（日出が遅くなり日没が18時台半ばへと早まる移行月）'
    };
    if (monthKey === '09') return {
      sunriseX: '04:00', sunsetX: '17:00',
      sunriseText: '05:18頃', sunsetText: '17:40頃',
      desc: '9月集計：初秋期・日没が急速に早まるため17時半以降の暗闇下山遅延に最大警戒'
    };
  }

  return {
    sunriseX: '03:00', sunsetX: '18:00',
    sunriseText: '04:25頃', sunsetText: '18:40頃',
    desc: '通期平均：標準日照帯（04:25頃 日出 / 18:40頃 日没）'
  };
};

type TabType = 'peak' | 'late' | 'night';

export const StakeholderAnalytics: React.FC<StakeholderAnalyticsProps> = ({
  entries,
  weatherData,
  availableYears = [],
  onSelectDate
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('peak');
  const [peakSubTab, setPeakSubTab] = useState<'topDays' | 'hourly' | 'hazard'>('topDays');
  const [hourlyTimeframe, setHourlyTimeframe] = useState<'all' | 'monthly' | 'weekly'>('all');
  const [selectedMonthKey, setSelectedMonthKey] = useState<string>('07');
  const [selectedWeekLabel, setSelectedWeekLabel] = useState<string>('7月1週目');
  const [targetCourse, setTargetCourse] = useState<'all' | 'oshidomari' | 'kutsugata'>('all');
  const [targetYear, setTargetYear] = useState<string>('all');

  // コース・年度でフィルタリングしたログ
  const filteredEntries = useMemo(() => {
    return entries.filter(e => {
      // コースフィルター
      if (targetCourse === 'oshidomari') {
        const c = e.course || 'oshidomari';
        if (c !== 'oshidomari') return false;
      } else if (targetCourse === 'kutsugata') {
        if (e.course !== 'kutsugata') return false;
      }
      // 年度フィルター
      if (targetYear !== 'all') {
        if (!e.dateStr.startsWith(targetYear)) return false;
      }
      // 登山シーズンフィルター (5月は維持管理等のため除外、10月はオフシーズンのため除外し、6月〜9月の4ヶ月のみ対象)
      const monthNum = parseInt(e.dateStr.substring(5, 7), 10);
      if (monthNum < 6 || monthNum > 9) return false;

      return true;
    });
  }, [entries, targetCourse, targetYear]);

  // コース名表示
  const courseName = targetCourse === 'oshidomari' 
    ? '鴛泊コース' 
    : targetCourse === 'kutsugata' 
    ? '沓形コース' 
    : '利尻山 全体合算';

  // ==================== 1. 負荷のピーク分析 ====================
  const peakAnalytics = useMemo(() => {
    const dailyMap: Record<string, { date: string; enter: number; exit: number; total: number }> = {};
    const hourlyEnterMap: Record<number, number> = {};
    const hourlyExitMap: Record<number, number> = {};
    const summerEnterMap: Record<number, number> = {};
    const summerExitMap: Record<number, number> = {};
    const autumnEnterMap: Record<number, number> = {};
    const autumnExitMap: Record<number, number> = {};
    const monthlyEnterMap: Record<string, Record<number, number>> = { '06': {}, '07': {}, '08': {}, '09': {} };
    const monthlyExitMap: Record<string, Record<number, number>> = { '06': {}, '07': {}, '08': {}, '09': {} };
    const weeklyEnterMap: Record<string, Record<number, number>> = {};
    const weeklyExitMap: Record<string, Record<number, number>> = {};
    const weekLabels: string[] = [];

    [6, 7, 8, 9].forEach(m => {
      for (let w = 1; w <= 5; w++) {
        const label = `${m}月${w}週目`;
        weekLabels.push(label);
        weeklyEnterMap[label] = {};
        weeklyExitMap[label] = {};
        for (let h = 0; h < 24; h++) {
          weeklyEnterMap[label][h] = 0;
          weeklyExitMap[label][h] = 0;
        }
      }
    });

    for (let h = 0; h < 24; h++) {
      hourlyEnterMap[h] = 0;
      hourlyExitMap[h] = 0;
      summerEnterMap[h] = 0;
      summerExitMap[h] = 0;
      autumnEnterMap[h] = 0;
      autumnExitMap[h] = 0;
      ['06', '07', '08', '09'].forEach(m => {
        monthlyEnterMap[m][h] = 0;
        monthlyExitMap[m][h] = 0;
      });
    }

    filteredEntries.forEach(entry => {
      const isEnter = isEntryEnter(entry);
      const monthStr = entry.dateStr.substring(5, 7);
      const isSummer = monthStr === '07' || monthStr === '08';
      const isAutumn = monthStr === '09';
      const mNum = parseInt(entry.dateStr.substring(5, 7), 10);
      const dNum = parseInt(entry.dateStr.substring(8, 10), 10);
      const wNum = Math.ceil(dNum / 7);
      const weekLabel = `${mNum}月${Math.min(wNum, 5)}週目`;

      if (!dailyMap[entry.dateStr]) {
        dailyMap[entry.dateStr] = { date: entry.dateStr, enter: 0, exit: 0, total: 0 };
      }
      if (isEnter) {
        dailyMap[entry.dateStr].enter++;
        dailyMap[entry.dateStr].total++;
        hourlyEnterMap[entry.hour] = (hourlyEnterMap[entry.hour] || 0) + 1;
        if (isSummer) summerEnterMap[entry.hour] = (summerEnterMap[entry.hour] || 0) + 1;
        if (isAutumn) autumnEnterMap[entry.hour] = (autumnEnterMap[entry.hour] || 0) + 1;
        if (monthlyEnterMap[monthStr]) {
          monthlyEnterMap[monthStr][entry.hour] = (monthlyEnterMap[monthStr][entry.hour] || 0) + 1;
        }
        if (weeklyEnterMap[weekLabel]) {
          weeklyEnterMap[weekLabel][entry.hour] = (weeklyEnterMap[weekLabel][entry.hour] || 0) + 1;
        }
      } else {
        dailyMap[entry.dateStr].exit++;
        dailyMap[entry.dateStr].total++;
        hourlyExitMap[entry.hour] = (hourlyExitMap[entry.hour] || 0) + 1;
        if (isSummer) summerExitMap[entry.hour] = (summerExitMap[entry.hour] || 0) + 1;
        if (isAutumn) autumnExitMap[entry.hour] = (autumnExitMap[entry.hour] || 0) + 1;
        if (monthlyExitMap[monthStr]) {
          monthlyExitMap[monthStr][entry.hour] = (monthlyExitMap[monthStr][entry.hour] || 0) + 1;
        }
        if (weeklyExitMap[weekLabel]) {
          weeklyExitMap[weekLabel][entry.hour] = (weeklyExitMap[weekLabel][entry.hour] || 0) + 1;
        }
      }
    });

    const dailyList = Object.values(dailyMap);
    // 1. 利用集中日 (Top 10 by Enter Traffic)
    const topDays = [...dailyList].sort((a, b) => b.enter - a.enter).slice(0, 10);

    // 2. 利用が集中する時間帯
    let totalEnterClimbers = 0;
    let totalExitClimbers = 0;
    let maxEnterHour = 0;
    let maxEnterCount = -1;
    let maxExitHour = 0;
    let maxExitCount = -1;

    let morningEnterCount = 0; // 05:00〜08:59
    let afternoonExitCount = 0; // 11:00〜15:59

    const hourlyChartData = Object.keys(hourlyEnterMap).map(hStr => {
      const h = parseInt(hStr, 10);
      const enterCount = hourlyEnterMap[h];
      const exitCount = hourlyExitMap[h];
      const totalCount = enterCount + exitCount;

      totalEnterClimbers += enterCount;
      totalExitClimbers += exitCount;

      if (enterCount > maxEnterCount) {
        maxEnterCount = enterCount;
        maxEnterHour = h;
      }
      if (exitCount > maxExitCount) {
        maxExitCount = exitCount;
        maxExitHour = h;
      }

      if (h >= 5 && h <= 8) morningEnterCount += enterCount;
      if (h >= 11 && h <= 15) afternoonExitCount += exitCount;

      return {
        hourLabel: `${h.toString().padStart(2, '0')}:00`,
        enterCount,
        exitCount,
        totalCount
      };
    });

    const morningEnterRatio = totalEnterClimbers > 0
      ? Math.round((morningEnterCount / totalEnterClimbers) * 1000) / 10
      : 0;
    const afternoonExitRatio = totalExitClimbers > 0
      ? Math.round((afternoonExitCount / totalExitClimbers) * 1000) / 10
      : 0;

    const maxHourlyCount = Math.max(...hourlyChartData.map(d => Math.max(d.enterCount, d.exitCount)), 1);

    const getPeakHour = (map: Record<number, number>) => {
      let maxH = 0;
      let maxC = -1;
      for (let h = 0; h < 24; h++) {
        if ((map[h] || 0) > maxC) {
          maxC = map[h] || 0;
          maxH = h;
        }
      }
      return { hour: maxH, count: maxC };
    };

    const summerPeakEnter = getPeakHour(summerEnterMap);
    const summerPeakExit = getPeakHour(summerExitMap);
    const autumnPeakEnter = getPeakHour(autumnEnterMap);
    const autumnPeakExit = getPeakHour(autumnExitMap);

    const monthlyPeakList = ['06', '07', '08', '09'].map(m => {
      const pEnter = getPeakHour(monthlyEnterMap[m]);
      const pExit = getPeakHour(monthlyExitMap[m]);
      const totalEnter = Object.values(monthlyEnterMap[m]).reduce((a, b) => a + b, 0);
      const totalExit = Object.values(monthlyExitMap[m]).reduce((a, b) => a + b, 0);
      return {
        month: `${parseInt(m, 10)}月`,
        enterHour: pEnter.hour,
        enterCount: pEnter.count,
        exitHour: pExit.hour,
        exitCount: pExit.count,
        totalEnter,
        totalExit
      };
    });

    const buildHourlySummary = (enterMap: Record<number, number>, exitMap: Record<number, number>) => {
      let totEnter = 0;
      let totExit = 0;
      let mEnterC = 0;
      let aExitC = 0;
      let maxEH = 0;
      let maxEC = -1;
      let maxXH = 0;
      let maxXC = -1;
      const chartData = [];

      for (let h = 0; h < 24; h++) {
        const enterCount = enterMap[h] || 0;
        const exitCount = exitMap[h] || 0;
        const totalCount = enterCount + exitCount;
        totEnter += enterCount;
        totExit += exitCount;
        if (enterCount > maxEC) { maxEC = enterCount; maxEH = h; }
        if (exitCount > maxXC) { maxXC = exitCount; maxXH = h; }
        if (h >= 5 && h <= 8) mEnterC += enterCount;
        if (h >= 11 && h <= 15) aExitC += exitCount;
        chartData.push({
          hourLabel: `${h.toString().padStart(2, '0')}:00`,
          enterCount,
          exitCount,
          totalCount
        });
      }

      const morningEnterRatio = totEnter > 0 ? Math.round((mEnterC / totEnter) * 1000) / 10 : 0;
      const afternoonExitRatio = totExit > 0 ? Math.round((aExitC / totExit) * 1000) / 10 : 0;

      return {
        chartData,
        maxEnterHour: maxEH,
        maxEnterCount: maxEC,
        maxExitHour: maxXH,
        maxExitCount: maxXC,
        morningEnterRatio,
        afternoonExitRatio,
        totalEnter: totEnter,
        totalExit: totExit
      };
    };

    const monthlyHourlySummary: Record<string, ReturnType<typeof buildHourlySummary>> = {};
    ['06', '07', '08', '09'].forEach(m => {
      monthlyHourlySummary[m] = buildHourlySummary(monthlyEnterMap[m], monthlyExitMap[m]);
    });

    const weeklyHourlySummary: Record<string, ReturnType<typeof buildHourlySummary>> = {};
    weekLabels.forEach(label => {
      weeklyHourlySummary[label] = buildHourlySummary(weeklyEnterMap[label], weeklyExitMap[label]);
    });

    // 3. 施設に影響が出るぐらいの自然要因が発生した日（大雨 30mm以上 / 災害級 50mm以上 / 強風 15m/s以上）
    // - レベル2 (災害・重大損壊警戒): rain >= 50.0 || wind >= 20.0
    // - レベル1 (施設影響・洗掘注意): rain >= 30.0 || wind >= 15.0
    const hazardDays: Array<{
      date: string;
      enter: number;
      exit: number;
      rain: number;
      wind: number;
      tempMax: number;
      weatherCode: number;
      level: 1 | 2;
      hazardReason: string;
    }> = [];

    let rain30DaysCount = 0;
    let rain30EnterTotal = 0;
    let rainLevel2Count = 0;
    let wind15DaysCount = 0;
    let wind15EnterTotal = 0;
    let windLevel2Count = 0;
    let normalDaysCount = 0;
    let normalEnterTotal = 0;
    let level2Count = 0;

    dailyList.forEach(d => {
      const weather = weatherData[d.date];
      const rain = weather?.precipitation || 0;
      const wind = weather?.windSpeedMax || 0;
      const tempMax = weather?.tempMax || 0;
      const weatherCode = weather?.weatherCode || 0;

      const isRainHazard = rain >= 30.0;
      const isWindHazard = wind >= 15.0;

      if (isRainHazard) {
        rain30DaysCount++;
        rain30EnterTotal += d.enter;
        if (rain >= 50.0) rainLevel2Count++;
      }
      if (isWindHazard) {
        wind15DaysCount++;
        wind15EnterTotal += d.enter;
        if (wind >= 20.0) windLevel2Count++;
      }

      if (!isRainHazard && !isWindHazard) {
        normalDaysCount++;
        normalEnterTotal += d.enter;
      }

      if (isRainHazard || isWindHazard) {
        const level: 1 | 2 = (rain >= 50.0 || wind >= 20.0) ? 2 : 1;
        if (level === 2) level2Count++;
        const reasons: string[] = [];
        if (rain >= 50.0) reasons.push('大雨 50mm超');
        else if (rain >= 30.0) reasons.push('大雨 30mm超');
        if (wind >= 20.0) reasons.push('暴風 20m/s超');
        else if (wind >= 15.0) reasons.push('強風 15m/s超');

        hazardDays.push({
          date: d.date,
          enter: d.enter,
          exit: d.exit,
          rain,
          wind,
          tempMax,
          weatherCode,
          level,
          hazardReason: reasons.join(' / ')
        });
      }
    });

    // 日降水量の大きい順（次いで風速順）にソート
    hazardDays.sort((a, b) => (b.rain - a.rain) || (b.wind - a.wind));

    const rain30Avg = rain30DaysCount > 0 ? Math.round(rain30EnterTotal / rain30DaysCount) : 0;
    const wind15Avg = wind15DaysCount > 0 ? Math.round(wind15EnterTotal / wind15DaysCount) : 0;
    const normalAvg = normalDaysCount > 0 ? Math.round(normalEnterTotal / normalDaysCount) : 0;

    return {
      topDays,
      hourlyChartData,
      maxHourlyCount,
      maxEnterHour,
      maxEnterCount,
      maxExitHour,
      maxExitCount,
      morningEnterRatio,
      afternoonExitRatio,
      hazardDays,
      rain30DaysCount,
      rainLevel2Count,
      rain30Avg,
      wind15DaysCount,
      windLevel2Count,
      wind15Avg,
      normalDaysCount,
      normalAvg,
      level2Count,
      summerPeakEnter,
      summerPeakExit,
      autumnPeakEnter,
      autumnPeakExit,
      monthlyPeakList,
      monthlyHourlySummary,
      weeklyHourlySummary,
      weekLabels
    };
  }, [filteredEntries, weatherData]);

  // ==================== 2. 遅い時間の入山、遅い時間の下山の分析 ====================
  const lateAnalytics = useMemo(() => {
    let totalEnter = 0;
    let lateEnter = 0; // 10:30〜14:00 入山

    // 週別集計用 (6〜9月の 1〜5週目)
    const weeklyLateMap: Record<string, { totalEnter: number; lateEnter: number; lateExit: number }> = {};
    const weekLabels: string[] = [];
    [6, 7, 8, 9].forEach(m => {
      for (let w = 1; w <= 5; w++) {
        const label = `${m}月${w}週目`;
        weekLabels.push(label);
        weeklyLateMap[label] = { totalEnter: 0, lateEnter: 0, lateExit: 0 };
      }
    });

    const lateEnterMap: Record<string, number> = {};
    const lateExitMap: Record<string, number> = {};
    let totalLateExits = 0;

    filteredEntries.forEach(entry => {
      const isEnter = isEntryEnter(entry);
      const parts = entry.timeStr.split(':').map(Number);
      const preciseHour = parts[0] + (parts[1] || 0) / 60;
      const month = parseInt(entry.dateStr.substring(5, 7), 10);
      const day = parseInt(entry.dateStr.substring(8, 10), 10);
      const weekNum = Math.ceil(day / 7);
      const label = `${month}月${Math.min(weekNum, 5)}週目`;

      if (isEnter) {
        totalEnter++;
        if (weeklyLateMap[label]) weeklyLateMap[label].totalEnter++;

        // 10:30〜14:00 入山 (フェリー1便到着や午後スタート層)
        if (preciseHour >= 10.5 && preciseHour < 14.0) {
          lateEnter++;
          if (weeklyLateMap[label]) weeklyLateMap[label].lateEnter++;
          lateEnterMap[entry.dateStr] = (lateEnterMap[entry.dateStr] || 0) + 1;
        }
      } else {
        // 17:00〜23:59 の遅い時間の下山
        if (entry.hour >= 17) {
          totalLateExits++;
          if (weeklyLateMap[label]) weeklyLateMap[label].lateExit++;
          lateExitMap[entry.dateStr] = (lateExitMap[entry.dateStr] || 0) + 1;
        }
      }
    });

    const lateEnterRatio = totalEnter > 0 ? Math.round((lateEnter / totalEnter) * 1000) / 10 : 0;

    const weeklyList = weekLabels.map(label => {
      const stats = weeklyLateMap[label] || { totalEnter: 0, lateEnter: 0, lateExit: 0 };
      return {
        weekLabel: label,
        totalEnter: stats.totalEnter,
        lateEnter: stats.lateEnter,
        lateExit: stats.lateExit
      };
    });

    const topLateEnterDays = Object.entries(lateEnterMap)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const topLateExitDays = Object.entries(lateExitMap)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalEnter,
      lateEnter,
      lateEnterRatio,
      weeklyList,
      totalLateExits,
      topLateEnterDays,
      topLateExitDays
    };
  }, [filteredEntries]);

  // ==================== 3. 8月に限らず、夕方・深夜未明入山者の分析 ====================
  const nightAnalytics = useMemo(() => {
    // 週別集計用 (6〜9月の 1〜5週目)
    const weeklyNightMap: Record<string, number> = {};
    const weekLabels: string[] = [];
    [6, 7, 8, 9].forEach(m => {
      for (let w = 1; w <= 5; w++) {
        const label = `${m}月${w}週目`;
        weekLabels.push(label);
        weeklyNightMap[label] = 0;
      }
    });

    let eveningCount = 0;   // 17:00〜20:59 (参考帯)
    let midnightCount = 0;  // 21:00〜00:59 (主対象：深夜・未明帯)
    const midnightDayMap: Record<string, number> = {};

    const nightLogs: { dateStr: string; timeStr: string; hour: number; course: string; counterId: string }[] = [];

    filteredEntries.forEach(entry => {
      const isEnter = isEntryEnter(entry);
      if (!isEnter) return;

      const isEvening = entry.hour >= 17 && entry.hour < 21;
      const isMidnight = entry.hour >= 21 || entry.hour === 0; // 21:00〜00:59 (3時4時などの一般早出登山者は除く)

      if (isEvening || isMidnight) {
        if (isEvening) {
          eveningCount++;
        } else if (isMidnight) {
          midnightCount++;
          const month = parseInt(entry.dateStr.substring(5, 7), 10);
          const day = parseInt(entry.dateStr.substring(8, 10), 10);
          const weekNum = Math.ceil(day / 7);
          const label = `${month}月${Math.min(weekNum, 5)}週目`;
          if (weeklyNightMap[label] !== undefined) {
            weeklyNightMap[label]++;
          }
          midnightDayMap[entry.dateStr] = (midnightDayMap[entry.dateStr] || 0) + 1;
        }

        nightLogs.push({
          dateStr: entry.dateStr,
          timeStr: entry.timeStr,
          hour: entry.hour,
          course: entry.course === 'kutsugata' ? '沓形' : '鴛泊',
          counterId: entry.counterId
        });
      }
    });

    const weeklyNightList = weekLabels.map(label => ({
      weekLabel: label,
      count: weeklyNightMap[label] || 0
    }));

    // 最多発生週の判定
    let maxWeekLabel = '8月2週目';
    let maxCount = -1;
    weeklyNightList.forEach(w => {
      if (w.count > maxCount) {
        maxCount = w.count;
        maxWeekLabel = w.weekLabel;
      }
    });

    const topMidnightDays = Object.entries(midnightDayMap)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const recentLogs = [...nightLogs].sort((a, b) => {
      if (a.dateStr === b.dateStr) return b.timeStr.localeCompare(a.timeStr);
      return b.dateStr.localeCompare(a.dateStr);
    }).slice(0, 20);

    return {
      totalCount: eveningCount + midnightCount,
      eveningCount,
      midnightCount,
      weeklyNightList,
      maxWeekLabel,
      topMidnightDays,
      recentLogs
    };
  }, [filteredEntries]);

  return (
    <div className="card" style={{ 
      marginTop: '1rem', 
      border: '2px solid var(--accent-primary)', 
      backgroundColor: 'var(--bg-secondary)', 
      overflow: 'hidden',
      borderRadius: '16px'
    }}>
      {/* ===== プレミアム・ヘッダー ＆ インタラクティブ条件セレクター ===== */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.12), rgba(139, 92, 246, 0.15))',
        padding: '1.5rem',
        borderBottom: '1px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '1.25rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
          <div style={{
            width: '46px',
            height: '46px',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, var(--accent-primary), #8b5cf6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            boxShadow: '0 4px 12px rgba(59, 130, 246, 0.35)'
          }}>
            <BarChart3 size={24} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{
                fontSize: '0.78rem',
                fontWeight: 700,
                padding: '0.2rem 0.65rem',
                borderRadius: '999px',
                background: 'var(--accent-primary)',
                color: '#fff'
              }}>
                利尻山 登山道 専用解析
              </span>
              <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                現在の対象: <strong>{courseName}</strong> / {targetYear === 'all' ? '全期間 (累計)' : `${targetYear}年`}
              </span>
            </div>
            <h2 style={{ fontSize: '1.45rem', fontWeight: 800, margin: '0.25rem 0 0 0', color: 'var(--text-primary)' }}>
              利用解析
            </h2>
          </div>
        </div>

        {/* 右側：コース切替 ＆ 年度切替コントロール */}
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '0.75rem'
        }}>
          {/* コース選択 */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            backgroundColor: 'var(--bg-primary)',
            borderRadius: '10px',
            padding: '0.25rem',
            border: '1px solid var(--border-color)'
          }}>
            <button
              onClick={() => setTargetCourse('oshidomari')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                padding: '0.45rem 0.8rem',
                fontSize: '0.82rem',
                fontWeight: 700,
                borderRadius: '7px',
                border: 'none',
                cursor: 'pointer',
                backgroundColor: targetCourse === 'oshidomari' ? '#10b981' : 'transparent',
                color: targetCourse === 'oshidomari' ? '#fff' : 'var(--text-primary)',
                transition: 'all 0.2s ease'
              }}
            >
              <Mountain size={14} />
              <span>鴛泊コース</span>
            </button>
            <button
              onClick={() => setTargetCourse('kutsugata')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                padding: '0.45rem 0.8rem',
                fontSize: '0.82rem',
                fontWeight: 700,
                borderRadius: '7px',
                border: 'none',
                cursor: 'pointer',
                backgroundColor: targetCourse === 'kutsugata' ? '#3b82f6' : 'transparent',
                color: targetCourse === 'kutsugata' ? '#fff' : 'var(--text-primary)',
                transition: 'all 0.2s ease'
              }}
            >
              <Compass size={14} />
              <span>沓形コース</span>
            </button>
            <button
              onClick={() => setTargetCourse('all')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                padding: '0.45rem 0.8rem',
                fontSize: '0.82rem',
                fontWeight: 700,
                borderRadius: '7px',
                border: 'none',
                cursor: 'pointer',
                backgroundColor: targetCourse === 'all' ? '#6366f1' : 'transparent',
                color: targetCourse === 'all' ? '#fff' : 'var(--text-primary)',
                transition: 'all 0.2s ease'
              }}
            >
              <Layers size={14} />
              <span>利尻山 全体合算</span>
            </button>
          </div>

          {/* 年度選択 */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            backgroundColor: 'var(--bg-primary)',
            borderRadius: '10px',
            padding: '0.25rem',
            border: '1px solid var(--border-color)'
          }}>
            <button
              onClick={() => setTargetYear('all')}
              style={{
                padding: '0.45rem 0.75rem',
                fontSize: '0.82rem',
                fontWeight: 700,
                borderRadius: '7px',
                border: 'none',
                cursor: 'pointer',
                backgroundColor: targetYear === 'all' ? 'var(--accent-primary)' : 'transparent',
                color: targetYear === 'all' ? '#fff' : 'var(--text-primary)',
                transition: 'all 0.2s ease'
              }}
            >
              全期間
            </button>
            {availableYears.map(year => (
              <button
                key={year}
                onClick={() => setTargetYear(year)}
                style={{
                  padding: '0.45rem 0.75rem',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  borderRadius: '7px',
                  border: 'none',
                  cursor: 'pointer',
                  backgroundColor: targetYear === year ? 'var(--accent-primary)' : 'transparent',
                  color: targetYear === year ? '#fff' : 'var(--text-primary)',
                  transition: 'all 0.2s ease'
                }}
              >
                {year}年
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ===== 3項目のナビゲーションバー ===== */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        gap: '0.75rem',
        padding: '1rem 1.5rem',
        backgroundColor: 'var(--bg-primary)',
        borderBottom: '1px solid var(--border-color)'
      }}>
        <button
          onClick={() => setActiveTab('peak')}
          className="btn"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
            padding: '0.8rem 1.2rem',
            fontSize: '0.95rem',
            fontWeight: 700,
            borderRadius: '10px',
            border: 'none',
            backgroundColor: activeTab === 'peak' ? 'var(--accent-primary)' : 'transparent',
            color: activeTab === 'peak' ? '#fff' : 'var(--text-primary)',
            boxShadow: activeTab === 'peak' ? '0 4px 12px rgba(59, 130, 246, 0.25)' : 'none',
            cursor: 'pointer',
            transition: 'all 0.2s ease'
          }}
        >
          <TrendingUp size={18} />
          <span>① 負荷のピーク分析</span>
        </button>

        <button
          onClick={() => setActiveTab('late')}
          className="btn"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
            padding: '0.8rem 1.2rem',
            fontSize: '0.95rem',
            fontWeight: 700,
            borderRadius: '10px',
            border: 'none',
            backgroundColor: activeTab === 'late' ? '#3b82f6' : 'transparent',
            color: activeTab === 'late' ? '#fff' : 'var(--text-primary)',
            boxShadow: activeTab === 'late' ? '0 4px 12px rgba(59, 130, 246, 0.25)' : 'none',
            cursor: 'pointer',
            transition: 'all 0.2s ease'
          }}
        >
          <Ship size={18} />
          <span>② 遅い時間の入山・遅い時間の下山</span>
        </button>

        <button
          onClick={() => setActiveTab('night')}
          className="btn"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
            padding: '0.8rem 1.2rem',
            fontSize: '0.95rem',
            fontWeight: 700,
            borderRadius: '10px',
            border: 'none',
            backgroundColor: activeTab === 'night' ? '#f59e0b' : 'transparent',
            color: activeTab === 'night' ? '#fff' : 'var(--text-primary)',
            boxShadow: activeTab === 'night' ? '0 4px 12px rgba(245, 158, 11, 0.3)' : 'none',
            cursor: 'pointer',
            transition: 'all 0.2s ease'
          }}
        >
          <Moon size={18} />
          <span>③ 深夜・未明帯 (21:00〜00:59) の入山分析</span>
        </button>
      </div>

      {/* ===== タブコンテンツ ===== */}
      <div style={{ padding: '1.75rem' }}>
        {/* ==================== ① 負荷のピーク分析 ==================== */}
        {activeTab === 'peak' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <TrendingUp size={24} style={{ color: 'var(--accent-primary)' }} />
              <h3 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                負荷のピーク分析 （利用集中日・集中時間帯・自然要因発生日）
              </h3>
            </div>
            <p style={{ fontSize: '0.92rem', color: 'var(--text-secondary)', marginBottom: '1.75rem', lineHeight: 1.6 }}>
              登山道維持管理および安全登山の観点から最も警戒すべき、「1. 利用集中日」「2. 利用が集中する時間帯」「3. 施設・登山道に影響を与える自然要因発生日（大雨・強風）」の3つの負荷要因を総合解析します。
            </p>

            {/* トップ KPIサマリーカード 4連 */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
              gap: '1.25rem',
              marginBottom: '2.5rem'
            }}>
              <div style={{
                padding: '1.25rem',
                backgroundColor: 'rgba(59, 130, 246, 0.08)',
                borderRadius: '14px',
                border: '1px solid rgba(59, 130, 246, 0.35)',
                boxShadow: 'var(--shadow-sm)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between'
              }}>
                <div style={{ fontSize: '0.85rem', color: 'var(--accent-primary)', fontWeight: 700 }}>
                  🔥 シーズン最高負荷日 (最大集中日)
                </div>
                <div>
                  <div style={{ fontSize: '1.85rem', fontWeight: 800, color: 'var(--accent-primary)', margin: '0.4rem 0 0.35rem 0' }}>
                    {peakAnalytics.topDays[0]?.enter || 0} <span style={{ fontSize: '1rem', fontWeight: 600 }}>人 (IN)</span>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                    日付: {peakAnalytics.topDays[0]?.date || '---'}
                  </div>
                </div>
              </div>



              <div style={{
                padding: '1.25rem',
                backgroundColor: 'rgba(249, 115, 22, 0.08)',
                borderRadius: '14px',
                border: '1px solid rgba(249, 115, 22, 0.35)',
                boxShadow: 'var(--shadow-sm)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between'
              }}>
                <div style={{ fontSize: '0.85rem', color: '#f97316', fontWeight: 700 }}>
                  🌧️ 大雨・洗掘警戒日 (降水30mm以上)
                </div>
                <div>
                  <div style={{ fontSize: '1.85rem', fontWeight: 800, color: '#f97316', margin: '0.4rem 0 0.4rem 0', display: 'flex', alignItems: 'baseline', gap: '0.25rem' }}>
                    <span>{peakAnalytics.rain30DaysCount}</span>
                    <span style={{ fontSize: '1.05rem', fontWeight: 700 }}>日</span>
                  </div>
                  <div style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    padding: '0.25rem 0.65rem',
                    borderRadius: '9999px',
                    backgroundColor: 'rgba(239, 68, 68, 0.12)',
                    color: '#ef4444',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    border: '1px solid rgba(239, 68, 68, 0.3)'
                  }}>
                    <span>🔴 内 {peakAnalytics.rainLevel2Count} 日は災害警戒級</span>
                  </div>
                </div>
              </div>

              <div style={{
                padding: '1.25rem',
                backgroundColor: 'rgba(139, 92, 246, 0.08)',
                borderRadius: '14px',
                border: '1px solid rgba(139, 92, 246, 0.35)',
                boxShadow: 'var(--shadow-sm)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between'
              }}>
                <div style={{ fontSize: '0.85rem', color: '#8b5cf6', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <Wind size={16} />
                  <span>🌪️ 強風・暴風警戒日 (風速15m/s以上)</span>
                </div>
                <div>
                  <div style={{ fontSize: '1.85rem', fontWeight: 800, color: '#8b5cf6', margin: '0.4rem 0 0.4rem 0', display: 'flex', alignItems: 'baseline', gap: '0.25rem' }}>
                    <span>{peakAnalytics.wind15DaysCount}</span>
                    <span style={{ fontSize: '1.05rem', fontWeight: 700 }}>日</span>
                  </div>
                  <div style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    padding: '0.25rem 0.65rem',
                    borderRadius: '9999px',
                    backgroundColor: 'rgba(239, 68, 68, 0.12)',
                    color: '#ef4444',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    border: '1px solid rgba(239, 68, 68, 0.3)'
                  }}>
                    <span>🔴 内 {peakAnalytics.windLevel2Count} 日は災害警戒級</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 負荷のピーク分析：分析モード切り替えサブタブバー */}
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.75rem',
              marginBottom: '2.25rem',
              padding: '0.5rem',
              backgroundColor: 'var(--bg-primary)',
              borderRadius: '12px',
              border: '1px solid var(--border-color)'
            }}>
              <button
                onClick={() => setPeakSubTab('topDays')}
                style={{
                  flex: 1,
                  minWidth: '240px',
                  padding: '0.85rem 1.15rem',
                  borderRadius: '10px',
                  border: 'none',
                  backgroundColor: peakSubTab === 'topDays' ? 'var(--accent-primary)' : 'transparent',
                  color: peakSubTab === 'topDays' ? '#fff' : 'var(--text-primary)',
                  fontWeight: 800,
                  fontSize: '0.9rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  boxShadow: peakSubTab === 'topDays' ? '0 4px 12px rgba(37, 99, 235, 0.25)' : 'none'
                }}
              >
                <Mountain size={18} />
                <span>1. 利用集中日 TOP10 (踏圧・負荷ピーク)</span>
              </button>

              <button
                onClick={() => setPeakSubTab('hazard')}
                style={{
                  flex: 1,
                  minWidth: '240px',
                  padding: '0.85rem 1.15rem',
                  borderRadius: '10px',
                  border: 'none',
                  backgroundColor: peakSubTab === 'hazard' ? '#ef4444' : 'transparent',
                  color: peakSubTab === 'hazard' ? '#fff' : 'var(--text-primary)',
                  fontWeight: 800,
                  fontSize: '0.9rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  boxShadow: peakSubTab === 'hazard' ? '0 4px 12px rgba(239, 68, 68, 0.25)' : 'none'
                }}
              >
                <CloudRain size={18} />
                <span>2. 自然要因警戒 (大雨・強風アナリティクス)</span>
              </button>

              <button
                onClick={() => setPeakSubTab('hourly')}
                style={{
                  flex: 1,
                  minWidth: '240px',
                  padding: '0.85rem 1.15rem',
                  borderRadius: '10px',
                  border: 'none',
                  backgroundColor: peakSubTab === 'hourly' ? '#3b82f6' : 'transparent',
                  color: peakSubTab === 'hourly' ? '#fff' : 'var(--text-primary)',
                  fontWeight: 800,
                  fontSize: '0.9rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  boxShadow: peakSubTab === 'hourly' ? '0 4px 12px rgba(59, 130, 246, 0.25)' : 'none'
                }}
              >
                <Clock size={18} />
                <span>3. 時間帯ピーク分析 (日照・季節シフト解析)</span>
              </button>
            </div>

            {/* ==================== 1. 利用集中日 TOP10 ==================== */}
            {peakSubTab === 'topDays' && (
              <div style={{ marginBottom: '3.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                  <Mountain size={20} style={{ color: 'var(--accent-primary)' }} />
                  <h4 style={{ fontSize: '1.1rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                    1. 利用集中日 TOP10 （登山道踏圧・負荷ピーク日）
                </h4>
              </div>

              <div style={{ overflowX: 'auto', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
                  <thead>
                    <tr style={{ backgroundColor: 'var(--bg-primary)', borderBottom: '2px solid var(--border-color)' }}>
                      <th style={{ padding: '0.85rem 1rem' }}>順位</th>
                      <th style={{ padding: '0.85rem 1rem' }}>日付</th>
                      <th style={{ padding: '0.85rem 1rem' }}>入山者数 (IN)</th>
                      <th style={{ padding: '0.85rem 1rem' }}>下山者数 (OUT)</th>
                      <th style={{ padding: '0.85rem 1rem' }}>天候状況</th>
                      <th style={{ padding: '0.85rem 1rem' }}>最高気温 / 降水量 / 最大風速</th>
                      <th style={{ padding: '0.85rem 1rem' }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {peakAnalytics.topDays.map((d, index) => {
                      const w = weatherData[d.date];
                      const wDesc = w && w.weatherCode !== undefined
                        ? getWeatherDescription(w.weatherCode, w.precipitation, w.sunshineDuration)
                        : null;
                      const isBadWeather = (w?.precipitation || 0) >= 30.0 || (w?.windSpeedMax || 0) >= 15.0;
                      return (
                        <tr key={d.date} style={{ 
                          borderBottom: '1px solid var(--border-color)', 
                          backgroundColor: isBadWeather ? 'rgba(239, 68, 68, 0.05)' : 'transparent' 
                        }}>
                          <td style={{ padding: '0.85rem 1rem', fontWeight: 800, color: index < 3 ? '#f59e0b' : 'var(--text-secondary)' }}>
                            #{index + 1}
                          </td>
                          <td style={{ padding: '0.85rem 1rem', fontWeight: 700 }}>
                            {format(parseISO(d.date), 'yyyy/MM/dd (E)', { locale: ja })}
                            {isBadWeather && (
                              <span style={{
                                marginLeft: '0.5rem',
                                padding: '0.15rem 0.5rem',
                                fontSize: '0.75rem',
                                borderRadius: '4px',
                                backgroundColor: '#ef4444',
                                color: '#fff',
                                fontWeight: 700
                              }}>
                                ⚠️ 荒天負荷日
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '0.85rem 1rem', fontWeight: 800, color: '#3b82f6' }}>
                            {d.enter} 人
                          </td>
                          <td style={{ padding: '0.85rem 1rem', color: '#10b981', fontWeight: 700 }}>
                            {d.exit} 人
                          </td>
                          <td style={{ padding: '0.85rem 1rem' }}>
                            {wDesc ? (
                              <span style={{ fontWeight: 600 }}>{wDesc.emoji} {wDesc.text}</span>
                            ) : (
                              <span style={{ color: 'var(--text-secondary)' }}>未取得</span>
                            )}
                          </td>
                          <td style={{ padding: '0.85rem 1rem', fontSize: '0.85rem' }}>
                            {w ? (
                              <span>
                                {w.tempMax}℃ / <strong>{w.precipitation}mm</strong> / {w.windSpeedMax}m/s
                              </span>
                            ) : '--'}
                          </td>
                          <td style={{ padding: '0.85rem 1rem' }}>
                            {onSelectDate && (
                              <button
                                onClick={() => onSelectDate(d.date)}
                                className="btn"
                                style={{
                                  padding: '0.35rem 0.75rem',
                                  fontSize: '0.8rem',
                                  backgroundColor: 'var(--accent-primary)',
                                  color: '#fff',
                                  border: 'none',
                                  borderRadius: '6px',
                                  cursor: 'pointer',
                                  fontWeight: 600
                                }}
                              >
                                詳細
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            )}

            {/* ==================== 2. 自然要因警戒（大雨・強風アナリティクス） ==================== */}
            {peakSubTab === 'hazard' && (
              <div style={{ marginBottom: '3.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <CloudRain size={20} style={{ color: '#ef4444' }} />
                  <h4 style={{ fontSize: '1.1rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                    2. 登山道に影響を与える自然要因（大雨・強風）発生日 警戒アナリティクス
                  </h4>
                </div>
                <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginBottom: '1.25rem', lineHeight: 1.6 }}>
                  登山道の強い洗掘（土砂流出）や階段ステップ横の雨裂（ガリ）、案内看板・トイレ施設等への負荷が生じる気象要因発生日を抽出します。
                </p>

                {/* 気象工学基準の解説ボックス */}
                <div style={{
                  padding: '1.25rem',
                  backgroundColor: 'var(--bg-primary)',
                  borderRadius: '12px',
                  border: '1px solid var(--border-color)',
                  marginBottom: '1.5rem'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    <Info size={18} style={{ color: 'var(--accent-primary)' }} />
                    <span>【基準解説】登山道に影響を与える自然要因（大雨・強風）の警戒しきい値</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: '1rem', fontSize: '0.85rem', lineHeight: 1.6 }}>
                    <div style={{ padding: '0.85rem', backgroundColor: 'rgba(239, 68, 68, 0.05)', borderRadius: '8px', borderLeft: '4px solid #ef4444' }}>
                      <div style={{ fontWeight: 700, color: '#ef4444', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <ShieldAlert size={16} />
                        <span>🔴 レベル2：災害・重大損壊警戒級 （日降水量 50mm以上 または 風速20m/s以上）</span>
                      </div>
                    </div>

                    <div style={{ padding: '0.85rem', backgroundColor: 'rgba(249, 115, 22, 0.05)', borderRadius: '8px', borderLeft: '4px solid #f97316' }}>
                      <div style={{ fontWeight: 700, color: '#f97316' }}>
                        🟠 レベル1：施設影響・洗掘警戒級 （日降水量 30mm以上 または 風速15m/s以上）
                      </div>
                    </div>
                  </div>
                </div>

                {/* 自然要因警戒日 ランキングテーブル */}
                {peakAnalytics.hazardDays.length === 0 ? (
                  <div style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-secondary)', backgroundColor: 'var(--bg-primary)', borderRadius: '12px' }}>
                    選択された条件の範囲内には、施設・登山道に影響を与える大雨・強風発生日はありません。
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
                      <thead>
                        <tr style={{ backgroundColor: 'var(--bg-primary)', borderBottom: '2px solid var(--border-color)' }}>
                          <th style={{ padding: '0.85rem 1rem' }}>日付</th>
                          <th style={{ padding: '0.85rem 1rem' }}>警戒レベル</th>
                          <th style={{ padding: '0.85rem 1rem' }}>自然要因・種別</th>
                          <th style={{ padding: '0.85rem 1rem' }}>降水量 (mm)</th>
                          <th style={{ padding: '0.85rem 1rem' }}>最大風速 (m/s)</th>
                          <th style={{ padding: '0.85rem 1rem' }}>入山状況 (IN)</th>
                          <th style={{ padding: '0.85rem 1rem' }}>天気</th>
                          <th style={{ padding: '0.85rem 1rem' }}>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {peakAnalytics.hazardDays.map(d => {
                          const w = weatherData[d.date];
                          const wDesc = w && w.weatherCode !== undefined
                            ? getWeatherDescription(w.weatherCode, w.precipitation, w.sunshineDuration)
                            : null;
                          const isLevel2 = d.level === 2;
                          return (
                            <tr key={d.date} style={{
                              borderBottom: '1px solid var(--border-color)',
                              backgroundColor: isLevel2 ? 'rgba(239, 68, 68, 0.08)' : 'rgba(249, 115, 22, 0.04)'
                            }}>
                              <td style={{ padding: '0.85rem 1rem', fontWeight: 700 }}>
                                {format(parseISO(d.date), 'yyyy/MM/dd (E)', { locale: ja })}
                              </td>
                              <td style={{ padding: '0.85rem 1rem' }}>
                                <span style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '0.4rem',
                                  padding: '0.35rem 0.8rem',
                                  fontSize: '0.8rem',
                                  borderRadius: '9999px',
                                  fontWeight: 800,
                                  backgroundColor: isLevel2 ? 'rgba(239, 68, 68, 0.15)' : 'rgba(249, 115, 22, 0.15)',
                                  color: isLevel2 ? '#ef4444' : '#f97316',
                                  border: isLevel2 ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid rgba(249, 115, 22, 0.4)'
                                }}>
                                  {isLevel2 ? '🔴 レベル2 (災害警戒)' : '🟠 レベル1 (施設影響)'}
                                </span>
                              </td>
                              <td style={{ padding: '0.85rem 1rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                                {d.hazardReason}
                              </td>
                              <td style={{ padding: '0.85rem 1rem', fontWeight: 800, color: '#3b82f6' }}>
                                {d.rain} mm
                              </td>
                              <td style={{ padding: '0.85rem 1rem', fontWeight: 800, color: '#8b5cf6' }}>
                                {d.wind} m/s
                              </td>
                              <td style={{ padding: '0.85rem 1rem', fontWeight: 700 }}>
                                {d.enter} 人
                              </td>
                              <td style={{ padding: '0.85rem 1rem' }}>
                                {wDesc ? (
                                  <span>{wDesc.emoji} {wDesc.text}</span>
                                ) : '--'}
                              </td>
                              <td style={{ padding: '0.85rem 1rem' }}>
                                {onSelectDate && (
                                  <button
                                    onClick={() => onSelectDate(d.date)}
                                    className="btn"
                                    style={{
                                      padding: '0.35rem 0.75rem',
                                      fontSize: '0.8rem',
                                      backgroundColor: 'var(--accent-primary)',
                                      color: '#fff',
                                      border: 'none',
                                      borderRadius: '6px',
                                      cursor: 'pointer',
                                      fontWeight: 600
                                    }}
                                  >
                                    詳細
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* ==================== 3. 時間帯ピーク分析 （季節・日照時間に伴う集中時間帯のシフト解析） ==================== */}
            {peakSubTab === 'hourly' && (() => {
              let currentChartData = peakAnalytics.hourlyChartData;
              let mEnterRatio = peakAnalytics.morningEnterRatio;
              let aExitRatio = peakAnalytics.afternoonExitRatio;
              let maxEntH = peakAnalytics.maxEnterHour;
              let maxEntC = peakAnalytics.maxEnterCount;
              let maxExH = peakAnalytics.maxExitHour;
              let maxExC = peakAnalytics.maxExitCount;
              let timeframeLabel = '全シーズン合算 (6月〜9月)';
              let seasonInsight = '6月〜9月の全期間合算データです。標準的には日出からの明るさに伴い 05時台前後に最大入山ピークがあり、午後は 13〜15時台にかけて下山者が集中する標準的な登山タイムラインとなります。';

              if (hourlyTimeframe === 'monthly' && peakAnalytics.monthlyHourlySummary[selectedMonthKey]) {
                const sum = peakAnalytics.monthlyHourlySummary[selectedMonthKey];
                currentChartData = sum.chartData;
                mEnterRatio = sum.morningEnterRatio;
                aExitRatio = sum.afternoonExitRatio;
                maxEntH = sum.maxEnterHour;
                maxEntC = sum.maxEnterCount;
                maxExH = sum.maxExitHour;
                maxExC = sum.maxExitCount;
                const mNum = parseInt(selectedMonthKey, 10);
                timeframeLabel = `${mNum}月 月間集計`;
                if (mNum === 6) {
                  seasonInsight = '【6月：初夏・残雪シーズン】日の長さが最も長い夏至を含む時期ですが、山頂付近の残雪状況によって早期行動する層と慎重にスタートする層が混在します。';
                } else if (mNum === 7 || mNum === 8) {
                  seasonInsight = `【${mNum}月：盛夏期・長日照シーズン】早朝 04:30 前後からの明るさに伴い、05時台前後に最大入山ピークを記録します。日照時間が長いため午後下山も 14〜15時台まで余裕を持って分散する傾向にあります。`;
                } else if (mNum === 9) {
                  seasonInsight = '【9月：初秋期・短日照シーズン】日出が遅くなるため入山のピーク立ち上がりが夏場より遅れる一方、17時台には急速に暗くなるため、14時までの確実な下山完了を強く意識すべきタイムラインです。';
                }
              } else if (hourlyTimeframe === 'weekly' && peakAnalytics.weeklyHourlySummary[selectedWeekLabel]) {
                const sum = peakAnalytics.weeklyHourlySummary[selectedWeekLabel];
                currentChartData = sum.chartData;
                mEnterRatio = sum.morningEnterRatio;
                aExitRatio = sum.afternoonExitRatio;
                maxEntH = sum.maxEnterHour;
                maxEntC = sum.maxEnterCount;
                maxExH = sum.maxExitHour;
                maxExC = sum.maxExitCount;
                timeframeLabel = `${selectedWeekLabel} 週別集計`;
                seasonInsight = `【${selectedWeekLabel} の行動分析】時間帯シフトを週単位で検証することで、行動開始の遅れや夕方下山の遅延発生傾向を詳しく分析できます。`;
              }

              const sunZone = getSunlightZone(hourlyTimeframe, selectedMonthKey, selectedWeekLabel);

              return (
                <div style={{ marginBottom: '3.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                    <Clock size={22} style={{ color: '#3b82f6' }} />
                    <h4 style={{ fontSize: '1.15rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                      3. 時間帯ピーク分析 （季節・日照時間に伴う集中時間帯のシフト解析）
                    </h4>
                  </div>
                  <p style={{ fontSize: '0.92rem', color: 'var(--text-secondary)', marginBottom: '1.5rem', lineHeight: 1.6 }}>
                    緯度が高い利尻山では、季節（7月・8月の盛夏期 vs 9月の初秋期）によって日の長さが著しく変わり、入山開始および下山完了のピーク時間帯がシフトします。
                    「全シーズン」「月ごと」「週ごと」のグラフを切り替えて確認することで、日照時間の変化が登山行動の集中時間帯にどう影響するかを詳しく分析できます。
                  </p>

                  {/* 期間切り替え（全期間 / 月別 / 週別）コントロールバー */}
                  <div style={{
                    padding: '1.25rem',
                    backgroundColor: 'var(--bg-primary)',
                    borderRadius: '12px',
                    border: '1px solid var(--border-color)',
                    marginBottom: '1.75rem'
                  }}>
                    <div style={{ fontSize: '0.88rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <Calendar size={18} style={{ color: '#3b82f6' }} />
                      <span>分析する期間モードを選択（全シーズン / 月別 / 週別）：</span>
                    </div>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65rem', marginBottom: hourlyTimeframe !== 'all' ? '1rem' : 0 }}>
                      <button
                        onClick={() => setHourlyTimeframe('all')}
                        style={{
                          padding: '0.65rem 1.25rem',
                          borderRadius: '8px',
                          border: 'none',
                          backgroundColor: hourlyTimeframe === 'all' ? 'var(--accent-primary)' : 'var(--bg-secondary)',
                          color: hourlyTimeframe === 'all' ? '#fff' : 'var(--text-primary)',
                          fontWeight: 800,
                          fontSize: '0.9rem',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                          boxShadow: hourlyTimeframe === 'all' ? '0 4px 10px rgba(37, 99, 235, 0.25)' : 'none'
                        }}
                      >
                        🌐 全シーズン合算 (6月〜9月)
                      </button>

                      <button
                        onClick={() => setHourlyTimeframe('monthly')}
                        style={{
                          padding: '0.65rem 1.25rem',
                          borderRadius: '8px',
                          border: 'none',
                          backgroundColor: hourlyTimeframe === 'monthly' ? '#3b82f6' : 'var(--bg-secondary)',
                          color: hourlyTimeframe === 'monthly' ? '#fff' : 'var(--text-primary)',
                          fontWeight: 800,
                          fontSize: '0.9rem',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                          boxShadow: hourlyTimeframe === 'monthly' ? '0 4px 10px rgba(59, 130, 246, 0.25)' : 'none'
                        }}
                      >
                        📅 月別グラフで比較 (月ごと)
                      </button>

                      <button
                        onClick={() => setHourlyTimeframe('weekly')}
                        style={{
                          padding: '0.65rem 1.25rem',
                          borderRadius: '8px',
                          border: 'none',
                          backgroundColor: hourlyTimeframe === 'weekly' ? '#10b981' : 'var(--bg-secondary)',
                          color: hourlyTimeframe === 'weekly' ? '#fff' : 'var(--text-primary)',
                          fontWeight: 800,
                          fontSize: '0.9rem',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                          boxShadow: hourlyTimeframe === 'weekly' ? '0 4px 10px rgba(16, 185, 129, 0.25)' : 'none'
                        }}
                      >
                        📆 週別グラフで比較 (週ごと)
                      </button>
                    </div>

                    {/* 月別選択ピルボタン */}
                    {hourlyTimeframe === 'monthly' && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-color)' }}>
                        {['06', '07', '08', '09'].map(m => (
                          <button
                            key={m}
                            onClick={() => setSelectedMonthKey(m)}
                            style={{
                              padding: '0.45rem 1.1rem',
                              borderRadius: '9999px',
                              border: selectedMonthKey === m ? '2px solid #3b82f6' : '1px solid var(--border-color)',
                              backgroundColor: selectedMonthKey === m ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                              color: selectedMonthKey === m ? '#3b82f6' : 'var(--text-primary)',
                              fontWeight: 800,
                              fontSize: '0.85rem',
                              cursor: 'pointer'
                            }}
                          >
                            {parseInt(m, 10)}月集計
                          </button>
                        ))}
                      </div>
                    )}

                    {/* 週別選択ピルボタン */}
                    {hourlyTimeframe === 'weekly' && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-color)' }}>
                        {peakAnalytics.weekLabels.map(wl => (
                          <button
                            key={wl}
                            onClick={() => setSelectedWeekLabel(wl)}
                            style={{
                              padding: '0.4rem 0.9rem',
                              borderRadius: '9999px',
                              border: selectedWeekLabel === wl ? '2px solid #10b981' : '1px solid var(--border-color)',
                              backgroundColor: selectedWeekLabel === wl ? 'rgba(16, 185, 129, 0.15)' : 'transparent',
                              color: selectedWeekLabel === wl ? '#10b981' : 'var(--text-primary)',
                              fontWeight: 700,
                              fontSize: '0.82rem',
                              cursor: 'pointer'
                            }}
                          >
                            {wl}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* アナリスト分析インサイト（日照時間・季節の特性）ボックス */}
                  <div style={{
                    padding: '1.25rem',
                    backgroundColor: 'rgba(59, 130, 246, 0.05)',
                    borderRadius: '12px',
                    borderLeft: '4px solid #3b82f6',
                    marginBottom: '1.5rem',
                    border: '1px solid rgba(59, 130, 246, 0.25)'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 800, color: '#3b82f6', marginBottom: '0.5rem', fontSize: '0.95rem' }}>
                      <Sun size={18} />
                      <span>【日照・季節シフトの分析インサイト】 {timeframeLabel}</span>
                    </div>
                    <div style={{ fontSize: '0.9rem', color: 'var(--text-primary)', lineHeight: 1.6 }}>
                      {seasonInsight}
                    </div>
                  </div>

                  {/* 早朝・午後 ピークインサイトバー */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                    gap: '1.25rem',
                    marginBottom: '1.5rem'
                  }}>
                    <div style={{
                      padding: '1.25rem',
                      backgroundColor: 'rgba(59, 130, 246, 0.08)',
                      borderRadius: '12px',
                      border: '1px solid rgba(59, 130, 246, 0.25)'
                    }}>
                      <div style={{ fontSize: '0.85rem', color: '#3b82f6', fontWeight: 700 }}>
                        🌅 入山ピーク時間帯 ({timeframeLabel})
                      </div>
                      <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                        最高ピーク: <span style={{ color: '#3b82f6' }}>{maxEntH.toString().padStart(2, '0')}:00台</span> ({maxEntC}人)
                      </div>
                      <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.35rem' }}>
                        早朝帯 (05〜08時) に全入山の <strong>{mEnterRatio}%</strong> が集中しています。
                      </div>
                    </div>

                    <div style={{
                      padding: '1.25rem',
                      backgroundColor: 'rgba(16, 185, 129, 0.08)',
                      borderRadius: '12px',
                      border: '1px solid rgba(16, 185, 129, 0.25)'
                    }}>
                      <div style={{ fontSize: '0.85rem', color: '#10b981', fontWeight: 700 }}>
                        🌄 下山ピーク時間帯 ({timeframeLabel})
                      </div>
                      <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                        最高ピーク: <span style={{ color: '#10b981' }}>{maxExH.toString().padStart(2, '0')}:00台</span> ({maxExC}人)
                      </div>
                      <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.35rem' }}>
                        午後帯 (11〜15時) に全下山の <strong>{aExitRatio}%</strong> が集中しています。
                      </div>
                    </div>
                  </div>

                  {/* 棒グラフ本体（日照時間・明暗帯の背景ゾーン表示付き） */}
                  {/* 棒グラフ本体（日照時間・明暗帯の背景ゾーン表示付き） */}
                  <div style={{ width: '100%', padding: '1.25rem', backgroundColor: 'var(--bg-primary)', borderRadius: '12px', border: '1px solid var(--border-color)', marginBottom: '2.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <span style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--text-primary)' }}>00:00〜23:00 時間帯別 入山・下山ピーク分布グラフ （明暗帯ゾーン・日出日没目安付き）</span>
                      <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#3b82f6' }}>{timeframeLabel}</span>
                    </div>

                    {/* グラフすぐ上の「前の期間 / 次の期間」ナビゲーションコントロール（グラフ近接配置） */}
                    {(hourlyTimeframe === 'monthly' || hourlyTimeframe === 'weekly') && (() => {
                      const isMonthly = hourlyTimeframe === 'monthly';
                      const list = isMonthly ? ['06', '07', '08', '09'] : peakAnalytics.weekLabels;
                      const currentVal = isMonthly ? selectedMonthKey : selectedWeekLabel;
                      const currentIdx = list.indexOf(currentVal);
                      const prevVal = currentIdx > 0 ? list[currentIdx - 1] : null;
                      const nextVal = currentIdx < list.length - 1 ? list[currentIdx + 1] : null;

                      const handlePrev = () => {
                        if (!prevVal) return;
                        if (isMonthly) setSelectedMonthKey(prevVal);
                        else setSelectedWeekLabel(prevVal);
                      };

                      const handleNext = () => {
                        if (!nextVal) return;
                        if (isMonthly) setSelectedMonthKey(nextVal);
                        else setSelectedWeekLabel(nextVal);
                      };

                      return (
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '0.75rem',
                          padding: '0.55rem 0.85rem',
                          backgroundColor: 'rgba(59, 130, 246, 0.08)',
                          borderRadius: '8px',
                          border: '1px solid rgba(59, 130, 246, 0.25)',
                          marginBottom: '0.75rem',
                          flexWrap: 'wrap'
                        }}>
                          <button
                            disabled={!prevVal}
                            onClick={handlePrev}
                            style={{
                              padding: '0.35rem 0.9rem',
                              borderRadius: '6px',
                              border: '1px solid var(--border-color)',
                              backgroundColor: prevVal ? 'var(--bg-primary)' : 'rgba(0,0,0,0.05)',
                              color: prevVal ? 'var(--text-primary)' : 'var(--text-secondary)',
                              fontWeight: 800,
                              fontSize: '0.82rem',
                              cursor: prevVal ? 'pointer' : 'not-allowed',
                              opacity: prevVal ? 1 : 0.4,
                              transition: 'all 0.15s ease'
                            }}
                          >
                            ◀ {isMonthly ? `前の月 (${prevVal ? parseInt(prevVal, 10) + '月' : 'なし'})` : `前の週 (${prevVal || 'なし'})`}
                          </button>

                          <span style={{ fontWeight: 800, fontSize: '0.9rem', color: '#3b82f6' }}>
                            {isMonthly ? `📅 表示中: 【 ${parseInt(selectedMonthKey, 10)}月集計 】` : `📆 表示中: 【 ${selectedWeekLabel} 】`}
                          </span>

                          <button
                            disabled={!nextVal}
                            onClick={handleNext}
                            style={{
                              padding: '0.35rem 0.9rem',
                              borderRadius: '6px',
                              border: '1px solid var(--border-color)',
                              backgroundColor: nextVal ? 'var(--bg-primary)' : 'rgba(0,0,0,0.05)',
                              color: nextVal ? 'var(--text-primary)' : 'var(--text-secondary)',
                              fontWeight: 800,
                              fontSize: '0.82rem',
                              cursor: nextVal ? 'pointer' : 'not-allowed',
                              opacity: nextVal ? 1 : 0.4,
                              transition: 'all 0.15s ease'
                            }}
                          >
                            {isMonthly ? `次の月 (${nextVal ? parseInt(nextVal, 10) + '月' : 'なし'})` : `次の週 (${nextVal || 'なし'})`} ▶
                          </button>
                        </div>
                      );
                    })()}

                    {/* 日出・日没目安＆色分けゾーンの凡例バー */}
                    <div style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      gap: '1.25rem',
                      padding: '0.65rem 1rem',
                      backgroundColor: 'var(--bg-secondary)',
                      borderRadius: '8px',
                      border: '1px solid var(--border-color)',
                      marginBottom: '1rem',
                      fontSize: '0.82rem'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 700, color: '#d97706' }}>
                        <span style={{ display: 'inline-block', width: '14px', height: '14px', backgroundColor: 'rgba(250, 204, 21, 0.45)', border: '1px solid #eab308', borderRadius: '3px' }}></span>
                        <span>☀️ 昼間 (行動可能明帯): 日出 {sunZone.sunriseText} 〜 日没 {sunZone.sunsetText}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 700, color: '#ef4444' }}>
                        <span style={{ display: 'inline-block', width: '14px', height: '14px', backgroundColor: 'rgba(239, 68, 68, 0.35)', border: '1px solid #ef4444', borderRadius: '3px' }}></span>
                        <span>🌙 日没後 (暗闇危険帯): {sunZone.sunsetText} 以降 （ヘッドランプ必須）</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                        <span style={{ display: 'inline-block', width: '14px', height: '14px', backgroundColor: 'rgba(100, 116, 139, 0.25)', borderRadius: '3px' }}></span>
                        <span>🌑 未明 (夜明け前帯): 〜{sunZone.sunriseText}</span>
                      </div>
                    </div>

                    <div style={{ height: '350px', width: '100%', marginTop: '0.5rem' }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={currentChartData} margin={{ top: 28, right: 25, left: 10, bottom: 15 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
                          <XAxis dataKey="hourLabel" stroke="var(--text-secondary)" tick={{ fontSize: 13, fontWeight: 600 }} />
                          <YAxis stroke="var(--text-secondary)" tick={{ fontSize: 13, fontWeight: 600 }} />
                          <Tooltip
                            itemSorter={(item: any) => (item.dataKey === 'enterCount' || item.name === '入山者数 (IN)' ? -1 : 1)}
                            formatter={(val: any, name: any, item: any) => [
                              `${val || 0} 人`,
                              item?.dataKey === 'enterCount' || name === 'enterCount' || name === '入山者数 (IN)'
                                ? '入山者数 (IN)'
                                : '下山者数 (OUT)'
                            ]}
                            contentStyle={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px' }}
                          />
                          <Legend />

                          {/* 明暗帯ゾーン（背景色描画） */}
                          <ReferenceArea x1="00:00" x2={sunZone.sunriseX} fill="rgba(100, 116, 139, 0.12)" strokeOpacity={0} />
                          <ReferenceArea x1={sunZone.sunriseX} x2={sunZone.sunsetX} fill="rgba(250, 204, 21, 0.14)" strokeOpacity={0} />
                          <ReferenceArea x1={sunZone.sunsetX} x2="23:00" fill="rgba(239, 68, 68, 0.14)" strokeOpacity={0} />

                          {/* 日の出・日の入り時刻境界ライン */}
                          <ReferenceLine
                            x={sunZone.sunriseX}
                            stroke="#d97706"
                            strokeDasharray="4 4"
                            strokeWidth={2}
                            label={{ value: `🌅日出(${sunZone.sunriseText})`, position: 'top', fill: '#d97706', fontSize: 12, fontWeight: 900 }}
                          />
                          <ReferenceLine
                            x={sunZone.sunsetX}
                            stroke="#ef4444"
                            strokeDasharray="4 4"
                            strokeWidth={2}
                            label={{ value: `🌙日没(${sunZone.sunsetText})`, position: 'top', fill: '#ef4444', fontSize: 12, fontWeight: 900 }}
                          />

                          <Bar dataKey="enterCount" fill="#3b82f6" radius={[6, 6, 0, 0]} name="入山者数 (IN)" />
                          <Bar dataKey="exitCount" fill="#10b981" radius={[6, 6, 0, 0]} name="下山者数 (OUT)" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* ==================== ② 遅い時間の入山・遅い時間の下山の分析 ==================== */}
        {activeTab === 'late' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
              <Ship size={24} style={{ color: '#3b82f6' }} />
              <h3 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                遅い時間の入山、遅い時間の下山の分析 （フェリー1便登山 ＆ 自力夜間下山）
              </h3>
            </div>
            <p style={{ fontSize: '0.92rem', color: 'var(--text-secondary)', marginBottom: '1.75rem', lineHeight: 1.6 }}>
              安全登山の観点から、行動時間が短くなる「遅い時間の入山（10:30〜14:00）」と、
              疲労や天候要因で「遅い時間の下山（17:00〜23:59）」となったリスク事案の発生状況・実数を可視化します。
              また、それぞれの現象が多く発生した日をランキング化し、天候・曜日との相関や前年度・過年度比較を行うための解析材料を提供します。
            </p>

            {/* サマリーカード 2連 */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
              gap: '1.5rem',
              marginBottom: '2.5rem'
            }}>
              <div style={{
                padding: '1.5rem',
                backgroundColor: 'rgba(59, 130, 246, 0.08)',
                borderRadius: '16px',
                border: '1px solid rgba(59, 130, 246, 0.35)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#2563eb', fontWeight: 800, fontSize: '1rem' }}>
                    <Ship size={20} />
                    <span>🚢 遅い時間の入山 （10:30〜14:00） 発生件数</span>
                  </div>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#2563eb', backgroundColor: 'rgba(59, 130, 246, 0.15)', padding: '0.2rem 0.6rem', borderRadius: '999px' }}>
                    全体比: {lateAnalytics.lateEnterRatio}%
                  </span>
                </div>
                <div style={{ fontSize: '2.5rem', fontWeight: 800, color: 'var(--text-primary)', margin: '0.75rem 0' }}>
                  {lateAnalytics.lateEnter} <span style={{ fontSize: '1.35rem', fontWeight: 600 }}>人</span>
                </div>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>
                  全入山者 {lateAnalytics.totalEnter} 人のうち 10:30〜14:00 の時間帯に入山した層の総実数。
                  稚内・礼文からのフェリー1便到着後ただちに入山を開始する「午後スタート層」の実規模を示します。
                </p>
              </div>

              <div style={{
                padding: '1.5rem',
                backgroundColor: 'rgba(239, 68, 68, 0.08)',
                borderRadius: '16px',
                border: '1px solid rgba(239, 68, 68, 0.35)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#ef4444', fontWeight: 800, fontSize: '1rem' }}>
                  <AlertTriangle size={20} />
                  <span>🌙 遅い時間の下山 （17:00〜23:59） 発生件数</span>
                </div>
                <div style={{ fontSize: '2.5rem', fontWeight: 800, color: '#ef4444', margin: '0.75rem 0' }}>
                  {lateAnalytics.totalLateExits} <span style={{ fontSize: '1.35rem', fontWeight: 600 }}>人</span>
                </div>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>
                  日没後・薄暮期（17:00以降）に下山した「ヒヤリハット・予備軍」の総実数です。
                  天候急変や疲労蓄積で標準コースタイムを超過したケースを分析する材料となります。
                </p>
              </div>
            </div>

            {/* 週別「遅い時間の入山・下山」の比較 */}
            <div style={{ marginBottom: '2.5rem' }}>
              <h4 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.85rem', color: 'var(--text-primary)' }}>
                📅 週別の「遅い時間の入山（10:30〜14:00）」と「遅い時間の下山（17:00〜23:59）」件数比較
              </h4>
              <div style={{ height: '300px', width: '100%', marginBottom: '1.25rem', padding: '1rem', backgroundColor: 'var(--bg-primary)', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={lateAnalytics.weeklyList} margin={{ top: 15, right: 25, left: 10, bottom: 25 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
                    <XAxis dataKey="weekLabel" stroke="var(--text-secondary)" interval={0} angle={-25} textAnchor="end" height={45} />
                    <YAxis stroke="var(--text-secondary)" unit=" 人" />
                    <Tooltip
                      formatter={(val: any, name: any) => [
                        `${val || 0} 人`,
                        name === 'lateEnter' ? '遅い入山 (10:30〜14:00)' : '遅い下山 (17:00〜23:59)'
                      ]}
                      contentStyle={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px' }}
                    />
                    <Bar dataKey="lateEnter" fill="#3b82f6" name="lateEnter" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="lateExit" fill="#ef4444" name="lateExit" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* ランキング 2連：遅い入山TOP10 ＆ 遅い下山TOP10 */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
              gap: '1.75rem',
              marginBottom: '1rem'
            }}>
              {/* 遅い時間の入山 が多い日 TOP10 */}
              <div>
                <h4 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.85rem', color: '#2563eb' }}>
                  🚢 「遅い時間の入山（10:30〜14:00）」が多い日 ランキング TOP10 （日付クリックで詳細）
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.85rem' }}>
                  {lateAnalytics.topLateEnterDays.map((d, i) => {
                    const w = weatherData[d.date];
                    const wDesc = w && w.weatherCode !== undefined
                      ? getWeatherDescription(w.weatherCode, w.precipitation, w.sunshineDuration)
                      : null;
                    return (
                      <div
                        key={d.date}
                        onClick={() => onSelectDate?.(d.date)}
                        style={{
                          padding: '1rem',
                          backgroundColor: 'var(--bg-primary)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '12px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          cursor: onSelectDate ? 'pointer' : 'default',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 800, fontSize: '0.95rem' }}>
                            #{i + 1} {format(parseISO(d.date), 'yyyy/MM/dd (E)', { locale: ja })}
                          </div>
                          <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '0.35rem' }}>
                            {wDesc ? `${wDesc.emoji} ${wDesc.text}` : '天候未取得'} 
                            {w && ` | 降水 ${w.precipitation}mm / 風 ${w.windSpeedMax}m/s`}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                          <div style={{
                            padding: '0.45rem 0.85rem',
                            backgroundColor: '#2563eb',
                            color: '#fff',
                            fontWeight: 800,
                            borderRadius: '8px',
                            fontSize: '1rem'
                          }}>
                            {d.count} 人
                          </div>
                          {onSelectDate && (
                            <span style={{
                              fontSize: '0.78rem',
                              padding: '0.35rem 0.6rem',
                              borderRadius: '6px',
                              backgroundColor: 'rgba(59, 130, 246, 0.12)',
                              color: '#2563eb',
                              fontWeight: 700
                            }}>
                              詳細 ➔
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 遅い時間の下山 が多い日 TOP10 */}
              <div>
                <h4 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.85rem', color: '#ef4444' }}>
                  ⚠️ 「遅い時間の下山（17:00〜23:59）」が多い警戒日 ランキング TOP10 （日付クリックで詳細）
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.85rem' }}>
                  {lateAnalytics.topLateExitDays.map((d, i) => {
                    const w = weatherData[d.date];
                    const wDesc = w && w.weatherCode !== undefined
                      ? getWeatherDescription(w.weatherCode, w.precipitation, w.sunshineDuration)
                      : null;
                    return (
                      <div
                        key={d.date}
                        onClick={() => onSelectDate?.(d.date)}
                        style={{
                          padding: '1rem',
                          backgroundColor: 'var(--bg-primary)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '12px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          cursor: onSelectDate ? 'pointer' : 'default',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 800, fontSize: '0.95rem' }}>
                            #{i + 1} {format(parseISO(d.date), 'yyyy/MM/dd (E)', { locale: ja })}
                          </div>
                          <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '0.35rem' }}>
                            {wDesc ? `${wDesc.emoji} ${wDesc.text}` : '天候未取得'} 
                            {w && ` | 降水 ${w.precipitation}mm / 風 ${w.windSpeedMax}m/s`}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                          <div style={{
                            padding: '0.45rem 0.85rem',
                            backgroundColor: '#ef4444',
                            color: '#fff',
                            fontWeight: 800,
                            borderRadius: '8px',
                            fontSize: '1rem'
                          }}>
                            {d.count} 人
                          </div>
                          {onSelectDate && (
                            <span style={{
                              fontSize: '0.78rem',
                              padding: '0.35rem 0.6rem',
                              borderRadius: '6px',
                              backgroundColor: 'rgba(239, 68, 68, 0.12)',
                              color: '#ef4444',
                              fontWeight: 700
                            }}>
                              詳細 ➔
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div style={{
              marginTop: '1.25rem',
              padding: '0.9rem 1.2rem',
              backgroundColor: 'rgba(59, 130, 246, 0.08)',
              borderLeft: '4px solid #3b82f6',
              borderRadius: '8px',
              fontSize: '0.88rem',
              lineHeight: 1.6
            }}>
              <strong>💡 解析ヒント（前年度・過年度との比較材料）:</strong><br />
              ランキングに挙がった特定の日に「なぜ遅い入山・下山が集中したのか」（例：気象・連休・海況・フェリーの運行状況・前年の傾向など）を
              照らし合わせて分析することで、安全対策（増員パトロールや声がけなど）の時期や重点曜日を指定する強力な解析材料となります。
            </div>
          </div>
        )}

        {/* ==================== ③ 深夜・未明帯 (21:00〜00:59) の入山分析 ==================== */}
        {activeTab === 'night' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
              <Moon size={24} style={{ color: '#f59e0b' }} />
              <h3 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                深夜・未明帯 (21:00〜00:59) の入山分析 （※ 3時・4時台の一般早出層を除外）
              </h3>
            </div>
            <p style={{ fontSize: '0.92rem', color: 'var(--text-secondary)', marginBottom: '1.75rem', lineHeight: 1.6 }}>
              3時・4時台に増加する一般の早朝登山層を除外し、遭難・ビバークやトラブルのリスクが特に高い「深夜・未明帯 (21:00〜00:59)」の入山動向に特化して分析します。
              「どの週に多いのか（7月1週目・2週目など）」の週別推移や、「どのような日に集中するのか」の特異日ランキングを可視化し、前年度比較やパトロール配置時期の判断を強力にサポートします。
            </p>

            {/* サマリー統計カード 3連 */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: '1.25rem',
              marginBottom: '2.5rem'
            }}>
              <div style={{
                padding: '1.25rem',
                backgroundColor: 'rgba(239, 68, 68, 0.08)',
                borderRadius: '14px',
                border: '1px solid rgba(239, 68, 68, 0.35)',
                boxShadow: 'var(--shadow-sm)'
              }}>
                <div style={{ fontSize: '0.85rem', color: '#ef4444', fontWeight: 700 }}>
                  🌌 深夜・未明帯 (21:00〜00:59) 入山総数
                </div>
                <div style={{ fontSize: '2.2rem', fontWeight: 800, color: '#ef4444', margin: '0.5rem 0 0 0' }}>
                  {nightAnalytics.midnightCount} <span style={{ fontSize: '1.1rem', fontWeight: 600 }}>人</span>
                </div>
                <div style={{ fontSize: '0.8rem', color: '#ef4444', marginTop: '0.25rem', fontWeight: 700 }}>
                  要高警戒: 最も対策・監視が必要な時間帯
                </div>
              </div>

              <div style={{
                padding: '1.25rem',
                backgroundColor: 'rgba(245, 158, 11, 0.08)',
                borderRadius: '14px',
                border: '1px solid rgba(245, 158, 11, 0.35)',
                boxShadow: 'var(--shadow-sm)'
              }}>
                <div style={{ fontSize: '0.85rem', color: '#d97706', fontWeight: 700 }}>
                  🌆 夕暮れ帯 (17:00〜20:59) 入山総数
                </div>
                <div style={{ fontSize: '2.2rem', fontWeight: 800, color: '#d97706', margin: '0.5rem 0 0 0' }}>
                  {nightAnalytics.eveningCount} <span style={{ fontSize: '1.1rem', fontWeight: 600 }}>人</span>
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                  参考比較: 薄暮〜夜間初期の入山層
                </div>
              </div>

              <div style={{
                padding: '1.25rem',
                backgroundColor: 'var(--bg-primary)',
                borderRadius: '14px',
                border: '1px solid var(--border-color)',
                boxShadow: 'var(--shadow-sm)'
              }}>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 700 }}>
                  📅 深夜・未明入山の 最多発生週
                </div>
                <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--text-primary)', margin: '0.5rem 0 0 0' }}>
                  {nightAnalytics.maxWeekLabel}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                  対策パトロールの重点推奨期間
                </div>
              </div>
            </div>

            {/* 週別の深夜・未明入山者数バーチャート */}
            <div style={{
              padding: '1.5rem',
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: '16px',
              marginBottom: '2.5rem'
            }}>
              <h4 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '1.25rem', color: 'var(--text-primary)' }}>
                📊 登山シーズン (6月〜9月) 週別の「深夜・未明帯 (21:00〜00:59)」入山者数推移
              </h4>
              <div style={{ height: '300px', width: '100%', marginBottom: '1.5rem' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={nightAnalytics.weeklyNightList} margin={{ top: 15, right: 25, left: 10, bottom: 25 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
                    <XAxis dataKey="weekLabel" stroke="var(--text-secondary)" interval={0} angle={-25} textAnchor="end" height={45} />
                    <YAxis stroke="var(--text-secondary)" unit=" 人" />
                    <Tooltip
                      formatter={(val: any) => [`${val || 0} 人`, '深夜・未明帯 (21-0時) 入山']}
                      contentStyle={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px' }}
                    />
                    <Bar dataKey="count" name="深夜未明入山者数" radius={[6, 6, 0, 0]}>
                      {nightAnalytics.weeklyNightList.map((entry, idx) => {
                        const isMaxWeek = entry.weekLabel === nightAnalytics.maxWeekLabel && entry.count > 0;
                        return <Cell key={`cell-${idx}`} fill={isMaxWeek ? '#ef4444' : '#f59e0b'} />;
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div style={{
                padding: '0.85rem 1.15rem',
                backgroundColor: 'rgba(239, 68, 68, 0.08)',
                borderLeft: '4px solid #ef4444',
                borderRadius: '8px',
                fontSize: '0.88rem',
                lineHeight: 1.6
              }}>
                <strong>💡 週別トレンドと分析考察:</strong><br />
                週単位での集計により、連休期間（7月海の日・8月お盆前後など）と深夜・未明入山の相関を明確化できます。
                データ上、最多発生週は <strong>{nightAnalytics.maxWeekLabel}</strong> となっており、過年度比較の基点および現場啓発の最重要期間としてご活用ください。
              </div>
            </div>

            {/* 深夜・未明入山 が多い日 TOP10 */}
            <div style={{ marginBottom: '1.5rem' }}>
              <h4 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.85rem', color: '#ef4444' }}>
                🌙 「深夜・未明帯（21:00〜00:59）」の入山が多かった日 ランキング TOP10 （日付クリックで詳細）
              </h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(310px, 1fr))', gap: '1rem' }}>
                {nightAnalytics.topMidnightDays.map((d, i) => {
                  const w = weatherData[d.date];
                  const wDesc = w && w.weatherCode !== undefined
                    ? getWeatherDescription(w.weatherCode, w.precipitation, w.sunshineDuration)
                    : null;
                  return (
                    <div
                      key={d.date}
                      onClick={() => onSelectDate?.(d.date)}
                      style={{
                        padding: '1.1rem',
                        backgroundColor: 'var(--bg-primary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '12px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        cursor: onSelectDate ? 'pointer' : 'default',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 800, fontSize: '0.95rem' }}>
                          #{i + 1} {format(parseISO(d.date), 'yyyy/MM/dd (E)', { locale: ja })}
                        </div>
                        <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '0.35rem' }}>
                          {wDesc ? `${wDesc.emoji} ${wDesc.text}` : '天候未取得'} 
                          {w && ` | 降水 ${w.precipitation}mm / 風 ${w.windSpeedMax}m/s`}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        <div style={{
                          padding: '0.45rem 0.85rem',
                          backgroundColor: '#ef4444',
                          color: '#fff',
                          fontWeight: 800,
                          borderRadius: '8px',
                          fontSize: '1rem'
                        }}>
                          {d.count} 人
                        </div>
                        {onSelectDate && (
                          <span style={{
                            fontSize: '0.78rem',
                            padding: '0.35rem 0.6rem',
                            borderRadius: '6px',
                            backgroundColor: 'rgba(239, 68, 68, 0.12)',
                            color: '#ef4444',
                            fontWeight: 700
                          }}>
                            詳細 ➔
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
                {nightAnalytics.topMidnightDays.length === 0 && (
                  <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)', gridColumn: '1 / -1', border: '1px solid var(--border-color)', borderRadius: '12px' }}>
                    選択された条件内に深夜・未明帯の入山ログは見つかりませんでした。
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
