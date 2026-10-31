#!/bin/sh
# Starts the server on Railway with jemalloc when the build installed it
# (nixpacks.toml). If the file is missing the server starts as before, on the
# default allocator - this never stops the server starting. /health shows which
# one is running ("allocator"). Undo: point startCommand back at npm run start.
for lib in /usr/lib/*/libjemalloc.so.2 /usr/lib/libjemalloc.so.2; do
  if [ -f "$lib" ]; then
    export LD_PRELOAD="$lib"
    # Give freed memory back within about a second, from a background thread.
    export MALLOC_CONF="${MALLOC_CONF:-background_thread:true,dirty_decay_ms:1000,muzzy_decay_ms:0}"
    break
  fi
done
exec node dist/index.js
