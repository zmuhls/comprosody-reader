import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import express from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import {
  createDefaultProfile,
  formatProfileRecord,
  ProfileValidationError,
  validateProfileUpdate,
} from './lib/profile.js';
import {
  IngestionJobError,
  createIngestionJobManager,
} from './lib/ingestion-jobs.js';
import {
  BookmarkValidationError,
  normalizeBookmarkId,
  normalizeBookmarkItem,
} from './lib/bookmarks.js';
import {
  BookmarkLimitError,
  createStore,
  ProfileConflictError,
} from './lib/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);
const deployed = process.env.NODE_ENV === 'production'
  || Boolean(process.env.RAILWAY_ENVIRONMENT_ID);

if (deployed) {
  const invalid = [];
  if (!process.env.READINGS_USERNAME?.trim()) invalid.push('READINGS_USERNAME');
  if (!process.env.READINGS_PASSWORD) invalid.push('READINGS_PASSWORD');
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    invalid.push('SESSION_SECRET');
  }
  if (!process.env.DATABASE_URL?.trim() && !process.env.DATA_PATH?.trim()) {
    invalid.push('DATABASE_URL/DATA_PATH');
  }
  if (invalid.length) throw new Error(`Invalid deployment configuration: ${invalid.join(', ')}`);
}

const username = process.env.READINGS_USERNAME || 'reader';
const email = process.env.READINGS_EMAIL?.trim();
const password = process.env.READINGS_PASSWORD || 'change-me-now';
const secret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const storePath = process.env.DATA_PATH || path.join(__dirname, 'data', 'reader-state.json');
const catalogPath = process.env.CATALOG_PATH || path.join(__dirname, 'catalog.json');
const booksPath = process.env.BOOKS_PATH || path.join(__dirname, 'output');
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
if (!Array.isArray(catalog)) throw new Error('catalog.json must contain an array.');
const catalogBooks = catalog.map((entry) => entry?.book);
if (catalogBooks.some((book) => typeof book !== 'string' || !/^[a-z0-9-]+$/u.test(book))
    || new Set(catalogBooks).size !== catalogBooks.length) {
  throw new Error('catalog.json contains an invalid or duplicate book slug.');
}

const store = createStore({
  connectionString: process.env.DATABASE_URL,
  filename: storePath,
  initialProfile: createDefaultProfile(catalogBooks),
});
const ingestionJobs = createIngestionJobManager({
  maxActiveJobs: 1,
  maxQueuedJobs: 3,
  maxRetainedJobs: 16,
  maxSourceChars: 2_000_000,
  maxEpubBytes: 25_000_000,
  ttlMs: 15 * 60_000,
});
await store.init();

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'blob:'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'", 'blob:'],
      frameSrc: ["'self'", 'blob:'],
      workerSrc: ["'self'", 'blob:'],
      fontSrc: ["'self'", 'data:'],
      upgradeInsecureRequests: deployed ? [] : null,
    },
  },
}));
app.use((_req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
});
app.use(cookieParser());
const standardJson = express.json({ limit: '256kb' });
const ingestionJson = express.json({ limit: '8mb' });
app.use((req, res, next) => {
  if (req.method === 'POST' && req.path === '/api/ingestions') return next();
  return standardJson(req, res, next);
});

function validIp(value) {
  const candidate = Array.isArray(value) ? value[0] : String(value || '').split(',')[0].trim();
  return net.isIP(candidate) ? candidate : undefined;
}

function clientIp(req) {
  if (process.env.RAILWAY_ENVIRONMENT_ID) {
    return validIp(req.headers['x-real-ip'])
      || validIp(req.socket.remoteAddress)
      || 'unknown';
  }
  return validIp(req.socket.remoteAddress) || 'unknown';
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(clientIp(req)),
  message: { error: 'too many sign-in attempts. try again later.' },
});

const ingestionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 6,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(clientIp(req)),
  message: {
    error: 'ingestion_rate_limit',
    message: 'too many ingestion attempts. try again later.',
  },
});

function equal(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function verify(token = '') {
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (!equal(signature, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    return payload.user === username && payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

function accountIdFor(user) {
  return crypto.createHash('sha256').update(`readings:${user}`).digest('hex');
}

function accountScopeFor(accountId) {
  return crypto
    .createHmac('sha256', secret)
    .update(`bookmarks:${accountId}`)
    .digest('base64url');
}

function auth(req, res, next) {
  const session = verify(req.cookies.readings_session);
  if (session) {
    req.accountId = accountIdFor(session.user);
    return next();
  }
  if (req.path.startsWith('/api/') || req.path.startsWith('/books/')) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  return res.redirect('/login.html');
}

function sameOrigin(req, res, next) {
  const origin = req.get('origin');
  const fetchSite = req.get('sec-fetch-site');
  if (!origin) {
    if (fetchSite === 'same-origin') return next();
    return res.status(403).json({
      error: 'invalid_origin',
      message: 'request origin could not be verified.',
    });
  }
  try {
    const parsed = new URL(origin);
    const protocolAllowed = deployed
      ? parsed.protocol === 'https:'
      : ['http:', 'https:'].includes(parsed.protocol);
    if (protocolAllowed && parsed.host === req.get('host')) return next();
  } catch {
    // Rejected below without reflecting the supplied origin.
  }
  return res.status(403).json({
    error: 'invalid_origin',
    message: 'request origin could not be verified.',
  });
}

function knownBook(book) {
  return catalogBooks.includes(book);
}

function rejectUnknownBook(res) {
  return res.status(404).json({ error: 'book_not_found', message: 'book not found.' });
}

function publicIngestionJob(job) {
  const phase = job.progress?.phase;
  const cycle = job.progress?.cycle;
  let stage = 'working';
  if (job.status === 'queued') stage = 'queued';
  else if (job.status === 'cancelling') stage = 'cancelling';
  else if (job.status === 'cancelled') stage = 'cancelled';
  else if (job.status === 'failed') stage = 'not completed';
  else if (job.status === 'completed') stage = 'ready';
  else if (phase === 'prepared') stage = 'preparing extracted text';
  else if (phase === 'packaging') stage = 'packaging epub';
  else if (phase === 'validating') stage = 'checking epub';
  else if (phase === 'remediation' && cycle === 'structure') stage = 'regularizing structure';
  else if (phase === 'remediation' && cycle === 'encoding_ocr') stage = 'repairing encoding residue';
  else if (phase === 'remediation' && cycle === 'fidelity_review') stage = 'checking source fidelity';

  const completed = Number.isFinite(job.progress?.completedSteps)
    ? job.progress.completedSteps
    : null;
  const total = Number.isFinite(job.progress?.totalSteps)
    ? job.progress.totalSteps
    : null;
  return {
    id: job.id,
    status: job.status,
    stage,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    expiresAt: job.expiresAt,
    filename: job.filename,
    progress: {
      label: stage,
      completed,
      total,
      fraction: Number.isFinite(job.progress?.progress) ? job.progress.progress : null,
    },
    events: [{ stage, message: stage }],
    error: job.error ? { code: job.error.code, message: job.error.message } : null,
    resultReady: job.resultReady,
  };
}

function handleIngestionError(error, res, next) {
  if (error instanceof IngestionJobError) {
    return res.status(error.status || 400).json({
      error: error.code,
      message: error.message,
    });
  }
  return next(error);
}

app.get('/health', (_req, res) => res.json({ ok: true }));
app.post('/api/login', loginLimiter, (req, res) => {
  const suppliedName = req.body?.username;
  const validName = equal(suppliedName, username)
    || Boolean(email && equal(suppliedName, email));
  if (!validName || !equal(req.body?.password, password)) {
    return res.status(401).json({ error: 'incorrect sign-in' });
  }
  const token = sign({
    user: username,
    exp: Date.now() + 1000 * 60 * 60 * 24 * 30,
  });
  res.cookie('readings_session', token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: deployed,
    maxAge: 1000 * 60 * 60 * 24 * 30,
  });
  return res.json({ ok: true });
});
app.post('/api/logout', (_req, res) => {
  res.clearCookie('readings_session');
  res.json({ ok: true });
});

app.get('/api/catalog', auth, (_req, res) => res.sendFile(catalogPath));
app.post(
  '/api/ingestions',
  auth,
  sameOrigin,
  ingestionLimiter,
  ingestionJson,
  (req, res, next) => {
    if (!process.env.OLLAMA_API_KEY?.trim()) {
      return res.status(503).json({
        error: 'ingestion_not_configured',
        message: 'ingestion is not configured yet.',
      });
    }
    try {
      return res.status(202).json(publicIngestionJob(ingestionJobs.createJob(req.body)));
    } catch (error) {
      return handleIngestionError(error, res, next);
    }
  },
);
app.get('/api/ingestions/:id', auth, (req, res) => {
  const job = ingestionJobs.getJob(req.params.id);
  if (!job) {
    return res.status(404).json({
      error: 'job_not_found',
      message: 'ingestion job not found.',
    });
  }
  return res.json(publicIngestionJob(job));
});
app.delete('/api/ingestions/:id', auth, sameOrigin, (req, res) => {
  const current = ingestionJobs.getJob(req.params.id);
  if (!current) {
    return res.status(404).json({
      error: 'job_not_found',
      message: 'ingestion job not found.',
    });
  }
  const cancelled = ingestionJobs.cancelJob(req.params.id);
  const job = ingestionJobs.getJob(req.params.id);
  return res.status(cancelled ? 202 : 200).json(publicIngestionJob(job || current));
});
app.get('/api/ingestions/:id/epub', auth, (req, res, next) => {
  try {
    const result = ingestionJobs.getResult(req.params.id);
    const clearCopy = () => result.buffer.fill(0);
    res.once('finish', clearCopy);
    res.once('close', clearCopy);
    res.attachment(result.filename);
    res.type('application/epub+zip');
    res.set('Content-Length', String(result.buffer.length));
    return res.send(result.buffer);
  } catch (error) {
    return handleIngestionError(error, res, next);
  }
});
app.get('/api/profile', auth, async (_req, res) => {
  res.json(formatProfileRecord(await store.getProfile(), catalogBooks));
});
app.put('/api/profile', auth, sameOrigin, async (req, res) => {
  try {
    const update = validateProfileUpdate(req.body, catalogBooks);
    const saved = await store.saveProfile(update.document, update.revision);
    return res.json(formatProfileRecord(saved, catalogBooks));
  } catch (error) {
    if (error instanceof ProfileValidationError) {
      return res.status(400).json({
        error: error.code,
        field: error.field,
        message: error.message,
      });
    }
    if (error instanceof ProfileConflictError) {
      return res.status(409).json({
        error: error.code,
        profile: formatProfileRecord(error.current, catalogBooks),
      });
    }
    throw error;
  }
});
app.get('/books/:slug.epub', auth, (req, res) => {
  if (!knownBook(req.params.slug)) return rejectUnknownBook(res);
  const filename = path.join(booksPath, `${req.params.slug}.epub`);
  if (!fs.existsSync(filename)) return res.sendStatus(404);
  return res.download(filename, `${req.params.slug}.epub`);
});
app.get('/api/annotations/:book', auth, async (req, res) => {
  if (!knownBook(req.params.book)) return rejectUnknownBook(res);
  return res.json(await store.getBookState(req.accountId, req.params.book));
});
app.put('/api/annotations/:book', auth, sameOrigin, async (req, res) => {
  if (!knownBook(req.params.book)) return rejectUnknownBook(res);
  if (!Array.isArray(req.body?.annotations) || req.body.annotations.length > 10000) {
    return res.sendStatus(400);
  }
  await store.saveBookState(
    req.accountId,
    req.params.book,
    req.body.annotations,
    req.body.progress,
  );
  return res.json({ ok: true });
});
app.get('/api/bookmarks/:book', auth, async (req, res) => {
  if (!knownBook(req.params.book)) return rejectUnknownBook(res);
  return res.json({
    accountScope: accountScopeFor(req.accountId),
    bookmarks: await store.getBookmarks(req.accountId, req.params.book),
  });
});
app.put('/api/bookmarks/:book', auth, sameOrigin, async (req, res) => {
  if (!knownBook(req.params.book)) return rejectUnknownBook(res);
  return res.status(410).json({
    error: 'bookmark_list_retired',
    message: 'bookmark lists are no longer replaced as a whole.',
  });
});
app.put('/api/bookmarks/:book/:id', auth, sameOrigin, async (req, res) => {
  if (!knownBook(req.params.book)) return rejectUnknownBook(res);
  try {
    const bookmark = normalizeBookmarkItem(req.params.id, req.body);
    const result = await store.upsertBookmark(req.accountId, req.params.book, bookmark);
    return res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    if (error instanceof BookmarkValidationError) {
      return res.status(400).json({
        error: error.code,
        field: error.field,
        message: error.message,
      });
    }
    if (error instanceof BookmarkLimitError) {
      return res.status(409).json({ error: error.code, message: error.message });
    }
    throw error;
  }
});
app.delete('/api/bookmarks/:book/:id', auth, sameOrigin, async (req, res) => {
  if (!knownBook(req.params.book)) return rejectUnknownBook(res);
  try {
    const id = normalizeBookmarkId(req.params.id);
    return res.json(await store.deleteBookmark(req.accountId, req.params.book, id));
  } catch (error) {
    if (error instanceof BookmarkValidationError) {
      return res.status(400).json({
        error: error.code,
        field: error.field,
        message: error.message,
      });
    }
    if (error instanceof BookmarkLimitError) {
      return res.status(409).json({ error: error.code, message: error.message });
    }
    throw error;
  }
});

app.get('/login.html', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
app.get('/login.js', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.js'));
});
app.get('/styles.css', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'styles.css'));
});
app.get('/theme-bootstrap.js', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'theme-bootstrap.js'));
});
app.get('/grid-motion.js', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'grid-motion.js'));
});
app.use(auth, express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('/*splat', auth, (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.use((error, req, res, _next) => {
  if (res.headersSent) return;
  if (error?.type === 'entity.too.large') {
    return res.status(413).json({
      error: 'payload_too_large',
      message: 'extracted text exceeds the upload limit.',
    });
  }
  if (error instanceof SyntaxError && error?.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: 'invalid_json',
      message: 'request data could not be read.',
    });
  }
  console.error('request failed', {
    method: req.method,
    path: req.path,
    status: 500,
  });
  return res.status(500).json({
    error: 'internal_error',
    message: 'request could not be completed.',
  });
});

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`comprosody reader listening on ${port}`);
});
async function shutdown() {
  ingestionJobs.close();
  server.close();
  await store.close();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
