#!/bin/sh
# Serve the playground over http (default port 8000). Only needed for
# ?script= URLs — opening index.html straight from the filesystem works
# too, including the open… button.
cd "$(dirname "$0")" && exec python3 -m http.server "${1:-8000}"
