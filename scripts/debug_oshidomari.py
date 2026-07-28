#!/usr/bin/env python3
"""
鴛泊 (oshidomari) キャプチャ徹底デバッグスクリプト
全方式を個別にテストし、成功/失敗理由を詳細ログ出力する
"""
import subprocess
import os
import sys
import tempfile

VIDEO_URL = "https://www.youtube.com/watch?v=8BwfUCuPcVE"
VIDEO_ID = "8BwfUCuPcVE"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

def run_cmd(cmd, timeout=30, label=""):
    """コマンドを実行し、stdout/stderr/retcodeをすべてログ出力"""
    print(f"\n{'='*60}")
    print(f"[TEST] {label}")
    print(f"[CMD]  {' '.join(cmd)}")
    try:
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
        stdout = res.stdout.decode('utf-8', errors='ignore')
        stderr = res.stderr.decode('utf-8', errors='ignore')
        print(f"[RC]   {res.returncode}")
        if stdout.strip():
            print(f"[STDOUT] {stdout[:500]}")
        if stderr.strip():
            print(f"[STDERR] {stderr[:1000]}")
        return res
    except subprocess.TimeoutExpired:
        print(f"[TIMEOUT] {timeout}秒でタイムアウト")
        return None
    except Exception as e:
        print(f"[ERROR] {e}")
        return None

def test_ytdlp_version():
    run_cmd(["yt-dlp", "--version"], label="yt-dlp バージョン確認")

def test_ffmpeg_version():
    run_cmd(["ffmpeg", "-version"], label="ffmpeg バージョン確認", timeout=5)

def test_ytdlp_list_formats():
    """鴛泊で利用可能なフォーマット一覧"""
    run_cmd(
        ["yt-dlp", "-F", "--extractor-args", "youtube:player_client=ios,android,web", VIDEO_URL],
        label="yt-dlp -F (利用可能フォーマット一覧)",
        timeout=30
    )

def test_ytdlp_get_url_default():
    """デフォルトフォーマットでURL取得"""
    run_cmd(
        ["yt-dlp", "-f", "bestvideo[height<=1080]/best[height<=1080]/best",
         "--extractor-args", "youtube:player_client=ios,android,web",
         "-g", VIDEO_URL],
        label="yt-dlp -g (デフォルトフォーマットでURL取得)",
        timeout=30
    )

def test_ytdlp_get_url_m3u8():
    """HLS(m3u8)フォーマットでURL取得"""
    run_cmd(
        ["yt-dlp", "-f", "best[protocol=m3u8]/96/95/94/93/best",
         "--extractor-args", "youtube:player_client=ios,android,web",
         "-g", VIDEO_URL],
        label="yt-dlp -g (HLS m3u8優先でURL取得)",
        timeout=30
    )

def test_capture_ffmpeg_downloader():
    """方式1: yt-dlp ffmpeg統合ダウンローダー"""
    out = os.path.join(tempfile.gettempdir(), "test_oshi_method1.jpg")
    if os.path.exists(out):
        os.remove(out)
    res = run_cmd(
        ["yt-dlp", "-f", "bestvideo[height<=1080]/best[height<=1080]/best",
         "--no-part",
         "--extractor-args", "youtube:player_client=ios,android,web",
         "--downloader", "ffmpeg",
         "--downloader-args", "ffmpeg_i:-t 5 ffmpeg_o:-vframes 1 -vf scale=800:-1 -q:v 3",
         "--referer", "https://www.youtube.com/",
         "-o", out,
         VIDEO_URL],
        label="方式1: ytdlp_ffmpeg_downloader",
        timeout=40
    )
    if os.path.exists(out):
        size = os.path.getsize(out)
        print(f"[FILE] {out} => {size} bytes ({'OK' if size > 1000 else 'TOO SMALL'})")
        # ファイルの先頭バイトを確認してJPEGかどうか判定
        with open(out, 'rb') as f:
            header = f.read(4)
            print(f"[HEADER] {header.hex()} ({'JPEG' if header[:2] == b'\\xff\\xd8' else 'NOT JPEG'})")
        os.remove(out)
    else:
        print("[FILE] 出力ファイル生成されず")

def test_capture_stream_url_ffmpeg():
    """方式2: yt-dlp -g でURL取得 → ffmpegで直接キャプチャ"""
    res = run_cmd(
        ["yt-dlp", "-f", "bestvideo[height<=1080]/bestvideo/best",
         "--extractor-args", "youtube:player_client=ios,android,web",
         "-g", VIDEO_URL],
        label="方式2-step1: yt-dlp -g でストリームURL取得",
        timeout=30
    )
    if res and res.returncode == 0 and res.stdout.strip():
        stream_url = res.stdout.decode('utf-8', errors='ignore').strip().splitlines()[0]
        print(f"[URL] {stream_url[:120]}...")
        out = os.path.join(tempfile.gettempdir(), "test_oshi_method2.jpg")
        if os.path.exists(out):
            os.remove(out)
        headers = f"User-Agent: {USER_AGENT}\r\nReferer: https://www.youtube.com/\r\nOrigin: https://www.youtube.com\r\n"
        res2 = run_cmd(
            ["ffmpeg", "-y",
             "-reconnect", "1",
             "-reconnect_streamed", "1",
             "-reconnect_delay_max", "5",
             "-rw_timeout", "15000000",
             "-user_agent", USER_AGENT,
             "-headers", headers,
             "-i", stream_url,
             "-vframes", "1",
             "-vf", "scale=800:-1",
             "-q:v", "3",
             out],
            label="方式2-step2: ffmpegでストリームURL→1フレームキャプチャ",
            timeout=30
        )
        if os.path.exists(out):
            size = os.path.getsize(out)
            print(f"[FILE] {out} => {size} bytes ({'OK' if size > 1000 else 'TOO SMALL'})")
            with open(out, 'rb') as f:
                header = f.read(4)
                print(f"[HEADER] {header.hex()} ({'JPEG' if header[:2] == b'\\xff\\xd8' else 'NOT JPEG'})")
            os.remove(out)
        else:
            print("[FILE] 出力ファイル生成されず")

def test_capture_pipe():
    """方式3: yt-dlp → ffmpeg パイプ"""
    out = os.path.join(tempfile.gettempdir(), "test_oshi_method3.jpg")
    if os.path.exists(out):
        os.remove(out)
    ytdlp_cmd = [
        "yt-dlp",
        "-f", "bestvideo[height<=1080]/best[height<=1080]/best",
        "--no-part",
        "--extractor-args", "youtube:player_client=ios,android,web",
        "--referer", "https://www.youtube.com/",
        "-o", "-",
        VIDEO_URL
    ]
    ffmpeg_cmd = [
        "ffmpeg", "-y",
        "-t", "5",
        "-rw_timeout", "15000000",
        "-i", "pipe:0",
        "-vframes", "1",
        "-vf", "scale=800:-1",
        "-q:v", "3",
        out
    ]
    print(f"\n{'='*60}")
    print(f"[TEST] 方式3: yt-dlp | ffmpeg パイプキャプチャ")
    print(f"[CMD]  {' '.join(ytdlp_cmd)} | {' '.join(ffmpeg_cmd)}")
    try:
        p_ytdlp = subprocess.Popen(ytdlp_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        p_ffmpeg = subprocess.Popen(ffmpeg_cmd, stdin=p_ytdlp.stdout, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        ff_out, ff_err = p_ffmpeg.communicate(timeout=40)
        yt_stderr = b""
        try:
            p_ytdlp.terminate()
            _, yt_stderr = p_ytdlp.communicate(timeout=5)
        except:
            p_ytdlp.kill()
            _, yt_stderr = p_ytdlp.communicate()
        print(f"[RC ffmpeg] {p_ffmpeg.returncode}")
        if ff_err:
            print(f"[STDERR ffmpeg] {ff_err.decode('utf-8', errors='ignore')[:500]}")
        if yt_stderr:
            print(f"[STDERR yt-dlp] {yt_stderr.decode('utf-8', errors='ignore')[:500]}")
        if os.path.exists(out):
            size = os.path.getsize(out)
            print(f"[FILE] {out} => {size} bytes ({'OK' if size > 1000 else 'TOO SMALL'})")
            os.remove(out)
        else:
            print("[FILE] 出力ファイル生成されず")
    except Exception as e:
        print(f"[ERROR] {e}")

def test_thumbnail_fallback():
    """サムネイルフォールバック"""
    import urllib.request
    urls = [
        f"https://i.ytimg.com/vi/{VIDEO_ID}/maxresdefault_live.jpg",
        f"https://i.ytimg.com/vi/{VIDEO_ID}/sddefault_live.jpg",
        f"https://i.ytimg.com/vi/{VIDEO_ID}/hqdefault_live.jpg",
    ]
    for url in urls:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=10) as res:
                data = res.read()
                print(f"[THUMB] {url.split('/')[-1]} => {len(data)} bytes (status={res.status})")
        except Exception as e:
            print(f"[THUMB] {url.split('/')[-1]} => ERROR: {e}")

if __name__ == "__main__":
    print("=" * 60)
    print("鴛泊 (oshidomari) キャプチャ徹底デバッグ開始")
    print("=" * 60)
    test_ytdlp_version()
    test_ffmpeg_version()
    test_ytdlp_list_formats()
    test_ytdlp_get_url_default()
    test_ytdlp_get_url_m3u8()
    test_capture_ffmpeg_downloader()
    test_capture_stream_url_ffmpeg()
    test_capture_pipe()
    test_thumbnail_fallback()
    print("\n" + "=" * 60)
    print("鴛泊デバッグ完了")
    print("=" * 60)
