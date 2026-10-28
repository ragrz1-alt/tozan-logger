/**
 * 利尻山 YouTubeライブカメラ 【Playwright 仮想ドメイン iframe + Canvas 生フレーム直接抽出】
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outputDir = path.join(__dirname, '../public/cams/test_poc_archive');

const TARGET_CAMERAS = [
  { id: 'oshidomari_port', name: '鴛泊港（フェリーターミナル）', videoId: '8BwfUCuPcVE' },
  { id: 'himenuma', name: '姫沼（逆さ利尻富士）', videoId: 'wL2i45IZfvs' },
  { id: 'otadomari', name: 'オタドマリ沼（南東展望）', videoId: 'enBReBFAk7U' }
];

function ensureDirectoryExistence(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

async function runPlaywrightCapture() {
  ensureDirectoryExistence(outputDir);
  const nowStr = new Date().toISOString();
  const statusJson = {
    updatedAt: nowStr,
    engine: 'PLAYWRIGHT_IFRAME_CANVAS_PURE',
    results: {}
  };

  let browser;
  try {
    try {
      browser = await chromium.launch({
        channel: 'chrome',
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--autoplay-policy=no-user-gesture-required',
          '--disable-blink-features=AutomationControlled'
        ]
      });
    } catch {
      browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--autoplay-policy=no-user-gesture-required',
          '--disable-blink-features=AutomationControlled'
        ]
      });
    }

    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    });

    for (const cam of TARGET_CAMERAS) {
      const latestFilename = `${cam.id}_latest.jpg`;
      const outputPath = path.join(outputDir, latestFilename);

      console.log(`\n[Playwright 生フレーム抽出] ${cam.name} (ID: ${cam.videoId})`);

      try {
        const page = await context.newPage();
        const virtualOrigin = 'https://rishiri-trail-analytics.web.app/';
        await page.route(virtualOrigin, route => {
          route.fulfill({
            status: 200,
            contentType: 'text/html; charset=utf-8',
            body: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#000;overflow:hidden;width:1280px;height:720px;}</style></head>
<body>
  <iframe
    id="yt-frame"
    width="1280"
    height="720"
    src="https://www.youtube.com/embed/${cam.videoId}?autoplay=1&mute=1&playsinline=1&controls=0&modestbranding=1&rel=0"
    frameborder="0"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
    referrerpolicy="strict-origin-when-cross-origin"
    allowfullscreen
    style="border:none;display:block;width:1280px;height:720px;"
  ></iframe>
</body>
</html>`
          });
        });

        await page.goto(virtualOrigin, { waitUntil: 'domcontentloaded', timeout: 30000 });
        const frameElement = await page.waitForSelector('#yt-frame', { timeout: 10000 });
        const frame = await frameElement.contentFrame();

        let dataUrl = null;
        if (frame) {
          await frame.waitForSelector('video', { timeout: 12000 });
          for (let attempt = 0; attempt < 20; attempt++) {
            const state = await frame.evaluate(() => {
              const v = document.querySelector('video');
              if (!v) return { ready: false };
              if (v.paused) {
                v.muted = true;
                v.play().catch(() => {});
              }
              if (v.readyState >= 2 && v.videoWidth > 0 && v.currentTime > 0) {
                const canvas = document.createElement('canvas');
                const targetW = 800;
                const targetH = Math.round((v.videoHeight / v.videoWidth) * targetW) || 450;
                canvas.width = targetW;
                canvas.height = targetH;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(v, 0, 0, targetW, targetH);
                // 段階的に品質を調整して60KB以下に収める
                for (const q of [0.82, 0.72, 0.62, 0.52]) {
                  const url = canvas.toDataURL('image/jpeg', q);
                  const approxBytes = Math.round((url.length - 23) * 0.75);
                  if (approxBytes <= 60000 || q === 0.52) {
                    return { ready: true, dataUrl: url, width: v.videoWidth, height: v.videoHeight };
                  }
                }
              }
              return { ready: false, readyState: v.readyState, videoWidth: v.videoWidth };
            });

            if (state.ready && state.dataUrl) {
              dataUrl = state.dataUrl;
              break;
            }
            await page.waitForTimeout(500);
          }
        }

        await page.close();

        if (dataUrl) {
          const base64Data = dataUrl.replace(/^data:image\/jpeg;base64,/, '');
          const buf = Buffer.from(base64Data, 'base64');
          fs.writeFileSync(outputPath, buf);
          const sizeKB = Number((buf.length / 1024).toFixed(1));
          console.log(` ✅ 純粋映像フレーム抽出成功! (${sizeKB} KB)`);
          statusJson.results[cam.id] = {
            success: true,
            path: `/cams/test_poc_archive/${latestFilename}`,
            sizeKB,
            capturedAt: nowStr
          };
        } else {
          throw new Error('video要素からのフレーム抽出タイムアウト');
        }
      } catch (err) {
        console.log(` ❌ 失敗 ${cam.id}: ${err.message.split('\n')[0]}`);
        statusJson.results[cam.id] = {
          success: false,
          error: err.message.split('\n')[0],
          capturedAt: nowStr
        };
      }
    }
  } finally {
    if (browser) await browser.close();
  }

  fs.writeFileSync(path.join(outputDir, 'poc_status.json'), JSON.stringify(statusJson, null, 2), 'utf-8');
}

runPlaywrightCapture();
