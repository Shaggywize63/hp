# HP Dynamic Screensaver Dashboard

A self-contained web app to manage the HP **Dynamic Screensaver** production pipeline —
upload working videos, review them with the client, collect feedback from **HP** and
**Arc WW**, and publish the final screensaver. Built from the *Dynamic Screensaver
Master Sheet* workflow (Arc WW shares V1 / V2 → HP reverts with feedback → finalize).

> All timestamps in the UI are shown in **IST (India Standard Time)**.

---

## What it does

- 🔐 **Login & roles** — email/password auth. A seeded **master admin** can create users.
- 👥 **User management** — create HP / Arc WW / Kinematic accounts; grant or revoke the
  **"can upload videos"** permission per user. Admins can always upload.
- 🎬 **Per-project videos** — upload multiple **working versions** (V1, V2, …) and the
  **final screensaver**, each with an in-browser **video player** (HTTP range streaming)
  and **download**.
- 💬 **Threaded feedback** — multiple comments per project, each tagged **HP** or
  **Arc WW** (or Kinematic), with author and IST timestamp. Filter by party.
- 🪵 **Activity log** — every upload, status change and feedback entry is logged per project.
- 📊 **Dashboard counters** — Total, Pending, **Under Review**, **Completed**, **Finalized**
  (a project becomes *Finalized* automatically when a final screensaver is uploaded).
- 📥 **Pre-loaded** with all 66 screensaver projects imported from the master sheet
  (code name, country, colour, ratio, product, processor, KSPs, warranty, MS Office, promo).

---

## Quick start

```bash
npm install
npm start
```

Then open **http://localhost:3000**.

### Master admin (seeded on first run)

| Email | Password |
|---|---|
| `s@kinematicapp.com` | `Manvik@1221` |

> Sign in as the master admin → **Users** tab → create accounts for HP, Arc WW and your
> team, and tick **"Allow uploading videos"** for anyone who should be able to upload.

---

## How the workflow maps to the sheet

| Master sheet | Dashboard |
|---|---|
| `Arc Shared-V1`, `Arc Shared-V2` | Working video versions uploaded by Arc WW |
| `HP Revert` | HP feedback entries on the project |
| Final delivery | Final screensaver upload → status **Finalized** |
| Briefing / colour / ratio / KSP / warranty… | Project metadata (editable) |

### Status lifecycle

- **Pending** — imported, nothing uploaded yet.
- **Under Review** — a working video was uploaded or feedback was posted.
- **Completed** — set manually once review is signed off.
- **Finalized** — a final screensaver file has been uploaded (set automatically).

Status can also be changed manually from the project drawer.

---

## Configuration

Environment variables (all optional):

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `JWT_SECRET` | dev fallback | **Set this in production** to sign auth tokens |

Uploads are limited to **2 GB** per file.

---

## Architecture

```
server/
  index.js          Express app + static hosting
  db.js             SQLite schema, master-admin + sheet seeding
  auth.js           JWT auth, admin & upload permission guards
  log.js            activity logging helper
  seed-data.json    66 projects extracted from the master sheet
  routes/
    auth.js         login, me, change password
    users.js        admin user CRUD + permissions
    videos.js       projects, stats, status
    feedback.js     per-project feedback (HP / Arc WW)
    assets.js       upload, video streaming (range), download
public/
  index.html, app.js, styles.css   single-page front end (no build step)
data/               SQLite database   (created at runtime, git-ignored)
uploads/            uploaded video files (created at runtime, git-ignored)
```

- **Backend:** Node.js + Express + `better-sqlite3`, `bcryptjs`, `jsonwebtoken`, `multer`.
- **Frontend:** dependency-free vanilla JS SPA.
- **Storage:** uploaded files on local disk under `uploads/`; metadata in SQLite under `data/`.

### Data persistence & backup

All state lives in `data/app.db` and the `uploads/` folder. Back those up to preserve
projects, users, videos and feedback. Deleting `data/app.db` re-seeds the master admin and
the 66 projects on next start.

---

## Notes for deployment

- Set a strong `JWT_SECRET`.
- Change the master admin password after first login (top-right **Password** button).
- Put it behind HTTPS (a reverse proxy such as nginx/Caddy) for production use.
- For large video libraries, mount `uploads/` on persistent storage.
