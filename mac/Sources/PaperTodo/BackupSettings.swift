import AppKit
import PaperCore
import SwiftUI

/// 저장과 백업 → 자동 백업 (#139, #140): whether the daily copy is made and when the last one was, 지금 백업하기,
/// and the folder the copies go to (this Mac's by default; another one can be chosen, never the storage folder).
/// The same rows and words as the Windows app's settings.ts.
struct AutoBackupGroup: View {
    @ObservedObject var book: BackupBook
    let model: AppModel

    var body: some View {
        SettingsGroup(title: L("자동 백업"), more: "backup", footer: footer) {
            statusRow
            SettingsSeparator()
            folderRow
            SettingsSeparator()
            HStack(spacing: 8) {
                Spacer()
                if book.chosenFolder != nil {
                    Button(L("기본으로")) { book.resetFolder() }.buttonStyle(PaperActionButtonStyle())
                }
                // Plain, with the folder, like the storage folder's (and Windows').
                Button { chooseFolder() } label: {
                    Label(L("다른 폴더…"), systemImage: "folder").labelStyle(.titleAndIcon)
                }
                .buttonStyle(PaperActionButtonStyle())
            }
            .padding(.vertical, 8)
            .settingsRow()
        }
        // The folder may have changed meanwhile (a copy deleted in Finder, a disk plugged back in).
        .onAppear { book.refresh() }
    }

    private var statusRow: some View {
        HStack(spacing: 10) {
            SettingsTile(systemImage: book.auto ? "checkmark.circle" : "circle.dashed")
            VStack(alignment: .leading, spacing: 2) {
                Text(book.auto ? L("자동 백업이 켜져 있어요") : L("자동 백업이 꺼져 있어요"))
                    .font(.system(size: 13, weight: .medium))
                Text(status.text)
                    .font(.system(size: 11.5))
                    .foregroundStyle(status.warn ? PaperTheme.clayText : PaperTheme.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            Button(L("지금 백업하기")) { backUpNow() }
                .buttonStyle(PaperActionButtonStyle())
                .fixedSize()
            Toggle(L("자동 백업"), isOn: $book.auto).toggleStyle(PaperToggleStyle()).labelsHidden()
        }
        .padding(.vertical, 9)
        .settingsRow()
    }

    /// The small line under the status: a problem first (in clay), else when the last copy was.
    private var status: (text: String, warn: Bool) {
        if book.failed { return (L("마지막 백업을 하지 못했어요. 백업 폴더를 확인해 주세요."), true) }
        if book.chosenMissing { return (L("고른 백업 폴더를 찾지 못해 기본 폴더에 백업해요."), true) }
        guard book.auto else { return (L("덮어쓰기 전에는 그래도 백업해 둬요."), false) }
        guard let newest = book.newest else { return (L("아직 백업이 없어요 · 하루 한 번, 덮어쓰기 전에도"), false) }
        let when = Backup.savedWhen(newest.date, now: book.now(), language: .current, midSentence: true)
        return (L("마지막 백업 \(when) · 하루 한 번, 덮어쓰기 전에도"), false)
    }

    private var folderRow: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 10) {
                SettingsLabel(L("백업 폴더"), systemImage: "externaldrive")
                Spacer(minLength: 8)
                Text(book.chosenFolder == nil ? L("이 Mac (기본)") : L("고른 폴더"))
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(PaperTheme.secondary)
                    .lineLimit(1)
                OpenFolderButton(help: L("Finder에서 백업 폴더 열기")) { book.openFolder() }
            }
            FolderPath(url: book.chosenFolder ?? book.defaultFolder)
                .padding(.leading, FolderPath.indent)
        }
        .padding(.vertical, 9)
        .settingsRow()
    }

    private var footer: String {
        let place = book.chosenFolder == nil
            ? L("백업은 이 Mac에만 있어요. 저장 폴더가 공유 폴더여도 백업은 기기마다 따로 남겨요.")
            : L("백업은 고른 폴더에만 있어요. 클라우드 폴더라면 백업도 그곳으로 올라가요.")
        guard !book.entries.isEmpty else { return place }
        let size = Backup.sizeText(book.totalSize, language: .current).keptTogether
        return place + " " + L("모두 \(book.entries.count)개 · \(size).")
    }

    private func backUpNow() { Self.backUpNow(book: book, model: model) }

    /// 지금 백업하기 (here and on the pane's backup line, #240).
    static func backUpNow(book: BackupBook, model: AppModel) {
        model.saveEverything()
        do {
            try book.copy(.manual)
        } catch {
            SlipAlert.inform(title: L("자동 백업"), message: L("백업하지 못했어요. 지금 목록은 그대로예요."))
        }
    }

    private func chooseFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.allowsMultipleSelection = false
        panel.prompt = L("이 폴더에 백업하기")
        panel.message = L("백업을 둘 폴더를 골라요. 저장 폴더 안은 고를 수 없어요.")
        TestHooks.activate()
        guard panel.runModal() == .OK, let folder = panel.url else { return }
        if !book.choose(folder) {
            SlipAlert.inform(title: L("백업 폴더"), message: L("저장 폴더 안에는 백업을 둘 수 없어요."), detail: L("다른 폴더를 골라 주세요."))
        }
    }
}

/// 저장과 백업 → 백업 목록 (#140): the copies, newest first — when, what kind (a chip), what each holds, how big — and
/// 되돌리기… on each. Five at first; the rest behind ‘N개 더 보기’. Right-click: Finder에서 보기 · 지우기 (to the Trash).
struct BackupListGroup: View {
    @ObservedObject var book: BackupBook
    let model: AppModel
    /// Snapshots: the list drawn open.
    @State var expanded = false

    private static let shown = 5

    var body: some View {
        SettingsGroup(title: L("백업 목록"), footer: book.entries.isEmpty ? nil : L("되돌리기 전에 지금 것을 한 번 더 백업해 둬요.")) {
            if book.entries.isEmpty {
                Text(L("아직 백업이 없어요. 하루 한 번 여기에 쌓여요."))
                    .font(.system(size: 12))
                    .foregroundStyle(PaperTheme.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.vertical, 12)
                    .settingsRow()
            } else {
                let rows = expanded ? book.entries : Array(book.entries.prefix(Self.shown))
                ForEach(Array(rows.enumerated()), id: \.element.id) { index, entry in
                    if index > 0 { Rectangle().fill(PaperTheme.rule).frame(height: 1).padding(.leading, 14) }
                    BackupRow(entry: entry, now: book.now()) { BackupController.restore(entry, book: book, model: model) }
                        .contextMenu {
                            Button(L("Finder에서 보기")) { book.showInFinder(entry) }
                            Button(L("지우기")) { book.trash(entry) }
                        }
                }
                if book.entries.count > Self.shown {
                    Rectangle().fill(PaperTheme.rule).frame(height: 1).padding(.leading, 14)
                    Button { expanded.toggle() } label: {
                        Text(expanded ? L("처음 5개만 보기") : L("\(book.entries.count - Self.shown)개 더 보기"))
                            .font(.system(size: 12.5, weight: .semibold))
                            .foregroundStyle(PaperTheme.sageText)
                            .settingsRow()
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

/// One copy: ‘오늘 09:12’ over its kind's chip, then what it holds (wrapping, never cut), its size and 되돌리기….
private struct BackupRow: View {
    let entry: BackupBook.Entry
    let now: Date
    let restore: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(Backup.savedWhen(entry.date, now: now, language: .current))
                    .font(.system(size: 13, weight: .semibold).monospacedDigit())
                    .lineLimit(1)
                    .fixedSize()
                BackupKindChip(reason: entry.reason)
            }
            .frame(minWidth: 124, alignment: .leading)
            Text((entry.counts?.text(.current) ?? "").keptTogether)
                .font(.system(size: 12))
                .foregroundStyle(PaperTheme.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text(Backup.sizeText(entry.size, language: .current))
                .font(.system(size: 12).monospacedDigit())
                .foregroundStyle(PaperTheme.faded)
                .fixedSize()
            Button(L("되돌리기…"), action: restore)
                .buttonStyle(PaperActionButtonStyle())
                .fixedSize()
        }
        .padding(.vertical, 9)
        .settingsRow()
        .accessibilityElement(children: .combine)
    }
}

/// The kind of a copy as a small chip: 매일 sage, the ‘before’ ones clay, 업데이트 전 lavender, 직접 honey.
struct BackupKindChip: View {
    let reason: Backup.Reason

    static func title(_ reason: Backup.Reason) -> String {
        switch reason {
        case .daily: L("매일")
        case .beforeImport: L("가져오기 전")
        case .beforeFolderSwitch: L("폴더 바꾸기 전")
        case .beforeRestore: L("되돌리기 전")
        case .beforeUpdate: L("업데이트 전")
        case .manual, .export: String(localized: "직접", table: "Settings")
        }
    }

    private var colours: (text: Color, fill: Color) {
        switch reason {
        case .daily: (PaperTheme.sageText, PaperTheme.sage2)
        case .beforeImport, .beforeFolderSwitch, .beforeRestore: (PaperTheme.clayText, PaperTheme.clay2)
        case .beforeUpdate: (PaperTheme.lavenderText, PaperTheme.memoTint)
        case .manual, .export: (PaperTheme.honeyText, PaperTheme.honey2)
        }
    }

    var body: some View {
        Text(Self.title(reason))
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(colours.text)
            .lineLimit(1)
            .padding(.horizontal, 7)
            .frame(height: 18)
            .background(colours.fill, in: Capsule())
            .fixedSize()
    }
}
