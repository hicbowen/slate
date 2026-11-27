#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
    echo '用法: 在 Slate Compose 部署目录运行 slate-compose-data.sh backup|restore <备份目录>' >&2
    exit 2
fi
action=$1
target=$2
case "$action" in
    backup|restore) ;;
    *) echo '操作须为 backup 或 restore' >&2; exit 2 ;;
esac
umask 077
lock=.slate-compose-data.lock
if ! mkdir "$lock"; then
    echo '已有备份或恢复任务，或上次任务的锁仍存在' >&2
    exit 1
fi
resume_slate=0
stage=
cleanup() {
    result=$?
    trap - EXIT
    if [ "$resume_slate" -eq 1 ]; then
        docker compose start slate || result=1
    fi
    if [ -n "$stage" ]; then
        rm -rf -- "$stage"
    fi
    rmdir "$lock"
    exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

checksum() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$@"
    else
        shasum -a 256 "$@"
    fi
}
run_slate() {
    docker compose run -T --rm --no-deps --pull never --user 0:0 --entrypoint sh slate -eu -c "$1"
}
postgres() {
    docker compose exec -T postgres sh -eu -c "$1"
}
running_slate=$(docker compose ps --status running -q slate)

if [ "$action" = backup ]; then
    if [ -e "$target" ] || [ -L "$target" ]; then
        echo '备份目录已存在' >&2
        exit 1
    fi
    stage=$(mktemp -d "$(dirname "$target")/.slate-backup.XXXXXX")
    if [ -n "$running_slate" ]; then
        resume_slate=1
        docker compose stop slate
    fi
    postgres 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-acl' > "$stage/postgres.dump"
    run_slate '
        if [ -d /data/blobs/sha256 ]; then
            tar --exclude="*.tmp" -C /data/blobs -czf - sha256
        else
            empty=$(mktemp -d)
            mkdir "$empty/sha256"
            tar -C "$empty" -czf - sha256
        fi' > "$stage/blobs.tar.gz"
    (
        cd "$stage"
        checksum postgres.dump blobs.tar.gz > SHA256SUMS
    )
    mkdir "$target"
    mv "$stage"/{postgres.dump,blobs.tar.gz,SHA256SUMS} "$target/"
    printf '备份完成 %s\n' "$target"
    exit
fi

if [ -n "$running_slate" ]; then
    echo '恢复目标必须是新部署，请先只启动 PostgreSQL' >&2
    exit 1
fi
(
    cd "$target"
    checksum -c SHA256SUMS
)
listing=$(tar -tzf "$target/blobs.tar.gz")
if [ -z "$listing" ] || printf '%s\n' "$listing" | grep -Ev '^sha256/?$|^sha256/[0-9a-f]{2}/?$|^sha256/[0-9a-f]{2}/[0-9a-f]{64}$'; then
    echo '备份中的 blob 路径无效' >&2
    exit 1
fi
entries=$(tar -tvzf "$target/blobs.tar.gz")
if printf '%s\n' "$entries" | grep -Ev '^[-d]'; then
    echo '备份包含普通文件、目录以外的条目' >&2
    exit 1
fi

tables=$(postgres 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -XAtq -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname = '\''public'\'' AND c.relkind IN ('\''r'\'', '\''p'\'', '\''v'\'', '\''m'\'', '\''S'\'', '\''f'\'');"')
if [ "$tables" != 0 ]; then
    echo 'PostgreSQL 目标库包含数据对象，停止恢复' >&2
    exit 1
fi
postgres 'pg_restore -l >/dev/null' < "$target/postgres.dump"
run_slate '
    if [ -e /data/blobs ] || [ -L /data/blobs ]; then
        echo "目标 blob 目录已存在" >&2
        exit 1
    fi
    staged=$(mktemp -d /data/.slate-restore.XXXXXX)
    trap '\''rm -rf "$staged"'\'' EXIT
    tar -xzf - -C "$staged"
    chown -R 1000:1000 "$staged"
    chmod 755 "$staged"
    mv "$staged" /data/blobs
' < "$target/blobs.tar.gz"
if ! postgres 'pg_restore --exit-on-error --single-transaction --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$target/postgres.dump"; then
    echo '数据库恢复失败。已展开的 blob 保留在目标部署目录，请在重试前检查恢复状态。' >&2
    exit 1
fi
echo '恢复完成，可启动 Slate 服务。'
