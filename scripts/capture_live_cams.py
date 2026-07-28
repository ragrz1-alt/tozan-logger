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
        "name": "鴛泊コース（鴛泊）",
        "videoId": "8BwfUCuPcVE",
        "url": "https://www.youtube.com/watch?v=8BwfUCuPcVE"
    },
    "kutsugata": {
        "name": "沓形コース（栄浜）",
        "videoId": "P9stiZVACSg",
        "url": "https://www.youtube.com/watch?v=P9stiZVACSg"
    },
    "senposhi": {
        "name": "仙法志（御崎）",
        "videoId": "Mn9EszbHh4Y",
        "url": "https://www.youtube.com/watch?v=Mn9EszbHh4Y"
    }
}

def get_project_root():
    # scripts ディレクトリの親をプロジェクトルートとする
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def capture_stream_frame_with_ytdlp(video_url, output_path):
    """
    yt-dlp と ffmpeg を使用してストリームURLから1フレームをキャプチャする
    """
    try:
        # 1. yt-dlp でストリームURLを取得
        result = subprocess.run(
            ["yt-dlp", "-g", video_url],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=30
        )
        if result.returncode != 0:
            return False
        
        stream_url = result.stdout.strip().splitlines()[0]
        if not stream_url:
            return False
        
        # 2. ffmpeg でフレーム抽出 (最大幅800pxに縮小)
        cmd = [
            "ffmpeg", "-y",
            "-i", stream_url,
            "-vframes", "1",
            "-vf", "scale=800:-1",
            "-q:v", "3",
            output_path
        ]
        ffmpeg_res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=45)
        return ffmpeg_res.returncode == 0 and os.path.exists(output_path) and os.path.getsize(output_path) > 0
    except Exception as e:
        print(f"[WARN] yt-dlp/ffmpeg 撮影失敗: {e}")
        return False

def capture_fallback_thumbnail(video_id, output_path):
    """
    yt-dlp/ffmpeg がない場合やライブ配信の一時不調時は、
    YouTube公式のライブ配信リアルタイムサムネイルを保存するフォールバック機能
    """
    thumb_urls = [
        f"https://i.ytimg.com/vi/{video_id}/hqdefault_live.jpg",
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
                    return True
        except Exception:
            continue
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
        history_data["records"][date_str][hour_str] = {
            "timestamp": now.isoformat()
        }

    print(f"=== 利尻山ライブカメラ 定時撮影処理開始 ({date_str} {hour_str}:00) ===")

    for course_id, info in CAMERAS.items():
        img_name = f"{hour_str}_{course_id}.jpg"
        img_path = os.path.join(target_dir, img_name)
        rel_path = f"cams/{date_str}/{img_name}"

        print(f"[{course_id}] ({info['name']}) 撮影試行中...")

        # 優先: yt-dlp + ffmpeg
        success = capture_stream_frame_with_ytdlp(info["url"], img_path)
        if not success:
            print(f"[{course_id}] yt-dlp/ffmpeg での取得が困難なため公式ライブサムネイルでフォールバック中...")
            success = capture_fallback_thumbnail(info["videoId"], img_path)

        if success:
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
