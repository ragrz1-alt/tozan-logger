/**
 * Gemini API のセキュリティ（一時セッションキー / 公開ビルド時のキー非埋め込み対応）
 * および Google AI Pro 月額 $10 クレジットを超過させないためのローカル予算サーキットブレーカー
 */

export const DEFAULT_MONTHLY_BUDGET_USD = 8.5;

const SESSION_API_KEY_STORAGE = 'tozan_session_gemini_api_key_v1';
const MONTHLY_USAGE_STORAGE = 'tozan_ai_monthly_usage_v1';
export const AI_USAGE_UPDATED_EVENT = 'tozan-ai-usage-updated';

export interface ModelPricing {
  inputPer1M: number;
  cachedInputPer1M: number;
  outputPer1M: number;
}

/** 100万トークンあたりの単価 (USD)。未記載モデルは安全側（高め）のフォールバック単価を適用 */
const MODEL_PRICING_MAP: Record<string, ModelPricing> = {
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

const FALLBACK_PRICING: ModelPricing = {
  inputPer1M: 2.0,
  cachedInputPer1M: 0.2,
  outputPer1M: 10.0,
};

export interface UsageMetadataLike {
  promptTokenCount?: number;
  cachedContentTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  toolUsePromptTokenCount?: number;
  totalTokenCount?: number;
}

export interface MonthlyAiUsageState {
  yearMonth: string;
  estimatedCostUsd: number;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  thoughtsTokens: number;
  lastUpdatedAt: string | null;
}

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetExceededError';
  }
}

export function isBudgetExceededError(err: unknown): boolean {
  return err instanceof BudgetExceededError || (err instanceof Error && err.name === 'BudgetExceededError');
}

export function getCurrentYearMonthJst(): string {
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  return jst.toISOString().slice(0, 7);
}

export function getMonthlyBudgetLimitUsd(): number {
  const raw = import.meta.env.VITE_GEMINI_MONTHLY_BUDGET_USD;
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return DEFAULT_MONTHLY_BUDGET_USD;
}

export function getSessionGeminiApiKey(): string {
  try {
    return (sessionStorage.getItem(SESSION_API_KEY_STORAGE) || '').trim();
  } catch {
    return '';
  }
}

export function setSessionGeminiApiKey(key: string): void {
  try {
    const trimmed = key.trim();
    if (trimmed) {
      sessionStorage.setItem(SESSION_API_KEY_STORAGE, trimmed);
    } else {
      sessionStorage.removeItem(SESSION_API_KEY_STORAGE);
    }
    window.dispatchEvent(new Event(AI_USAGE_UPDATED_EVENT));
  } catch {
    // sessionStorage unavailable
  }
}

export function resolveGeminiApiKey(): {
  apiKey: string;
  source: 'session' | 'env' | 'none';
} {
  const sessionKey = getSessionGeminiApiKey();
  if (sessionKey) {
    return { apiKey: sessionKey, source: 'session' };
  }
  const envKey = (import.meta.env.VITE_GEMINI_API_KEY || '').trim();
  if (envKey) {
    return { apiKey: envKey, source: 'env' };
  }
  return { apiKey: '', source: 'none' };
}

/**
 * Gemini 4 系はデフォルトの思考レベルが high で出力トークン消費が大きいため、
 * 用途に応じて思考レベルを最適化してコストを抑える
 */
export function getThinkingConfigForModel(
  modelName: string,
  purpose: 'report' | 'camera'
): { thinkingLevel: 'low' | 'medium' } | undefined {
  if (!modelName.startsWith('gemini-4')) {
    return undefined;
  }
  return {
    thinkingLevel: purpose === 'camera' ? 'low' : 'medium',
  };
}

export function getModelPricing(modelName: string): ModelPricing {
  const normalized = modelName.replace(/^models\//, '');
  return MODEL_PRICING_MAP[normalized] || FALLBACK_PRICING;
}

export function estimateRequestCostUsd(modelName: string, usage?: UsageMetadataLike | null): {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  thoughtsTokens: number;
} {
  const pricing = getModelPricing(modelName);
  if (!usage) {
    // usageMetadata が欠損した場合の安全側最低見積 ($0.005)
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

  return {
    costUsd,
    inputTokens: rawPromptTokens,
    outputTokens: candidatesTokens,
    thoughtsTokens,
  };
}

function createEmptyUsageState(yearMonth: string): MonthlyAiUsageState {
  return {
    yearMonth,
    estimatedCostUsd: 0,
    requestCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    thoughtsTokens: 0,
    lastUpdatedAt: null,
  };
}

export function getMonthlyUsageState(): MonthlyAiUsageState {
  const currentYm = getCurrentYearMonthJst();
  try {
    const raw = localStorage.getItem(MONTHLY_USAGE_STORAGE);
    if (!raw) return createEmptyUsageState(currentYm);
    const parsed = JSON.parse(raw) as Partial<MonthlyAiUsageState>;
    if (parsed.yearMonth !== currentYm) {
      return createEmptyUsageState(currentYm);
    }
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
    return createEmptyUsageState(currentYm);
  }
}

export function assertWithinMonthlyBudget(): void {
  const limitUsd = getMonthlyBudgetLimitUsd();
  const state = getMonthlyUsageState();
  if (state.estimatedCostUsd >= limitUsd) {
    throw new BudgetExceededError(
      `今月（${state.yearMonth}）のアプリ側AI推定利用額が安全上限（$${limitUsd.toFixed(2)} / 特典$10枠）に達したため自動停止しました。Google Cloud の課金画面を確認するまで追加リクエストをブロックしています。`
    );
  }
}

export function recordGeminiUsage(
  modelName: string,
  usage?: UsageMetadataLike | null
): MonthlyAiUsageState {
  const state = getMonthlyUsageState();
  const est = estimateRequestCostUsd(modelName, usage);
  const next: MonthlyAiUsageState = {
    yearMonth: state.yearMonth,
    estimatedCostUsd: Math.round((state.estimatedCostUsd + est.costUsd) * 1_000_000) / 1_000_000,
    requestCount: state.requestCount + 1,
    inputTokens: state.inputTokens + est.inputTokens,
    outputTokens: state.outputTokens + est.outputTokens,
    thoughtsTokens: state.thoughtsTokens + est.thoughtsTokens,
    lastUpdatedAt: new Date().toISOString(),
  };

  try {
    localStorage.setItem(MONTHLY_USAGE_STORAGE, JSON.stringify(next));
    window.dispatchEvent(new Event(AI_USAGE_UPDATED_EVENT));
  } catch {
    // localStorage unavailable
  }
  return next;
}
