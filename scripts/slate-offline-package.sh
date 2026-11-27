#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
    echo '用法: scripts/slate-offline-package.sh <Slate 镜像:版本> <输出.tar.gz> [linux/amd64|linux/arm64]' >&2
    exit 2
fi
image=$1
output=$2
platform=${3:-linux/amd64}
case "$platform" in
    linux/amd64|linux/arm64) ;;
    *) echo '平台须为 linux/amd64 或 linux/arm64' >&2; exit 2 ;;
esac
if ! [[ "${image##*/}" =~ :(v[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.-]+)?|[0-9a-f]{7,40})$ ]]; then
    echo '请使用固定版本或提交镜像标签' >&2
    exit 2
fi
if ! [[ "$image" =~ ^[a-zA-Z0-9._:/-]+$ ]] || [[ "$output" != *.tar.gz || -e "$output" || -L "$output" ]]; then
    echo '请指定有效镜像名和一个尚不存在的 .tar.gz 文件' >&2
    exit 2
fi

root=$(cd "$(dirname "$0")/.." && pwd)
postgres=$(awk '$1 == "postgres:" { pg = 1 } pg && $1 == "image:" { print $2; exit }' "$root/compose.yml")
test -n "$postgres"
stage=$(mktemp -d "$(dirname "$output")/.slate-offline.XXXXXX")
trap 'rm -rf -- "$stage"' EXIT
mkdir "$stage/package"

for ref in "$image" "$postgres"; do
    if ! docker image inspect --platform "$platform" "$ref" >/dev/null 2>&1; then
        docker pull --platform "$platform" "$ref"
    fi
done
docker image save --platform "$platform" -o "$stage/package/images.tar" "$image" "$postgres"
cp "$root/compose.yml" "$stage/package/compose.yml"
printf 'SLATE_IMAGE=%s\n' "$image" > "$stage/package/slate-image.env"
printf 'PLATFORM=%s\nPOSTGRES_IMAGE=%s\n' "$platform" "$postgres" > "$stage/package/images.txt"
(
    cd "$stage/package"
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum images.tar compose.yml slate-image.env images.txt > SHA256SUMS
    else
        shasum -a 256 images.tar compose.yml slate-image.env images.txt > SHA256SUMS
    fi
)
tar -C "$stage/package" -czf "$stage/package.tar.gz" .
# The hard link publishes a complete package without overwriting an existing destination.
ln "$stage/package.tar.gz" "$output"
printf '%s\n' "$output"
