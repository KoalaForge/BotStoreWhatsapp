# KoalaStore WhatsApp Bot

WhatsApp e-commerce bot powered by [Baileys](https://github.com/WhiskeySockets/Baileys). SaaS-ready: run one number (SINGLE) or many numbers per Mongo-stored config (MULTI).

---

## Features

- **Two run modes** — `SINGLE` (one WA number from env) or `MULTI` (multi-tenant from DB).
- **Payment gateways** — LinkQu, Tokopay, Tripay, Pakasir, Orderkuota, Qrispy. Per-bot creds in MULTI mode (AES-encrypted).
- **QRIS overlay** — composite QR onto branded template at runtime (canvas).
- **API server** — Fastify on `API_PORT` (`/ready` health, `/api/docs` if password set).
- **Mongo auth state** — sessions stored in Mongo, not on disk. Survives container restart.
- **Humanize delays** — randomized typing/idle delays to mimic human (tunable, disable for max speed).
- **PM2 process manager** — auto-restart, memory cap, exp-backoff.
- **Production-grade Docker** — multi-stage build, non-root user, healthcheck, capped logs, tmpfs scratch.

---

## Stack

| Layer | Tech |
|---|---|
| Runtime | Node.js 20 (slim) |
| WA library | Baileys 6.x |
| HTTP | Fastify 4 |
| DB | MongoDB (Mongoose 8) |
| Cache | Redis 7 (optional) |
| Process | PM2 (via `ecosystem.config.js`) |
| Container | Docker + Compose |
| Registry | GHCR (`ghcr.io/koalaforge/koalastore.bot-wa`) |
| CI/CD | GitHub Actions → SSH deploy |

---

## Architecture

```
┌──────────────────────────────────────────────┐
│  GitHub Actions                              │
│  push → build → GHCR → ssh → deploy.sh       │
└──────────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│  Production host (root@koalastore)            │
│  /root/botstore-wa/                           │
│  ├── docker-compose.yml          (bot stack)  │
│  ├── docker-compose.redis.yml    (redis)      │
│  ├── deploy.sh                                │
│  └── instances/<name>/.env       (per-bot)    │
└──────────────────────────────────────────────┘
        │                  │
        ▼                  ▼
  proxy-network        backend
  (reverse proxy)      (internal)
        │                  │
        │            ┌─────┴─────┐
        ▼            ▼           ▼
   wa-saas       wa-master      redis
   wa-master                    (named volume)
```

Networks declared `external: true` — create once on host:
```bash
docker network create proxy-network
docker network create backend
```

---

## Quick Start (Local Dev)

```bash
# 1. Install
npm ci

# 2. Configure
cp .env.example .env
# edit .env — set DATABASE_MONGODB_URI, BOT_MODE, etc.

# 3. Run
npm start
# or with PM2
pm2 start ecosystem.config.js
```

Requires:
- Node.js >= 20
- MongoDB reachable via `DATABASE_MONGODB_URI`
- (Optional) Redis if `REDIS_URL` set

---

## Production Deploy

### Option A — GitHub Actions (recommended)

Push to `main` triggers `.github/workflows/deploy.yml`:

1. Build Docker image, push to GHCR (tags: `latest`, `<short-sha>`).
2. SCP compose files + scripts to `root@koalastore:/root/botstore-wa/`.
3. SSH into host, run rolling `deploy.sh`.
4. Discord webhook notification (if `DISCORD_WEBHOOK_URL` set).

**Required repo secrets** (Settings → Secrets → Actions):

| Secret | Purpose |
|---|---|
| `SSH_HOST` | server hostname/IP |
| `SSH_USER` | `root` |
| `SSH_KEY` | private SSH key |
| `SSH_PORT` | SSH port (e.g. `22`) |
| `GHCR_TOKEN` | PAT with `read:packages` (server pull) |
| `DISCORD_WEBHOOK_URL` | optional notification webhook |

`GITHUB_TOKEN` is auto-injected (used for image push).

### Option B — Manual deploy

```bash
ssh root@koalastore
cd /root/botstore-wa
docker compose pull
./deploy.sh                 # rolling per-service deploy + prune
# or specific service
./deploy.sh wa-saas
```

### One-time server setup

```bash
ssh root@koalastore

# Deploy dir + per-instance env
mkdir -p /root/botstore-wa/instances/{wa-saas,wa-master}
cd /root/botstore-wa

# Env files (NOT shipped by CI — manage manually for security)
nano instances/wa-saas/.env       # uses .env.example as reference
nano instances/wa-master/.env
nano .env                          # holds REDIS_PASSWORD only
chmod 600 .env instances/*/.env

# Docker networks (external in compose)
docker network create proxy-network
docker network create backend

# GHCR login (first time)
echo "$GHCR_PAT" | docker login ghcr.io -u koalaforge --password-stdin

# Start redis (one-time)
docker compose -f docker-compose.redis.yml --env-file .env up -d
```

---

## Environment Variables

See [`.env.example`](.env.example) for the full annotated list. Key vars:

| Var | Required | Notes |
|---|---|---|
| `BOT_MODE` | yes | `SINGLE` or `MULTI` |
| `DATABASE_MONGODB_URI` | yes | Mongo connection string |
| `DATABASE_NAME` | yes | DB name |
| `WHATSAPP_PHONE_NUMBER` | SINGLE only | International format, no `+` |
| `WHITELIST_ID` | yes | Admin JID(s), comma-separated |
| `WA_AUTH_ENCRYPTION_KEY` | MULTI only | 32-byte hex — protects WA sessions |
| `API_KEY` | MULTI only | Bot management API auth |
| `BOT_TOKEN_ENCRYPTION_KEY` | yes | Decrypts gateway creds from DB |
| `DEFAULT_PAYMENT_GATEWAY` | yes | `linkqu`/`tokopay`/`tripay`/... |
| `REDIS_URL` | optional | `redis://:<pw>@redis:6379` in docker net |
| `REDIS_PASSWORD` | if using redis stack | strong secret, used by compose |
| `API_DOCS_PASSWORD` | optional | guards `/api/docs` |

Generate secrets:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
openssl rand -base64 32      # for REDIS_PASSWORD
```

---

## Docker Reference

### Files

```
docker/
├── Dockerfile                  # multi-stage build, runs as `node` user
├── docker-compose.yml          # bot stack (wa-saas, wa-master)
├── docker-compose.redis.yml    # redis stack (password-protected)
├── deploy.sh                   # rolling deploy + prune
└── cleanup.sh                  # standalone deep prune
```

### Storage hardening (built-in)

- **Container logs** — `json-file` capped at `10m × 3` files per service.
- **Bot tmpfs** — `/tmp` mounted ephemeral, capped 64MB.
- **Redis** — `maxmemory 256mb`, `allkeys-lru`, AOF rewrite at 100% / 64MB min.
- **Auto-prune on deploy** — images, build cache, dangling volumes (`>7 days`).
- **Weekly GHCR cleanup** — `.github/workflows/ghcr-cleanup.yml` keeps last 10 tags + `latest`.

Override redis memory cap:
```bash
REDIS_MAXMEMORY=512mb REDIS_MAXMEMORY_POLICY=noeviction \
  docker compose -f docker-compose.redis.yml up -d
```

### Manual cleanup

```bash
cd /root/botstore-wa
./cleanup.sh                   # deep prune (images, builder, volumes, networks)
docker system df               # check disk usage
```

---

## API

When running, Fastify exposes:

| Route | Auth | Purpose |
|---|---|---|
| `GET /ready` | none | health probe (used by docker healthcheck) |
| `GET /api/docs` | `API_DOCS_PASSWORD` | Swagger UI (if password set) |
| `POST /api/bots/*` | `API_KEY` | bot management (MULTI mode) |

Default port: `API_PORT=3000` (override per instance in compose).

---

## Repository Layout

```
.
├── .github/workflows/        # CI/CD (deploy, ghcr-cleanup)
├── docker/                   # Dockerfile + compose + scripts
├── src/
│   ├── api/                  # Fastify routes/controllers/middleware
│   ├── command/              # WA chat commands (public/private/help)
│   ├── core/                 # WaConnection, lifecycle
│   ├── services/             # payment gateways, settings, mode
│   ├── whatsapp/             # Baileys glue, Mongo auth state
│   ├── repositories/         # Mongo data access
│   ├── middleware/           # WA message middleware
│   └── img/                  # QRIS template assets
├── tests/                    # Jest
├── index.js                  # entrypoint
├── ProcessTransaction.js     # payment lifecycle handler
└── ecosystem.config.js       # PM2
```

---

## Troubleshooting

**Healthcheck fails after deploy**
- Check `docker logs <service> --tail 50` for startup errors.
- Common: missing `DATABASE_MONGODB_URI`, unreachable Mongo, bad encryption key.

**Container restarts loop**
- PM2 has `max_restarts: 10`. Past that, container exits.
- Inspect `docker compose logs <service>`.

**Redis connection refused**
- Confirm `backend` network exists and redis is on it: `docker network inspect backend`.
- Verify `REDIS_URL` host is `redis` (not `localhost`) inside compose.

**GHCR pull denied on server**
- `GHCR_TOKEN` PAT expired or missing `read:packages` scope.
- Re-login: `echo $TOKEN | docker login ghcr.io -u koalaforge --password-stdin`.

**Workflow `Sync deploy files` fails**
- SSH key mismatch. Verify `SSH_KEY` secret matches a key in `/root/.ssh/authorized_keys` on host.

---

## License

ISC
