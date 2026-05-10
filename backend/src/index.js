require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env'), quiet: true });
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const correctRoute = require('./routes/correct');
const healthRoute = require('./routes/health');

// ─── Validate required env vars at startup ───────────────────
// Whisper is now called directly from the Electron main process (no backend hop),
// so this server only proxies Ollama. WHISPER_URL is no longer required here.
const REQUIRED_ENV = ['OLLAMA_URL', 'OLLAMA_MODEL'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.warn(`[ENV] ${key} not set — using default.`);
  }
}

const app = express();
const PORT = process.env.BACKEND_PORT || 3001;
const isProd = process.env.NODE_ENV === 'production';

// CORS — restricted to the Electron renderer origins. file:// is the packaged app,
// localhost:5173 is Vite dev server. cors() without origin set returns the request's
// Origin header which would re-open the door, so we use an explicit allowlist.
app.use(cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173', 'file://'],
}));
app.use(express.json({ limit: '50mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: 'Too many requests' }
});
app.use('/api/', limiter);

// Routes — Whisper transcription is handled in the Electron main process now.
app.use('/api/correct', correctRoute);
app.use('/api/health', healthRoute);
app.use('/api/models', require('./routes/models'));

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handler (Express detects 4-arg signature for error middleware)
// In production we never echo the raw error message back — it can leak file paths
// and internals. The full error is logged server-side.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({
    error: isProd ? 'Internal server error' : (err.message || 'Internal server error'),
  });
});

// Bind on loopback only — this backend is an Electron-internal proxy and has no
// reason to be reachable from the LAN. Combined with the CORS allowlist above,
// this prevents network attackers from abusing the open-proxy / SSRF surface.
const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`Voixify Backend ready on 127.0.0.1:${PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[FATAL] Port ${PORT} already in use — kill the previous instance first.`);
    process.exit(1);
  }
  throw err;
});

// ─── Graceful shutdown ───────────────────────────────────────
// Electron parent sends 'shutdown' via IPC when the app is quitting.
// We close the HTTP server to release the port before exiting.
function gracefulShutdown(source) {
  console.log(`[SHUTDOWN] Received ${source} — closing server…`);
  server.close(() => {
    console.log('[SHUTDOWN] Server closed — port released');
    // Acknowledge to parent (Electron) if IPC channel is open
    if (typeof process.send === 'function') {
      try { process.send('shutdown-ack'); } catch (_) { }
    }
    process.exit(0);
  });
  // Force exit after 3s if server.close() hangs
  setTimeout(() => {
    console.error('[SHUTDOWN] Forced exit after timeout');
    process.exit(1);
  }, 3000);
}

// IPC message from Electron parent process
process.on('message', (msg) => {
  if (msg === 'shutdown') gracefulShutdown('IPC shutdown');
});

// Standard signals (Linux/macOS safety net — also works if run standalone)
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
