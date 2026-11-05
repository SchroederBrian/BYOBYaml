#!/usr/bin/env bash
set -Eeuo pipefail
set +x
umask 077

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
cd "$repo_root"

usage() {
  cat <<'HELP'
Usage: ./deploy.sh [--build-only | --preflight] [--no-fetch]

  (default)     Build locally with Bun, deploy only BYOBYaml, verify or roll back.
  --build-only  Build a versioned Node release without credentials or live changes.
  --preflight   Check aaPanel access and the existing BYOBYaml project, read-only.
  --no-fetch    Use the local web source ref without fetching GitHub.

API key: .aapanel-api-key, or AAPANEL_API_KEY_FILE / AAPANEL_API_KEY.
Optional settings: .env.deploy (Bash syntax), BYOB_WEB_REF (default deploy/aapanel).
The live .env, database, Node version, port, and other websites are preserved.
HELP
}

mode=deploy
fetch_source=1
for arg in "$@"; do
  case "$arg" in
    --build-only|--preflight)
      [[ $mode == deploy ]] || { printf 'Choose only one mode.\n' >&2; exit 2; }
      mode=${arg#--}
      ;;
    --no-fetch) fetch_source=0 ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$arg" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ -f .env.deploy ]]; then
  # shellcheck disable=SC1091
  source .env.deploy
fi
# Build processes never inherit the panel credential.
export -n AAPANEL_API_KEY 2>/dev/null || true
export AAPANEL_API_KEY_FILE=${AAPANEL_API_KEY_FILE:-$repo_root/.aapanel-api-key}
for required in bun git tar node; do
  command -v "$required" >/dev/null || { printf 'Missing required command: %s\n' "$required" >&2; exit 2; }
done

panel() {
  if [[ -n ${AAPANEL_API_KEY:-} ]]; then
    AAPANEL_API_KEY="$AAPANEL_API_KEY" bun scripts/deploy-aapanel.mjs "$@"
  else
    bun scripts/deploy-aapanel.mjs "$@"
  fi
}

if [[ $mode != build-only ]]; then
  printf 'Checking the existing BYOBYaml service (read-only)...\n'
  panel preflight
  [[ $mode != preflight ]] || exit 0
fi

mkdir -p .deploy-build
lock_dir=$repo_root/.deploy-build/run.lock
if ! mkdir "$lock_dir" 2>/dev/null; then
  printf 'Another local deployment is running (lock: %s).\n' "$lock_dir" >&2
  exit 1
fi
trap 'rmdir -- "$lock_dir" 2>/dev/null || true' EXIT
web_ref=${BYOB_WEB_REF:-deploy/aapanel}
if [[ $fetch_source == 1 && $web_ref == deploy/aapanel ]]; then
  printf 'Fetching the web server source...\n'
  git fetch deploy aapanel
fi
tag=$(date -u +%Y%m%dT%H%M%SZ)-${RANDOM}${RANDOM}
printf 'Checking project regression tests...\n'
bun test ./scripts
printf 'Building app, documentation and Node server with Bun...\n'
bun scripts/build-web-release.mjs "$tag" "$web_ref"
release_dir=$repo_root/.deploy-build/$tag/release
if [[ $mode == build-only ]]; then
  printf 'Build complete. No live changes made.\nRelease: %s\nArchive: %s.tar.gz\n' "$release_dir" "$release_dir"
  exit 0
fi
printf 'Deploying the verified release to BYOBYaml...\n'
panel deploy "$release_dir" "$tag"
printf 'Deployed and verified https://byobyaml.keksgames.de/app/\n'
