'use strict';

const express = require('express');
const { db, nowIso } = require('../db');
const { authRequired } = require('../auth');
const { logActivity } = require('../log');

const router = express.Router();
const VALID_PARTIES = ['HP', 'Arc WW', 'Kinematic'];

// POST /api/videos/:id/feedback
router.post('/videos/:id/feedback', authRequired, (req, res) => {
  const videoId = Number(req.params.id);
  const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(videoId);
  if (!video) return res.status(404).json({ error: 'Project not found' });

  const body = String(req.body.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Feedback cannot be empty' });
  // party defaults to the author's org but can be chosen explicitly
  let party = req.user.org;
  if (VALID_PARTIES.includes(req.body.party)) party = req.body.party;

  const info = db
    .prepare(
      `INSERT INTO feedback (video_id, author_id, author_name, party, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(videoId, req.user.id, req.user.name, party, body, nowIso());

  logActivity({ videoId, actor: req.user, action: 'feedback_added', detail: `${party} feedback added` });
  // posting feedback on a pending project marks it as under review
  if (video.status === 'pending') {
    db.prepare('UPDATE videos SET status = ?, updated_at = ? WHERE id = ?').run('under_review', nowIso(), videoId);
  }
  const fb = db.prepare('SELECT id, author_id, author_name, party, body, created_at FROM feedback WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ feedback: fb });
});

// DELETE /api/feedback/:id — author or admin
router.delete('/feedback/:id', authRequired, (req, res) => {
  const id = Number(req.params.id);
  const fb = db.prepare('SELECT * FROM feedback WHERE id = ?').get(id);
  if (!fb) return res.status(404).json({ error: 'Feedback not found' });
  if (req.user.role !== 'admin' && fb.author_id !== req.user.id) {
    return res.status(403).json({ error: 'You can only delete your own feedback' });
  }
  db.prepare('DELETE FROM feedback WHERE id = ?').run(id);
  logActivity({ videoId: fb.video_id, actor: req.user, action: 'feedback_deleted', detail: `${fb.party} feedback removed` });
  res.json({ ok: true });
});

module.exports = router;
