import http from 'node:http';

// One request, no redirect following or automatic retry (especially for POST).
export function request(method, url, body = '', contentType, { timeout = 8000, signal } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { Accept: contentType === 'application/json' ? 'application/json' : 'text/html', 'Cache-Control': 'no-cache' };
    if (method === 'POST') {
      headers['Content-Type'] = contentType;
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    const req = http.request(url, { method, headers, signal, agent: false }, res => {
      const chunks = []; let length = 0;
      res.on('data', chunk => {
        length += chunk.length;
        if (length > 2 * 1024 * 1024) req.destroy(new Error('FCR response too large'));
        else chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) reject(new Error(`FCR HTTP ${res.statusCode}`));
        else resolve(Buffer.concat(chunks).toString('utf8'));
      });
    });
    // Absolute deadline also covers connection establishment and trickling bodies.
    const timer = setTimeout(() => req.destroy(new Error('FCR request timed out')), timeout);
    req.on('close', () => clearTimeout(timer));
    req.on('error', reject);
    req.end(method === 'POST' ? body : undefined);
  });
}
