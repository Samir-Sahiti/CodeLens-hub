require('dotenv').config();
require('express-async-errors');

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const repoRoutes = require('./routes/repo');
const searchRoutes = require('./routes/search');
const analysisRoutes = require('./routes/analysis');
const authRoutes = require('./routes/auth');
const errorHandler = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000' }));
app.use(express.json());
app.use(morgan('dev'));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/auth', authRoutes);
app.use('/api/repos', repoRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/analysis', analysisRoutes);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ── Error handling ────────────────────────────────────────────────────────────
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`CodeLens API running on http://localhost:${PORT}`);
});
