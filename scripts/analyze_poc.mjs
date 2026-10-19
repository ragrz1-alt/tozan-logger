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

async function analyzeImages() {
  const apiKey = await loadApiKey();
  const ai = new GoogleGenAI({ apiKey });

  const targetDir = path.join(process.cwd(), 'public', 'cams', '2026-08-01');
  
  // 実験のため、鴛泊、沓形、仙法志の10時の画像をピックアップ
  const targetFiles = [
    '10_oshidomari.jpg',
    '10_kutsugata.jpg',
    '10_senposhi.jpg',
    '05_oshidomari.jpg', // 早朝の様子
    '15_senposhi.jpg'    // 午後の様子
  ];

  const results = {};

  const schema = {
    type: Type.OBJECT,
    properties: {
      is_sunny: { type: Type.BOOLEAN, description: "画像内に青空が見えるか、または山に日が当たって晴れているか" },
      cloud_cover: { type: Type.INTEGER, description: "画像全体の雲の量を0(快晴)〜10(真っ白)の11段階で評価" },
      visibility: { 
        type: Type.STRING, 
        description: "山の見え方・視界の状態（clear: 良好、cloudy: 雲がかかっている、foggy: ガス・濃霧で真っ白・見えない）" 
      },
      reason: { type: Type.STRING, description: "判定理由（例：山頂付近は雲に覆われているが青空は見えるため）" }
    },
    required: ["is_sunny", "cloud_cover", "visibility", "reason"]
  };

  console.log('--- 画像解析 PoC を開始します ---');

  for (const fileName of targetFiles) {
    const filePath = path.join(targetDir, fileName);
    console.log(`\n解析中: ${fileName}...`);
    
    try {
      const imagePart = await fileToGenerativePart(filePath, "image/jpeg");
      
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
          { 
            role: 'user', 
            parts: [
              { text: "あなたは山の天候を判定するアシスタントです。提供された山の画像から天候と視界をJSON形式で解析してください。" },
              imagePart
            ]
          }
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: schema,
          temperature: 0.1, // 決定論的にする
        }
      });

      const resultJson = JSON.parse(response.text);
      results[fileName] = resultJson;
      console.log(`[完了] ${fileName}:`, resultJson);

    } catch (error) {
      console.error(`[エラー] ${fileName} の解析に失敗しました:`, error.message);
    }
  }

  // 結果を保存
  const outPath = path.join(process.cwd(), 'public', 'cams', 'poc_results.json');
  await fs.writeFile(outPath, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`\n解析が完了しました。結果を保存しました: ${outPath}`);
}

analyzeImages().catch(console.error);
