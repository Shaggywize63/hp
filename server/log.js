'use strict';

const { db, nowIso } = require('./db');

function logActivity({ videoId = null, actor = null, action, detail = '' }) {
  db.prepare(
    `INSERT INTO logs (video_id, actor_id, actor_name, action, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(videoId, actor ? actor.id : null, actor ? actor.name : 'system', action, detail, nowIso());
}

function notify({ videoId = null, type, actor = null, party = null, message = '' }) {
  db.prepare(
    `INSERT INTO notifications (video_id, type, actor_id, actor_name, party, message, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(videoId, type, actor ? actor.id : null, actor ? actor.name : 'system', party, message, nowIso());
}

module.exports = { logActivity, notify };
