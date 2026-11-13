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
import hashlib
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
CONFIG_LOCK = threading.Lock()

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

MONITORING_CHECK_HOURS = {"09", "12", "15"}

def load_camera_config(cams_dir):
    config_path = os.path.join(cams_dir, "camera_config.json")
    if not os.path.exists(config_path):
        return {}
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except Exception as e:
        print(f"[WARN] camera_config.json 読み込み失敗: {e}")
        return {}

def save_camera_config(cams_dir, config):
    config_path = os.path.join(cams_dir, "camera_config.json")
    try:
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(config, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[WARN] camera_config.json 保存失敗: {e}")

def promote_monitoring_camera_to_active(cams_dir, course_id, now_jst):
    with CONFIG_LOCK:
        cfg = load_camera_config(cams_dir)
        entry = cfg.get(course_id)
        if isinstance(entry, dict) and entry.get("mode") == "monitoring":
            cfg[course_id] = {
                "mode": "active",
                "recoveredAt": now_jst.isoformat(),
                "note": f"正常映像の復帰を自動検知し通常稼働へ戻しました ({now_jst.strftime('%Y-%m-%d %H:%M JST')})"
            }
            save_camera_config(cams_dir, cfg)
            print(f" 🎉 [{course_id}] 正常映像の回復を検知したため monitoring -> active へ自動復帰しました！")

def file_md5(file_path):
    try:
        h = hashlib.md5()
        with open(file_path, "rb") as f:
            for chunk in iter(lambda: f.read(8192), b""):
                h.update(chunk)
        return h.hexdigest()
    except Exception:
        return None

def get_recent_camera_hashes(cams_dir, course_id, max_days=7, max_files=12):
    hashes = set()
    try:
        dates = sorted(
            (d for d in os.listdir(cams_dir)
             if os.path.isdir(os.path.join(cams_dir, d)) and len(d) == 10 and d.startswith("202")),
            reverse=True
        )[:max_days]
        suffix = f"_{course_id}.jpg"
        count = 0
        for d in dates:
            d_dir = os.path.join(cams_dir, d)
            files = sorted((f for f in os.listdir(d_dir) if f.endswith(suffix)), reverse=True)
            for fname in files:
                h = file_md5(os.path.join(d_dir, fname))
                if h:
                    hashes.add(h)
                count += 1
                if count >= max_files:
                    return hashes
    except Exception:
        pass
    return hashes

def is_blackout_or_invalid_frame(image_path):
    """
    真っ暗（無信号・電源OFFノイズ）や全面単色エラー画面を検知する。
    (実測: 無信号暗転フレームは mean≈20.8, p99≈27, max≈35, std≈2.5 / 夜間正常フレームは街灯・文字で max≈245〜255)
    """
    try:
        if not os.path.exists(image_path) or os.path.getsize(image_path) <= 1000:
            return True, "file_missing_or_tiny"
        from PIL import Image, ImageStat
        with Image.open(image_path) as im:
            g = im.convert("L")
            st = ImageStat.Stat(g)
            mean = st.mean[0]
            stddev = st.stddev[0]
            hist = g.histogram()
            total = sum(hist) or 1
            target = total * 0.99
            acc = 0
            p99 = 255
            for val, cnt in enumerate(hist):
                acc += cnt
                if acc >= target:
                    p99 = val
                    break
            if p99 <= 55 and mean <= 35.0 and stddev <= 8.0:
                return True, f"blackout(mean={mean:.1f}, p99={p99}, std={stddev:.1f})"
            if stddev <= 3.0:
                return True, f"solid_frame(mean={mean:.1f}, std={stddev:.1f})"
    except Exception as e:
        print(f"[DEBUG] フレーム暗転チェック例外: {e}")
    return False, "ok"

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
                    is_bad, bad_reason = is_blackout_or_invalid_frame(img_path)
                    if is_bad:
                        print(f" -> [DVR_BACKFILL 除外] {img_name} は暗転/異常フレーム ({bad_reason}) のため破棄します。")
                        try:
                            os.remove(img_path)
                        except Exception:
                            pass
                        continue
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
    戻り値: (status: "ok" | "blackout" | "failed", restored: list)
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
                is_bad, bad_reason = is_blackout_or_invalid_frame(output_path)
                if is_bad:
                    print(f" -> [STREAM_BLACKOUT] yt-dlp({label}) 映像は取得できましたが暗転/異常フレーム ({bad_reason}) のため除外します")
                    try:
                        os.remove(output_path)
                    except Exception:
                        pass
                    return "blackout", restored
                print(f" -> [STREAM_SCREENSHOT] yt-dlp({label}, proxy={proxy_url or 'direct'}) + HLSセグメント抽出成功")
                return "ok", restored

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
                    is_bad, bad_reason = is_blackout_or_invalid_frame(output_path)
                    if is_bad:
                        print(f" -> [STREAM_BLACKOUT] yt-dlp/ffmpeg({label}) 暗転/異常フレーム ({bad_reason}) のため除外します")
                        try:
                            os.remove(output_path)
                        except Exception:
                            pass
                        return "blackout", restored
                    print(f" -> [STREAM_SCREENSHOT] yt-dlp/ffmpeg ({label}, proxy={proxy_url or 'direct'}) で撮影成功")
                    return "ok", restored
            except Exception:
                pass

    return "failed", []

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

def process_camera(course_id, info, target_dir, cams_dir, date_str, hour_str, now_jst, camera_config=None, force=False):
    cfg_entry = (camera_config or {}).get(course_id, {})
    cam_mode = cfg_entry.get("mode", "active")

    if cam_mode == "seasonal_closed" and not force:
        print(f"❄️ [{course_id}] ({info['name']}) 冬季/シーズン終了設定 (seasonal_closed) のため撮影をスキップします。")
        return course_id, "seasonal_closed", None, []

    if cam_mode == "monitoring" and not force and hour_str not in MONITORING_CHECK_HOURS:
        print(f"🔧 [{course_id}] ({info['name']}) 復旧待ち監視モード (monitoring) のため {hour_str}:00 はチェックをスキップします (確認枠: {sorted(MONITORING_CHECK_HOURS)})。")
        return course_id, "monitoring_skip", None, []

    img_name = f"{hour_str}_{course_id}.jpg"
    img_path = os.path.join(target_dir, img_name)
    rel_path = f"cams/{date_str}/{img_name}"
    restored_list = []

    print(f"[{course_id}] ({info['name']}) リアルタイム撮影試行中... (mode={cam_mode})")

    outcome = "failed"
    recent_hashes = get_recent_camera_hashes(cams_dir, course_id)

    if not info.get("videoId") or info.get("url", "").lower().endswith(".jpg"):
        if capture_static_image(info["url"], img_path):
            is_bad, bad_reason = is_blackout_or_invalid_frame(img_path)
            if is_bad:
                print(f" -> [STATIC_BLACKOUT] {course_id}: 暗転/異常フレーム ({bad_reason}) のため破棄します。")
                try:
                    os.remove(img_path)
                except Exception:
                    pass
                outcome = "blackout"
            else:
                ensure_compressed_image(img_path)
                h = file_md5(img_path)
                if h and h in recent_hashes:
                    print(f" -> [STATIC_STALE] {course_id}: 直近画像と完全一致（配信停止/フリーズ疑い）のため保存をスキップします。")
                    try:
                        os.remove(img_path)
                    except Exception:
                        pass
                    outcome = "stale"
                else:
                    outcome = "ok"
    else:
        video_id = info["videoId"]
        is_custom_thumb = bool(info.get("customThumbnail", False))

        # 1. まず高速な yt-dlp + HLSセグメント直接抽出（＆DVR過去欠落枠自動バックフィル）を試行
        stream_status, restored_list = capture_stream_frame(
            info["url"],
            img_path,
            course_id=course_id,
            target_dir=target_dir,
            date_str=date_str,
            now_jst=now_jst,
        )
        if stream_status == "ok":
            outcome = "ok"
        elif stream_status == "blackout":
            # ストリーム自体が暗転している場合は、古いサムネイル(_live.jpg)を誤って拾わないようここで打ち切る
            outcome = "blackout"
        else:
            # 2. クラウドIP等でyt-dlpが弾かれた場合は Playwright 仮想ドメイン iframe + Canvas で生フレーム抽出
            print(f"[{course_id}] Playwright 仮想ドメイン iframe + Canvas 生フレーム抽出を実行中...")
            if capture_with_playwright_iframe(video_id, img_path):
                is_bad, bad_reason = is_blackout_or_invalid_frame(img_path)
                if is_bad:
                    print(f" -> [PLAYWRIGHT_BLACKOUT] {course_id}: 暗転/異常フレーム ({bad_reason}) のため破棄します。")
                    try:
                        os.remove(img_path)
                    except Exception:
                        pass
                    outcome = "blackout"
                else:
                    outcome = "ok"

            # 3. active かつ カスタムサムネイル未設定のカメラのみ _live.jpg フォールバックを許可
            #    (monitoring モードでは古いキャッシュサムネによる誤復帰を防ぐため _live.jpg を使わない)
            if outcome == "failed" and cam_mode == "active" and not is_custom_thumb:
                print(f"[{course_id}] リアルタイムサムネイル (_live.jpg) でフォールバック中...")
                if capture_fallback_thumbnail(video_id, img_path):
                    is_bad, bad_reason = is_blackout_or_invalid_frame(img_path)
                    if is_bad:
                        print(f" -> [THUMB_BLACKOUT] {course_id}: 暗転フレーム ({bad_reason}) のため破棄します。")
                        try:
                            os.remove(img_path)
                        except Exception:
                            pass
                        outcome = "blackout"
                    else:
                        ensure_compressed_image(img_path)
                        h = file_md5(img_path)
                        if h and h in recent_hashes:
                            print(f" -> [THUMB_STALE] {course_id}: 過去のキャッシュサムネイルと完全一致するため破棄します。")
                            try:
                                os.remove(img_path)
                            except Exception:
                                pass
                            outcome = "stale"
                        else:
                            outcome = "ok"

    if outcome == "ok" and os.path.exists(img_path) and os.path.getsize(img_path) > 1000:
        ensure_compressed_image(img_path)
        print(f" -> 成功: {rel_path} ({os.path.getsize(img_path)} bytes)")
        if cam_mode == "monitoring":
            promote_monitoring_camera_to_active(cams_dir, course_id, now_jst)
        return course_id, "ok", rel_path, restored_list
    else:
        if os.path.exists(img_path):
            try:
                os.remove(img_path)
            except Exception:
                pass
        print(f" -> 未保存 ({outcome}): {course_id} の有効な映像を取得できませんでした。")
        return course_id, outcome, None, restored_list

def find_last_valid_at(records, cam_id):
    for d_str in sorted(records.keys(), reverse=True):
        day_rec = records.get(d_str) or {}
        for hr in sorted((k for k in day_rec.keys() if k.isdigit()), reverse=True):
            if cam_id in (day_rec.get(hr) or {}):
                return f"{d_str} {hr}:00"
    return None

def build_camera_status(records, camera_config, now_jst, run_outcomes=None):
    status_map = {}
    run_outcomes = run_outcomes or {}
    sorted_dates = sorted((d for d in records.keys() if len(d) == 10 and d.startswith("202")), reverse=True)
    latest_date = sorted_dates[0] if sorted_dates else None

    for cam_id in CAMERAS.keys():
        cfg = camera_config.get(cam_id, {}) if isinstance(camera_config, dict) else {}
        mode = cfg.get("mode", "active")
        last_valid_at = find_last_valid_at(records, cam_id)
        outcome = run_outcomes.get(cam_id)

        if mode == "seasonal_closed":
            status_map[cam_id] = {
                "status": "seasonal_closed",
                "since": cfg.get("since"),
                "note": cfg.get("note") or "冬季配信終了のため休止中",
                "lastValidAt": last_valid_at,
                "updatedAt": now_jst.isoformat(),
            }
            continue

        if mode == "monitoring":
            status_map[cam_id] = {
                "status": "monitoring",
                "health": outcome or "blackout",
                "since": cfg.get("since"),
                "note": cfg.get("note") or "配信側の映像不具合につき復旧待ち",
                "lastValidAt": last_valid_at,
                "lastCheckedAt": now_jst.isoformat(),
                "updatedAt": now_jst.isoformat(),
            }
            continue

        # mode == "active" の自動障害検知
        if outcome == "blackout":
            status_map[cam_id] = {
                "status": "blackout",
                "note": "カメラ映像の暗転・無信号を検知（復旧確認中）",
                "lastValidAt": last_valid_at,
                "updatedAt": now_jst.isoformat(),
            }
            continue

        # 直近の最新日において、他カメラが2スロット以上記録されているのに直近2スロット連続で欠損しているかチェック
        is_recent_offline = False
        if latest_date:
            day_rec = records.get(latest_date, {})
            valid_hours = sorted(
                hr for hr, hr_obj in day_rec.items()
                if hr.isdigit() and isinstance(hr_obj, dict) and any(k != "timestamp" for k in hr_obj.keys())
            )
            if len(valid_hours) >= 2:
                recent_two = valid_hours[-2:]
                if all(cam_id not in (day_rec.get(hr) or {}) for hr in recent_two):
                    is_recent_offline = True

        if outcome in ("failed", "stale") and is_recent_offline:
            status_map[cam_id] = {
                "status": "offline",
                "note": "配信一時停止中または取得失敗（復旧確認中）",
                "lastValidAt": last_valid_at,
                "updatedAt": now_jst.isoformat(),
            }
        elif not outcome and is_recent_offline:
            status_map[cam_id] = {
                "status": "offline",
                "note": "配信一時停止中または取得失敗（復旧確認中）",
                "lastValidAt": last_valid_at,
                "updatedAt": now_jst.isoformat(),
            }
        else:
            entry = {
                "status": "active",
                "lastValidAt": last_valid_at,
                "updatedAt": now_jst.isoformat(),
            }
            if cfg.get("recoveredAt"):
                entry["recoveredAt"] = cfg.get("recoveredAt")
            if cfg.get("note"):
                entry["note"] = cfg.get("note")
            status_map[cam_id] = entry

    return status_map

def sync_existing_files_to_history(cams_dir, history_file, now_jst, target_date_str=None, run_outcomes=None):
    """
    public/cams/YYYY-MM-DD/ 内の実ファイルから history.json を安全に再同期する（git pull競合復旧＆DVRバックフィル反映用）
    """
    history_data = {
        "updatedAt": now_jst.isoformat(),
        "cameras": CAMERAS,
        "cameraStatus": {},
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
        existing_day = history_data["records"].get(d_str, {})
        # スキャン対象日の既存レコードから、実ファイルが消えたエントリを取り除く
        rebuilt_day = {}
        for hr_key, hr_val in existing_day.items():
            if not isinstance(hr_val, dict):
                continue
            kept = {}
            if "timestamp" in hr_val:
                kept["timestamp"] = hr_val["timestamp"]
            for k, rel in hr_val.items():
                if k == "timestamp":
                    continue
                fname = os.path.basename(rel)
                if os.path.exists(os.path.join(d_dir, fname)):
                    kept[k] = rel
            if any(k != "timestamp" for k in kept.keys()):
                rebuilt_day[hr_key] = kept

        for fname in sorted(os.listdir(d_dir)):
            if not fname.endswith(".jpg") or "_" not in fname:
                continue
            hr_part, rest = fname.split("_", 1)
            cam_id = rest[:-4] # remove .jpg
            if len(hr_part) == 2 and hr_part.isdigit():
                if hr_part not in rebuilt_day:
                    rebuilt_day[hr_part] = {"timestamp": now_jst.isoformat()}
                rebuilt_day[hr_part][cam_id] = f"cams/{d_str}/{fname}"

        if rebuilt_day:
            history_data["records"][d_str] = rebuilt_day
        elif d_str in history_data["records"]:
            del history_data["records"][d_str]

    camera_config = load_camera_config(cams_dir)
    history_data["cameras"] = CAMERAS
    history_data["cameraStatus"] = build_camera_status(history_data["records"], camera_config, now_jst, run_outcomes=run_outcomes)
    history_data["updatedAt"] = now_jst.isoformat()
    with open(history_file, "w", encoding="utf-8") as f:
        json.dump(history_data, f, ensure_ascii=False, indent=2)
    print(f"=== history.json の同期完了 (対象日: {target_date_str or '全日程'}) ===")

def main():
    parser = argparse.ArgumentParser(description="利尻山ライブカメラ定時撮影スクリプト")
    parser.add_argument("--debug", action="store_true", help="デバッグモード")
    parser.add_argument("--force", action="store_true", help="日照時間外でも強制撮影する")
    parser.add_argument("--sync-only", action="store_true", help="撮影せず既存ファイルからhistory.jsonのみ同期する")
    parser.add_argument("--sync-all", action="store_true", help="全日程の実ファイルからhistory.jsonを再同期する")
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

    if args.sync_all:
        sync_existing_files_to_history(cams_dir, history_file, now, target_date_str=None)
        return

    if args.sync_only:
        sync_existing_files_to_history(cams_dir, history_file, now, date_str)
        return

    os.makedirs(target_dir, exist_ok=True)
    camera_config = load_camera_config(cams_dir)

    if args.backfill_only:
        print(f"=== 当日 ({date_str}) の未取得カメラ枠 DVRバックフィルチェック開始 ===")
        for course_id, info in CAMERAS.items():
            if not info.get("videoId"):
                continue
            mode = (camera_config.get(course_id) or {}).get("mode", "active")
            if mode in ("seasonal_closed", "monitoring") and not args.force:
                print(f" -> [スキップ] {course_id} (mode={mode})")
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
    run_outcomes = {}
    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = [
            executor.submit(process_camera, course_id, info, target_dir, cams_dir, date_str, hour_str, now, camera_config, args.force)
            for course_id, info in CAMERAS.items()
        ]
        for future in as_completed(futures):
            c_id, outcome_status, _, _ = future.result()
            run_outcomes[c_id] = outcome_status

    # 実ファイル群（DVRバックフィル復元分を含む）から history.json を完全同期
    sync_existing_files_to_history(cams_dir, history_file, datetime.now(JST), date_str, run_outcomes=run_outcomes)
    print("=== 定時撮影完了 & history.json を更新しました ===")

if __name__ == "__main__":
    main()
