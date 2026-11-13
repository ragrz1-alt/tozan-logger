import { Wrench, Snowflake, AlertTriangle } from 'lucide-react';
import type { InactiveCameraInfo } from '../utils/cameraStatus';

interface InactiveCamerasNoticeProps<T extends { id: string; name: string }> {
  items: InactiveCameraInfo<T>[];
  compact?: boolean;
}

export function InactiveCamerasNotice<T extends { id: string; name: string }>({
  items,
  compact = false,
}: InactiveCamerasNoticeProps<T>) {
  if (!items || items.length === 0) return null;

  return (
    <div
      style={{
        marginTop: compact ? '0.75rem' : '1.25rem',
        padding: compact ? '0.65rem 0.9rem' : '0.85rem 1.1rem',
        borderRadius: 'var(--radius-md)',
        backgroundColor: 'rgba(100, 116, 139, 0.08)',
        border: '1px solid rgba(100, 116, 139, 0.22)',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.45rem',
      }}
    >
      <div
        style={{
          fontSize: '0.8rem',
          fontWeight: 700,
          color: 'var(--text-secondary)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem',
        }}
      >
        <span>⏸️ 休止中・調整中のカメラ（{items.length}地点）</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
        {items.map(item => {
          const isClosed = item.status === 'seasonal_closed';
          const isMonitoring = item.status === 'monitoring' || item.status === 'blackout';
          const color = isClosed ? '#64748b' : isMonitoring ? '#d97706' : '#dc2626';
          const bg = isClosed
            ? 'rgba(100, 116, 139, 0.12)'
            : isMonitoring
            ? 'rgba(245, 158, 11, 0.12)'
            : 'rgba(239, 68, 68, 0.12)';
          const Icon = isClosed ? Snowflake : isMonitoring ? Wrench : AlertTriangle;

          return (
            <div
              key={item.camera.id}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '0.4rem',
                padding: '0.35rem 0.7rem',
                borderRadius: '8px',
                backgroundColor: bg,
                border: `1px solid ${color}33`,
                fontSize: '0.78rem',
                color: 'var(--text-primary)',
              }}
              title={item.reasonText}
            >
              <Icon size={14} color={color} />
              <strong>{item.camera.name}</strong>
              <span style={{ color, fontWeight: 700 }}>{item.badgeText}</span>
              <span style={{ color: 'var(--text-secondary)' }}>— {item.reasonText}</span>
              {item.lastValidAt && (
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.72rem' }}>
                  （最終取得: {item.lastValidAt}）
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
