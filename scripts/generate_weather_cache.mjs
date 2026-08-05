import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 気象庁アメダス観測点（利尻島）
const KUTSUGATA_LAT = 45.1870;
const KUTSUGATA_LON = 141.1410;
const MOTODOMARI_LAT = 45.2442;
const MOTODOMARI_LON = 141.2339;

// 日別データのパーサーヘルパー
const parseDailyDataIntoResult = (data, result) => {
  if (data && data.daily && data.daily.time) {
    for (let i = 0; i < data.daily.time.length; i++) {
      const date = data.daily.time[i];
      const sunshineSec = data.daily.sunshine_duration ? data.daily.sunshine_duration[i] : undefined;
      const sunshineHours = sunshineSec !== undefined && sunshineSec !== null
        ? Math.round((sunshineSec / 3600) * 10) / 10
        : undefined;

      const rawPrecip = data.daily.precipitation_sum[i] || 0;
      const precipThreshold = (sunshineHours && sunshineHours >= 4.0) ? 3.5 : 1.5;
      const precip = rawPrecip < precipThreshold ? 0 : Math.round(rawPrecip * 10) / 10;
      result[date] = {
        date,
        tempMax: data.daily.temperature_2m_max[i] || 0,
        tempMin: data.daily.temperature_2m_min[i] || 0,
        precipitation: precip,
        weatherCode: data.daily.weather_code[i] !== null ? data.daily.weather_code[i] : 1,
        windSpeedMax: data.daily.wind_speed_10m_max[i] || 0,
        windDirection: data.daily.wind_direction_10m_dominant[i] || 0,
        sunshineDuration: sunshineHours,
        isHeavyRain: precip >= 20.0
      };
    }
  }
};

const fetchSingleLocationWeather = async (lat, lon, startYear, endYear) => {
  const result = {};
  const todayStr = new Date().toISOString().substring(0, 10);

  // 年単位・期間ごとに堅牢に分割フェッチ
  for (let year = startYear; year <= endYear; year++) {
    const startDate = `${year}-01-01`;
    let endDate = `${year}-12-31`;
    if (endDate > todayStr) {
      endDate = todayStr;
    }
    if (startDate > todayStr) break;

    const url = year >= 2017
      ? `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${startDate}&end_date=${endDate}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code,wind_speed_10m_max,wind_direction_10m_dominant,sunshine_duration&models=jma_msm&timezone=Asia%2FTokyo&wind_speed_unit=ms`
      : `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${startDate}&end_date=${endDate}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code,wind_speed_10m_max,wind_direction_10m_dominant,sunshine_duration&timezone=Asia%2FTokyo&wind_speed_unit=ms`;

    console.log(`[Fetch] (${lat}, ${lon}) Year: ${year} -> ${startDate} to ${endDate}`);
    try {
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        parseDailyDataIntoResult(data, result);
      } else {
        console.warn(`[Warn] Failed to fetch year ${year} (status: ${res.status})`);
      }
    } catch (err) {
      console.warn(`[Warn] Error fetching year ${year}:`, err.message);
    }

    // レート制限防止のための小休止
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  return result;
};

async function generateWeatherCache() {
  console.log('=== 利尻山 (沓形×本泊) 気象データ自動生成スクリプト ===');

  const outputDir = path.join(__dirname, '../public/data');
  const outputPath = path.join(outputDir, 'weather-daily.json');

  let existingData = {};
  let startYear = 2010;
  const currentYear = new Date().getFullYear();

  if (fs.existsSync(outputPath)) {
    try {
      existingData = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
      const dates = Object.keys(existingData).sort();
      if (dates.length > 0) {
        const lastDate = dates[dates.length - 1];
        startYear = parseInt(lastDate.substring(0, 4), 10);
        console.log(`既存キャッシュあり。最新データ日付: ${lastDate}。${startYear}年以降のデータを差分取得します。`);
      }
    } catch (e) {
      console.warn('キャッシュの読み込みに失敗したため、全件取得します。');
    }
  } else {
    console.log(`対象期間: ${startYear}年 〜 ${currentYear}年`);
  }

  console.log('1. 沓形 (Kutsugata) の気象データを取得中...');
  const kutsugata = await fetchSingleLocationWeather(KUTSUGATA_LAT, KUTSUGATA_LON, startYear, currentYear);

  console.log('2. 本泊 (Motodomari) の気象データを取得中...');
  const motodomari = await fetchSingleLocationWeather(MOTODOMARI_LAT, MOTODOMARI_LON, startYear, currentYear);

  console.log('3. 両地点のデータをクロス分析して合算中...');
  const allDates = new Set([...Object.keys(kutsugata), ...Object.keys(motodomari)]);
  const combined = { ...existingData };

  const sortedDates = Array.from(allDates).sort();
  for (const date of sortedDates) {
    const k = kutsugata[date];
    const m = motodomari[date];
    if (k && m) {
      const kPrecip = k.precipitation || 0;
      const mPrecip = m.precipitation || 0;
      const precip = Math.round(Math.max(kPrecip, mPrecip) * 10) / 10;
      const sunshine = (k.sunshineDuration !== undefined && m.sunshineDuration !== undefined)
        ? Math.round(((k.sunshineDuration + m.sunshineDuration) / 2) * 10) / 10
        : (k.sunshineDuration ?? m.sunshineDuration);

      let mergedCode = k.weatherCode;
      if (precip >= 20) {
        mergedCode = 65;
      } else if (precip >= 3.0) {
        mergedCode = Math.max(k.weatherCode, m.weatherCode);
      } else {
        mergedCode = Math.min(k.weatherCode, m.weatherCode);
      }

      combined[date] = {
        date,
        tempMax: Math.round(((k.tempMax + m.tempMax) / 2) * 10) / 10,
        tempMin: Math.round(((k.tempMin + m.tempMin) / 2) * 10) / 10,
        precipitation: precip,
        weatherCode: mergedCode,
        windSpeedMax: Math.max(k.windSpeedMax, m.windSpeedMax),
        windDirection: k.windDirection,
        sunshineDuration: sunshine,
        isHeavyRain: precip >= 20.0
      };
    } else {
      combined[date] = k || m;
    }
  }

  const recordCount = Object.keys(combined).length;
  console.log(`生成完了: 合計 ${recordCount} 日分の気象データを統合しました。`);

  // 出力ディレクトリ準備
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, JSON.stringify(combined), 'utf-8');

  console.log(`✅ 保存完了: ${outputPath}`);
  console.log('これで誰がアクセスしても通信0秒の瞬時読み込みが可能になります！');
}

generateWeatherCache().catch(err => {
  console.error('気象データ自動生成中にエラーが発生しました:', err);
  process.exit(1);
});
