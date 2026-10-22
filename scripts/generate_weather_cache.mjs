import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 気象庁アメダス公式観測所番号（宗谷地方 prec_no=11）
// 沓形 (block_no=0002): 降水量・気温・風速・風向・日照時間・積雪
// 本泊 (block_no=1512 / 利尻空港): 降水量・気温・風速・風向 (※日照計なし)
const PREC_NO = '11';
const BLOCK_KUTSUGATA = '0002';
const BLOCK_MOTODOMARI = '1512';

const DIR_TO_DEG = {
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

/**
 * 気象庁セル文字列から数値を厳密に抽出する
 * - '--' (降水なし) は isPrecip=true のとき 0.0 として扱う
 * - '///', '×', '' (欠測・未観測) は null を返す
 * - '14.5 )' や '8.2 ]' (準正常値) は数値部分を抽出する
 */
function parseJmaNumber(raw, isPrecip = false) {
  if (!raw) return isPrecip ? 0 : null;
  const s = raw.replace(/\s+/g, '');
  if (s === '--') return isPrecip ? 0 : null;
  if (s.includes('///') || s.includes('×') || s === '') return null;
  const m = s.match(/-?\d+(\.\d+)?/);
  if (!m) return isPrecip ? 0 : null;
  return parseFloat(m[0]);
}

function parseJmaWindDir(raw) {
  if (!raw) return { text: '不明', deg: 0 };
  const clean = raw.replace(/[)\]\s#]/g, '').trim();
  if (clean in DIR_TO_DEG) {
    return { text: clean, deg: DIR_TO_DEG[clean] };
  }
  return { text: clean || '不明', deg: 0 };
}

/**
 * 実測アメダス値（降水量・最大1時間降水量・日照時間）から互換用WMO天気コードを算出する
 */
function deriveWeatherCodeFromAmedas(precip, maxHourlyPrecip, sunshine) {
  const p = precip || 0;
  const p1h = maxHourlyPrecip || 0;
  if (p >= 20.0 || p1h >= 10.0) return 65; // 大雨・豪雨
  // 夜間通り雨救済: 0.5〜4.0mm程度の降水があっても日中5.0時間以上晴れている場合は晴れ一時雨(1)
  if (p >= 3.0) {
    if (sunshine !== null && sunshine !== undefined && sunshine >= 5.0 && p < 6.0) {
      return 2; // 日中晴れ＋一時通り雨
    }
    return 61; // 雨
  }
  if (p >= 1.0 && (sunshine === null || sunshine === undefined || sunshine < 4.0)) {
    return 61; // 小雨・雨天
  }
  if (sunshine !== null && sunshine !== undefined) {
    if (sunshine >= 8.0) return 0; // 快晴
    if (sunshine >= 4.0) return 1; // 晴れ
    if (p >= 0.5) return 51; // 曇り一時微雨
    return 3; // 曇り
  }
  return p >= 1.0 ? 61 : 3;
}

/**
 * 指定された年・月・観測所(block_no)の気象庁アメダス日別実測テーブルを取得・パースする
 */

const BOSAI_KUTSUGATA = '11151';
const BOSAI_MOTODOMARI = '11091';
const DIRS_16 = ['北', '北北東', '北東', '東北東', '東', '東南東', '南東', '南南東', '南', '南南西', '南西', '西南西', '西', '西北西', '北西', '北北西'];

async function fetchJmaBosaiDailyStation(bosaiCode, dateStr, hasSunshine) {
  const ymd = dateStr.replace(/-/g, '');
  const blocks = ['00', '03', '06', '09', '12', '15', '18', '21'];
  const urls = blocks.map(b => `https://www.jma.go.jp/bosai/amedas/data/point/${bosaiCode}/${ymd}_${b}.json`);
  const resList = await Promise.all(
    urls.map(u => fetch(u).then(r => (r.ok ? r.json() : null)).catch(() => null))
  );
  let precipSum = 0;
  let maxHourlyPrecip = 0;
  let tempMax = -Infinity;
  let tempMin = Infinity;
  let windSpeedMax = 0;
  let windDirAtMax = 0;
  let sunSum = 0;
  let count = 0;

  for (const j of resList) {
    if (!j) continue;
    for (const [k, v] of Object.entries(j)) {
      const t = v.temp?.[0];
      if (t !== null && t !== undefined) {
        if (t > tempMax) tempMax = t;
        if (t < tempMin) tempMin = t;
        count++;
      }
      const w = v.wind?.[0];
      if (w !== null && w !== undefined && w > windSpeedMax) {
        windSpeedMax = w;
        const d16 = v.windDirection?.[0] || 0;
        windDirAtMax = (d16 * 22.5) % 360;
      }
      if (k.endsWith('0000')) {
        const p1h = v.precipitation1h?.[0] || 0;
        precipSum += p1h;
        if (p1h > maxHourlyPrecip) maxHourlyPrecip = p1h;
        if (hasSunshine && v.sun1h?.[0] !== null && v.sun1h?.[0] !== undefined) {
          sunSum += v.sun1h[0];
        }
      }
    }
  }
  if (count === 0) return null;
  const idx = Math.round((windDirAtMax % 360) / 22.5) % 16;
  return {
    precipitation: Math.round(precipSum * 10) / 10,
    maxHourlyPrecip: Math.round(maxHourlyPrecip * 10) / 10,
    tempMax: Math.round(tempMax * 10) / 10,
    tempMin: Math.round(tempMin * 10) / 10,
    windSpeedMax: Math.round(windSpeedMax * 10) / 10,
    windDirection: windDirAtMax,
    windDirectionText: DIRS_16[idx],
    sunshineDuration: hasSunshine ? Math.round(sunSum * 10) / 10 : undefined,
  };
}

async function fetchJmaMonthlyStation(blockNo, year, month, hasSunshine) {
  const url = `https://www.data.jma.go.jp/stats/etrn/view/daily_a1.php?prec_no=${PREC_NO}&block_no=${blockNo}&year=${year}&month=${month}&day=&view=`;
  const map = {};
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

      // 未来日などで全項目が未観測(null)の行はスキップ
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
  } catch (err) {
    console.warn(`[Warn] JMA fetch failed (${blockNo}, ${year}-${month}):`, err.message);
  }
  return map;
}

async function generateWeatherCache() {
  console.log('=== 利尻山 (気象庁アメダス実測: 沓形×本泊) 気象データ自動生成スクリプト ===');

  const outputDir = path.join(__dirname, '../public/data');
  const outputPath = path.join(outputDir, 'weather-daily.json');

  let existingData = {};
  const startYear = 2010;
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  if (fs.existsSync(outputPath)) {
    try {
      existingData = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
    } catch {
      console.warn('既存キャッシュの読み込みに失敗したため、新規生成します。');
    }
  }

  // 取得が必要な (year, month) のリストを作成
  // - 既に source === 'jma_amedas' で保存済みの過去月はスキップして0秒化
  // - 当月および前月は最新の実測値を反映するため常に再取得
  const tasks = [];
  for (let y = startYear; y <= currentYear; y++) {
    const maxM = y === currentYear ? currentMonth : 12;
    for (let m = 1; m <= maxM; m++) {
      const mStr = String(m).padStart(2, '0');
      const sampleDate = `${y}-${mStr}-15`;
      const isRecentMonth =
        (y === currentYear && m >= currentMonth - 1) ||
        (y === currentYear - 1 && currentMonth === 1 && m === 12);

      const alreadyJma =
        existingData[sampleDate] &&
        existingData[sampleDate].source === 'jma_amedas' &&
        existingData[sampleDate].kutsugata !== undefined;

      if (!alreadyJma || isRecentMonth) {
        tasks.push({ year: y, month: m });
      }
    }
  }

  console.log(`取得対象月数: ${tasks.length} ヶ月分 (沓形・本泊 アメダス実測値)`);

  const combined = { ...existingData };

  // 6ヶ月分ずつ並列バッチ取得（JMAサーバーへの負荷を抑えつつ高速取得）
  const BATCH_SIZE = 6;
  for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
    const chunk = tasks.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      chunk.map(async ({ year, month }) => {
        const [kMap, mMap] = await Promise.all([
          fetchJmaMonthlyStation(BLOCK_KUTSUGATA, year, month, true),
          fetchJmaMonthlyStation(BLOCK_MOTODOMARI, year, month, false),
        ]);
        return { year, month, kMap, mMap };
      })
    );

    for (const { kMap, mMap } of results) {
      const allDates = new Set([...Object.keys(kMap), ...Object.keys(mMap)]);
      for (const date of allDates) {
        const k = kMap[date];
        const m = mMap[date];
        if (k && m) {
          const precip = Math.round(Math.max(k.precipitation, m.precipitation) * 10) / 10;
          const maxHourlyPrecip = Math.round(Math.max(k.maxHourlyPrecip || 0, m.maxHourlyPrecip || 0) * 10) / 10;
          const sunshine = k.sunshineDuration; // 沓形アメダスの実測日照時間
          const strongerWind = m.windSpeedMax > k.windSpeedMax ? m : k;
          const weatherCode = deriveWeatherCodeFromAmedas(precip, maxHourlyPrecip, sunshine);

          combined[date] = {
            date,
            tempMax: Math.round(((k.tempMax + m.tempMax) / 2) * 10) / 10,
            tempMin: Math.round(((k.tempMin + m.tempMin) / 2) * 10) / 10,
            precipitation: precip,
            maxHourlyPrecip,
            weatherCode,
            windSpeedMax: Math.max(k.windSpeedMax, m.windSpeedMax),
            windDirection: strongerWind.windDirection,
            sunshineDuration: sunshine,
            isHeavyRain: precip >= 20.0 || maxHourlyPrecip >= 10.0,
            source: 'jma_amedas',
            kutsugata: k,
            motodomari: m,
          };
        } else {
          const single = k || m;
          const precip = single.precipitation || 0;
          const maxHourlyPrecip = single.maxHourlyPrecip || 0;
          const sunshine = k ? k.sunshineDuration : undefined;
          combined[date] = {
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
            motodomari: m || undefined,
          };
        }
      }
    }

    if ((i + BATCH_SIZE) % 24 === 0 || i + BATCH_SIZE >= tasks.length) {
      console.log(`進捗: ${Math.min(i + BATCH_SIZE, tasks.length)} / ${tasks.length} ヶ月完了`);
    }
    await new Promise(r => setTimeout(r, 120));
  }

  // 直近10日間について、JMA etrn が404等の場合でも JMA 防災アメダスJSON API (bosai/amedas) から最新実測値を補完
  const jstNow = new Date(Date.now() + 9 * 3600 * 1000);
  for (let offset = 10; offset >= 0; offset--) {
    const dt = new Date(jstNow);
    dt.setUTCDate(dt.getUTCDate() - offset);
    const dStr = dt.toISOString().split('T')[0];
    if (!combined[dStr] || combined[dStr].source !== 'jma_amedas' || offset <= 2) {
      const [k, m] = await Promise.all([
        fetchJmaBosaiDailyStation(BOSAI_KUTSUGATA, dStr, true),
        fetchJmaBosaiDailyStation(BOSAI_MOTODOMARI, dStr, false),
      ]);
      if (k && m) {
        const precip = Math.round(Math.max(k.precipitation, m.precipitation) * 10) / 10;
        const maxHourlyPrecip = Math.round(Math.max(k.maxHourlyPrecip || 0, m.maxHourlyPrecip || 0) * 10) / 10;
        const sunshine = k.sunshineDuration;
        const strongerWind = m.windSpeedMax > k.windSpeedMax ? m : k;
        combined[dStr] = {
          date: dStr,
          tempMax: Math.round(((k.tempMax + m.tempMax) / 2) * 10) / 10,
          tempMin: Math.round(((k.tempMin + m.tempMin) / 2) * 10) / 10,
          precipitation: precip,
          maxHourlyPrecip,
          weatherCode: deriveWeatherCodeFromAmedas(precip, maxHourlyPrecip, sunshine),
          windSpeedMax: Math.max(k.windSpeedMax, m.windSpeedMax),
          windDirection: strongerWind.windDirection,
          sunshineDuration: sunshine,
          isHeavyRain: precip >= 20.0 || maxHourlyPrecip >= 10.0,
          source: 'jma_amedas',
          kutsugata: k,
          motodomari: m,
        };
      }
    }
  }

  // 日付順にソートして保存
  const sortedCombined = {};
  for (const d of Object.keys(combined).sort()) {
    sortedCombined[d] = combined[d];
  }

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, JSON.stringify(sortedCombined), 'utf-8');
  console.log(`✅ 保存完了: 合計 ${Object.keys(sortedCombined).length} 日分のアメダス実測気象データを統合しました (${outputPath})`);
}

generateWeatherCache().catch(err => {
  console.error('気象データ自動生成中にエラーが発生しました:', err);
  process.exit(1);
});
