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

export interface CameraLocationDef {
  id: CameraId;
  name: string;
  shortName: string;
  bcSlopeName: string;
  color: string;
  isCore: boolean;
}

export const CAMERA_LOCATIONS: CameraLocationDef[] = [
  {
    id: 'oshidomari',
    name: '鴛泊(本泊・北)',
    shortName: '本泊(北)',
    bcSlopeName: '北面：長官山・ポン山・大空沢',
    color: '#3b82f6',
    isCore: true,
  },
  {
    id: 'ferry',
    name: '鴛泊港(フェリー・北)',
    shortName: 'フェリー(北)',
    bcSlopeName: '北〜北北東面：鴛泊北稜俯瞰',
    color: '#0284c7',
    isCore: false,
  },
  {
    id: 'himenuma',
    name: '姫沼(北東)',
    shortName: '姫沼(北東)',
    bcSlopeName: '北東面：オチュウシナイ沢方面',
    color: '#059669',
    isCore: false,
  },
  {
    id: 'kutsugata',
    name: '沓形(西)',
    shortName: '沓形(西)',
    bcSlopeName: '西面：三眺山・見返台方面',
    color: '#10b981',
    isCore: true,
  },
  {
    id: 'otadomari',
    name: 'オタドマリ沼(南東)',
    shortName: 'オタドマリ(南東)',
    bcSlopeName: '南東面：ヤムナイ沢・南東稜方面',
    color: '#8b5cf6',
    isCore: false,
  },
  {
    id: 'senposhi',
    name: '仙法志(南)',
    shortName: '仙法志(南)',
    bcSlopeName: '南面：南稜・仙法志稜方面',
    color: '#f59e0b',
    isCore: true,
  },
];

// レート制限 (500 RPD / 15 RPM) に最適化されたモデルチェーン
export const CAMERA_MODELS = [
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite (推奨: 500回/日・15回/分)' },
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite (予備: 500回/日・15回/分)' },
  { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash (高精度・上限20回/日)' },
];

const STRICT_SYSTEM_PROMPT = `あなたは北海道・利尻山（独立峰・標高1,721m）の山岳気象・視界判定・バックカントリー(BC)フィールド解析の専門AIアナリストです。
定点ライブカメラ6地点：
- oshidomari = 北側・本泊（長官山・ポン山・大空沢方面）
- ferry = 北側・鴛泊港（北稜全体俯瞰）
- himenuma = 北東・姫沼（オチュウシナイ沢方面）
- kutsugata = 西側・沓形（三眺山・西面方面）
- otadomari = 南東・オタドマリ沼（ヤムナイ沢・南東稜方面）
- senposhi = 南側・仙法志（南稜・仙法志稜方面）
の画像から、登山者・BC滑走者・観光関係者にとって重要な「山頂ピークの露出」「標高何メートルまで視界があるか（雲底高度）」「冠雪・積雪ライン」「空全体の雲量」を厳密に判定してください。

【最重要：判定の厳格ルール】
1. 手前の海・港・沼・市街地・道路の天気に惑わされないでください。常に画角中央〜奥にそびえる「利尻山の山体・斜面・山頂ピーク」を基準に判定してください。
2. summit_visible (boolean):
   - true: 利尻山の最高峰ピーク（標高1,721mの尖った山頂部）が雲や霧に隠れず、明確に輪郭まで見えている場合のみ true。
   - false: 山頂部に笠雲・山岳波雲・雪雲・ガスがかかって隠れている場合や、山全体が見えない場合は必ず false。
3. visibility ('clear' | 'cloudy' | 'foggy' | 'camera_error'):
   - 'clear' (山頂快晴): 山頂ピーク(1,721m)から稜線・山麓までクッキリ見えている状態（summit_visible が true であることが絶対条件）。
   - 'cloudy' (山頂雲隠れ・中腹視認): 山の裾野〜中腹（稜線の一部やオープンバーン）は見えているが、山頂ピーク付近が雲や笠雲に隠れている状態。または高曇りで山全体の輪郭は見えるが厚い雲で日差しがない状態。
   - 'foggy' (山体ガス・視界不良・不可視): 低い雲・濃霧・吹雪・悪天候により、利尻山の山体全体（または中腹から上の大部分）が白や灰色の雲に覆われて見えない状態。※カメラ手前の町や海・沼が見えていても、肝心の「山」が見えなければ必ず 'foggy' と判定してください。
   - 'camera_error' (カメラ映像障害・無信号・完全暗転): 画面全体が真っ暗なノイズ画面、単色エラー画面、または配信停止テキスト画面などでカメラとして映像が機能していない状態（※悪天候の 'foggy' とは厳密に区別してください）。
4. visible_elevation_m (1700 | 1000 | 500 | 0 の4段階の整数) ＆ bc_field_status ('alpine_clear' | 'mid_mountain_ok' | 'treeline_only' | 'whiteout'):
   - 1700 / 'alpine_clear': 山頂ピーク（1,500〜1,721m）まで雲に隠れず視界が抜けている状態（summit_visible = true のとき）。
   - 1000 / 'mid_mountain_ok': 山頂ピークは雲の中だが、中腹のオープンバーン・稜線中段（標高800〜1,300m付近：長官山・三眺山・中腹斜面）までは雲底より下にあって明確に視認できる状態。
   - 500 / 'treeline_only': 中腹以上（標高600m以上）は厚い雲やガス・吹雪に隠れているが、下部の森林限界〜山麓・裾野（標高300〜600m付近）の斜面輪郭は見えている状態。
   - 0 / 'whiteout': 濃霧・全面ガス・吹雪・ホワイトアウト等により山麓から山体がまったく見えない状態（ただしカメラ無信号・真っ暗エラーは visibility='camera_error' として扱うこと）。
5. snow_line ('none' | 'summit_cap' | 'mid_slope' | 'full_snow'):
   - 'none': 山体に積雪・冠雪が見られない状態（または山体が見えず積雪が確認できない場合）。
   - 'summit_cap': 山頂部・高標高帯（目安1,200m以上）のみ白く冠雪している状態（初冠雪・残雪末期）。
   - 'mid_slope': 中腹（目安500〜1,000m付近）まで白く雪が積もっている状態。
   - 'full_snow': 山麓・裾野・海岸線近くまで山全体が真っ白に全面積雪している状態（厳冬期〜春山期）。
6. cloud_cover (0〜10の整数):
   - 0〜2: 快晴 / 3〜5: 晴れ / 6〜8: 曇り / 9〜10: 全天曇天・濃霧・吹雪
7. is_sunny (boolean):
   - 青空が明確に見える、または山体・地表に直射日光が当たっている場合は true。
8. reason (string):
   - 山頂や中腹（何m付近まで）の見え方、雲のかかり方、積雪の様子を40〜70文字程度で簡潔・具体的に記述してください。`;

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

async function analyzeImageChunk(
  targetDate: string,
  seasonMode: SeasonMode,
  chunkImages: { fileName: string; data: string; mimeType: string }[],
  apiKey: string,
  preferredModel: string
): Promise<{ items: ImageAnalysis[]; usedModel: string }> {
  const seasonLabel =
    seasonMode === 'winter_bc'
      ? '冬山・バックカントリー期（11〜4月：山頂露出に加え、中腹1000mオープンバーンや森林限界500mの視界高度・積雪ラインを重視）'
      : '夏山・登山観光期（5〜10月：1721m山頂ピーク露出と雲底高度・冠雪有無を重視）';

  const parts: Array<Record<string, unknown>> = [
    {
      text: `対象日 ${targetDate}（${seasonLabel}）の利尻山ライブカメラ画像群（${chunkImages.length}枚）です。各画像の fileName ごとに、厳格ルールに従って summit_visible, visibility, visible_elevation_m, bc_field_status, snow_line, cloud_cover, is_sunny, reason をJSON配列で返してください。`,
    },
  ];
  for (const img of chunkImages) {
    parts.push({ text: `ファイル名: ${img.fileName}` });
    parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
  }

  const fallbackChain = [
    preferredModel,
    ...CAMERA_MODELS.map(m => m.id).filter(id => id !== preferredModel),
  ];

  let lastErr: Error | null = null;

  for (const modelName of fallbackChain) {
    try {
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
              responseSchema: {
                type: 'ARRAY',
                items: {
                  type: 'OBJECT',
                  properties: {
                    fileName: { type: 'STRING' },
                    summit_visible: { type: 'BOOLEAN' },
                    is_sunny: { type: 'BOOLEAN' },
                    cloud_cover: { type: 'INTEGER' },
                    visibility: { type: 'STRING', enum: ['clear', 'cloudy', 'foggy', 'camera_error'] },
                    visible_elevation_m: { type: 'INTEGER' },
                    bc_field_status: {
                      type: 'STRING',
                      enum: ['alpine_clear', 'mid_mountain_ok', 'treeline_only', 'whiteout'],
                    },
                    snow_line: {
                      type: 'STRING',
                      enum: ['none', 'summit_cap', 'mid_slope', 'full_snow'],
                    },
                    reason: { type: 'STRING' },
                  },
                  required: [
                    'fileName',
                    'summit_visible',
                    'is_sunny',
                    'cloud_cover',
                    'visibility',
                    'visible_elevation_m',
                    'bc_field_status',
                    'snow_line',
                    'reason',
                  ],
                },
              },
              temperature: 0.1,
            },
          }),
        }
      );

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        const status = response.status;
        const msg = errJson.error?.message || response.statusText;
        if (status === 429 || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED')) {
          lastErr = new Error(`モデル ${modelName} のレート制限に達しました。次の予備モデルへ切り替えます...`);
          continue;
        }
        throw new Error(`API Error (${status}): ${msg}`);
      }

      const data = await response.json();
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) throw new Error('AIから有効なレスポンスが返りませんでした。');

      const cleanText = rawText.replace(/```json|```/g, '').trim();
      const resultJson: ImageAnalysis[] = JSON.parse(cleanText);
      const normalized: ImageAnalysis[] = [];

      for (const res of resultJson) {
        if (res.visibility === 'camera_error') {
          res.is_sunny = false;
          res.summit_visible = false;
          res.cloud_cover = -1;
          res.visible_elevation_m = 0;
          res.bc_field_status = 'whiteout';
          res.snow_line = 'none';
          res.status = 'camera_error';
          normalized.push(res);
          continue;
        }

        if (res.summit_visible === false && res.visibility === 'clear') {
          res.visibility = 'cloudy';
        }
        if (
          res.visibility === 'cloudy' &&
          (res.reason.includes('山全体が雲に隠れ') ||
            res.reason.includes('山は全く見え') ||
            res.reason.includes('山体が見え'))
        ) {
          res.visibility = 'foggy';
          res.summit_visible = false;
        }

        if (res.summit_visible && res.visibility === 'clear') {
          res.visible_elevation_m = 1700;
          res.bc_field_status = 'alpine_clear';
        } else if (res.visibility === 'cloudy') {
          if (res.visible_elevation_m === 1700 || !res.visible_elevation_m) {
            res.visible_elevation_m = 1000;
            res.bc_field_status = 'mid_mountain_ok';
          }
        } else if (res.visibility === 'foggy') {
          if (res.visible_elevation_m && res.visible_elevation_m >= 1000) {
            res.visible_elevation_m = 0;
            res.bc_field_status = 'whiteout';
          }
        }

        res.status = 'ok';
        normalized.push(res);
      }

      return { items: normalized, usedModel: modelName };
    } catch (err: unknown) {
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
  }
): Promise<{ results: ImageAnalysis[]; usedModel: string }> {
  const { history, preferredModel } = options;
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

  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) throw new Error('VITE_GEMINI_API_KEY が設定されていません。');

  const CHUNK_SIZE = 21;
  let lastUsedModel = preferredModel;

  for (let i = 0; i < validImages.length; i += CHUNK_SIZE) {
    const chunk = validImages.slice(i, i + CHUNK_SIZE);
    const { items, usedModel } = await analyzeImageChunk(targetDate, seasonMode, chunk, apiKey, preferredModel);
    lastUsedModel = usedModel;
    dateResults.push(...items);

    if (i + CHUNK_SIZE < validImages.length) {
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  return { results: dateResults, usedModel: lastUsedModel };
}
