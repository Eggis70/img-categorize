#!/usr/bin/env bash
# Start the whole money system: paid API + public tunnel + marketplace worker.
set -e
cd "$(dirname "$0")"
mkdir -p data

pgrep -f "node src/[s]erver.js" >/dev/null || { setsid nohup node src/server.js >> data/server.log 2>&1 < /dev/null & echo "server started"; }
pgrep -f "cloudflared [t]unnel" >/dev/null || { setsid nohup "$HOME/bin/cloudflared" tunnel --url http://localhost:4021 >> data/tunnel.log 2>&1 < /dev/null & echo "tunnel started"; }
pgrep -f "node src/[w]orker.js" >/dev/null || { setsid nohup node src/worker.js >> data/worker.log 2>&1 < /dev/null & echo "worker started"; }

sleep 6
grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' data/tunnel.log | tail -1
