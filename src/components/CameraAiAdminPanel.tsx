import React from 'react';
import { Calendar, Download, Trash2, Cloud, HardDrive } from 'lucide-react';
import { CAMERA_MODELS } from '../utils/cameraAiClient';

interface CameraAiAdminPanelProps {
  availableDates: string[];
  rangeStart: string;
  rangeEnd: string;
  overwriteExisting: boolean;
  selectedModel: string;
  isAnalyzing: boolean;
  isSyncingCloud: boolean;
  hasAnyResults: boolean;
  storageStats: {
    totalPhotos: number;
    estMB: number;
    limitMB: number;
    ratio: number;
  };
  onRangeStartChange: (val: string) => void;
  onRangeEndChange: (val: string) => void;
  onOverwriteChange: (val: boolean) => void;
  onModelChange: (val: string) => void;
  onRunCustomRange: () => void;
  onExportJson: () => void;
  onClearAll: () => void;
}

export const CameraAiAdminPanel: React.FC<CameraAiAdminPanelProps> = ({
  availableDates,
  rangeStart,
  rangeEnd,
  overwriteExisting,
  selectedModel,
  isAnalyzing,
  isSyncingCloud,
  hasAnyResults,
  storageStats,
  onRangeStartChange,
  onRangeEndChange,
  onOverwriteChange,
  onModelChange,
  onRunCustomRange,
  onExportJson,
  onClearAll,
}) => {
  return (
    <div
      style={{
        padding: '1rem 1.25rem',
        backgroundColor: 'var(--bg-secondary)',
        borderRadius: '10px',
        border: '1px solid var(--border-color)',
        marginBottom: '1.25rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.9rem',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', fontWeight: 700, fontSize: '0.88rem' }}>
          <Calendar size={16} style={{ color: '#3b82f6' }} />
          <span>【管理者専用】任意期間の再解析・メンテナンス</span>
          <span
            style={{
              fontSize: '0.72rem',
              fontWeight: 600,
              padding: '0.15rem 0.5rem',
              borderRadius: '999px',
              backgroundColor: 'rgba(59, 130, 246, 0.1)',
              color: '#2563eb',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.25rem',
            }}
          >
            <Cloud size={12} />
            {isSyncingCloud ? 'クラウド保存中...' : '月別分割Firestore ON'}
          </span>
          <span
            style={{
              fontSize: '0.72rem',
              fontWeight: 600,
              padding: '0.15rem 0.5rem',
              borderRadius: '999px',
              backgroundColor: storageStats.ratio >= 80 ? 'rgba(245, 158, 11, 0.15)' : 'rgba(100, 116, 139, 0.12)',
              color: storageStats.ratio >= 80 ? '#d97706' : 'var(--text-secondary)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.25rem',
            }}
          >
            <HardDrive size={12} />
            画像アーカイブ: 約{storageStats.estMB}MB / {storageStats.limitMB}MB ({storageStats.ratio}%)
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem' }}>
          <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>使用AIモデル:</span>
          <select
            value={selectedModel}
            onChange={e => onModelChange(e.target.value)}
            disabled={isAnalyzing}
            style={{
              padding: '0.3rem 0.55rem',
              borderRadius: '6px',
              border: '1px solid var(--border-color)',
              backgroundColor: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              fontWeight: 600,
              fontSize: '0.8rem',
            }}
          >
            {CAMERA_MODELS.map(m => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', fontSize: '0.82rem' }}>
          <label style={{ fontWeight: 600 }}>期間指定:</label>
          <select
            value={rangeStart}
            onChange={e => onRangeStartChange(e.target.value)}
            disabled={isAnalyzing}
            style={{
              padding: '0.35rem 0.55rem',
              borderRadius: '6px',
              border: '1px solid var(--border-color)',
              backgroundColor: 'var(--bg-primary)',
              color: 'var(--text-primary)',
            }}
          >
            {availableDates.map(d => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <span>〜</span>
          <select
            value={rangeEnd}
            onChange={e => onRangeEndChange(e.target.value)}
            disabled={isAnalyzing}
            style={{
              padding: '0.35rem 0.55rem',
              borderRadius: '6px',
              border: '1px solid var(--border-color)',
              backgroundColor: 'var(--bg-primary)',
              color: 'var(--text-primary)',
            }}
          >
            {availableDates.map(d => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>

          <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer', marginLeft: '0.25rem' }}>
            <input
              type="checkbox"
              checked={overwriteExisting}
              onChange={e => onOverwriteChange(e.target.checked)}
              disabled={isAnalyzing}
            />
            <span>解析済みの日も上書き再解析する</span>
          </label>

          <button
            onClick={onRunCustomRange}
            disabled={isAnalyzing}
            style={{
              padding: '0.4rem 0.85rem',
              borderRadius: '6px',
              border: '1px solid #3b82f6',
              backgroundColor: 'rgba(59, 130, 246, 0.12)',
              color: '#2563eb',
              fontWeight: 700,
              fontSize: '0.8rem',
              cursor: isAnalyzing ? 'not-allowed' : 'pointer',
            }}
          >
            指定期間を実行
          </button>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            onClick={onExportJson}
            disabled={isAnalyzing || !hasAnyResults}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              padding: '0.4rem 0.75rem',
              borderRadius: '6px',
              border: '1px solid #10b981',
              backgroundColor: 'rgba(16, 185, 129, 0.08)',
              color: '#059669',
              fontWeight: 600,
              fontSize: '0.78rem',
              cursor: isAnalyzing ? 'not-allowed' : 'pointer',
            }}
          >
            <Download size={14} />
            <span>JSONバックアップ出力</span>
          </button>

          <button
            onClick={onClearAll}
            disabled={isAnalyzing}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              padding: '0.4rem 0.75rem',
              borderRadius: '6px',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              backgroundColor: 'transparent',
              color: '#ef4444',
              fontWeight: 600,
              fontSize: '0.78rem',
              cursor: isAnalyzing ? 'not-allowed' : 'pointer',
            }}
          >
            <Trash2 size={14} />
            <span>全解析データ初期化</span>
          </button>
        </div>
      </div>
    </div>
  );
};
