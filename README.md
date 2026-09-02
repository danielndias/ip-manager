# IP Manager

A small self-hosted tool for tracking IP addresses on a home network. Create a network from a CIDR block (e.g. `192.168.1.0/24`) and assign a hostname, description, and MAC address to any address in it — no free-typing IPs, you pick from the addresses that subnet actually has.

## Features

- Create networks by CIDR; usable host addresses are computed automatically (network/broadcast excluded).
- Assign a hostname, description, and MAC address to any address, picked from a dropdown of unused addresses in that network.
- Only assigned addresses are listed — the table doesn't pad itself with hundreds of empty rows.
- Import/export hosts as CSV per network via small icon buttons in the network header (columns: `ip`, `hostname`, `description`, `mac_address`; also accepts `ip_address`/`hw_address`, so OPNsense DHCP static-mapping exports work directly). Import upserts by IP and skips rows outside the network or with an invalid MAC.
- Single SQLite file for storage, no external database required.

## Requirements

- Python 3.12+ (for local/dev use)
- Docker + Docker Compose (for deployment)

## Local development

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python app.py
```

The app listens on `http://localhost:5000` by default (binds `0.0.0.0`, so it's also reachable from other devices on your LAN at your machine's IP). Data is stored in `data/ipam.db`, created automatically on first run.

## Deployment (Docker)

The published image is `danielndias/ip-manager:latest` on Docker Hub. `docker-compose.yml` pulls it directly — no build step needed on the deployment host:

```bash
docker compose up -d
```

This exposes the app on `http://<host>:5050` and persists data to `./data/ipam.db` on the host via a bind mount.

To build the image yourself instead of pulling (e.g. after making local code changes):

```bash
docker build -t danielndias/ip-manager:latest .
```

and swap `image:` for `build: .` in `docker-compose.yml`, or run `docker build` then `docker compose up -d` — Compose will use the locally built image if the tag matches.

### Updating to a new version

```bash
docker compose pull
docker compose up -d
```

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `SECRET_KEY` | `dev-secret-change-me` | Signs the Flask session cookie (used for flash messages). Set this to a random value in `docker-compose.yml` before deploying — generate one with `python3 -c "import secrets; print(secrets.token_hex(32))"`. |
| `DATABASE_PATH` | `/data/ipam.db` in Docker, `./data/ipam.db` locally | Path to the SQLite database file. |
| `HOST` | `0.0.0.0` | Bind address (local `python app.py` only; the Docker image always binds `0.0.0.0`). |
| `PORT` | `5000` | Bind port (local `python app.py` only; Docker always listens on `5000` internally — remap externally via `docker-compose.yml`'s `ports:`). |

## Data & backups

Data lives entirely in `data/ipam.db` on whatever host runs the container. Deleting or recreating the *container* is safe — the bind mount means the database survives that. Deleting the *VM/LXC host* is not: make sure that host is included in your regular Proxmox backups (vzdump / Proxmox Backup Server), since the data disk goes with the VM otherwise.

## Limits

Networks are capped at 4096 usable addresses (roughly a `/20` or smaller) to keep the address table from becoming unwieldy.
