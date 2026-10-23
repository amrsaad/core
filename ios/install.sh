#!/bin/bash
# Core auf das angeschlossene iPhone spielen. Holt den neuesten Stand, baut, installiert, startet.
# Erster Lauf (einmalig, im Terminal):
#   curl -fsSL https://raw.githubusercontent.com/amrsaad/core/claude/core-v1/ios/install.sh | bash
# Danach: Doppelklick auf "Core installieren.command" auf dem Schreibtisch.
set -euo pipefail

REPO="https://github.com/amrsaad/core.git"
BRANCH="claude/core-v1"
DIR="$HOME/Developer/core"
BUNDLE="com.amrsaad.core.personal"
CMD="$HOME/Desktop/Core installieren.command"

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
fail() { printf '\n\033[31m%s\033[0m\n' "$1"; exit 1; }

say "1/5 Code holen"
if [ ! -d "$DIR/.git" ]; then
  mkdir -p "$(dirname "$DIR")"
  git clone -q -b "$BRANCH" "$REPO" "$DIR"
fi
cd "$DIR"
git fetch -q origin "$BRANCH"
git reset -q --hard "origin/$BRANCH"
COMMIT=$(git rev-parse --short HEAD)
COUNT=$(git rev-list --count HEAD)
echo "Stand $COMMIT"

say "2/5 Team erkennen"
TEAM=$(security find-identity -v -p codesigning 2>/dev/null | grep -o 'Apple Development: [^(]*([A-Z0-9]\{10\})' | head -1 | grep -o '([A-Z0-9]\{10\})' | tr -d '()' || true)
if [ -z "$TEAM" ]; then
  fail "Kein Entwicklerzertifikat gefunden. Einmal in Xcode das Projekt öffnen, Team wählen, Play drücken. Danach klappt dieses Skript."
fi
echo "Team $TEAM"

say "3/5 iPhone suchen"
UDID=$(xcrun devicectl list devices --json-output /tmp/core-devices.json >/dev/null 2>&1 && python3 -c '
import json
d=json.load(open("/tmp/core-devices.json"))["result"]["devices"]
ok=[x for x in d if x.get("hardwareProperties",{}).get("platform")=="iOS" and x.get("connectionProperties",{}).get("pairingState")=="paired"]
cabled=[x for x in ok if "wired" in str(x.get("connectionProperties",{}).get("transportType","")).lower()] or ok
print(cabled[0]["hardwareProperties"]["udid"] if cabled else "")' || true)
if [ -z "$UDID" ]; then
  fail "Kein iPhone gefunden. Kabel anschließen, iPhone entsperren, noch einmal starten."
fi
echo "iPhone $UDID"

say "4/5 Bauen (1 bis 3 Minuten)"
LOG="$DIR/ios/install.log"
xcodebuild -project ios/Core.xcodeproj -scheme Core \
  -destination "platform=iOS,id=$UDID" \
  -derivedDataPath "$DIR/ios/build" \
  -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
  DEVELOPMENT_TEAM="$TEAM" \
  CURRENT_PROJECT_VERSION="$COUNT" \
  INFOPLIST_KEY_CoreCommit="$COMMIT" \
  build >"$LOG" 2>&1 || { grep -E "error:" "$LOG" | head -20; fail "Build fehlgeschlagen. Log: $LOG"; }
APP=$(find "$DIR/ios/build/Build/Products" -maxdepth 2 -name "Core.app" -path "*iphoneos*" | head -1)
[ -n "$APP" ] || fail "Core.app nicht gefunden"

say "5/5 Installieren und starten"
xcrun devicectl device install app --device "$UDID" "$APP" >/dev/null
xcrun devicectl device process launch --device "$UDID" "$BUNDLE" >/dev/null 2>&1 || true

if [ ! -f "$CMD" ]; then
  printf '#!/bin/bash\n"%s/ios/install.sh"\n' "$DIR" > "$CMD"
  chmod +x "$CMD"
  xattr -d com.apple.quarantine "$CMD" 2>/dev/null || true
  echo "Auf dem Schreibtisch liegt jetzt \"Core installieren.command\". Ab sofort reicht ein Doppelklick."
fi

say "Fertig. Core $COMMIT läuft auf dem iPhone und gilt 7 Tage."
