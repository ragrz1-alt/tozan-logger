/**
 * 利尻山 YouTubeライブカメラ PoC 【Playwright ヘッドレスブラウザ リアルタイム生キャプチャ版】
 * 
 * 対象カメラ:
 *  - 鴛泊 (8BwfUCuPcVE)
 *  - 姫沼 (_CTve3fF0W4)
 *  - オタドマリ (enBReBFAk7U)
 * 
 * GitHub Actions (クラウドサーバーIP) でもサムネイルへフォールバックせず、
 * 実際のブラウザ (Chromium) で動画再生フレームを表示させ、
 * 直接生フレームを撮影・保存する実証実験スクリプトです。
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outputDir = path.join(__dirname, '../public/cams/test_poc_archive');
const ffmpegExe = path.join(__dirname, '../node_modules/ffmpeg-static/ffmpeg.exe');

const TARGET_CAMERAS = [
  { id: 'oshidomari', name: '鴛泊（鴛泊）', videoId: '8BwfUCuPcVE' },
  { id: 'himenuma', name: '姫沼（逆さ利尻富士）', videoId: '_CTve3fF0W4' },
  { id: 'otadomari', name: 'オタドマリ（南麓展望）', videoId: 'enBReBFAk7U' }
];

function ensureDirectoryExistence(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function compressTo50KB(imagePath) {
  try {
    if (!fs.existsSync(imagePath)) return;
    let sizeBytes = fs.statSync(imagePath).size;
    if (sizeBytes > 50000) {
      for (let q = 4; q <= 31; q += 4) {
        const tmpPath = imagePath + '.tmp.jpg';
        try {
          execSync(`"${ffmpegExe}" -y -i "${imagePath}" -vf "scale=800:-1" -q:v ${q} "${tmpPath}"`, {
            stdio: ['ignore', 'ignore', 'ignore']
          });
          if (fs.existsSync(tmpPath) && fs.statSync(tmpPath).size > 1000) {
            const tmpSize = fs.statSync(tmpPath).size;
            fs.renameSync(tmpPath, imagePath);
            sizeBytes = tmpSize;
            if (sizeBytes <= 50000) break;
          }
        } catch (e) {
          break;
        }
      }
      if (sizeBytes > 50000) {
        for (const w of [640, 500, 400]) {
          const tmpPath = imagePath + '.tmp.jpg';
          try {
            execSync(`"${ffmpegExe}" -y -i "${imagePath}" -vf "scale=${w}:-1" -q:v 8 "${tmpPath}"`, {
              stdio: ['ignore', 'ignore', 'ignore']
            });
            if (fs.existsSync(tmpPath) && fs.statSync(tmpPath).size > 1000) {
              const tmpSize = fs.statSync(tmpPath).size;
              fs.renameSync(tmpPath, imagePath);
              sizeBytes = tmpSize;
              if (sizeBytes <= 50000) break;
            }
          } catch (e) {
            break;
          }
        }
      }
    }
  } catch (e) {
    console.error(`[WARN] 圧縮例外: ${e}`);
  }
}

async function runPlaywrightCapture() {
  console.log('================================================================');
  console.log(' 🧪 利尻山 ライブカメラ 【Playwright ブラウザ生撮影】 PoC 実験');
  console.log('    (クラウドIP制限を突破して生映像スクリーンショットを取得)');
  console.log('================================================================\n');

  ensureDirectoryExistence(outputDir);
  const nowStr = new Date().toISOString();
  const statusJson = {
    updatedAt: nowStr,
    engine: 'PLAYWRIGHT_HEADLESS_BROWSER',
    results: {}
  };

  let browser;
  try {
    console.log(' -> Playwright ヘッドレス Chromium ブラウザを起動中...');
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--autoplay-policy=no-user-gesture-required'
      ]
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
    });

    for (const cam of TARGET_CAMERAS) {
      const embedUrl = `https://www.youtube.com/embed/${cam.videoId}?autoplay=1&mute=1&controls=0&modestbranding=1`;
      const latestFilename = `${cam.id}_latest.jpg`;
      const outputPath = path.join(outputDir, latestFilename);

      console.log(`\n[Playwright 撮影試行] ${cam.name} (ID: ${cam.videoId})`);
      console.log(` -> 埋め込みプレイヤーURL: ${embedUrl}`);

      try {
        const page = await context.newPage();
        await page.goto(embedUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // 動画ロードと再生を安定して待機
        console.log(' -> 映像ストリームのロード及び実フレームレンダリングを待機中 (8秒)...');
        await page.waitForTimeout(8000);

        // クッキー同意ボタン等があれば念のためクリック
        try {
          const agreeBtn = await page.$('button[aria-label="Agree"], button:has-text("同意する")');
          if (agreeBtn) {
            await agreeBtn.click();
            await page.waitForTimeout(2000);
          }
        } catch (_) {}

        // 動画プレイヤー領域を中心にスクリーンショット
        console.log(' -> ブラウザ画面から実際の再生映像を JPEG スクリーンショット撮影中...');
        await page.screenshot({
          path: outputPath,
          type: 'jpeg',
          quality: 85,
          fullPage: false
        });

        await page.close();

        if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000) {
          // 必ず50KB以下に軽量最適化
          compressTo50KB(outputPath);

          const sizeKB = Number((fs.statSync(outputPath).size / 1024).toFixed(1));
          console.log(` ✅ 【大成功】 Playwrightにより現在流れている生映像を撮影保存! (${sizeKB} KB)`);
          statusJson.results[cam.id] = {
            success: true,
            path: `/cams/test_poc_archive/${latestFilename}`,
            sizeKB: sizeKB,
            capturedAt: nowStr,
            mode: 'PLAYWRIGHT_REAL_STREAM'
          };
        } else {
          throw new Error('スクリーンショット画像が不正です。');
        }
      } catch (err) {
        console.log(` ❌ 【撮影失敗】 ${cam.id}: ${err.message.split('\n')[0]}`);
        statusJson.results[cam.id] = {
          success: false,
          error: err.message.split('\n')[0],
          capturedAt: nowStr
        };
      }
    }
  } catch (error) {
    console.error(' [CRITICAL ERROR] ブラウザ起動処理例外:', error);
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  const statusPath = path.join(outputDir, 'poc_status.json');
  fs.writeFileSync(statusPath, JSON.stringify(statusJson, null, 2), 'utf-8');

  console.log('\n================================================================');
  console.log(' 🎉 Playwright 実証実験 (PoC) キャプチャ処理が完了しました!');
  console.log('================================================================');
}

runPlaywrightCapture();
