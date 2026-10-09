#!/usr/bin/env bash
# Tracked dosyalarda secret biçimli değerleri reddeder; eşleşen içerik bilerek yazdırılmaz.
set -euo pipefail
pattern='AIza[0-9A-Za-z_-]{20,}'                                  # Google/Gemini API key
pattern+='|(ghp_|gho_|ghs_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{10,}' # GitHub/Slack token
pattern+='|postgres(ql)?://[^[:space:]]+:[^@[:space:]]+@'            # parolalı Postgres URL
pattern+='|sb_secret_[A-Za-z0-9_-]{16,}'                            # Supabase secret key
pattern+='|eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}' # JWT (service_role vb.)
pattern+='|\b(ak|as)-[A-Za-z0-9]{20,}\b'                            # Modal token id/secret
pattern+='|-----BEGIN [A-Z ]*PRIVATE KEY-----'
if secret_files="$(git grep -lE "$pattern" -- .)"; then
  echo "::error::A secret-shaped value was found in tracked files (content is intentionally not printed)."
  printf '%s\n' "$secret_files"
  exit 1
fi
echo "No secret-shaped values in tracked files."
