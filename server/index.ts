import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { refineRouter } from './routes/refine.js';
import { transcribeRouter } from './routes/transcribe.js';

dotenv.config();

const app = express();
const port = parseInt(process.env.PORT || '3001', 10);

app.use(
  cors({ origin: process.env.CORS_ORIGIN?.split(',') ?? ['http://localhost:5173'] })
);
app.use(express.json({ limit: '10mb' }));

app.use('/api', refineRouter);
app.use('/api', transcribeRouter);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', keyConfigured: Boolean(process.env.OPENROUTER_API_KEY) });
});

app.use(
  (
    err: Error & { status?: number; statusCode?: number },
    _req: Request,
    res: Response,
    next: NextFunction
  ) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    const status = err.status ?? err.statusCode ?? 500;
    res.status(status).json({ error: err.message || 'Internal server error' });
  }
);

app.listen(port, () => {
  console.log(`comprosody server listening on port ${port}`);
});
