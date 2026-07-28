/**
 * Playwright (ヘッドレス Chromium) で YouTube ライブ配信ページを直接開き、
 * 再生中の映像フレームをスクリーンショットする。
 * 
 * 使い方: node capture_playwright.mjs <youtube_url> <output_path>
 * 
 * embed 無効の動画にも対応するため、通常の /watch?v= ページを使用する。
 */
import { chromium } from 'playwright';
import { existsSync, statSync } from 'fs';

const videoUrl = process.argv[2];
const outputPath = process.argv[3];

if (!videoUrl || !outputPath) {
  console.error('Usage: node capture_playwright.mjs <youtube_url> <output_path>');
  process.exit(1);
}

console.log(`[Playwright] 対象: ${videoUrl}`);
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
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();

    // YouTube の通常ページに移動（embed ではなく /watch?v= を使用）
    await page.goto(videoUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });

    // Cookie 同意画面の処理
    try {
      const consentBtn = page.locator('button[aria-label="Accept all"], button:has-text("Accept all"), button:has-text("同意して続行"), tp-yt-paper-button:has-text("Accept all")');
      if (await consentBtn.first().isVisible({ timeout: 3000 })) {
        await consentBtn.first().click();
        console.log('[Playwright] Cookie同意画面をクリック');
        await page.waitForTimeout(2000);
      }
    } catch {
      // 同意画面なし
    }

    // video 要素の出現を待つ
    await page.waitForSelector('video', { state: 'attached', timeout: 15000 });
    console.log('[Playwright] video要素を検出');

    // 自動再生を試行し、ミュートにする
    await page.evaluate(() => {
      const v = document.querySelector('video');
      if (v) {
        v.muted = true;
        v.play().catch(() => {});
      }
    });

    // 再生ボタンが表示されていればクリック
    try {
      const playBtn = page.locator('.ytp-play-button[aria-label="再生"], .ytp-play-button[aria-label="Play"],.ytp-large-play-button');
      if (await playBtn.first().isVisible({ timeout: 2000 })) {
        await playBtn.first().click();
        console.log('[Playwright] 再生ボタンをクリック');
      }
    } catch {
      // 再生ボタンなし（自動再生済み）
    }

    // 映像が実際にレンダリングされるまで待つ
    console.log('[Playwright] 映像レンダリング待機中 (8秒)...');
    await page.waitForTimeout(8000);

    // video 要素の状態を確認
    const videoInfo = await page.evaluate(() => {
      const v = document.querySelector('video');
      if (!v) return { exists: false };
      return {
        exists: true,
        readyState: v.readyState,
        paused: v.paused,
        videoWidth: v.videoWidth,
        videoHeight: v.videoHeight,
        currentTime: v.currentTime
      };
    });
    console.log(`[Playwright] Video状態: ${JSON.stringify(videoInfo)}`);

    const video = page.locator('video');

    if (videoInfo.exists && videoInfo.videoWidth > 0 && videoInfo.readyState >= 2 && videoInfo.currentTime > 0) {
      // video 要素を直接スクリーンショット（UIなし、映像フレームのみ）
      await video.screenshot({ path: outputPath, type: 'jpeg', quality: 85 });
      console.log('[Playwright] video要素の直接スクリーンショット成功');
    } else {
      // video が再生されていない場合、プレイヤー領域をスクリーンショット
      console.log('[Playwright] video未再生のため、プレイヤー領域をスクリーンショット試行');
      try {
        const player = page.locator('#movie_player, .html5-video-player');
        if (await player.first().isVisible({ timeout: 3000 })) {
          await player.first().screenshot({ path: outputPath, type: 'jpeg', quality: 85 });
          console.log('[Playwright] プレイヤー領域のスクリーンショット成功');
        } else {
          await page.screenshot({ path: outputPath, type: 'jpeg', quality: 85 });
          console.log('[Playwright] ページ全体のスクリーンショット（フォールバック）');
        }
      } catch {
        await page.screenshot({ path: outputPath, type: 'jpeg', quality: 85 });
        console.log('[Playwright] ページ全体のスクリーンショット（フォールバック）');
      }
    }

    // 出力ファイルの検証
    if (existsSync(outputPath)) {
      const size = statSync(outputPath).size;
      console.log(`[Playwright] 保存完了: ${size} bytes`);
      if (size < 3000) {
        console.error('[Playwright] ファイルサイズが小さすぎます');
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
