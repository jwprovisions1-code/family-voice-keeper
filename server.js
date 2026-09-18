import express from 'express';
import path from 'path';
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

app.get('/healthz', (req, res) => res.send('ok'));

app.get('/' + PAGE_PATH, (req, res) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/', (req, res) => res.status(404).send('not found'));

app.post('/api/chat', async (req, res) => {
  try {
    const history = Array.isArray(req.body.history) ? req.body.history.slice(-12) : [];
    const contents = history.map(m => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: String(m.text).slice(0, 1000) }] }));
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: PERSONA }] }, contents, generationConfig: { maxOutputTokens: 120, temperature: 0.7 } })
    });
    const j = await r.json();
    const text = j.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
    res.json({ text: text.trim() });
  } catch (e) { res.status(500).json({ error: 'chat failed' }); }
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
