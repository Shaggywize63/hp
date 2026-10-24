'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { db, nowIso, UPLOAD_DIR } = require('../db');
const { authRequired, uploadRequired } = require('../auth');
const { logActivity } = require('../log');

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2 GB
});

// POST /api/videos/:id/assets  (multipart: file, kind, version_label)
router.post('/videos/:id/assets', authRequired, uploadRequired, upload.single('file'), (req, res) => {
  const videoId = Number(req.params.id);
  const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(videoId);
  if (!video) {
    if (req.file) try { fs.unlinkSync(req.file.path); } catch {}
    return res.status(404).json({ error: 'Project not found' });
  }
  if (!req.file) return res.status(400).json({ error: 'No file received' });

  const kind = req.body.kind === 'final' ? 'final' : 'working';
  let versionLabel = String(req.body.version_label || '').trim();
  if (!versionLabel) {
    if (kind === 'final') {
      const n = db.prepare("SELECT COUNT(*) AS c FROM assets WHERE video_id = ? AND kind = 'final'").get(videoId).c;
      versionLabel = n === 0 ? 'Final' : `Final ${n + 1}`;
    } else {
      const n = db.prepare("SELECT COUNT(*) AS c FROM assets WHERE video_id = ? AND kind = 'working'").get(videoId).c;
      versionLabel = `V${n + 1}`;
    }
  }

  const info = db
    .prepare(
      `INSERT INTO assets
        (video_id, kind, version_label, stored_name, original_name, mime, size, uploaded_by, uploaded_name, uploaded_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      videoId, kind, versionLabel, req.file.filename, req.file.originalname,
      req.file.mimetype, req.file.size, req.user.id, req.user.name, nowIso()
    );

  // auto status transitions
  let newStatus = video.status;
  if (kind === 'final') newStatus = 'finalized';
  else if (video.status === 'pending') newStatus = 'under_review';
  if (kind === 'final') {
    // a final upload fulfils any outstanding screensaver request
    db.prepare('UPDATE videos SET status = ?, screensaver_requested = 0, updated_at = ? WHERE id = ?').run(newStatus, nowIso(), videoId);
  } else if (newStatus !== video.status) {
    db.prepare('UPDATE videos SET status = ?, updated_at = ? WHERE id = ?').run(newStatus, nowIso(), videoId);
  } else {
    db.prepare('UPDATE videos SET updated_at = ? WHERE id = ?').run(nowIso(), videoId);
  }

  logActivity({
    videoId, actor: req.user, action: 'asset_uploaded',
    detail: `${kind === 'final' ? 'Final screensaver' : 'Working video'} ${versionLabel} uploaded (${req.file.originalname})`,
  });
  const asset = db.prepare('SELECT id, kind, version_label, original_name, mime, size, uploaded_name, uploaded_at FROM assets WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ asset });
});

function getAsset(id) {
  return db.prepare('SELECT * FROM assets WHERE id = ?').get(Number(id));
}

// GET /api/assets/:id/stream  — supports HTTP range for the video player
router.get('/assets/:id/stream', authRequired, (req, res) => {
  const asset = getAsset(req.params.id);
  if (!asset) return res.status(404).json({ error: 'File not found' });
  const filePath = path.join(UPLOAD_DIR, asset.stored_name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing on disk' });

  const stat = fs.statSync(filePath);
  const total = stat.size;
  const mime = asset.mime || 'application/octet-stream';
  const range = req.headers.range;

  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : total - 1;
    if (isNaN(start) || start < 0) start = 0;
    if (isNaN(end) || end >= total) end = total - 1;
    if (start > end) { start = 0; end = total - 1; }
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': mime,
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': total,
      'Content-Type': mime,
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

// GET /api/assets/:id/download
router.get('/assets/:id/download', authRequired, (req, res) => {
  const asset = getAsset(req.params.id);
  if (!asset) return res.status(404).json({ error: 'File not found' });
  const filePath = path.join(UPLOAD_DIR, asset.stored_name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing on disk' });
  res.download(filePath, asset.original_name);
});

// DELETE /api/assets/:id — uploader or admin
router.delete('/assets/:id', authRequired, (req, res) => {
  const asset = getAsset(req.params.id);
  if (!asset) return res.status(404).json({ error: 'File not found' });
  if (req.user.role !== 'admin' && asset.uploaded_by !== req.user.id) {
    return res.status(403).json({ error: 'You can only delete files you uploaded' });
  }
  try { fs.unlinkSync(path.join(UPLOAD_DIR, asset.stored_name)); } catch {}
  db.prepare('DELETE FROM assets WHERE id = ?').run(asset.id);
  logActivity({ videoId: asset.video_id, actor: req.user, action: 'asset_deleted', detail: `${asset.version_label} removed` });
  res.json({ ok: true });
});

// Multer / payload error handler for this router
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large (max 2 GB)' });
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

module.exports = router;
