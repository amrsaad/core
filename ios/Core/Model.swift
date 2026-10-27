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

/// Abfragefrage zum Ausschnitt: drei Antworten, eine richtig (Index in options)
struct RecallQuestion: Codable, Hashable {
    let question: String
    let options: [String]
    let correct: Int
    let why: String
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
    /// Geprüfter Ausschnitt als Lesetext (Formwahl Text). var mit Standardwert, damit alte Pools und Tests weiter passen
    var excerpt: String? = nil
    /// Form des Moments (video, audio, text). Fehlt im Pool, dann gilt audio true als audio, sonst video. Text-Momente haben keinen Player.
    var form: String? = nil
    /// Quellenzeile der Textform (Aufgabe 6)
    var author: String? = nil
    var sourceUrl: String? = nil
    var license: String? = nil
    var ref: String? = nil
    /// Abrufkarte: nur Momente mit diesem Feld bekommen eine Karte
    var recall: RecallQuestion? = nil

    var cueTexts: [String] { (cues ?? []).map(\.text) }
    var readingText: String { FormText.text(excerpt: excerpt, cues: cueTexts) }

    /// No own stream means the moment plays through YouTube.
    var isYouTube: Bool { hls == nil }
    var isAudio: Bool { audio == true }
    var feedForm: FeedForm { FormFilter.of(form: form, audio: isAudio) }
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
    /// Nur Momente, die den Vertrag erfüllen (PoolContract). Ein einzelner kaputter Moment lässt das Laden nie scheitern.
    let moments: [Moment]
    /// Aussortierte Momente: nicht lesbar oder gegen den Vertrag. Steht in der Diagnose.
    let skipped: Int

    init(updatedAt: String?, moments: [Moment], skipped: Int = 0) {
        self.updatedAt = updatedAt
        self.moments = moments
        self.skipped = skipped
    }

    private enum CodingKeys: String, CodingKey { case updatedAt, moments }
    /// Zum Überspringen eines Eintrags, den der Decoder nicht lesen konnte (ohne das hört der Container nicht auf, ihn zu liefern)
    private struct Unreadable: Decodable {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        updatedAt = try c.decodeIfPresent(String.self, forKey: .updatedAt)
        var list = try c.nestedUnkeyedContainer(forKey: .moments)
        var decoded: [Moment] = []
        var unreadable = 0
        while !list.isAtEnd {
            if let m = try? list.decode(Moment.self) {
                decoded.append(m)
            } else {
                unreadable += 1
                _ = try? list.decode(Unreadable.self)
            }
        }
        let check = PoolContract.validate(decoded)
        moments = check.moments
        skipped = unreadable + check.skipped
    }
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
