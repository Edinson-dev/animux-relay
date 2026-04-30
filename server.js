import express from 'express';

const app = express();
const PORT = process.env.PORT || 3000;

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

app.get('/proxy', async (req, res) => {
  const target = req.query.url;
  if (!target) return res.status(400).json({ error: 'Falta url' });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const response = await fetch(target, {
      headers: {
        'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18',
        'Accept': '*/*',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    clearTimeout(timeout);

    let contentType = response.headers.get('content-type') || 'application/octet-stream';
    const targetLow = target.toLowerCase();
    if (targetLow.includes('.ts')) contentType = 'video/mp2t';
    else if (targetLow.includes('.m3u8') || targetLow.includes('/play/')) contentType = 'application/x-mpegURL';

    res.set('Content-Type', contentType);
    res.set('Cache-Control', targetLow.includes('.ts') ? 'public, max-age=30' : 'no-store');

    // Reescribir M3U8
    if (contentType.includes('mpegurl') || contentType.includes('m3u')) {
      const text = await response.text();
      const baseForResolution = response.url || target;
      const baseUrlObj = new URL(baseForResolution);
      const basePath = baseForResolution.substring(0, baseForResolution.lastIndexOf('/') + 1);
      const proxyBase = `${req.protocol}://${req.get('host')}/proxy?url=`;

      const lines = text.split('\n').map(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return line;
        let abs = trimmed.startsWith('http') ? trimmed
          : trimmed.startsWith('/') ? baseUrlObj.origin + trimmed
          : basePath + trimmed;
        return proxyBase + encodeURIComponent(abs);
      });
      return res.send(lines.join('\n'));
    }

    // Stream binario
    const reader = response.body;
    response.body.pipe(res);
  } catch (err) {
    res.status(err.name === 'AbortError' ? 504 : 502).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Relay proxy en puerto ${PORT}`));
