#!/bin/sh
# Throwaway E2E server on :8787 (in-memory DB, admin = boss@example.com).  Usage: dev-server.sh [logfile] | dev-server.sh stop
pkill -f 'server/index[.]ts' 2>/dev/null && sleep 1
[ "$1" = "stop" ] && exit 0
DATABASE_PATH=:memory: ADMIN_EMAILS=boss@example.com PORT=8787 nohup npx tsx server/index.ts > "${1:-/tmp/bv.log}" 2>&1 &
