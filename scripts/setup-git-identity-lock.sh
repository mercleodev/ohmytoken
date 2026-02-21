#!/usr/bin/env bash
set -euo pipefail

CONFIG_FILE=".git-identity.local"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "[identity-lock] Not inside a git repository."
  echo "[identity-lock] Run this script from a git working tree."
  exit 1
fi

repo_root="$(git rev-parse --show-toplevel)"
config_path="${repo_root}/${CONFIG_FILE}"

if [[ ! -f "${config_path}" ]]; then
  echo "[identity-lock] Missing ${CONFIG_FILE}."
  echo "[identity-lock] Create it from template:"
  echo "  cp .git-identity.local.example .git-identity.local"
  echo "[identity-lock] Then set GIT_IDENTITY_NAME / GIT_IDENTITY_EMAIL / GIT_IDENTITY_REMOTE."
  exit 1
fi

# shellcheck source=/dev/null
source "${config_path}"

EXPECTED_NAME="${GIT_IDENTITY_NAME:-}"
EXPECTED_EMAIL="${GIT_IDENTITY_EMAIL:-}"
EXPECTED_REMOTE="${GIT_IDENTITY_REMOTE:-}"

if [[ -z "${EXPECTED_NAME}" || -z "${EXPECTED_EMAIL}" || -z "${EXPECTED_REMOTE}" ]]; then
  echo "[identity-lock] Invalid ${CONFIG_FILE}: required keys are empty."
  echo "[identity-lock] Required keys: GIT_IDENTITY_NAME, GIT_IDENTITY_EMAIL, GIT_IDENTITY_REMOTE"
  exit 1
fi

git config --local user.name "${EXPECTED_NAME}"
git config --local user.email "${EXPECTED_EMAIL}"
git config --local core.hooksPath ".githooks"

if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "${EXPECTED_REMOTE}"
else
  git remote add origin "${EXPECTED_REMOTE}"
fi

echo "[identity-lock] Applied repository-local identity and remote:"
echo "  user.name  = $(git config --local user.name)"
echo "  user.email = $(git config --local user.email)"
echo "  hooksPath  = $(git config --local core.hooksPath)"
echo "  origin     = $(git remote get-url origin)"
