#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
利尻山 ライブカメラ（全6地点：鴛泊本泊・鴛泊港フェリー・姫沼・沓形・オタドマリ沼・仙法志）
定時撮影＆アーカイブ記録スクリプト（季節別日照スケジュール＆無料枠容量最適化対応）

利用目的:
- YouTube Live および利尻町公式カメラから最新フレームを抽出・取得し、
  public/cams/YYYY-MM-DD/HH_<course>.jpg に記録します。
- カスタムサムネイル設定済みカメラ（鴛泊港・姫沼・オタドマリ沼）は、
  yt-dlp/ffmpeg または Playwright 仮想ドメイン iframe + Canvas 生フレーム抽出により、
  固定サムネイルやYouTube UIが一切混入しない純粋なライブ映像のみを記録します。
- 撮影履歴およびメタデータを public/cams/history.json に登録・更新します。
"""

import os
import sys
import json
import subprocess
import urllib.request
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, timedelta

# 日本標準時 (JST)
JST = timezone(timedelta(hours=9))

# 6地点カメラ定義
CAMERAS = {
    "oshidomari": {
        "name": "鴛泊（本泊・北）",
        "videoId": "bAWueJBFcT0",
        "url": "https://www.youtube.com/watch?v=bAWueJBFcT0",
        "customThumbnail": False
    },
    "ferry": {
        "name": "鴛泊港（フェリー・北）",
        "videoId": "8BwfUCuPcVE",
        "url": "https://www.youtube.com/watch?v=8BwfUCuPcVE",
        "customThumbnail": True
    },
    "himenuma": {
        "name": "姫沼（北東）",
        "videoId": "wL2i45IZfvs",
        "url": "https://www.youtube.com/watch?v=wL2i45IZfvs",
        "customThumbnail": True
    },
    "kutsugata": {
        "name": "沓形（西）",
        "videoId": "",
        "url": "https://rishiri-town.jp/wp-content/themes/rishiri/images/MtRishiri/mt-rishiri.jpg",
        "customThumbnail": False
    },
    "otadomari": {
        "name": "オタドマリ沼（南東）",
        "videoId": "enBReBFAk7U",
        "url": "https://www.youtube.com/watch?v=enBReBFAk7U",
        "customThumbnail": True
    },
    "senposhi": {
        "name": "仙法志（御崎・南）",
        "videoId": "5BG3KJVFRVM",
        "url": "https://www.youtube.com/watch?v=5BG3KJVFRVM",
        "customThumbnail": False
    }
}

def get_project_root():
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def get_seasonal_solar_range(month):
    """
    利尻島（北緯45.18度）の季節別日出・薄明・日没に合わせた撮影時間レンジ (start_hour, end_hour)
    - 5〜7月（夏至・長日照期）: 03:00 〜 21:00 (19回/日)
    - 8月（盛夏後半）:         04:00 〜 20:00 (17回/日)
    - 3〜4月・9〜10月（春秋）: 04:00 〜 18:00 (15回/日)
    - 11〜2月（冬期）:         06:00 〜 17:00 (12回/日)
    """
    if month in (5, 6, 7):
        return 3, 21
    if month == 8:
        return 4, 20
    if month in (3, 4, 9, 10):
        return 4, 18
    return 6, 17

def is_within_seasonal_solar_hours(dt_jst):
    start_h, end_h = get_seasonal_solar_range(dt_jst.month)
    return start_h <= dt_jst.hour <= end_h

def ensure_compressed_image(image_path, max_bytes=58000):
    """
    保存された画像ファイルサイズを確認し、約58KB以下に高精細・軽量最適化する（無料枠6地点運用ガード）
    """
    try:
        if not os.path.exists(image_path):
            return
        size = os.path.getsize(image_path)
        if size > max_bytes:
            for q in [4, 6, 8, 10, 12]:
                tmp_path = image_path + ".tmp.jpg"
                cmd = [
                    "ffmpeg", "-y",
                    "-i", image_path,
                    "-vf", "scale=800:-1",
                    "-q:v", str(q),
                    tmp_path
                ]
                res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15)
                if res.returncode == 0 and os.path.exists(tmp_path) and os.path.getsize(tmp_path) > 1000:
                    tmp_size = os.path.getsize(tmp_path)
                    os.replace(tmp_path, image_path)
                    print(f" -> [容量最適化 q={q}] {size} bytes => {tmp_size} bytes")
                    size = tmp_size
                    if tmp_size <= max_bytes:
                        break
            if size > max_bytes:
                for w in [640, 560]:
                    tmp_path = image_path + ".tmp.jpg"
                    cmd = [
                        "ffmpeg", "-y",
                        "-i", image_path,
                        "-vf", f"scale={w}:-1",
                        "-q:v", "6",
                        tmp_path
                    ]
                    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15)
                    if res.returncode == 0 and os.path.exists(tmp_path) and os.path.getsize(tmp_path) > 1000:
                        tmp_size = os.path.getsize(tmp_path)
                        os.replace(tmp_path, image_path)
                        print(f" -> [解像度最適化 w={w}] {size} bytes => {tmp_size} bytes")
                        size = tmp_size
                        if tmp_size <= max_bytes:
                            break
    except Exception as e:
        print(f"[WARN] 画像圧縮処理例外: {e}")

def capture_with_ytdlp_url(video_url, output_path, format_selector="best[protocol^=m3u8]/301/300/96/95/94/93/best"):
    try:
        if os.path.exists(output_path):
            try:
                os.remove(output_path)
            except Exception:
                pass
        res = subprocess.run(
            ["yt-dlp", "-f", format_selector, "-g", video_url],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=25
        )
        if res.returncode != 0 or not res.stdout.strip():
            return False
        
        stream_url = res.stdout.strip().splitlines()[0]
        if not stream_url:
            return False
        
        cmd = [
            "ffmpeg", "-y",
            "-rw_timeout", "15000000",
            "-i", stream_url,
            "-vframes", "1",
            "-vf", "scale=800:-1",
            "-q:v", "4",
            output_path
        ]
        ffmpeg_res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
        if ffmpeg_res.returncode == 0 and os.path.exists(output_path) and os.path.getsize(output_path) > 1500:
            print(" -> [STREAM_SCREENSHOT] yt-dlp/ffmpeg でリアルタイム撮影成功")
            return True
        return False
    except Exception:
        return False

def capture_with_ytdlp_client_args(video_url, output_path, format_selector="best[protocol^=m3u8]/best"):
    try:
        if os.path.exists(output_path):
            try:
                os.remove(output_path)
            except Exception:
                pass
        res = subprocess.run(
            ["yt-dlp", "-f", format_selector, "--extractor-args", "youtube:player_client=ios,android,web", "-g", video_url],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=25
        )
        if res.returncode != 0 or not res.stdout.strip():
            return False
        stream_url = res.stdout.strip().splitlines()[0]
        if not stream_url:
            return False
        cmd = [
            "ffmpeg", "-y",
            "-rw_timeout", "15000000",
            "-i", stream_url,
            "-vframes", "1",
            "-vf", "scale=800:-1",
            "-q:v", "4",
            output_path
        ]
        ffmpeg_res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
        if ffmpeg_res.returncode == 0 and os.path.exists(output_path) and os.path.getsize(output_path) > 1500:
            print(" -> [STREAM_SCREENSHOT] yt-dlp(--extractor-args)/ffmpeg で撮影成功")
            return True
        return False
    except Exception:
        return False

def capture_with_streamlink(video_url, output_path):
    try:
        res = subprocess.run(
            ["streamlink", "--stream-url", video_url, "best,720p,480p,360p,worst"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=20
        )
        if res.returncode != 0 or not res.stdout.strip():
            return False
        stream_url = res.stdout.strip().splitlines()[0]
        if not stream_url:
            return False
        cmd = [
            "ffmpeg", "-y",
            "-rw_timeout", "15000000",
            "-i", stream_url,
            "-vframes", "1",
            "-vf", "scale=800:-1",
            "-q:v", "4",
            output_path
        ]
        ffmpeg_res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
        if ffmpeg_res.returncode == 0 and os.path.exists(output_path) and os.path.getsize(output_path) > 1500:
            print(" -> [STREAM_SCREENSHOT] streamlink/ffmpeg でリアルタイム撮影成功")
            return True
        return False
    except Exception:
        return False

def capture_with_playwright_iframe(video_id, output_path):
    """
    カスタムサムネイル設定済みカメラ（およびクラウドIPでyt-dlpがブロックされた場合）向けに、
    Playwright 仮想ドメイン iframe 埋め込み + HTML5 <video> -> <canvas> から直接生フレームを抽出する
    """
    try:
        root_dir = get_project_root()
        script_path = os.path.join(root_dir, "scripts", "capture_youtube_iframe.mjs")
        if not os.path.exists(script_path):
            return False
        res = subprocess.run(
            ["node", script_path, video_id, output_path],
            cwd=root_dir,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=45
        )
        if res.returncode == 0 and os.path.exists(output_path) and os.path.getsize(output_path) > 1500:
            print(f" -> [PLAYWRIGHT_CANVAS] 仮想ドメインiframeから純粋ライブ映像抽出成功 ({os.path.getsize(output_path)} bytes)")
            return True
        else:
            err_msg = (res.stderr or res.stdout or "").strip()
            if err_msg:
                print(f" -> [PLAYWRIGHT_CANVAS WARN] {err_msg[:180]}")
        return False
    except Exception as e:
        print(f"[WARN] Playwright iframe キャプチャ失敗 ({video_id}): {e}")
        return False

def capture_stream_frame(video_url, output_path):
    if capture_with_ytdlp_url(video_url, output_path, "best[protocol^=m3u8]/301/300/96/95/94/93/best"):
        return True
    if capture_with_ytdlp_client_args(video_url, output_path, "best[protocol^=m3u8]/best"):
        return True
    if capture_with_streamlink(video_url, output_path):
        return True
    return False

def capture_fallback_thumbnail(video_id, output_path):
    """
    カスタムサムネイルが設定されていないライブ配信（oshidomari, senposhi）専用の
    YouTubeリアルタイム更新サムネイル (_live.jpg) フォールバック
    """
    live_thumb_urls = [
        f"https://i.ytimg.com/vi/{video_id}/maxresdefault_live.jpg",
        f"https://i.ytimg.com/vi/{video_id}/sddefault_live.jpg",
        f"https://i.ytimg.com/vi/{video_id}/hqdefault_live.jpg",
        f"https://i.ytimg.com/vi/{video_id}/mqdefault_live.jpg",
    ]
    for url in live_thumb_urls:
        try:
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
            )
            with urllib.request.urlopen(req, timeout=15) as res:
                data = res.read()
                if len(data) > 1000:
                    with open(output_path, "wb") as f:
                        f.write(data)
                    print(f" -> [REALTIME_THUMBNAIL] リアルタイムサムネイル保存成功: {url} ({len(data)} bytes)")
                    return True
        except Exception:
            continue

    print(f" -> [ERROR] ストリーム及びリアルタイムサムネイル (_live.jpg) の取得に失敗。(videoId={video_id})")
    return False

def capture_static_image(image_url, output_path):
    try:
        if os.path.exists(output_path):
            try:
                os.remove(output_path)
            except Exception:
                pass
        target_url = f"{image_url}?t={int(datetime.now(JST).timestamp())}"
        req = urllib.request.Request(
            target_url,
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
        )
        with urllib.request.urlopen(req, timeout=15) as res:
            data = res.read()
            if len(data) > 1000:
                with open(output_path, "wb") as f:
                    f.write(data)
                print(f" -> [STATIC_IMAGE] 公式静止画カメラ保存成功 ({len(data)} bytes)")
                return True
    except Exception as e:
        print(f"[WARN] 静止画ダウンロード失敗 ({image_url}): {e}")
    return False

def process_camera(course_id, info, target_dir, date_str, hour_str, force=False):
    img_name = f"{hour_str}_{course_id}.jpg"
    img_path = os.path.join(target_dir, img_name)
    rel_path = f"cams/{date_str}/{img_name}"

    print(f"[{course_id}] ({info['name']}) リアルタイム撮影試行中...")

    if not info.get("videoId") or info.get("url", "").lower().endswith(".jpg"):
        success = capture_static_image(info["url"], img_path)
    else:
        video_id = info["videoId"]
        is_custom_thumb = bool(info.get("customThumbnail", False))

        # 1. まず高速な yt-dlp / streamlink + ffmpeg による直接HLS抽出を試行
        success = capture_stream_frame(info["url"], img_path)

        # 2. クラウドIP等でyt-dlpが弾かれた場合は Playwright 仮想ドメイン iframe + Canvas で生フレーム抽出
        if not success:
            print(f"[{course_id}] Playwright 仮想ドメイン iframe + Canvas 生フレーム抽出を実行中...")
            success = capture_with_playwright_iframe(video_id, img_path)

        # 3. カスタムサムネイル未設定のカメラ（oshidomari, senposhi）のみ _live.jpg フォールバックを許可
        if not success and not is_custom_thumb:
            print(f"[{course_id}] リアルタイムサムネイル (_live.jpg) でフォールバック中...")
            success = capture_fallback_thumbnail(video_id, img_path)

    if success and os.path.exists(img_path) and os.path.getsize(img_path) > 1000:
        ensure_compressed_image(img_path)
        print(f" -> 成功: {rel_path} ({os.path.getsize(img_path)} bytes)")
        return course_id, True, rel_path
    else:
        print(f" -> 失敗: {course_id} の画像取得ができませんでした。")
        return course_id, False, None

def sync_existing_files_to_history(cams_dir, history_file, now_jst, target_date_str=None):
    """
    public/cams/YYYY-MM-DD/ 内の実ファイルから history.json を安全に再同期する（git pull競合復旧用）
    """
    history_data = {
        "updatedAt": now_jst.isoformat(),
        "cameras": CAMERAS,
        "records": {}
    }
    if os.path.exists(history_file):
        try:
            with open(history_file, "r", encoding="utf-8") as f:
                loaded = json.load(f)
                if isinstance(loaded, dict):
                    history_data["records"] = loaded.get("records", {})
        except Exception as e:
            print(f"[WARN] history.json 読み込み失敗: {e}")

    dates_to_scan = [target_date_str] if target_date_str else sorted(
        d for d in os.listdir(cams_dir)
        if os.path.isdir(os.path.join(cams_dir, d)) and len(d) == 10 and d.startswith("202")
    )

    for d_str in dates_to_scan:
        d_dir = os.path.join(cams_dir, d_str)
        if not os.path.isdir(d_dir):
            continue
        if d_str not in history_data["records"]:
            history_data["records"][d_str] = {}
        for fname in sorted(os.listdir(d_dir)):
            if not fname.endswith(".jpg") or "_" not in fname:
                continue
            hr_part, rest = fname.split("_", 1)
            cam_id = rest[:-4] # remove .jpg
            if len(hr_part) == 2 and hr_part.isdigit():
                if hr_part not in history_data["records"][d_str]:
                    history_data["records"][d_str][hr_part] = {"timestamp": now_jst.isoformat()}
                history_data["records"][d_str][hr_part][cam_id] = f"cams/{d_str}/{fname}"

    history_data["cameras"] = CAMERAS
    history_data["updatedAt"] = now_jst.isoformat()
    with open(history_file, "w", encoding="utf-8") as f:
        json.dump(history_data, f, ensure_ascii=False, indent=2)
    print(f"=== history.json の同期完了 (対象日: {target_date_str or '全日程'}) ===")

def main():
    parser = argparse.ArgumentParser(description="利尻山ライブカメラ定時撮影スクリプト")
    parser.add_argument("--debug", action="store_true", help="デバッグモード")
    parser.add_argument("--force", action="store_true", help="日照時間外でも強制撮影する")
    parser.add_argument("--sync-only", action="store_true", help="撮影せず既存ファイルからhistory.jsonのみ同期する")
    args = parser.parse_args()

    root_dir = get_project_root()
    cams_dir = os.path.join(root_dir, "public", "cams")
    os.makedirs(cams_dir, exist_ok=True)
    history_file = os.path.join(cams_dir, "history.json")

    now = datetime.now(JST)
    date_str = now.strftime("%Y-%m-%d")
    hour_str = now.strftime("%H")

    if args.sync_only:
        sync_existing_files_to_history(cams_dir, history_file, now, date_str)
        return

    # 季節別日照スケジュール判定（--force 指定時以外）
    if not args.force and not is_within_seasonal_solar_hours(now):
        start_h, end_h = get_seasonal_solar_range(now.month)
        print(
            f"🌙 [夜間スキップ] 現在時刻 ({date_str} {hour_str}:00 JST) は "
            f"{now.month}月の日照記録スケジュール ({start_h:02d}:00〜{end_h:02d}:00) 外のため、"
            f"無料枠容量節約ガードにより撮影をスキップします。"
        )
        return

    target_dir = os.path.join(cams_dir, date_str)
    os.makedirs(target_dir, exist_ok=True)

    history_data = {
        "updatedAt": now.isoformat(),
        "cameras": CAMERAS,
        "records": {}
    }

    if os.path.exists(history_file):
        try:
            with open(history_file, "r", encoding="utf-8") as f:
                loaded_data = json.load(f)
                if isinstance(loaded_data, dict):
                    history_data["records"] = loaded_data.get("records", {})
        except Exception as e:
            print(f"[WARN] history.json の読み込み失敗: {e}")

    if date_str not in history_data["records"]:
        history_data["records"][date_str] = {}
    if hour_str not in history_data["records"][date_str]:
        history_data["records"][date_str][hour_str] = {}
    
    history_data["records"][date_str][hour_str]["timestamp"] = now.isoformat()

    start_h, end_h = get_seasonal_solar_range(now.month)
    print(f"=== 利尻山6地点ライブカメラ 定時撮影処理開始 ({date_str} {hour_str}:00 JST / {now.month}月稼働枠 {start_h:02d}〜{end_h:02d}時) ===")

    # 3スレッド並列で6カメラを効率的に撮影
    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = [
            executor.submit(process_camera, course_id, info, target_dir, date_str, hour_str, args.force)
            for course_id, info in CAMERAS.items()
        ]
        for future in as_completed(futures):
            course_id, success, rel_path = future.result()
            if success and rel_path:
                history_data["records"][date_str][hour_str][course_id] = rel_path

    history_data["cameras"] = CAMERAS
    history_data["updatedAt"] = datetime.now(JST).isoformat()
    with open(history_file, "w", encoding="utf-8") as f:
        json.dump(history_data, f, ensure_ascii=False, indent=2)

    print("=== 定時撮影完了 & history.json を更新しました ===")

if __name__ == "__main__":
    main()
