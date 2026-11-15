/**
 * 利尻山ライブカメラ 全日・全方位一括AI解析スクリプト（Node / ローカル実行用）
 *
 * 仕様ソース: src/utils/cameraPromptSpec.json（UIクライアントと完全共通）
 * モデル優先順位: gemini-4-hydrogen -> 3.5-flash-lite -> 3.1-flash-lite -> 2.5-flash-lite
 *
 * 使い方:
 *   node scripts/analyze_cams_batch.mjs --dry-run
 *   node scripts/analyze_cams_batch.mjs --force --from 2026-08-01 --to 2026-08-01
 *   node scripts/analyze_cams_batch.mjs --force --from 2026-07-28 --to 2026-09-30 --sync --push
 *
 * オプション:
 *   --dry-run            APIを呼ばずに対象日数・時間帯チャンク数・画像数を確認
 *   --force              既に analysis_results.json にある日付も上書き再解析
 *   --clear              既存結果をバックアップ後、全件初期化して最初から解析
 *   --from YYYY-MM-DD    開始日フィルタ
 *   --to YYYY-MM-DD      終了日フィルタ
 *   --model <id>         優先モデル指定（既定: gemini-4-hydrogen）
 *   --res <medium|high>  Gemini 4 画像解像度モード（既定: high）
 *   --sync               解析完了後に自動で Firebase Firestore へ直接同期
 *   --push               public/cams/analysis_results.json を自動で git commit & push
 */

import fs from 'fs/promises';
import path from 'path';
import { execFileSync } from 'child_process';
import { GoogleGenAI } from '@google/genai';
import {
  assertWithinMonthlyBudget,
  getMonthlyUsageState,
  getThinkingConfigForModel,
  isBudgetExceededError,
  loadGeminiApiKey,
  recordGeminiUsage,
} from './ai_budget_guard.mjs';
import { fetchFirestoreAnalysisMap, syncCamsToFirestore } from './sync_cams_to_firestore.mjs';

const CAMS_DIR = path.join(process.cwd(), 'public', 'cams');
const RESULTS_FILE = path.join(CAMS_DIR, 'analysis_results.json');
const BACKUP_FILE = path.join(CAMS_DIR, 'analysis_results.backup.json');
const HISTORY_FILE = path.join(CAMS_DIR, 'history.json');
const SPEC_FILE = path.join(process.cwd(), 'src', 'utils', 'cameraPromptSpec.json');

const FALLBACK_MODELS = [
  'gemini-4-hydrogen',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash-lite',
];

function getArgValue(args, flag) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('--')) {
    return args[idx + 1];
  }
  return null;
}

function getSeasonModeForDate(dateStr) {
  const month = parseInt(dateStr.split('-')[1] || '7', 10);
  if ([11, 12, 1, 2, 3, 4].includes(month)) {
    return 'winter_bc';
  }
  return 'summer';
}

function getTargetHoursForDate(dateStr) {
  if (!dateStr) return ['05', '07', '09', '11', '13', '15', '17'];
  if (dateStr < '2026-10-28') {
    return ['05', '07', '09', '11', '13', '15', '17'];
  }
  const month = parseInt(dateStr.split('-')[1] || '10', 10);
  if ([5, 6, 7, 8].includes(month)) {
    return ['03', '05', '07', '09', '11', '13', '15', '17', '19'];
  }
  if ([11, 12, 1, 2].includes(month)) {
    return ['07', '09', '11', '13', '15'];
  }
  return ['05', '07', '09', '11', '13', '15', '17'];
}

function normalizeImageAnalysis(raw) {
  const res = { ...raw };

  if (res.visibility === 'camera_error') {
    res.is_sunny = false;
    res.summit_visible = false;
    res.cloud_cover = -1;
    res.visible_elevation_m = 0;
    res.bc_field_status = 'whiteout';
    res.snow_line = 'none';
    res.status = 'camera_error';
    return res;
  }

  if (typeof res.cloud_cover === 'number' && res.cloud_cover >= 0) {
    res.cloud_cover = Math.max(0, Math.min(10, Math.round(res.cloud_cover)));
  }

  if (res.cloud_pattern === 'full_overcast') {
    res.summit_visible = false;
    res.visibility = 'foggy';
    res.visible_elevation_m = 0;
    res.bc_field_status = 'whiteout';
  }

  if (res.summit_visible === true) {
    res.visibility = 'clear';
    res.visible_elevation_m = 1700;
    res.bc_field_status = 'alpine_clear';
    if (!res.mountain_weather) {
      res.mountain_weather = res.cloud_pattern === 'high_clouds' ? 'high_overcast' : 'clear';
    }
  } else {
    if (res.visibility === 'clear') {
      res.visibility = 'cloudy';
    }
    if (
      res.visibility === 'cloudy' &&
      res.reason &&
      (res.reason.includes('山全体が雲に隠れ') ||
        res.reason.includes('山は全く見え') ||
        res.reason.includes('山体が見え'))
    ) {
      res.visibility = 'foggy';
    }

    if (res.visibility === 'foggy') {
      if (!res.visible_elevation_m || res.visible_elevation_m >= 1000) {
        res.visible_elevation_m = 0;
        res.bc_field_status = 'whiteout';
      } else if (res.visible_elevation_m === 500) {
        res.bc_field_status = 'treeline_only';
      }
    } else if (res.visibility === 'cloudy') {
      if (res.visible_elevation_m === 1700 || !res.visible_elevation_m) {
        res.visible_elevation_m = 1000;
        res.bc_field_status = 'mid_mountain_ok';
      } else if (res.visible_elevation_m === 500) {
        res.bc_field_status = 'treeline_only';
      } else if (res.visible_elevation_m === 0) {
        res.bc_field_status = 'whiteout';
      } else {
        res.bc_field_status = 'mid_mountain_ok';
      }
    }
  }

  res.status = 'ok';
  return res;
}

async function loadPromptSpec() {
  const raw = await fs.readFile(SPEC_FILE, 'utf-8');
  return JSON.parse(raw);
}

async function loadHistoryJson() {
  try {
    const raw = await fs.readFile(HISTORY_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function collectDateImages(dateStr, history, locations) {
  const targetHours = getTargetHoursForDate(dateStr);
  const dateDir = path.join(CAMS_DIR, dateStr);
  const items = [];
  const seen = new Set();

  const dayRec = history?.records?.[dateStr];
  if (dayRec && typeof dayRec === 'object') {
    for (const hr of targetHours) {
      const hrObj = dayRec[hr];
      if (!hrObj || typeof hrObj !== 'object') continue;
      for (const loc of locations) {
        const rel = hrObj[loc.id];
        if (typeof rel !== 'string' || !rel.trim()) continue;
        const fileName = `${hr}_${loc.id}.jpg`;
        if (seen.has(fileName)) continue;
        const cleanRel = rel.replace(/^\/+/, '').replace(/^cams\//, '');
        const fullPath = path.join(CAMS_DIR, cleanRel);
        try {
          const stat = await fs.stat(fullPath);
          seen.add(fileName);
          items.push({ fileName, hourSlot: hr, loc, fullPath, sizeBytes: stat.size });
        } catch {
          // recorded in history.json but missing on local disk
        }
      }
    }
    return items;
  }

  // history.json に日付が無い場合のみローカルフォルダを探索
  for (const hr of targetHours) {
    for (const loc of locations) {
      const fileName = `${hr}_${loc.id}.jpg`;
      const fullPath = path.join(dateDir, fileName);
      try {
        const stat = await fs.stat(fullPath);
        items.push({ fileName, hourSlot: hr, loc, fullPath, sizeBytes: stat.size });
      } catch {
        // file not found
      }
    }
  }
  return items;
}

async function analyzeHourSlotChunk({
  ai,
  spec,
  dateStr,
  seasonMode,
  hourSlot,
  slotImages,
  modelChain,
  mediaResolution,
}) {
  const seasonLabel =
    seasonMode === 'winter_bc'
      ? '冬山・バックカントリー期（11〜4月：山頂露出に加え、中腹1,000mオープンバーンや森林限界500mの視界高度・積雪ラインを重視）'
      : '夏山・登山観光期（5〜10月：全天雲量・雲底高度と1,721m山頂ピーク露出、高曇り含む山の天候・視界を重視）';

  const parts = [
    {
      text: `対象日時: ${dateStr} ${hourSlot}:00頃（${seasonLabel}）\n同一時刻の全方位ライブカメラ画像（${slotImages.length}地点）を比較し、空の雲量と山の視界を切り分けて各 fileName ごとにJSON配列で返してください。`,
    },
  ];

  for (const img of slotImages) {
    const b64 = (await fs.readFile(img.fullPath)).toString('base64');
    parts.push({ text: `ファイル名: ${img.fileName}（${img.loc.name}）` });
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: b64 } });
  }

  let lastErr = null;
  for (const modelName of modelChain) {
    try {
      await assertWithinMonthlyBudget();
      const thinkingConfig = getThinkingConfigForModel(modelName, 'camera');
      const isGemini4 = modelName.startsWith('gemini-4');

      const response = await ai.models.generateContent({
        model: modelName,
        contents: [{ role: 'user', parts }],
        config: {
          systemInstruction: spec.systemPrompt,
          responseMimeType: 'application/json',
          maxOutputTokens: 8192,
          temperature: 0.1,
          ...(thinkingConfig ? { thinkingConfig } : {}),
          ...(isGemini4 ? { mediaResolution } : {}),
          responseSchema: spec.responseSchema,
        },
      });

      const usageMeta = response.usageMetadata;
      const budgetRec = await recordGeminiUsage(modelName, usageMeta);
      const cleanText = (response.text || '').replace(/```json|```/g, '').trim();
      if (!cleanText) {
        throw new Error('AIから有効なレスポンスが返りませんでした');
      }

      const parsed = JSON.parse(cleanText);
      return {
        items: parsed.map(normalizeImageAnalysis),
        usedModel: modelName,
        usageMeta,
        requestCostUsd: budgetRec.requestCostUsd,
        monthlyTotalUsd: budgetRec.state.estimatedCostUsd,
      };
    } catch (err) {
      if (isBudgetExceededError(err)) {
        throw err;
      }
      lastErr = err;
      const msg = String(err?.message || err);
      const retryable =
        msg.includes('429') ||
        msg.includes('503') ||
        msg.includes('404') ||
        msg.includes('RESOURCE_EXHAUSTED') ||
        msg.includes('quota');
      if (retryable) {
        console.warn(`  ⚠️ [${hourSlot}時] ${modelName} 利用不可/制限 (${msg.slice(0, 90)}) -> 次モデルへ`);
        continue;
      }
      throw err;
    }
  }

  throw lastErr || new Error('すべてのモデルで解析に失敗しました');
}

function runGit(args) {
  return execFileSync('git', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function pushResultsToGitHub() {
  console.log('\n🚀 GitHub へ解析結果 (public/cams/analysis_results.json) を反映します...');
  runGit(['add', 'public/cams/analysis_results.json']);

  let hasStagedChange = false;
  try {
    execFileSync('git', ['diff', '--cached', '--quiet', '--', 'public/cams/analysis_results.json'], {
      stdio: 'ignore',
    });
  } catch {
    hasStagedChange = true;
  }

  if (!hasStagedChange) {
    console.log('✨ analysis_results.json に新規コミット対象の変更はありませんでした。');
    return;
  }

  const todayJst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  execFileSync('git', ['commit', '-m', `chore(cams): update AI camera analysis results (${todayJst})`], {
    stdio: 'inherit',
  });
  // 毎時の自動カメラ撮影ワークフローによる更新と競合しないよう rebase してから push
  execFileSync('git', ['pull', '--rebase', '--autostash', 'origin', 'main'], { stdio: 'inherit' });
  execFileSync('git', ['push', 'origin', 'main'], { stdio: 'inherit' });
  console.log('✅ GitHub (origin/main) へのプッシュが完了しました！');
}

async function finalizePublish({ isSync, isPush }) {
  if (isSync) {
    console.log('\n☁️ Firebase Firestore へ差分同期しています...');
    await syncCamsToFirestore({ resultsFile: RESULTS_FILE });
  }
  if (isPush) {
    pushResultsToGitHub();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const isForce = args.includes('--force');
  const isClear = args.includes('--clear');
  const isDryRun = args.includes('--dry-run');
  const isSync = args.includes('--sync');
  const isPush = args.includes('--push');
  const fromDate = getArgValue(args, '--from');
  const toDate = getArgValue(args, '--to');
  const preferredModel = getArgValue(args, '--model') || 'gemini-4-hydrogen';
  const resArg = (getArgValue(args, '--res') || 'high').toLowerCase();
  const mediaResolution = resArg === 'medium' ? 'MEDIA_RESOLUTION_MEDIUM' : 'MEDIA_RESOLUTION_HIGH';

  const spec = await loadPromptSpec();
  const history = await loadHistoryJson();
  const modelChain = [preferredModel, ...FALLBACK_MODELS.filter(m => m !== preferredModel)];

  let results = {};
  if (!isClear) {
    try {
      const existingRaw = await fs.readFile(RESULTS_FILE, 'utf-8');
      results = JSON.parse(existingRaw);
    } catch {
      console.log('ℹ️ 既存の analysis_results.json がないため新規作成します。');
    }
    // Firestore側の最新解析済みレコードも取得してマージ（UI解析済み日の重複課金を防止）
    try {
      const remoteResults = await fetchFirestoreAnalysisMap();
      const remoteDates = Object.keys(remoteResults);
      if (remoteDates.length > 0) {
        results = { ...remoteResults, ...results };
      }
    } catch {
      // オフライン時はローカルJSONのみで続行
    }
  } else if (!isDryRun) {
    try {
      const existingRaw = await fs.readFile(RESULTS_FILE, 'utf-8');
      await fs.writeFile(BACKUP_FILE, existingRaw, 'utf-8');
      console.log(`💾 バックアップ保存: ${BACKUP_FILE}`);
    } catch {
      // no existing file to backup
    }
    console.log('🧹 --clear 指定により既存解析データを初期化します。');
  }

  let dateFolders = [];
  if (history?.records && Object.keys(history.records).length > 0) {
    dateFolders = Object.keys(history.records)
      .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort();
  } else {
    const entries = await fs.readdir(CAMS_DIR, { withFileTypes: true });
    dateFolders = entries
      .filter(e => e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name))
      .map(e => e.name)
      .sort();
  }

  if (fromDate) dateFolders = dateFolders.filter(d => d >= fromDate);
  if (toDate) dateFolders = dateFolders.filter(d => d <= toDate);

  const pendingPlans = [];
  for (const dateStr of dateFolders) {
    const imgs = await collectDateImages(dateStr, history, spec.locations);
    if (imgs.length === 0) continue;

    const alreadyDone = results[dateStr] && results[dateStr].some(r => r.status === 'ok');
    if (alreadyDone && !isForce && !isClear) continue;

    const slotMap = new Map();
    let validCount = 0;
    let corruptCount = 0;
    for (const item of imgs) {
      if (item.sizeBytes < 3000) {
        corruptCount++;
        continue;
      }
      validCount++;
      const arr = slotMap.get(item.hourSlot) || [];
      arr.push(item);
      slotMap.set(item.hourSlot, arr);
    }

    pendingPlans.push({
      dateStr,
      imgs,
      slotMap,
      validCount,
      corruptCount,
      slotCount: slotMap.size,
    });
  }

  const totalDates = pendingPlans.length;
  const totalImages = pendingPlans.reduce((acc, p) => acc + p.validCount, 0);
  const totalCorrupt = pendingPlans.reduce((acc, p) => acc + p.corruptCount, 0);
  const totalRequests = pendingPlans.reduce((acc, p) => acc + p.slotCount, 0);
  const currentUsage = await getMonthlyUsageState();

  console.log('====================================================');
  console.log('📷 利尻山ライブカメラ AI一括解析サマリー');
  console.log(`  モデル優先順   : ${modelChain.join(' -> ')}`);
  console.log(`  画像解像度     : ${mediaResolution} (Gemini 4思考: low)`);
  console.log(`  期間フィルタ   : ${fromDate || '最古'} 〜 ${toDate || '最新'}`);
  console.log(`  モード         : ${isClear ? '全クリア再解析' : isForce ? '上書き再解析(--force)' : '未解析のみ'}`);
  console.log(`  解析対象日数   : ${totalDates} 日`);
  console.log(`  有効画像枚数   : ${totalImages} 枚（破損/暗転除外: ${totalCorrupt} 枚）`);
  console.log(`  APIリクエスト  : ${totalRequests} 回（時間帯別・全方位比較チャンク）`);
  console.log(`  クラウド自動同期: ${isSync ? 'ON (--sync)' : 'OFF'} / GitHub自動push: ${isPush ? 'ON (--push)' : 'OFF'}`);
  console.log(`  今月推定使用額 : $${currentUsage.estimatedCostUsd.toFixed(4)} (${currentUsage.yearMonth})`);
  console.log('====================================================');

  if (isDryRun) {
    console.log('🔍 --dry-run のため API 呼び出しは実行せず終了します。');
    console.log('💡 初回テスト推奨コマンド:');
    const sampleDate = pendingPlans[0]?.dateStr || '2026-08-01';
    console.log(`   node scripts/analyze_cams_batch.mjs --force --from ${sampleDate} --to ${sampleDate}`);
    return;
  }

  if (totalDates === 0) {
    console.log('✨ 解析が必要な対象日はありません（すでに最新、または対象画像0枚）。');
    await finalizePublish({ isSync, isPush });
    return;
  }

  if (isForce && !isClear) {
    try {
      const existingRaw = await fs.readFile(RESULTS_FILE, 'utf-8');
      await fs.writeFile(BACKUP_FILE, existingRaw, 'utf-8');
      console.log(`💾 上書き前バックアップ保存: ${BACKUP_FILE}`);
    } catch {
      // ignore if file does not exist
    }
  }

  const apiKey = await loadGeminiApiKey();
  const ai = new GoogleGenAI({ apiKey });

  let runInputTokens = 0;
  let runOutputTokens = 0;
  let runThoughtsTokens = 0;
  let runCostUsd = 0;

  for (let i = 0; i < pendingPlans.length; i++) {
    const plan = pendingPlans[i];
    const seasonMode = getSeasonModeForDate(plan.dateStr);
    console.log(
      `\n▶ [${i + 1}/${totalDates}] ${plan.dateStr} (${seasonMode}) : ${plan.validCount}枚 / ${plan.slotCount}時間帯`
    );

    const dateResults = [];
    for (const item of plan.imgs) {
      if (item.sizeBytes < 3000) {
        dateResults.push({
          fileName: item.fileName,
          is_sunny: false,
          summit_visible: false,
          cloud_cover: -1,
          visibility: 'camera_error',
          visible_elevation_m: 0,
          bc_field_status: 'whiteout',
          snow_line: 'none',
          reason: `ファイルサイズ異常(${item.sizeBytes}B)のためカメラ障害として除外`,
          status: 'camera_error',
        });
      }
    }

    const sortedSlots = Array.from(plan.slotMap.keys()).sort();
    let failed = false;

    for (let s = 0; s < sortedSlots.length; s++) {
      const slot = sortedSlots[s];
      const slotImages = plan.slotMap.get(slot);
      try {
        const res = await analyzeHourSlotChunk({
          ai,
          spec,
          dateStr: plan.dateStr,
          seasonMode,
          hourSlot: slot,
          slotImages,
          modelChain,
          mediaResolution,
        });
        dateResults.push(...res.items);

        const inTok = res.usageMeta?.promptTokenCount || 0;
        const outTok = res.usageMeta?.candidatesTokenCount || 0;
        const thTok = res.usageMeta?.thoughtsTokenCount || 0;
        runInputTokens += inTok;
        runOutputTokens += outTok;
        runThoughtsTokens += thTok;
        runCostUsd += res.requestCostUsd;

        console.log(
          `  ✅ ${slot}時 (${slotImages.length}枚) [${res.usedModel}] in:${inTok} out:${outTok} think:${thTok} | +$${res.requestCostUsd.toFixed(5)} (月累計 $${res.monthlyTotalUsd.toFixed(4)})`
        );

        if (s + 1 < sortedSlots.length) {
          await new Promise(r => setTimeout(r, 400));
        }
      } catch (err) {
        if (isBudgetExceededError(err)) {
          console.error(`\n🛑 ${err.message}`);
          console.log('💾 ここまでの解析結果を保存して安全終了します。');
          await fs.writeFile(RESULTS_FILE, JSON.stringify(results, null, 2), 'utf-8');
          await finalizePublish({ isSync, isPush });
          return;
        }
        console.error(`  ❌ ${slot}時エラー:`, err.message || err);
        failed = true;
        break;
      }
    }

    if (!failed && dateResults.length > 0) {
      results[plan.dateStr] = dateResults;
      await fs.writeFile(RESULTS_FILE, JSON.stringify(results, null, 2), 'utf-8');
    }

    if (i + 1 < pendingPlans.length) {
      await new Promise(r => setTimeout(r, 800));
    }
  }

  console.log('\n🎉 すべての対象日の解析と保存が完了しました！');
  console.log(
    `📊 今回実行コスト概算: $${runCostUsd.toFixed(4)} (入力:${runInputTokens.toLocaleString()}tok / 出力:${runOutputTokens.toLocaleString()}tok / 思考:${runThoughtsTokens.toLocaleString()}tok)`
  );
  if (isSync || isPush) {
    await finalizePublish({ isSync, isPush });
  } else {
    console.log('☁️ Firebase Firestore へ反映するには: npm run cams:sync');
    console.log('   （次回からは --sync --push を付けるか npm run cams:publish で一発完結します）');
  }
}

main().catch(err => {
  console.error('Fatal Error:', err);
  process.exit(1);
});
