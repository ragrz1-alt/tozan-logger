import { useState, useEffect, useMemo } from 'react';
import { FileUploader } from './components/FileUploader';
import { Charts } from './components/Charts';
import { DailyDetailView } from './components/DailyDetailView';
import { LiveCamArchivePage } from './components/LiveCamArchivePage';
import { LiveCamPoCPanel } from './components/LiveCamPoCPanel';
import { RishiriNowPanel } from './components/RishiriNowPanel';
import { StakeholderAnalytics } from './components/StakeholderAnalytics';
import { parseLogFile, aggregateData, getDailyDetails, type LogEntry, type CourseId } from './utils/logParser';
import { fetchWeatherData, fetchHourlyWeatherData, type WeatherData, type HourlyWeatherData } from './utils/weatherApi';
import { saveLogsToDB, loadLogsFromDB, clearLogsFromDB } from './utils/storage';
import { Trash2, Calendar as CalendarIcon, Cloud, CloudDownload, CloudUpload, Key, Database, Mountain, Compass, Layers, PlusCircle, X, Lock, Unlock, Eye, RefreshCw, Video, Info, BarChart3, Terminal } from 'lucide-react';
import { FirebaseModal } from './components/FirebaseModal';
import { AdminModal } from './components/AdminModal';
import { SystemInfoModal } from './components/SystemInfoModal';
import { saveLogsToFirestore, loadLogsFromFirestore, checkCloudMetadata } from './utils/firebaseStorage';
import { isFirebaseConfigured } from './config/firebaseConfig';
import { YearlySummaryBanner } from './components/YearlySummaryBanner';
import { MonthlySummaryBanner } from './components/MonthlySummaryBanner';

function App() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(true);
  const [selectedCourse, setSelectedCourse] = useState<CourseId | 'all' | 'cameras' | 'analytics' | 'poc' | 'now'>('oshidomari');
  const [showAddUploader, setShowAddUploader] = useState(false);
  const [showDataManagement, setShowDataManagement] = useState(false);
  const [weatherData, setWeatherData] = useState<Record<string, WeatherData>>({});
  const [hourlyWeather, setHourlyWeather] = useState<Record<string, HourlyWeatherData>>({});
  
  const [isLoadingWeather, setIsLoadingWeather] = useState(false);

  // System Info & Weather Source Modal
  const [isSystemInfoOpen, setIsSystemInfoOpen] = useState(false);

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
    if (selectedCourse === ('poc' as any)) {
      setSelectedCourse('oshidomari');
    }
  };

  // Date filtering
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');

  // Selected date for detailed view
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

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

  const allStartDate = allAvailableDates.length > 0 ? allAvailableDates[0] : '';
  const allEndDate = allAvailableDates.length > 0 ? allAvailableDates[allAvailableDates.length - 1] : '';

  // 選択中の期間が「その年全体(1〜12月等)」かどうか判定 (年間総入山者数のプレミアムKPIバナー表示条件)
  const isYearAllView = useMemo(() => {
    if (!filterStartDate || !filterEndDate) return false;
    const year = selectedYear || (availableYears[availableYears.length - 1] || '2026');
    // 1. "YYYY-01-01" 〜 "YYYY-12-31" など年全体が指定されている場合
    if (filterStartDate === `${year}-01-01` && filterEndDate === `${year}-12-31`) {
      return true;
    }
    // 2. または対象年内の全ログが含まれる日付範囲になっている場合
    const yearEntries = activeEntries.filter(e => e.dateStr.startsWith(year));
    if (yearEntries.length > 0) {
      const firstDate = yearEntries[0].dateStr;
      const lastDate = yearEntries[yearEntries.length - 1].dateStr;
      if (filterStartDate <= firstDate && filterEndDate >= lastDate) {
        return true;
      }
    }
    return false;
  }, [filterStartDate, filterEndDate, selectedYear, availableYears, activeEntries]);

  // 選択中の期間が特定の1ヶ月間(1日〜末日)かどうか判定し、該当月を返す
  const selectedMonthNum = useMemo(() => {
    if (!filterStartDate || !filterEndDate) return null;
    const year = selectedYear || (availableYears[availableYears.length - 1] || '2026');
    for (let m = 1; m <= 12; m++) {
      const mStr = m.toString().padStart(2, '0');
      const daysInMonth = new Date(parseInt(year), m, 0).getDate();
      if (filterStartDate === `${year}-${mStr}-01` && filterEndDate === `${year}-${mStr}-${daysInMonth}`) {
        return m;
      }
    }
    return null;
  }, [filterStartDate, filterEndDate, selectedYear, availableYears]);

  const navigateMonth = (direction: -1 | 1) => {
    if (selectedMonthNum === null) return;
    let newM = selectedMonthNum + direction;
    let newY = parseInt(selectedYear || availableYears[availableYears.length - 1] || '2026');
    if (newM < 1) {
      newM = 12;
      newY -= 1;
    } else if (newM > 12) {
      newM = 1;
      newY += 1;
    }
    const newYearStr = newY.toString();
    setSelectedYear(newYearStr);
    const mStr = newM.toString().padStart(2, '0');
    const daysInMonth = new Date(newY, newM, 0).getDate();
    setFilterStartDate(`${newYearStr}-${mStr}-01`);
    setFilterEndDate(`${newYearStr}-${mStr}-${daysInMonth}`);
  };

  const navigateYear = (direction: -1 | 1) => {
    const currentY = parseInt(selectedYear || availableYears[availableYears.length - 1] || '2026');
    const newY = currentY + direction;
    const newYearStr = newY.toString();
    
    setSelectedYear(newYearStr);
    if (selectedMonthNum !== null) {
      const mStr = selectedMonthNum.toString().padStart(2, '0');
      const daysInMonth = new Date(newY, selectedMonthNum, 0).getDate();
      setFilterStartDate(`${newYearStr}-${mStr}-01`);
      setFilterEndDate(`${newYearStr}-${mStr}-${daysInMonth}`);
    } else {
      setFilterStartDate(`${newYearStr}-01-01`);
      setFilterEndDate(`${newYearStr}-12-31`);
    }
  };

  const { hasNextYear, hasNextMonth } = useMemo(() => {
    let hasNextYear = true;
    let hasNextMonth = true;
    const maxDateStr = entries.length > 0 ? entries[entries.length - 1].dateStr : null;
    const currentYearStr = selectedYear || (availableYears[availableYears.length - 1] || '2026');
    
    if (maxDateStr) {
      const [maxYear, maxMonth] = maxDateStr.split('-');
      if (currentYearStr >= maxYear) {
        hasNextYear = false;
        if (selectedMonthNum !== null && selectedMonthNum >= parseInt(maxMonth, 10)) {
          hasNextMonth = false;
        }
      }
    }
    return { hasNextYear, hasNextMonth };
  }, [entries, selectedYear, availableYears, selectedMonthNum]);

  const { prevYearDaily, prevMonthDaily } = useMemo(() => {
    const currentYStr = selectedYear || (availableYears[availableYears.length - 1] || '2026');
    const currentY = parseInt(currentYStr, 10);
    const prevYStr = (currentY - 1).toString();
    const maxDateStr = entries.length > 0 ? entries[entries.length - 1].dateStr : null;
    const maxYear = maxDateStr ? maxDateStr.split('-')[0] : currentYStr;

    // 1. Season Summary (Yearly) - 6/1 to 10/31
    let prevYearEnd = `${prevYStr}-10-31`;
    if (currentYStr === maxYear && maxDateStr) {
        // If viewing the current ongoing year, only compare up to the latest available MM-DD
        const mmdd = maxDateStr.substring(5); // e.g., '08-11'
        if (mmdd < '10-31') {
             prevYearEnd = `${prevYStr}-${mmdd}`;
        }
    }
    const pyEntries = activeEntries.filter(e => e.dateStr >= `${prevYStr}-06-01` && e.dateStr <= prevYearEnd);
    const { daily: pyDaily } = aggregateData(pyEntries, activeDirection, false);

    // 2. Monthly Summary
    let pyMonthDaily: { date: string; enter: number; exit: number }[] = [];
    if (selectedMonthNum !== null) {
       const mStr = selectedMonthNum.toString().padStart(2, '0');
       let prevMonthEnd = `${prevYStr}-${mStr}-${new Date(currentY - 1, selectedMonthNum, 0).getDate().toString().padStart(2, '0')}`;
       if (currentYStr === maxYear && maxDateStr) {
           const [_, maxM, maxD] = maxDateStr.split('-');
           if (parseInt(maxM, 10) === selectedMonthNum) {
               prevMonthEnd = `${prevYStr}-${mStr}-${maxD}`;
           }
       }
       const pmEntries = activeEntries.filter(e => e.dateStr >= `${prevYStr}-${mStr}-01` && e.dateStr <= prevMonthEnd);
       const { daily: pmDaily } = aggregateData(pmEntries, activeDirection, false);
       pyMonthDaily = pmDaily;
    }

    return { prevYearDaily: pyDaily, prevMonthDaily: pyMonthDaily };
  }, [selectedYear, availableYears, entries, activeEntries, activeDirection, selectedMonthNum]);

  useEffect(() => {
    if (allStartDate && allEndDate) {
      const fetchWeather = async () => {
        setIsLoadingWeather(true);
        const data = await fetchWeatherData(0, 0, allStartDate, allEndDate);
        setWeatherData(data);
        setIsLoadingWeather(false);
      };
      fetchWeather();
    }
  }, [allStartDate, allEndDate, activeEntries.length]); // 全期間のログ日付範囲の気象データを自動取得・キャッシュして各年対応

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
        <div style={{ flex: '1 1 280px', minWidth: '260px' }}>
          <h1 style={{ 
            fontSize: '1.75rem', 
            fontWeight: 900, 
            background: 'linear-gradient(135deg, #10b981, #3b82f6)', 
            WebkitBackgroundClip: 'text', 
            WebkitTextFillColor: 'transparent',
            margin: 0,
            letterSpacing: '-0.02em',
            lineHeight: 1.2
          }}>
            RISHIRI TRAIL ANALYTICS
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '0.35rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
              利尻山 登山者カウンター統合解析システム
            </span>
            <span style={{
              fontSize: '0.72rem',
              fontWeight: 700,
              padding: '0.15rem 0.55rem',
              borderRadius: '999px',
              backgroundColor: 'rgba(16, 185, 129, 0.12)',
              color: '#10b981',
              border: '1px solid rgba(16, 185, 129, 0.25)',
              whiteSpace: 'nowrap'
            }}>
              🌤️ 沓形 × 本泊 気象庁アメダス連携
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end', flex: '0 1 auto' }}>
          {/* 気象データの情報源・システム解析仕様について（解説モーダル表示ボタン） */}
          <button
            onClick={() => setIsSystemInfoOpen(true)}
            className="button button-secondary"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              padding: '0.4rem 0.8rem',
              fontSize: '0.81rem',
              fontWeight: 700,
              borderRadius: '999px',
              borderColor: 'rgba(16, 185, 129, 0.4)',
              backgroundColor: 'rgba(16, 185, 129, 0.08)',
              color: '#10b981',
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
            title="気象データの情報源(ソース)・システム解析仕様について確認します"
          >
            <Info size={14} />
            <span>ℹ️ 解析仕様＆データ出典</span>
          </button>

          {/* 閲覧者・管理者共通: いつでも誰でもクラウドの最新データを同期・確認できるスマート更新ボタン */}
          {entries.length > 0 && (
            <button
              onClick={handleLoadFromCloud}
              disabled={isSyncing}
              className="button button-secondary"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                padding: '0.4rem 0.8rem',
                fontSize: '0.81rem',
                fontWeight: 700,
                borderRadius: '999px',
                borderColor: 'rgba(59, 130, 246, 0.4)',
                backgroundColor: 'rgba(59, 130, 246, 0.08)',
                color: '#3b82f6',
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
              title="クラウド上の最新解析データを再読込して同期します"
            >
              <RefreshCw size={14} className={isSyncing ? 'spin' : ''} />
              <span>{isSyncing ? 'データ同期中...' : '☁️ クラウド同期'}</span>
            </button>
          )}

          {/* 管理者ログイン / 閲覧モード切替ボタン */}
          <button
            onClick={() => setIsAdminModalOpen(true)}
            className="button button-secondary"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              padding: '0.4rem 0.8rem',
              fontSize: '0.81rem',
              fontWeight: 700,
              borderRadius: '999px',
              borderColor: isAdmin ? 'rgba(16, 185, 129, 0.4)' : 'var(--border-color)',
              backgroundColor: isAdmin ? 'rgba(16, 185, 129, 0.12)' : 'var(--bg-secondary)',
              color: isAdmin ? '#10b981' : 'var(--text-secondary)',
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
          >
            {isAdmin ? <Unlock size={14} /> : <Lock size={14} />}
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

        <SystemInfoModal
          isOpen={isSystemInfoOpen}
          onClose={() => setIsSystemInfoOpen(false)}
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
                    setSelectedCourse('now');
                    setSelectedDate(null);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.65rem 1.45rem',
                    fontWeight: 800,
                    fontSize: '1rem',
                    borderRadius: '10px',
                    border: 'none',
                    cursor: 'pointer',
                    backgroundColor: selectedCourse === 'now' ? '#f59e0b' : 'rgba(245, 158, 11, 0.1)',
                    color: selectedCourse === 'now' ? '#ffffff' : '#f59e0b',
                    boxShadow: selectedCourse === 'now' ? '0 4px 12px rgba(245, 158, 11, 0.4)' : 'none',
                    transition: 'all 0.2s ease',
                    marginRight: '1rem' // 独立させるためのマージン
                  }}
                >
                  <Cloud size={20} />
                  <span>🌤️ 利尻Now</span>
                </button>

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

                <button
                  onClick={() => {
                    setSelectedCourse('analytics');
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
                    backgroundColor: selectedCourse === 'analytics' ? '#3b82f6' : 'transparent',
                    color: selectedCourse === 'analytics' ? '#ffffff' : 'var(--text-primary)',
                    boxShadow: selectedCourse === 'analytics' ? '0 2px 8px rgba(59, 130, 246, 0.35)' : 'none',
                    transition: 'all 0.2s ease'
                  }}
                >
                  <BarChart3 size={18} />
                  <span>利用解析</span>
                </button>

                {isAdmin && (
                  <button
                    onClick={() => {
                      setSelectedCourse('poc' as any);
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
                      border: '1px dashed #8b5cf6',
                      cursor: 'pointer',
                      backgroundColor: selectedCourse === ('poc' as any) ? '#8b5cf6' : 'rgba(139, 92, 246, 0.08)',
                      color: selectedCourse === ('poc' as any) ? '#ffffff' : '#8b5cf6',
                      boxShadow: selectedCourse === ('poc' as any) ? '0 2px 8px rgba(139, 92, 246, 0.35)' : 'none',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    <Terminal size={18} />
                    <span>🧪 PoC 実証実験室 [管理者専用]</span>
                  </button>
                )}
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
            ) : selectedCourse === 'poc' ? (
              <LiveCamPoCPanel />
            ) : selectedCourse === 'now' ? (
              <RishiriNowPanel />
            ) : selectedCourse === ('poc' as any) && isAdmin ? (
              <LiveCamPoCPanel />
            ) : selectedCourse === 'analytics' ? (
              <StakeholderAnalytics
                entries={entries}
                weatherData={weatherData}
                availableYears={availableYears}
                onSelectDate={(date) => {
                  handleSelectDate(date);
                }}
              />
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

            {/* 6. その年全体を表示している時は年間サマリーを、特定の月を表示している時は月間サマリーを表示 */}
            {isYearAllView && (
              <YearlySummaryBanner
                year={selectedYear || (availableYears[availableYears.length - 1] || '2026')}
                entries={daily}
                prevYearEntries={prevYearDaily}
                weatherData={weatherData}
                selectedCourse={selectedCourse}
                onPrevYear={() => navigateYear(-1)}
                onNextYear={hasNextYear ? () => navigateYear(1) : undefined}
              />
            )}
            {!isYearAllView && selectedMonthNum !== null && (
              <MonthlySummaryBanner
                year={selectedYear || (availableYears[availableYears.length - 1] || '2026')}
                month={selectedMonthNum}
                entries={daily}
                prevYearEntries={prevMonthDaily}
                weatherData={weatherData}
                selectedCourse={selectedCourse}
                onPrevMonth={() => navigateMonth(-1)}
                onNextMonth={hasNextMonth ? () => navigateMonth(1) : undefined}
                onPrevYear={() => navigateYear(-1)}
                onNextYear={hasNextYear ? () => navigateYear(1) : undefined}
                isAdmin={isAdmin}
              />
            )}

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

        {/* どのタブ・どの画面からでも共通で開く 日付詳細アナリティクス（オーバーレイ・モーダル） */}
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
      </main>
    </div>
  );
}

export default App;
