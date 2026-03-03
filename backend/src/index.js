require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env'), quiet: true });
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const transcribeRoute = require('./routes/transcribe');
const correctRoute = require('./routes/correct');
const healthRoute = require('./routes/health');

// ─── Validate required env vars at startup ───────────────────
const REQUIRED_ENV = ['WHISPER_URL', 'OLLAMA_URL', 'OLLAMA_MODEL'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.warn(`[ENV] ${key} not set — using default.`);
  }
}

const app = express();
const PORT = process.env.BACKEND_PORT || 3001;

// Middleware
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: 'Too many requests' }
});
app.use('/api/', limiter);

// Routes
app.use('/api/transcribe', transcribeRoute);
app.use('/api/correct', correctRoute);
app.use('/api/health', healthRoute);
app.use('/api/models', require('./routes/models'));

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handler (Express detects 4-arg signature for error middleware)
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// Normalize WHISPER_URL — strip trailing /transcribe so the call in transcribe.js doesn't duplicate it
const rawWhisperUrl = process.env.WHISPER_URL || 'http://localhost:8000';
process.env.WHISPER_URL = rawWhisperUrl.replace(/\/transcribe\/?$/, '');

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Voixify Backend ready on :${PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[FATAL] Port ${PORT} already in use — kill the previous instance first.`);
    process.exit(1);
  }
  throw err;
});
