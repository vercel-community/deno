#!/bin/bash
set -euo pipefail

# Prepare for `deno.zip` download from GitHub Releases
ROOT_DIR="$(pwd)"
export DENO_DIR="$ROOT_DIR/.deno"
DENO_BIN_DIR="$DENO_DIR/bin"
mkdir -p "$DENO_BIN_DIR"
export PATH="$DENO_BIN_DIR:$PATH"
PLATFORM="unknown-linux-gnu"

# Download `deno`
cd "$DENO_BIN_DIR"
echo "Downloading \`deno\` ${DENO_VERSION}…"
curl -sfLS "https://github.com/denoland/deno/releases/download/${DENO_VERSION}/deno-x86_64-${PLATFORM}.zip" > deno.zip
unzip -oq deno.zip
rm deno.zip
cd "$ROOT_DIR"

echo "Installed \`deno\`:"
deno --version
echo

#cp ${DEBUG:+-v} "$BUILDER/bootstrap" "bootstrap"
cp ${DEBUG:+-v} "$BUILDER/runtime.ts" ".runtime.ts"

echo "Caching imports for \"$ENTRYPOINT\"…"
echo "deno run $* $ENTRYPOINT"
deno run "$@" ".runtime.ts"

# Move the `gen` files to match AWS `/var/task`
#mkdir -p${DEBUG:+v} "$DENO_DIR/gen/file/var"
#mv ${DEBUG:+-v} "$DENO_DIR/gen/file$ROOT_DIR" "$DENO_DIR/gen/file/var/task"
#rm -rf${DEBUG:+v} "$DENO_DIR/gen/file/$(echo "$ROOT_DIR" | awk -F'/' '{print $2}')"
#
#if [ -n "${DEBUG-}" ]; then
#	eval "$(curl -sfLS https://import.sh)"
#	import "static-binaries"
#	static_binaries tree
#	echo
#	echo "Final Lambda tree:"
#	tree -a .
#fi
