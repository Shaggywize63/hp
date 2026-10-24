'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { db, nowIso, UPLOAD_DIR } = require('../db');
const { authRequired, adminRequired } = require('../auth');
const { logActivity, notify } = require('../log');

const router = express.Router();
const STATUSES = ['pending', 'under_review', 'completed', 'finalized'];

router.use(authRequired);

function assetSummary(videoId) {
  const rows = db
    .prepare('SELECT kind, COUNT(*) AS c FROM assets WHERE video_id = ? GROUP BY kind')
    .all(videoId);
  const out = { working: 0, final: 0 };
  for (const r of rows) out[r.kind] = r.c;
  return out;
}

// GET /api/videos  — list with filters
router.get('/', (req, res) => {
  const { country, status, q, requested } = req.query;
  const where = [];
  const params = [];
  if (country) { where.push('country = ?'); params.push(country); }
  if (status && STATUSES.includes(status)) { where.push('status = ?'); params.push(status); }
  if (requested === '1') { where.push('screensaver_requested = 1'); }
  if (q) { where.push('(code_name LIKE ? OR product_name LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
  const sql = `SELECT * FROM videos ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id`;
  const videos = db.prepare(sql).all(...params).map((v) => {
    const counts = assetSummary(v.id);
    const fb = db.prepare('SELECT COUNT(*) AS c FROM feedback WHERE video_id = ?').get(v.id).c;
    return { ...v, assets: counts, feedback_count: fb };
  });
  res.json({ videos });
});

// GET /api/stats
router.get('/stats', (req, res) => {
  const rows = db.prepare('SELECT status, COUNT(*) AS c FROM videos GROUP BY status').all();
  const stats = { pending: 0, under_review: 0, completed: 0, finalized: 0, total: 0, screensaver_requested: 0 };
  for (const r of rows) { stats[r.status] = r.c; stats.total += r.c; }
  stats.screensaver_requested = db.prepare('SELECT COUNT(*) AS c FROM videos WHERE screensaver_requested = 1').get().c;
  res.json({ stats });
});

// GET /api/videos/:id  — full detail
router.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(id);
  if (!video) return res.status(404).json({ error: 'Project not found' });
  const assets = db
    .prepare('SELECT id, kind, version_label, original_name, mime, size, uploaded_name, uploaded_at FROM assets WHERE video_id = ? ORDER BY id')
    .all(id);
  const feedback = db
    .prepare('SELECT id, author_id, author_name, party, body, created_at FROM feedback WHERE video_id = ? ORDER BY created_at')
    .all(id);
  const logs = db
    .prepare('SELECT action, actor_name, detail, created_at FROM logs WHERE video_id = ? ORDER BY created_at DESC')
    .all(id);
  res.json({ video, assets, feedback, logs });
});

// POST /api/videos  — create a new project (any authenticated user)
router.post('/', (req, res) => {
  const code = String(req.body.code_name || '').trim();
  if (!code) return res.status(400).json({ error: 'Code name is required' });
  const f = (k) => String(req.body[k] || '').trim();
  const info = db
    .prepare(
      `INSERT INTO videos
        (code_name, product_name, country, bg_colour, ratio, processor,
         ksp1, ksp2, ksp3, warranty, ms_office, promo, briefing_date,
         status, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'pending', ?, ?, ?)`
    )
    .run(
      code, f('product_name'), f('country'), f('bg_colour'), f('ratio'), f('processor'),
      f('ksp1'), f('ksp2'), f('ksp3'), f('warranty'), f('ms_office'), f('promo'), f('briefing_date'),
      req.user.id, nowIso(), nowIso()
    );
  logActivity({ videoId: info.lastInsertRowid, actor: req.user, action: 'project_created', detail: `Created project ${code}` });
  res.status(201).json({ video: db.prepare('SELECT * FROM videos WHERE id = ?').get(info.lastInsertRowid) });
});

// PATCH /api/videos/:id — update metadata / status
router.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(id);
  if (!video) return res.status(404).json({ error: 'Project not found' });

  const editable = ['code_name', 'product_name', 'country', 'bg_colour', 'ratio', 'processor',
    'ksp1', 'ksp2', 'ksp3', 'warranty', 'ms_office', 'promo', 'briefing_date'];
  const fields = [];
  const vals = [];
  for (const k of editable) {
    if (typeof req.body[k] === 'string') { fields.push(`${k} = ?`); vals.push(req.body[k].trim()); }
  }
  if (req.body.status && STATUSES.includes(req.body.status)) {
    fields.push('status = ?'); vals.push(req.body.status);
    logActivity({ videoId: id, actor: req.user, action: 'status_changed', detail: `Status → ${req.body.status}` });
  }
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
  fields.push('updated_at = ?'); vals.push(nowIso());
  vals.push(id);
  db.prepare(`UPDATE videos SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
  res.json({ video: db.prepare('SELECT * FROM videos WHERE id = ?').get(id) });
});

// POST /api/videos/:id/request-screensaver — flag that the final screensaver is needed
router.post('/:id/request-screensaver', (req, res) => {
  const id = Number(req.params.id);
  const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(id);
  if (!video) return res.status(404).json({ error: 'Project not found' });
  if (video.status === 'finalized') return res.status(400).json({ error: 'This project is already finalized' });
  db.prepare('UPDATE videos SET screensaver_requested = 1, screensaver_requested_at = ?, screensaver_requested_by = ?, updated_at = ? WHERE id = ?')
    .run(nowIso(), req.user.name, nowIso(), id);
  logActivity({ videoId: id, actor: req.user, action: 'screensaver_requested', detail: `Screensaver file requested for ${video.code_name}` });
  notify({ videoId: id, type: 'request', actor: req.user, message: `Screensaver file requested for ${video.code_name}` });
  res.json({ video: db.prepare('SELECT * FROM videos WHERE id = ?').get(id) });
});

// DELETE /api/videos/:id — admin only
router.delete('/:id', adminRequired, (req, res) => {
  const id = Number(req.params.id);
  const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(id);
  if (!video) return res.status(404).json({ error: 'Project not found' });
  // remove physical files for this project's assets before the cascade delete
  const files = db.prepare('SELECT stored_name FROM assets WHERE video_id = ?').all(id);
  for (const f of files) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, f.stored_name)); } catch { /* ignore */ }
  }
  db.prepare('DELETE FROM videos WHERE id = ?').run(id);
  logActivity({ actor: req.user, action: 'project_deleted', detail: `Deleted project ${video.code_name}` });
  res.json({ ok: true });
});

module.exports = router;
