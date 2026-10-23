import AVFoundation
import SwiftUI

@main
struct CoreApp: App {
    @StateObject private var store = Store()
    @StateObject private var feed = FeedModel()

    init() {
        // Sound like Reels: plays with the silent switch on and keeps playing with the screen locked
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
        try? AVAudioSession.sharedInstance().setActive(true)
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .environmentObject(feed)
                .preferredColorScheme(.dark)
        }
    }
}

struct RootView: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var feed: FeedModel
    @State private var key: Data? = Vault.loadKey()
    @State private var tab = 0
    @State private var review = false

    var body: some View {
        Group {
            if let key {
                TabView(selection: $tab) {
                    FeedView(feed: feed)
                        .tabItem { Label("Feed", systemImage: "rectangle.portrait") }
                        .tag(0)
                    SavedView()
                        .tabItem { Label("Saved", systemImage: "bookmark") }
                        .tag(1)
                    SettingsView(onRelock: { self.key = nil })
                        .tabItem { Label("Settings", systemImage: "line.3.horizontal") }
                        .tag(2)
                }
                .tint(.white)
                .toolbarBackground(Color.black, for: .tabBar)
                .toolbarBackground(.visible, for: .tabBar)
                .task(id: key) { await feed.load(key: key, store: store) }
                .onAppear { review = store.reviewDue }
                .fullScreenCover(isPresented: $review) { WeeklyReviewView { review = false } }
            } else {
                UnlockView { newKey in key = newKey }
            }
        }
        .background(Color.black.ignoresSafeArea())
    }
}
