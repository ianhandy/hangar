#!/bin/bash
# Hangar — Docker Socket Proxy
# Exposes the Docker Unix socket over TCP so the browser can reach it.
#
# Usage: ./proxy.sh [port]
# Default port: 2375

PORT="${1:-2375}"
SOCKET="/var/run/docker.sock"

if [ ! -S "$SOCKET" ]; then
    echo "Docker socket not found at $SOCKET"
    echo "If using Colima: SOCKET=\$HOME/.colima/default/docker.sock"
    echo "If using OrbStack: SOCKET=\$HOME/.orbstack/run/docker.sock"
    exit 1
fi

if ! command -v socat &>/dev/null; then
    echo "socat is required. Install with: brew install socat"
    exit 1
fi

echo "Hangar proxy: $SOCKET → http://localhost:$PORT"
echo "Press Ctrl+C to stop"
echo ""

socat TCP-LISTEN:$PORT,fork,reuseaddr,bind=127.0.0.1 UNIX-CONNECT:$SOCKET
