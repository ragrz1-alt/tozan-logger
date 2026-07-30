import { useState, useEffect, useMemo, useRef } from 'react';
import { FileUploader } from './components/FileUploader';
import { Charts } from './components/Charts';
import { DailyDetailView } from './components/DailyDetailView';
import { LiveCamArchivePage } from './components/LiveCamArchivePage';
import { parseLogFile, aggregateData, getDailyDetails, type LogEntry, type CourseId } from './utils/logParser';
import { fetchWeatherData, fetchHourlyWeatherData, type WeatherData, type HourlyWeatherData } from './utils/weatherApi';
import { saveLogsToDB, loadLogsFromDB, clearLogsFromDB } from './utils/storage';
import { Trash2, Calendar as CalendarIcon, Cloud, CloudDownload, CloudUpload, Key, Database, Mountain, Compass, Layers, PlusCircle, X, Lock, Unlock, Eye, RefreshCw, Video } from 'lucide-react';
import { FirebaseModal } from './components/FirebaseModal';
import { AdminModal } from './components/AdminModal';
import { saveLogsToFirestore, loadLogsFromFirestore, checkCloudMetadata } from './utils/firebaseStorage';
import { isFirebaseConfigured } from './config/firebaseConfig';

function App() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(true);
  const [selectedCourse, setSelectedCourse] = useState<CourseId | 'all' | 'cameras'>('oshidomari');
  const [showAddUploader, setShowAddUploader] = useState(false);
  const [showDataManagement, setShowDataManagement] = useState(false);
  const [weatherData, setWeatherData] = useState<Record<string, WeatherData>>({});
  const [hourlyWeather, setHourlyWeather] = useState<Record<string, HourlyWeatherData>>({});
  
  const [isLoadingWeather, setIsLoadingWeather] = useState(false);

  // Admin / Public Viewer Mode
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(() => {
    if (window.location.search.includes('mode=view') || window.location.search.includes('public=1')) {
      return false;
    }
    return localStorage.getItem('tozan_admin_unlocked') === 'true';
  });

  const handleAdminUnlock = () => {
    localStorage.setItem('tozan_admin_unlocked', 'true');
    setIsAdmin(true);
  };

  const handleAdminLock = () => {
    localStorage.removeItem('tozan_admin_unlocked');
    setIsAdmin(false);
    setShowDataManagement(false);
  };

  // Date filtering
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');

  // Selected date for detailed view
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const detailViewRef = useRef<HTMLDivElement>(null);

  // Firebase integration state
  const [isFirebaseOpen, setIsFirebaseOpen] = useState(false);
  const [fbConfigured, setFbConfigured] = useState(isFirebaseConfigured());
  const [isSyncing, setIsSyncing] = useState(false);
  const [cloudMessage, setCloudMessage] = useState<string | null>(null);

  // 不正な日付や不要な期間のログデータを削除するためのクリーンアップステート
  const [showCleanupPanel, setShowCleanupPanel] = useState(false);
  const [cleanYear, setCleanYear] = useState<string>('');
  const [cleanStartDate, setCleanStartDate] = useState('');
  const [cleanEndDate, setCleanEndDate] = useState('');

  const handleDeleteByYear = (targetYear: string) => {
    if (!targetYear) {
      alert('削除したい年を選択してください。');
      return;
    }
    const targetCount = entries.filter(e => e.dateStr.startsWith(targetYear)).length;
    if (targetCount === 0) {
      alert(`${targetYear}年のログデータは見つかりませんでした。`);
      return;
    }
    if (window.confirm(`誤って読み込まれた ${targetYear} 年のすべてのログデータ (${targetCount}件) を削除しますか？\n（この操作は元に戻せません）`)) {
      const newEntries = entries.filter(e => !e.dateStr.startsWith(targetYear));
      setEntries(newEntries);
      saveLogsToDB(newEntries);
      if (fbConfigured) {
        saveLogsToFirestore(newEntries);
      }
      setCloudMessage(`🗑️ ${targetYear}年の不要なログデータ ${targetCount}件を削除しました。`);
      setTimeout(() => setCloudMessage(null), 6000);
      if (selectedYear === targetYear) {
        setSelectedYear('');
      }
    }
  };

  const handleDeleteByRange = () => {
    if (!cleanStartDate || !cleanEndDate) {
      alert('削除したい開始日と終了日を選択してください。');
      return;
    }
    if (cleanStartDate > cleanEndDate) {
      alert('開始日は終了日より前である必要があります。');
      return;
    }
    const targetCount = entries.filter(e => e.dateStr >= cleanStartDate && e.dateStr <= cleanEndDate).length;
    if (targetCount === 0) {
      alert('指定された期間内のログデータは見つかりませんでした。');
      return;
    }
    if (window.confirm(`指定期間 (${cleanStartDate} 〜 ${cleanEndDate}) のログデータ (${targetCount}件) をすべて削除しますか？`)) {
      const newEntries = entries.filter(e => !(e.dateStr >= cleanStartDate && e.dateStr <= cleanEndDate));
      setEntries(newEntries);
      saveLogsToDB(newEntries);
      if (fbConfigured) {
        saveLogsToFirestore(newEntries);
      }
      setCloudMessage(`🗑️ 指定期間のログデータ ${targetCount}件を削除しました。`);
      setTimeout(() => setCloudMessage(null), 6000);
    }
  };

  const handleConfigUpdated = () => {
    setFbConfigured(isFirebaseConfigured());
  };

  const handleSaveToCloud = async () => {
    if (!fbConfigured) {
      setIsFirebaseOpen(true);
      return;
    }
    setIsSyncing(true);
    setCloudMessage(null);
    const success = await saveLogsToFirestore(entries);
    setIsSyncing(false);
    if (success) {
      setCloudMessage(`クラウド (Firebase) に ${entries.length} 件のログを保存・同期しました！`);
    } else {
      setCloudMessage('保存に失敗しました。接続設定を確認してください。');
    }
    setTimeout(() => setCloudMessage(null), 6000);
  };

  const handleLoadFromCloud = async () => {
    if (!fbConfigured) {
      setIsFirebaseOpen(true);
      return;
    }
    setIsSyncing(true);
    setCloudMessage('クラウド (Firebase) からデータを読み込んでいます...');
    const loaded = await loadLogsFromFirestore();
    setIsSyncing(false);
    if (loaded && loaded.length > 0) {
      setEntries(loaded);
      saveLogsToDB(loaded);
      setCloudMessage(`クラウドから ${loaded.length} 件のログを正常に読み込みました！`);
    } else {
      setCloudMessage('クラウド上に保存されたログが見つかりませんでした。');
    }
    setTimeout(() => setCloudMessage(null), 6000);
  };

  const handleFilesParsed = (contents: { name: string; content: string }[], course: CourseId) => {
    let newEntries: LogEntry[] = [];
    contents.forEach(file => {
      const { entries: parsedEntries, errors } = parseLogFile(file.content, course);
      if (errors.length > 0) {
        console.warn(`Errors in ${file.name}:`, errors);
      }
      newEntries = [...newEntries, ...parsedEntries];
    });

    // 🌟 最強の重複チェック＆排除 (Deduplication) ロジック 🌟
    // 「コース + カウンターID + 日付 + 時刻 + 通過方向」の一意シグネチャキーで重複を完全排除
    const uniqueMap = new Map<string, LogEntry>();

    // ① 既存のログをMapに登録
    entries.forEach(e => {
      const key = `${e.course || 'oshidomari'}_${e.counterId}_${e.dateStr}_${e.timeStr}_${e.direction}`;
      uniqueMap.set(key, e);
    });

    const beforeCount = uniqueMap.size;
    let duplicateCount = 0;

    // ② 新しく読んだログを追加（キーが一致する場合は重複としてスキップ＆カウント）
    newEntries.forEach(e => {
      const key = `${e.course || 'oshidomari'}_${e.counterId}_${e.dateStr}_${e.timeStr}_${e.direction}`;
      if (uniqueMap.has(key)) {
        duplicateCount++;
      } else {
        uniqueMap.set(key, e);
      }
    });

    const allEntries = Array.from(uniqueMap.values());
    allEntries.sort((a, b) => a.timestamp - b.timestamp);
    setEntries(allEntries);
    saveLogsToDB(allEntries);
    setSelectedCourse(course);
    setShowAddUploader(false);

    // 重複除外の件数を通知バッジとして上品にフィードバック
    const addedCount = allEntries.length - beforeCount;
    if (duplicateCount > 0) {
      setCloudMessage(`📂 ログ読込完了: 新規追加 ${addedCount}件 (ファイル重複・既存同一データ ${duplicateCount}件を自動除外しました)`);
    } else {
      setCloudMessage(`📂 ログ読込完了: 新規追加 ${addedCount}件を統合しました！`);
    }
    setTimeout(() => setCloudMessage(null), 7000);
  };

  const activeDirection: 'L' | 'R' = useMemo(() => {
    if (selectedCourse === 'kutsugata') return 'L';
    return 'R'; // 鴛泊コースおよび合算は 'R'
  }, [selectedCourse]);

  const activeEntries = useMemo(() => {
    if (selectedCourse === 'oshidomari') {
      return entries.filter(e => (e.course || 'oshidomari') === 'oshidomari');
    }
    if (selectedCourse === 'kutsugata') {
      return entries.filter(e => e.course === 'kutsugata');
    }
    return entries; // 'all'
  }, [entries, selectedCourse]);

  useEffect(() => {
    const initLoad = async () => {
      setIsLoadingLogs(true);
      let saved = await loadLogsFromDB();
      let hasUpdatedFromCloud = false;

      if (isFirebaseConfigured()) {
        try {
          // 1 Read だけでクラウド上の最新保存情報（更新タイムスタンプ・総件数）を確認
          const cloudMeta = await checkCloudMetadata();
          const localUpdatedAt = Number(localStorage.getItem('tozan_cloud_updated_at') || 0);
          const localTotalCount = Number(localStorage.getItem('tozan_cloud_total_count') || 0);

          // 更新が必要な条件:
          // 1. ローカルキャッシュが空
          // 2. クラウドの更新日時(updatedAt)が手元のタイムスタンプより新しい
          // 3. クラウドと手元で総件数が異なる (2025-2026年のみ端末から全件データへ変わった場合など)
          // 4. メタデータが存在しない旧バージョン保存データで、かつ件数が異なる
          const needsFetch =
            !saved ||
            saved.length === 0 ||
            (cloudMeta && cloudMeta.updatedAt > localUpdatedAt) ||
            (cloudMeta && cloudMeta.totalCount !== saved.length) ||
            (!cloudMeta && saved.length !== localTotalCount);

          if (needsFetch) {
            console.log('[Smart Sync] Newer cloud data detected (1 Read check). Updating local cache...');
            const cloudData = await loadLogsFromFirestore();
            if (cloudData && cloudData.length > 0) {
              saved = cloudData;
              await saveLogsToDB(cloudData); // ローカルにもキャッシュ更新
              hasUpdatedFromCloud = true;
            }
          } else {
            console.log('[Smart Sync] Local cache is up-to-date (1 Read verified). No extra Read consumed.');
          }
        } catch (err) {
          console.warn('Silent initial cloud fetch error:', err);
        }
      }

      if (saved && saved.length > 0) {
        setEntries(saved);
        if (hasUpdatedFromCloud) {
          setCloudMessage(`☁️ クラウドから最新データ (${saved.length}件) を自動読込・同期しました！`);
          setTimeout(() => setCloudMessage(null), 6000);
        }
      }
      setIsLoadingLogs(false);
    };
    initLoad();
  }, []);

  const availableYears = useMemo(() => {
    const years = new Set<string>();
    entries.forEach(e => years.add(e.dateStr.substring(0, 4)));
    return Array.from(years).sort();
  }, [entries]);

  const [selectedYear, setSelectedYear] = useState<string>('');

  useEffect(() => {
    if (availableYears.length > 0 && !selectedYear) {
      const latestYear = availableYears[availableYears.length - 1];
      setSelectedYear(latestYear);
      setFilterStartDate(`${latestYear}-01-01`);
      setFilterEndDate(`${latestYear}-12-31`);
    }
  }, [availableYears, selectedYear]);

  const handleYearChange = (newYear: string) => {
    setSelectedYear(newYear);
    setSelectedDate(null);
    setFilterStartDate(`${newYear}-01-01`);
    setFilterEndDate(`${newYear}-12-31`);
  };

  const handleSelectMonth = (monthNum: number | null) => {
    setSelectedDate(null);
    const year = selectedYear || (availableYears[availableYears.length - 1] || '2026');
    if (monthNum === null) {
      // 選択した年の1年間だけを表示（すべての過去年データを混在表示させない）
      setFilterStartDate(`${year}-01-01`);
      setFilterEndDate(`${year}-12-31`);
      return;
    }
    const mStr = monthNum.toString().padStart(2, '0');
    const daysInMonth = new Date(parseInt(year), monthNum, 0).getDate();
    setFilterStartDate(`${year}-${mStr}-01`);
    setFilterEndDate(`${year}-${mStr}-${daysInMonth.toString().padStart(2, '0')}`);
  };

  const { daily, hourly } = useMemo(() => {
    if (activeEntries.length === 0) return { daily: [], hourly: [] };
    
    let filteredEntries = activeEntries;
    if (filterStartDate) {
      filteredEntries = filteredEntries.filter(e => e.dateStr >= filterStartDate);
    }
    if (filterEndDate) {
      filteredEntries = filteredEntries.filter(e => e.dateStr <= filterEndDate);
    }
    
    return aggregateData(filteredEntries, activeDirection, false);
  }, [activeEntries, activeDirection, filterStartDate, filterEndDate]);

  const selectedDayDetails = useMemo(() => {
    if (!selectedDate || activeEntries.length === 0) return null;
    return getDailyDetails(activeEntries, selectedDate, activeDirection, false);
  }, [activeEntries, selectedDate, activeDirection]);

  // 期間フィルター（月選択等）に縛られず、登録されている全ログの日付リストを算出
  const allAvailableDates = useMemo(() => {
    const set = new Set<string>();
    activeEntries.forEach(e => set.add(e.dateStr));
    return Array.from(set).sort();
  }, [activeEntries]);

  const { prevDate, nextDate } = useMemo(() => {
    if (!selectedDate || allAvailableDates.length === 0) return { prevDate: undefined, nextDate: undefined };
    const idx = allAvailableDates.indexOf(selectedDate);
    if (idx === -1) return { prevDate: undefined, nextDate: undefined };
    return {
      prevDate: idx > 0 ? allAvailableDates[idx - 1] : undefined,
      nextDate: idx < allAvailableDates.length - 1 ? allAvailableDates[idx + 1] : undefined,
    };
  }, [selectedDate, allAvailableDates]);

  const handleSelectDate = (d: string) => {
    setSelectedDate(d);
    if (d && filterStartDate && filterEndDate) {
      // 選択した日付が現在の期間フィルター（月など）を外れている場合、移動先日付の月に自動で切り替え
      if (d < filterStartDate || d > filterEndDate) {
        const yyyyMM = d.substring(0, 7);
        const [yStr, mStr] = yyyyMM.split('-');
        const y = parseInt(yStr, 10);
        const m = parseInt(mStr, 10);
        const lastDay = new Date(y, m, 0).getDate();
        setFilterStartDate(`${yStr}-${mStr}-01`);
        setFilterEndDate(`${yStr}-${mStr}-${lastDay.toString().padStart(2, '0')}`);
      }
    }
  };

  useEffect(() => {
    if (selectedDate && detailViewRef.current) {
      detailViewRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [selectedDate]);

  const dailyStartDate = daily.length > 0 ? daily[0].date : '';
  const dailyEndDate = daily.length > 0 ? daily[daily.length - 1].date : '';

  useEffect(() => {
    if (dailyStartDate && dailyEndDate) {
      const fetchWeather = async () => {
        setIsLoadingWeather(true);
        const data = await fetchWeatherData(0, 0, dailyStartDate, dailyEndDate);
        setWeatherData(data);
        setIsLoadingWeather(false);
      };
      fetchWeather();
    }
  }, [dailyStartDate, dailyEndDate, activeEntries.length]); // 新ログ読込時・期間・年月の変更時に自動でクロス気象データを取得・即時反映

  useEffect(() => {
    if (selectedDate) {
      fetchHourlyWeatherData(0, 0, selectedDate).then(data => {
        setHourlyWeather(data);
      });
    } else {
      setHourlyWeather({});
    }
  }, [selectedDate]);

  return (
    <div className="app-container">
      {/* 1. プロフェッショナルでスタイリッシュなヘッダー */}
      <header className="header" style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '1rem',
        paddingBottom: '1.25rem',
        borderBottom: '1px solid var(--border-color)',
        marginBottom: '1.5rem'
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <h1 style={{ 
              fontSize: '1.85rem', 
              fontWeight: 900, 
              background: 'linear-gradient(135deg, #10b981, #3b82f6)', 
              WebkitBackgroundClip: 'text', 
              WebkitTextFillColor: 'transparent',
              margin: 0,
              letterSpacing: '-0.02em'
            }}>
              RISHIRI TRAIL ANALYTICS
            </h1>
            <span style={{
              fontSize: '0.75rem',
              fontWeight: 700,
              padding: '0.2rem 0.6rem',
              borderRadius: '999px',
              backgroundColor: 'rgba(16, 185, 129, 0.12)',
              color: '#10b981',
              border: '1px solid rgba(16, 185, 129, 0.25)'
            }}>
              🌤️ 沓形 × 本泊 気象庁アメダス実況連携
            </span>
          </div>
          <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.92rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
            利尻山 登山者カウンター統合解析システム
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          {/* 閲覧者・管理者共通: いつでも誰でもクラウドの最新データを同期・確認できるスマート更新ボタン */}
          {entries.length > 0 && (
            <button
              onClick={handleLoadFromCloud}
              disabled={isSyncing}
              className="button button-secondary"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.45rem',
                padding: '0.55rem 0.95rem',
                fontSize: '0.85rem',
                fontWeight: 700,
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.08)',
                color: '#3b82f6',
                cursor: 'pointer'
              }}
              title="クラウド上の最新解析データを再読込して同期します"
            >
              <RefreshCw size={15} className={isSyncing ? 'spin' : ''} />
              <span>{isSyncing ? '最新データ同期中...' : '☁️ クラウド同期'}</span>
            </button>
          )}

          {/* 管理者ログイン / 閲覧モード切替ボタン */}
          <button
            onClick={() => setIsAdminModalOpen(true)}
            className="button button-secondary"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              padding: '0.55rem 0.95rem',
              fontSize: '0.85rem',
              fontWeight: 700,
              borderColor: isAdmin ? '#10b981' : 'var(--border-color)',
              backgroundColor: isAdmin ? 'rgba(16, 185, 129, 0.12)' : 'var(--bg-secondary)',
              color: isAdmin ? '#10b981' : 'var(--text-secondary)'
            }}
          >
            {isAdmin ? <Unlock size={16} /> : <Lock size={16} />}
            <span>{isAdmin ? '🔓 管理者モード' : '🔒 閲覧専用モード'}</span>
          </button>

          {/* 管理者モード時のみ表示: データ・ログ管理 / クラウド */}
          {entries.length > 0 && isAdmin && (
            <button
              onClick={() => setShowDataManagement(!showDataManagement)}
              className="button button-secondary"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.45rem',
                padding: '0.55rem 1.05rem',
                fontSize: '0.85rem',
                fontWeight: 600,
                borderColor: showDataManagement ? '#3b82f6' : 'var(--border-color)',
                backgroundColor: showDataManagement ? 'rgba(59, 130, 246, 0.1)' : 'var(--bg-secondary)',
                color: showDataManagement ? '#3b82f6' : 'var(--text-primary)'
              }}
            >
              <Database size={16} />
              <span>{showDataManagement ? 'データ管理を閉じる' : 'データ・ログ管理 / クラウド'}</span>
            </button>
          )}
        </div>
      </header>

      <main>
        {cloudMessage && (
          <div style={{
            padding: '0.75rem 1.25rem',
            borderRadius: '8px',
            backgroundColor: 'rgba(59, 130, 246, 0.12)',
            border: '1px solid rgba(59, 130, 246, 0.3)',
            color: 'var(--text-primary)',
            marginBottom: '1.25rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.6rem',
            fontSize: '0.95rem',
            fontWeight: 600
          }}>
            <Cloud size={18} style={{ color: '#3b82f6' }} />
            {cloudMessage}
          </div>
        )}

        <FirebaseModal 
          isOpen={isFirebaseOpen} 
          onClose={() => setIsFirebaseOpen(false)} 
          onConfigUpdated={handleConfigUpdated}
        />

        <AdminModal
          isOpen={isAdminModalOpen}
          onClose={() => setIsAdminModalOpen(false)}
          isAdmin={isAdmin}
          onUnlock={handleAdminUnlock}
          onLock={handleAdminLock}
        />

        {isLoadingLogs ? (
          <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
            <p style={{ fontSize: '1.2rem', color: 'var(--text-secondary)' }}>保存されたログデータを読み込んでいます...</p>
          </div>
        ) : entries.length === 0 ? (
          isAdmin ? (
            <FileUploader onFilesParsed={handleFilesParsed} />
          ) : (
            <div className="card" style={{ textAlign: 'center', padding: '4rem 2rem', maxWidth: '600px', margin: '2rem auto' }}>
              <div style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                color: '#3b82f6',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 1.5rem auto'
              }}>
                <Eye size={32} />
              </div>
              <h2 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: '0.75rem', color: 'var(--text-primary)' }}>
                閲覧専用ダッシュボード (公開モード)
              </h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', marginBottom: '2rem', lineHeight: 1.6 }}>
                現在表示できるログデータが保存されていません。<br />
                管理者によってクラウドに同期された最新の解析結果を読み込むか、管理者モードにログインしてください。
              </p>
              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                <button
                  onClick={handleLoadFromCloud}
                  disabled={isSyncing}
                  className="button button-primary"
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1.5rem', fontWeight: 700 }}
                >
                  <RefreshCw size={18} className={isSyncing ? 'spin' : ''} />
                  <span>{isSyncing ? 'クラウドを確認中...' : 'クラウドから最新データを読み込む'}</span>
                </button>
                <button
                  onClick={() => setIsAdminModalOpen(true)}
                  className="button button-secondary"
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1.25rem' }}
                >
                  <Lock size={16} />
                  <span>管理者ログイン (ログ追加・管理)</span>
                </button>
              </div>
            </div>
          )
        ) : (
          <>
            {/* 2. プロが選ぶ最適配置: 画面中央上部のメイン・コース選択セグメントバー */}
            <div style={{ 
              display: 'flex', 
              justifyContent: 'center', 
              marginBottom: '1.75rem' 
            }}>
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '0.35rem',
                backgroundColor: 'var(--bg-secondary)',
                borderRadius: '14px',
                border: '1px solid var(--border-color)',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.05)',
                gap: '0.35rem',
                flexWrap: 'wrap'
              }}>
                <button
                  onClick={() => {
                    setSelectedCourse('oshidomari');
                    setSelectedDate(null);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.65rem 1.45rem',
                    fontWeight: 700,
                    fontSize: '0.95rem',
                    borderRadius: '10px',
                    border: 'none',
                    cursor: 'pointer',
                    backgroundColor: selectedCourse === 'oshidomari' ? '#10b981' : 'transparent',
                    color: selectedCourse === 'oshidomari' ? '#ffffff' : 'var(--text-primary)',
                    boxShadow: selectedCourse === 'oshidomari' ? '0 2px 8px rgba(16, 185, 129, 0.35)' : 'none',
                    transition: 'all 0.2s ease'
                  }}
                >
                  <Mountain size={18} />
                  <span>鴛泊コース</span>
                </button>

                <button
                  onClick={() => {
                    setSelectedCourse('kutsugata');
                    setSelectedDate(null);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.65rem 1.45rem',
                    fontWeight: 700,
                    fontSize: '0.95rem',
                    borderRadius: '10px',
                    border: 'none',
                    cursor: 'pointer',
                    backgroundColor: selectedCourse === 'kutsugata' ? '#3b82f6' : 'transparent',
                    color: selectedCourse === 'kutsugata' ? '#ffffff' : 'var(--text-primary)',
                    boxShadow: selectedCourse === 'kutsugata' ? '0 2px 8px rgba(59, 130, 246, 0.35)' : 'none',
                    transition: 'all 0.2s ease'
                  }}
                >
                  <Compass size={18} />
                  <span>沓形コース</span>
                </button>

                <button
                  onClick={() => {
                    setSelectedCourse('all');
                    setSelectedDate(null);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.65rem 1.45rem',
                    fontWeight: 700,
                    fontSize: '0.95rem',
                    borderRadius: '10px',
                    border: 'none',
                    cursor: 'pointer',
                    backgroundColor: selectedCourse === 'all' ? '#6366f1' : 'transparent',
                    color: selectedCourse === 'all' ? '#ffffff' : 'var(--text-primary)',
                    boxShadow: selectedCourse === 'all' ? '0 2px 8px rgba(99, 102, 241, 0.35)' : 'none',
                    transition: 'all 0.2s ease'
                  }}
                >
                  <Layers size={18} />
                  <span>利尻山 全体合算</span>
                </button>

                <button
                  onClick={() => {
                    setSelectedCourse('cameras');
                    setSelectedDate(null);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.65rem 1.45rem',
                    fontWeight: 700,
                    fontSize: '0.95rem',
                    borderRadius: '10px',
                    border: 'none',
                    cursor: 'pointer',
                    backgroundColor: selectedCourse === 'cameras' ? '#10b981' : 'transparent',
                    color: selectedCourse === 'cameras' ? '#ffffff' : 'var(--text-primary)',
                    boxShadow: selectedCourse === 'cameras' ? '0 2px 8px rgba(16, 185, 129, 0.35)' : 'none',
                    transition: 'all 0.2s ease'
                  }}
                >
                  <Video size={18} />
                  <span>ライブカメラ状況確認</span>
                </button>
              </div>
            </div>

            {/* 3. トグル式データ・ログ管理パネル (常時非表示 -> ボタン押下時のみ美しい展開) */}
            {showDataManagement && isAdmin && (
              <div style={{ marginBottom: '2rem' }}>
                <div className="card" style={{ 
                  borderLeft: '4px solid #3b82f6', 
                  marginBottom: '1rem', 
                  background: 'linear-gradient(to right, rgba(59, 130, 246, 0.05), transparent)',
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '1rem'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                    <div style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '10px',
                      backgroundColor: 'rgba(59, 130, 246, 0.15)',
                      color: '#3b82f6',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}>
                      <Database size={22} />
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
                        <span style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)' }}>
                          Cloud Firestore クラウド同期連携
                        </span>
                        <span style={{
                          fontSize: '0.75rem',
                          padding: '0.15rem 0.5rem',
                          borderRadius: '999px',
                          fontWeight: 600,
                          backgroundColor: fbConfigured ? 'rgba(16, 185, 129, 0.15)' : 'rgba(148, 163, 184, 0.15)',
                          color: fbConfigured ? '#10b981' : 'var(--text-secondary)'
                        }}>
                          {fbConfigured ? '🟢 設定済み' : '⚪ 未設定'}
                        </span>
                      </div>
                      <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0 }}>
                        どのデバイスからでも同じ解析ログを保存・復元できます。
                      </p>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.6rem' }}>
                    <button
                      onClick={() => setIsFirebaseOpen(true)}
                      className="button button-secondary"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        fontSize: '0.85rem',
                        padding: '0.5rem 0.9rem'
                      }}
                    >
                      <Key size={15} />
                      接続設定
                    </button>
                    <button
                      onClick={handleLoadFromCloud}
                      disabled={isSyncing}
                      className="button button-secondary"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        fontSize: '0.85rem',
                        padding: '0.5rem 1rem',
                        borderColor: '#3b82f6',
                        color: '#3b82f6',
                        fontWeight: 600
                      }}
                    >
                      <CloudDownload size={15} />
                      {isSyncing ? '通信中...' : 'クラウドから読込'}
                    </button>
                    <button
                      onClick={handleSaveToCloud}
                      disabled={isSyncing || entries.length === 0}
                      className="button button-primary"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        fontSize: '0.85rem',
                        padding: '0.5rem 1rem',
                        fontWeight: 600,
                        opacity: entries.length === 0 ? 0.6 : 1
                      }}
                    >
                      <CloudUpload size={15} />
                      {isSyncing ? '保存中...' : 'クラウドへ保存'}
                    </button>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                  <button
                    onClick={() => {
                      setShowAddUploader(!showAddUploader);
                      if (showCleanupPanel) setShowCleanupPanel(false);
                    }}
                    className="button button-secondary"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      fontSize: '0.85rem',
                      fontWeight: 700,
                      padding: '0.55rem 1rem',
                      borderColor: '#10b981',
                      color: '#10b981'
                    }}
                  >
                    {showAddUploader ? <X size={16} /> : <PlusCircle size={16} />}
                    <span>{showAddUploader ? '追加アップローダーを閉じる' : '他のコースのログを追加読込 (+)'}</span>
                  </button>

                  <button
                    onClick={() => {
                      setShowCleanupPanel(!showCleanupPanel);
                      if (showAddUploader) setShowAddUploader(false);
                    }}
                    className="button button-secondary"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      fontSize: '0.85rem',
                      fontWeight: 700,
                      padding: '0.55rem 1rem',
                      borderColor: '#f59e0b',
                      color: '#f59e0b'
                    }}
                  >
                    {showCleanupPanel ? <X size={16} /> : <Trash2 size={16} />}
                    <span>{showCleanupPanel ? 'クリーンアップ画面を閉じる' : '不要な過去・不正日付ログを選択削除'}</span>
                  </button>

                  <button 
                    className="button button-secondary" 
                    style={{ backgroundColor: 'transparent', color: '#ef4444', borderColor: '#ef4444', fontSize: '0.85rem', padding: '0.55rem 1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                    onClick={() => {
                      if (window.confirm('保存されているログデータをすべて削除して初期化しますか？')) {
                        clearLogsFromDB().then(() => {
                          setEntries([]);
                          setSelectedDate(null);
                        });
                      }
                    }}
                  >
                    <Trash2 size={16} />
                    <span>全データを初期化（リセット）</span>
                  </button>
                </div>

                {showAddUploader && (
                  <FileUploader onFilesParsed={handleFilesParsed} />
                )}

                {showCleanupPanel && (
                  <div style={{
                    padding: '1.25rem',
                    backgroundColor: 'var(--bg-secondary)',
                    borderRadius: '12px',
                    border: '1px solid #f59e0b',
                    marginBottom: '1.25rem'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.85rem', fontWeight: 700, color: '#d97706' }}>
                      <Trash2 size={18} />
                      <span>🗑️ 不正日付・設定ミス・不要期間ログのクリーンアップツール</span>
                    </div>
                    <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                      電池交換や設定ミスで読み込んでしまった過去のおかしな年や特定期間のログだけを選択して安全に削除できます。
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', alignItems: 'flex-start' }}>
                      {/* 年単位の削除 */}
                      <div style={{ flex: '1 1 280px', padding: '0.85rem', backgroundColor: 'var(--bg-primary)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                        <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>① 年単位で丸ごと削除</div>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                          <select 
                            className="select" 
                            value={cleanYear} 
                            onChange={(e) => setCleanYear(e.target.value)}
                            style={{ padding: '0.35rem 0.65rem', fontSize: '0.85rem', minWidth: '100px' }}
                          >
                            <option value="">年を選択</option>
                            {availableYears.map(y => (
                              <option key={y} value={y}>{y}年 ({entries.filter(e => e.dateStr.startsWith(y)).length}件)</option>
                            ))}
                          </select>
                          <button
                            className="btn"
                            disabled={!cleanYear}
                            onClick={() => handleDeleteByYear(cleanYear)}
                            style={{
                              backgroundColor: '#ef4444',
                              color: '#fff',
                              padding: '0.35rem 0.8rem',
                              fontSize: '0.82rem',
                              fontWeight: 700,
                              border: 'none',
                              borderRadius: '6px',
                              cursor: cleanYear ? 'pointer' : 'not-allowed',
                              opacity: cleanYear ? 1 : 0.5
                            }}
                          >
                            選択年のログを削除
                          </button>
                        </div>
                      </div>

                      {/* 期間指定の削除 */}
                      <div style={{ flex: '1 1 350px', padding: '0.85rem', backgroundColor: 'var(--bg-primary)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                        <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>② 日付の範囲を指定して削除</div>
                        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                          <input 
                            type="date" 
                            className="input" 
                            value={cleanStartDate} 
                            onChange={(e) => setCleanStartDate(e.target.value)}
                            style={{ width: '135px', padding: '0.3rem 0.5rem', fontSize: '0.82rem' }}
                          />
                          <span>〜</span>
                          <input 
                            type="date" 
                            className="input" 
                            value={cleanEndDate} 
                            onChange={(e) => setCleanEndDate(e.target.value)}
                            style={{ width: '135px', padding: '0.3rem 0.5rem', fontSize: '0.82rem' }}
                          />
                          <button
                            className="btn"
                            disabled={!cleanStartDate || !cleanEndDate}
                            onClick={handleDeleteByRange}
                            style={{
                              backgroundColor: '#ef4444',
                              color: '#fff',
                              padding: '0.35rem 0.8rem',
                              fontSize: '0.82rem',
                              fontWeight: 700,
                              border: 'none',
                              borderRadius: '6px',
                              cursor: (cleanStartDate && cleanEndDate) ? 'pointer' : 'not-allowed',
                              opacity: (cleanStartDate && cleanEndDate) ? 1 : 0.5
                            }}
                          >
                            期間指定削除
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {selectedCourse === 'cameras' ? (
              <LiveCamArchivePage />
            ) : (
              <>
                {/* 4. 年・月 ワンクリック絞り込み ＆ 特定日の詳細分析を一つにまとめた統合フィルターカード */}
                <div className="card" style={{ marginBottom: '1.5rem', padding: '1.25rem' }}>
              <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '1.25rem'
              }}>
                {/* 左側: 年・月・任意期間 絞り込み */}
                <div style={{ flex: '1 1 450px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', fontWeight: 700, fontSize: '0.95rem' }}>
                    <CalendarIcon size={18} style={{ color: 'var(--accent-primary)' }} />
                    <span>📅 解析期間フィルター (年・月 ワンクリック絞り込み)</span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.75rem' }}>
                    {availableYears.length > 0 && (
                      <select 
                        className="select" 
                        value={selectedYear} 
                        onChange={(e) => handleYearChange(e.target.value)}
                        style={{ width: 'auto', minWidth: '90px', fontWeight: 'bold', padding: '0.35rem 0.65rem', fontSize: '0.85rem' }}
                      >
                        {availableYears.map(y => (
                          <option key={y} value={y}>{y}年</option>
                        ))}
                      </select>
                    )}
                    {(() => {
                      const year = selectedYear || (availableYears[availableYears.length - 1] || '2026');
                      const isYearAll = filterStartDate === `${year}-01-01` && filterEndDate === `${year}-12-31`;
                      return (
                        <button 
                          className="btn" 
                          style={{ 
                            padding: '0.35rem 0.75rem', 
                            fontSize: '0.85rem', 
                            backgroundColor: isYearAll ? '#10b981' : 'var(--bg-primary)', 
                            color: isYearAll ? '#fff' : 'var(--text-primary)', 
                            border: '1px solid var(--border-color)',
                            fontWeight: isYearAll ? 700 : 400
                          }}
                          onClick={() => handleSelectMonth(null)}
                        >
                          その年全体 (1〜12月)
                        </button>
                      );
                    })()}
                    {[5, 6, 7, 8, 9, 10].map(m => {
                      const year = selectedYear || availableYears[0] || '2026';
                      const mStr = m.toString().padStart(2, '0');
                      const isActive = filterStartDate.startsWith(`${year}-${mStr}`) && filterEndDate.startsWith(`${year}-${mStr}`);
                      return (
                        <button
                          key={m}
                          className="btn"
                          style={{ 
                            padding: '0.35rem 0.75rem', 
                            fontSize: '0.85rem', 
                            backgroundColor: isActive ? '#10b981' : 'var(--bg-primary)', 
                            color: isActive ? '#fff' : 'var(--text-primary)', 
                            border: '1px solid var(--border-color)',
                            fontWeight: isActive ? 700 : 400
                          }}
                          onClick={() => handleSelectMonth(m)}
                        >
                          {m}月
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>任意期間指定:</span>
                    <input 
                      type="date" 
                      className="input" 
                      value={filterStartDate} 
                      onChange={(e) => {
                        setFilterStartDate(e.target.value);
                        setSelectedDate(null);
                      }}
                      style={{ width: '135px', padding: '0.3rem 0.5rem', fontSize: '0.82rem' }}
                    />
                    <span style={{ color: 'var(--text-secondary)' }}>〜</span>
                    <input 
                      type="date" 
                      className="input" 
                      value={filterEndDate} 
                      onChange={(e) => {
                        setFilterEndDate(e.target.value);
                        setSelectedDate(null);
                      }}
                      style={{ width: '135px', padding: '0.3rem 0.5rem', fontSize: '0.82rem' }}
                    />
                  </div>
                </div>

                {/* 右側: 特定日の詳細インスペクターセレクト (統合配置) */}
                <div style={{
                  flex: '1 1 320px',
                  padding: '1rem',
                  backgroundColor: 'var(--bg-secondary)',
                  borderRadius: '10px',
                  border: '1px solid var(--border-color)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.6rem', fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                    <span>📍 特定日の詳細時間帯グラフ・気象状況</span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <select
                      className="select"
                      value={selectedDate || ''}
                      onChange={(e) => setSelectedDate(e.target.value || null)}
                      style={{ flex: 1, padding: '0.45rem 0.7rem', fontSize: '0.85rem' }}
                    >
                      <option value="">-- 日付を選択 (または棒グラフをクリック) --</option>
                      {daily.map((d) => (
                        <option key={d.date} value={d.date}>
                          {d.date} (入山 {d.enter}人 / 下山 {d.exit}人)
                        </option>
                      ))}
                    </select>
                    {selectedDate && (
                      <button 
                        className="btn"
                        style={{ 
                          padding: '0.45rem 0.75rem', 
                          fontSize: '0.82rem', 
                          backgroundColor: '#ef4444', 
                          color: '#fff',
                          border: 'none',
                          fontWeight: 600,
                          borderRadius: '6px'
                        }}
                        onClick={() => setSelectedDate(null)}
                      >
                        解除
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {isLoadingWeather && <p style={{ textAlign: 'center', marginBottom: '1rem', color: 'var(--text-secondary)' }}>気象データを読込中...</p>}

            {/* 6. 特定日が選択されている場合の詳細ビュー (スムーズスクロール対応) */}
            <div ref={detailViewRef}>
              {selectedDayDetails && (
                <DailyDetailView
                  details={selectedDayDetails}
                  weather={selectedDate ? weatherData[selectedDate] : undefined}
                  hourlyWeather={hourlyWeather}
                  onClose={() => setSelectedDate(null)}
                  onSelectDate={handleSelectDate}
                  prevDate={prevDate}
                  nextDate={nextDate}
                />
              )}
            </div>

            {/* 7. 厳選されたメイン・アナリティクス・チャート群 */}
            <Charts 
              dailyData={daily} 
              hourlyData={hourly} 
              weatherData={weatherData} 
              onSelectDate={(date) => setSelectedDate(date)} 
            />
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default App;
