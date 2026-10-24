'use strict';

const jwt = require('jsonwebtoken');
const { db } = require('./db');

// In production set JWT_SECRET via environment. A stable fallback is derived so
// that tokens survive restarts during local development.
const JWT_SECRET =
  process.env.JWT_SECRET || 'hp-screensaver-dashboard-dev-secret-change-me';
const TOKEN_TTL = '12h';

function signToken(user) {
  return jwt.sign({ uid: user.id }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

function currentUser(req) {
  const header = req.headers.authorization || '';
  // Prefer the Authorization header; fall back to a ?token= query param so that
  // browser-native requests (<video src>, download links) can authenticate too.
  const token = header.startsWith('Bearer ') ? header.slice(7) : (req.query && req.query.token) || null;
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db
      .prepare('SELECT id, email, name, role, org, can_upload, active, notifications_seen_at FROM users WHERE id = ?')
      .get(payload.uid);
    if (!user || !user.active) return null;
    return user;
  } catch {
    return null;
  }
}

function authRequired(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  req.user = user;
  next();
}

function adminRequired(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

function canUpload(user) {
  return !!user && (user.role === 'admin' || user.can_upload === 1);
}

function uploadRequired(req, res, next) {
  if (!canUpload(req.user)) {
    return res.status(403).json({ error: 'You do not have permission to upload videos' });
  }
  next();
}

module.exports = { signToken, currentUser, authRequired, adminRequired, uploadRequired, canUpload };
