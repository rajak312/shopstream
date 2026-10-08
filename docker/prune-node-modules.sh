#!/bin/sh
# Trims production node_modules for container images: source maps, type
# declarations, docs, and parts of the Prisma CLI that are never used at runtime
# (Studio, non-PostgreSQL query compilers).
set -eu
cd node_modules
find . -type f \( -name '*.map' -o -name '*.d.ts' -o -name '*.d.mts' -o -name '*.d.cts' \
  -o -iname 'README*' -o -iname 'CHANGELOG*' -o -name '*.md' \) -delete
find . -type d \( -name test -o -name tests -o -name __tests__ -o -name docs -o -name example -o -name examples \) \
  -prune -exec rm -rf {} + 2>/dev/null || true
if [ -d @prisma/client/runtime ]; then
  rm -f @prisma/client/runtime/*mysql* @prisma/client/runtime/*sqlite* \
        @prisma/client/runtime/*sqlserver* @prisma/client/runtime/*cockroachdb* \
        @prisma/client/runtime/*edge*
fi
rm -rf .cache
