import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '1mb' }));

const EL_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const PERSONA = process.env.PERSONA_PROMPT || 'You are a kind elderly mother. Keep answers short, warm and simple.';
const PAGE_PATH = (process.env.PAGE_PATH || 'visit').replace(/^\/+|\/+$/g, '');
// SEC 2026-09-23: API access token (Render env ACCESS_TOKEN). Fail closed when unset.
const ACCESS_TOKEN = process.env.ACCESS_TOKEN || '';
const INDEX_HTML = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const hits = new Map();
function guard(req, res, next) {
  const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
  if (!ACCESS_TOKEN || req.get('x-access-token') !== ACCESS_TOKEN) {
    // SEC 2026-09-24: log failed access (time, method, path, IP). Never log the token value.
    console.warn('[auth-401] ' + JSON.stringify({ ts: new Date().toISOString(), method: req.method, path: req.baseUrl + req.path, ip: ip, token_present: !!req.get('x-access-token') }));
    return res.status(401).json({ error: 'unauthorized' });
  }
  const now = Date.now(), win = 60000, max = 40;
  const arr = (hits.get(ip) || []).filter(t => now - t < win);
  if (arr.length >= max) return res.status(429).json({ error: 'slow down' });
  arr.push(now); hits.set(ip, arr);
  next();
}
app.use('/api', guard);

app.get('/healthz', (req, res) => res.send('ok'));

app.get('/' + PAGE_PATH, (req, res) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Cache-Control', 'no-store');
  res.type('html').send(INDEX_HTML.replace('__ACCESS_TOKEN__', ACCESS_TOKEN));
});
app.get('/', (req, res) => res.status(404).send('not found'));

app.post('/api/chat', async (req, res) => {
  try {
    const history = Array.isArray(req.body.history) ? req.body.history.slice(-12) : [];
    const contents = history.map(m => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: String(m.text).slice(0, 1000) }] }));
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: PERSONA }] }, contents, generationConfig: { maxOutputTokens: 1024, temperature: 0.7 } })
    });
    const j = await r.json();
    if (!r.ok) return res.status(502).json({ error: 'gemini ' + r.status, detail: JSON.stringify(j).slice(0, 300) });
    const text = j.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
    res.json({ text: text.trim(), debug: text ? undefined : JSON.stringify(j).slice(0, 300) });
  } catch (e) { res.status(500).json({ error: 'chat failed', detail: String(e).slice(0, 200) }); }
});

app.post('/api/tts', async (req, res) => {
  try {
    const text = String(req.body.text || '').slice(0, 600);
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': EL_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.75 } })
    });
    if (!r.ok) return res.status(502).json({ error: 'tts failed', status: r.status });
    res.setHeader('Content-Type', 'audio/mpeg');
    const buf = Buffer.from(await r.arrayBuffer());
    res.send(buf);
  } catch (e) { res.status(500).json({ error: 'tts failed' }); }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log('listening on ' + port));

