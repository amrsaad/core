# Core for iPhone (native)

SwiftUI app, iOS 17 or newer. Same encrypted pool as the web app, same daily refill. No Apple developer account needed: a build runs for 7 days, then it is installed again from the Mac with one double-click.

## Install and update (Mac with Xcode, iPhone on the cable)

First time only, paste this one line into Terminal:

```
curl -fsSL https://raw.githubusercontent.com/amrsaad/core/claude/core-v1/ios/install.sh | bash
```

It downloads the code to `~/Developer/core`, builds, installs and starts Core on the iPhone, and puts **Core installieren.command** on the Desktop. From then on: iPhone on the cable, double-click that file. It always installs the newest state. Saved moments and settings stay.

The Settings tab shows the build (commit) and how many days the build is still valid. **Copy diagnostics** there copies a short log to paste into the chat when something is wrong.

## What happens on every change

GitHub builds the app on a Mac, runs the unit tests (`CoreTests`: mix, decryption, state) and the UI tests (`CoreUITests`: every screen with a local test pool and a local video) and stores screenshots of every screen as an artifact. Nothing reaches the branch without a green run.

## What is where

- `Core/Vault.swift`: unlock link, Keychain, download and AES-GCM decryption of the pool
- `Core/Mix.swift`: order of the feed and learning (same rules as `docs/konzept.md`)
- `Core/Players.swift`: AVPlayer for own streams, YouTube in a web view for Beat, exact start and end
- `Core/FeedView.swift`: paging feed, gestures (tap pause, double tap save, hold 2x), For you, menu
- `Core/Screens.swift`: unlock, saved, settings, weekly review
- `Core/Store.swift`: everything stored on the phone
- `Core/Diag.swift`: test mode (environment), diagnostics log, build info
- `install.sh`: build and install from the Mac
