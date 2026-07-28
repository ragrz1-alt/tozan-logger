import urllib.request
import re

url = "https://www.youtube.com/watch?v=8BwfUCuPcVE"
req = urllib.request.Request(
    url,
    headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
    }
)

html = urllib.request.urlopen(req).read().decode('utf-8', errors='ignore')
matches = re.findall(r'"hlsManifestUrl":"(https://[^"]+)"', html)
if not matches:
    matches = re.findall(r'hlsManifestUrl":"([^"]+)"', html)

if matches:
    hls_url = matches[0].replace('\\u0026', '&').replace('\\/', '/')
    print("SUCCESS_HLS:", hls_url[:100])
else:
    print("FAILED_TO_FIND_HLS")
