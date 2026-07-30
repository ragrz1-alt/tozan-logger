import React from 'react';
import { X, Info, CloudRain, Mountain, Camera, Database, ShieldCheck } from 'lucide-react';

interface SystemInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SystemInfoModal: React.FC<SystemInfoModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '1rem',
        animation: 'fadeIn 0.2s ease-out'
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: 'var(--bg-primary)',
          color: 'var(--text-primary)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border-color)',
          maxWidth: '820px',
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.45)',
          display: 'flex',
          flexDirection: 'column'
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* モーダルヘッダー */}
        <div
          style={{
            padding: '1.25rem 1.5rem',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            position: 'sticky',
            top: 0,
            backgroundColor: 'var(--bg-primary)',
            zIndex: 10
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div
              style={{
                background: 'linear-gradient(135deg, #3b82f6, #10b981)',
                color: '#fff',
                padding: '0.5rem',
                borderRadius: '0.6rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 4px 10px rgba(59, 130, 246, 0.3)'
              }}
            >
              <Info size={22} />
            </div>
            <div>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 800, margin: 0 }}>
                利尻山統合解析システム・気象仕様 ＆ データ出典
              </h3>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0 }}>
                各種解析データの出典および自動クロス分析ロジックの公式ガイド
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              padding: '0.4rem',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s ease'
            }}
            title="閉じる"
          >
            <X size={22} />
          </button>
        </div>

        {/* モーダル本文 */}
        <div style={{ padding: '1.5rem 1.75rem', display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
          {/* 1. システム概要 */}
          <section>
            <h4 style={{
              fontSize: '1.05rem',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              color: 'var(--text-primary)',
              marginBottom: '0.75rem'
            }}>
              <Mountain size={18} color="#3b82f6" />
              <span>1. システム概要・登山カウンター解析</span>
            </h4>
            <p style={{ fontSize: '0.9rem', lineHeight: 1.6, color: 'var(--text-secondary)', margin: 0 }}>
              本システムは、利尻山の3大コース（<strong>鴛泊・沓形・仙法志</strong>）に設置された赤外線・定点通過カウンターのログデータを集約し、日付および時間帯（24時間）単位での「入山者・下山者」の動向を高精度に可視化します。クラウド同期により、誰でも最新の統計データおよび気象影響をシームレスに確認可能です。
            </p>
          </section>

          {/* 2. 気象データの情報源（出典）とクロス分析 */}
          <section>
            <h4 style={{
              fontSize: '1.05rem',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              color: 'var(--text-primary)',
              marginBottom: '0.75rem'
            }}>
              <CloudRain size={18} color="#10b981" />
              <span>2. 気象データの情報源（ソース）について</span>
            </h4>
            <div style={{
              padding: '1rem',
              backgroundColor: 'var(--bg-secondary)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-color)',
              marginBottom: '1rem'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, fontSize: '0.92rem', color: 'var(--text-primary)', marginBottom: '0.4rem' }}>
                <ShieldCheck size={16} color="#10b981" />
                <span>気象庁（JMA）準拠 Open-Meteo 公式データ</span>
              </div>
              <p style={{ fontSize: '0.86rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>
                気象データはすべて、国際気象オープンデータプラットフォーム <strong>Open-Meteo</strong> を介した、<strong>気象庁（JMA）メソ数値予報モデル（MSM）およびアメダス実地観測解析データ (<code>models=jma_msm</code>)</strong> をリアルタイムおよびアーカイブから取得しています。
              </p>
            </div>

            <h5 style={{ fontSize: '0.95rem', fontWeight: 700, margin: '0 0 0.6rem 0', color: 'var(--text-primary)' }}>
              🎯 「沓形 × 本泊」気象庁アメダスの複合クロス分析
            </h5>
            <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 0.85rem 0' }}>
              利尻山は島の中央に位置する独立峰であり、<strong>西側（沓形）と北・東側（鴛泊/本泊）で風や雨の降り方が劇的に異なる</strong>特徴があります。片方だけのデータでは悪天候を見落とすため、本システムでは<strong>「沓形アメダス」と「本泊アメダス」の双方を同時取得し、安全側に立った複合クロス分析</strong>を自動で行っています。
            </p>

            {/* 仕様解説テーブル */}
            <div style={{ overflowX: 'auto' }}>
              <table style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: '0.86rem',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)'
              }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--bg-secondary)', borderBottom: '2px solid var(--border-color)' }}>
                    <th style={{ padding: '0.65rem 0.85rem', textAlign: 'left', width: '28%' }}>気象項目</th>
                    <th style={{ padding: '0.65rem 0.85rem', textAlign: 'left', width: '36%' }}>クロス分析採用ルール</th>
                    <th style={{ padding: '0.65rem 0.85rem', textAlign: 'left' }}>仕様意図・アラート機能</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '0.65rem 0.85rem', fontWeight: 700 }}>降水量 (日 / 時間)</td>
                    <td style={{ padding: '0.65rem 0.85rem', fontWeight: 600, color: '#3b82f6' }}>沓形と本泊の「多い方（最大値）」</td>
                    <td style={{ padding: '0.65rem 0.85rem', color: 'var(--text-secondary)' }}>
                      島内のどちらかで強い雨/雪があれば山岳部も雨天と判断。日降水量20mm以上で「大雨・荒天アラート」判定。
                    </td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)' }}>
                    <td style={{ padding: '0.65rem 0.85rem', fontWeight: 700 }}>風向 / 風速 (m/s)</td>
                    <td style={{ padding: '0.65rem 0.85rem', fontWeight: 600, color: '#f97316' }}>風速が「強い側」の風速値＆風向16方位</td>
                    <td style={{ padding: '0.65rem 0.85rem', color: 'var(--text-secondary)' }}>
                      登山リスクとなる最強風速を評価。風速10m/s以上でオレンジ、15m/s以上で赤色警告アイコンを自動表示。
                    </td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '0.65rem 0.85rem', fontWeight: 700 }}>日照時間 / 気温</td>
                    <td style={{ padding: '0.65rem 0.85rem', fontWeight: 600 }}>沓形と本泊の「平均値」</td>
                    <td style={{ padding: '0.65rem 0.85rem', color: 'var(--text-secondary)' }}>
                      利尻島全体の全体気候傾向および基礎気温基準として算出。
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* 3. ライブカメラアーカイブと同期 */}
          <section>
            <h4 style={{
              fontSize: '1.05rem',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              color: 'var(--text-primary)',
              marginBottom: '0.75rem'
            }}>
              <Camera size={18} color="#f59e0b" />
              <span>3. 利尻山 ライブカメラ記録連携</span>
            </h4>
            <p style={{ fontSize: '0.9rem', lineHeight: 1.6, color: 'var(--text-secondary)', margin: 0 }}>
              定時（30分〜1時間単位）ごとに、鴛泊・沓形・仙法志の各カメラ（沓形は利尻町公式30分更新静止画カメラ）の映像を自動でスクリーンショット撮影・アーカイブ保管しています。「時間帯別テーブル」や「アーカイブ一覧」から、過去の特定の時刻に山頂が雲に覆われていたかなどの実際の状況を映像と数値で照合できます。
            </p>
          </section>

          {/* 4. クラウド同期ボタンの使い方 */}
          <section style={{
            padding: '1.1rem',
            backgroundColor: 'rgba(59, 130, 246, 0.05)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid rgba(59, 130, 246, 0.2)'
          }}>
            <h4 style={{
              fontSize: '0.95rem',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              color: '#3b82f6',
              margin: '0 0 0.45rem 0'
            }}>
              <Database size={16} />
              <span>「☁️ クラウド同期」ボタンとは？（いつ使う？）</span>
            </h4>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>
              他の管理者が新しい <code>.LOG</code> データをアップロードした際や、別の端末・ブラウザから本ページを開いた際に、<strong>クラウド上のデータベース (Firebase Cloud Firestore) から最新の登山データを一括で再読み込み・更新したいとき</strong>にクリックするボタンです。（通常、ページを開いた時点でデータは表示されますが、手動でいつでも最新状態に強制リロードできます）
            </p>
          </section>
        </div>

        {/* モーダル枠下部閉じるボタン */}
        <div style={{
          padding: '1rem 1.75rem',
          borderTop: '1px solid var(--border-color)',
          display: 'flex',
          justifyContent: 'flex-end',
          backgroundColor: 'var(--bg-secondary)',
          borderRadius: '0 0 var(--radius-lg) var(--radius-lg)'
        }}>
          <button
            onClick={onClose}
            className="button button-primary"
            style={{
              padding: '0.55rem 1.5rem',
              fontWeight: 700,
              fontSize: '0.9rem',
              cursor: 'pointer'
            }}
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
};
