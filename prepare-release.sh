#!/bin/bash

set -e

echo ">> Cleaning up..."
npm run clean

echo ">> Building a package..."
npm run tsc

echo ">> Cleaning up a package.json file..."
./node_modules/.bin/clear-package-json package.json --fields private engines -o package.json

echo "Package is ready to publish"
