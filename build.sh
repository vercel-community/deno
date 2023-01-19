#!/usr/bin/env bash
rm -rfv dist
tsc --project src/tsconfig.json
cp -v src/bootstrap src/runtime/*.ts dist
