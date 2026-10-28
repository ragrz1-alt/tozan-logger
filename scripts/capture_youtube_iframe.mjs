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
      '--headless=new',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--use-gl=swiftshader',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-blink-features=AutomationControlled',
      '--mute-audio',
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
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      locale: 'ja-JP',
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
    src="https://www.youtube.com/embed/${vid}?autoplay=1&mute=1&playsinline=1&controls=0&modestbranding=1&rel=0&enablejsapi=1"
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
    let lastDiag = {};

    if (frame) {
      await frame.waitForSelector('video, .ytp-large-play-button', { timeout: 15000 }).catch(() => {});

      for (let attempt = 0; attempt < 30; attempt++) {
        // 初回および数回おきにPlaywrightのネイティブクリックでも再生トリガーを送る（Linux CIでのautoplay制限突破）
        if (attempt === 1 || attempt === 5 || attempt === 10) {
          try {
            const playBtn = await frame.$('.ytp-large-play-button');
            if (playBtn && (await playBtn.isVisible())) {
              await playBtn.click({ force: true }).catch(() => {});
            } else {
              await page.mouse.click(640, 360).catch(() => {});
            }
          } catch {}
        }

        const state = await frame.evaluate(() => {
          // 1. YouTube内部プレーヤーAPIおよび大再生ボタンを駆動
          const mp = document.getElementById('movie_player');
          if (mp && typeof mp.mute === 'function') mp.mute();
          if (mp && typeof mp.playVideo === 'function') {
            try {
              mp.playVideo();
            } catch {}
          }
          const largePlay = document.querySelector('.ytp-large-play-button');
          if (largePlay && largePlay.offsetParent !== null) {
            try {
              largePlay.click();
            } catch {}
          }

          const v = document.querySelector('video');
          if (!v) {
            return { ready: false, diag: { hasVideo: false } };
          }
          if (v.paused) {
            v.muted = true;
            v.play().catch(() => {});
          }

          const diag = {
            hasVideo: true,
            readyState: v.readyState,
            videoWidth: v.videoWidth,
            videoHeight: v.videoHeight,
            currentTime: v.currentTime,
            paused: v.paused,
            src: v.src ? 'set' : 'empty',
          };

          if (v.readyState >= 2 && v.videoWidth > 0) {
            const canvas = document.createElement('canvas');
            const targetW = 800;
            const targetH = Math.round((v.videoHeight / v.videoWidth) * targetW) || 450;
            canvas.width = targetW;
            canvas.height = targetH;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(v, 0, 0, targetW, targetH);

            // 真っ黒フレーム（デコード直前の空フレーム）でないか中央・4点の輝度を確認
            const samplePoints = [
              [200, 120],
              [400, 225],
              [600, 120],
              [400, 350],
            ];
            let nonBlack = false;
            for (const [sx, sy] of samplePoints) {
              const p = ctx.getImageData(sx, sy, 1, 1).data;
              if (p[0] > 3 || p[1] > 3 || p[2] > 3) {
                nonBlack = true;
                break;
              }
            }

            if (nonBlack || v.currentTime > 0.3) {
              for (const q of [0.80, 0.70, 0.60, 0.50]) {
                const url = canvas.toDataURL('image/jpeg', q);
                const approxBytes = Math.round((url.length - 23) * 0.75);
                if (approxBytes <= 55000 || q === 0.50) {
                  return { ready: true, dataUrl: url, diag };
                }
              }
            }
          }
          return { ready: false, diag };
        });

        lastDiag = state.diag || {};
        if (state.ready && state.dataUrl) {
          dataUrl = state.dataUrl;
          break;
        }
        await page.waitForTimeout(500);
      }
    }

    await page.close();
    await context.close();
    await browser.close();

    if (!dataUrl) {
      console.error(`[PLAYWRIGHT_CANVAS] Failed to extract frame for ${vid}. Last state:`, JSON.stringify(lastDiag));
      return false;
    }

    const base64Data = dataUrl.replace(/^data:image\/jpeg;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    if (buffer.length < 3000) {
      console.error(`[PLAYWRIGHT_CANVAS] Buffer too small (${buffer.length}B) for ${vid}`);
      return false;
    }

    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, buffer);
    console.log(`[PLAYWRIGHT_CANVAS] Captured ${vid} -> ${outFile} (${buffer.length} bytes)`);
    return true;
  } catch (err) {
    if (browser) {
      try {
        await browser.close();
      } catch {}
    }
    console.error(`[PLAYWRIGHT_CANVAS] Error for ${vid}:`, err.message);
    return false;
  }
}

const ok = await captureYouTubeLiveFrame(videoId, outputPath);
process.exit(ok ? 0 : 2);
