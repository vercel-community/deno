#!/bin/bash
set -euo pipefail
CWD="$PWD"

# Prepare for `deno.zip` download from GitHub Releases
export DENO_DIR="$ROOT_DIR/.deno"
DENO_BIN_DIR="$DENO_DIR/bin"
mkdir -p "$DENO_BIN_DIR"
export PATH="$DENO_BIN_DIR:$PATH"

ARCH="$(uname -m)"

PLATFORM="unknown-linux-gnu"
if [ "$(uname -o)" = "Darwin" ]; then
  PLATFORM="apple-darwin"
fi

# Download `deno`
cd "$DENO_BIN_DIR"
echo "Downloading \`deno\` ${DENO_VERSION}…"
curl -sfLS "https://github.com/denoland/deno/releases/download/${DENO_VERSION}/deno-${ARCH}-${PLATFORM}.zip" > deno.zip
unzip -oq deno.zip
rm deno.zip
cd "$CWD"

echo "Installed \`deno\`:"
deno --version
echo

cp ${DEBUG:+-v} "$BUILDER/runtime.ts" "$ROOT_DIR"

echo "Caching imports for \"$ENTRYPOINT\"…"
echo "deno run $* $ENTRYPOINT"
ENTRYPOINT="$PWD/$ENTRYPOINT" deno run "$@" "$BUILDER/runtime.ts"

# Move the `gen` files to match AWS `/var/task`
#mkdir -p${DEBUG:+v} "$DENO_DIR/gen/file/var"
#mv ${DEBUG:+-v} "$DENO_DIR/gen/file$PWD" "$DENO_DIR/gen/file/var/task"
#rm -rf${DEBUG:+v} "$DENO_DIR/gen/file/$(echo "$PWD" | awk -F'/' '{print $2}')"

#if [ -n "${DEBUG-}" ]; then
#	eval "$(curl -sfLS https://import.sh)"
#	import "static-binaries"
#	static_binaries tree
#	echo
#	echo "Final Lambda tree:"
#	tree -a .
#fi
