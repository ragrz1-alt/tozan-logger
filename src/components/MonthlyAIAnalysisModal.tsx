import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Sparkles, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { generateMonthlyAnalysis, type AIAnalysisRequest } from '../utils/aiAnalytics';

interface MonthlyAIAnalysisModalProps {
  isOpen: boolean;
  onClose: () => void;
  analysisData: Omit<AIAnalysisRequest, 'notes'>;
}

export const MonthlyAIAnalysisModal: React.FC<MonthlyAIAnalysisModalProps> = ({
  isOpen,
  onClose,
  analysisData,
}) => {
  const [notes, setNotes] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleAnalyze = async () => {
    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      const report = await generateMonthlyAnalysis({
        ...analysisData,
        notes
      });
      setResult(report);
    } catch (err: any) {
      setError(err.message || '予期せぬエラーが発生しました。');
    } finally {
      setIsLoading(false);
    }
  };

  const isConfigured = !!import.meta.env.VITE_GEMINI_API_KEY;

  return createPortal(
    <div style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: '1rem'
    }}>
      <div style={{
        backgroundColor: 'var(--bg-primary, #ffffff)',
        color: 'var(--text-primary, #1f2937)',
        borderRadius: '16px',
        width: '100%',
        maxWidth: '700px',
        maxHeight: '90vh',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)'
      }}>
        <div style={{
          padding: '1.5rem',
          borderBottom: '1px solid var(--border-color, #e5e7eb)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: '#f8fafc',
          borderTopLeftRadius: '16px',
          borderTopRightRadius: '16px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{
              width: '40px',
              height: '40px',
              borderRadius: '10px',
              background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white'
            }}>
              <Sparkles size={20} />
            </div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>
              {analysisData.year}年{analysisData.month}月 AI解析レポート
            </h2>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-secondary, #6b7280)',
              padding: '0.5rem',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <X size={24} />
          </button>
        </div>

        <div style={{
          padding: '1.5rem',
          overflowY: 'auto',
          flex: 1
        }}>
          {!isConfigured && (
            <div style={{
              padding: '1rem',
              backgroundColor: '#fee2e2',
              border: '1px solid #f87171',
              borderRadius: '8px',
              color: '#991b1b',
              marginBottom: '1.5rem'
            }}>
              <p style={{ margin: 0, fontWeight: 'bold' }}>⚠️ APIキーが設定されていません</p>
              <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.9rem' }}>
                .env ファイルに <code>VITE_GEMINI_API_KEY</code> を設定してください。
              </p>
            </div>
          )}

          {!result && (
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                管理者メモ・特記事項（任意）
              </label>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary, #6b7280)', marginBottom: '0.5rem' }}>
                システムが自動取得できない局所的な出来事があれば入力してください。空欄でも解析は可能です。<br/>
                （例: 15日午後からフェリー欠航、20日に高校の団体登山あり など）
              </p>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="特記事項を入力..."
                disabled={isLoading}
                style={{
                  width: '100%',
                  height: '100px',
                  padding: '0.75rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color, #d1d5db)',
                  backgroundColor: 'var(--bg-secondary, #f9fafb)',
                  color: 'inherit',
                  fontFamily: 'inherit',
                  resize: 'vertical'
                }}
              />
              <button
                onClick={handleAnalyze}
                disabled={isLoading || !isConfigured}
                style={{
                  marginTop: '1rem',
                  width: '100%',
                  padding: '0.875rem',
                  backgroundColor: '#3b82f6',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '1rem',
                  fontWeight: 600,
                  cursor: (isLoading || !isConfigured) ? 'not-allowed' : 'pointer',
                  opacity: (isLoading || !isConfigured) ? 0.7 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  transition: 'background-color 0.2s'
                }}
              >
                {isLoading ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    解析中（約10〜20秒かかります）...
                  </>
                ) : (
                  <>
                    <Sparkles size={18} />
                    解析を実行する
                  </>
                )}
              </button>
            </div>
          )}

          {error && (
            <div style={{
              padding: '1rem',
              backgroundColor: '#fee2e2',
              color: '#dc2626',
              borderRadius: '8px',
              border: '1px solid #f87171',
              marginBottom: '1rem'
            }}>
              {error}
            </div>
          )}

          {result && (
            <div style={{
              backgroundColor: '#f8fafc',
              padding: '1.5rem',
              borderRadius: '12px',
              border: '1px solid #e2e8f0',
              lineHeight: 1.6
            }}>
              <style dangerouslySetInnerHTML={{__html: `
                .markdown-body h1, .markdown-body h2, .markdown-body h3 {
                  margin-top: 1.5em;
                  margin-bottom: 0.5em;
                  font-weight: 700;
                  color: #1e293b;
                }
                .markdown-body h1 { font-size: 1.5rem; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.3em; }
                .markdown-body h2 { font-size: 1.25rem; }
                .markdown-body h3 { font-size: 1.1rem; }
                .markdown-body p { margin-top: 0; margin-bottom: 1em; color: #334155; }
                .markdown-body ul { margin-top: 0; margin-bottom: 1em; padding-left: 1.5em; }
                .markdown-body li { margin-bottom: 0.25em; color: #334155; }
                .markdown-body strong { color: #0f172a; }
              `}} />
              <div className="markdown-body">
                <ReactMarkdown>{result}</ReactMarkdown>
              </div>
              <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setResult(null)}
                  style={{
                    padding: '0.5rem 1rem',
                    backgroundColor: 'transparent',
                    border: '1px solid #cbd5e1',
                    borderRadius: '6px',
                    color: '#475569',
                    cursor: 'pointer',
                    fontSize: '0.9rem',
                    fontWeight: 500
                  }}
                >
                  条件を変えて再解析
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
