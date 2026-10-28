import React, { useState, useEffect, useMemo } from 'react';
import { Calendar as CalendarIcon, Video, RefreshCw, Eye, Sun } from 'lucide-react';
import { LiveCamViewer, ALL_ARCHIVE_CAMERAS } from './LiveCamViewer';
import { fetchHourlyWeatherData, type HourlyWeatherData } from '../utils/weatherApi';
import { getHistoryJsonUrl, getCamImageUrl } from '../utils/camUrl';

interface CamHistory {
  updatedAt: string;
  cameras: Record<string, { name: string; videoId: string; url: string }>;
  records: Record<string, Record<string, Record<string, string>>>;
}

export const LiveCamArchivePage: React.FC = () => {
  const [history, setHistory] = useState<CamHistory | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [hourlyWeather, setHourlyWeather] = useState<Record<string, HourlyWeatherData>>({});
  const [activeViewMode, setActiveViewMode] = useState<'compare' | 'gallery'>('compare');

  // Load /cams/history.json（GitHub Pages CDNから最新即時取得、失敗時はローカルフォールバック）
  const loadHistory = async () => {
    try {
      let res = await fetch(getHistoryJsonUrl());
      if (!res.ok) {
        res = await fetch('/cams/history.json?t=' + Date.now());
      }
      if (res.ok) {
        const data: CamHistory = await res.json();
        setHistory(data);

        // 利用可能な日付の最新日を自動選択（なければ今日）
        const availableDates = data.records ? Object.keys(data.records).sort().reverse() : [];
        if (availableDates.length > 0 && !selectedDate) {
          setSelectedDate(availableDates[0]);
        } else if (!selectedDate) {
          const today = new Date().toISOString().split('T')[0];
          setSelectedDate(today);
        }
      } else {
        const today = new Date().toISOString().split('T')[0];
        if (!selectedDate) setSelectedDate(today);
      }
    } catch (err) {
      console.warn('history.json のロードに失敗しました:', err);
      const today = new Date().toISOString().split('T')[0];
      if (!selectedDate) setSelectedDate(today);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  // 日付選択時の気象情報ロード
  useEffect(() => {
    if (selectedDate) {
      fetchHourlyWeatherData(0, 0, selectedDate)
        .then(data => setHourlyWeather(data))
        .catch(() => setHourlyWeather({}));
    }
  }, [selectedDate]);

  const availableDates = history?.records ? Object.keys(history.records).sort().reverse() : [];
  const selectedDateRecords = (history?.records && selectedDate && history.records[selectedDate]) || {};
  const recordedHours = Object.keys(selectedDateRecords)
    .filter(hr => Object.keys(selectedDateRecords[hr] || {}).some(k => k !== 'timestamp'))
    .sort();

  // 選択日に有効なカメラ一覧（6地点対応・過去3地点日の自動判別）
  const activeCamerasForDate = useMemo(() => {
    const recordedCamIds = new Set<string>();
    Object.values(selectedDateRecords).forEach(hrObj => {
      if (hrObj && typeof hrObj === 'object') {
        Object.keys(hrObj).forEach(k => {
          if (k !== 'timestamp') recordedCamIds.add(k);
        });
      }
    });
    const isSixCam =
      selectedDate >= '2026-10-28' ||
      recordedCamIds.has('ferry') ||
      recordedCamIds.has('himenuma') ||
      recordedCamIds.has('otadomari');
    return isSixCam
      ? ALL_ARCHIVE_CAMERAS
      : ALL_ARCHIVE_CAMERAS.filter(c => c.isCore || recordedCamIds.has(c.id));
  }, [selectedDate, selectedDateRecords]);

  // 年月ごとにグループ化（数年分溜まった時のためのセレクトボックス用）
  const groupedDates = useMemo(() => {
    const groups: Record<string, string[]> = {};
    availableDates.forEach(dStr => {
      const [year, month] = dStr.split('-');
      const key = `${year}年 ${parseInt(month, 10)}月`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(dStr);
    });
    return groups;
  }, [availableDates]);

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '0 0.5rem' }}>
      {/* 1. ページヘッダー ＆ アーカイブ選択パネル */}
      <div className="card" style={{ marginBottom: '1.5rem', borderLeft: '4px solid #10b981' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginBottom: '1.25rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <div style={{ backgroundColor: '#10b981', color: '#fff', padding: '0.45rem', borderRadius: '0.5rem', display: 'flex' }}>
                <Video size={22} />
              </div>
              <h2 style={{ fontSize: '1.45rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                利尻山 ライブカメラ状況アーカイブ
              </h2>
              <span style={{
                fontSize: '0.76rem',
                fontWeight: 700,
                padding: '0.2rem 0.65rem',
                borderRadius: '999px',
                backgroundColor: 'rgba(16, 185, 129, 0.14)',
                color: '#059669'
              }}>
                🌅 季節別日照スケジュール稼働 (最大6地点: 5-7月 3〜21時 / 8月 4〜20時 / 春秋 4〜18時 / 冬期 6〜17時)
              </span>
            </div>
            <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              自動定時スクリーンショット記録（本泊・鴛泊港・姫沼・沓形・オタドマリ沼・仙法志）および気象要因との統合検証ページ
            </p>
          </div>

          <button
            onClick={loadHistory}
            className="button button-secondary"
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.55rem 1rem', fontSize: '0.85rem', fontWeight: 600 }}
            title="クラウドの最新撮影アーカイブを再読み込み"
          >
            <RefreshCw size={15} />
            <span>最新データを更新</span>
          </button>
        </div>

        {/* 2. 記録済み日付のセレクター（クイック選択 ＋ 全アーカイブセレクトボックス） */}
        <div style={{ backgroundColor: 'var(--bg-primary)', padding: '1rem 1.25rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', marginBottom: '0.85rem' }}>
            <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <CalendarIcon size={16} /> 記録が存在する日付を選んで状況を確認:
            </span>

            {/* 数年分溜まった時のための「記録済み全日程一覧」セレクトボックス */}
            {availableDates.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <label htmlFor="archive-date-select" style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  過去アーカイブ検索:
                </label>
                <select
                  id="archive-date-select"
                  value={selectedDate}
                  onChange={e => setSelectedDate(e.target.value)}
                  style={{
                    padding: '0.4rem 0.8rem',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-secondary)',
                    color: 'var(--text-primary)',
                    fontWeight: 600,
                    fontSize: '0.85rem',
                    cursor: 'pointer'
                  }}
                >
                  {Object.entries(groupedDates).map(([groupLabel, dates]) => (
                    <optgroup key={groupLabel} label={groupLabel}>
                      {dates.map(dStr => {
                        const hourCount = Object.keys(history?.records?.[dStr] || {}).length;
                        return (
                          <option key={dStr} value={dStr}>
                            {dStr} ({hourCount}時間分)
                          </option>
                        );
                      })}
                    </optgroup>
                  ))}
                </select>
              </div>
            )}
          </div>

          {availableDates.length > 0 ? (
            <div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                直近の撮影日クイック選択:
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {availableDates.slice(0, 14).map(dStr => {
                  const hourCount = Object.keys(history?.records?.[dStr] || {}).length;
                  const isSelected = selectedDate === dStr;
                  return (
                    <button
                      key={dStr}
                      onClick={() => setSelectedDate(dStr)}
                      style={{
                        padding: '0.45rem 0.9rem',
                        borderRadius: '9999px',
                        border: `1px solid ${isSelected ? '#10b981' : 'var(--border-color)'}`,
                        backgroundColor: isSelected ? '#10b981' : 'var(--bg-secondary)',
                        color: isSelected ? '#fff' : 'var(--text-primary)',
                        fontWeight: isSelected ? 700 : 600,
                        fontSize: '0.85rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        boxShadow: isSelected ? '0 2px 6px rgba(16, 185, 129, 0.35)' : 'none',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <span>{dStr}</span>
                      <span
                        style={{
                          backgroundColor: isSelected ? 'rgba(255,255,255,0.25)' : 'rgba(16,185,129,0.12)',
                          color: isSelected ? '#fff' : '#10b981',
                          fontSize: '0.75rem',
                          padding: '0.1rem 0.45rem',
                          borderRadius: '9999px',
                          fontWeight: 700
                        }}
                      >
                        {hourCount}時間分
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              アーカイブ履歴がまだ登録されていません（毎時0分の自動撮影完了後、日付カードが表示されます）。現在選択中の日付: <strong>{selectedDate}</strong>
            </p>
          )}
        </div>
      </div>

      {/* 3. 表示モード切替タグ (コンディション比較 / 1日ギャラリー一覧) */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          <button
            onClick={() => setActiveViewMode('compare')}
            style={{
              padding: '0.6rem 1.25rem',
              borderRadius: 'var(--radius-md)',
              border: 'none',
              backgroundColor: activeViewMode === 'compare' ? 'var(--accent-primary)' : 'var(--bg-secondary)',
              color: activeViewMode === 'compare' ? '#fff' : 'var(--text-primary)',
              fontWeight: 700,
              fontSize: '0.9rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              boxShadow: activeViewMode === 'compare' ? 'var(--shadow-sm)' : 'none'
            }}
          >
            <Eye size={16} />
            <span>時間帯別 コンディション対比</span>
          </button>
          <button
            onClick={() => setActiveViewMode('gallery')}
            style={{
              padding: '0.6rem 1.25rem',
              borderRadius: 'var(--radius-md)',
              border: 'none',
              backgroundColor: activeViewMode === 'gallery' ? 'var(--accent-primary)' : 'var(--bg-secondary)',
              color: activeViewMode === 'gallery' ? '#fff' : 'var(--text-primary)',
              fontWeight: 700,
              fontSize: '0.9rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              boxShadow: activeViewMode === 'gallery' ? 'var(--shadow-sm)' : 'none'
            }}
          >
            <Sun size={16} />
            <span>1日の空の動き一覧（タイムラインギャラリー）</span>
          </button>
        </div>

        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          選択日付: <strong style={{ color: 'var(--text-primary)', fontSize: '0.95rem' }}>{selectedDate}</strong>
          {recordedHours.length > 0 && ` （アーカイブ: ${recordedHours.length}時間帯・${activeCamerasForDate.length}地点）`}
        </div>
      </div>

      {/* 4. メインビューアまたはギャラリー */}
      {activeViewMode === 'compare' ? (
        <LiveCamViewer
          dateStr={selectedDate}
          hourlyWeather={hourlyWeather}
        />
      ) : (
        <div className="card">
          <h3 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Sun size={20} style={{ color: '#f59e0b' }} />
            {selectedDate} の全撮影アーカイブ一覧 ({activeCamerasForDate.length}地点)
          </h3>

          {recordedHours.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-secondary)' }}>
              <p style={{ fontSize: '1rem', margin: '0 0 0.5rem 0' }}>この日付（{selectedDate}）の自動撮影履歴はまだありません。</p>
              <p style={{ fontSize: '0.85rem', margin: 0 }}>「時間帯別 コンディション対比」タブより、YouTubeおよび利尻町公式ライブカメラをご覧いただけます。</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))', gap: '1.25rem' }}>
              {recordedHours.map(hr => {
                const hrRec = selectedDateRecords[hr] || {};
                return (
                  <div
                    key={hr}
                    style={{
                      border: '1px solid var(--border-color)',
                      borderRadius: 'var(--radius-md)',
                      backgroundColor: 'var(--bg-primary)',
                      overflow: 'hidden',
                      display: 'flex',
                      flexDirection: 'column'
                    }}
                  >
                    <div
                      style={{
                        padding: '0.6rem 0.8rem',
                        backgroundColor: 'var(--bg-secondary)',
                        borderBottom: '1px solid var(--border-color)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}
                    >
                      <strong style={{ fontSize: '1rem', color: 'var(--text-primary)' }}>{hr}時台</strong>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '2px', backgroundColor: 'var(--border-color)' }}>
                      {activeCamerasForDate.map(cam => {
                        const camPath = hrRec[cam.id];
                        return (
                          <div
                            key={cam.id}
                            style={{
                              position: 'relative',
                              width: '100%',
                              paddingTop: '68%',
                              backgroundColor: camPath ? '#000' : 'var(--bg-secondary)',
                              overflow: 'hidden'
                            }}
                          >
                            {camPath ? (
                              <img
                                src={getCamImageUrl(camPath)}
                                alt={`${cam.badge} ${hr}:00`}
                                loading="lazy"
                                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                                onError={(e) => {
                                  if (!e.currentTarget.dataset.triedLocal) {
                                    e.currentTarget.dataset.triedLocal = 'true';
                                    e.currentTarget.src = `/${camPath}`;
                                  }
                                }}
                              />
                            ) : (
                              <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontSize: '0.7rem' }}>
                                未記録
                              </div>
                            )}
                            <span style={{
                              position: 'absolute',
                              bottom: '3px',
                              left: '3px',
                              backgroundColor: cam.color,
                              color: '#fff',
                              fontSize: '0.62rem',
                              fontWeight: 700,
                              padding: '1px 4px',
                              borderRadius: '3px',
                              opacity: 0.92
                            }}>
                              {cam.badge}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
