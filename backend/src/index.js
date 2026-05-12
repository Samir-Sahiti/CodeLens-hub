require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
require('express-async-errors');

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const repoRoutes     = require('./routes/repo');
const searchRoutes   = require('./routes/search');
const analysisRoutes = require('./routes/analysis');
const authRoutes     = require('./routes/auth');
const reviewRoutes   = require('./routes/review');
const webhookRoutes  = require('./routes/webhooks');
const teamRoutes     = require('./routes/teams');
const fileChatRoutes = require('./routes/fileChat');
const usageRoutes    = require('./routes/usage');
const adminRoutes    = require('./routes/admin');
const toursRoutes    = require('./routes/tours');
const errorHandler   = require('./middleware/errorHandler');

const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Log Redaction (US-039) ────────────────────────────────────────────────────
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

const redact = (args) => {
  return args.map(arg => {
    if (typeof arg === 'string') {
      return arg.replace(/(ghp|gho|ghu|ghs|ghr)_[a-zA-Z0-9]{36,}/g, '[REDACTED_GITHUB_TOKEN]');
    }
    if (arg && typeof arg === 'object') {
      try {
        let str = JSON.stringify(arg);
        if (str.match(/(ghp|gho|ghu|ghs|ghr)_[a-zA-Z0-9]{36,}/)) {
           return JSON.parse(str.replace(/(ghp|gho|ghu|ghs|ghr)_[a-zA-Z0-9]{36,}/g, '[REDACTED_GITHUB_TOKEN]'));
        }
      } catch (e) { /* ignore circular references, etc. */ }
    }
    return arg;
  });
};

console.log = (...args) => originalLog.apply(console, redact(args));
console.error = (...args) => originalError.apply(console, redact(args));
console.warn = (...args) => originalWarn.apply(console, redact(args));

// ── Middleware ────────────────────────────────────────────────────────────────
// Compression must be first so all downstream responses are gzip/brotli encoded.
app.use(compression());
app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000' }));

// Webhook routes use express.raw per-route and must run before express.json()
// so the signature validator receives the original request body bytes.
app.use('/api/webhooks', webhookRoutes);

app.use(express.json());
app.use(morgan('dev'));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',     authRoutes);

app.use('/api/repos',    repoRoutes);
app.use('/api/search',   searchRoutes);
app.use('/api/analysis', analysisRoutes);
app.use('/api/review',   reviewRoutes);
app.use('/api/teams',     teamRoutes);
app.use('/api/file-chat', fileChatRoutes);
app.use('/api/usage',     usageRoutes);
app.use('/api/admin',     adminRoutes);
app.use('/api/repos',    toursRoutes);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ── Error handling ────────────────────────────────────────────────────────────
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`CodeLens API running on http://localhost:${PORT}`);
});
