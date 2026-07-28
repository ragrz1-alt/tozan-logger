import React, { useState, useEffect } from 'react';
import { Lock, Unlock, CheckCircle, X, AlertCircle } from 'lucide-react';

interface AdminModalProps {
  isOpen: boolean;
  onClose: () => void;
  isAdmin: boolean;
  onUnlock: () => void;
  onLock: () => void;
}

const ADMIN_PASS_KEY = 'tozan_admin_passcode_v1';
const DEFAULT_PASSCODE = 'rishiri';

export const AdminModal: React.FC<AdminModalProps> = ({
  isOpen,
  onClose,
  isAdmin,
  onUnlock,
  onLock,
}) => {
  const [inputPass, setInputPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [error, setError] = useState('');
  const [isChangingPass, setIsChangingPass] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    if (isOpen) {
      setInputPass('');
      setError('');
      setSuccessMsg('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const getSavedPasscode = () => {
    return localStorage.getItem(ADMIN_PASS_KEY) || DEFAULT_PASSCODE;
  };

  const handleUnlock = (e: React.FormEvent) => {
    e.preventDefault();
    const saved = getSavedPasscode();
    if (inputPass === saved) {
      onUnlock();
      onClose();
    } else {
      setError('パスコードが正しくありません');
    }
  };

  const handleChangePasscode = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPass.trim() || newPass.trim().length < 4) {
      setError('パスコードは4文字以上で設定してください');
      return;
    }
    localStorage.setItem(ADMIN_PASS_KEY, newPass.trim());
    setSuccessMsg('管理者パスコードを変更しました');
    setNewPass('');
    setError('');
    setTimeout(() => {
      setIsChangingPass(false);
      setSuccessMsg('');
    }, 1500);
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.65)',
      backdropFilter: 'blur(4px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 99999,
      padding: '1rem'
    }}>
      <div className="card" style={{
        width: '100%',
        maxWidth: '420px',
        padding: '1.75rem',
        borderRadius: '16px',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3)',
        position: 'relative'
      }}>
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '1.25rem',
            right: '1.25rem',
            background: 'none',
            border: 'none',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            padding: '0.25rem'
          }}
        >
          <X size={20} />
        </button>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          marginBottom: '1.25rem'
        }}>
          <div style={{
            padding: '0.65rem',
            borderRadius: '12px',
            backgroundColor: isAdmin ? 'rgba(16, 185, 129, 0.15)' : 'rgba(59, 130, 246, 0.15)',
            color: isAdmin ? '#10b981' : '#3b82f6',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            {isAdmin ? <Unlock size={22} /> : <Lock size={22} />}
          </div>
          <div>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
              {isAdmin ? '管理者権限 (認証済み)' : '管理者ログイン (権限ロック解除)'}
            </h2>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0 }}>
              {isAdmin
                ? 'データ追加・編集・リセット・クラウド保存が可能です。'
                : 'ログ追加やリセットを行うには管理パスコードを入力してください。'}
            </p>
          </div>
        </div>

        {isAdmin ? (
          <div>
            <div style={{
              padding: '1rem',
              borderRadius: '10px',
              backgroundColor: 'rgba(16, 185, 129, 0.1)',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              color: '#10b981',
              display: 'flex',
              alignItems: 'center',
              gap: '0.6rem',
              marginBottom: '1.25rem',
              fontWeight: 600,
              fontSize: '0.9rem'
            }}>
              <CheckCircle size={18} />
              <span>管理者モードが有効です（ログの追加・リセット・クラウド保存が可能）</span>
            </div>

            {!isChangingPass ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <button
                  onClick={() => {
                    onLock();
                    onClose();
                  }}
                  className="button button-secondary"
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    color: '#ef4444',
                    borderColor: '#ef4444'
                  }}
                >
                  <Lock size={16} />
                  <span>閲覧専用モードへ戻す (権限ロック)</span>
                </button>
                <button
                  onClick={() => setIsChangingPass(true)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-secondary)',
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    padding: '0.4rem'
                  }}
                >
                  管理者パスコードを変更する
                </button>
              </div>
            ) : (
              <form onSubmit={handleChangePasscode} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  新しいパスコード (4文字以上)
                </label>
                <input
                  type="password"
                  value={newPass}
                  onChange={(e) => setNewPass(e.target.value)}
                  placeholder="新しいパスコードを入力..."
                  className="input"
                  style={{
                    padding: '0.65rem 0.85rem',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-primary)',
                    color: 'var(--text-primary)',
                    fontSize: '0.95rem'
                  }}
                />
                {error && (
                  <p style={{ color: '#ef4444', fontSize: '0.85rem', margin: 0 }}>{error}</p>
                )}
                {successMsg && (
                  <p style={{ color: '#10b981', fontSize: '0.85rem', margin: 0, fontWeight: 600 }}>{successMsg}</p>
                )}
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                  <button type="submit" className="button button-primary" style={{ flex: 1, padding: '0.6rem' }}>
                    変更を保存
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsChangingPass(false);
                      setError('');
                    }}
                    className="button button-secondary"
                    style={{ flex: 1, padding: '0.6rem' }}
                  >
                    キャンセル
                  </button>
                </div>
              </form>
            )}
          </div>
        ) : (
          <form onSubmit={handleUnlock} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label style={{
                display: 'block',
                fontSize: '0.85rem',
                fontWeight: 600,
                color: 'var(--text-primary)',
                marginBottom: '0.4rem'
              }}>
                管理者パスコード
              </label>
              <input
                type="password"
                value={inputPass}
                onChange={(e) => setInputPass(e.target.value)}
                placeholder="パスコードを入力..."
                autoFocus
                className="input"
                style={{
                  width: '100%',
                  padding: '0.75rem 1rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  fontSize: '1rem'
                }}
              />
            </div>

            {error && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                color: '#ef4444',
                fontSize: '0.85rem',
                fontWeight: 600
              }}>
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              className="button button-primary"
              style={{
                width: '100%',
                padding: '0.75rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                fontWeight: 700,
                fontSize: '0.95rem'
              }}
            >
              <Unlock size={18} />
              <span>管理者モードのロックを解除</span>
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
