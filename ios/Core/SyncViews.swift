import SwiftUI

/// Settings: Token für den Sync zwischen Geräten (Max, 28.10.2026). Das Token steht nie auf dem Bildschirm, nur das Feld zum Einfügen.
struct SyncCard: View {
    @EnvironmentObject var sync: SyncEngine
    @State private var text = ""
    @State private var message: String?

    private var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Sync between devices").font(.system(size: 17, weight: .semibold))
            if !sync.status.hasToken {
                Text("GitHub token").font(.system(size: 13)).foregroundStyle(Palette.tertiary)
                SecureField("github_pat_…", text: $text)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .padding(.horizontal, 14)
                    .frame(height: 48)
                    .background(Palette.surface, in: RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Palette.line))
                    .accessibilityIdentifier("syncToken")
                Button("Save token") { save() }
                    .font(.system(size: 15))
                    .disabled(trimmed.isEmpty)
                    .accessibilityIdentifier("saveToken")
                Text("Fine-grained token for core-content only, Contents read and write. Or scan the QR code from your other device.")
                    .font(.system(size: 13)).foregroundStyle(Palette.tertiary)
            } else {
                TimelineView(.periodic(from: .now, by: 15)) { ctx in
                    Text("Last sync: \(sync.status.running ? "syncing…" : SyncAgo.text(sync.status.lastSync, now: ctx.date))")
                        .font(.system(size: 15))
                        .accessibilityIdentifier("syncLast")
                }
                Button("Sync now") { Task { await sync.syncNow() } }
                    .font(.system(size: 15))
                    .disabled(sync.status.running)
                    .accessibilityIdentifier("syncNow")
                Button("Remove token") { Task { await sync.removeToken() } }
                    .font(.system(size: 15))
                    .accessibilityIdentifier("removeToken")
            }
            if let line = sync.status.error ?? message {
                Text(line)
                    .font(.system(size: 13))
                    .foregroundStyle(Color(hex: 0xE07B7B))
                    .accessibilityIdentifier("syncError")
            }
        }
    }

    private func save() {
        let value = trimmed
        Task {
            if await sync.setToken(value) {
                text = ""
                message = nil
            } else {
                message = "That does not look like a GitHub token."
            }
        }
    }
}
