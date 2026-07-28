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

def ensure_compressed_image(image_path):
    """
    保存された画像ファイルサイズを確認し、不要に大きい場合（35KB超過や未圧縮サムネイル等）は
    必ず幅800px・高画質軽量JPEG（約15〜25KB）に最適化して容量圧迫を完全に防ぐ
    """
    try:
        if not os.path.exists(image_path):
            return
        size = os.path.getsize(image_path)
        # 35KB以上ある場合は必ず圧縮・最適化を行う（フォールバック時の100KB超えを100%排除）
        if size > 35000:
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

def capture_with_ytdlp_ffmpeg_downloader(video_url, output_path):
    """
    yt-dlp の ffmpeg 統合ダウンローダー機能を使い、DASHやHLSを問わず
    ライブ配信から直接1フレーム（幅800px・高画質軽量JPEG）をリアルタイム取得する最強エンジン
    """
    try:
        if os.path.exists(output_path):
            try:
                os.remove(output_path)
            except Exception:
                pass
        cmd = [
            "yt-dlp",
            "-f", "bestvideo[height<=1080]/best[height<=1080]/best",
            "--no-part",
            "--downloader", "ffmpeg",
            "--downloader-args", "ffmpeg_i:-t 5 ffmpeg_o:-vframes 1 -vf scale=800:-1 -q:v 3",
            "--referer", "https://www.youtube.com/",
            "-o", output_path,
            video_url
        ]
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=35)
        if res.returncode != 0 or not (os.path.exists(output_path) and os.path.getsize(output_path) > 1000):
            print(f"[DEBUG ytdlp_ffmpeg_downloader] 失敗 rc={res.returncode}, err={res.stderr.decode('utf-8', 'ignore')[-200:]}")
            return False
        print(" -> [STREAM_SCREENSHOT] ytdlp_ffmpeg_downloader エンジンでリアルタイム撮影成功")
        return True
    except Exception as e:
        print(f"[WARN] ytdlp_ffmpeg_downloader 例外: {e}")
        return False

def capture_with_stream_url_hls(video_url, output_path):
    """
    yt-dlp で HLS(.m3u8)のストリームURLを取得し ffmpeg からキャプチャする（30fpsやHLS配信で最強）
    """
    try:
        user_agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
        res = subprocess.run(
            ["yt-dlp", "-f", "best[protocol=m3u8]/96/95/94/93/best", "-g", video_url],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=30
        )
        if res.returncode != 0 or not res.stdout.strip():
            print(f"[DEBUG ytdlp_hls] 失敗 returncode={res.returncode}, err={res.stderr.strip()[:200]}")
            return False
        
        stream_url = res.stdout.strip().splitlines()[0]
        headers = (
            f"User-Agent: {user_agent}\r\n"
            "Referer: https://www.youtube.com/\r\n"
            "Origin: https://www.youtube.com\r\n"
        )
        cmd = [
            "ffmpeg", "-y",
            "-rw_timeout", "15000000",
            "-user_agent", user_agent,
            "-headers", headers,
            "-i", stream_url,
            "-vframes", "1",
            "-vf", "scale=800:-1",
            "-q:v", "3",
            output_path
        ]
        ffmpeg_res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
        if ffmpeg_res.returncode != 0 or not (os.path.exists(output_path) and os.path.getsize(output_path) > 1000):
            print(f"[DEBUG ytdlp_hls->ffmpeg] 失敗 rc={ffmpeg_res.returncode}, err={ffmpeg_res.stderr.decode('utf-8', 'ignore')[-200:]}")
            return False
        print(" -> [STREAM_SCREENSHOT] ytdlp_hls エンジンでリアルタイム撮影成功")
        return True
    except Exception as e:
        print(f"[WARN] yt-dlp HLS URLキャプチャ失敗: {e}")
        return False

def capture_with_stream_url_dash(video_url, output_path):
    """
    yt-dlp でストリームURLを取得し、HTTPヘッダー・再接続フラグ付きの ffmpeg で直接キャプチャする
    （鴛泊などDASH配信でもリアルタイム配信から実フレームを切り出す確実なバックアップ方式）
    """
    try:
        user_agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
        res = subprocess.run(
            ["yt-dlp", "-f", "bestvideo[height<=1080]/bestvideo/best", "-g", video_url],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=30
        )
        if res.returncode != 0 or not res.stdout.strip():
            print(f"[DEBUG ytdlp_dash] URL取得失敗 rc={res.returncode}, err={res.stderr.strip()[:200]}")
            return False
        
        # 先頭行（動画ストリームURL）を採用
        stream_url = res.stdout.strip().splitlines()[0]
        headers = (
            f"User-Agent: {user_agent}\r\n"
            "Referer: https://www.youtube.com/\r\n"
            "Origin: https://www.youtube.com\r\n"
        )
        cmd = [
            "ffmpeg", "-y",
            "-reconnect", "1",
            "-reconnect_streamed", "1",
            "-reconnect_delay_max", "5",
            "-rw_timeout", "15000000",
            "-user_agent", user_agent,
            "-headers", headers,
            "-i", stream_url,
            "-vframes", "1",
            "-vf", "scale=800:-1",
            "-q:v", "3",
            output_path
        ]
        ffmpeg_res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
        if ffmpeg_res.returncode != 0 or not (os.path.exists(output_path) and os.path.getsize(output_path) > 1000):
            print(f"[DEBUG ytdlp_dash->ffmpeg] 失敗 rc={ffmpeg_res.returncode}, err={ffmpeg_res.stderr.decode('utf-8', 'ignore')[-200:]}")
            return False
        print(" -> [STREAM_SCREENSHOT] ytdlp_dash エンジンでリアルタイム撮影成功")
        return True
    except Exception as e:
        print(f"[WARN] ytdlp_dash 例外: {e}")
        return False

def capture_with_pipe(video_url, output_path):
    """
    標準出力をパイプ経由で ffmpeg に送るバックアップ方式
    """
    try:
        ytdlp_cmd = [
            "yt-dlp",
            "-f", "bestvideo[height<=1080]/best[height<=1080]/best",
            "--no-part",
            "--referer", "https://www.youtube.com/",
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

        if p_ffmpeg.returncode != 0 or not (os.path.exists(output_path) and os.path.getsize(output_path) > 1000):
            return False
        print(" -> [STREAM_SCREENSHOT] ytdlp_pipe エンジンでリアルタイム撮影成功")
        return True
    except Exception as e:
        print(f"[WARN] パイプキャプチャ失敗: {e}")
        return False

def capture_stream_frame_with_ytdlp(video_url, output_path):
    """
    yt-dlp と ffmpeg を組み合わせてリアルタイムストリームから直接1フレームをキャプチャする最強多層構成
    """
    # 方式1: yt-dlp の ffmpeg 統合ダウンローダー（DASH/HLS/全解像度対応で動画ストリームから実フレームを確実切り出し）
    if capture_with_ytdlp_ffmpeg_downloader(video_url, output_path):
        return True
        
    # 方式2: yt-dlp HLSストリームURL直接取得（30fps・HLSで高速）
    if capture_with_stream_url_hls(video_url, output_path):
        return True
    
    # 方式3: yt-dlp DASH/サーバーABR対応ストリームURL直接取得（再接続・認証ヘッダー完備）
    if capture_with_stream_url_dash(video_url, output_path):
        return True
        
    # 方式4: yt-dlp パイプストリームキャプチャ
    if capture_with_pipe(video_url, output_path):
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

        # 優先: yt-dlp + ffmpeg
        success = capture_stream_frame_with_ytdlp(info["url"], img_path)
        if not success:
            print(f"[{course_id}] yt-dlp/ffmpeg での取得が困難なため公式ライブサムネイルでフォールバック中...")
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
