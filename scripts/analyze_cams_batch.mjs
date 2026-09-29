import { GoogleGenAI, Type } from '@google/genai';
import fs from 'fs/promises';
import path from 'path';

// .env ファイルから API キーを簡易的に読み込む
async function loadApiKey() {
  if (process.env.VITE_GEMINI_API_KEY) return process.env.VITE_GEMINI_API_KEY;
  try {
    const envContent = await fs.readFile(path.join(process.cwd(), '.env'), 'utf-8');
    const match = envContent.match(/VITE_GEMINI_API_KEY=(.*)/);
    if (match) return match[1].trim();
  } catch (e) {
    console.error('.envファイルの読み込みに失敗しました', e);
  }
  throw new Error('VITE_GEMINI_API_KEY is not set');
}

// 画像ファイルをBase64に変換
async function fileToGenerativePart(filePath, mimeType) {
  const data = await fs.readFile(filePath);
  return {
    inlineData: {
      data: Buffer.from(data).toString("base64"),
      mimeType
    },
  };
}

const LOCATIONS = ['oshidomari', 'kutsugata', 'senposhi'];
const TIMES = ['05', '08', '11', '14', '17'];

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function analyzeImagesForDate(ai, targetDate, resultsData) {
  const targetDir = path.join(process.cwd(), 'public', 'cams', targetDate);
  const dateResults = [];

  console.log(`\n=== 解析開始: ${targetDate} ===`);

  const parts = [
    { text: "あなたは山の天候を判定するアシスタントです。提供された山の画像について、天候と視界を解析し、結果の配列を返してください。提供された画像のfileNameを必ず結果に含めてください。" }
  ];

  const targetFiles = [];

  // 画像ファイルの存在確認
  for (const time of TIMES) {
    for (const loc of LOCATIONS) {
      const fileName = `${time}_${loc}.jpg`;
      const filePath = path.join(targetDir, fileName);
      try {
        await fs.access(filePath);
        targetFiles.push({ fileName, filePath });
      } catch (e) {
        // 画像が存在しない場合はスキップフラグを立てて結果に直接追加
        console.log(`[スキップ] ${fileName} が存在しません。`);
        dateResults.push({
          fileName,
          is_sunny: false,
          cloud_cover: -1,
          visibility: 'missing',
          reason: '画像取得エラーのため解析スキップ',
          status: 'missing'
        });
      }
    }
  }

  if (targetFiles.length === 0) {
    console.log(`[スキップ] ${targetDate} には解析可能な画像が1枚もありませんでした。`);
    resultsData[targetDate] = dateResults;
    return;
  }

  // 存在する画像のみプロンプトに追加
  for (const fileInfo of targetFiles) {
    try {
      const imagePart = await fileToGenerativePart(fileInfo.filePath, "image/jpeg");
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
        fileName: { type: Type.STRING, description: "解析した画像のファイル名" },
        is_sunny: { type: Type.BOOLEAN, description: "画像内に青空が見えるか、または山に日が当たって晴れているか" },
        cloud_cover: { type: Type.INTEGER, description: "画像全体の雲の量を0(快晴)〜10(真っ白)の11段階で評価" },
        visibility: { 
          type: Type.STRING, 
          description: "山の見え方・視界の状態（clear: 良好、cloudy: 雲がかかっている、foggy: ガス・濃霧で真っ白・見えない）" 
        },
        reason: { type: Type.STRING, description: "判定理由（例：山頂付近は雲に覆われているが青空は見えるため）" }
      },
      required: ["fileName", "is_sunny", "cloud_cover", "visibility", "reason"]
    }
  };

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        { 
          role: 'user', 
          parts
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: schema,
        temperature: 0.1,
      }
    });

    const aiResults = JSON.parse(response.text);
    console.log(`[成功] ${targetDate} のAI解析が完了しました。（対象: ${targetFiles.length}枚）`);
    
    // AIの結果と欠損結果をマージ
    for (const res of aiResults) {
      res.status = 'ok';
      dateResults.push(res);
    }

  } catch (error) {
    console.error(`[エラー] ${targetDate} の解析に失敗しました:`, error.message);
  }

  resultsData[targetDate] = dateResults;
}

async function main() {
  const apiKey = await loadApiKey();
  const ai = new GoogleGenAI({ apiKey });

  const outPath = path.join(process.cwd(), 'public', 'cams', 'analysis_results.json');
  let resultsData = {};

  try {
    const existing = await fs.readFile(outPath, 'utf-8');
    resultsData = JSON.parse(existing);
  } catch (e) {
    console.log('既存の analysis_results.json が見つからないため、新規作成します。');
  }

  // 処理する日付のリスト（アプリの対象期間: 2026-07-28 から 2026-09-17）
  // 試しに数日分実行したい場合はこの日付を調整する。
  const startD = new Date('2026-07-28');
  const endD = new Date('2026-09-17');
  const targetDates = [];
  for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
    targetDates.push(d.toISOString().split('T')[0]);
  }

  for (const dateStr of targetDates) {
    // 既に解析済みの場合はスキップ
    if (resultsData[dateStr] && resultsData[dateStr].length > 0) {
      console.log(`${dateStr} は既に解析済みのためスキップします。`);
      continue;
    }
    
    await analyzeImagesForDate(ai, dateStr, resultsData);
    
    // 結果を都度保存
    await fs.writeFile(outPath, JSON.stringify(resultsData, null, 2), 'utf-8');
    
    console.log('APIの制限回避のため、3秒待機します...');
    await sleep(3000);
  }

  console.log(`\n全てのバッチ解析が完了しました。結果を保存しました: ${outPath}`);
}

main().catch(console.error);
