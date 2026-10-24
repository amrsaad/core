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

say "4/5 Bauen und installieren (1 bis 3 Minuten)"
# Ein kostenloses Apple-Konto signiert nur in Xcode selbst, nicht über xcodebuild. Deshalb steuert das Skript Xcode.
# Team, Build-Nummer und Commit kommen in die lokale Projektdatei (git setzt sie beim nächsten Lauf zurück und neu).
python3 - "$DIR/ios/Core.xcodeproj/project.pbxproj" "$TEAM" "$COUNT" "$COMMIT" <<'PY'
import sys
p, team, count, commit = sys.argv[1:]
s = open(p).read()
s = s.replace('DEVELOPMENT_TEAM = "";', f'DEVELOPMENT_TEAM = {team};')
s = s.replace('CURRENT_PROJECT_VERSION = 1;', f'CURRENT_PROJECT_VERSION = {count};')
s = s.replace('INFOPLIST_KEY_CFBundleDisplayName = Core;', f'INFOPLIST_KEY_CFBundleDisplayName = Core;\n\t\t\t\tINFOPLIST_KEY_CoreCommit = {commit};')
open(p, 'w').write(s)
PY

SCPT="$DIR/ios/build/run.applescript"
mkdir -p "$DIR/ios/build"
cat > "$SCPT" <<'APPLESCRIPT'
on run argv
  set projPath to item 1 of argv
  tell application "Xcode"
    activate
    open (POSIX file projPath)
    set ws to missing value
    repeat 60 times
      try
        set ws to first workspace document whose path is projPath
        if loaded of ws then exit repeat
      end try
      delay 1
    end repeat
    if ws is missing value then return "ERROR Xcode hat das Projekt nicht geöffnet"
    set dest to missing value
    repeat 30 times
      try
        set dest to first run destination of ws whose platform is "iphoneos"
        exit repeat
      end try
      delay 1
    end repeat
    if dest is missing value then return "ERROR Kein iPhone als Ziel gefunden. Kabel prüfen, iPhone entsperren."
    set active run destination of ws to dest
    set r to run ws
    repeat 180 times
      delay 2
      set st to status of r
      if st is succeeded or st is running then return "OK"
      if st is failed or st is error occurred or st is cancelled then return "ERROR " & (build log of r)
    end repeat
    return "ERROR Zeitüberschreitung beim Bauen"
  end tell
end run
APPLESCRIPT
RESULT=$(osascript "$SCPT" "$DIR/ios/Core.xcodeproj" 2>&1) || true
case "$RESULT" in
  OK*) echo "Xcode hat gebaut und installiert." ;;
  *) printf '%s\n' "$RESULT" | grep -E "error:|ERROR|rror" | head -12; fail "Bauen über Xcode fehlgeschlagen. Beim ersten Lauf fragt macOS, ob Terminal Xcode steuern darf, das muss erlaubt sein." ;;
esac

say "5/5 Fertig"
if [ ! -f "$CMD" ]; then
  printf '#!/bin/bash\n"%s/ios/install.sh"\n' "$DIR" > "$CMD"
  chmod +x "$CMD"
  xattr -d com.apple.quarantine "$CMD" 2>/dev/null || true
  echo "Auf dem Schreibtisch liegt jetzt \"Core installieren.command\". Ab sofort reicht ein Doppelklick."
fi

say "Fertig. Core $COMMIT läuft auf dem iPhone und gilt 7 Tage."
