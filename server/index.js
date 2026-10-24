'use strict';

const path = require('path');
const express = require('express');

require('./db'); // initialise DB + seed on startup

const { router: authRouter } = require('./routes/auth');
const usersRouter = require('./routes/users');
const videosRouter = require('./routes/videos');
const feedbackRouter = require('./routes/feedback');
const assetsRouter = require('./routes/assets');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve under a sub-path (e.g. BASE_PATH=/hp -> https://example.com/hp).
// Leave unset to serve at the domain root. The front end derives the same
// prefix from the page URL, so no rebuild is needed.
const BASE = process.env.BASE_PATH ? '/' + process.env.BASE_PATH.replace(/^\/+|\/+$/g, '') : '';

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

const router = express.Router();

// API routes
router.use('/api/auth', authRouter);
router.use('/api/users', usersRouter);
router.use('/api/videos', videosRouter);
router.use('/api', feedbackRouter); // /api/videos/:id/feedback , /api/feedback/:id
router.use('/api', assetsRouter);   // /api/videos/:id/assets , /api/assets/:id/...

router.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString(), base: BASE || '/' }));

// Static frontend
router.use(express.static(path.join(__dirname, '..', 'public')));
router.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// When hosted under a sub-path, redirect the bare prefix to its trailing-slash
// form so the browser resolves relative asset URLs correctly.
if (BASE) {
  app.get(BASE, (req, res, next) => {
    // only the bare prefix (no trailing slash) redirects; "/hp/" falls through
    if (req.path === BASE) return res.redirect(301, BASE + '/');
    next();
  });
}
app.use(BASE || '/', router);

// Generic error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  const where = BASE || '';
  console.log(`\n  HP Screensaver Dashboard running at http://localhost:${PORT}${where}/\n`);
});
