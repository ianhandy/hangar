# Hangar

A beautiful, browser-based Docker management dashboard. No Docker Desktop required.

![FunForrest palette — dark bg, gold accents, orange highlights](https://img.shields.io/badge/palette-FunForrest-DDC165)

## Features

- **Container management** — start, stop, restart, remove, live logs, inspect
- **Image management** — list, pull, remove, prune unused
- **Volume & Network views** — inspect, remove, prune
- **Docker Compose awareness** — shows compose project labels
- **Real-time updates** — auto-refreshes every 5 seconds
- **Zero dependencies** — pure HTML/CSS/JS, no build tools

## Quick Start

1. Expose the Docker socket over TCP:

```bash
# Option A: Use the included proxy script
chmod +x proxy.sh
./proxy.sh

# Option B: Manual socat
socat TCP-LISTEN:2375,fork,reuseaddr,bind=127.0.0.1 UNIX-CONNECT:/var/run/docker.sock
```

2. Open `index.html` in your browser

3. Connect to `http://localhost:2375`

## Socket Paths

| Runtime | Socket Path |
|---------|------------|
| Docker Desktop | `/var/run/docker.sock` |
| Colima | `~/.colima/default/docker.sock` |
| OrbStack | `~/.orbstack/run/docker.sock` |

## Security Note

The proxy binds to `127.0.0.1` only — not accessible from other machines. Never expose the Docker socket to the network without authentication.

## License

MIT
