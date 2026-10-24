# Deploying to `kaiyotechnologylabs.com/hp`

This app is a **Node.js server** (Express + SQLite + file uploads), not a static
site, so it needs a host that can run a persistent Node process. It is already
**sub-path aware** — set `BASE_PATH=/hp` and it serves itself (pages, API,
video streaming, downloads) under `/hp`.

## Option 0 — Hostinger **Web Apps** (if your plan has it) ⭐

Hostinger's **Web Apps** feature runs Node/Express apps directly — this app is
compatible (Express backend, Node 18–24, npm). In **hPanel → Web Apps → Create**:

| Field | Value |
|---|---|
| Source | **GitHub** → repository `Shaggywize63/hp`, branch `main` |
| Backend framework | **Express** (auto-detected) |
| Node.js version | **22.x** |
| Install command | `npm install` (default) |
| Build command | *(leave empty — no build step)* |
| Start command | `npm start` |

**Environment variables** (add these):

| Name | Value |
|---|---|
| `JWT_SECRET` | a long random string (e.g. 32+ chars) |
| `BASE_PATH` | `/hp` *(set to match the path the app is served at — see note)* |
| `DATA_DIR` | a path under your home that persists, e.g. `/home/<user>/hp-data` |
| `UPLOAD_DIR` | a persistent path, e.g. `/home/<user>/hp-uploads` |

**Notes**
- **Path (`BASE_PATH`):** set it to whatever path Web Apps serves the app at.
  If it serves at the domain root, use `BASE_PATH=/hp` to reach it at
  `…/hp` (the bare root will then 404). If it gives you a subdomain, set
  `BASE_PATH=` (empty) and use that subdomain. The front end adapts automatically.
- **Persistence:** point `DATA_DIR`/`UPLOAD_DIR` at folders under your home dir so
  the SQLite database and uploaded videos survive redeploys. Create them once
  over SSH: `mkdir -p ~/hp-data ~/hp-uploads`.
- After the first deploy, open the app, sign in as `s@kinematicapp.com` /
  `Manvik@1221`, and change the password.

> ⚠️ Shared hosting throttles CPU, RAM and storage. For a video upload/streaming
> app with real usage, a small VPS (Option A) performs far better.

---

> **If you don't have Web Apps — check what else your plan can do.** Log in to **hPanel** and look for:
> - a **VPS** entry (full SSH/root) → use **Option A**, or
> - a **Node.js** section under your hosting plan (Business / Cloud) → use **Option B**.
> - If you see neither, your plan is static/PHP shared hosting and **cannot run this app**.
>   Either upgrade to a VPS / Node.js-capable plan, or host the Node app elsewhere
>   (Render, Railway, Fly.io) and point `kaiyotechnologylabs.com/hp` at it via a proxy.

---

## Option A — Hostinger VPS (recommended)

### Fastest: one-shot script

On the VPS (via SSH, or hPanel → **VPS → Browser terminal**), run:

```bash
curl -fsSL https://raw.githubusercontent.com/Shaggywize63/hp/main/scripts/deploy-vps.sh | sudo bash
```

It installs Node + PM2 + nginx, clones the repo, starts the app under `/hp`
with a generated `JWT_SECRET`, and prints the one nginx block to paste into your
domain's vhost. Then `nginx -t && systemctl reload nginx` and open
`https://<your-domain>/hp/`.

### Or the manual steps

SSH into the VPS, then:

```bash
# 1. Install Node 18+ (if not present) and PM2
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2

# 2. Get the code
sudo mkdir -p /var/www && cd /var/www
git clone https://github.com/Shaggywize63/hp.git
cd hp
npm install --omit=dev

# 3. Run it under /hp on port 3000, persistent + auto-start on reboot
JWT_SECRET="$(openssl rand -hex 32)" BASE_PATH=/hp PORT=3000 \
  pm2 start server/index.js --name hp-dashboard
pm2 save
pm2 startup   # run the command it prints
```

Then put the public domain in front of it with **nginx** (so `/hp` on port 443
reaches the Node app on port 3000). Add this inside the `server { }` block for
`kaiyotechnologylabs.com`:

```nginx
# HP Screensaver Dashboard
location = /hp { return 301 /hp/; }
location /hp/ {
    proxy_pass http://127.0.0.1:3000;      # keeps the /hp prefix
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    client_max_body_size 2100m;   # allow up to ~2 GB video uploads
    proxy_request_buffering off;  # stream large uploads straight through
    proxy_read_timeout 3600s;     # long uploads/downloads
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

Make sure HTTPS is enabled for the domain (Hostinger provides free SSL in hPanel,
or use certbot). Visit **https://kaiyotechnologylabs.com/hp/**.

Updating later:
```bash
cd /var/www/hp && git pull && npm install --omit=dev && pm2 restart hp-dashboard
```

---

## Option B — Hostinger Node.js hosting (Business / Cloud plan)

In **hPanel → your website → Advanced → Node.js** (name varies by plan):

1. **Create application**
   - **Node version:** 18 or higher
   - **Application root:** upload/clone this repo there (e.g. `domains/kaiyotechnologylabs.com/hp-app`)
   - **Application URL:** `kaiyotechnologylabs.com/hp`
   - **Application startup file:** `server/index.js`
2. **Environment variables:** add
   - `BASE_PATH=/hp`
   - `JWT_SECRET=<a long random string>`
   - (`PORT` is injected by the platform — the app already reads `process.env.PORT`.)
3. Open the app's terminal / "Run NPM install", then **Start** the app.

> Note: on managed Node hosting, uploaded files live on the app's disk. Confirm your
> plan's storage is enough for your videos, and that it allows large request bodies.

---

## Environment variables

| Var | Example | Purpose |
|---|---|---|
| `BASE_PATH` | `/hp` | Serve under a sub-path. Omit for the domain root. |
| `JWT_SECRET` | 32+ random chars | **Required in production** — signs login tokens. |
| `PORT` | `3000` | Port the Node app listens on. |

## After it's live

- Sign in as `s@kinematicapp.com` / `Manvik@1221` and **change the password** immediately
  (top-right → Password).
- Create HP / Arc WW users under **Users** and grant **Allow uploading videos** as needed.
- Back up `data/app.db` and the `uploads/` folder — that's all the state.
