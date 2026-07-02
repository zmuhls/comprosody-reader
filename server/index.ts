import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { refineRouter } from './routes/refine.js';
import { transcribeRouter } from './routes/transcribe.js';
import { shutdownWorker } from './lib/transcribe.js';

dotenv.config();

function requireEnv(): void {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Missing ANTHROPIC_API_KEY. Copy .env.example to .env and fill it in.');
    process.exit(1);
  }
}
requireEnv();

const app = express();
const port = parseInt(process.env.PORT || '3001', 10);

const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
);

if (process.env.NODE_ENV === 'development') {
  allowedOrigins.add('http://localhost:5173');
  allowedOrigins.add('http://127.0.0.1:5173');
}

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} not allowed`));
      }
    },
  })
);

app.use(express.json({ limit: '10mb' }));

// Simple in-memory rate limiter: max 60 requests per minute per IP
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of rateBuckets) {
    if (bucket.resetAt <= now) rateBuckets.delete(ip);
  }
}, 60_000);

app.use('/api', (req, res, next) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  let bucket = rateBuckets.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateBuckets.set(ip, bucket);
  }
  bucket.count++;
  if (bucket.count > RATE_LIMIT_MAX) {
    res.status(429).json({ error: 'Rate limit exceeded. Try again shortly.' });
    return;
  }
  next();
});

// Simple shared-secret auth: if COMPROSODY_API_KEY is set, all /api routes
// require it as a Bearer token. Skipped in development for localhost convenience.
const serverApiKey = process.env.COMPROSODY_API_KEY;
if (serverApiKey && process.env.NODE_ENV !== 'development') {
  app.use('/api', (req, res, next) => {
    const auth = req.get('authorization');
    if (auth === `Bearer ${serverApiKey}`) return next();
    res.status(401).json({ error: 'Unauthorized' });
  });
}

app.use('/api', refineRouter);
app.use('/api', transcribeRouter);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

const server = app.listen(port, () => {
  console.log(`comprosody server listening on port ${port}`);
});

function shutdown() {
  console.log('Shutting down server...');
  shutdownWorker();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
