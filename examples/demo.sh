#!/usr/bin/env bash
set -euo pipefail

# Demo analysis against a public repository
bun run reposherlock analyze https://github.com/octocat/Hello-World \
  --out .reposherlock/output/demo \
  --depth 4 \
  --max-files 1200 \
  --try-run

bun run reposherlock report .reposherlock/output/demo --open
