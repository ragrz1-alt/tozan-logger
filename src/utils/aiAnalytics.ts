import { GoogleGenAI } from '@google/genai';

export interface AIAnalysisRequest {
  year: string;
  month: number;
  totalEnter: number;
  prevTotalEnter: number | null;
  diffEnter: number | null;
  diffPercent: string | null;
  peakDate: string | undefined;
  peakCount: number;
  notes: string;
}

export async function generateMonthlyAnalysis(data: AIAnalysisRequest): Promise<string> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('VITE_GEMINI_API_KEY が設定されていません。環境変数 (.env) を確認してください。');
  }

  const ai = new GoogleGenAI({ apiKey });

  const prevText = data.prevTotalEnter !== null
    ? `前年同月: ${data.prevTotalEnter}人 (前年比: ${data.diffPercent}%, 増減: ${data.diffEnter}人)`
    : '前年同月のデータなし';

  const peakText = data.peakDate
    ? `ピーク日: ${data.peakDate} (${data.peakCount}人)`
    : 'ピーク日のデータなし';

  const prompt = `
あなたは北海道利尻島の登山・観光データアナリストです。
Google検索機能を利用して、対象月の一般的な天候や気象災害、カレンダーの状況（連休の並びなど）を把握してください。
以下の「アプリ自動集計データ」と「管理者からの補足情報」を掛け合わせ、今月がどのような月だったのか解説レポートを作成してください。

■ 対象月: ${data.year}年${data.month}月
■ アプリ自動集計データ:
・今月の入山者・利用者数: ${data.totalEnter}人
・${prevText}
・${peakText}
■ 管理者からの補足情報 (ローカルな特記事項など):
${data.notes || '特記事項なし'}

【指示】
以下の構成でレポートを作成してください。
1. 今月の総括（1〜2行で、増減の結論をズバリと）
2. データと要因の解説（前年と比較してなぜ伸びた/減ったのか、補足情報を元に推察・解説）
3. 曜日や天候・交通要因が与えた影響の詳細
4. 来年度の同月へ向けた示唆（例: 天候リスクへの備え、イベント等の提案）

出力はMarkdown形式で、読みやすく見出しや箇条書きを活用してください。
`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        temperature: 0.7,
      }
    });

    return response.text || '解析結果を生成できませんでした。';
  } catch (error) {
    console.error('AI Analysis Error:', error);
    throw new Error('AI解析中にエラーが発生しました。APIキーやネットワーク接続状況を確認してください。');
  }
}
