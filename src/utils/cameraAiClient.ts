import {
  type ImageAnalysis,
  type CameraId,
  type SeasonMode,
  getSeasonModeForDate,
  getTargetHoursForDate,
} from '../hooks/useCameraAnalysis';
import { getCamImageUrl } from './camUrl';
import {
  detectImageBlackoutFromDataUrl,
  partitionCamerasForDisplay,
  type CamHistory,
} from './cameraStatus';
import {
  assertWithinMonthlyBudget,
  getThinkingConfigForModel,
  isBudgetExceededError,
  recordGeminiUsage,
  resolveGeminiApiKey,
} from './aiBudgetGuard';
import cameraPromptSpec from './cameraPromptSpec.json';

export interface CameraLocationDef {
  id: CameraId;
  name: string;
  shortName: string;
  bcSlopeName: string;
  color: string;
  isCore: boolean;
  viewGuide?: string;
}

export const CAMERA_LOCATIONS: CameraLocationDef[] =
  cameraPromptSpec.locations as CameraLocationDef[];

export const CAMERA_MODELS = [
  { id: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen (推奨: 高精度・思考Low省コスト)' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite (超低コスト大量処理用)' },
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite (予備: 軽量)' },
  { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash (予備)' },
];

const STRICT_SYSTEM_PROMPT = cameraPromptSpec.systemPrompt;

export function getTodayJstStr(): string {
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  return jst.toISOString().split('T')[0];
}

export function getWindDirString(deg: number): string {
  const dirs = [
    '北', '北北東', '北東', '東北東', '東', '東南東', '南東', '南南東',
    '南', '南南西', '南西', '西南西', '西', '西北西', '北西', '北北西',
  ];
  return dirs[Math.round(deg / 22.5) % 16] || '不明';
}

/**
 * history.json の実記録が存在する日付リストを昇順で返す
 */
export function getAvailableDatesFromHistory(history: CamHistory | null): string[] {
  if (history?.records) {
    const validDates = Object.keys(history.records)
      .filter(dateStr => {
        const hrs = history.records[dateStr];
        if (!hrs || typeof hrs !== 'object') return false;
        return Object.values(hrs).some(
          hrObj => hrObj && typeof hrObj === 'object' && Object.keys(hrObj).some(k => k !== 'timestamp')
        );
      })
      .sort();
    if (validDates.length > 0) return validDates;
  }
  const today = getTodayJstStr();
  return [today >= '2026-07-28' ? today : '2026-10-22'];
}

/**
 * 対象日に記録されている「AI解析対象となる実画像ファイル名一覧」を返す
 */
function getRecordedTargetFilesForDate(dateStr: string, history: CamHistory | null): string[] {
  const dayRec = history?.records?.[dateStr];
  if (!dayRec) return [];

  const targetHours = getTargetHoursForDate(dateStr);
  const files: string[] = [];

  for (const hr of targetHours) {
    const hrObj = dayRec[hr];
    if (!hrObj || typeof hrObj !== 'object') continue;
    for (const loc of CAMERA_LOCATIONS) {
      if (hrObj[loc.id]) {
        files.push(`${hr}_${loc.id}.jpg`);
      }
    }
  }
  return files;
}

/**
 * 対象日の解析が完了しているかの判定
 * - history.json に実画像一覧がある場合は、記録されている対象時間帯のすべての画像に
 *   解析結果（ok または camera_error）が存在するかで厳密に判定する。
 */
export function isDayAnalyzedForDate(
  records?: ImageAnalysis[],
  dateStr?: string,
  history?: CamHistory | null
): boolean {
  if (!records || records.length === 0) return false;

  if (dateStr && history?.records?.[dateStr]) {
    const recordedTargets = getRecordedTargetFilesForDate(dateStr, history);
    if (recordedTargets.length > 0) {
      const doneFiles = new Set(
        records
          .filter(r => r.status === 'ok' || r.status === 'camera_error')
          .map(r => r.fileName)
      );
      return recordedTargets.every(fn => doneFiles.has(fn));
    }
  }

  const hasOk = records.some(c => c.status === 'ok');
  const hasCoreSlot = records.some(
    c =>
      c.fileName.startsWith('07_') ||
      c.fileName.startsWith('09_') ||
      c.fileName.startsWith('11_') ||
      c.fileName.startsWith('13_') ||
      c.fileName.startsWith('15_')
  );
  return hasOk && hasCoreSlot;
}

/**
 * GitHub Pages CDN から対象画像を取得し Base64 へ変換（失敗時のみローカルへフォールバック）
 */
async function fetchCamImageAsBase64(
  relPath: string
): Promise<{ fileName: string; data: string; mimeType: string; isMissing: boolean }> {
  const fileName = relPath.split('/').pop() || '';
  const cdnUrl = getCamImageUrl(relPath);
  try {
    let res = await fetch(cdnUrl);
    let blob = res.ok ? await res.blob() : null;
    if (!res.ok || !blob || blob.type.includes('html')) {
      res = await fetch(`/${relPath.replace(/^\/+/, '')}`);
      if (!res.ok) {
        return { fileName, data: '', mimeType: '', isMissing: true };
      }
      blob = await res.blob();
      if (blob.type.includes('html')) {
        return { fileName, data: '', mimeType: '', isMissing: true };
      }
    }
    return await new Promise(resolve => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const b64 = (reader.result as string).split(',')[1];
        resolve({ fileName, data: b64, mimeType: blob.type || 'image/jpeg', isMissing: false });
      };
      reader.readAsDataURL(blob);
    });
  } catch {
    return { fileName, data: '', mimeType: '', isMissing: true };
  }
}

export type CameraMediaResolution = 'MEDIA_RESOLUTION_MEDIUM' | 'MEDIA_RESOLUTION_HIGH';

/**
 * AI解析結果1件の物理的整合性・スキーマ互換性を正規化する
 */
export function normalizeImageAnalysis(raw: ImageAnalysis): ImageAnalysis {
  const res: ImageAnalysis = { ...raw };

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
    // 高曇り(high_clouds)を含め、山頂ピーク視認可能時はすべて 'clear' に統一
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

const LOCATION_BY_ID = new Map(CAMERA_LOCATIONS.map(loc => [loc.id, loc]));

async function analyzeImageChunk(
  targetDate: string,
  seasonMode: SeasonMode,
  hourSlot: string,
  chunkImages: { fileName: string; data: string; mimeType: string }[],
  apiKey: string,
  preferredModel: string,
  mediaResolution: CameraMediaResolution = 'MEDIA_RESOLUTION_HIGH'
): Promise<{ items: ImageAnalysis[]; usedModel: string }> {
  const seasonLabel =
    seasonMode === 'winter_bc'
      ? '冬山・バックカントリー期（11〜4月：山頂露出に加え、中腹1,000mオープンバーンや森林限界500mの視界高度・積雪ラインを重視）'
      : '夏山・登山観光期（5〜10月：全天雲量・雲底高度と1,721m山頂ピーク露出、高曇り含む山の天候・視界を重視）';

  const parts: Array<Record<string, unknown>> = [
    {
      text: `対象日時: ${targetDate} ${hourSlot}:00頃（${seasonLabel}）\n同一時刻の全方位ライブカメラ画像（${chunkImages.length}地点）を比較し、空の雲量と山の視界を切り分けて各 fileName ごとにJSON配列で返してください。`,
    },
  ];
  for (const img of chunkImages) {
    const camId = img.fileName.replace(/^\d{2}_/, '').replace(/\.[^.]+$/, '') as CameraId;
    const loc = LOCATION_BY_ID.get(camId);
    const label = loc ? `${img.fileName}（${loc.name}）` : img.fileName;
    parts.push({ text: `ファイル名: ${label}` });
    parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
  }

  const fallbackChain = [
    preferredModel,
    ...CAMERA_MODELS.map(m => m.id).filter(id => id !== preferredModel),
  ];

  let lastErr: Error | null = null;

  for (const modelName of fallbackChain) {
    try {
      assertWithinMonthlyBudget();
      const thinkingConfig = getThinkingConfigForModel(modelName, 'camera');
      const isGemini4 = modelName.startsWith('gemini-4');

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: STRICT_SYSTEM_PROMPT }],
            },
            contents: [{ role: 'user', parts }],
            generationConfig: {
              responseMimeType: 'application/json',
              maxOutputTokens: 8192,
              ...(thinkingConfig ? { thinkingConfig } : {}),
              ...(isGemini4 ? { mediaResolution } : {}),
              responseSchema: cameraPromptSpec.responseSchema,
              temperature: 0.1,
            },
          }),
        }
      );

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        const status = response.status;
        const msg = errJson.error?.message || response.statusText;
        if (status === 429 || status === 503 || status === 404 || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED')) {
          lastErr = new Error(`モデル ${modelName} 利用不可/制限 (${status}): ${msg}`);
          continue;
        }
        throw new Error(`API Error (${status}): ${msg}`);
      }

      const data = await response.json();
      recordGeminiUsage(modelName, data.usageMetadata);
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) throw new Error('AIから有効なレスポンスが返りませんでした。');

      const cleanText = rawText.replace(/```json|```/g, '').trim();
      const resultJson: ImageAnalysis[] = JSON.parse(cleanText);
      const normalized = resultJson.map(normalizeImageAnalysis);

      return { items: normalized, usedModel: modelName };
    } catch (err: unknown) {
      if (isBudgetExceededError(err)) {
        throw err;
      }
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastErr || new Error('すべてのAIモデルで解析に失敗しました。');
}

/**
 * 1日分のカメラ画像をAI解析する。
 * history.json の実記録を参照し、未記録スロットへの無駄な 404 リクエストを発生させない。
 */
export async function analyzeSingleDateWithAi(
  targetDate: string,
  options: {
    history: CamHistory | null;
    preferredModel: string;
    mediaResolution?: CameraMediaResolution;
  }
): Promise<{ results: ImageAnalysis[]; usedModel: string }> {
  const { history, preferredModel, mediaResolution = 'MEDIA_RESOLUTION_HIGH' } = options;
  const targetHours = getTargetHoursForDate(targetDate);
  const seasonMode = getSeasonModeForDate(targetDate);
  const dayRec = history?.records?.[targetDate];

  const relPaths: string[] = [];
  if (dayRec) {
    for (const hr of targetHours) {
      const hrObj = dayRec[hr];
      if (!hrObj || typeof hrObj !== 'object') continue;
      for (const loc of CAMERA_LOCATIONS) {
        const recordedPath = hrObj[loc.id];
        if (typeof recordedPath === 'string' && recordedPath.trim()) {
          relPaths.push(recordedPath.replace(/^\/+/, ''));
        }
      }
    }
  } else {
    const activeLocs = partitionCamerasForDisplay(CAMERA_LOCATIONS, {
      dateStr: targetDate,
      history,
    }).visible;
    for (const hr of targetHours) {
      for (const loc of activeLocs) {
        relPaths.push(`cams/${targetDate}/${hr}_${loc.id}.jpg`);
      }
    }
  }

  if (relPaths.length === 0) {
    return { results: [], usedModel: 'skip' };
  }

  const fetchResults = await Promise.all(relPaths.map(fetchCamImageAsBase64));
  const fetchedImages = fetchResults.filter(r => !r.isMissing);
  const dateResults: ImageAnalysis[] = [];

  fetchResults
    .filter(r => r.isMissing)
    .forEach(r => {
      dateResults.push({
        fileName: r.fileName,
        is_sunny: false,
        summit_visible: false,
        cloud_cover: -1,
        visibility: 'missing',
        visible_elevation_m: 0,
        bc_field_status: 'whiteout',
        snow_line: 'none',
        reason: '画像未記録のため解析スキップ',
        status: 'missing',
      });
    });

  const blackoutChecks = await Promise.all(
    fetchedImages.map(async img => ({
      img,
      check: await detectImageBlackoutFromDataUrl(img.data, img.mimeType),
    }))
  );

  const validImages: { fileName: string; data: string; mimeType: string }[] = [];
  for (const { img, check } of blackoutChecks) {
    if (check.isInvalid) {
      dateResults.push({
        fileName: img.fileName,
        is_sunny: false,
        summit_visible: false,
        cloud_cover: -1,
        visibility: 'camera_error',
        visible_elevation_m: 0,
        bc_field_status: 'whiteout',
        snow_line: 'none',
        reason: `カメラ障害・暗転のため統計から除外 (${check.reason})`,
        status: 'camera_error',
      });
    } else {
      validImages.push(img);
    }
  }

  if (validImages.length === 0) {
    return { results: dateResults, usedModel: 'skip' };
  }

  const { apiKey } = resolveGeminiApiKey();
  if (!apiKey) {
    throw new Error(
      'Gemini APIキーが設定されていません。ローカルの .env.development.local に設定するか、管理パネルから一時APIキーを入力してください。'
    );
  }
  assertWithinMonthlyBudget();

  // 時間帯別（同時間帯の全方位カメラを1チャンク）でグループ化し、方角順（北→南）に並べて比較解析
  const locOrder = new Map<string, number>(CAMERA_LOCATIONS.map((loc, idx) => [loc.id, idx]));
  const slotGroups = new Map<string, { fileName: string; data: string; mimeType: string }[]>();

  for (const img of validImages) {
    const slotMatch = img.fileName.match(/^(\d{2})_/);
    const slot = slotMatch ? slotMatch[1] : '00';
    const arr = slotGroups.get(slot) || [];
    arr.push(img);
    slotGroups.set(slot, arr);
  }

  const sortedSlots = Array.from(slotGroups.keys()).sort();
  let lastUsedModel = preferredModel;

  for (let i = 0; i < sortedSlots.length; i++) {
    const slot = sortedSlots[i];
    const chunk = (slotGroups.get(slot) || []).sort((a, b) => {
      const aId = a.fileName.replace(/^\d{2}_/, '').replace(/\.[^.]+$/, '');
      const bId = b.fileName.replace(/^\d{2}_/, '').replace(/\.[^.]+$/, '');
      return (locOrder.get(aId) ?? 99) - (locOrder.get(bId) ?? 99);
    });

    const { items, usedModel } = await analyzeImageChunk(
      targetDate,
      seasonMode,
      slot,
      chunk,
      apiKey,
      preferredModel,
      mediaResolution
    );
    lastUsedModel = usedModel;
    dateResults.push(...items);

    if (i + 1 < sortedSlots.length) {
      await new Promise(r => setTimeout(r, 600));
    }
  }

  return { results: dateResults, usedModel: lastUsedModel };
}
