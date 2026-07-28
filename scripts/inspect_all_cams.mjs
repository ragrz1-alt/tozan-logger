import https from 'https';

const cams = {
  oshidomari: 'https://www.youtube.com/watch?v=8BwfUCuPcVE',
  kutsugata: 'https://www.youtube.com/watch?v=P9stiZVACSg',
  senposhi: 'https://www.youtube.com/watch?v=Mn9EszbHh4Y'
};

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

async function inspectCam(name, url) {
  console.log(`\n=== INSPECTING ${name} (${url}) ===`);
  const html = await fetchUrl(url);
  const prMatch = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});/);
  if (!prMatch) {
    console.log('FAILED to find ytInitialPlayerResponse');
    return;
  }
  const pr = JSON.parse(prMatch[1]);
  const sd = pr.streamingData || {};
  console.log('hlsManifestUrl:', sd.hlsManifestUrl ? 'YES (' + sd.hlsManifestUrl.substring(0, 50) + '...)' : 'NO');
  console.log('dashManifestUrl:', sd.dashManifestUrl ? 'YES' : 'NO');
  console.log('serverAbrStreamingUrl:', sd.serverAbrStreamingUrl ? 'YES' : 'NO');
  if (sd.formats) {
    console.log('formats:', sd.formats.map(f => `${f.itag}(${f.qualityLabel})`));
  }
  if (sd.adaptiveFormats) {
    console.log('adaptiveFormats (first 5):', sd.adaptiveFormats.slice(0, 5).map(f => `${f.itag}(${f.qualityLabel}, ${f.mimeType.split(';')[0]})`));
  }
}

async function main() {
  for (const [name, url] of Object.entries(cams)) {
    await inspectCam(name, url);
  }
}

main();
