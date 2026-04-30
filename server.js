import express from 'express';

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

// ── CORS abierto ──
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS, HEAD');
  res.header('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

// ── Health check (usado por keep-alive) ──
app.get('/', (req, res) => res.json({ status: 'ok', service: 'animux-relay' }));

// ── Proxy relay ──
app.get('/proxy', async (req, res) => {
  const target = req.query.url;
  if (!target) return res.status(400).json({ error: 'Falta url' });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(target, {
      headers: {
        'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18',
        'Accept': '*/*',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    clearTimeout(timeout);

    // Forzar Content-Type correcto según extensión
    const targetLow = target.toLowerCase();
    let contentType = response.headers.get('content-type') || 'application/octet-stream';
    if (targetLow.includes('.ts'))   contentType = 'video/mp2t';
    else if (targetLow.includes('.m3u8') || targetLow.includes('/play/')) contentType = 'application/x-mpegURL';
    else if (targetLow.includes('.mp4')) contentType = 'video/mp4';
    else if (targetLow.includes('.aac')) contentType = 'audio/aac';

    res.set('Content-Type', contentType);
    res.set('Cache-Control', targetLow.includes('.ts') ? 'public, max-age=30' : 'no-store, no-cache');
    res.status(response.status);

    // Reescribir M3U8 para que segmentos también pasen por este relay
    if (contentType.includes('mpegurl') || contentType.includes('m3u')) {
      const text = await response.text();
      const baseForResolution = response.url || target;
      const baseUrlObj = new URL(baseForResolution);
      const basePath = baseForResolution.substring(0, baseForResolution.lastIndexOf('/') + 1);
      const proxyBase = `${HOST}/proxy?url=`;

      const rewritten = text.split('\n').map(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return line;
        const abs = trimmed.startsWith('http') ? trimmed
          : trimmed.startsWith('/') ? baseUrlObj.origin + trimmed
          : basePath + trimmed;
        return proxyBase + encodeURIComponent(abs);
      }).join('\n');

      return res.send(rewritten);
    }

    // Stream binario (segmentos .ts) — convertir Web Stream a Node.js Stream
    const { Readable } = await import('stream');
    Readable.fromWeb(response.body).pipe(res);

  } catch (err) {
    const isTimeout = err.name === 'AbortError';
    res.status(isTimeout ? 504 : 502).json({ error: err.message, url: target });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Relay proxy corriendo en puerto ${PORT}`);

  // ── Keep-alive: ping cada 10 min para que Render.com no duerma ──
  setInterval(() => {
    fetch(`${HOST}/`)
      .then(() => console.log('💓 Keep-alive ping OK'))
      .catch(err => console.warn('Keep-alive error:', err.message));
  }, 10 * 60 * 1000); // cada 10 minutos
});
