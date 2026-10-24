'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { db, nowIso, MASTER_EMAIL } = require('../db');
const { authRequired, adminRequired } = require('../auth');
const { logActivity } = require('../log');
const { publicUser } = require('./auth');

const router = express.Router();
const VALID_ORGS = ['HP', 'Arc WW', 'Kinematic'];
const VALID_ROLES = ['admin', 'user'];

router.use(authRequired, adminRequired);

router.get('/', (req, res) => {
  const users = db
    .prepare('SELECT id, email, name, role, org, can_upload, active, created_at FROM users ORDER BY id')
    .all();
  res.json({ users: users.map((u) => ({ ...u, can_upload: !!u.can_upload, active: !!u.active })) });
});

router.post('/', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const name = String(req.body.name || '').trim();
  const password = String(req.body.password || '');
  const org = VALID_ORGS.includes(req.body.org) ? req.body.org : 'HP';
  const role = VALID_ROLES.includes(req.body.role) ? req.body.role : 'user';
  const canUpload = req.body.can_upload ? 1 : 0;

  if (!email || !name || !password) return res.status(400).json({ error: 'Name, email and password are required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (db.prepare('SELECT id FROM users WHERE lower(email) = ?').get(email)) {
    return res.status(409).json({ error: 'A user with that email already exists' });
  }

  const info = db
    .prepare(
      `INSERT INTO users (email, name, password_hash, role, org, can_upload, active, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
    )
    .run(email, name, bcrypt.hashSync(password, 10), role, org, canUpload, nowIso(), req.user.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  logActivity({ actor: req.user, action: 'user_created', detail: `Created ${role} ${email} (${org})` });
  res.status(201).json({ user: { ...publicUser(user), active: true } });
});

router.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.email === MASTER_EMAIL && (req.body.role === 'user' || req.body.active === false)) {
    return res.status(400).json({ error: 'The master admin cannot be demoted or deactivated' });
  }

  const fields = [];
  const vals = [];
  if (typeof req.body.name === 'string' && req.body.name.trim()) { fields.push('name = ?'); vals.push(req.body.name.trim()); }
  if (VALID_ROLES.includes(req.body.role)) { fields.push('role = ?'); vals.push(req.body.role); }
  if (VALID_ORGS.includes(req.body.org)) { fields.push('org = ?'); vals.push(req.body.org); }
  if (typeof req.body.can_upload === 'boolean') { fields.push('can_upload = ?'); vals.push(req.body.can_upload ? 1 : 0); }
  if (typeof req.body.active === 'boolean') { fields.push('active = ?'); vals.push(req.body.active ? 1 : 0); }
  if (typeof req.body.password === 'string' && req.body.password) {
    if (req.body.password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    fields.push('password_hash = ?'); vals.push(bcrypt.hashSync(req.body.password, 10));
  }
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });

  vals.push(id);
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  logActivity({ actor: req.user, action: 'user_updated', detail: `Updated ${updated.email}` });
  res.json({ user: { ...publicUser(updated), active: !!updated.active } });
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.email === MASTER_EMAIL) return res.status(400).json({ error: 'The master admin cannot be deleted' });
  if (user.id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account' });
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  logActivity({ actor: req.user, action: 'user_deleted', detail: `Deleted ${user.email}` });
  res.json({ ok: true });
});

module.exports = router;
