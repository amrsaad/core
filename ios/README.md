# Core for iPhone (native)

SwiftUI app, iOS 17 or newer. Same encrypted pool as the web app (`https://amrsaad.github.io/core/moments/pool.enc`), same daily refill. No Apple developer account needed. Without an account, an installed build runs for 7 days, then it has to be installed again from the Mac (about one minute).

## First install (about 10 minutes)

1. Download this folder: on GitHub open `amrsaad/core`, branch `claude/core-v1`, then Code, Download ZIP. Unzip it.
2. Open `ios/Core.xcodeproj` in Xcode.
3. Xcode, Settings, Accounts: add your Apple ID (the normal one, free).
4. Click the blue "Core" project in the left column, target "Core", tab "Signing & Capabilities". Team: choose your name (Personal Team). If Xcode says the bundle ID is taken, change `com.amrsaad.core.personal` to anything unique, for example `com.amrsaad.core.max1`.
5. Connect the iPhone by cable, choose it at the top of the Xcode window, press the Play button.
   - First time on the iPhone: Settings, Privacy & Security, Developer Mode on (iPhone restarts).
   - Then Settings, General, VPN & Device Management, your Apple ID, Trust.
6. Open Core, paste the unlock link (from `ACCESS.md` in core-content). Done.

## Every 7 days

Connect the iPhone, open the project in Xcode, press Play. Saved moments and settings stay.

## What is where

- `Core/Vault.swift`: unlock link, Keychain, download and AES-GCM decryption of the pool
- `Core/Mix.swift`: order of the feed and learning (same rules as `docs/konzept.md`)
- `Core/Players.swift`: AVPlayer for own streams, YouTube in a web view for Beat, exact start and end
- `Core/FeedView.swift`: paging feed, gestures (tap pause, double tap save, hold 2x), For you, menu
- `Core/Screens.swift`: unlock, saved, settings, weekly review
- `Core/Store.swift`: everything stored on the phone
