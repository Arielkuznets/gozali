#!/usr/bin/env bash
# Runs a build command as is. When it fails, the part of its output that says why goes into an
# error annotation, which anyone can read on the public repository without the full log.
#   bash .github/scripts/explain-failure.sh ./gradlew assembleDebug
set -o pipefail

log=$(mktemp)
"$@" 2>&1 | tee "$log"
status=${PIPESTATUS[0]}

if [ "$status" -ne 0 ]; then
  # Gradle explains under "What went wrong"; Xcode and most tools print "error:" lines.
  reason=$(grep -A 25 'What went wrong' "$log" | head -40)
  [ -z "$reason" ] && reason=$(grep -iE 'error[: ]' "$log" | grep -v '^warning' | head -40)
  [ -z "$reason" ] && reason=$(tail -40 "$log")
  # Annotations take one line; %0A is a line break inside it.
  message=$(printf '%s' "$reason" | sed -e 's/%/%25/g' -e 's/\r//g' | sed ':a;N;$!ba;s/\n/%0A/g')
  echo "::error title=$1 failed::$message"
fi
exit "$status"
