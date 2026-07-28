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
from datetime import datetime, timezone, timedelta

# 日本標準時 (JST)
JST = timezone(timedelta(hours=9))

# カメラ定義
CAMERAS = {
    "oshidomari": {
        "name": "鴛泊（富士岬）",
        "videoId": "bAWueJBFcT0",
        "url": "https://www.youtube.com/watch?v=bAWueJBFcT0"
    },
    "kutsugata": {
        "name": "沓形（栄浜）",
        "videoId": "P9stiZVACSg",
        "url": "https://www.youtube.com/watch?v=P9stiZVACSg"
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

def capture_with_ytdlp_url(video_url, output_path, format_selector="best[height<=1080]/best"):
    """
    11時台の正常動作実績と同様に、スマートかつ最も安定している yt-dlp -g でストリームURLを取得し、
    ffmpeg で配信映像から実フレームを1枚直接キャプチャする（〜50KB程度）
    """
    try:
        if os.path.exists(output_path):
            try:
                os.remove(output_path)
            except Exception:
                pass
        # 1. yt-dlp でストリームURLを取得（余計なクライアント偽装やextractor-argsを除外）
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
    スマートかつ安定した yt-dlp / ffmpeg のみを使用したリアルタイムフレーム取得
    """
    # 方式1: 1080p以下のベストストリームを直接取得してキャプチャ（最も高速で50KB程度の高品質）
    if capture_with_ytdlp_url(video_url, output_path, "best[height<=1080]/best"):
        return True
        
    # 方式2: フォーマット指定なし（デフォルト設定）でのURL直接取得
    if capture_with_ytdlp_url(video_url, output_path, "bestvideo/best"):
        return True
        
    # 方式3: パイプストリームキャプチャ
    if capture_with_ytdlp_pipe(video_url, output_path):
        return True
        
    return False

def capture_fallback_thumbnail(video_id, output_path):
    """
    yt-dlp/ffmpeg がない場合やライブ配信の一時不調時は、
    YouTube公式のライブ配信リアルタイムサムネイルを保存するフォールバック機能
    """
    thumb_urls = [
        f"https://i.ytimg.com/vi/{video_id}/maxresdefault_live.jpg",
        f"https://i.ytimg.com/vi/{video_id}/sddefault_live.jpg",
        f"https://i.ytimg.com/vi/{video_id}/hqdefault_live.jpg",
        f"https://i.ytimg.com/vi/{video_id}/mqdefault_live.jpg",
        f"https://i.ytimg.com/vi/{video_id}/maxresdefault.jpg",
        f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"
    ]
    for url in thumb_urls:
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
                    print(f" -> フォールバック成功 URL: {url} ({len(data)} bytes)")
                    return True
        except Exception as e:
            continue
    print(f" -> フォールバック全滅 (videoId={video_id})")
    return False

def main():
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
    
    # 手動実行時でも必ず最新の実行タイムスタンプに更新する
    history_data["records"][date_str][hour_str]["timestamp"] = now.isoformat()

    print(f"=== 利尻山ライブカメラ 定時撮影処理開始 ({date_str} {hour_str}:00) ===")

    for course_id, info in CAMERAS.items():
        img_name = f"{hour_str}_{course_id}.jpg"
        img_path = os.path.join(target_dir, img_name)
        rel_path = f"cams/{date_str}/{img_name}"

        print(f"[{course_id}] ({info['name']}) 撮影試行中...")

        # 優先: yt-dlp + ffmpeg / Playwright
        success = capture_stream_frame(info["url"], img_path)
        if not success:
            print(f"[{course_id}] 全方式でのリアルタイム取得が困難なため公式サムネイルでフォールバック中...")
            success = capture_fallback_thumbnail(info["videoId"], img_path)

        if success:
            ensure_compressed_image(img_path)
            print(f" -> 成功: {rel_path} ({os.path.getsize(img_path)} bytes)")
            history_data["records"][date_str][hour_str][course_id] = rel_path
        else:
            print(f" -> 失敗: {course_id} の画像取得ができませんでした。")

    history_data["updatedAt"] = datetime.now(JST).isoformat()
    with open(history_file, "w", encoding="utf-8") as f:
        json.dump(history_data, f, ensure_ascii=False, indent=2)

    print("=== 定時撮影完了 & history.json を更新しました ===")

if __name__ == "__main__":
    main()
