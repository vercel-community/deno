#!/bin/bash
set -euo pipefail

# Version of `deno` to install
DENO_VERSION="1.0.5"

export NO_COLOR=1

# Prepare for `deno.zip` download from GitHub Releases
ROOT_DIR="$(pwd)"
export DENO_DIR="$ROOT_DIR/.deno"
DENO_BIN_DIR="$DENO_DIR/bin"
mkdir -p "$DENO_BIN_DIR"
export PATH="$DENO_BIN_DIR:$PATH"

# Download `deno`
cd "$DENO_BIN_DIR"
echo "Downloading \`deno\` v${DENO_VERSION}…"
curl -sfLS "https://github.com/denoland/deno/releases/download/v${DENO_VERSION}/deno-x86_64-unknown-linux-gnu.zip" > deno.zip
unzip -q deno.zip
rm deno.zip
cd "$ROOT_DIR"

echo "Installed \`deno\`:"
deno --version
echo

cp "$BUILDER/bootstrap" "bootstrap"
cp "$BUILDER/runtime.ts" ".runtime.ts"

echo "Caching imports for \"$ENTRYPOINT\"…"
deno cache "$ENTRYPOINT" ".runtime.ts"

# Move the `gen` files to match AWS `/var/task`
mkdir -p "$DENO_DIR/gen/file/var"
mv "$DENO_DIR/gen/file$ROOT_DIR" "$DENO_DIR/gen/file/var/task"
rm -rf "$DENO_DIR/gen/file/$(echo "$ROOT_DIR" | awk -F'/' '{print $2}')"
