# Deployment

**Live:** https://gitweave.gitdate.ink · **Droplet:** `68.183.120.141` (Ubuntu 24.04, 4 vCPU, 7.8 GB)

---

## Pipeline

```
push to main
   └─▶ verify      typecheck all 8 workspaces + 96 engine tests   (deploy is gated on green)
   └─▶ build       3 images in parallel → ghcr.io/<owner>/gitweave-{api,ingest,web}
   │                 tagged :<commit-sha> and :latest, layer-cached in GHA
   └─▶ deploy      scp compose + Caddyfile → write .env from secrets → docker compose pull/up
   └─▶ health      poll /healthz and / until 200, or fail the run
```

Images are built **in CI, not on the droplet**: deploys become a pull rather than a rebuild, and
rolling back is just re-pinning a tag.

### On the droplet

| Path | Purpose |
|---|---|
| `/opt/gitweave/docker-compose.yml` | copied from `docker-compose.prod.yml` each deploy |
| `/opt/gitweave/Caddyfile` | copied from `docker/Caddyfile` each deploy |
| `/opt/gitweave/.env` | **written from GitHub secrets at deploy time, never committed**, mode 600 |

Only Caddy binds a host port. Mongo, Redis and the API are reachable **only** on the private
compose network; `ufw` allows 22, 80 and 443 and nothing else.

---

## Required GitHub configuration

### Secrets — Settings → Secrets and variables → Actions

| Secret | Value |
|---|---|
| `DEPLOY_HOST` | `68.183.120.141` |
| `DEPLOY_USER` | `deploy` |
| `DEPLOY_SSH_KEY` | private half of the dedicated ed25519 deploy key |
| `DEPLOY_KNOWN_HOSTS` | output of `ssh-keyscan 68.183.120.141` |
| `GW_GITHUB_TOKEN` | fine-grained PAT GitWeave uses to read the target repo |
| `GW_GITHUB_TOKENS` | *(optional)* comma-separated pool for a faster backfill |
| `MONGO_PASSWORD` | MongoDB root password |

`GITHUB_TOKEN` is provided automatically and is what pushes to GHCR.

### Variables *(optional)*

| Variable | Default |
|---|---|
| `TARGET_REPO_OWNER` | `PostHog` |
| `TARGET_REPO_NAME` | `posthog` |

---

## Security posture

- **CI never logs in as root.** A dedicated `deploy` user holds a single-purpose ed25519 key and
  is in the `docker` group. The key authorises nothing else.
- **No secrets in the repo.** CI fails the build if a token-shaped string is ever committed, or
  if `.env` becomes tracked. The repo is public, so a leaked PAT would be live on landing.
- **Datastores are not internet-reachable.** No published ports, plus `ufw`.
- **TLS is automatic.** Caddy provisions and renews a Let's Encrypt certificate for
  `gitweave.gitdate.ink`.
- **Docker logs are capped** at 10 MB × 3 per container, so a chatty ingest cannot fill the disk.

### Recommended follow-ups

1. **Rotate the droplet's root password** — it was transmitted in plaintext during setup.
2. **Disable SSH password authentication** now that key auth is proven:
   ```bash
   ssh root@68.183.120.141 \
     "sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config \
      && systemctl reload ssh"
   ```
3. Consider putting the dashboard behind auth. All source data is public GitHub activity, but the
   page names individuals and ranks them.

---

## Operations

```bash
ssh deploy@68.183.120.141
cd /opt/gitweave

docker compose ps                      # what's running
docker compose logs -f ingest          # backfill progress
docker compose logs -f api caddy

curl -s https://gitweave.gitdate.ink/healthz | jq
```

**Roll back** to any previously built commit:

```bash
cd /opt/gitweave
sed -i 's/^IMAGE_TAG=.*/IMAGE_TAG=<old-sha>/' .env
docker compose pull && docker compose up -d
```

**Force a full re-ingest** — Actions → Deploy → *Run workflow* → `backfill: true`.
Normally unnecessary: the worker skips the boot backfill whenever the store is already populated,
and a 15-minute cron keeps it current.

**First boot** takes ~45 minutes to walk the 90-day window. The dashboard fills in progressively —
the ingest re-materialises metrics every 40 pages rather than leaving an empty state for the
whole run.
