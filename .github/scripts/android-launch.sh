#!/usr/bin/env bash
# Installs the release app on the running emulator, opens it, and walks the first launch: the
# four rule cards, then the sign-in screen. Fails with the app's log when a screen doesn't show.
set -uo pipefail

APK=apps/mobile/android/app/build/outputs/apk/release/app-release.apk
mkdir -p android-screens

screen_has() {
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
  adb shell cat /sdcard/ui.xml > ui.xml 2>/dev/null
  grep -q "$1" ui.xml
}

wait_for() {
  for _ in $(seq 1 40); do
    if screen_has "$1"; then return 0; fi
    sleep 3
  done
  echo "::error::'$1' never showed on the screen"
  adb exec-out screencap -p > "android-screens/missing.png"
  adb logcat -d | grep -iE 'ReactNativeJS|AndroidRuntime|FATAL|Exception' | tail -120
  exit 1
}

# Taps the middle of the element whose text starts with $1 (the dump escapes quotes, so a
# label with an apostrophe is matched by its start).
tap() {
  local bounds
  bounds=$(grep -o "text=\"$1[^\"]*\"[^>]*bounds=\"\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]\"" ui.xml | head -1 | grep -o '\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]')
  if [ -z "$bounds" ]; then
    echo "::error::no '$1' to tap"
    exit 1
  fi
  read -r x1 y1 x2 y2 <<< "$(echo "$bounds" | tr '[],' '   ')"
  adb shell input tap $(((x1 + x2) / 2)) $(((y1 + y2) / 2))
}

adb install -r "$APK" || exit 1
adb shell am start -n app.gozali/.MainActivity || exit 1

cards=("Feed me with a photo" "We do it together" "I never die" "Dress me up")
for index in 0 1 2 3; do
  wait_for "${cards[$index]}"
  adb exec-out screencap -p > "android-screens/card-$((index + 1)).png"
  if [ "$index" -lt 3 ]; then tap "Next"; else tap "Let"; fi
  sleep 1
done

wait_for "Continue with Apple"
adb exec-out screencap -p > android-screens/welcome.png

# Still running after the walk: no crash on the way.
if ! adb shell pidof app.gozali >/dev/null; then
  echo "::error::the app is no longer running"
  adb logcat -d | grep -iE 'AndroidRuntime|FATAL' | tail -80
  exit 1
fi
echo "The app started and showed the first-launch screens."
