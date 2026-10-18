#!/usr/bin/env bash
# Checks that one or more live hostnames serve the static site in SITE_DIR:
# "/" must return 200 with the same <title> as SITE_DIR/index.html, and every file in
# SITE_DIR (JS, CSS with the inlined fonts, images, wallpapers) must return 200. A non-HTML
# file served as text/html counts as missing: without a 404.html, Pages answers unknown
# paths with index.html and a 200.
# Root files starting with "_" (_headers, _redirects, ...) are Pages config, not content.
#
# Usage: tools/cloudflare/verify_pages.sh SITE_DIR BASE_URL [BASE_URL...]
# Env:   WAIT_SECONDS  how long to wait for "/" to come up on each host (default 0)
# Prints a Markdown report; exits 1 if any host or file fails.
set -uo pipefail

site_dir=${1:?usage: verify_pages.sh SITE_DIR BASE_URL [BASE_URL...]}
shift
[ $# -gt 0 ] || { echo "usage: verify_pages.sh SITE_DIR BASE_URL [BASE_URL...]" >&2; exit 2; }
wait_seconds=${WAIT_SECONDS:-0}

title() { grep -o '<title>[^<]*</title>' | head -1; }
want_title=$(title < "$site_dir/index.html")
mapfile -t paths < <(cd "$site_dir" && find . -type f ! -path './_*' | sed 's|^\.||' | sort)

status=0
echo "| Host | \`/\` | Title matches | Files OK | \`app.js\` type | Failures |"
echo "|---|---|---|---|---|---|"
for base in "$@"; do
  base=${base%/}
  deadline=$(( $(date +%s) + wait_seconds ))
  while :; do
    root_code=$(curl -sSL -o /dev/null -w '%{http_code}' --max-time 20 "$base/" 2>/dev/null)
    [ "$root_code" = 200 ] || [ "$(date +%s)" -ge "$deadline" ] && break
    sleep 10
  done
  got_title=$(curl -sSL --max-time 20 "$base/" 2>/dev/null | title)
  title_ok=no; [ -n "$want_title" ] && [ "$got_title" = "$want_title" ] && title_ok=yes

  ok=0; failed=0; failures=""; js_type="-"
  for p in "${paths[@]}"; do
    r=$(curl -sSL -o /dev/null -w '%{http_code} %{content_type}' --max-time 30 "$base$p" 2>/dev/null)
    code=${r%% *}
    [ "$p" = /app.js ] && js_type=${r#* }
    if [ "$code" = 200 ] && { [[ $p == *.html ]] || [[ ${r#* } != text/html* ]]; }; then
      ok=$((ok + 1))
    else
      failed=$((failed + 1))
      [ "$failed" -le 8 ] && failures="$failures \`$p\` ($r)"
    fi
  done
  [ "$failed" -gt 8 ] && failures="$failures and $((failed - 8)) more"

  [ "$root_code" = 200 ] && [ "$title_ok" = yes ] && [ -z "$failures" ] || status=1
  echo "| $base | $root_code | $title_ok | $ok/${#paths[@]} | ${js_type:--} | ${failures:-none} |"
done
exit $status
