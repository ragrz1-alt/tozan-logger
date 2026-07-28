/**
 * Playwright (ヘッドレス Chromium) で YouTube ライブ配信の画面を直接スクリーンショットする
 * 
 * 使い方: node capture_playwright.mjs <youtube_url> <output_path>
 * 
 * yt-dlp が「Sign in to confirm you're not a bot」でブロックされる動画に対して、
 * 本物のブラウザで配信ページを開き、再生中の映像フレームをそのまま撮影する。
 */
import { chromium } from 'playwright';
import { existsSync, statSync } from 'fs';

const videoUrl = process.argv[2];
const outputPath = process.argv[3];

if (!videoUrl || !outputPath) {
  console.error('Usage: node capture_playwright.mjs <youtube_url> <output_path>');
  process.exit(1);
}

// YouTube URL から videoId を抽出
const match = videoUrl.match(/(?:v=|\/embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
const videoId = match ? match[1] : null;

if (!videoId) {
  console.error(`[Playwright] 無効な YouTube URL: ${videoUrl}`);
  process.exit(1);
}

// embed URL（自動再生・ミュート・コントロール非表示）で最もクリーンに映像だけ取得
const embedUrl = `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&playsinline=1&controls=0&rel=0&modestbranding=1`;

console.log(`[Playwright] 対象: ${embedUrl}`);
console.log(`[Playwright] 出力: ${outputPath}`);

(async () => {
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--autoplay-policy=no-user-gesture-required',
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox'
      ]
    });

    const context = await browser.newContext({
      viewport: { width: 854, height: 480 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();

    // embed ページに移動
    await page.goto(embedUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });

    // 同意画面（GDPR等）が出た場合の処理
    try {
      const consentBtn = page.locator('button:has-text("Accept all"), button:has-text("同意して続行"), button:has-text("I agree")');
      if (await consentBtn.isVisible({ timeout: 3000 })) {
        await consentBtn.first().click();
        await page.waitForTimeout(2000);
      }
    } catch {
      // 同意画面なし → 問題なし
    }

    // video 要素の出現を待つ
    const video = page.locator('video');
    await video.waitFor({ state: 'attached', timeout: 15000 });

    // 自動再生を確実にする
    await page.evaluate(() => {
      const v = document.querySelector('video');
      if (v) {
        v.muted = true;
        v.play().catch(() => {});
      }
    });

    // 映像フレームが実際にレンダリングされるのを待つ（5秒）
    await page.waitForTimeout(5000);

    // 映像が実際に再生中かチェック
    const videoInfo = await page.evaluate(() => {
      const v = document.querySelector('video');
      if (!v) return { exists: false };
      return {
        exists: true,
        readyState: v.readyState,
        paused: v.paused,
        videoWidth: v.videoWidth,
        videoHeight: v.videoHeight,
        currentTime: v.currentTime,
        duration: v.duration
      };
    });

    console.log(`[Playwright] Video状態: ${JSON.stringify(videoInfo)}`);

    if (videoInfo.exists && videoInfo.videoWidth > 0 && videoInfo.readyState >= 2) {
      // video 要素を直接スクリーンショット（UIなし、映像フレームのみ）
      await video.screenshot({ path: outputPath, type: 'jpeg', quality: 85 });
      console.log('[Playwright] video要素の直接スクリーンショット成功');
    } else {
      // フォールバック：ページ全体をスクリーンショット
      console.log('[Playwright] video要素が取得できないため、ページ全体をスクリーンショット');
      await page.screenshot({ path: outputPath, type: 'jpeg', quality: 85 });
    }

    // 出力ファイルの検証
    if (existsSync(outputPath)) {
      const size = statSync(outputPath).size;
      console.log(`[Playwright] 保存完了: ${size} bytes`);
      if (size < 3000) {
        console.error('[Playwright] ファイルサイズが小さすぎます（無効な画像の可能性）');
        process.exit(1);
      }
      process.exit(0);
    } else {
      console.error('[Playwright] 出力ファイルが生成されませんでした');
      process.exit(1);
    }
  } catch (error) {
    console.error(`[Playwright] エラー: ${error.message}`);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
})();
