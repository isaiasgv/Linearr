#!/bin/bash
# ── Linearr Test Environment ──────────────────────────────────────────────────
# Spins up an isolated Linearr + Tunarr stack for testing.
# Does NOT touch your production data or containers.
#
# Usage:
#   ./test.sh              Start/rebuild the test environment
#   ./test.sh down         Stop and remove test containers
#   ./test.sh reset        Stop, wipe test data, and restart fresh
#   ./test.sh logs         Tail logs from both containers
#
# Access:
#   Linearr:  http://localhost:8780   (admin / test)
#   Tunarr:   http://localhost:8001
# ──────────────────────────────────────────────────────────────────────────────

set -e
COMPOSE="docker compose -f docker-compose.test.yml -p linearr-test"

case "${1:-up}" in
  up|start)
    echo "Starting Linearr test environment..."
    $COMPOSE up --build -d
    echo ""
    echo "  Linearr:  http://localhost:8780  (admin / test)"
    echo "  Tunarr:   http://localhost:8001"
    echo "  Data:     ./test-data/"
    echo ""
    echo "  Stop:     ./test.sh down"
    echo "  Reset:    ./test.sh reset"
    echo "  Logs:     ./test.sh logs"
    ;;

  down|stop)
    echo "Stopping test containers..."
    $COMPOSE down
    echo "Done. Test data preserved in ./test-data/"
    ;;

  reset)
    echo "Resetting test environment (wiping all test data)..."
    $COMPOSE down
    rm -rf ./test-data
    $COMPOSE up --build -d
    echo ""
    echo "  Fresh start at http://localhost:8780"
    ;;

  logs)
    $COMPOSE logs -f
    ;;

  *)
    echo "Usage: ./test.sh [up|down|reset|logs]"
    exit 1
    ;;
esac
