const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const logger = require('./src/utils/logger');
const config = require('./src/utils/config');
const db = require('./database');

const app = express();
const FRONTEND_PATH = path.join(__dirname, '..', 'frontend');

// Доверяем прокси (необходимо для Vercel и правильной работы rate-limit)
app.set('trust proxy', 1);

// ——————————————————————————————
// 1. CORS И БЕЗОПАСНОСТЬ (В САМОМ НАЧАЛЕ)
// ——————————————————————————————

app.use(cors({
  origin: (origin, callback) => {
    const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
    const defaults = [
      'http://localhost:1488',
      'http://localhost:3000',
      'https://lorikowka.github.io'
    ];
    const allAllowed = [...allowed, ...defaults];
    
    if (!origin || allAllowed.some(a => origin.startsWith(a))) {
      callback(null, true);
    } else {
      logger.warn(`Blocked by CORS: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Bot-API-Key']
}));

app.use(helmet({
  contentSecurityPolicy: config.app.nodeEnv === 'production' ? {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://api.yookassa.ru", "https://backendtest-is-hard.vercel.app"],
      frameSrc: ["'self'", "https://yookassa.ru"],
    },
  } : false,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false
}));

// ——————————————————————————————
// 2. ОБЩИЕ MIDDLEWARE
// ——————————————————————————————

app.use(express.json({
  limit: '10kb',
  verify: (req, res, buf) => { req.rawBody = buf.toString('utf8'); }
}));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    logger.info(`[API] ${req.method} ${req.path}`);
  }
  next();
});

// ——————————————————————————————
// 3. ПРОВЕРКА БД (ТОЛЬКО ДЛЯ ТЕХ, КОМУ ОНА НУЖНА)
// ——————————————————————————————

const dbRequiredPaths = ['/api/schedule', '/api/payments', '/api/sessions', '/api/admin'];

app.use((req, res, next) => {
  const needsDb = dbRequiredPaths.some(p => req.path.startsWith(p));
  
  if (needsDb) {
    db.ready.then(() => next()).catch(err => {
      logger.error('Database required but failed: ' + err.message);
      res.status(503).json({ 
        success: false, 
        error: 'Database not available',
        details: err.message
      });
    });
  } else {
    next();
  }
});

// ——————————————————————————————
// 4. МАРШРУТЫ
// ——————————————————————————————
const reviewRoutes = require('./src/routes/reviewRoutes');
const paymentRoutes = require('./src/routes/paymentRoutes');
const sessionRoutes = require('./src/routes/sessionRoutes');
const scheduleRoutes = require('./src/routes/scheduleRoutes');
const adminRoutes = require('./src/routes/adminRoutes');
const serviceRoutes = require('./src/routes/serviceRoutes');

app.use('/api/reviews', reviewRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/schedule', scheduleRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', serviceRoutes); // health, diplomas, services

// ——————————————————————————————
// 5. СТАТИКА И ОШИБКИ
// ——————————————————————————————

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString(), db: 'optional' });
});

app.get('*', (req, res) => {
  res.status(404).json({ success: false, message: 'API Route not found' });
});

// Error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error: ' + err.message);
  res.status(500).json({ success: false, error: err.message });
});

const PORT = process.env.PORT || 1488;
if (require.main === module) {
  app.listen(PORT, () => {
    logger.info(`🚀 Server running on port ${PORT}`);
  });
}

module.exports = app;
