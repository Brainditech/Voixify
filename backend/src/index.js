require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
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
    console.warn(`⚠️  [ENV] ${key} is not set — using default. Set it in .env for production.`);
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎙️  Voixify Backend running on port ${PORT}`);
  console.log(`📡 Whisper API: ${process.env.WHISPER_URL || '(default)'}`);
  console.log(`🤖 Ollama: ${process.env.OLLAMA_URL || '(default)'} (${process.env.OLLAMA_MODEL || '(default)'})\n`);
});
