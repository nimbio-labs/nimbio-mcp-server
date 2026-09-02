#!/usr/bin/env bash
# The build must be runnable, not merely produced: a server that cannot start is
# not caught by any unit test, and starting is this package's whole job.
#
# With no API key it is expected to exit non-zero — but it must do so with its
# own diagnostic, not a module-resolution or syntax error.
set -uo pipefail

OUT="$(node dist/index.js 2>&1)"
RC=$?

echo "$OUT"

if [ "$RC" -eq 0 ]; then
  echo "::error::server exited 0 with no API key; it should refuse to start" >&2
  exit 1
fi

case "$OUT" in
  *NIMBIO_API_KEY*)
    echo "OK: refused to start with the expected message (exit $RC)"
    ;;
  *)
    echo "::error::unexpected startup failure: $OUT" >&2
    exit 1
    ;;
esac
