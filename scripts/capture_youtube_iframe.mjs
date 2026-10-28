/**
 * YouTube Live カスタムサムネイル突破＆純粋映像フレーム抽出スクリプト
 * (Playwright 仮想ドメイン iframe 埋め込み + HTML5 <video> -> <canvas> 直接キャプチャ)
 *
 * 使い方:
 *   node scripts/capture_youtube_iframe.mjs <videoId> <outputPath>
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const [, , videoId, outputPath] = process.argv;

if (!videoId || !outputPath) {
  console.error('Usage: node scripts/capture_youtube_iframe.mjs <videoId> <outputPath>');
  process.exit(1);
}

async function captureYouTubeLiveFrame(vid, outFile) {
  let browser;
  try {
    const launchArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-blink-features=AutomationControlled',
    ];

    try {
      browser = await chromium.launch({
        channel: 'chrome',
        headless: true,
        args: launchArgs,
      });
    } catch {
      browser = await chromium.launch({
        headless: true,
        args: launchArgs,
      });
    }

    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });

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
    src="https://www.youtube.com/embed/${vid}?autoplay=1&mute=1&playsinline=1&controls=0&modestbranding=1&rel=0"
    frameborder="0"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
    referrerpolicy="strict-origin-when-cross-origin"
    allowfullscreen
    style="border:none;display:block;width:1280px;height:720px;"
  ></iframe>
</body>
</html>`,
      });
    });

    await page.goto(virtualOrigin, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const frameElement = await page.waitForSelector('#yt-frame', { timeout: 12000 });
    const frame = await frameElement.contentFrame();

    let dataUrl = null;
    if (frame) {
      await frame.waitForSelector('video', { timeout: 15000 });
      for (let attempt = 0; attempt < 25; attempt++) {
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

            for (const q of [0.80, 0.70, 0.60, 0.50]) {
              const url = canvas.toDataURL('image/jpeg', q);
              const approxBytes = Math.round((url.length - 23) * 0.75);
              if (approxBytes <= 55000 || q === 0.50) {
                return { ready: true, dataUrl: url };
              }
            }
          }
          return { ready: false };
        });

        if (state.ready && state.dataUrl) {
          dataUrl = state.dataUrl;
          break;
        }
        await page.waitForTimeout(500);
      }
    }

    await page.close();

    if (!dataUrl) {
      throw new Error('Failed to extract active video frame from YouTube iframe');
    }

    const base64Data = dataUrl.replace(/^data:image\/jpeg;base64,/, '');
    const buf = Buffer.from(base64Data, 'base64');
    if (buf.length < 1500) {
      throw new Error(`Extracted image too small (${buf.length} bytes)`);
    }

    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, buf);
    console.log(`[PLAYWRIGHT_CANVAS] Captured ${vid} -> ${outFile} (${buf.length} bytes)`);
    process.exit(0);
  } catch (err) {
    console.error(`[PLAYWRIGHT_CANVAS ERROR] ${vid}: ${err.message}`);
    process.exit(1);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

captureYouTubeLiveFrame(videoId, outputPath);
