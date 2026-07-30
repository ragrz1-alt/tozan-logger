export interface WeatherData {
  date: string;
  tempMax: number;
  tempMin: number;
  precipitation: number;
  weatherCode: number;
  windSpeedMax: number;
  windDirection: number;
  sunshineDuration?: number; // hours
  isHeavyRain?: boolean; // 極端な大雨フラグ (20mm以上等)
}

// 気象庁アメダス観測点（利尻島）
const KUTSUGATA_LAT = 45.1870;
const KUTSUGATA_LON = 141.1410;
const MOTODOMARI_LAT = 45.2442;
const MOTODOMARI_LON = 141.2339;

const fetchSingleLocationWeather = async (
  lat: number,
  lon: number,
  startDate: string,
  endDate: string
): Promise<Record<string, WeatherData>> => {
  try {
    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${startDate}&end_date=${endDate}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code,wind_speed_10m_max,wind_direction_10m_dominant,sunshine_duration&models=jma_msm&timezone=Asia%2FTokyo&wind_speed_unit=ms`;
    
    let response = await fetch(url);
    if (!response.ok) {
      const fallbackUrl = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${startDate}&end_date=${endDate}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code,wind_speed_10m_max,wind_direction_10m_dominant,sunshine_duration&timezone=Asia%2FTokyo&wind_speed_unit=ms`;
      response = await fetch(fallbackUrl);
      if (!response.ok) return {};
    }
    
    const data = await response.json();
    const result: Record<string, WeatherData> = {};
    
    if (data.daily && data.daily.time) {
      for (let i = 0; i < data.daily.time.length; i++) {
        const date = data.daily.time[i];
        const sunshineSec = data.daily.sunshine_duration ? data.daily.sunshine_duration[i] : undefined;
        const sunshineHours = sunshineSec !== undefined && sunshineSec !== null
          ? Math.round((sunshineSec / 3600) * 10) / 10
          : undefined;

        const rawPrecip = data.daily.precipitation_sum[i] || 0;
        // 1.0mm未満の微小なモデル空間推計値（0.3mm等）は気象庁アメダス実測に合わせ0.0mmにクリーニング
        const precip = rawPrecip < 1.0 ? 0 : Math.round(rawPrecip * 10) / 10;
        result[date] = {
          date,
          tempMax: data.daily.temperature_2m_max[i],
          tempMin: data.daily.temperature_2m_min[i],
          precipitation: precip,
          weatherCode: data.daily.weather_code[i],
          windSpeedMax: data.daily.wind_speed_10m_max[i],
          windDirection: data.daily.wind_direction_10m_dominant[i],
          sunshineDuration: sunshineHours,
          isHeavyRain: precip >= 20.0
        };
      }
    }
    return result;
  } catch (err) {
    console.error('Error fetching weather:', err);
    return {};
  }
};

const DAILY_WEATHER_CACHE_KEY = 'tozan_weather_daily_cache_v3';
const HOURLY_WEATHER_CACHE_KEY = 'tozan_weather_hourly_cache_v3';

const getDailyWeatherCache = (): Record<string, WeatherData> => {
  try {
    const saved = localStorage.getItem(DAILY_WEATHER_CACHE_KEY);
    return saved ? JSON.parse(saved) : {};
  } catch {
    return {};
  }
};

const saveDailyWeatherCache = (cache: Record<string, WeatherData>) => {
  try {
    localStorage.setItem(DAILY_WEATHER_CACHE_KEY, JSON.stringify(cache));
  } catch (err) {
    console.warn('Failed to save daily weather cache:', err);
  }
};

const getDatesInRange = (start: string, end: string): string[] => {
  const dates: string[] = [];
  let curr = new Date(start);
  const endDt = new Date(end);
  while (curr <= endDt) {
    dates.push(curr.toISOString().substring(0, 10));
    curr.setDate(curr.getDate() + 1);
  }
  return dates;
};

/**
 * 気象庁「沓形」と「本泊」のデータを掛け合わせてクロス分析した総合気象データを返します。
 * （過去の気象データはローカルストレージへ自動キャッシュ・保存し、2回目以降は通信0秒で即時読み込みます）
 */
export const fetchWeatherData = async (
  _lat: number,
  _lon: number,
  startDate: string,
  endDate: string
): Promise<Record<string, WeatherData>> => {
  const cache = getDailyWeatherCache();
  const dates = getDatesInRange(startDate, endDate);

  // 1. 全ての日付が既にキャッシュにある場合、API通信を行わず0秒でキャッシュデータを返却
  const isAllCached = dates.length > 0 && dates.every(d => !!cache[d]);
  if (isAllCached) {
    const cachedResult: Record<string, WeatherData> = {};
    dates.forEach(d => {
      if (cache[d]) cachedResult[d] = cache[d];
    });
    return cachedResult;
  }

  // 2. 未取得の日付がある場合は気象庁「沓形 × 本泊」実況データを同時フェッチ
  const [kutsugata, motodomari] = await Promise.all([
    fetchSingleLocationWeather(KUTSUGATA_LAT, KUTSUGATA_LON, startDate, endDate),
    fetchSingleLocationWeather(MOTODOMARI_LAT, MOTODOMARI_LON, startDate, endDate)
  ]);

  const allDates = new Set([...Object.keys(kutsugata), ...Object.keys(motodomari)]);
  const combined: Record<string, WeatherData> = {};

  allDates.forEach(date => {
    const k = kutsugata[date];
    const m = motodomari[date];
    if (k && m) {
      const precip = Math.max(k.precipitation, m.precipitation);
      const sunshine = (k.sunshineDuration !== undefined && m.sunshineDuration !== undefined)
        ? Math.round(((k.sunshineDuration + m.sunshineDuration) / 2) * 10) / 10
        : (k.sunshineDuration ?? m.sunshineDuration);
      
      combined[date] = {
        date,
        tempMax: Math.round(((k.tempMax + m.tempMax) / 2) * 10) / 10,
        tempMin: Math.round(((k.tempMin + m.tempMin) / 2) * 10) / 10,
        precipitation: precip,
        weatherCode: precip >= 20 ? 65 : (k.weatherCode > m.weatherCode ? k.weatherCode : m.weatherCode),
        windSpeedMax: Math.max(k.windSpeedMax, m.windSpeedMax),
        windDirection: k.windDirection,
        sunshineDuration: sunshine,
        isHeavyRain: precip >= 20.0
      };
    } else {
      combined[date] = k || m;
    }
  });

  // 3. 取得した新しい気象データをキャッシュにマージして保存
  const newCache = { ...cache, ...combined };
  saveDailyWeatherCache(newCache);

  return combined;
};

// Map WMO weather codes and real observation values to emoji/text
export const getWeatherDescription = (
  code: number,
  precipitation?: number,
  sunshineHours?: number
) => {
  // 1. 日照時間・降水量に基づく気象庁地上観測の実感に近いスマート判定
  if (sunshineHours !== undefined && sunshineHours !== null) {
    if (sunshineHours >= 6 && (!precipitation || precipitation < 20.0)) {
      return (precipitation && precipitation >= 1.0)
        ? { text: '晴れ (時間帯により雨)', emoji: '☀️' }
        : { text: '晴れ', emoji: '☀️' };
    }
    if (sunshineHours >= 3 && sunshineHours < 6 && (!precipitation || precipitation < 20.0)) {
      return (precipitation && precipitation >= 1.0)
        ? { text: '曇り時々晴れ (一時雨)', emoji: '⛅' }
        : { text: '曇り時々晴れ', emoji: '⛅' };
    }
    if (sunshineHours < 3 && (!precipitation || precipitation < 1.0) && code < 60) {
      return { text: '曇り', emoji: '☁️' };
    }
  }

  // 2. WMO weather code による網羅的標準判定 (0〜99全領域対応)
  if (code === 0) return { text: '快晴', emoji: '☀️' };
  if (code === 1 || code === 2) return { text: '晴れ/一部曇り', emoji: '⛅' };
  if (code === 3) return { text: '曇り', emoji: '☁️' };
  if ((code >= 4 && code <= 19) || (code >= 40 && code <= 49)) {
    return (code >= 45 && code <= 48)
      ? { text: '霧', emoji: '🌫️' }
      : { text: '曇り/もや', emoji: '☁️' };
  }
  if (code >= 50 && code <= 59) {
    return (!precipitation || precipitation < 1.0)
      ? { text: '曇り (一時弱い霧雨)', emoji: '☁️' }
      : { text: '霧雨', emoji: '🌧️' };
  }
  if (code >= 60 && code <= 69) {
    return (code === 66 || code === 67)
      ? { text: '氷雨・冷雨', emoji: '🌧️' }
      : { text: '雨', emoji: '☔' };
  }
  if (code >= 70 && code <= 79) return { text: '雪', emoji: '❄️' };
  if (code >= 80 && code <= 84) return { text: 'にわか雨', emoji: '🌦️' };
  if (code >= 85 && code <= 94) return { text: '雪・吹雪', emoji: '🌨️' };
  if (code >= 95) return { text: '雷雨', emoji: '⛈️' };

  // 3. 規定外コードが返った場合も実測降水量によりフォールバック（不明にしない）
  if (precipitation && precipitation >= 1.0) {
    return { text: '雨', emoji: '☔' };
  }
  return { text: '曇り', emoji: '☁️' };
};

// Convert wind direction degrees (0-360) to 16 compass points
export const getWindDirection = (degree: number) => {
  const directions = ['北', '北北東', '北東', '東北東', '東', '東南東', '南東', '南南東', '南', '南南西', '南西', '西南西', '西', '西北西', '北西', '北北西'];
  const val = Math.floor((degree / 22.5) + 0.5);
  return directions[(val % 16)];
};

export const getWeatherCategory = (
  code: number,
  precipitation?: number,
  sunshineHours?: number
): 'Sunny' | 'Cloudy' | 'Rainy' | 'HeavyRain' => {
  // 極端な大雨（日降水量 20mm以上等）をぱっと見で判別
  if (precipitation && precipitation >= 20.0) {
    return 'HeavyRain';
  }

  // 1. 日照時間 (sunshineHours) がある場合のスマート判定 (気象庁観測の実況に準拠)
  if (sunshineHours !== undefined && sunshineHours !== null) {
    if (sunshineHours >= 6 && (!precipitation || precipitation < 20.0)) {
      return 'Sunny';
    }
    if (sunshineHours >= 3 && (!precipitation || precipitation < 20.0)) {
      return 'Cloudy';
    }
    if ((!precipitation || precipitation < 1.0) && code < 60) {
      return 'Cloudy';
    }
  }

  // 2. WMO weather code と 降水量 による標準判定
  if (code === 0 || code === 1) return 'Sunny';
  if (code === 2) {
    return (precipitation && precipitation >= 1.0) ? 'Cloudy' : 'Sunny';
  }
  if (code === 3 || (code >= 45 && code <= 48)) return 'Cloudy';
  if (code >= 51 && code <= 55 && (!precipitation || precipitation < 1.0)) {
    return 'Cloudy';
  }

  return 'Rainy'; // 雨・雪・雷雨など
};

export const getWeatherCategoryColor = (category: string) => {
  if (category === 'HeavyRain') return '#ef4444'; // Red (豪雨・極端な荒天アラート)
  if (category === 'Sunny') return '#fbbf24'; // Orange/Yellow
  if (category === 'Cloudy') return '#94a3b8'; // Gray
  if (category === 'Rainy') return '#3b82f6'; // Blue
  return '#10b981'; // Default Green
};

export interface HourlyWeatherData {
  hour: string; // "00:00" to "23:00"
  temp: number; // e.g. 15.2
  precipitation: number; // e.g. 0.5
  weatherCode: number;
  weatherText: string;
  weatherEmoji: string;
  windSpeed: number; // e.g. 4.2
}

const fetchSingleLocationHourlyWeather = async (
  lat: number,
  lon: number,
  dateStr: string
): Promise<Record<string, HourlyWeatherData>> => {
  try {
    const todayStr = new Date().toISOString().substring(0, 10);
    const isPast = dateStr < todayStr;

    // 1. 過去日(dateStr < today)の場合は、実測データの確実な archive API を最優先で試行します
    const archiveJma = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${dateStr}&end_date=${dateStr}&hourly=temperature_2m,precipitation,weather_code,wind_speed_10m&models=jma_msm&timezone=Asia%2FTokyo&wind_speed_unit=ms`;
    const archiveFallback = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${dateStr}&end_date=${dateStr}&hourly=temperature_2m,precipitation,weather_code,wind_speed_10m&timezone=Asia%2FTokyo&wind_speed_unit=ms`;
    const forecastJma = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&start_date=${dateStr}&end_date=${dateStr}&hourly=temperature_2m,precipitation,weather_code,wind_speed_10m&models=jma_msm&timezone=Asia%2FTokyo&wind_speed_unit=ms`;
    const forecastFallback = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&start_date=${dateStr}&end_date=${dateStr}&hourly=temperature_2m,precipitation,weather_code,wind_speed_10m&timezone=Asia%2FTokyo&wind_speed_unit=ms`;

    const urlsToTry = isPast
      ? [archiveJma, archiveFallback, forecastJma, forecastFallback]
      : [forecastJma, forecastFallback, archiveJma, archiveFallback];

    let data: any = null;
    for (const url of urlsToTry) {
      try {
        const response = await fetch(url);
        if (response.ok) {
          const json = await response.json();
          // HTTP 200でも中身が [null, null, ...] の全データ欠損状態でないか検証
          if (
            json.hourly &&
            Array.isArray(json.hourly.temperature_2m) &&
            json.hourly.temperature_2m.some((v: any) => v !== null && v !== undefined)
          ) {
            data = json;
            break; // 有効な気象データ配列を取得完了
          }
        }
      } catch (e) {
        // 次のURLへフォールバック
      }
    }

    if (!data || !data.hourly || !data.hourly.time) {
      return {};
    }
    
    const result: Record<string, HourlyWeatherData> = {};
    for (let i = 0; i < data.hourly.time.length; i++) {
      const timeStr = data.hourly.time[i]; // e.g. "2026-06-25T06:00"
      const hourPart = timeStr.split('T')[1] || `${i.toString().padStart(2, '0')}:00`;
      const code = data.hourly.weather_code[i] ?? 3;
      const rawPrecip = data.hourly.precipitation[i] ?? 0;
      // 1.0mm未満の微小なモデル推計値（0.3mmや0.6mm）は気象庁アメダス実測値(0mm)に合わせて0.0mmにクリーニング
      const precip = rawPrecip < 1.0 ? 0 : Math.round(rawPrecip * 10) / 10;
      const desc = getWeatherDescription(code, precip);
      
      result[hourPart] = {
        hour: hourPart,
        temp: data.hourly.temperature_2m[i] ?? 0,
        precipitation: precip,
        weatherCode: code,
        weatherText: desc.text,
        weatherEmoji: desc.emoji,
        windSpeed: data.hourly.wind_speed_10m[i] ?? 0,
      };
    }
    return result;
  } catch (error) {
    console.error('Error fetching hourly weather:', error);
    return {};
  }
};

const getHourlyWeatherCache = (): Record<string, Record<string, HourlyWeatherData>> => {
  try {
    const saved = localStorage.getItem(HOURLY_WEATHER_CACHE_KEY);
    return saved ? JSON.parse(saved) : {};
  } catch {
    return {};
  }
};

const saveHourlyWeatherCache = (cache: Record<string, Record<string, HourlyWeatherData>>) => {
  try {
    localStorage.setItem(HOURLY_WEATHER_CACHE_KEY, JSON.stringify(cache));
  } catch (err) {
    console.warn('Failed to save hourly weather cache:', err);
  }
};

/**
 * 気象庁「沓形 × 本泊」のクロス分析に基づく時間帯別の気象データを返します。
 * （過去日は自動キャッシュ・保存され、次回選択時は0秒で表示されます）
 */
export const fetchHourlyWeatherData = async (
  _lat: number,
  _lon: number,
  dateStr: string
): Promise<Record<string, HourlyWeatherData>> => {
  const cache = getHourlyWeatherCache();
  if (cache[dateStr]) {
    return cache[dateStr];
  }

  const [kutsugata, motodomari] = await Promise.all([
    fetchSingleLocationHourlyWeather(KUTSUGATA_LAT, KUTSUGATA_LON, dateStr),
    fetchSingleLocationHourlyWeather(MOTODOMARI_LAT, MOTODOMARI_LON, dateStr)
  ]);

  const allHours = new Set([...Object.keys(kutsugata), ...Object.keys(motodomari)]);
  const combined: Record<string, HourlyWeatherData> = {};

  allHours.forEach(hour => {
    const k = kutsugata[hour];
    const m = motodomari[hour];
    if (k && m) {
      const precip = Math.max(k.precipitation, m.precipitation);
      const code = precip > 2 ? 65 : (k.weatherCode > m.weatherCode ? k.weatherCode : m.weatherCode);
      const desc = getWeatherDescription(code, precip);
      combined[hour] = {
        hour,
        temp: Math.round(((k.temp + m.temp) / 2) * 10) / 10,
        precipitation: precip,
        weatherCode: code,
        weatherText: desc.text,
        weatherEmoji: desc.emoji,
        windSpeed: Math.max(k.windSpeed, m.windSpeed)
      };
    } else {
      combined[hour] = k || m;
    }
  });

  cache[dateStr] = combined;
  saveHourlyWeatherCache(cache);

  return combined;
};

/**
 * 保存された気象データのキャッシュを初期化（クリア）します
 */
export const clearWeatherCache = () => {
  try {
    localStorage.removeItem(DAILY_WEATHER_CACHE_KEY);
    localStorage.removeItem(HOURLY_WEATHER_CACHE_KEY);
  } catch (err) {
    console.warn('Failed to clear weather cache:', err);
  }
};

