#!/bin/sh
set -eu

cat > /usr/share/nginx/html/config.js <<EOF
window.__APP_CONFIG__ = {
  VITE_STEM_SPLITTER_URL: "${VITE_STEM_SPLITTER_URL:-}"
};
EOF
