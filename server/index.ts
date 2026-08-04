import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { refineRouter } from './routes/refine.js';
import { speechRouter } from './routes/speech.js';
import { transcribeRouter } from './routes/transcribe.js';
import { shutdownWorker } from './lib/transcribe.js';

dotenv.config();

const app = express();
const port = parseInt(process.env.PORT || '3001', 10);
const host = process.env.HOST || '127.0.0.1';
const isLoopbackHost = new Set(['127.0.0.1', '::1', 'localhost']).has(host);

const allowedOrigins = new Set(
  (
    process.env.ALLOWED_ORIGINS
    || process.env.CORS_ORIGIN
    || 'http://localhost:5173,http://127.0.0.1:5173'
  )
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

// Railway and the Readings gateway must be able to probe readiness without
// possessing the service-to-service API credential. Keep this response
// deliberately value-free and register it before auth and rate limiting.
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

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

// Simple shared-secret auth: if COMPROSODY_API_KEY is set, functional /api
// routes require it as a Bearer token. Health remains public for readiness
// probes. Auth is skipped in development on loopback for local convenience.
const serverApiKey = process.env.COMPROSODY_API_KEY;
if (!isLoopbackHost && !serverApiKey) {
  console.error(
    'COMPROSODY_API_KEY is required when HOST is not a loopback address.',
  );
  process.exit(1);
}

if (serverApiKey && (process.env.NODE_ENV !== 'development' || !isLoopbackHost)) {
  app.use('/api', (req, res, next) => {
    const auth = req.get('authorization');
    if (auth === `Bearer ${serverApiKey}`) return next();
    res.status(401).json({ error: 'Unauthorized' });
  });
}

app.use('/api', refineRouter);
app.use('/api', speechRouter);
app.use('/api', transcribeRouter);

// API misses must remain JSON errors instead of falling through to the SPA.
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API route not found' });
});

if (process.env.NODE_ENV === 'production') {
  const distPath = fileURLToPath(new URL('../dist', import.meta.url));
  app.use(express.static(distPath, { index: 'index.html' }));

  // Client-side routes share the same editor shell. The Readings gateway strips
  // `/studio` before forwarding, so the private service serves its built files
  // from `/` while browser-visible URLs remain under `/studio`.
  app.use((req, res, next) => {
    if (req.method !== 'GET') {
      next();
      return;
    }
    res.sendFile('index.html', { root: distPath }, (error) => {
      if (error) next(error);
    });
  });
}

app.use(
  (
    error: Error & { status?: number; statusCode?: number },
    _req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    const status = error.status ?? error.statusCode ?? 500;
    res.status(status).json({
      error: status >= 500
        ? 'Internal server error'
        : error.message || 'Request failed',
    });
  },
);

const server = app.listen(port, host, () => {
  console.log(`Comprosody server listening at http://${host}:${port}`);
});

function shutdown() {
  console.log('Shutting down server...');
  shutdownWorker();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
