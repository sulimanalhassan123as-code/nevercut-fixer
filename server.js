/* NeverCut server-side video fixer — converts unsupported videos (HEVC etc.) to H.264 */
const http = require('http'), { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const SECRET = process.env.FIX_SECRET || '';
const LIMIT = 250 * 1024 * 1024;
const HEADERS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type,x-fix-secret', 'Access-Control-Allow-Methods': 'POST,GET,OPTIONS' };

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, HEADERS); res.end(); return; }
  if (req.method === 'GET' && (req.url === '/health' || req.url === '/')) {
    res.writeHead(200, { 'Content-Type': 'application/json', ...HEADERS });
    res.end(JSON.stringify({ ok: true, service: 'nevercut-fixer' })); return;
  }
  if (req.method === 'POST' && req.url === '/fix') {
    if (SECRET && req.headers['x-fix-secret'] !== SECRET) { res.writeHead(401, HEADERS); res.end('bad secret'); return; }
    const inPath = path.join(os.tmpdir(), 'nc' + Date.now() + '.in');
    const outPath = inPath.replace(/\.in$/, '.mp4');
    let size = 0, aborted = false;
    req.on('data', c => {
      size += c.length;
      if (size > LIMIT) { aborted = true; req.destroy(); }
    });
    const ws = fs.createWriteStream(inPath);
    ws.on('error', () => { try { res.writeHead(500, HEADERS); res.end('write error'); } catch (e) {} });
    req.on('aborted', () => { aborted = true; try { ws.destroy(); fs.unlinkSync(inPath); } catch (e) {} });
    req.on('end', () => {
      if (aborted) return;
      ws.on('close', () => {
        const ff = spawn('ffmpeg', ['-y', '-i', inPath,
          '-vf', 'scale=min(1280\\,iw):-2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28',
          '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', outPath]);
        let err = '';
        ff.stderr.on('data', d => { err += d; });
        ff.on('error', () => { try { fs.unlinkSync(inPath); } catch (e) {} res.writeHead(500, HEADERS); res.end('ffmpeg error'); });
        ff.on('close', code => {
          try { fs.unlinkSync(inPath); } catch (e) {}
          if (code !== 0) { try { fs.unlinkSync(outPath); } catch (e) {} res.writeHead(422, HEADERS); res.end('convert failed: ' + err.slice(-300)); return; }
          const stat = fs.statSync(outPath);
          res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': stat.size, ...HEADERS });
          fs.createReadStream(outPath).pipe(res).on('close', () => { try { fs.unlinkSync(outPath); } catch (e) {} });
        });
      });
      ws.end();
    });
    req.pipe(ws);
    return;
  }
  res.writeHead(404); res.end();
}).listen(process.env.PORT || 8080, () => console.log('nevercut-fixer listening'));
