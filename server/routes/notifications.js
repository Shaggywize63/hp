'use strict';

const express = require('express');
const { db, nowIso } = require('../db');
const { authRequired } = require('../auth');

const router = express.Router();

// GET /api/notifications — recent feedback + screensaver requests, with unread count
router.get('/notifications', authRequired, (req, res) => {
  const items = db
    .prepare(
      `SELECT n.id, n.video_id, n.type, n.actor_id, n.actor_name, n.party, n.message, n.created_at,
              v.code_name, v.product_name
         FROM notifications n
         LEFT JOIN videos v ON v.id = n.video_id
        ORDER BY n.created_at DESC
        LIMIT 50`
    )
    .all();
  const seenAt = req.user.notifications_seen_at || '1970-01-01T00:00:00.000Z';
  // unread = created after the user last opened notifications, and not their own action
  const unread = items.filter((i) => i.created_at > seenAt && i.actor_id !== req.user.id).length;
  res.json({ items, unread, seen_at: seenAt });
});

// POST /api/notifications/seen — mark everything seen for this user
router.post('/notifications/seen', authRequired, (req, res) => {
  db.prepare('UPDATE users SET notifications_seen_at = ? WHERE id = ?').run(nowIso(), req.user.id);
  res.json({ ok: true });
});

module.exports = router;
