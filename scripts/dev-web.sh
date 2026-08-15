#!/usr/bin/env bash
# Durable local CalClaim web-only server for /dev (including the message-tree tab).
#
# Why this exists:
#   Agents were starting the server with `npx tsx -e '…'` inside Cursor-managed
#   shells. On this machine `npx`/`npm` are aliased to Socket (`socket npx`), and
#   those agent shells get torn down (cleanup / pkill / process-group kill). The
#   child dies with Socket's "Unexpected error: command failed", and the browser
#   shows "unable to connect".
#
# This script starts a host-visible, setsid-detached process via the local
# node_modules tsx binary (never Socket), keeps a pidfile, and is idempotent.
#
# Usage:
#   ./scripts/dev-web.sh ensure   # start if needed (default)
#   ./scripts/dev-web.sh status
#   ./scripts/dev-web.sh stop
#   ./scripts/dev-web.sh restart
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PORT="${PORT:-3000}"
DATA_DIR="${DATA_DIR:-$ROOT/data}"
PID_FILE="${CALCLAIM_DEV_WEB_PID:-$DATA_DIR/dev-web.pid}"
LOG_FILE="${CALCLAIM_DEV_WEB_LOG:-$DATA_DIR/dev-web.log}"
TSX="$ROOT/node_modules/.bin/tsx"
ENTRY="$ROOT/src/dev/webOnly.ts"

mkdir -p "$DATA_DIR"

is_listening() {
  ss -ltn 2>/dev/null | awk -v p=":$PORT" '$4 ~ p"$" { found=1 } END { exit !found }'
}

pid_alive() {
  local pid="${1:-}"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

read_pid() {
  if [[ -f "$PID_FILE" ]]; then
    tr -d '[:space:]' <"$PID_FILE" || true
  fi
}

health_ok() {
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 1 --max-time 2 \
    "http://127.0.0.1:${PORT}/impact" 2>/dev/null || true)"
  [[ "$code" == "200" || "$code" == "302" || "$code" == "301" ]]
}

status() {
  local pid
  pid="$(read_pid)"
  if pid_alive "$pid" && is_listening; then
    echo "dev-web: running pid=$pid port=$PORT"
    echo "  log: $LOG_FILE"
    echo "  tree: http://localhost:${PORT}/dev#tree"
    return 0
  fi
  if is_listening; then
    echo "dev-web: port $PORT is listening but pidfile is stale/missing"
    echo "  tip: ./scripts/dev-web.sh stop && ./scripts/dev-web.sh ensure"
    return 0
  fi
  echo "dev-web: not running (port $PORT free)"
  return 1
}

stop() {
  local pid
  pid="$(read_pid)"
  if pid_alive "$pid"; then
    kill "$pid" 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      pid_alive "$pid" || break
      sleep 0.2
    done
    if pid_alive "$pid"; then
      kill -9 "$pid" 2>/dev/null || true
    fi
    echo "dev-web: stopped pid=$pid"
  else
    echo "dev-web: no pidfile process"
  fi
  rm -f "$PID_FILE"

  # Only free the port if something else still holds it (stale agent shell).
  if is_listening; then
    if command -v fuser >/dev/null 2>&1; then
      fuser -k "${PORT}/tcp" >/dev/null 2>&1 || true
      sleep 0.3
    fi
  fi
}

start() {
  if [[ ! -x "$TSX" ]]; then
    echo "dev-web: missing $TSX – run npm install first" >&2
    exit 1
  fi
  if [[ ! -f "$ENTRY" ]]; then
    echo "dev-web: missing entry $ENTRY" >&2
    exit 1
  fi

  # Detach from agent/Cursor process group so shell teardown cannot kill us.
  # Use local tsx (never `npx` / Socket aliases).
  (
    cd "$ROOT"
    export PORT
    # setsid: new session; nohup: ignore HUP; redirect stdio to log
    setsid nohup "$TSX" "$ENTRY" >>"$LOG_FILE" 2>&1 < /dev/null &
    echo $! >"$PID_FILE"
  )

  local pid
  pid="$(read_pid)"
  for _ in $(seq 1 40); do
    if pid_alive "$pid" && is_listening && health_ok; then
      echo "dev-web: started pid=$pid port=$PORT"
      echo "  log: $LOG_FILE"
      echo "  tree: http://localhost:${PORT}/dev#tree"
      return 0
    fi
    if ! pid_alive "$pid"; then
      echo "dev-web: process exited during startup – last log lines:" >&2
      tail -n 40 "$LOG_FILE" >&2 || true
      rm -f "$PID_FILE"
      exit 1
    fi
    sleep 0.25
  done

  echo "dev-web: started pid=$pid but health check timed out – see $LOG_FILE" >&2
  exit 1
}

ensure() {
  local pid
  pid="$(read_pid)"
  if pid_alive "$pid" && is_listening && health_ok; then
    echo "dev-web: already running pid=$pid port=$PORT"
    echo "  tree: http://localhost:${PORT}/dev#tree"
    return 0
  fi
  if pid_alive "$pid" && ! is_listening; then
    echo "dev-web: stale pid $pid – restarting"
    stop
  elif is_listening && ! health_ok; then
    echo "dev-web: port $PORT busy but unhealthy – restarting"
    stop
  elif is_listening; then
    # Something else healthy on the port – adopt it.
    echo "dev-web: port $PORT already healthy (external process)"
    echo "  tree: http://localhost:${PORT}/dev#tree"
    return 0
  fi
  start
}

cmd="${1:-ensure}"
case "$cmd" in
  ensure|start) ensure ;;
  restart) stop; start ;;
  stop) stop ;;
  status) status ;;
  *)
    echo "Usage: $0 {ensure|start|restart|stop|status}" >&2
    exit 2
    ;;
esac
