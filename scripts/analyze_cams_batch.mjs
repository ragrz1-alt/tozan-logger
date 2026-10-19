import { GoogleGenAI, Type } from '@google/genai';
import fs from 'fs/promises';
import path from 'path';

// .env.local または .env ファイルから API キーを読み込む
async function loadApiKey() {
  if (process.env.VITE_GEMINI_API_KEY) return process.env.VITE_GEMINI_API_KEY;
  for (const envFile of ['.env.local', '.env']) {
    try {
      const envContent = await fs.readFile(path.join(process.cwd(), envFile), 'utf-8');
      const match = envContent.match(/VITE_GEMINI_API_KEY=(.*)/);
      if (match && match[1].trim()) return match[1].trim();
    } catch {}
  }
  throw new Error('VITE_GEMINI_API_KEY is not set');
}

// 画像ファイルをBase64に変換
async function fileToGenerativePart(filePath, mimeType) {
  const data = await fs.readFile(filePath);
  return {
    inlineData: {
      data: Buffer.from(data).toString('base64'),
      mimeType,
    },
  };
}

const LOCATIONS = ['oshidomari', 'kutsugata', 'senposhi'];
const TIMES = ['05', '07', '09', '11', '13', '15', '17'];

// レート制限 (500 RPD / 15 RPM) に最適化されたモデルフォールバックチェーン
const CAMERA_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash-lite',
];

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const SYSTEM_PROMPT = `あなたは北海道・利尻山（独立峰・標高1,721m）の山岳気象・視界判定の専門AIアナリストです。
定点ライブカメラ（oshidomari=北側・鴛泊、kutsugata=西側・沓形、senposhi=南側・仙法志）の画像から、登山者にとって最も重要な「利尻山の山体および山頂（ピーク）が見えているか」と「空全体の雲量」を厳密に区別して判定してください。

【最重要：判定の厳格ルール】
1. 手前の海・港・市街地・道路の天気に惑わされないでください。常に画角中央〜奥にそびえる「利尻山の山体・山頂ピーク」を基準に視界(visibility)を判定してください。
2. summit_visible (boolean):
   - true: 利尻山の山頂（最高峰の尖ったピーク部分）が雲や霧に隠れず、明確に輪郭まで見えている場合のみ true。
   - false: 山頂部に笠雲・山岳波雲・ガスがかかって隠れている場合や、山全体が見えない場合は必ず false。
3. visibility ('clear' | 'cloudy' | 'foggy'):
   - 'clear' (山頂快晴・視界良好): 山頂ピークから稜線・山麓まで雲に隠れずクッキリ見えている状態（summit_visible が true であることが絶対条件。空に青空が見えていても、山頂ピークが雲に隠れていれば絶対に 'clear' にしてはいけません）。
   - 'cloudy' (山頂雲隠れ・一部視認): 山の裾野〜中腹（稜線の一部）は見えているが、山頂（ピーク）付近が雲や笠雲に隠れている状態。または高曇りで山全体の輪郭は見えるが厚い雲で日差しがない状態。
   - 'foggy' (山体ガス・視界不良・山体不可視): 低い雲・濃霧（ガス）・悪天候により、利尻山の山体全体（または中腹から上の大部分）が白や灰色の雲に覆われて見えない状態。※カメラ手前の町や海が見えていても、肝心の「山」が見えなければ必ず 'foggy' と判定してください。
4. cloud_cover (0〜10の整数):
   - 0〜2: 快晴（雲がほとんどない）
   - 3〜5: 晴れ（一部に雲があるが青空が多い、または山頂のみ笠雲）
   - 6〜8: 曇り（空の大部分が雲に覆われている）
   - 9〜10: 全天曇天・濃霧（空全体が隙間なく雲または真っ白なガスに覆われている）
5. is_sunny (boolean):
   - 青空が明確に見える、または山体・地表に直射日光が当たっている場合は true。`;

async function analyzeImagesForDate(ai, targetDate, resultsData) {
  const targetDir = path.join(process.cwd(), 'public', 'cams', targetDate);
  const dateResults = [];

  console.log(`\n=== 解析開始: ${targetDate} ===`);

  const parts = [
    {
      text: `対象日 ${targetDate} の利尻山ライブカメラ画像群です。各画像の fileName ごとに、厳格ルールに従って summit_visible, visibility, cloud_cover, is_sunny, reason をJSON配列で返してください。`,
    },
  ];

  const targetFiles = [];

  for (const time of TIMES) {
    for (const loc of LOCATIONS) {
      const fileName = `${time}_${loc}.jpg`;
      const filePath = path.join(targetDir, fileName);
      try {
        await fs.access(filePath);
        targetFiles.push({ fileName, filePath });
      } catch {
        dateResults.push({
          fileName,
          is_sunny: false,
          summit_visible: false,
          cloud_cover: -1,
          visibility: 'missing',
          reason: '画像取得エラーのため解析スキップ',
          status: 'missing',
        });
      }
    }
  }

  if (targetFiles.length === 0) {
    console.log(`[スキップ] ${targetDate} には解析可能な画像が1枚もありませんでした。`);
    resultsData[targetDate] = dateResults;
    return;
  }

  for (const fileInfo of targetFiles) {
    try {
      const imagePart = await fileToGenerativePart(fileInfo.filePath, 'image/jpeg');
      parts.push({ text: `ファイル名: ${fileInfo.fileName}` });
      parts.push(imagePart);
    } catch (e) {
      console.error(`画像読み込みエラー: ${fileInfo.fileName}`, e);
    }
  }

  const schema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        fileName: { type: Type.STRING, description: '解析した画像のファイル名' },
        summit_visible: {
          type: Type.BOOLEAN,
          description: '利尻山の山頂ピーク（最高点）が雲に隠れずはっきり見えているか',
        },
        is_sunny: {
          type: Type.BOOLEAN,
          description: '画像内に青空が見えるか、または山や地表に日が当たって晴れているか',
        },
        cloud_cover: {
          type: Type.INTEGER,
          description: '空全体の雲の量を0(快晴)〜10(全天雲・濃霧)の11段階で評価',
        },
        visibility: {
          type: Type.STRING,
          description: "山の見え方（'clear': 山頂まで快晴視認、'cloudy': 裾野や中腹は見えるが山頂雲隠れ・曇天、'foggy': 山体全体がガス・雲で不可視）",
        },
        reason: {
          type: Type.STRING,
          description: '判定理由（例：青空はあるが山頂ピークに笠雲がかかり隠れているためcloudy）',
        },
      },
      required: ['fileName', 'summit_visible', 'is_sunny', 'cloud_cover', 'visibility', 'reason'],
    },
  };

  let lastError = null;
  for (const modelName of CAMERA_MODELS) {
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: [{ role: 'user', parts }],
        config: {
          systemInstruction: SYSTEM_PROMPT,
          responseMimeType: 'application/json',
          responseSchema: schema,
          temperature: 0.1,
        },
      });

      const aiResults = JSON.parse(response.text);
      console.log(`[成功:${modelName}] ${targetDate} のAI解析完了（対象: ${targetFiles.length}枚）`);

      // 二重ロック補正（AIが山頂が見えないとしているのにclearにした場合等をプログラムで厳格補正）
      for (const res of aiResults) {
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
        res.status = 'ok';
        dateResults.push(res);
      }

      resultsData[targetDate] = dateResults;
      return;
    } catch (error) {
      lastError = error;
      console.warn(`[警告] モデル ${modelName} でエラー (${error.message})。次のモデルを試行します...`);
      await sleep(2000);
    }
  }

  throw lastError || new Error('すべてのモデルで解析に失敗しました');
}

async function getAvailableCamDates() {
  const camsDir = path.join(process.cwd(), 'public', 'cams');
  const entries = await fs.readdir(camsDir, { withFileTypes: true });
  return entries
    .filter(e => e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name))
    .map(e => e.name)
    .sort();
}

async function main() {
  const args = process.argv.slice(2);
  const shouldClear = args.includes('--clear');
  const forceOverwrite = args.includes('--force') || shouldClear;
  const fromIdx = args.indexOf('--from');
  const toIdx = args.indexOf('--to');
  const fromDate = fromIdx !== -1 ? args[fromIdx + 1] : null;
  const toDate = toIdx !== -1 ? args[toIdx + 1] : null;

  const apiKey = await loadApiKey();
  const ai = new GoogleGenAI({ apiKey });

  const outPath = path.join(process.cwd(), 'public', 'cams', 'analysis_results.json');
  let resultsData = {};

  if (shouldClear) {
    console.log('🗑️ --clear が指定されたため、既存の解析データをクリアして新規作成します。');
    resultsData = {};
    await fs.writeFile(outPath, JSON.stringify(resultsData, null, 2), 'utf-8');
  } else {
    try {
      const existing = await fs.readFile(outPath, 'utf-8');
      resultsData = JSON.parse(existing);
    } catch {
      console.log('既存の analysis_results.json が見つからないため、新規作成します。');
    }
  }

  let targetDates = await getAvailableCamDates();
  if (fromDate) targetDates = targetDates.filter(d => d >= fromDate);
  if (toDate) targetDates = targetDates.filter(d => d <= toDate);

  console.log(`対象期間: ${targetDates[0] || 'なし'} 〜 ${targetDates[targetDates.length - 1] || 'なし'} (計 ${targetDates.length} 日)`);

  for (const dateStr of targetDates) {
    if (!forceOverwrite && resultsData[dateStr] && resultsData[dateStr].length > 0) {
      console.log(`${dateStr} は既に解析済みのためスキップします（上書きする場合は --force を指定）。`);
      continue;
    }

    let success = false;
    for (let retry = 0; retry < 3; retry++) {
      try {
        await analyzeImagesForDate(ai, dateStr, resultsData);
        if (resultsData[dateStr] && resultsData[dateStr].length > 0) {
          success = true;
          break;
        }
      } catch (err) {
        console.error(`リトライ ${retry + 1}/3 (15秒待機)...`, err.message);
        await sleep(15000);
      }
    }

    if (success) {
      await fs.writeFile(outPath, JSON.stringify(resultsData, null, 2), 'utf-8');
    } else {
      console.error(`${dateStr} はリトライ後も失敗しました。`);
    }

    // 15 RPM (1分15回 = 4秒に1回) のレート制限を守るため 4.2秒待機
    await sleep(4200);
  }

  console.log(`\n✅ 全てのバッチ解析が完了しました。結果を保存しました: ${outPath}`);
}

main().catch(console.error);
