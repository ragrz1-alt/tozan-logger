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
  console.log('Fetching YouTube Live page for Oshidomari...');
  const html = await fetchUrl(url);
  
  // Find hlsManifestUrl
  const match = html.match(/"hlsManifestUrl":"([^"]+)"/);
  if (match) {
    const hlsUrl = match[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
    console.log('SUCCESS! Found HLS Manifest URL:', hlsUrl.substring(0, 100));
    
    // Fetch the m3u8 playlist to see what formats/resolutions exist
    const m3u8 = await fetchUrl(hlsUrl);
    console.log('--- m3u8 Playlist Header ---');
    console.log(m3u8.split('\n').slice(0, 15).join('\n'));
  } else {
    console.log('FAILED to find hlsManifestUrl in HTML');
    // Let's check if player response json is there
    const prMatch = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});/);
    if (prMatch) {
      const pr = JSON.parse(prMatch[1]);
      console.log('PlayabilityStatus:', pr.playabilityStatus);
      const hls = pr?.streamingData?.hlsManifestUrl;
      console.log('StreamingData HLS:', hls);
    }
  }
}

main();
