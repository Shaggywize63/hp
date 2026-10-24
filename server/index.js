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

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// API routes
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/videos', videosRouter);
app.use('/api', feedbackRouter); // /api/videos/:id/feedback , /api/feedback/:id
app.use('/api', assetsRouter); // /api/videos/:id/assets , /api/assets/:id/...

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// Static frontend
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Generic error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`\n  HP Screensaver Dashboard running at http://localhost:${PORT}\n`);
});
