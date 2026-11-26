#!/usr/bin/env bash
set -euo pipefail

release_tag="$1"
latest_tag="$(
  git ls-remote --tags --refs origin 'refs/tags/v*' |
    awk '$2 ~ /^refs\/tags\/v[0-9]+\.[0-9]+\.[0-9]+$/ { sub(/^refs\/tags\//, "", $2); print $2 }' |
    sort -V |
    tail -n 1
)"

if [[ "$latest_tag" != "$release_tag" ]]; then
  echo "Release tag must be the newest remote vX.Y.Z tag. Latest tag: ${latest_tag:-none}, requested: $release_tag." >&2
  exit 1
fi
