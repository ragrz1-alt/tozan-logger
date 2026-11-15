import fs from 'fs/promises';
import path from 'path';

export const DEFAULT_MONTHLY_BUDGET_USD = 8.5;
const USAGE_FILE_NAME = '.ai-usage-budget.json';

const MODEL_PRICING_MAP = {
  'gemini-4-hydrogen': { inputPer1M: 1.5, cachedInputPer1M: 0.075, outputPer1M: 7.5 },
  'gemini-4-argon': { inputPer1M: 3.0, cachedInputPer1M: 0.3, outputPer1M: 15.0 },
  'gemini-4-carbon': { inputPer1M: 5.0, cachedInputPer1M: 0.5, outputPer1M: 25.0 },
  'gemini-3.7-flash': { inputPer1M: 0.5, cachedInputPer1M: 0.05, outputPer1M: 3.0 },
  'gemini-3.6-flash': { inputPer1M: 0.5, cachedInputPer1M: 0.05, outputPer1M: 3.0 },
  'gemini-3.5-flash': { inputPer1M: 0.3, cachedInputPer1M: 0.03, outputPer1M: 2.5 },
  'gemini-3.5-flash-lite': { inputPer1M: 0.15, cachedInputPer1M: 0.02, outputPer1M: 0.6 },
  'gemini-3.1-flash-lite': { inputPer1M: 0.15, cachedInputPer1M: 0.02, outputPer1M: 0.6 },
  'gemini-2.5-flash-lite': { inputPer1M: 0.15, cachedInputPer1M: 0.02, outputPer1M: 0.6 },
  'gemini-2.5-flash': { inputPer1M: 0.3, cachedInputPer1M: 0.03, outputPer1M: 2.5 },
};

const FALLBACK_PRICING = { inputPer1M: 2.0, cachedInputPer1M: 0.2, outputPer1M: 10.0 };

export class BudgetExceededError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BudgetExceededError';
  }
}

export function isBudgetExceededError(err) {
  return err instanceof BudgetExceededError || (err instanceof Error && err.name === 'BudgetExceededError');
}

function getCurrentYearMonthJst() {
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  return jst.toISOString().slice(0, 7);
}

export function getMonthlyBudgetLimitUsd() {
  const raw = process.env.GEMINI_MONTHLY_BUDGET_USD || process.env.VITE_GEMINI_MONTHLY_BUDGET_USD;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MONTHLY_BUDGET_USD;
}

/**
 * 環境変数 -> .env.development.local -> .env.local -> .env の順で API キーを読み込む
 * （本番ビルド vite build が読み込まない .env.development.local を最優先推奨）
 */
export async function loadGeminiApiKey() {
  if (process.env.VITE_GEMINI_API_KEY?.trim()) {
    return process.env.VITE_GEMINI_API_KEY.trim();
  }
  for (const envFile of ['.env.development.local', '.env.local', '.env']) {
    try {
      const envContent = await fs.readFile(path.join(process.cwd(), envFile), 'utf-8');
      const match = envContent.match(/^VITE_GEMINI_API_KEY=(.*)$/m);
      if (match && match[1].trim()) {
        return match[1].trim().replace(/^["']|["']$/g, '');
      }
    } catch {
      // file not found
    }
  }
  throw new Error('VITE_GEMINI_API_KEY が環境変数または .env.local / .env に設定されていません');
}

export function getThinkingConfigForModel(modelName, purpose = 'camera') {
  if (!modelName.startsWith('gemini-4')) {
    return undefined;
  }
  return {
    thinkingLevel: purpose === 'camera' ? 'low' : 'medium',
  };
}

function estimateRequestCostUsd(modelName, usage) {
  const normalized = modelName.replace(/^models\//, '');
  const pricing = MODEL_PRICING_MAP[normalized] || FALLBACK_PRICING;
  if (!usage) {
    return { costUsd: 0.005, inputTokens: 0, outputTokens: 0, thoughtsTokens: 0 };
  }
  const cachedTokens = Math.max(0, usage.cachedContentTokenCount || 0);
  const rawPromptTokens = Math.max(0, usage.promptTokenCount || 0) + Math.max(0, usage.toolUsePromptTokenCount || 0);
  const nonCachedInputTokens = Math.max(0, rawPromptTokens - cachedTokens);
  const candidatesTokens = Math.max(0, usage.candidatesTokenCount || 0);
  const thoughtsTokens = Math.max(0, usage.thoughtsTokenCount || 0);
  const totalOutputTokens = candidatesTokens + thoughtsTokens;

  const costUsd =
    (nonCachedInputTokens / 1_000_000) * pricing.inputPer1M +
    (cachedTokens / 1_000_000) * pricing.cachedInputPer1M +
    (totalOutputTokens / 1_000_000) * pricing.outputPer1M;

  return { costUsd, inputTokens: rawPromptTokens, outputTokens: candidatesTokens, thoughtsTokens };
}

function getUsageFilePath() {
  return path.join(process.cwd(), USAGE_FILE_NAME);
}

export async function getMonthlyUsageState() {
  const currentYm = getCurrentYearMonthJst();
  const empty = {
    yearMonth: currentYm,
    estimatedCostUsd: 0,
    requestCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    thoughtsTokens: 0,
    lastUpdatedAt: null,
  };
  try {
    const raw = await fs.readFile(getUsageFilePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed.yearMonth !== currentYm) return empty;
    return {
      yearMonth: currentYm,
      estimatedCostUsd: Number(parsed.estimatedCostUsd) || 0,
      requestCount: Number(parsed.requestCount) || 0,
      inputTokens: Number(parsed.inputTokens) || 0,
      outputTokens: Number(parsed.outputTokens) || 0,
      thoughtsTokens: Number(parsed.thoughtsTokens) || 0,
      lastUpdatedAt: parsed.lastUpdatedAt || null,
    };
  } catch {
    return empty;
  }
}

export async function assertWithinMonthlyBudget() {
  const limitUsd = getMonthlyBudgetLimitUsd();
  const state = await getMonthlyUsageState();
  if (state.estimatedCostUsd >= limitUsd) {
    throw new BudgetExceededError(
      `[予算ガード] 今月 (${state.yearMonth}) の推定利用額が安全上限 $${limitUsd.toFixed(2)}（特典$10枠）に達したため処理を中断しました。`
    );
  }
  return { state, limitUsd };
}

export async function recordGeminiUsage(modelName, usage) {
  const state = await getMonthlyUsageState();
  const est = estimateRequestCostUsd(modelName, usage);
  const next = {
    yearMonth: state.yearMonth,
    estimatedCostUsd: Math.round((state.estimatedCostUsd + est.costUsd) * 1_000_000) / 1_000_000,
    requestCount: state.requestCount + 1,
    inputTokens: state.inputTokens + est.inputTokens,
    outputTokens: state.outputTokens + est.outputTokens,
    thoughtsTokens: state.thoughtsTokens + est.thoughtsTokens,
    lastUpdatedAt: new Date().toISOString(),
  };
  await fs.writeFile(getUsageFilePath(), JSON.stringify(next, null, 2), 'utf-8');
  return { state: next, requestCostUsd: est.costUsd };
}
