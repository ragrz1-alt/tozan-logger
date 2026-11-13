import { getHistoryJsonUrl } from './camUrl';

export type CameraHealthStatus =
  | 'active'
  | 'seasonal_closed'
  | 'monitoring'
  | 'offline'
  | 'blackout';

export interface CameraStatusEntry {
  status: CameraHealthStatus;
  health?: string;
  since?: string;
  note?: string;
  lastValidAt?: string | null;
  lastCheckedAt?: string;
  recoveredAt?: string;
  updatedAt?: string;
}

export interface CamHistory {
  updatedAt: string;
  cameras: Record<string, { name: string; videoId: string; url: string; customThumbnail?: boolean }>;
  cameraStatus?: Record<string, CameraStatusEntry>;
  records: Record<string, Record<string, Record<string, string>>>;
}

export interface InactiveCameraInfo<T> {
  camera: T;
  status: CameraHealthStatus;
  badgeText: string;
  reasonText: string;
  lastValidAt?: string | null;
  since?: string;
}

export interface PartitionedCameras<T> {
  visible: T[];
  inactive: InactiveCameraInfo<T>[];
}

/**
 * GitHub Pages CDN → ローカル静的ファイル の順で最新の history.json を取得する
 */
export async function fetchCamHistory(): Promise<CamHistory | null> {
  try {
    let res = await fetch(getHistoryJsonUrl());
    if (!res.ok) {
      res = await fetch('/cams/history.json?t=' + Date.now());
    }
    if (res.ok) {
      return (await res.json()) as CamHistory;
    }
  } catch (err) {
    console.warn('history.json のロードに失敗しました:', err);
  }
  return null;
}

/**
 * 対象日（または特定時間帯）に表示すべき「稼働中カメラ」と「休止・調整中カメラ」を仕分ける共通関数。
 * - 既に実画像が記録されているカメラは、その時点では稼働していたため必ず visible に含める。
 * - seasonal_closed / monitoring / blackout / offline のカメラで対象日・時刻に実画像がない場合は inactive へ退避し、
 *   メイングリッドから真っ暗・未記録枠を排除する。
 */
export function partitionCamerasForDisplay<T extends { id: string; isCore?: boolean }>(
  allCameras: T[],
  options: {
    dateStr?: string;
    history?: CamHistory | null;
    recordedCamIds?: Set<string>;
    selectedHour?: string;
  }
): PartitionedCameras<T> {
  const { dateStr, history, recordedCamIds, selectedHour } = options;
  const statusMap = history?.cameraStatus || {};

  // 2026-10-28 13時以前（6地点拡張前）の旧3地点期間は、当時存在していたコアカメラ＋実記録のみを対象とする
  const isLegacyThreeCamPeriod = Boolean(
    dateStr &&
      (dateStr < '2026-10-28' ||
        (dateStr === '2026-10-28' &&
          selectedHour !== undefined &&
          parseInt(selectedHour, 10) <= 13 &&
          !recordedCamIds?.has('ferry')))
  );

  const candidateCameras = isLegacyThreeCamPeriod
    ? allCameras.filter(c => c.isCore || recordedCamIds?.has(c.id))
    : allCameras;

  const visible: T[] = [];
  const inactive: InactiveCameraInfo<T>[] = [];

  for (const cam of candidateCameras) {
    const hasRecordedImage = Boolean(recordedCamIds?.has(cam.id));
    if (hasRecordedImage) {
      visible.push(cam);
      continue;
    }

    const stEntry = statusMap[cam.id];
    const st = stEntry?.status;
    const isAfterSince = !dateStr || !stEntry?.since || dateStr >= stEntry.since;

    if (st === 'seasonal_closed' && isAfterSince) {
      inactive.push({
        camera: cam,
        status: 'seasonal_closed',
        badgeText: '❄️ 冬季終了',
        reasonText: stEntry?.note || '冬季配信終了のため休止中',
        lastValidAt: stEntry?.lastValidAt,
        since: stEntry?.since,
      });
      continue;
    }

    if ((st === 'monitoring' || st === 'blackout') && isAfterSince) {
      inactive.push({
        camera: cam,
        status: st,
        badgeText: '🔧 調整中・復旧待ち',
        reasonText: stEntry?.note || '配信側の映像不具合につき復旧待ち（回復次第自動復帰）',
        lastValidAt: stEntry?.lastValidAt,
        since: stEntry?.since,
      });
      continue;
    }

    if (st === 'offline' && !isLegacyThreeCamPeriod) {
      // 最新日または現在表示時に実記録がない場合のみ一時停止扱い
      const latestRecordedDate = history?.records
        ? Object.keys(history.records).sort().reverse()[0]
        : undefined;
      if (!dateStr || !latestRecordedDate || dateStr >= latestRecordedDate) {
        inactive.push({
          camera: cam,
          status: 'offline',
          badgeText: '⚠️ 一時配信停止',
          reasonText: stEntry?.note || '配信一時停止中または取得失敗（復旧確認中）',
          lastValidAt: stEntry?.lastValidAt,
          since: stEntry?.since,
        });
        continue;
      }
    }

    visible.push(cam);
  }

  return { visible, inactive };
}

/**
 * ブラウザ側 Canvas を用いた簡易ブラックアウト / 単色エラー画面検出
 * (撮影スクリプトの閾値と揃え、暗転画像が Gemini API に送信されるのを防ぐ)
 */
export async function detectImageBlackoutFromDataUrl(
  base64Data: string,
  mimeType: string = 'image/jpeg'
): Promise<{ isInvalid: boolean; reason: string }> {
  return new Promise(resolve => {
    try {
      const img = new Image();
      img.onload = () => {
        try {
          // 160x90 に縮小サンプリングして高速判定
          const w = 160;
          const h = 90;
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve({ isInvalid: false, reason: 'ok' });
            return;
          }
          ctx.drawImage(img, 0, 0, w, h);
          const data = ctx.getImageData(0, 0, w, h).data;
          const n = w * h;
          const lums = new Float32Array(n);
          let sum = 0;
          let sumSq = 0;
          for (let i = 0, p = 0; i < data.length; i += 4, p++) {
            const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            lums[p] = y;
            sum += y;
            sumSq += y * y;
          }
          const mean = sum / n;
          const std = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
          lums.sort();
          const p99 = lums[Math.min(n - 1, Math.floor(n * 0.99))];

          if (p99 <= 55 && mean <= 35 && std <= 8.0) {
            resolve({
              isInvalid: true,
              reason: `カメラ映像暗転・無信号検出 (mean=${mean.toFixed(1)}, p99=${p99.toFixed(0)}, std=${std.toFixed(1)})`,
            });
            return;
          }
          if (std <= 3.0) {
            resolve({
              isInvalid: true,
              reason: `単色エラー画面検出 (mean=${mean.toFixed(1)}, std=${std.toFixed(1)})`,
            });
            return;
          }
          resolve({ isInvalid: false, reason: 'ok' });
        } catch {
          resolve({ isInvalid: false, reason: 'ok' });
        }
      };
      img.onerror = () => resolve({ isInvalid: false, reason: 'ok' });
      img.src = `data:${mimeType};base64,${base64Data}`;
    } catch {
      resolve({ isInvalid: false, reason: 'ok' });
    }
  });
}
