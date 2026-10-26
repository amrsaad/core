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
        .background(Color.black)
        .foregroundStyle(.white)
        .accessibilityIdentifier("textView")
    }
}

// MARK: Punkt 5, Abrufkarte

struct RecallCardView: View {
    let moment: Moment
    let review: Bool
    let onDone: (Bool?) -> Void
    @State private var answer = ""
    @State private var shown = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(review ? "RECALL · ONE WEEK LATER" : "RECALL")
                    .font(.system(size: 12, weight: .bold)).tracking(1.4).foregroundStyle(moment.area.color)
                HStack(spacing: 12) {
                    AsyncImage(url: moment.thumbURL) { img in img.resizable().scaledToFill() } placeholder: { Palette.band }
                        .frame(width: 96, height: 54)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(moment.area.label).font(.system(size: 13, weight: .semibold)).foregroundStyle(moment.area.color)
                        Text(moment.speakerLine).font(.system(size: 13)).foregroundStyle(Palette.secondary).lineLimit(2)
                    }
                }
                Text("What was the point?").font(.system(size: 26, weight: .bold))
                if !shown {
                    TextField("One sentence, from memory", text: $answer, axis: .vertical)
                        .lineLimit(3...5)
                        .font(.system(size: 17))
                        .padding(12)
                        .background(Color(hex: 0x111111), in: RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(hex: 0x333333)))
                        .accessibilityIdentifier("recallInput")
                    Button { shown = true } label: {
                        Text("Show answer").font(.system(size: 17, weight: .semibold)).foregroundStyle(.black).frame(maxWidth: .infinity, minHeight: 52)
                    }
                    .background(Color.white, in: RoundedRectangle(cornerRadius: 12))
                    Button("Skip") { onDone(nil) }
                        .font(.system(size: 15)).foregroundStyle(Palette.secondary).frame(maxWidth: .infinity, minHeight: 44)
                } else {
                    let mine = answer.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !mine.isEmpty { box("You", mine, accent: nil, size: 16) }
                    box("The point", moment.hook, accent: moment.area.color, size: 20)
                        .accessibilityIdentifier("recallAnswer")
                    HStack(spacing: 10) {
                        rate("Got it", true)
                        rate("Missed", false)
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 72)
            .padding(.bottom, 24)
        }
        .foregroundStyle(.white)
        .background(Color.black.ignoresSafeArea())
        .gesture(DragGesture(minimumDistance: 30).onEnded { v in if v.translation.height < -80 && !shown { onDone(nil) } })
        .accessibilityIdentifier("recallCard")
    }

    private func box(_ label: String, _ text: String, accent: Color?, size: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label.uppercased()).font(.system(size: 12)).tracking(1).foregroundStyle(Palette.tertiary)
            Text(text).font(.system(size: size, weight: accent == nil ? .regular : .semibold))
                .foregroundStyle(accent == nil ? Color(hex: 0xCFCFCF) : .white)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 16).padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: 12))
        .overlay(alignment: .leading) { if let accent { Rectangle().fill(accent).frame(width: 3) } }
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private func rate(_ title: String, _ got: Bool) -> some View {
        Button { onDone(got) } label: {
            Text(title).font(.system(size: 17, weight: .semibold)).frame(maxWidth: .infinity, minHeight: 52)
        }
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(hex: 0x3A3D45)))
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
                Button(showQR ? "Hide QR code" : "Show QR code") { showQR.toggle() }
                    .font(.system(size: 15))
                    .accessibilityIdentifier("showQR")
                if showQR, let img = QR.image(link) {
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
