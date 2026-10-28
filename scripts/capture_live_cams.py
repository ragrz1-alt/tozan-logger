#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
利尻山 ライブカメラ（全6地点：鴛泊本泊・鴛泊港フェリー・姫沼・沓形・オタドマリ沼・仙法志）
定時撮影＆アーカイブ記録スクリプト（季節別日照スケジュール・WARPプロキシ・DVR自動バックフィル対応）

利用目的:
- YouTube Live および利尻町公式カメラから最新フレームを抽出・取得し、
  public/cams/YYYY-MM-DD/HH_<course>.jpg に記録します。
- カスタムサムネイル設定済みカメラ（鴛泊港・姫沼・オタドマリ沼）は、
  yt-dlp (+ WARPプロキシ / HLSセグメント直接取得) または Playwright 仮想ドメイン iframe + Canvas 生フレーム抽出により、
  固定サムネイルやYouTube UIが一切混入しない純粋なライブ映像のみを記録します。
- 当日の過去時間帯（DVR保持範囲内）に欠落がある場合は、HLS DVRプレイリストの
  #EXT-X-PROGRAM-DATE-TIME から正確な当時の映像フレームを自動バックフィル復元します。
- 撮影履歴およびメタデータを public/cams/history.json に登録・更新します。
"""

import os
import re
import sys
import json
import socket
import shutil
import tempfile
import subprocess
import urllib.request
import argparse
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, timedelta

PLAYWRIGHT_LOCK = threading.Lock()
BACKFILL_LOCK = threading.Lock()

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

def resolve_ytdlp_bin():
    if shutil.which("yt-dlp"):
        return "yt-dlp"
    root = get_project_root()
    for rel in [
        os.path.join("node_modules", "@distube", "yt-dlp", "bin", "yt-dlp.exe"),
        os.path.join("node_modules", "@distube", "yt-dlp", "bin", "yt-dlp"),
    ]:
        p = os.path.join(root, rel)
        if os.path.exists(p):
            return p
    return "yt-dlp"

def resolve_ffmpeg_bin():
    if shutil.which("ffmpeg"):
        return "ffmpeg"
    root = get_project_root()
    for rel in [
        os.path.join("node_modules", "ffmpeg-static", "ffmpeg.exe"),
        os.path.join("node_modules", "ffmpeg-static", "ffmpeg"),
    ]:
        p = os.path.join(root, rel)
        if os.path.exists(p):
            return p
    return "ffmpeg"

def is_local_port_open(port=40000, host="127.0.0.1", timeout=0.5):
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except Exception:
        return False

def get_proxy_candidates():
    """
    利用可能なプロキシ候補リストを返す（Cloudflare WARP local proxy 127.0.0.1:40000 等 + 直接接続 None）
    """
    candidates = []
    env_proxy = os.environ.get("YOUTUBE_PROXY", "").strip()
    if env_proxy:
        candidates.append(env_proxy)
    elif is_local_port_open(40000):
        candidates.append("http://127.0.0.1:40000")
    candidates.append(None)
    return candidates

def build_opener(proxy_url=None):
    if proxy_url:
        proxy_handler = urllib.request.ProxyHandler({"http": proxy_url, "https": proxy_url})
        return urllib.request.build_opener(proxy_handler)
    return urllib.request.build_opener()

def fetch_url_bytes(url, proxy_url=None, timeout=20):
    opener = build_opener(proxy_url)
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
    )
    with opener.open(req, timeout=timeout) as res:
        return res.read()

def get_seasonal_solar_range(month):
    """
    利尻島（北緯45.18度）の季節別日出・薄明・日没に合わせた撮影時間レンジ (start_hour, end_hour)
    - 5〜8月（極昼・盛夏期）:   03:00 〜 21:00 (19回/日)
    - 3〜4月・9〜10月（春秋）: 04:00 〜 18:00 (15回/日)
    - 11〜2月（冬期）:         06:00 〜 17:00 (12回/日)
    """
    if month in (5, 6, 7, 8):
        return 3, 21
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
        if size <= max_bytes:
            return

        # 1. Pillow (PIL) による確実・高速なリサイズ＆JPEG圧縮
        try:
            from PIL import Image
            with Image.open(image_path) as im:
                im = im.convert("RGB")
                w, h = im.size
                if w > 800:
                    new_h = int(h * (800.0 / w))
                    im = im.resize((800, new_h), Image.Resampling.LANCZOS)
                for q in [78, 68, 58, 48, 38]:
                    tmp_path = image_path + ".pil.jpg"
                    im.save(tmp_path, format="JPEG", quality=q, optimize=True)
                    if os.path.exists(tmp_path) and os.path.getsize(tmp_path) > 1000:
                        tmp_size = os.path.getsize(tmp_path)
                        os.replace(tmp_path, image_path)
                        if tmp_size <= max_bytes or q == 38:
                            print(f" -> [PIL容量最適化 q={q}] {size} bytes => {tmp_size} bytes")
                            return
                        size = tmp_size
        except Exception as pil_err:
            print(f"[DEBUG] PIL圧縮フォールバック: {pil_err}")

        # 2. ffmpeg フォールバック (-vf scale=800:-2)
        if size > max_bytes:
            ffmpeg_bin = resolve_ffmpeg_bin()
            for q in [4, 6, 8, 10, 12]:
                tmp_path = image_path + ".tmp.jpg"
                cmd = [
                    ffmpeg_bin, "-y",
                    "-i", image_path,
                    "-vf", "scale=800:-2",
                    "-pix_fmt", "yuvj420p",
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
    except Exception as e:
        print(f"[WARN] 画像圧縮処理例外: {e}")

def extract_frame_from_segment_url(seg_url, output_path, proxy_url=None):
    """
    単一HLSセグメント (.ts / .mp4) をダウンロードし、ローカル一時ファイルから ffmpeg で1フレームを抽出する
    (FFmpegがHLSサブプレイリスト取得時にプロキシ設定を失う問題を100%回避)
    """
    ffmpeg_bin = resolve_ffmpeg_bin()
    tmp_seg = None
    try:
        seg_bytes = fetch_url_bytes(seg_url, proxy_url=proxy_url, timeout=20)
        if not seg_bytes or len(seg_bytes) < 4000:
            return False
        fd, tmp_seg = tempfile.mkstemp(suffix=".ts")
        with os.fdopen(fd, "wb") as f:
            f.write(seg_bytes)

        cmd = [
            ffmpeg_bin, "-y",
            "-i", tmp_seg,
            "-frames:v", "1",
            "-vf", "scale=800:-2",
            "-q:v", "4",
            output_path
        ]
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20)
        if res.returncode == 0 and os.path.exists(output_path) and os.path.getsize(output_path) > 1500:
            return True
    except Exception as e:
        print(f"[DEBUG] セグメント抽出例外: {e}")
    finally:
        if tmp_seg and os.path.exists(tmp_seg):
            try:
                os.remove(tmp_seg)
            except Exception:
                pass
    return False

def parse_m3u8_dvr_entries(m3u8_text):
    """
    HLS メディアプレイリストから (datetime_utc, segment_url) のリストと全セグメントURLリストを抽出する
    """
    lines = [l.strip() for l in m3u8_text.splitlines() if l.strip()]
    timed_entries = []
    all_seg_urls = []
    current_ms = None
    next_dur_sec = 5.0

    for line in lines:
        if line.startswith("#EXT-X-PROGRAM-DATE-TIME:"):
            dt_str = line.split(":", 1)[1].strip()
            try:
                if dt_str.endswith("Z"):
                    dt_str = dt_str[:-1] + "+00:00"
                dt_obj = datetime.fromisoformat(dt_str)
                current_ms = int(dt_obj.timestamp() * 1000)
            except Exception:
                pass
        elif line.startswith("#EXTINF:"):
            m = re.match(r"#EXTINF:([0-9.]+)", line)
            if m:
                try:
                    next_dur_sec = float(m.group(1))
                except Exception:
                    next_dur_sec = 5.0
        elif line.startswith("http://") or line.startswith("https://"):
            all_seg_urls.append(line)
            if current_ms is not None:
                dt_utc = datetime.fromtimestamp(current_ms / 1000.0, tz=timezone.utc)
                timed_entries.append((dt_utc, line))
                current_ms += int(round(next_dur_sec * 1000))

    return timed_entries, all_seg_urls

def backfill_missing_hours_from_dvr(course_id, timed_entries, target_dir, date_str, now_jst, proxy_url=None):
    """
    当日の日照スケジュール内の過去時間帯に未取得の枠があれば、DVRセグメントから遡って自動復元する
    """
    if not timed_entries:
        return []
    restored = []
    start_h, end_h = get_seasonal_solar_range(now_jst.month)
    max_past_h = min(end_h, now_jst.hour - 1)

    for hr in range(start_h, max_past_h + 1):
        hr_str = f"{hr:02d}"
        img_name = f"{hr_str}_{course_id}.jpg"
        img_path = os.path.join(target_dir, img_name)
        if os.path.exists(img_path) and os.path.getsize(img_path) > 1500:
            continue

        # 該当時刻の HH:06:00 JST に最も近いセグメントを検索（許容誤差25分以内）
        target_dt = datetime(now_jst.year, now_jst.month, now_jst.day, hr, 6, 0, tzinfo=JST).astimezone(timezone.utc)
        best_seg = None
        min_diff = 999999.0
        for dt_utc, seg_url in timed_entries:
            diff = abs((dt_utc - target_dt).total_seconds())
            if diff < min_diff:
                min_diff = diff
                best_seg = (dt_utc, seg_url)

        if best_seg and min_diff <= 1500:
            with BACKFILL_LOCK:
                if os.path.exists(img_path) and os.path.getsize(img_path) > 1500:
                    continue
                dt_jst_seg = best_seg[0].astimezone(JST)
                print(
                    f" -> [DVR_BACKFILL] {course_id} の未記録枠 {hr_str}:00 をDVRプレイリスト "
                    f"({dt_jst_seg.strftime('%H:%M:%S')} JST) から自動復元中..."
                )
                if extract_frame_from_segment_url(best_seg[1], img_path, proxy_url=proxy_url):
                    ensure_compressed_image(img_path)
                    rel_path = f"cams/{date_str}/{img_name}"
                    print(f" -> [DVR_BACKFILL 成功] {rel_path} ({os.path.getsize(img_path)} bytes)")
                    restored.append((hr_str, rel_path))
    return restored

def capture_from_m3u8_url(m3u8_url, output_path, course_id=None, target_dir=None, date_str=None, now_jst=None, proxy_url=None):
    """
    m3u8 URLから最新セグメントを取得してフレーム抽出し、同時に当日の過去欠落枠があればDVRバックフィルする
    """
    try:
        raw = fetch_url_bytes(m3u8_url, proxy_url=proxy_url, timeout=20).decode("utf-8", errors="ignore")
        if "#EXT-X-STREAM-INF" in raw:
            sub_urls = [l.strip() for l in raw.splitlines() if l.strip().startswith("http")]
            if not sub_urls:
                return False, []
            raw = fetch_url_bytes(sub_urls[-1], proxy_url=proxy_url, timeout=20).decode("utf-8", errors="ignore")

        timed_entries, all_seg_urls = parse_m3u8_dvr_entries(raw)
        if not all_seg_urls:
            return False, []

        # 最新セグメント（末尾から最大2つ試行）で現在時刻フレームを抽出
        captured = False
        for seg_url in reversed(all_seg_urls[-2:]):
            if extract_frame_from_segment_url(seg_url, output_path, proxy_url=proxy_url):
                captured = True
                break

        # 当日の過去欠落時間があればDVRからバックフィル
        restored = []
        if course_id and target_dir and date_str and now_jst and timed_entries:
            try:
                restored = backfill_missing_hours_from_dvr(
                    course_id, timed_entries, target_dir, date_str, now_jst, proxy_url=proxy_url
                )
            except Exception as bf_err:
                print(f"[DEBUG] DVRバックフィル例外 ({course_id}): {bf_err}")

        return captured, restored
    except Exception as e:
        print(f"[DEBUG] m3u8直接解析例外: {e}")
        return False, []

def run_ytdlp_get_url(video_url, format_selector, extra_args=None, proxy_url=None):
    ytdlp_bin = resolve_ytdlp_bin()
    cmd = [ytdlp_bin, "--no-warnings", "--js-runtimes", "node", "-f", format_selector]
    if proxy_url:
        cmd.extend(["--proxy", proxy_url])
    if extra_args:
        cmd.extend(extra_args)
    cmd.extend(["-g", video_url])

    try:
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=30)
        if res.returncode == 0 and res.stdout.strip():
            return res.stdout.strip().splitlines()[0]
        else:
            err_line = (res.stderr or "").strip().splitlines()
            if err_line:
                print(f" -> [yt-dlp WARN ({proxy_url or 'direct'})] {err_line[-1][:160]}")
    except Exception as e:
        print(f" -> [yt-dlp EXC ({proxy_url or 'direct'})] {e}")
    return None

def capture_stream_frame(video_url, output_path, course_id=None, target_dir=None, date_str=None, now_jst=None):
    """
    プロキシ候補 × クライアント候補の組み合わせで HLS ストリームからリアルタイム撮影（＆DVRバックフィル）を行う
    """
    if os.path.exists(output_path):
        try:
            os.remove(output_path)
        except Exception:
            pass

    proxies = get_proxy_candidates()
    client_Strategies = [
        ("default(android_vr/web)", []),
        ("multi-client(android_vr,tv,mweb,ios)", ["--extractor-args", "youtube:player_client=android_vr,tv,mweb,ios,web"]),
    ]
    fmt = "95/94/93/best[protocol^=m3u8]/301/300/96/best"

    for proxy_url in proxies:
        for label, extra in client_Strategies:
            stream_url = run_ytdlp_get_url(video_url, fmt, extra_args=extra, proxy_url=proxy_url)
            if not stream_url:
                continue

            # 1. PythonによるHLSセグメント直接取得＋ローカルffmpeg変換（＆DVRバックフィル）
            ok, restored = capture_from_m3u8_url(
                stream_url,
                output_path,
                course_id=course_id,
                target_dir=target_dir,
                date_str=date_str,
                now_jst=now_jst,
                proxy_url=proxy_url,
            )
            if ok and os.path.exists(output_path) and os.path.getsize(output_path) > 1500:
                print(f" -> [STREAM_SCREENSHOT] yt-dlp({label}, proxy={proxy_url or 'direct'}) + HLSセグメント抽出成功")
                return True, restored

            # 2. 直接 ffmpeg -i stream_url フォールバック
            ffmpeg_bin = resolve_ffmpeg_bin()
            cmd = [
                ffmpeg_bin, "-y",
                "-rw_timeout", "15000000",
                "-i", stream_url,
                "-vframes", "1",
                "-vf", "scale=800:-2",
                "-q:v", "4",
                output_path
            ]
            env = os.environ.copy()
            if proxy_url:
                env["HTTP_PROXY"] = proxy_url
                env["HTTPS_PROXY"] = proxy_url
                env["http_proxy"] = proxy_url
                env["https_proxy"] = proxy_url
            try:
                ffmpeg_res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, timeout=30)
                if ffmpeg_res.returncode == 0 and os.path.exists(output_path) and os.path.getsize(output_path) > 1500:
                    print(f" -> [STREAM_SCREENSHOT] yt-dlp/ffmpeg ({label}, proxy={proxy_url or 'direct'}) で撮影成功")
                    return True, restored
            except Exception:
                pass

    return False, []

def capture_with_playwright_iframe(video_id, output_path):
    """
    カスタムサムネイル設定済みカメラ（およびクラウドIPでyt-dlpがブロックされた場合）向けに、
    Playwright 仮想ドメイン iframe 埋め込み + HTML5 <video> -> <canvas> から直接生フレームを抽出する
    (2コアCI環境でのCPU競合を防ぐためロック制御で1ブラウザずつ安全に実行)
    """
    with PLAYWRIGHT_LOCK:
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
                timeout=65
            )
            if res.returncode == 0 and os.path.exists(output_path) and os.path.getsize(output_path) > 1500:
                print(f" -> [PLAYWRIGHT_CANVAS] 仮想ドメインiframeから純粋ライブ映像抽出成功 ({os.path.getsize(output_path)} bytes)")
                return True
            else:
                err_msg = (res.stderr or res.stdout or "").strip()
                if err_msg:
                    print(f" -> [PLAYWRIGHT_CANVAS WARN] {err_msg[:220]}")
            return False
        except Exception as e:
            print(f"[WARN] Playwright iframe キャプチャ失敗 ({video_id}): {e}")
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

def process_camera(course_id, info, target_dir, date_str, hour_str, now_jst, force=False):
    img_name = f"{hour_str}_{course_id}.jpg"
    img_path = os.path.join(target_dir, img_name)
    rel_path = f"cams/{date_str}/{img_name}"
    restored_list = []

    print(f"[{course_id}] ({info['name']}) リアルタイム撮影試行中...")

    if not info.get("videoId") or info.get("url", "").lower().endswith(".jpg"):
        success = capture_static_image(info["url"], img_path)
    else:
        video_id = info["videoId"]
        is_custom_thumb = bool(info.get("customThumbnail", False))

        # 1. まず高速な yt-dlp + HLSセグメント直接抽出（＆DVR過去欠落枠自動バックフィル）を試行
        success, restored_list = capture_stream_frame(
            info["url"],
            img_path,
            course_id=course_id,
            target_dir=target_dir,
            date_str=date_str,
            now_jst=now_jst,
        )

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
        return course_id, True, rel_path, restored_list
    else:
        print(f" -> 失敗: {course_id} の画像取得ができませんでした。")
        return course_id, False, None, restored_list

def sync_existing_files_to_history(cams_dir, history_file, now_jst, target_date_str=None):
    """
    public/cams/YYYY-MM-DD/ 内の実ファイルから history.json を安全に再同期する（git pull競合復旧＆DVRバックフィル反映用）
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
    parser.add_argument("--backfill-only", action="store_true", help="当日の過去欠落時間帯のみDVRからバックフィル復元する")
    args = parser.parse_args()

    root_dir = get_project_root()
    cams_dir = os.path.join(root_dir, "public", "cams")
    os.makedirs(cams_dir, exist_ok=True)
    history_file = os.path.join(cams_dir, "history.json")

    now = datetime.now(JST)
    date_str = now.strftime("%Y-%m-%d")
    hour_str = now.strftime("%H")
    target_dir = os.path.join(cams_dir, date_str)
    os.makedirs(target_dir, exist_ok=True)

    if args.sync_only:
        sync_existing_files_to_history(cams_dir, history_file, now, date_str)
        return

    if args.backfill_only:
        print(f"=== 当日 ({date_str}) の未取得カメラ枠 DVRバックフィルチェック開始 ===")
        for course_id, info in CAMERAS.items():
            if not info.get("videoId"):
                continue
            tmp_out = os.path.join(tempfile.gettempdir(), f"bf_probe_{course_id}.jpg")
            capture_stream_frame(info["url"], tmp_out, course_id=course_id, target_dir=target_dir, date_str=date_str, now_jst=now)
            if os.path.exists(tmp_out):
                try:
                    os.remove(tmp_out)
                except Exception:
                    pass
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

    start_h, end_h = get_seasonal_solar_range(now.month)
    print(f"=== 利尻山6地点ライブカメラ 定時撮影処理開始 ({date_str} {hour_str}:00 JST / {now.month}月稼働枠 {start_h:02d}〜{end_h:02d}時) ===")

    # 3スレッド並列で6カメラを効率的に撮影
    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = [
            executor.submit(process_camera, course_id, info, target_dir, date_str, hour_str, now, args.force)
            for course_id, info in CAMERAS.items()
        ]
        for future in as_completed(futures):
            future.result()

    # 実ファイル群（DVRバックフィル復元分を含む）から history.json を完全同期
    sync_existing_files_to_history(cams_dir, history_file, datetime.now(JST), date_str)
    print("=== 定時撮影完了 & history.json を更新しました ===")

if __name__ == "__main__":
    main()
