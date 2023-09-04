#!/bin/bash
set -e

# Clean the output dir
rm -rf dist/
mkdir -p dist

# Compile the typescript project
npx tsc
