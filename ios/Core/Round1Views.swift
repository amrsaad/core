import CoreImage
import CoreImage.CIFilterBuiltins
import SwiftUI
import UIKit

// Oberflächen aus App Runde 1, Gegenstück zu den Web-Komponenten. Regeln liegen in Round1.swift.

// MARK: Punkt 3 und 6, Kopfzeile mit Formwahl und Tageszahl

struct FeedTopBar: View {
    @EnvironmentObject var store: Store

    var body: some View {
        VStack(alignment: .trailing, spacing: 10) {
            HStack(spacing: 2) {
                ForEach(FeedForm.allCases, id: \.self) { f in
                    let on = store.state.currentForm == f
                    Button { store.state.form = f } label: {
                        Text(f.label)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(on ? Color.black : Palette.secondary)
                            .frame(minWidth: 64, minHeight: 36)
                            .background(on ? Color.white : Color.clear, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("form-\(f.label)")
                    .accessibilityAddTraits(on ? .isSelected : [])
                }
            }
            .padding(3)
            .background(.black.opacity(0.55), in: Capsule())
            .frame(maxWidth: .infinity)

            Text(Today.line(store.state.dayCount?[Day.key()], withGotIt: true))
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.white.opacity(0.72))
                .shadow(color: .black.opacity(0.6), radius: 2, y: 1)
                .padding(.trailing, 16)
                .accessibilityIdentifier("todayLine")
        }
    }
}

// MARK: Punkt 4, Untertitel mit arabischer Schrift rechtsläufig

struct CaptionText: View {
    let text: String
    let big: Bool

    var body: some View {
        let ar = Captions.isArabic(text)
        Text(text)
            .font(.system(size: big ? (ar ? 25 : 22) : (ar ? 21 : 17), weight: .semibold))
            .multilineTextAlignment(ar ? .trailing : .leading)
            .environment(\.layoutDirection, ar ? .rightToLeft : .leftToRight)
            .lineSpacing(ar ? 6 : 2)
            .accessibilityIdentifier("caption")
    }
}

// MARK: Punkt 3, Textform

struct TextPanel: View {
    let moment: Moment
    let insets: EdgeInsets
    let onEnd: () -> Void
    let onNext: () -> Void
    /// Doppeltipp im Text: More like this mit Herz an der Tippstelle (Koordinaten der Seite)
    var onDouble: (CGPoint) -> Void = { _ in }

    var body: some View {
        let text = moment.readingText
        let ar = Captions.isArabic(text)
        ScrollView(.vertical, showsIndicators: false) {
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 8) {
                    Circle().fill(moment.area.color).frame(width: 8, height: 8)
                    Text(moment.area.label).foregroundStyle(moment.area.color).fontWeight(.semibold)
                    Text(moment.speakerLine).foregroundStyle(Palette.secondary).lineLimit(1)
                }
                .font(.system(size: 13))
                Text(moment.hook).font(.system(size: 24, weight: .bold)).fixedSize(horizontal: false, vertical: true)
                Text(text.isEmpty ? "No text for this moment yet." : text)
                    .font(.system(size: ar ? 21 : 18))
                    .lineSpacing(ar ? 10 : 6)
                    .foregroundStyle(text.isEmpty ? Palette.secondary : Color(hex: 0xE6E6E6))
                    .multilineTextAlignment(ar ? .trailing : .leading)
                    .environment(\.layoutDirection, ar ? .rightToLeft : .leftToRight)
                    .frame(maxWidth: .infinity, alignment: ar ? .trailing : .leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("textBody")
                if let src = moment.sourceLine { SourceLineView(line: src) }
                Rectangle().fill(Palette.line).frame(height: 1).padding(.top, 16)
                    .onAppear(perform: onEnd)
                Button(action: onNext) {
                    Text("Next moment").font(.system(size: 17, weight: .semibold)).frame(maxWidth: .infinity, minHeight: 52)
                }
                .background(Palette.button, in: RoundedRectangle(cornerRadius: 12))
                .accessibilityIdentifier("textNext")
            }
            .padding(.top, insets.top + 92)
            .padding(.leading, 16)
            .padding(.trailing, 88)
            .padding(.bottom, insets.bottom + 120)
        }
        .scrollBounceBehavior(.basedOnSize)
        .simultaneousGesture(SpatialTapGesture(count: 2, coordinateSpace: .named("page")).onEnded { onDouble($0.location) })
        .background(Color.black)
        .foregroundStyle(.white)
        .accessibilityIdentifier("textView")
    }
}

/// Quellenzeile unter der Passage, antippbar wenn ein Link da ist, öffnet die Quelle im Browser des Geräts
struct SourceLineView: View {
    let line: SourceLine.Line
    @Environment(\.openURL) private var openURL

    var body: some View {
        let label = line.prefix + line.text
        Group {
            if let url = line.url {
                Button {
                    Diag.log("source open \(url.absoluteString)")
                    if !Env.isTest { openURL(url) }
                } label: {
                    Text(label).underline().frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(.isLink)
            } else {
                Text(label).frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            }
        }
        .font(.system(size: 13))
        .foregroundStyle(Color(hex: 0x9AA0AA))
        .multilineTextAlignment(.leading)
        .accessibilityIdentifier("textSource")
        .accessibilityLabel(label)
    }
}

// MARK: Punkt 5, Abrufkarte (neu 27.10.2026)

/// Cover klein links, rechts Sprecher und Bereich, darunter die Frage, darunter die drei Antworten in zufälliger Reihenfolge.
/// Erst nach dem Tipp: richtige grün, falsch gewählte rot, dann recall.why und "Next". Die Wertung zählt beim Tipp.
/// Wischen nach oben schließt, vor der Wahl ohne Wertung. Arabisch läuft rechtsläufig.
struct RecallCardView: View {
    let moment: Moment
    let review: Bool
    let onAnswer: (Bool) -> Void
    let onClose: () -> Void
    @State private var order: [Int]
    @State private var chosen: Int?

    init(moment: Moment, review: Bool, onAnswer: @escaping (Bool) -> Void, onClose: @escaping () -> Void) {
        self.moment = moment
        self.review = review
        self.onAnswer = onAnswer
        self.onClose = onClose
        var g = SystemRandomNumberGenerator()
        _order = State(initialValue: Recall.shuffleOrder(moment.recall?.options.count ?? 0, using: &g))
    }

    var body: some View {
        let r = moment.recall
        let ar = Captions.isArabic(r?.question ?? "")
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 12) {
                    AsyncImage(url: moment.thumbURL) { img in img.resizable().scaledToFill() } placeholder: { Palette.band }
                        .frame(width: 64, height: 36)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(moment.area.label).font(.system(size: 13, weight: .semibold)).foregroundStyle(moment.area.color)
                        Text(moment.speakerLine + (review ? " · again" : "")).font(.system(size: 13)).foregroundStyle(Palette.secondary).lineLimit(2)
                    }
                }
                Text(r?.question ?? "").font(.system(size: 26, weight: .bold))
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 8)
                    .accessibilityIdentifier("recallQuestion")
                VStack(spacing: 10) {
                    ForEach(order, id: \.self) { i in option(i) }
                }
                if let r, chosen != nil {
                    Text(r.why).font(.system(size: 17)).foregroundStyle(Color(hex: 0xD8D8D8))
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .accessibilityIdentifier("recallWhy")
                    Button(action: onClose) {
                        Text("Next").font(.system(size: 17, weight: .semibold)).foregroundStyle(.black).frame(maxWidth: .infinity, minHeight: 52)
                    }
                    .background(Color.white, in: RoundedRectangle(cornerRadius: 12))
                    .accessibilityIdentifier("recallNext")
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 72)
            .padding(.bottom, 24)
        }
        .environment(\.layoutDirection, ar ? .rightToLeft : .leftToRight)
        .foregroundStyle(.white)
        .background(Color.black.ignoresSafeArea())
        .gesture(DragGesture(minimumDistance: 30).onEnded { v in if v.translation.height < -80 { onClose() } })
        .accessibilityIdentifier("recallCard")
    }

    private func option(_ i: Int) -> some View {
        let r = moment.recall!
        let state: String = chosen == nil ? "" : i == r.correct ? "right" : i == chosen ? "wrong" : "rest"
        let fill: Color = state == "right" ? Color(hex: 0x12351F) : state == "wrong" ? Color(hex: 0x3D1417) : Color(hex: 0x121212)
        let line: Color = state == "right" ? Color(hex: 0x2FB35A) : state == "wrong" ? Color(hex: 0xE5484D) : Color(hex: 0x3A3D45)
        return Button {
            guard chosen == nil else { return }
            chosen = i
            Diag.log("recall choice \(i == r.correct ? "right" : "wrong")")
            onAnswer(i == r.correct)
        } label: {
            Text(r.options[i]).font(.system(size: 17, weight: .semibold))
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
                .padding(.horizontal, 16)
        }
        .background(fill, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(line))
        .opacity(state == "rest" ? 0.55 : 1)
        .disabled(chosen != nil)
        .accessibilityIdentifier("recallOption")
        .accessibilityValue(state)
    }
}

// MARK: Schlüsselsicherung, weiteres Gerät freischalten

enum QR {
    static func image(_ text: String) -> UIImage? {
        let f = CIFilter.qrCodeGenerator()
        f.message = Data(text.utf8)
        f.correctionLevel = "M"
        guard let out = f.outputImage?.transformed(by: CGAffineTransform(scaleX: 10, y: 10)),
              let cg = CIContext().createCGImage(out, from: out.extent) else { return nil }
        return UIImage(cgImage: cg)
    }
}

struct UnlockDeviceCard: View {
    let key: Data?
    @State private var showQR = false

    var body: some View {
        let backups = Vault.backups()
        VStack(alignment: .leading, spacing: 12) {
            Text("Unlock another device").font(.system(size: 17, weight: .semibold))
            if let key {
                let link = KeyBackup.link(key)
                // Der QR-Code trägt das Sync-Token mit (verschlüsselt mit dem Pool-Schlüssel), der geteilte Link nicht
                let encToken = Vault.encryptedTokenForLink(key: key)
                let qrLink = KeyBackup.link(key, encryptedToken: encToken)
                Button(showQR ? "Hide QR code" : "Show QR code") { showQR.toggle() }
                    .font(.system(size: 15))
                    .accessibilityIdentifier("showQR")
                if showQR, let img = QR.image(qrLink) {
                    Image(uiImage: img)
                        .interpolation(.none)
                        .resizable()
                        .scaledToFit()
                        .frame(maxWidth: 240)
                        .padding(8)
                        .background(Color.white, in: RoundedRectangle(cornerRadius: 8))
                        .frame(maxWidth: .infinity)
                        .accessibilityIdentifier("unlockQR")
                }
                ShareLink(item: URL(string: link)!) {
                    Text("Share unlock link").font(.system(size: 15))
                }
                Text("Anyone with this link can open your moments. Only send it to your own devices.")
                    .font(.system(size: 13)).foregroundStyle(Palette.tertiary)
                if encToken != nil {
                    Text("The QR code also carries your sync token. Only show it to your own devices.")
                        .font(.system(size: 13)).foregroundStyle(Palette.tertiary)
                        .accessibilityIdentifier("qrHasToken")
                }
            }
            Text("Key saved in Keychain \(backups.keychain ? "yes" : "no") · in file copy \(backups.file ? "yes" : "no")")
                .font(.system(size: 13)).foregroundStyle(Palette.tertiary)
                .accessibilityIdentifier("keyBackups")
        }
    }
}

// MARK: Punkt 1, Messung in Settings

struct LatencyView: View {
    let samples: [Latency.Sample]

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Swipe to first frame").font(.system(size: 15, weight: .semibold))
            Text(Latency.line("Preloaded", Latency.stats(samples, buffered: true))).foregroundStyle(Palette.secondary)
                .accessibilityIdentifier("latencyPreloaded")
            Text(Latency.line("Not preloaded", Latency.stats(samples, buffered: false))).foregroundStyle(Palette.tertiary)
                .accessibilityIdentifier("latencyCold")
        }
        .font(.system(size: 13))
    }
}


/// Tipp bis Füllung: vom Tipp bis zum nächsten Bildaufbau, Ziel unter 100 ms (Anzeige in Settings unter Player)
@MainActor
final class NextFrame: NSObject {
    private var link: CADisplayLink?
    private var done: (@MainActor (CFTimeInterval) -> Void)?
    private static var live: [NextFrame] = []

    static func after(_ done: @escaping @MainActor (CFTimeInterval) -> Void) {
        let n = NextFrame()
        n.done = done
        n.link = CADisplayLink(target: n, selector: #selector(tick(_:)))
        n.link?.add(to: .main, forMode: .common)
        live.append(n)
    }

    @objc private func tick(_ l: CADisplayLink) {
        l.invalidate()
        let t = l.targetTimestamp
        done?(t)
        NextFrame.live.removeAll { $0 === self }
    }
}

struct TapReactionView: View {
    let samples: [Actions.Tap]

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Tap to fill").font(.system(size: 15, weight: .semibold))
            Text(Actions.line(Actions.stats(samples))).foregroundStyle(Palette.secondary)
                .accessibilityIdentifier("tapReaction")
        }
        .font(.system(size: 13))
    }
}


// MARK: Aufgabe 4, Hook und Caption

/// Der Hook wird nie gekürzt. Bis zu drei Zeilen in Normalgröße, bei mehr eine Stufe kleiner.
struct HookText: View {
    let hook: String
    @State private var step = 0
    private static let normal = UIFont.systemFont(ofSize: Hook.sizePt[0], weight: .semibold)

    var body: some View {
        Text(hook)
            .font(.system(size: Hook.sizePt[step], weight: .semibold))
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                // Messkopie in Normalgröße: wie viele Zeilen braucht der Hook dort
                Text(hook).font(.system(size: Hook.sizePt[0], weight: .semibold))
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .hidden()
                    .background(GeometryReader { g in
                        Color.clear.preference(key: HookHeightKey.self, value: g.size.height)
                    })
            )
            .onPreferenceChange(HookHeightKey.self) { h in
                let lines = Int((h / Self.normal.lineHeight).rounded())
                step = Hook.step(linesAtNormal: lines)
            }
            .accessibilityIdentifier("hook")
            .accessibilityValue("step \(step)")
    }
}

private struct HookHeightKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

/// Aufgeklappte Caption: oben der Hook, darunter der excerpt als Lesetext (Arabisch rechtsläufig), darunter Sprecher, Folge, Stelle.
/// Zu durch Tipp außerhalb oder Wischen nach unten. Das Video läuft darüber weiter.
struct CaptionSheetView: View {
    let moment: Moment
    let onClose: () -> Void
    @State private var offset: CGFloat = 0
    @State private var contentH: CGFloat = 0

    var body: some View {
        let text = moment.readingText
        let ar = Captions.isArabic(text)
        ZStack(alignment: .bottom) {
            Color.black.opacity(0.001)
                .contentShape(Rectangle())
                .onTapGesture { onClose() }
                .accessibilityIdentifier("captionBackdrop")
            VStack(alignment: .leading, spacing: 0) {
                // Kopf mit Griff und Hook: ein Zug nach unten klappt zu
                VStack(alignment: .leading, spacing: 14) {
                    Capsule().fill(Color(hex: 0x444444)).frame(width: 36, height: 4).frame(maxWidth: .infinity)
                    Text(moment.hook).font(.system(size: 20, weight: .bold))
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("captionHook")
                }
                .padding(.horizontal, 20).padding(.top, 8).padding(.bottom, 14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
                // Vorrang vor dem senkrechten Blättern der Momente, sonst gewinnt das Blättern den Zug
                .highPriorityGesture(DragGesture(minimumDistance: 20).onEnded { v in
                    if Hook.closes(dy: v.translation.height, scrollTop: 0) { onClose() }
                })
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        if !text.isEmpty {
                            Text(text)
                                .font(.system(size: ar ? 20 : 17))
                                .lineSpacing(ar ? 10 : 6)
                                .foregroundStyle(Color(hex: 0xE0E0E0))
                                .multilineTextAlignment(ar ? .trailing : .leading)
                                .environment(\.layoutDirection, ar ? .rightToLeft : .leftToRight)
                                .frame(maxWidth: .infinity, alignment: ar ? .trailing : .leading)
                                .fixedSize(horizontal: false, vertical: true)
                                .accessibilityIdentifier("captionExcerpt")
                        }
                        Rectangle().fill(Palette.line).frame(height: 1)
                        VStack(alignment: .leading, spacing: 6) {
                            metaRow("Speaker", moment.speakerLine)
                            metaRow("Episode", moment.videoTitle ?? "")
                            metaRow("At", Hook.atTime(moment.start))
                            metaRow("Area", moment.area.label)
                        }
                        .accessibilityElement(children: .combine)
                        .accessibilityIdentifier("captionMeta")
                    }
                    .padding(.horizontal, 20)
                    .padding(.bottom, 28)
                    .background(GeometryReader { g in
                        Color.clear
                            .preference(key: CapOffsetKey.self, value: -g.frame(in: .named("capScroll")).minY)
                            .preference(key: CapHeightKey.self, value: g.size.height)
                    })
                }
                .coordinateSpace(name: "capScroll")
                .onPreferenceChange(CapOffsetKey.self) { offset = $0 }
                .onPreferenceChange(CapHeightKey.self) { contentH = $0 }
                .frame(height: contentH > 0 ? min(contentH, UIScreen.main.bounds.height * 0.42) : UIScreen.main.bounds.height * 0.2)
                .simultaneousGesture(DragGesture(minimumDistance: 20).onEnded { v in
                    if Hook.closes(dy: v.translation.height, scrollTop: offset) { onClose() }
                })
            }
            .background(Color(hex: 0x0A0A0A), in: UnevenRoundedRectangle(topLeadingRadius: 18, topTrailingRadius: 18))
        }
        .foregroundStyle(.white)
    }

    private func metaRow(_ k: String, _ v: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text(k).foregroundStyle(Palette.tertiary).frame(width: 64, alignment: .leading)
            Text(v).foregroundStyle(Color(hex: 0xD0D0D0)).fixedSize(horizontal: false, vertical: true)
        }
        .font(.system(size: 14))
    }
}

private struct CapOffsetKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

private struct CapHeightKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

// MARK: Rückmeldungsblatt (Max 27.10.2026)

/// Eine Ebene. Ein Tipp auf einen Chip speichert sofort (mit dem Text, falls schon einer im Feld steht) und schließt das Blatt.
/// Done speichert nur den Text. Wegwischen schließt ohne Notiz. Kein Send-Knopf, die Adresse baut später die Zeile im Feed.
struct NoteSheetView: View {
    let moment: Moment
    let onChip: (String, String) -> Void
    let onDone: (String) -> Void
    @State private var text = ""

    private let columns = [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                Circle().fill(moment.area.color).frame(width: 8, height: 8)
                Text(moment.speakerLine).foregroundStyle(Palette.secondary)
            }
            .font(.system(size: 13))
            LazyVGrid(columns: columns, spacing: 10) {
                ForEach(Note.chips, id: \.self) { chip in
                    Button { onChip(chip, text) } label: {
                        Text(chip)
                            .font(.system(size: 18, weight: .semibold))
                            .frame(maxWidth: .infinity, minHeight: 60)
                            .background(Palette.button, in: RoundedRectangle(cornerRadius: 16))
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("noteChip-\(chip)")
                }
            }
            TextField("Note", text: $text, axis: .vertical)
                .lineLimit(2...5)
                .padding(12)
                .background(Color(hex: 0x121212), in: RoundedRectangle(cornerRadius: 12))
                .accessibilityIdentifier("noteText")
                .onChange(of: text) { _, v in if v.count > Note.textMax { text = String(v.prefix(Note.textMax)) } }
            Button { onDone(text) } label: {
                Text("Done").font(.system(size: 17, weight: .semibold)).foregroundStyle(.black).frame(maxWidth: .infinity, minHeight: 52)
            }
            .background(Color.white, in: RoundedRectangle(cornerRadius: 12))
            .accessibilityIdentifier("noteDone")
            Spacer(minLength: 0)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 16)
        .padding(.top, 20)
        .accessibilityElement(children: .contain)
        .presentationDetents([.large])
        .presentationBackground(Palette.surface)
        .presentationDragIndicator(.visible)
    }
}
