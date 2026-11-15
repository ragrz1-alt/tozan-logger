import React, { useEffect, useState } from 'react';
import { KeyRound, ShieldCheck, AlertOctagon, Trash2 } from 'lucide-react';
import {
  AI_USAGE_UPDATED_EVENT,
  getMonthlyBudgetLimitUsd,
  getMonthlyUsageState,
  resolveGeminiApiKey,
  setSessionGeminiApiKey,
  type MonthlyAiUsageState,
} from '../utils/aiBudgetGuard';

interface AiBudgetStatusBarProps {
  compact?: boolean;
}

export const AiBudgetStatusBar: React.FC<AiBudgetStatusBarProps> = ({ compact = false }) => {
  const [usage, setUsage] = useState<MonthlyAiUsageState>(() => getMonthlyUsageState());
  const [keyInfo, setKeyInfo] = useState(() => resolveGeminiApiKey());
  const [showKeyInput, setShowKeyInput] = useState(() => resolveGeminiApiKey().source === 'none');
  const [draftKey, setDraftKey] = useState('');

  const limitUsd = getMonthlyBudgetLimitUsd();
  const ratio = Math.min(100, Math.round((usage.estimatedCostUsd / limitUsd) * 100));
  const isBlocked = usage.estimatedCostUsd >= limitUsd;
  const isWarning = !isBlocked && ratio >= 80;

  useEffect(() => {
    const sync = () => {
      setUsage(getMonthlyUsageState());
      const nextKeyInfo = resolveGeminiApiKey();
      setKeyInfo(nextKeyInfo);
      if (nextKeyInfo.source === 'none') {
        setShowKeyInput(true);
      }
    };
    window.addEventListener(AI_USAGE_UPDATED_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(AI_USAGE_UPDATED_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const handleSaveSessionKey = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draftKey.trim()) return;
    setSessionGeminiApiKey(draftKey.trim());
    setDraftKey('');
    setShowKeyInput(false);
  };

  const handleClearSessionKey = () => {
    setSessionGeminiApiKey('');
    setDraftKey('');
  };

  const barColor = isBlocked ? '#ef4444' : isWarning ? '#f59e0b' : '#10b981';

  return (
    <div
      style={{
        padding: compact ? '0.65rem 0.85rem' : '0.8rem 1rem',
        borderRadius: '8px',
        backgroundColor: isBlocked ? 'rgba(239, 68, 68, 0.08)' : 'rgba(15, 23, 42, 0.04)',
        border: `1px solid ${isBlocked ? 'rgba(239, 68, 68, 0.4)' : 'var(--border-color, #e2e8f0)'}`,
        marginBottom: compact ? '0' : '1rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        fontSize: '0.78rem',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.5rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 700 }}>
          {isBlocked ? (
            <AlertOctagon size={15} style={{ color: '#ef4444' }} />
          ) : (
            <ShieldCheck size={15} style={{ color: '#10b981' }} />
          )}
          <span>
            今月 ({usage.yearMonth}) AI推定利用額:{' '}
            <strong style={{ color: barColor }}>${usage.estimatedCostUsd.toFixed(4)}</strong> / 安全上限{' '}
            <strong>${limitUsd.toFixed(2)}</strong>（特典$10枠保護・{usage.requestCount}回）
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
          <span
            style={{
              padding: '0.12rem 0.5rem',
              borderRadius: '999px',
              fontWeight: 600,
              fontSize: '0.72rem',
              backgroundColor:
                keyInfo.source === 'session'
                  ? 'rgba(16, 185, 129, 0.14)'
                  : keyInfo.source === 'env'
                    ? 'rgba(59, 130, 246, 0.12)'
                    : 'rgba(245, 158, 11, 0.15)',
              color:
                keyInfo.source === 'session'
                  ? '#059669'
                  : keyInfo.source === 'env'
                    ? '#2563eb'
                    : '#d97706',
            }}
          >
            {keyInfo.source === 'session'
              ? '一時セッションキー使用中（タブ閉じで消去）'
              : keyInfo.source === 'env'
                ? 'ローカル環境キー (.env) 接続'
                : 'APIキー未設定（公開ビルド保護状態）'}
          </span>

          {keyInfo.source === 'session' && (
            <button
              type="button"
              onClick={handleClearSessionKey}
              title="一時APIキーを削除"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.2rem',
                padding: '0.15rem 0.45rem',
                borderRadius: '6px',
                border: '1px solid rgba(239, 68, 68, 0.35)',
                background: 'transparent',
                color: '#ef4444',
                cursor: 'pointer',
                fontSize: '0.72rem',
                fontWeight: 600,
              }}
            >
              <Trash2 size={11} />
              削除
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowKeyInput(v => !v)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.25rem',
              padding: '0.18rem 0.5rem',
              borderRadius: '6px',
              border: '1px solid var(--border-color, #cbd5e1)',
              backgroundColor: 'var(--bg-primary, #fff)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              fontSize: '0.72rem',
              fontWeight: 600,
            }}
          >
            <KeyRound size={12} />
            {showKeyInput ? 'キー入力を閉じる' : '一時APIキー設定'}
          </button>
        </div>
      </div>

      {/* 予算ゲージ */}
      <div
        style={{
          width: '100%',
          height: '6px',
          borderRadius: '999px',
          backgroundColor: 'rgba(100, 116, 139, 0.18)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${ratio}%`,
            height: '100%',
            backgroundColor: barColor,
            transition: 'width 0.25s ease',
          }}
        />
      </div>

      {isBlocked && (
        <div style={{ color: '#dc2626', fontWeight: 600 }}>
          安全上限（${limitUsd.toFixed(2)}）に到達したため、ブラウザからの追加AIリクエストを自動停止しています。
        </div>
      )}

      {showKeyInput && (
        <form
          onSubmit={handleSaveSessionKey}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.45rem',
            flexWrap: 'wrap',
            paddingTop: '0.25rem',
          }}
        >
          <input
            type="password"
            value={draftKey}
            onChange={e => setDraftKey(e.target.value)}
            placeholder="管理者用 Gemini APIキー (このタブのみ一時保持 / sessionStorage)"
            autoComplete="off"
            style={{
              flex: '1 1 260px',
              padding: '0.35rem 0.6rem',
              borderRadius: '6px',
              border: '1px solid var(--border-color, #cbd5e1)',
              backgroundColor: 'var(--bg-primary, #fff)',
              color: 'var(--text-primary)',
              fontSize: '0.78rem',
            }}
          />
          <button
            type="submit"
            disabled={!draftKey.trim()}
            style={{
              padding: '0.36rem 0.75rem',
              borderRadius: '6px',
              border: 'none',
              backgroundColor: draftKey.trim() ? '#2563eb' : '#94a3b8',
              color: '#fff',
              fontWeight: 700,
              fontSize: '0.76rem',
              cursor: draftKey.trim() ? 'pointer' : 'not-allowed',
            }}
          >
            一時セット
          </button>
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.7rem' }}>
            ※ ビルドにキーを埋め込まず公開する場合に安全です
          </span>
        </form>
      )}
    </div>
  );
};
