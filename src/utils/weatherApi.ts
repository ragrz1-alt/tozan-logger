import { evaluateDailyCameraVisibility, type ImageAnalysis } from '../hooks/useCameraAnalysis';

export interface StationDailyWeather {
  precipitation: number;
  maxHourlyPrecip?: number;
  tempMax: number;
  tempMin: number;
  windSpeedMax: number;
  windDirection: number;
  windDirectionText?: string;
  sunshineDuration?: number;
}

export interface WeatherData {
  date: string;
  tempMax: number;
  tempMin: number;
  precipitation: number;
  maxHourlyPrecip?: number;
  weatherCode: number;
  windSpeedMax: number;
  windDirection: number;
  sunshineDuration?: number; // hours (沓形アメダス実測)
  isHeavyRain?: boolean; // 大雨フラグ (日降水20mm以上 または 最大1時間降水10mm以上)
  source?: string; // 'jma_amedas'
  kutsugata?: StationDailyWeather;
  motodomari?: StationDailyWeather;
}

// 気象庁アメダス観測点（利尻島）
const PREC_NO = '11';
const BLOCK_KUTSUGATA = '0002';
const BLOCK_MOTODOMARI = '1512';
const KUTSUGATA_LAT = 45.1870;
const KUTSUGATA_LON = 141.1410;
const MOTODOMARI_LAT = 45.2442;
const MOTODOMARI_LON = 141.2339;

const DIR_TO_DEG: Record<string, number> = {
  '北': 0,
  '北北東': 22.5,
  '北東': 45,
  '東北東': 67.5,
  '東': 90,
  '東南東': 112.5,
  '南東': 135,
  '南南東': 157.5,
  '南': 180,
  '南南西': 202.5,
  '南西': 225,
  '西南西': 247.5,
  '西': 270,
  '西北西': 292.5,
  '北西': 315,
  '北北西': 337.5,
};

function parseJmaNumber(raw: string | undefined, isPrecip = false): number | null {
  if (!raw) return isPrecip ? 0 : null;
  const s = raw.replace(/\s+/g, '');
  if (s === '--') return isPrecip ? 0 : null;
  if (s.includes('///') || s.includes('×') || s === '') return null;
  const m = s.match(/-?\d+(\.\d+)?/);
  if (!m) return isPrecip ? 0 : null;
  return parseFloat(m[0]);
}

function parseJmaWindDir(raw: string | undefined): { text: string; deg: number } {
  if (!raw) return { text: '不明', deg: 0 };
  const clean = raw.replace(/[)\]\s#]/g, '').trim();
  if (clean in DIR_TO_DEG) {
    return { text: clean, deg: DIR_TO_DEG[clean] };
  }
  return { text: clean || '不明', deg: 0 };
}

function deriveWeatherCodeFromAmedas(
  precip: number,
  maxHourlyPrecip: number,
  sunshine?: number
): number {
  const p = precip || 0;
  const p1h = maxHourlyPrecip || 0;
  if (p >= 20.0 || p1h >= 10.0) return 65;
  if (p >= 3.0) {
    if (sunshine !== undefined && sunshine >= 5.0 && p < 6.0) return 2;
    return 61;
  }
  if (p >= 1.0 && (sunshine === undefined || sunshine < 4.0)) return 61;
  if (sunshine !== undefined) {
    if (sunshine >= 8.0) return 0;
    if (sunshine >= 4.0) return 1;
    if (p >= 0.5) return 51;
    return 3;
  }
  return p >= 1.0 ? 61 : 3;
}

const HOURLY_WEATHER_CACHE_KEY = 'tozan_weather_hourly_amedas_v1';

// Convert wind direction degrees (0-360) to 16 compass points
export const getWindDirection = (degree: number) => {
  const directions = ['北', '北北東', '北東', '東北東', '東', '東南東', '南東', '南南東', '南', '南南西', '南西', '西南西', '西', '西北西', '北西', '北北西'];
  const val = Math.floor((degree / 22.5) + 0.5);
  return directions[(val % 16)];
};

export const getWindDirectionText = (deg?: number): string => {
  if (deg === undefined || deg === null || isNaN(deg)) return '-';
  const directions = ['北', '北北東', '北東', '東北東', '東', '東南東', '南東', '南南東', '南', '南南西', '南西', '西南西', '西', '西北西', '北西', '北北西'];
  const index = Math.round((deg % 360) / 22.5) % 16;
  return directions[index];
};

const getDatesInRange = (start: string, end: string): string[] => {
  const dates: string[] = [];
  const curr = new Date(start);
  const endDt = new Date(end);
  while (curr <= endDt) {
    dates.push(curr.toISOString().substring(0, 10));
    curr.setDate(curr.getDate() + 1);
  }
  return dates;
};

// サーバー側/ビルド時に同梱された静的JSON（weather-daily.json）を即時に読むインメモリキャッシュ
// ※ localStorageの5MB枠を圧迫しないよう、日別キャッシュはインメモリで保持する
let staticDailyWeatherCache: Record<string, WeatherData> | null = null;
let isLoadingStaticDailyCache = false;

const loadStaticDailyWeatherCache = async (): Promise<Record<string, WeatherData>> => {
  if (staticDailyWeatherCache) {
    return staticDailyWeatherCache;
  }
  if (isLoadingStaticDailyCache) {
    while (isLoadingStaticDailyCache) {
      await new Promise(r => setTimeout(r, 50));
    }
    return staticDailyWeatherCache || {};
  }
  isLoadingStaticDailyCache = true;
  try {
    const res = await fetch('/data/weather-daily.json');
    if (res.ok) {
      staticDailyWeatherCache = await res.json();
    } else {
      staticDailyWeatherCache = {};
    }
  } catch {
    staticDailyWeatherCache = {};
  } finally {
    isLoadingStaticDailyCache = false;
  }
  return staticDailyWeatherCache || {};
};

/**
 * 気象庁公式「過去の気象データ検索 (daily_a1.php)」から指定年月のアメダス実測データを直接取得する
 */
async function fetchJmaMonthlyStationBrowser(
  blockNo: string,
  year: number,
  month: number,
  hasSunshine: boolean
): Promise<Record<string, StationDailyWeather>> {
  const url = `https://www.data.jma.go.jp/stats/etrn/view/daily_a1.php?prec_no=${PREC_NO}&block_no=${blockNo}&year=${year}&month=${month}&day=&view=`;
  const map: Record<string, StationDailyWeather> = {};
  try {
    const res = await fetch(url);
    if (!res.ok) return map;
    const html = await res.text();
    const rows = html.split('<tr class=').slice(4);
    const mStr = String(month).padStart(2, '0');

    for (const r of rows) {
      const tds = r
        .split('<td')
        .slice(1)
        .map(s =>
          s
            .replace(/^[^>]*>/, '')
            .split('</td>')[0]
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/g, '')
            .trim()
        );
      if (tds.length < 16 || !/^\d+$/.test(tds[0])) continue;

      const dayNum = parseInt(tds[0], 10);
      if (dayNum < 1 || dayNum > 31) continue;
      const dateStr = `${year}-${mStr}-${String(dayNum).padStart(2, '0')}`;

      const precip = parseJmaNumber(tds[1], true);
      const maxHourlyPrecip = parseJmaNumber(tds[2], true);
      const tempAvg = parseJmaNumber(tds[4], false);
      const tempMax = parseJmaNumber(tds[5], false);
      const tempMin = parseJmaNumber(tds[6], false);
      const windSpeedMax = parseJmaNumber(tds[10], false);
      const windDirObj = parseJmaWindDir(tds[11]);
      const sunshine = hasSunshine ? parseJmaNumber(tds[15], false) : null;

      if (tempMax === null && tempMin === null && tempAvg === null && windSpeedMax === null) {
        continue;
      }

      map[dateStr] = {
        precipitation: precip ?? 0,
        maxHourlyPrecip: maxHourlyPrecip ?? 0,
        tempMax: tempMax ?? tempAvg ?? 0,
        tempMin: tempMin ?? tempAvg ?? 0,
        windSpeedMax: windSpeedMax ?? 0,
        windDirection: windDirObj.deg,
        windDirectionText: windDirObj.text,
        sunshineDuration: sunshine !== null ? sunshine : undefined,
      };
    }
  } catch {
    // ignore network error
  }
  return map;
}

/**
 * 気象庁アメダス「沓形 (0002)」と「本泊 (1512)」の実測データを掛け合わせた総合気象データを返します。
 */
export const fetchWeatherData = async (
  _lat: number,
  _lon: number,
  startDate: string,
  endDate: string
): Promise<Record<string, WeatherData>> => {
  const staticCache = await loadStaticDailyWeatherCache();
  const todayStr = new Date().toISOString().substring(0, 10);
  const safeEnd = endDate > todayStr ? todayStr : endDate;
  const dates = getDatesInRange(startDate, safeEnd);

  // 未取得の日付がある月だけ JMA アメダスから差分取得してインメモリキャッシュを補完
  const missingDates = dates.filter(d => !staticCache[d]);
  if (missingDates.length > 0) {
    const ymSet = new Set(missingDates.map(d => d.substring(0, 7)));
    for (const ym of ymSet) {
      const [yStr, mStr] = ym.split('-');
      const y = parseInt(yStr, 10);
      const m = parseInt(mStr, 10);
      const [kMap, mMap] = await Promise.all([
        fetchJmaMonthlyStationBrowser(BLOCK_KUTSUGATA, y, m, true),
        fetchJmaMonthlyStationBrowser(BLOCK_MOTODOMARI, y, m, false),
      ]);
      const allD = new Set([...Object.keys(kMap), ...Object.keys(mMap)]);
      allD.forEach(date => {
        const k = kMap[date];
        const mo = mMap[date];
        if (k && mo) {
          const precip = Math.round(Math.max(k.precipitation, mo.precipitation) * 10) / 10;
          const maxHourlyPrecip = Math.round(
            Math.max(k.maxHourlyPrecip || 0, mo.maxHourlyPrecip || 0) * 10
          ) / 10;
          const sunshine = k.sunshineDuration;
          const strongerWind = mo.windSpeedMax > k.windSpeedMax ? mo : k;
          staticCache[date] = {
            date,
            tempMax: Math.round(((k.tempMax + mo.tempMax) / 2) * 10) / 10,
            tempMin: Math.round(((k.tempMin + mo.tempMin) / 2) * 10) / 10,
            precipitation: precip,
            maxHourlyPrecip,
            weatherCode: deriveWeatherCodeFromAmedas(precip, maxHourlyPrecip, sunshine),
            windSpeedMax: Math.max(k.windSpeedMax, mo.windSpeedMax),
            windDirection: strongerWind.windDirection,
            sunshineDuration: sunshine,
            isHeavyRain: precip >= 20.0 || maxHourlyPrecip >= 10.0,
            source: 'jma_amedas',
            kutsugata: k,
            motodomari: mo,
          };
        } else if (k || mo) {
          const single = (k || mo)!;
          const precip = single.precipitation || 0;
          const maxHourlyPrecip = single.maxHourlyPrecip || 0;
          const sunshine = k ? k.sunshineDuration : undefined;
          staticCache[date] = {
            date,
            tempMax: single.tempMax,
            tempMin: single.tempMin,
            precipitation: precip,
            maxHourlyPrecip,
            weatherCode: deriveWeatherCodeFromAmedas(precip, maxHourlyPrecip, sunshine),
            windSpeedMax: single.windSpeedMax,
            windDirection: single.windDirection,
            sunshineDuration: sunshine,
            isHeavyRain: precip >= 20.0 || maxHourlyPrecip >= 10.0,
            source: 'jma_amedas',
            kutsugata: k || undefined,
            motodomari: mo || undefined,
          };
        }
      });
    }
  }

  const finalResult: Record<string, WeatherData> = {};
  getDatesInRange(startDate, endDate).forEach(d => {
    if (staticCache[d]) {
      finalResult[d] = staticCache[d];
    }
  });
  return finalResult;
};

/**
 * 【気象庁アメダス実測 × 3方向ライブカメラAI ハイブリッド・クロス天候分類】
 * 1. カメラ未解析の日・過去年:
 *    - 大雨 (HeavyRain): 日降水 20.0mm以上 または 最大1時間降水10mm以上(code=65)
 *    - 雨 (Rainy): 日降水 3.0mm以上 (※ただし日照5.0時間以上かつ6mm未満の「日中快晴・夜間通り雨」はSunnyに救済)、
 *                  または 日降水 1.0〜2.5mm かつ 日照 4.0時間未満
 *    - 晴れ (Sunny): 沓形アメダス実測日照時間が 4.0時間以上
 *    - 曇り (Cloudy): 日降水 3.0mm未満 かつ 実測日照時間が 4.0時間未満
 * 2. カメラAI解析データ (camData) がある日:
 *    - 【カメラ救済】: 沓形市街地だけ海霧・雲で日照が 4.0h未満 でも、3方向カメラで山頂快晴(clear) または
 *                      日差し比率(sunnyRatio) 45%以上 または 平均雲量 5.0以下 なら「Sunny」へ救済
 *    - 【カメラ抑制】: 沓形海岸だけ 4.0〜6.5h の日照が出ても、3方向カメラすべてで終日山頂不可視(clearCount=0) かつ
 *                      平均雲量 8.5以上 かつ 日差し比率 20%未満 なら「Cloudy」へ抑制
 */
export const getWeatherCategory = (
  code: number,
  precipitation?: number,
  sunshineHours?: number,
  _dateStr?: string,
  camData?: ImageAnalysis[]
): 'Sunny' | 'Cloudy' | 'Rainy' | 'HeavyRain' => {
  const precip = precipitation || 0;

  // Step 1: 大雨・豪雨判定 (20mm以上 または 最大1時間10mm以上)
  if (precip >= 20.0 || code === 65) {
    return 'HeavyRain';
  }

  const camEval = camData && camData.length > 0 ? evaluateDailyCameraVisibility(camData) : null;
  const hasCam = camEval !== null && camEval.validCount > 0;

  // Step 2: 雨判定 ＆ 夜間通り雨の救済
  if (precip >= 3.0) {
    // 3.0〜5.5mm程度の雨でも、日中に実測日照が5.0時間以上（またはカメラの半数以上が晴天）なら「夜間通り雨・日中晴れ」
    const isDaytimeSunny =
      (sunshineHours !== undefined && sunshineHours !== null && sunshineHours >= 5.0) ||
      (hasCam && camEval.sunnyRatio >= 0.5 && camEval.mountainCategory === 'clear');
    if (precip < 6.0 && isDaytimeSunny) {
      return 'Sunny';
    }
    return 'Rainy';
  }

  if (precip >= 1.0) {
    // 1.0〜2.5mmの小雨: 日照が4.0時間未満 かつ カメラでも晴れていない場合は雨天
    const hasGoodSun = sunshineHours !== undefined && sunshineHours !== null && sunshineHours >= 4.0;
    const isCamSunny =
      hasCam &&
      (camEval.mountainCategory === 'clear' ||
        camEval.sunnyRatio >= 0.45 ||
        (camEval.avgCloudCover !== null && camEval.avgCloudCover <= 5.0));
    if (!hasGoodSun && !isCamSunny) {
      return 'Rainy';
    }
  }

  // Step 3: 3方向カメラ × アメダス日照のクロス判定（カメラデータがある場合）
  if (hasCam) {
    // パターンA【救済】: 沓形市街地の日照が短くても、鴛泊・仙法志を含む3方向カメラで好天・山頂快晴が確認された日
    if (
      camEval.mountainCategory === 'clear' ||
      camEval.sunnyRatio >= 0.45 ||
      (camEval.avgCloudCover !== null && camEval.avgCloudCover <= 5.0)
    ) {
      return 'Sunny';
    }

    // パターンB【抑制】: 沓形海岸だけ少し日照(4.0〜6.5h)が出たが、3方向カメラ全て終日濃霧・全天曇天だった日
    if (
      sunshineHours !== undefined &&
      sunshineHours !== null &&
      sunshineHours < 6.5 &&
      camEval.clearCount === 0 &&
      camEval.sunnyRatio < 0.2 &&
      camEval.avgCloudCover !== null &&
      camEval.avgCloudCover >= 8.5
    ) {
      return 'Cloudy';
    }
  }

  // Step 4: アメダス実測日照時間による標準判定
  if (sunshineHours !== undefined && sunshineHours !== null) {
    if (sunshineHours >= 4.0) {
      return 'Sunny';
    }
    return 'Cloudy';
  }

  // 日照時間データ自体が存在しない場合のフォールバック
  if (code === 0 || code === 1 || code === 2) return 'Sunny';
  if (code >= 60) return 'Rainy';
  return 'Cloudy';
};

/**
 * 実測アメダス値とカメラ解析結果から日本語天気ラベルと絵文字を返す
 */
export const getWeatherDescription = (
  code: number,
  precipitation?: number,
  sunshineHours?: number,
  dateStr?: string,
  camData?: ImageAnalysis[]
): { text: string; emoji: string } => {
  const precip = precipitation || 0;
  const cat = getWeatherCategory(code, precip, sunshineHours, dateStr, camData);

  if (cat === 'HeavyRain') {
    return { text: '大雨・荒天', emoji: '🚨' };
  }
  if (cat === 'Rainy') {
    if (precip < 3.0) {
      return { text: '小雨・曇り一時雨', emoji: '🌧️' };
    }
    return { text: '雨', emoji: '☔' };
  }
  if (cat === 'Sunny') {
    if (precip >= 1.0) {
      return { text: '晴れ (一時通り雨)', emoji: '🌤️' };
    }
    if (sunshineHours !== undefined && sunshineHours !== null && sunshineHours >= 8.0) {
      return { text: '快晴', emoji: '☀️' };
    }
    if (sunshineHours !== undefined && sunshineHours !== null && sunshineHours < 4.0) {
      return { text: '晴れ (沓形霧・山岳好天)', emoji: '🌤️' };
    }
    return { text: '晴れ時々曇り', emoji: '⛅' };
  }

  // Cloudy
  if (precip >= 0.5) {
    return { text: '曇り (一時微雨)', emoji: '☁️' };
  }
  return { text: '曇り', emoji: '☁️' };
};

export const getWeatherCategoryColor = (category: string) => {
  if (category === 'HeavyRain') return '#ef4444'; // Red (大雨・荒天アラート)
  if (category === 'Sunny') return '#fbbf24'; // Orange/Yellow (晴れ)
  if (category === 'Cloudy') return '#94a3b8'; // Gray (曇り)
  if (category === 'Rainy') return '#3b82f6'; // Blue (雨)
  return '#10b981';
};

export interface HourlyWeatherData {
  hour: string; // "00:00" to "23:00"
  temp: number;
  precipitation: number;
  sunshine?: number; // 0.0 to 1.0 h (沓形アメダス1時間日照)
  weatherCode: number;
  weatherText: string;
  weatherEmoji: string;
  windSpeed: number;
  windDirection?: number;
  windDirectionText?: string;
  kutsugata?: {
    temp: number;
    precipitation: number;
    windSpeed: number;
    windDirectionText: string;
    sunshine?: number;
  };
  motodomari?: {
    temp: number;
    precipitation: number;
    windSpeed: number;
    windDirectionText: string;
  };
}

/**
 * 気象庁公式「1時間ごとの値 (hourly_a1.php)」から指定日のアメダス時間別実測データを取得する
 */
async function fetchJmaHourlyStation(
  blockNo: string,
  dateStr: string,
  hasSunshine: boolean
): Promise<
  Record<
    string,
    {
      temp: number;
      precipitation: number;
      windSpeed: number;
      windDirection: number;
      windDirectionText: string;
      sunshine?: number;
    }
  >
> {
  const [yStr, mStr, dStr] = dateStr.split('-');
  const year = parseInt(yStr, 10);
  const month = parseInt(mStr, 10);
  const day = parseInt(dStr, 10);
  const url = `https://www.data.jma.go.jp/stats/etrn/view/hourly_a1.php?prec_no=${PREC_NO}&block_no=${blockNo}&year=${year}&month=${month}&day=${day}&view=`;
  const result: Record<string, any> = {};

  try {
    const res = await fetch(url);
    if (!res.ok) return result;
    const html = await res.text();
    const rows = html.split('<tr class=').slice(3);

    for (const r of rows) {
      const tds = r
        .split('<td')
        .slice(1)
        .map(s =>
          s
            .replace(/^[^>]*>/, '')
            .split('</td>')[0]
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/g, '')
            .trim()
        );
      if (tds.length < 9 || !/^\d+$/.test(tds[0])) continue;

      const hrNum = parseInt(tds[0], 10); // 1 to 24
      if (hrNum < 1 || hrNum > 24) continue;
      // JMAの1時〜24時を UIの "00:00"〜"23:00" (または1時->"01:00", 24時->"00:00" / "23:00") にマッピング
      const hourIndex = hrNum === 24 ? 0 : hrNum;
      const hourKey = `${String(hourIndex).padStart(2, '0')}:00`;

      const precip = parseJmaNumber(tds[1], true);
      const temp = parseJmaNumber(tds[2], false);
      const windSpeed = parseJmaNumber(tds[6], false);
      const windDirObj = parseJmaWindDir(tds[7]);
      const sunshine = hasSunshine ? parseJmaNumber(tds[8], false) : null;

      if (temp === null && windSpeed === null) continue;

      result[hourKey] = {
        temp: temp ?? 0,
        precipitation: precip ?? 0,
        windSpeed: windSpeed ?? 0,
        windDirection: windDirObj.deg,
        windDirectionText: windDirObj.text,
        sunshine: sunshine !== null ? sunshine : undefined,
      };
    }
  } catch {
    // ignore error
  }
  return result;
}

function getHourlyDescriptionFromAmedas(
  precip: number,
  sunshine?: number,
  hourIndex?: number
): { code: number; text: string; emoji: string } {
  if (precip >= 10.0) return { code: 65, text: '強い雨', emoji: '🚨' };
  if (precip >= 1.0) return { code: 61, text: '雨', emoji: '☔' };
  if (precip >= 0.5) return { code: 51, text: '小雨', emoji: '🌧️' };

  const isNight = hourIndex !== undefined && (hourIndex < 5 || hourIndex >= 19);
  if (sunshine !== undefined && sunshine !== null) {
    if (sunshine >= 0.7) return { code: 0, text: '快晴', emoji: '☀️' };
    if (sunshine >= 0.3) return { code: 1, text: '晴れ', emoji: '⛅' };
    if (isNight) return { code: 2, text: '夜間(無降水)', emoji: '🌙' };
    return { code: 3, text: '曇り', emoji: '☁️' };
  }

  return isNight
    ? { code: 2, text: '夜間(無降水)', emoji: '🌙' }
    : { code: 3, text: '曇り', emoji: '☁️' };
}

// インメモリの時間別キャッシュ
const hourlyMemoryCache: Record<string, Record<string, HourlyWeatherData>> = {};

/**
 * 気象庁アメダス「沓形 (0002) × 本泊 (1512)」の時間別実測データを取得して返します。
 */
export const fetchHourlyWeatherData = async (
  _lat: number,
  _lon: number,
  dateStr: string
): Promise<Record<string, HourlyWeatherData>> => {
  if (hourlyMemoryCache[dateStr]) {
    return hourlyMemoryCache[dateStr];
  }

  const [kutsugata, motodomari] = await Promise.all([
    fetchJmaHourlyStation(BLOCK_KUTSUGATA, dateStr, true),
    fetchJmaHourlyStation(BLOCK_MOTODOMARI, dateStr, false),
  ]);

  const allHours = new Set([...Object.keys(kutsugata), ...Object.keys(motodomari)]);
  const combined: Record<string, HourlyWeatherData> = {};

  allHours.forEach(hour => {
    const k = kutsugata[hour];
    const m = motodomari[hour];
    const hourNum = parseInt(hour.split(':')[0], 10);

    if (k && m) {
      const precip = Math.round(Math.max(k.precipitation, m.precipitation) * 10) / 10;
      const sunshine = k.sunshine;
      const desc = getHourlyDescriptionFromAmedas(precip, sunshine, hourNum);
      const strongerWind = m.windSpeed > k.windSpeed ? m : k;

      combined[hour] = {
        hour,
        temp: Math.round(((k.temp + m.temp) / 2) * 10) / 10,
        precipitation: precip,
        sunshine,
        weatherCode: desc.code,
        weatherText: desc.text,
        weatherEmoji: desc.emoji,
        windSpeed: Math.max(k.windSpeed, m.windSpeed),
        windDirection: strongerWind.windDirection,
        windDirectionText: strongerWind.windDirectionText,
        kutsugata: k,
        motodomari: m,
      };
    } else if (k || m) {
      const single = (k || m)!;
      const precip = single.precipitation || 0;
      const sunshine = k ? k.sunshine : undefined;
      const desc = getHourlyDescriptionFromAmedas(precip, sunshine, hourNum);

      combined[hour] = {
        hour,
        temp: single.temp,
        precipitation: precip,
        sunshine,
        weatherCode: desc.code,
        weatherText: desc.text,
        weatherEmoji: desc.emoji,
        windSpeed: single.windSpeed,
        windDirection: single.windDirection,
        windDirectionText: single.windDirectionText,
        kutsugata: k,
        motodomari: m,
      };
    }
  });

  if (Object.keys(combined).length > 0) {
    hourlyMemoryCache[dateStr] = combined;
  }

  return combined;
};

export const clearWeatherCache = () => {
  try {
    localStorage.removeItem(HOURLY_WEATHER_CACHE_KEY);
  } catch {}
};

export interface CurrentWeather {
  temp: number;
  windSpeed: number;
  windDirectionText: string;
  weatherText: string;
  weatherEmoji: string;
}

export const fetchCurrentWeather = async (): Promise<{
  kutsugata: CurrentWeather | null;
  motodomari: CurrentWeather | null;
}> => {
  const fetchNow = async (lat: number, lon: number): Promise<CurrentWeather | null> => {
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&wind_speed_unit=ms&timezone=Asia%2FTokyo`;
      const response = await fetch(url);
      if (!response.ok) return null;
      const data = await response.json();
      if (!data.current_weather) return null;

      const cw = data.current_weather;
      const code = cw.weathercode;
      const windSpeed = Math.round(cw.windspeed * 10) / 10;
      const desc = getWeatherDescription(code, 0);

      return {
        temp: cw.temperature,
        windSpeed,
        windDirectionText: getWindDirectionText(cw.winddirection),
        weatherText: desc.text,
        weatherEmoji: desc.emoji,
      };
    } catch {
      return null;
    }
  };

  const [kutsugata, motodomari] = await Promise.all([
    fetchNow(KUTSUGATA_LAT, KUTSUGATA_LON),
    fetchNow(MOTODOMARI_LAT, MOTODOMARI_LON),
  ]);

  return { kutsugata, motodomari };
};
