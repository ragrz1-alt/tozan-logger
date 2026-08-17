// GitHub Pages URL (安定した画像配信CDNとして利用)
const GITHUB_RAW_BASE = 'https://ragrz1-alt.github.io/tozan-logger/public';

/**
 * クラウド上（GitHub）に保存された最新の history.json を直接取得するURLを返す
 */
export const getHistoryJsonUrl = () => {
  return `${GITHUB_RAW_BASE}/cams/history.json?t=${Date.now()}`;
};

/**
 * 画像パス（例: "cams/2026-07-28/13_oshidomari.jpg"）からGitHub Raw直リンクURLを返す
 */
export const getCamImageUrl = (relPath?: string) => {
  if (!relPath) return '';
  // すでに絶対URLの場合はそのまま返す
  if (relPath.startsWith('http://') || relPath.startsWith('https://')) {
    return relPath;
  }
  // 先頭スラッシュを取り除く
  const cleanPath = relPath.replace(/^\/+/, '');
  return `${GITHUB_RAW_BASE}/${cleanPath}`;
};
