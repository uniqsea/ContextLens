#!/bin/bash
set -e

# Activate conda and start agent in background
source "$(conda info --base)/etc/profile.d/conda.sh"
conda activate contextlens

echo "Starting agent on :2026 ..."
(cd agent && langgraph dev --port 2026) &
AGENT_PID=$!

echo "Starting frontend on :3001 ..."
(cd frontend && npm run dev -- --port 3001) &
FRONTEND_PID=$!

# Kill both on Ctrl+C
trap "echo 'Stopping...'; kill $AGENT_PID $FRONTEND_PID 2>/dev/null; exit" SIGINT SIGTERM

wait
