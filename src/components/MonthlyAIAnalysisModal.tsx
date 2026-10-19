import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, Sparkles, Loader2, CheckCircle2, RotateCcw, AlertTriangle, TrendingUp, Sun, Target } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import {
  generateMonthlyAnalysis,
  buildPeriodFactSheet,
  getCachedAIReport,
  type AIAnalysisRequest,
} from '../utils/aiAnalytics';

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
  const [useWebSearch, setUseWebSearch] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [metaInfo, setMetaInfo] = useState<{ createdAt: string; modelUsed: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 事前集計ファクトシート（APIを呼ばずに0.01秒で算出）
  const factSheet = useMemo(() => {
    if (!isOpen) return null;
    return buildPeriodFactSheet({ ...analysisData, notes });
  }, [isOpen, analysisData, notes]);

  // モーダルを開いたときに保存済みキャッシュがあれば即座に復元（API枠節約）
  useEffect(() => {
    if (isOpen) {
      const cached = getCachedAIReport(
        analysisData.year,
        analysisData.month,
        analysisData.selectedCourse || 'all'
      );
      if (cached) {
        setResult(cached.report);
        setNotes(cached.notes || '');
        setMetaInfo({ createdAt: cached.createdAt, modelUsed: cached.modelUsed });
      } else {
        setResult(null);
        setMetaInfo(null);
      }
      setError(null);
    }
  }, [isOpen, analysisData.year, analysisData.month, analysisData.selectedCourse]);

  if (!isOpen || !factSheet) return null;

  const handleAnalyze = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const res = await generateMonthlyAnalysis({
        ...analysisData,
        notes,
        useWebSearch,
      });
      setResult(res.report);
      setMetaInfo({
        createdAt: new Date().toLocaleString('ja-JP'),
        modelUsed: res.modelUsed,
      });
    } catch (err: any) {
      setError(err.message || '予期せぬエラーが発生しました。');
    } finally {
      setIsLoading(false);
    }
  };

  const isConfigured = !!import.meta.env.VITE_GEMINI_API_KEY;
  const titleLabel =
    analysisData.month !== null
      ? `${analysisData.year}年${analysisData.month}月 AI総合解析レポート`
      : `${analysisData.year}年 シーズン通期(6〜9月) AI総合解析レポート`;

  return createPortal(
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '1rem',
      }}
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          backgroundColor: 'var(--bg-primary, #ffffff)',
          color: 'var(--text-primary, #1f2937)',
          borderRadius: '16px',
          width: '100%',
          maxWidth: '880px',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)',
          border: '1px solid var(--border-color, #e5e7eb)',
        }}
      >
        {/* ヘッダー */}
        <div
          style={{
            padding: '1.25rem 1.5rem',
            borderBottom: '1px solid var(--border-color, #e5e7eb)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: 'var(--bg-secondary, #f8fafc)',
            borderTopLeftRadius: '16px',
            borderTopRightRadius: '16px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div
              style={{
                width: '42px',
                height: '42px',
                borderRadius: '10px',
                background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
              }}
            >
              <Sparkles size={22} />
            </div>
            <div>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#3b82f6' }}>
                4大ピラー統合分析（動態事実・安全リスク・気象雲量・次年度誘客戦略）
              </div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0 }}>
                {titleLabel} （{factSheet.courseName}）
              </h2>
            </div>
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
              justifyContent: 'center',
            }}
          >
            <X size={24} />
          </button>
        </div>

        {/* コンテンツ本体 */}
        <div
          style={{
            padding: '1.5rem',
            overflowY: 'auto',
            flex: 1,
          }}
        >
          {!isConfigured && (
            <div
              style={{
                padding: '1rem',
                backgroundColor: '#fee2e2',
                border: '1px solid #f87171',
                borderRadius: '8px',
                color: '#991b1b',
                marginBottom: '1.25rem',
              }}
            >
              <p style={{ margin: 0, fontWeight: 'bold' }}>⚠️ APIキーが設定されていません</p>
              <p style={{ margin: '0.4rem 0 0 0', fontSize: '0.88rem' }}>
                .env ファイルに <code>VITE_GEMINI_API_KEY</code> を設定してください。
              </p>
            </div>
          )}

          {/* 事前集計された4大ピラー数値サマリー（AIへ渡される確定ファクト） */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
              gap: '0.75rem',
              marginBottom: '1.25rem',
            }}
          >
            <div
              style={{
                padding: '0.85rem',
                borderRadius: '10px',
                backgroundColor: 'rgba(59, 130, 246, 0.08)',
                border: '1px solid rgba(59, 130, 246, 0.25)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.78rem', fontWeight: 700, color: '#3b82f6' }}>
                <TrendingUp size={14} /> ① 動態・滞在時間
              </div>
              <div style={{ fontSize: '1.15rem', fontWeight: 800, marginTop: '0.25rem' }}>
                計 {factSheet.totalEnter.toLocaleString()}人
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                休日平均 {factSheet.holidayAvgEnter}人 / 平日 {factSheet.weekdayAvgEnter}人<br />
                平均滞在: {factSheet.avgDurationStr}
              </div>
            </div>

            <div
              style={{
                padding: '0.85rem',
                borderRadius: '10px',
                backgroundColor: 'rgba(239, 68, 68, 0.08)',
                border: '1px solid rgba(239, 68, 68, 0.25)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.78rem', fontWeight: 700, color: '#ef4444' }}>
                <AlertTriangle size={14} /> ② 遅発・遅延リスク
              </div>
              <div style={{ fontSize: '1.15rem', fontWeight: 800, marginTop: '0.25rem', color: '#ef4444' }}>
                17時以降下山: {factSheet.lateExitTotal}人
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                遅発入山(10:30-): {factSheet.lateEnterTotal}人 ({factSheet.lateEnterRatio}%)<br />
                日没後下山: {factSheet.afterSunsetExitTotal}人 / 深夜入山: {factSheet.midnightEnterTotal}人
              </div>
            </div>

            <div
              style={{
                padding: '0.85rem',
                borderRadius: '10px',
                backgroundColor: 'rgba(245, 158, 11, 0.08)',
                border: '1px solid rgba(245, 158, 11, 0.25)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.78rem', fontWeight: 700, color: '#d97706' }}>
                <Sun size={14} /> ③ 気象 × 山頂視界
              </div>
              <div style={{ fontSize: '1.15rem', fontWeight: 800, marginTop: '0.25rem' }}>
                登山日和: {factSheet.goodWeatherDaysCount}日
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                麓晴天率 {factSheet.baseSunnyRate}% ({factSheet.baseSunnyDays}/{factSheet.daysCount}日)<br />
                カメラ山頂快晴: {factSheet.summitClearDays}日 / ガス: {factSheet.summitFoggyDays}日
              </div>
            </div>

            <div
              style={{
                padding: '0.85rem',
                borderRadius: '10px',
                backgroundColor: 'rgba(16, 185, 129, 0.08)',
                border: '1px solid rgba(16, 185, 129, 0.25)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.78rem', fontWeight: 700, color: '#059669' }}>
                <Target size={14} /> ④ 誘客チャンス喪失
              </div>
              <div style={{ fontSize: '1.15rem', fontWeight: 800, marginTop: '0.25rem', color: '#059669' }}>
                好天×少人数: {factSheet.opportunityLossDays.length}日
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                誘客狙い目週: <strong>{factSheet.bestPromoWeek || '自動算出'}</strong><br />
                リスク警戒週: <strong>{factSheet.highestRiskWeek || 'なし'}</strong>
              </div>
            </div>
          </div>

          {!result && (
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', fontSize: '0.92rem', fontWeight: 700, marginBottom: '0.4rem' }}>
                管理者メモ・ローカル特記事項（任意）
              </label>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary, #6b7280)', marginBottom: '0.5rem' }}>
                フェリー欠航、山岳イベント、学校登山、登山道補修などがあれば記入してください（空欄のままでも上記の確定ファクトシートから高精度に解析します）。
              </p>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="例: 15日はフェリー午前便欠航、20日は高校の団体登山40名あり など..."
                disabled={isLoading}
                style={{
                  width: '100%',
                  height: '85px',
                  padding: '0.75rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color, #d1d5db)',
                  backgroundColor: 'var(--bg-secondary, #f9fafb)',
                  color: 'inherit',
                  fontFamily: 'inherit',
                  resize: 'vertical',
                }}
              />

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginTop: '0.75rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={useWebSearch}
                    onChange={e => setUseWebSearch(e.target.checked)}
                    disabled={isLoading}
                  />
                  <span>🌐 Google検索グラウンディングも併用する（※通常はOFFの方が高速かつAPI制限を節約できます）</span>
                </label>
              </div>

              <button
                onClick={handleAnalyze}
                disabled={isLoading || !isConfigured}
                style={{
                  marginTop: '1rem',
                  width: '100%',
                  padding: '0.9rem',
                  background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '10px',
                  fontSize: '1rem',
                  fontWeight: 700,
                  cursor: isLoading || !isConfigured ? 'not-allowed' : 'pointer',
                  opacity: isLoading || !isConfigured ? 0.7 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  boxShadow: '0 4px 12px rgba(59, 130, 246, 0.3)',
                }}
              >
                {isLoading ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    4大解析ピラー（動態・リスク・気象雲量・次年度戦略）をAI推論中...
                  </>
                ) : (
                  <>
                    <Sparkles size={18} />
                    AI総合解析レポートを生成する
                  </>
                )}
              </button>
            </div>
          )}

          {error && (
            <div
              style={{
                padding: '1rem',
                backgroundColor: '#fee2e2',
                color: '#dc2626',
                borderRadius: '8px',
                border: '1px solid #f87171',
                marginBottom: '1rem',
              }}
            >
              {error}
            </div>
          )}

          {result && (
            <div
              style={{
                backgroundColor: 'var(--bg-secondary, #f8fafc)',
                padding: '1.5rem',
                borderRadius: '12px',
                border: '1px solid var(--border-color, #e2e8f0)',
                lineHeight: 1.65,
              }}
            >
              {metaInfo && (
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '0.5rem',
                    paddingBottom: '0.85rem',
                    marginBottom: '1rem',
                    borderBottom: '1px solid var(--border-color, #e2e8f0)',
                    fontSize: '0.8rem',
                    color: 'var(--text-secondary)',
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#10b981', fontWeight: 700 }}>
                    <CheckCircle2 size={15} />
                    キャッシュ保存済レポート（次回表示時はAPI枠を消費しません）
                  </span>
                  <span>
                    生成日時: {metaInfo.createdAt} | モデル: <code>{metaInfo.modelUsed}</code>
                  </span>
                </div>
              )}

              <style
                dangerouslySetInnerHTML={{
                  __html: `
                .markdown-body h1, .markdown-body h2, .markdown-body h3 {
                  margin-top: 1.4em;
                  margin-bottom: 0.5em;
                  font-weight: 800;
                  color: var(--text-primary, #1e293b);
                }
                .markdown-body h1 { font-size: 1.4rem; border-bottom: 2px solid var(--border-color, #e2e8f0); padding-bottom: 0.3em; }
                .markdown-body h2 { font-size: 1.2rem; border-left: 4px solid #3b82f6; padding-left: 0.6rem; }
                .markdown-body h3 { font-size: 1.05rem; }
                .markdown-body p { margin-top: 0; margin-bottom: 0.9em; color: var(--text-primary, #334155); }
                .markdown-body ul { margin-top: 0; margin-bottom: 1em; padding-left: 1.5em; }
                .markdown-body li { margin-bottom: 0.35em; color: var(--text-primary, #334155); }
                .markdown-body strong { color: #2563eb; }
                .markdown-body blockquote {
                  margin: 0.8em 0;
                  padding: 0.6em 1em;
                  border-left: 4px solid #10b981;
                  background: rgba(16, 185, 129, 0.08);
                  border-radius: 6px;
                }
              `,
                }}
              />
              <div className="markdown-body">
                <ReactMarkdown>{result}</ReactMarkdown>
              </div>
              <div style={{ marginTop: '1.75rem', display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button
                  onClick={() => setResult(null)}
                  style={{
                    padding: '0.55rem 1.1rem',
                    backgroundColor: 'var(--bg-primary)',
                    border: '1px solid var(--border-color, #cbd5e1)',
                    borderRadius: '8px',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    fontSize: '0.88rem',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                  }}
                >
                  <RotateCcw size={15} />
                  <span>メモ・条件を変えて再解析する</span>
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
