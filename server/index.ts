import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { refineRouter } from './routes/refine.js';
import { transcribeRouter } from './routes/transcribe.js';

dotenv.config();

const app = express();
const port = parseInt(process.env.PORT || '3001', 10);

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.use('/api', refineRouter);
app.use('/api', transcribeRouter);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.listen(port, () => {
  console.log(`comprosody server listening on port ${port}`);
});
