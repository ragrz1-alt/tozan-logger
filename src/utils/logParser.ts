export type CourseId = 'oshidomari' | 'kutsugata';

export interface LogEntry {
  counterId: string;
  direction: 'L' | 'R';
  dateStr: string; // 'YYYY-MM-DD'
  timeStr: string; // 'HH:mm:ss'
  timestamp: number;
  hour: number;
  rawDate: string; // 'YYMMDD'
  course: CourseId; // 'oshidomari' | 'kutsugata'
}

export interface ParseResult {
  entries: LogEntry[];
  errors: string[];
}

export const parseLogFile = (content: string, course: CourseId = 'oshidomari'): ParseResult => {
  const lines = content.split('\n');
  const entries: LogEntry[] = [];
  const errors: string[] = [];

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    const parts = trimmed.split(',');
    if (parts.length < 4) {
      errors.push(`Line ${index + 1}: Invalid format`);
      return;
    }

    const [counterId, direction, dateRaw, timeRaw] = parts;
    
    if (direction !== 'L' && direction !== 'R') {
      errors.push(`Line ${index + 1}: Invalid direction '${direction}'`);
      return;
    }

    if (dateRaw.length !== 6 || timeRaw.length !== 6) {
      errors.push(`Line ${index + 1}: Invalid date/time format`);
      return;
    }

    // YYMMDD -> YYYY-MM-DD
    // Assuming YY is 20YY
    const year = `20${dateRaw.substring(0, 2)}`;
    const month = dateRaw.substring(2, 4);
    const day = dateRaw.substring(4, 6);
    const dateStr = `${year}-${month}-${day}`;

    // HHMMSS -> HH:mm:ss
    const hourStr = timeRaw.substring(0, 2);
    const minStr = timeRaw.substring(2, 4);
    const secStr = timeRaw.substring(4, 6);
    const timeStr = `${hourStr}:${minStr}:${secStr}`;

    const dateObj = new Date(`${dateStr}T${timeStr}`);
    
    if (isNaN(dateObj.getTime())) {
      errors.push(`Line ${index + 1}: Invalid date`);
      return;
    }

    entries.push({
      counterId,
      direction,
      dateStr,
      timeStr,
      timestamp: dateObj.getTime(),
      hour: parseInt(hourStr, 10),
      rawDate: dateRaw,
      course,
    });
  });

  // Sort by timestamp
  entries.sort((a, b) => a.timestamp - b.timestamp);

  return { entries, errors };
};

/**
 * コースおよびセンサー設置方向に合わせて、当該エントリが入山(IN)かどうかを自動判定します。
 * - 鴛泊 (oshidomari): 左側設置 -> 'R' が入山, 'L' が下山
 * - 沓形 (kutsugata): 右側設置 -> 'L' が入山, 'R' が下山
 */
export const isEntryEnter = (entry: LogEntry, fallbackEnterDirection: 'L' | 'R' = 'R'): boolean => {
  if (entry.course === 'kutsugata') {
    return entry.direction === 'L';
  }
  if (entry.course === 'oshidomari') {
    return entry.direction === 'R';
  }
  return entry.direction === fallbackEnterDirection;
};

export const aggregateData = (
  entries: LogEntry[], 
  enterDirection: 'L' | 'R', 
  anomalyFilter: boolean
) => {
  const dailyData: Record<string, { date: string, enter: number, exit: number }> = {};
  const hourlyData: Record<number, { hour: string, enter: number, exit: number }> = {};
  
  // Initialize hourly data 0-23
  for (let i = 0; i < 24; i++) {
    hourlyData[i] = { hour: `${i.toString().padStart(2, '0')}:00`, enter: 0, exit: 0 };
  }

  let filteredEntries = entries;
  
  // Anomaly filter: e.g. remove night counts (20:00 - 04:00) as basic example
  // Or filter out bursts (too many in 1 min)
  if (anomalyFilter) {
    // Basic anomaly filter: exclude 21:00 - 03:59
    filteredEntries = entries.filter(e => e.hour >= 4 && e.hour < 21);
  }

  filteredEntries.forEach(entry => {
    const isEnter = isEntryEnter(entry, enterDirection);
    
    // Daily
    if (!dailyData[entry.dateStr]) {
      dailyData[entry.dateStr] = { date: entry.dateStr, enter: 0, exit: 0 };
    }
    if (isEnter) dailyData[entry.dateStr].enter++;
    else dailyData[entry.dateStr].exit++;
    
    // Hourly
    if (isEnter) hourlyData[entry.hour].enter++;
    else hourlyData[entry.hour].exit++;
  });

  return {
    daily: Object.values(dailyData).sort((a, b) => a.date.localeCompare(b.date)),
    hourly: Object.values(hourlyData)
  };
};

export interface DailyDetails {
  dateStr: string;
  totalEnter: number;
  totalExit: number;
  peakHour: string;
  peakEnterCount: number;
  avgEnterTimeStr: string; // e.g. "06:24"
  avgExitTimeStr: string; // e.g. "15:06"
  estDurationStr: string; // e.g. "約 8時間 42分"
  estDurationMinutes: number; // e.g. 522
  hourly: { hour: string; enter: number; exit: number }[];
  entries: LogEntry[];
}

export const getDailyDetails = (
  entries: LogEntry[],
  dateStr: string,
  enterDirection: 'L' | 'R',
  anomalyFilter: boolean
): DailyDetails => {
  let filteredEntries = entries.filter(e => e.dateStr === dateStr);
  if (anomalyFilter) {
    filteredEntries = filteredEntries.filter(e => e.hour >= 4 && e.hour < 21);
  }

  const hourlyData: Record<number, { hour: string; enter: number; exit: number }> = {};
  for (let i = 0; i < 24; i++) {
    hourlyData[i] = { hour: `${i.toString().padStart(2, '0')}:00`, enter: 0, exit: 0 };
  }

  let totalEnter = 0;
  let totalExit = 0;
  let enterHourSum = 0;
  let exitHourSum = 0;

  filteredEntries.forEach(entry => {
    const isEnter = isEntryEnter(entry, enterDirection);
    const parts = entry.timeStr.split(':').map(Number);
    const preciseHour = parts[0] + (parts[1] || 0) / 60 + (parts[2] || 0) / 3600;

    if (isEnter) {
      hourlyData[entry.hour].enter++;
      totalEnter++;
      enterHourSum += preciseHour;
    } else {
      hourlyData[entry.hour].exit++;
      totalExit++;
      exitHourSum += preciseHour;
    }
  });

  const avgEnterHour = totalEnter > 0 ? enterHourSum / totalEnter : 0;
  const avgExitHour = totalExit > 0 ? exitHourSum / totalExit : 0;

  const formatHourToTimeStr = (h: number): string => {
    if (h === 0) return '--:--';
    const hrs = Math.floor(h);
    const mins = Math.round((h - hrs) * 60);
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
  };

  const avgEnterTimeStr = formatHourToTimeStr(avgEnterHour);
  const avgExitTimeStr = formatHourToTimeStr(avgExitHour);

  let estDurationStr = '計測不可';
  let estDurationMinutes = 0;
  if (totalEnter > 0 && totalExit > 0 && avgExitHour > avgEnterHour) {
    const diffHours = avgExitHour - avgEnterHour;
    estDurationMinutes = Math.round(diffHours * 60);
    const dh = Math.floor(estDurationMinutes / 60);
    const dm = estDurationMinutes % 60;
    estDurationStr = `約 ${dh}時間 ${dm}分`;
  }

  const hourlyList = Object.values(hourlyData);
  let peakHour = '00:00';
  let peakEnterCount = 0;
  hourlyList.forEach(item => {
    if (item.enter > peakEnterCount) {
      peakEnterCount = item.enter;
      peakHour = item.hour;
    }
  });

  return {
    dateStr,
    totalEnter,
    totalExit,
    peakHour,
    peakEnterCount,
    avgEnterTimeStr,
    avgExitTimeStr,
    estDurationStr,
    estDurationMinutes,
    hourly: hourlyList,
    entries: filteredEntries,
  };
};

