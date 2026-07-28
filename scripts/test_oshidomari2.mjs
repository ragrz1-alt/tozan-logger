import https from 'https';

const url = 'https://www.youtube.com/watch?v=8BwfUCuPcVE';

function fetchUrl(targetUrl) {
  return new Promise((resolve, reject) => {
    https.get(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function main() {
  const html = await fetchUrl(url);
  const prMatch = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});/);
  if (prMatch) {
    const pr = JSON.parse(prMatch[1]);
    console.log('StreamingData keys:', Object.keys(pr?.streamingData || {}));
    if (pr?.streamingData?.formats) {
      console.log('Formats:', pr.streamingData.formats.map(f => ({ itag: f.itag, qualityLabel: f.qualityLabel, mimeType: f.mimeType })));
    }
    if (pr?.streamingData?.adaptiveFormats) {
      console.log('Adaptive count:', pr.streamingData.adaptiveFormats.length);
      console.log('Sample adaptive:', pr.streamingData.adaptiveFormats.slice(0, 3).map(f => ({ itag: f.itag, qualityLabel: f.qualityLabel, mimeType: f.mimeType })));
    }
    console.log('dashManifestUrl:', pr?.streamingData?.dashManifestUrl);
    console.log('hlsManifestUrl:', pr?.streamingData?.hlsManifestUrl);
  }
}

main();
