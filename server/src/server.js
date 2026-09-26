import cors from 'cors';
import express from 'express';
import { config } from './config/env.js';
import { errorHandler } from './middleware/errors.js';
import { requireAuth } from './middleware/auth.js';
import { apiRouter } from './routes/api.js';

const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: [config.frontendUrl, 'http://localhost:5173'], methods: ['GET', 'POST', 'PUT', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json({ limit: '1mb' }));
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api', requireAuth, apiRouter);
app.use(errorHandler);

app.listen(config.port, () => console.log(`StockSense API listening on ${config.port}`));