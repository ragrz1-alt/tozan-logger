/**
 * YouTube Live カスタムサムネイル突破＆純粋映像フレーム抽出スクリプト
 * (Playwright 仮想ドメイン iframe 埋め込み + HTML5 <video> -> <canvas> 直接キャプチャ)
 *
 * 使い方:
 *   単発: node scripts/capture_youtube_iframe.mjs <videoId> <outputPath> [proxyUrl]
 *   一括: node scripts/capture_youtube_iframe.mjs --batch <jobsJsonPath> [proxyUrl]
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import net from 'net';

function parseCliArgs(argv) {
  const args = argv.slice(2);
  if (args[0] === '--batch') {
    const jobsPath = args[1];
    const cliProxy = args[2] || null;
    if (!jobsPath || !fs.existsSync(jobsPath)) {
      console.error('Usage: node scripts/capture_youtube_iframe.mjs --batch <jobsJsonPath> [proxyUrl]');
      process.exit(1);
    }
    const raw = fs.readFileSync(jobsPath, 'utf-8').replace(/^\uFEFF/, '');
    const jobs = JSON.parse(raw);
    return { mode: 'batch', jobs, cliProxy };
  }

  const [videoId, outputPath, cliProxy] = args;
  if (!videoId || !outputPath) {
    console.error('Usage: node scripts/capture_youtube_iframe.mjs <videoId> <outputPath> [proxyUrl]');
    process.exit(1);
  }
  return { mode: 'single', jobs: [{ videoId, outputPath }], cliProxy: cliProxy || null };
}

function checkLocalPort(port, host = '127.0.0.1', timeoutMs = 600) {
  return new Promise(resolve => {
    const socket = new net.Socket();
    let done = false;
    const finish = ok => {
      if (!done) {
        done = true;
        socket.destroy();
        resolve(ok);
      }
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

async function launchChromium(proxyServer) {
  const launchArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-blink-features=AutomationControlled',
    '--mute-audio',
  ];

  const launchOpts = {
    headless: true,
    args: launchArgs,
    ...(proxyServer ? { proxy: { server: proxyServer } } : {}),
  };

  try {
    return await chromium.launch({ ...launchOpts, channel: 'chrome' });
  } catch {
    return await chromium.launch(launchOpts);
  }
}

async function captureVideoOnContext(context, vid, outFile, proxyLabel) {
  const page = await context.newPage();
  const virtualOrigin = 'https://rishiri-trail-analytics.web.app/';

  try {
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

    await page.goto(virtualOrigin, { waitUntil: 'domcontentloaded', timeout: 15000 });
    const frameElement = await page.waitForSelector('#yt-frame', { timeout: 8000 });
    const frame = await frameElement.contentFrame();

    let dataUrl = null;
    let lastDiag = {};

    if (frame) {
      await frame.waitForSelector('video, .ytp-large-play-button, .ytp-error', { timeout: 10000 }).catch(() => {});

      for (let attempt = 0; attempt < 22; attempt++) {
        if (attempt === 1 || attempt === 4 || attempt === 9) {
          try {
            const playBtn = await frame.$('.ytp-large-play-button');
            if (playBtn && (await playBtn.isVisible())) {
              await playBtn.click({ force: true }).catch(() => {});
            } else {
              await page.mouse.click(640, 360).catch(() => {});
            }
          } catch {}
        }

        const state = await frame.evaluate(att => {
          const errEl = document.querySelector('.ytp-error-content-wrap-reason, .ytp-error');
          const errText = errEl ? (errEl.textContent || '').trim().slice(0, 120) : '';

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
            return { ready: false, fatalError: !!errText, diag: { hasVideo: false, errText } };
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
            errText,
          };

          if (errText && v.readyState === 0) {
            return { ready: false, fatalError: true, diag };
          }

          if (v.readyState >= 2 && v.videoWidth >= 320 && v.videoHeight >= 180) {
            const canvas = document.createElement('canvas');
            const targetW = 800;
            const targetH = Math.round((v.videoHeight / v.videoWidth) * targetW) || 450;
            canvas.width = targetW;
            canvas.height = targetH;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(v, 0, 0, targetW, targetH);

            // 3x3 グリッドで初期黒フレーム・ロード待ちを除外（暗闇でも再生が進んでいれば取得する）
            const xs = [160, 400, 640];
            const ys = [Math.round(targetH * 0.25), Math.round(targetH * 0.5), Math.round(targetH * 0.75)];
            let nonBlackCount = 0;
            for (const sx of xs) {
              for (const sy of ys) {
                const p = ctx.getImageData(sx, sy, 1, 1).data;
                if (p[0] > 4 || p[1] > 4 || p[2] > 4) {
                  nonBlackCount++;
                }
              }
            }

            if (nonBlackCount >= 2 || (att >= 3 && v.currentTime > 0.3)) {
              for (const q of [0.80, 0.70, 0.60, 0.50]) {
                const url = canvas.toDataURL('image/jpeg', q);
                const approxBytes = Math.round((url.length - 23) * 0.75);
                if (approxBytes <= 55000 || q === 0.50) {
                  return { ready: true, dataUrl: url, diag };
                }
              }
            }
          }
          return { ready: false, fatalError: false, diag };
        }, attempt);

        lastDiag = state.diag || {};
        if (state.ready && state.dataUrl) {
          dataUrl = state.dataUrl;
          break;
        }
        if (state.fatalError && attempt >= 2) {
          break;
        }
        await page.waitForTimeout(400);
      }
    }

    if (!dataUrl) {
      console.error(`[PLAYWRIGHT_CANVAS] Failed (${proxyLabel}) for ${vid}. Last state:`, JSON.stringify(lastDiag));
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
    console.log(`[PLAYWRIGHT_CANVAS] Captured ${vid} (${proxyLabel}) -> ${outFile} (${buffer.length} bytes)`);
    return true;
  } catch (err) {
    console.error(`[PLAYWRIGHT_CANVAS] Error (${proxyLabel}) for ${vid}:`, err.message);
    return false;
  } finally {
    await page.close().catch(() => {});
  }
}

async function runCaptureBatch(jobs, cliProxy) {
  const candidates = [];
  const envProxy = cliProxy || process.env.YOUTUBE_SOCKS_PROXY || process.env.YOUTUBE_PROXY;
  if (envProxy) {
    candidates.push(envProxy);
  } else if (await checkLocalPort(40000)) {
    candidates.push('socks5://127.0.0.1:40000');
  }
  candidates.push(null); // direct fallback

  let remaining = jobs.map(j => ({ ...j }));

  for (const proxy of candidates) {
    if (remaining.length === 0) break;
    const proxyLabel = proxy || 'direct';
    let browser;
    try {
      browser = await launchChromium(proxy);
      const context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        locale: 'ja-JP',
      });

      const nextRemaining = [];
      for (const job of remaining) {
        const ok = await captureVideoOnContext(context, job.videoId, job.outputPath, proxyLabel);
        if (!ok) nextRemaining.push(job);
      }
      remaining = nextRemaining;
      await context.close().catch(() => {});
    } catch (err) {
      console.error(`[PLAYWRIGHT_CANVAS] Browser launch/context error (${proxyLabel}):`, err.message);
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
      }
    }
  }

  return remaining.length === 0;
}

const { jobs, cliProxy } = parseCliArgs(process.argv);
const allOk = await runCaptureBatch(jobs, cliProxy);
process.exit(allOk ? 0 : 2);
