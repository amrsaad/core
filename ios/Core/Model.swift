import Foundation
import SwiftUI
import UIKit

enum Area: String, Codable, CaseIterable, Hashable {
    case brain, body, beat

    var label: String {
        switch self {
        case .brain: return "Brain"
        case .body: return "Body"
        case .beat: return "Beat"
        }
    }

    var color: Color {
        switch self {
        case .brain: return Color(hex: 0x4A8CFF)
        case .body: return Color(hex: 0x2FB37A)
        case .beat: return Color(hex: 0xC9A227)
        }
    }
}

/// One caption line: seconds from the moment's start, text. Encoded as [t, "text"] in the pool.
struct Cue: Codable, Hashable {
    let t: Double
    let text: String

    init(from decoder: Decoder) throws {
        var c = try decoder.unkeyedContainer()
        t = try c.decode(Double.self)
        text = try c.decode(String.self)
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.unkeyedContainer()
        try c.encode(t)
        try c.encode(text)
    }
}

struct Moment: Codable, Identifiable, Hashable {
    let id: String
    let videoId: String
    let start: Double
    let end: Double
    let channel: String
    let videoTitle: String?
    let area: Area
    let topic: String
    let hook: String
    let forYou: String?
    let kind: String?
    let top: Bool?
    let hls: String?
    let thumb: String?
    let url: String?
    let audio: Bool?
    let cues: [Cue]?

    /// No own stream means the moment plays through YouTube.
    var isYouTube: Bool { hls == nil }
    var isAudio: Bool { audio == true }
    var duration: Double { max(1, end - start) }

    var thumbURL: URL? {
        URL(string: thumb ?? "https://i.ytimg.com/vi/\(videoId)/hqdefault.jpg")
    }

    var fullURL: URL? {
        URL(string: url ?? "https://www.youtube.com/watch?v=\(videoId)&t=\(Int(start))")
    }

    /// "Sigma Nutrition (Prof. Grant Tinsley)" becomes "Sigma Nutrition · Prof. Grant Tinsley"
    var speakerLine: String {
        guard let open = channel.lastIndex(of: "("), channel.hasSuffix(")") else { return channel }
        let name = channel[..<open].trimmingCharacters(in: .whitespaces)
        let person = channel[channel.index(after: open)..<channel.index(before: channel.endIndex)]
        return "\(name) · \(person)"
    }

    /// Caption at a position (seconds from the moment's start).
    func caption(at rel: Double) -> String {
        guard let cues else { return "" }
        var current = ""
        for cue in cues {
            if cue.t <= rel + 0.1 { current = cue.text } else { break }
        }
        return current
    }
}

struct Pool: Codable {
    let updatedAt: String?
    let moments: [Moment]
}

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: opacity
        )
    }
}

enum Palette {
    static let surface = Color(hex: 0x121212)
    static let line = Color(hex: 0x262931)
    static let secondary = Color(hex: 0xB3B3B3)
    static let tertiary = Color(hex: 0x8A8F98)
    static let band = Color(hex: 0x1A1D24)
    static let button = Color(hex: 0x1E2026)
}

enum Device {
    /// Height of the status bar area. The feed draws under it, so the progress line sits just below.
    @MainActor static var topInset: CGFloat {
        let scene = UIApplication.shared.connectedScenes.first { $0 is UIWindowScene } as? UIWindowScene
        return scene?.windows.first?.safeAreaInsets.top ?? 47
    }
}
