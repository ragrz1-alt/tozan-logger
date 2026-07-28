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

def capture_with_pipe(video_url, output_path):
    """
    yt-dlp でライブ映像をストリーム受信し、標準出力をパイプ経由で ffmpeg に送ってリアルタイム1フレームを抜き出す
    """
    try:
        # 60fps HLS(301, 300), 30fps HLS(96, 95, 94, 93), または任意の HLS ストリームを優先指定
        # ※鴛泊コースは60fps(フォーマットID: 301/300)配信であるためこれらを明示的に含める
        ytdlp_cmd = [
            "yt-dlp",
            "-f", "best[protocol^=m3u8]/301/300/96/95/94/93/best",
            "--no-part",
            "-o", "-",
            video_url
        ]
        ffmpeg_cmd = [
            "ffmpeg", "-y",
            "-i", "pipe:0",
            "-vframes", "1",
            "-vf", "scale=800:-1",
            "-q:v", "3",
            output_path
        ]
        
        p_ytdlp = subprocess.Popen(ytdlp_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        p_ffmpeg = subprocess.Popen(ffmpeg_cmd, stdin=p_ytdlp.stdout, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        
        ffmpeg_out, ffmpeg_err = p_ffmpeg.communicate(timeout=35)
        
        try:
            p_ytdlp.terminate()
            p_ytdlp.wait(timeout=5)
        except Exception:
            p_ytdlp.kill()

        if p_ffmpeg.returncode == 0 and os.path.exists(output_path) and os.path.getsize(output_path) > 1000:
            return True
        else:
            err_msg = ffmpeg_err.decode('utf-8', errors='ignore') if ffmpeg_err else "Unknown error"
            print(f"[DEBUG] パイプ方式失敗詳細: {err_msg[:200]}")
            return False
    except Exception as e:
        print(f"[WARN] パイプ方式キャプチャ失敗: {e}")
        return False

def capture_with_stream_url(video_url, output_path):
    """
    yt-dlp -g でURLを取得し、User-Agent付きで ffmpeg からキャプチャする
    """
    try:
        user_agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
        res = subprocess.run(
            ["yt-dlp", "-f", "best[protocol^=m3u8]/301/300/96/95/94/93/best", "-g", video_url],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=30
        )
        if res.returncode != 0 or not res.stdout.strip():
            print(f"[DEBUG] yt-dlp -g 失敗詳細: {res.stderr.strip()[:200]}")
            return False
        
        stream_url = res.stdout.strip().splitlines()[0]
        cmd = [
            "ffmpeg", "-y",
            "-user_agent", user_agent,
            "-headers", f"User-Agent: {user_agent}\r\n",
            "-i", stream_url,
            "-vframes", "1",
            "-vf", "scale=800:-1",
            "-q:v", "3",
            output_path
        ]
        ffmpeg_res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=40)
        if ffmpeg_res.returncode == 0 and os.path.exists(output_path) and os.path.getsize(output_path) > 1000:
            return True
        else:
            err_msg = ffmpeg_res.stderr.decode('utf-8', errors='ignore') if ffmpeg_res.stderr else "Unknown error"
            print(f"[DEBUG] ストリームURL方式失敗詳細: {err_msg[:200]}")
            return False
    except Exception as e:
        print(f"[WARN] ストリームURL方式キャプチャ失敗: {e}")
        return False

def capture_stream_frame_with_ytdlp(video_url, output_path):
    """
    yt-dlp と ffmpeg を使用してリアルタイムのライブストリームから直接1フレームをキャプチャする
    """
    # 方式1: yt-dlp -> ffmpeg パイプ直接ストリームキャプチャ
    if capture_with_pipe(video_url, output_path):
        return True
    
    # 方式2: yt-dlp -g + ffmpeg User-Agent指定ストリームキャプチャ
    if capture_with_stream_url(video_url, output_path):
        return True
        
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
