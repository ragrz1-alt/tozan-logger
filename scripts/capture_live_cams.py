#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
利尻山 YouTubeライブカメラ（鴛泊側・沓形側）定時撮影＆アーカイブ記録スクリプト

利用目的:
- YouTube Live から定期的に最新フレーム（スクリーンショット）を抽出または取得し、
  public/cams/YYYY-MM-DD/HH_<course>.jpg に記録します。
- 撮影履歴およびメタデータを public/cams/history.json に登録・更新します。

動作条件:
- yt-dlp および ffmpeg が導入されている場合は、ライブ動画 stream から直接キャプチャを行います。
- 万一 yt-dlp / ffmpeg が利用できない場合やストリーム取得失敗時は、YouTube公式のライブサムネイル画像へフォールバックして取得します。
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

# カメラ定義
CAMERAS = {
    "oshidomari": {
        "name": "鴛泊（鴛泊）",
        "videoId": "8BwfUCuPcVE",
        "url": "https://www.youtube.com/watch?v=8BwfUCuPcVE"
    },
    "kutsugata": {
        "name": "沓形（沓形）",
        "videoId": "",
        "url": "https://rishiri-town.jp/wp-content/themes/rishiri/images/MtRishiri/mt-rishiri.jpg"
    },
    "senposhi": {
        "name": "仙法志（御崎）",
        "videoId": "5BG3KJVFRVM",
        "url": "https://www.youtube.com/watch?v=5BG3KJVFRVM"
    }
}

def get_project_root():
    # scripts ディレクトリの親をプロジェクトルートとする
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def ensure_compressed_image(image_path):
    """
    保存された画像ファイルサイズを確認し、不要に大きい場合（100KB超過の公式サムネイル等）は
    必ず幅800px・高画質JPEGに最適化して容量圧迫を防ぐ（通常のストリームキャプチャ〜50KB程度はそのまま保存）
    """
    try:
        if not os.path.exists(image_path):
            return
        size = os.path.getsize(image_path)
        # 100KBを超える場合のみ最適化を行う（〜50KB程度の通常キャプチャはそのまま保存）
        if size > 100000:
            tmp_path = image_path + ".tmp.jpg"
            cmd = [
                "ffmpeg", "-y",
                "-i", image_path,
                "-vf", "scale=800:-1",
                "-q:v", "3",
                tmp_path
            ]
            res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15)
            if res.returncode == 0 and os.path.exists(tmp_path) and os.path.getsize(tmp_path) > 1000:
                os.replace(tmp_path, image_path)
                print(f" -> [容量最適化] {size} bytes => {os.path.getsize(image_path)} bytes に軽量化")
    except Exception as e:
        print(f"[WARN] 画像圧縮処理例外: {e}")

def capture_with_ytdlp_url(video_url, output_path, format_selector="best[protocol^=m3u8]/301/300/96/95/94/93/best"):
    """
    昨日の「oshidomari」解決実績と同様に、スマートかつ最も安定している HLSプロトコル優先フォーマットで
    ストリームURLを取得し、ffmpeg で配信映像から実フレームを1枚直接キャプチャする（〜50KB程度）
    """
    try:
        if os.path.exists(output_path):
            try:
                os.remove(output_path)
            except Exception:
                pass
        # 1. yt-dlp でストリームURLを取得
        res = subprocess.run(
            ["yt-dlp", "-f", format_selector, "-g", video_url],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=30
        )
        if res.returncode != 0 or not res.stdout.strip():
            print(f"[DEBUG ytdlp_url] ストリームURL取得失敗 (format={format_selector}): {res.stderr.strip()[:150]}")
            return False
        
        stream_url = res.stdout.strip().splitlines()[0]
        if not stream_url:
            return False
        
        # 2. ffmpeg でストリームからフレーム抽出
        cmd = [
            "ffmpeg", "-y",
            "-rw_timeout", "15000000",
            "-i", stream_url,
            "-vframes", "1",
            "-vf", "scale=800:-1",
            "-q:v", "3",
            output_path
        ]
        ffmpeg_res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=35)
        if ffmpeg_res.returncode == 0 and os.path.exists(output_path) and os.path.getsize(output_path) > 1000:
            print(" -> [STREAM_SCREENSHOT] yt-dlp/ffmpeg エンジンでリアルタイム撮影成功")
            return True
        return False
    except Exception as e:
        print(f"[WARN] yt-dlp/ffmpeg 撮影失敗: {e}")
        return False

def capture_with_ytdlp_client_args(video_url, output_path, format_selector="best[protocol^=m3u8]/best"):
    """
    昨日のクラウドIPからのDASH 403ブロック回避実績である --extractor-args を付与したストリーム取得方式
    """
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
            timeout=30
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
            "-q:v", "3",
            output_path
        ]
        ffmpeg_res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=35)
        if ffmpeg_res.returncode == 0 and os.path.exists(output_path) and os.path.getsize(output_path) > 1000:
            print(" -> [STREAM_SCREENSHOT] yt-dlp(--extractor-args)/ffmpeg エンジンで撮影成功")
            return True
        return False
    except Exception as e:
        return False

def capture_with_streamlink(video_url, output_path):
    """
    昨日のライブ配信専門ツール streamlink 実績による直接HLSストリームURL取得＆キャプチャ
    """
    try:
        res = subprocess.run(
            ["streamlink", "--stream-url", video_url, "best,720p,480p,360p,worst"],
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
            "-q:v", "3",
            output_path
        ]
        ffmpeg_res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=35)
        if ffmpeg_res.returncode == 0 and os.path.exists(output_path) and os.path.getsize(output_path) > 1000:
            print(" -> [STREAM_SCREENSHOT] streamlink/ffmpeg エンジンでリアルタイム撮影成功")
            return True
        return False
    except Exception as e:
        return False

def capture_with_ytdlp_pipe(video_url, output_path):
    """
    パイプ経由のバックアップ方式（URL直接キャプチャが一時不調な場合）
    """
    try:
        ytdlp_cmd = [
            "yt-dlp",
            "-f", "best[height<=1080]/best",
            "--no-part",
            "-o", "-",
            video_url
        ]
        ffmpeg_cmd = [
            "ffmpeg", "-y",
            "-t", "5",
            "-rw_timeout", "15000000",
            "-i", "pipe:0",
            "-vframes", "1",
            "-vf", "scale=800:-1",
            "-q:v", "3",
            output_path
        ]
        p_ytdlp = subprocess.Popen(ytdlp_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        p_ffmpeg = subprocess.Popen(ffmpeg_cmd, stdin=p_ytdlp.stdout, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        p_ffmpeg.communicate(timeout=35)
        try:
            p_ytdlp.terminate()
            p_ytdlp.wait(timeout=5)
        except Exception:
            p_ytdlp.kill()

        if p_ffmpeg.returncode == 0 and os.path.exists(output_path) and os.path.getsize(output_path) > 1000:
            print(" -> [STREAM_SCREENSHOT] ytdlp_pipe エンジンでリアルタイム撮影成功")
            return True
        return False
    except Exception as e:
        print(f"[WARN] パイプキャプチャ失敗: {e}")
        return False

def capture_stream_frame(video_url, output_path):
    """
    昨日の「oshidomari」解決実績（HLS優先・extractor-args・streamlink）を統合した最強リアルタイムフレーム取得
    """
    # 方式1: 昨日の実績「HLSプロトコル最優先フォーマット (m3u8 / 301 / 300 / 96 / 95)」
    if capture_with_ytdlp_url(video_url, output_path, "best[protocol^=m3u8]/301/300/96/95/94/93/best"):
        return True
        
    # 方式2: 昨日のクラウドIP 403ブロック回避実績 (--extractor-args "youtube:player_client=ios,android,web")
    if capture_with_ytdlp_client_args(video_url, output_path, "best[protocol^=m3u8]/best"):
        return True

    # 方式3: ライブ配信専門ツール streamlink による直接HLS抽出
    if capture_with_streamlink(video_url, output_path):
        return True
        
    # 方式4: パイプストリームキャプチャ
    if capture_with_ytdlp_pipe(video_url, output_path):
        return True
        
    return False

def capture_fallback_thumbnail(video_id, output_path):
    """
    yt-dlp/streamlink/ffmpeg でストリームから実フレームを取れない場合でも、
    YouTube側が配信中に定期更新している「リアルタイムサムネイル (_live.jpg)」のみを保存する。
    ※ 2021年の静止画サムネイル (maxresdefault.jpg 等) は絶対に保存しない（古いサムネ混入・上書きを完全排除！）
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
                if len(data) > 1000: # 正常な画像バイナリサイズか確認
                    with open(output_path, "wb") as f:
                        f.write(data)
                    print(f" -> [REALTIME_THUMBNAIL] リアルタイムサムネイル保存成功: {url} ({len(data)} bytes)")
                    return True
        except Exception as e:
            continue

    print(f" -> [ERROR] ストリーム及びリアルタイムサムネイル (_live.jpg) の取得に失敗。(videoId={video_id}) ※古い固定サムネイルの保存は厳密に禁止されました。")
    return False

def capture_static_image(image_url, output_path):
    """
    利尻町公式カメラ等、静止画URL (JPG) を直接配信しているカメラから最新画像をダウンロードして保存する
    """
    try:
        if os.path.exists(output_path):
            try:
                os.remove(output_path)
            except Exception:
                pass
        # キャッシュバスターで最新画像を取得
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

    # urlが静止画(.jpg等)やvideoIdが空の場合、静止画直接ダウンロードを実行
    if not info.get("videoId") or info.get("url", "").lower().endswith(".jpg"):
        success = capture_static_image(info["url"], img_path)
    else:
        success = capture_stream_frame(info["url"], img_path)
        if not success:
            print(f"[{course_id}] 全方式でのリアルタイム取得が困難なため公式サムネイルでフォールバック中...")
            success = capture_fallback_thumbnail(info["videoId"], img_path)

    if success:
        ensure_compressed_image(img_path)
        print(f" -> 成功: {rel_path} ({os.path.getsize(img_path)} bytes)")
        return course_id, True, rel_path
    else:
        print(f" -> 失敗: {course_id} の画像取得ができませんでした。")
        return course_id, False, None

def main():
    parser = argparse.ArgumentParser(description="利尻山ライブカメラ定時撮影スクリプト")
    parser.add_argument("--debug", action="store_true", help="デバッグモード")
    parser.add_argument("--force", action="store_true", help="既存画像があっても強制再撮影する")
    args = parser.parse_args()

    root_dir = get_project_root()
    cams_dir = os.path.join(root_dir, "public", "cams")
    os.makedirs(cams_dir, exist_ok=True)

    now = datetime.now(JST)
    date_str = now.strftime("%Y-%m-%d")
    hour_str = now.strftime("%H") # "05", "11", etc.

    target_dir = os.path.join(cams_dir, date_str)
    os.makedirs(target_dir, exist_ok=True)

    history_file = os.path.join(cams_dir, "history.json")
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
    
    # 手動・定時いずれもタイムスタンプを更新
    history_data["records"][date_str][hour_str]["timestamp"] = now.isoformat()

    print(f"=== 利尻山ライブカメラ 定時撮影処理開始 ({date_str} {hour_str}:00) ===")

    # 3カメラを並列同時処理（待ち時間1/3）
    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = [
            executor.submit(process_camera, course_id, info, target_dir, date_str, hour_str, args.force)
            for course_id, info in CAMERAS.items()
        ]
        for future in as_completed(futures):
            course_id, success, rel_path = future.result()
            if success and rel_path:
                history_data["records"][date_str][hour_str][course_id] = rel_path

    history_data["updatedAt"] = datetime.now(JST).isoformat()
    with open(history_file, "w", encoding="utf-8") as f:
        json.dump(history_data, f, ensure_ascii=False, indent=2)

    print("=== 定時撮影完了 & history.json を更新しました ===")

if __name__ == "__main__":
    main()
