#!/bin/sh
set -e

if nc -z -w 2 backend 4000 2>/dev/null; then
  export VITE_API_PROXY_TARGET="http://backend:4000"
  echo "Proxy API via backend:4000"
elif nc -z -w 2 host.docker.internal 4000 2>/dev/null; then
  export VITE_API_PROXY_TARGET="http://host.docker.internal:4000"
  echo "Proxy API via host.docker.internal:4000"
else
  export VITE_API_PROXY_TARGET="http://localhost:4000"
  echo "Proxy API via localhost:4000"
fi

exec npm run dev -- --host 0.0.0.0 --port 5173
