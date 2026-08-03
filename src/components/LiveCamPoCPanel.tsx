import React, { useState, useEffect } from 'react';
import { Video, AlertTriangle, CheckCircle2, Terminal, ShieldAlert, Cpu, RefreshCw, Camera, Image as ImageIcon } from 'lucide-react';

interface CustomLiveCam {
  id: string;
  name: string;
  videoId: string;
  desc: string;
}

const POC_CAMERAS: CustomLiveCam[] = [
  {
    id: 'oshidomari',
    name: '鴛泊（鴛泊）',
    videoId: '8BwfUCuPcVE',
    desc: '鴛泊エリアからの北側眺望カメラ'
  },
  {
    id: 'himenuma',
    name: '姫沼（逆さ利尻富士）',
    videoId: '_CTve3fF0W4',
    desc: '姫沼展望エリアからの逆さ富士・雲行きカメラ'
  },
  {
    id: 'otadomari',
    name: 'オタドマリ（南麓展望）',
    videoId: 'enBReBFAk7U',
    desc: 'オタドマリ沼側・南麓の山容と気流カメラ'
  }
];

interface PocResult {
  success?: boolean;
  path?: string;
  sizeKB?: number;
  capturedAt?: string;
  mode?: string;
  error?: string;
}

interface PocStatusJson {
  updatedAt: string;
  results: Record<string, PocResult>;
}

export const LiveCamPoCPanel: React.FC = () => {
  const [selectedCamId, setSelectedCamId] = useState<string>('oshidomari');
  const [isAllView, setIsAllView] = useState<boolean>(true);
  const [pocStatus, setPocStatus] = useState<PocStatusJson | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState<boolean>(false);
  const [lastReloaded, setLastReloaded] = useState<number>(Date.now());

  const activeCam = POC_CAMERAS.find(c => c.id === selectedCamId) || POC_CAMERAS[0];
  const displayCameras = isAllView ? POC_CAMERAS : [activeCam];

  // poc_status.json をフェッチしてコマンド実行結果を確認・反映する
  const loadPocStatus = async () => {
    setIsLoadingStatus(true);
    try {
      const res = await fetch(`/cams/test_poc_archive/poc_status.json?t=${Date.now()}`);
      if (res.ok) {
        const data: PocStatusJson = await res.json();
        setPocStatus(data);
      } else {
        setPocStatus(null);
      }
    } catch (err) {
      console.warn('poc_status.json ロードに失敗しました (未実行の可能性):', err);
      setPocStatus(null);
    } finally {
      setIsLoadingStatus(false);
      setLastReloaded(Date.now());
    }
  };

  useEffect(() => {
    loadPocStatus();
  }, []);

  return (
    <div className="card" style={{ borderTop: '4px solid #8b5cf6', marginBottom: '2rem' }}>
      {/* タイトル＆目的バッジ＆リロードボタン */}
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginBottom: '1.25rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <div style={{ backgroundColor: '#8b5cf6', color: '#fff', padding: '0.45rem', borderRadius: '0.5rem', display: 'flex' }}>
              <Terminal size={22} />
            </div>
            <h3 style={{ fontSize: '1.35rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
              🧪 カスタムサムネイル設定済みYouTubeライブ：実証実験 (PoC) 室
            </h3>
          </div>
          <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
            配信者により表紙サムネイルが設定されたYouTubeライブのキャプチャ挙動検証・技術実証パネル
          </p>
        </div>

        {/* リロード＆表示切り替えボタン */}
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            onClick={loadPocStatus}
            disabled={isLoadingStatus}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.5rem 1rem',
              borderRadius: '8px',
              border: '1px solid #8b5cf6',
              backgroundColor: '#8b5cf6',
              color: '#fff',
              fontWeight: 700,
              fontSize: '0.85rem',
              cursor: 'pointer',
              boxShadow: '0 2px 6px rgba(139, 92, 246, 0.35)'
            }}
          >
            <RefreshCw size={15} className={isLoadingStatus ? 'animate-spin' : ''} />
            <span>スクリプト撮影結果を再読込</span>
          </button>

          {!isAllView && POC_CAMERAS.map(cam => (
            <button
              key={cam.id}
              onClick={() => setSelectedCamId(cam.id)}
              style={{
                padding: '0.45rem 0.9rem',
                borderRadius: '8px',
                border: `1px solid ${selectedCamId === cam.id ? '#8b5cf6' : 'var(--border-color)'}`,
                backgroundColor: selectedCamId === cam.id ? '#8b5cf6' : 'var(--bg-secondary)',
                color: selectedCamId === cam.id ? '#fff' : 'var(--text-primary)',
                fontWeight: 700,
                fontSize: '0.85rem',
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              {cam.name.split('（')[0]}
            </button>
          ))}
          <button
            onClick={() => setIsAllView(!isAllView)}
            style={{
              padding: '0.45rem 0.9rem',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
              backgroundColor: isAllView ? 'var(--text-primary)' : 'var(--bg-secondary)',
              color: isAllView ? 'var(--bg-primary)' : 'var(--text-primary)',
              fontWeight: 700,
              fontSize: '0.85rem',
              cursor: 'pointer'
            }}
          >
            {isAllView ? '単一表示へ戻す' : '3地点 全並列実証モード'}
          </button>
        </div>
      </div>

      {/* 画面説明＆確認の仕組みボックス */}
      <div style={{
        padding: '1rem 1.25rem',
        backgroundColor: 'rgba(139, 92, 246, 0.08)',
        borderRadius: '10px',
        border: '1px solid rgba(139, 92, 246, 0.25)',
        marginBottom: '1.75rem',
        fontSize: '0.86rem',
        color: 'var(--text-primary)',
        lineHeight: 1.6
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 800, color: '#8b5cf6', marginBottom: '0.35rem' }}>
          <Camera size={18} />
          <span>この画面は「コマンド実験結果の反映・確認画面」に対応しています！</span>
        </div>
        <div>
          ターミナルで <code>node scripts/test_live_capture.mjs</code> を実行した後、右上の <strong>「🔄 スクリプト撮影結果を再読込」</strong> をクリックしてください。各カメラカードの一番右のカラム（<strong>実証C: スクリプトによる現在生ストリーム撮影結果</strong>）に、フォルダ (<code>public/cams/test_poc_archive/</code>) へ記録された本物のリアルタイム静止画アーカイブ (<code>.jpg</code>) が自動描画されます！
        </div>
      </div>

      {/* カメラごとの実験対比グリッド（3カラム構造） */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2.5rem', marginBottom: '2.5rem' }}>
        {displayCameras.map(cam => {
          const camResult = pocStatus?.results?.[cam.id];
          const hasImage = camResult?.success && camResult?.path;

          return (
            <div
              key={cam.id}
              style={{
                border: '1px solid var(--border-color)',
                borderRadius: '12px',
                backgroundColor: 'var(--bg-primary)',
                padding: '1.25rem',
                boxShadow: 'var(--shadow-sm)'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>
                <div>
                  <h4 style={{ fontSize: '1.15rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Video size={18} style={{ color: '#8b5cf6' }} />
                    <span>{cam.name}</span>
                    <span style={{ fontSize: '0.78rem', backgroundColor: 'var(--bg-secondary)', padding: '0.15rem 0.6rem', borderRadius: '4px', border: '1px solid var(--border-color)', fontWeight: 600 }}>
                      ID: {cam.videoId}
                    </span>
                  </h4>
                  <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{cam.desc}</p>
                </div>
              </div>

              {/* 3カラム実証グリッド */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: '1.25rem' }}>
                {/* 1. 左カラム: 公式画像APIエンドポイント（静的表紙が返る証明） */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 700, fontSize: '0.85rem', color: '#ef4444' }}>
                    <AlertTriangle size={16} />
                    <span>実証A: 公式画像 API (<code>img.youtube.com</code>)</span>
                  </div>
                  <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9', backgroundColor: '#000', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                    <img
                      src={`https://img.youtube.com/vi/${cam.videoId}/maxresdefault.jpg`}
                      alt={`${cam.name} 静的サムネイル`}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                    <div style={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      right: 0,
                      backgroundColor: 'rgba(0,0,0,0.85)',
                      color: '#f87171',
                      fontSize: '0.75rem',
                      padding: '0.4rem 0.65rem',
                      fontWeight: 700
                    }}>
                      ❌ 【静止画キャッシュ現象】 設定された表紙写真が固定で返り、天候や変化が一切反映されません。
                    </div>
                  </div>
                  <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                    いつでも「きれいな表紙のみ」が返される仕様証明
                  </div>
                </div>

                {/* 2. 中央カラム: 監視ミニマル iframe (生ストリームのリアルタイム挙動) */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 700, fontSize: '0.85rem', color: '#10b981' }}>
                    <CheckCircle2 size={16} />
                    <span>実証B: 監視 iframe (<code>?autoplay=1&mute=1</code>)</span>
                  </div>
                  <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9', backgroundColor: '#000', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                    <iframe
                      src={`https://www.youtube.com/embed/${cam.videoId}?autoplay=1&mute=1&controls=0&modestbranding=1&rel=0&playsinline=1`}
                      title={`${cam.name} 監視ライブ`}
                      style={{ width: '100%', height: '100%', border: 'none' }}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    />
                    <div style={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      right: 0,
                      backgroundColor: 'rgba(0, 0, 0, 0.75)',
                      color: '#4ade80',
                      fontSize: '0.75rem',
                      padding: '0.4rem 0.65rem',
                      fontWeight: 700,
                      pointerEvents: 'none'
                    }}>
                      🙆‍♂️ 【リアルタイム監視】 表紙写真をスキップし、現在の現地ストリーム動画が再生されます。
                    </div>
                  </div>
                  <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                    画面監視仕様: 表紙写真を回避して直接ストリームを表示
                  </div>
                </div>

                {/* 3. 右カラム: 実証C (★今回追加★): ターミナルスクリプトによる静止画保存・アーカイブ実証枠 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 700, fontSize: '0.85rem', color: '#8b5cf6' }}>
                    <Camera size={16} />
                    <span>実証C: スクリプト撮影結果 (<code>_latest.jpg</code>)</span>
                  </div>
                  <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9', backgroundColor: 'var(--bg-secondary)', borderRadius: '8px', overflow: 'hidden', border: '2px dashed #8b5cf6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {hasImage ? (
                      <>
                        <img
                          src={`${camResult.path}?t=${lastReloaded}`}
                          alt={`${cam.name} 実験キャプチャ画像`}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                        <div style={{
                          position: 'absolute',
                          bottom: 0,
                          left: 0,
                          right: 0,
                          backgroundColor: 'rgba(139, 92, 246, 0.9)',
                          color: '#fff',
                          fontSize: '0.75rem',
                          padding: '0.4rem 0.65rem',
                          fontWeight: 700,
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center'
                        }}>
                          <span>🎉 現地ストリーム現在撮影に成功! {camResult.mode === 'REAL_LIVE_STREAM' ? '(正真正銘の生フレーム)' : ''}</span>
                          <span style={{ fontSize: '0.7rem', opacity: 0.9 }}>
                            {camResult.sizeKB ? `${camResult.sizeKB} KB` : ''}
                          </span>
                        </div>
                      </>
                    ) : (
                      <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                        <ImageIcon size={32} style={{ margin: '0 auto 0.5rem auto', opacity: 0.5, color: '#8b5cf6' }} />
                        <p style={{ margin: '0 0 0.35rem 0', fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                          まだ撮影実験が実行されていません
                        </p>
                        <p style={{ margin: 0, fontSize: '0.72rem', lineHeight: 1.4 }}>
                          ターミナルで <code>node scripts/test_live_capture.mjs</code> を実行し、右上の「🔄 撮影結果を再読込」をクリックしてください。
                        </p>
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                    {hasImage ? (
                      <span style={{ color: '#10b981', fontWeight: 700 }}>
                        ✓ 保存済ファイル: <code>{camResult.path}</code> ({camResult.capturedAt ? new Date(camResult.capturedAt).toLocaleTimeString('ja-JP') : ''})
                      </span>
                    ) : (
                      <span>保存先予定: <code>/cams/test_poc_archive/{cam.id}_latest.jpg</code></span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* なぜJSで動画キャプチャできないか＆静止画アーカイブとして実験する方法 */}
      <div style={{
        padding: '1.5rem',
        backgroundColor: 'var(--bg-secondary)',
        borderRadius: '12px',
        border: '1px solid var(--border-color)'
      }}>
        <h4 style={{ fontSize: '1.1rem', fontWeight: 800, margin: '0 0 1rem 0', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Cpu size={20} style={{ color: '#8b5cf6' }} />
          <span>静止画・過去アーカイブとして蓄積・保存するための技術設計と実験ガイド</span>
        </h4>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem', marginBottom: '1.25rem' }}>
          <div>
            <h5 style={{ fontSize: '0.92rem', fontWeight: 700, margin: '0 0 0.5rem 0', color: '#ef4444', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <ShieldAlert size={16} />
              <span>なぜJSからの iframe 画面スクショは 100% 失敗するのか？</span>
            </h5>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>
              ブラウザは「同一オリジンポリシー (CORS)」に基づき、別ドメイン (<code>youtube.com</code>) の iframe 映像を JavaScript でキャプチャしようとすると、Canvas に <strong>「汚染 (Tainted)」フラグ</strong> を立てます。その状態で <code>canvas.toDataURL()</code> を実行するとセキュリティエラーが発生し、コードがブロックされます。
            </p>
          </div>

          <div>
            <h5 style={{ fontSize: '0.92rem', fontWeight: 700, margin: '0 0 0.5rem 0', color: '#10b981', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <CheckCircle2 size={16} />
              <span>どうすればストリームの「現在の1コマ」をファイル(.jpg)保存できるか？</span>
            </h5>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>
              静的なカスタム表紙とブラウザJS制限を乗り越えるには、<strong>バックエンドまたはコマンドライン（サーバーレス関数等）側で HLS (.m3u8) ストリームを直接叩いて 1フレームを抽出する</strong>構成が業界標準のソリューションになります。
            </p>
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1.25rem' }}>
          <h5 style={{ fontSize: '0.9rem', fontWeight: 700, margin: '0 0 0.6rem 0', color: 'var(--text-primary)' }}>
            🧪 実際に自分の環境で「現在ストリームからの静止画キャプチャ保存」を実験するコマンド仕様
          </h5>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
            以下は、サムネイル設定済みライブ（例: 鴛泊カメラ <code>8BwfUCuPcVE</code>）のストリーム URL を抽出して、いま現在の「生フレーム写真 (<code>.jpg</code>)」をフォルダに保存・蓄積するバッチ処理コマンドの実験仕様です。
          </p>
          <pre style={{
            backgroundColor: '#0f172a',
            color: '#38bdf8',
            padding: '1rem',
            borderRadius: '8px',
            fontSize: '0.82rem',
            overflowX: 'auto',
            margin: 0,
            border: '1px solid #1e293b',
            lineHeight: 1.5
          }}>
            <code>{`# [実験手順] yt-dlp + ffmpeg エンジンによる「リアルタイム 1コマ静止画 (.jpg)」抽出コマンド
# ① 鴛泊カメラ (8BwfUCuPcVE) からHLSストリームURLを取得し、最新1フレームをJPEG化して記録
ffmpeg -y -i $(yt-dlp -f best --get-url "https://www.youtube.com/watch?v=8BwfUCuPcVE") -vframes 1 -q:v 2 public/cams/test_poc_archive/oshidomari_latest.jpg

# ② 姫沼カメラ (_CTve3fF0W4) の現在の状況写真を保存
ffmpeg -y -i $(yt-dlp -f best --get-url "https://www.youtube.com/watch?v=_CTve3fF0W4") -vframes 1 -q:v 2 public/cams/test_poc_archive/himenuma_latest.jpg

# ③ オタドマリカメラ (enBReBFAk7U) の現在の状況写真を保存
ffmpeg -y -i $(yt-dlp -f best --get-url "https://www.youtube.com/watch?v=enBReBFAk7U") -vframes 1 -q:v 2 public/cams/test_poc_archive/otadomari_latest.jpg`}</code>
          </pre>
        </div>
      </div>
    </div>
  );
};
