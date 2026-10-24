'use strict';

const { db, nowIso } = require('./db');

function logActivity({ videoId = null, actor = null, action, detail = '' }) {
  db.prepare(
    `INSERT INTO logs (video_id, actor_id, actor_name, action, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(videoId, actor ? actor.id : null, actor ? actor.name : 'system', action, detail, nowIso());
}

module.exports = { logActivity };
