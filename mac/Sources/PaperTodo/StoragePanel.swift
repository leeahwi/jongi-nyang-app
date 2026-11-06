import AppKit
import PaperCore
import SwiftUI

/// 저장과 백업 (#240, UI/UX 점검 3의 D2 C): the pane answers its own question — where the list lives — with two choices,
/// then says in one line when the last backup was. The paths, the switch, the long footnotes, the backup list, 완료한 일 and
/// the backup file are one ‘자세히 보기’ away (never gone); moving the list still goes through the folder panel's line and the
/// question slips (#195), and going back to this Mac asks first. No filled button: changing the folder is rare and heavy.
/// The Windows pane (settings.ts storagePane) is the same.
struct StoragePanel: View {
    @ObservedObject var model: AppModel
    /// Snapshots: the details drawn open.
    @MainActor static var previewMore = false
    @State private var more = false

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            StorageChoices(model: model)
            if let book = model.backups { BackupStatusCard(book: book, model: model) }
            HStack(spacing: 8) {
                OpenFolderButton(title: L("저장 폴더 열기"), help: L("Finder에서 저장 폴더 열기")) { model.openFolder(model.storageFolderURL) }
                if let book = model.backups {
                    OpenFolderButton(title: L("백업 폴더 열기"), help: L("Finder에서 백업 폴더 열기")) { book.openFolder() }
                }
                Spacer(minLength: 8)
                Button { more.toggle() } label: {
                    HStack(spacing: 4) {
                        Text(open ? L("자세히 접기") : L("자세히 보기"))
                        Image(systemName: open ? "chevron.up" : "chevron.down").font(.system(size: 9.5, weight: .semibold))
                    }
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(PaperTheme.sageText)
                    .padding(.vertical, 6)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityValue(open ? L("펼쳐짐") : L("접힘"))
            }
            if open {
                StorageSettingsGroup(model: model)
                if let book = model.backups {
                    AutoBackupGroup(book: book, model: model)
                    BackupListGroup(book: book, model: model)
                }
                CompletedSettingsGroup(model: model)
                BackupSettingsGroup(model: model)
            }
        }
    }

    private var open: Bool { more || Self.previewMore }
}

/// ‘할 일을 어디에 둘까요?’: 이 Mac에만 · 공유 폴더에, the chosen one outlined in sage with where the list is now.
private struct StorageChoices: View {
    @ObservedObject var model: AppModel

    var body: some View {
        let shared = model.sharedFolder != nil
        let here = FolderPlace.of(FolderPath.shownPath(model.storageFolderURL), home: NSHomeDirectory()).name
        VStack(spacing: 10) {
            StorageChoiceCard(title: L("이 Mac에만"),
                              detail: shared ? L("이 Mac의 기본 폴더로 옮겨요") : L("지금 여기 있어요 · \(here)"),
                              selected: !shared) { if shared { model.resetStorageFolder() } }
            StorageChoiceCard(title: L("공유 폴더에"),
                              detail: shared ? L("지금 여기 있어요 · \(here)") : L("iCloud Drive 같은 폴더를 골라요"),
                              selected: shared) { if !shared { model.chooseStorageFolder() } }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(L("저장 위치"))
    }
}

private struct StorageChoiceCard: View {
    let title: String
    let detail: String
    let selected: Bool
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                ZStack {
                    Circle().strokeBorder(selected ? PaperTheme.sage : PaperTheme.checkBorder, lineWidth: selected ? 5 : 1.4)
                }
                .frame(width: 18, height: 18)
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(.system(size: 14, weight: .semibold))
                    Text(detail.keepingParticles)
                        .font(.system(size: 11.5))
                        .foregroundStyle(PaperTheme.ink2)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(selected ? PaperTheme.card : hovering ? PaperTheme.card : PaperTheme.card.opacity(0.7),
                        in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(selected ? PaperTheme.sage : PaperTheme.rule, lineWidth: selected ? 1.6 : 1)
            }
            .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
    }
}

/// 백업: one line — when the last copy was (or what is wrong), how they are made — and 지금 백업하기.
private struct BackupStatusCard: View {
    @ObservedObject var book: BackupBook
    let model: AppModel

    var body: some View {
        let status = Backup.status(auto: book.auto, failed: book.failed, missing: book.chosenMissing, newest: book.newest?.date,
                                   now: book.now(), language: .current)
        VStack(alignment: .leading, spacing: 7) {
            Text(L("백업"))
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(PaperTheme.ink2)
                .padding(.leading, 4)
                .accessibilityAddTraits(.isHeader)
            HStack(spacing: 12) {
                Image(systemName: status.tone == .warn ? "exclamationmark" : status.tone == .ok ? "checkmark" : "pause")
                    .font(.system(size: 10.5, weight: .bold))
                    .foregroundStyle(status.tone == .ok ? PaperTheme.onSage : PaperTheme.ink)
                    .frame(width: 22, height: 22)
                    .background(status.tone == .ok ? PaperTheme.sage : status.tone == .warn ? PaperTheme.clay2 : PaperTheme.paper2, in: Circle())
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(status.title).font(.system(size: 13.5, weight: .semibold))
                    Text(status.detail.keepingParticles)
                        .font(.system(size: 11.5))
                        .foregroundStyle(status.tone == .warn ? PaperTheme.clayText : PaperTheme.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 8)
                Button(L("지금 백업하기")) { AutoBackupGroup.backUpNow(book: book, model: model) }
                    .buttonStyle(PaperActionButtonStyle())
                    .fixedSize()
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(status.tone == .ok ? PaperTheme.sage.opacity(0.09) : PaperTheme.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay { RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(PaperTheme.rule, lineWidth: 1) }
        }
        // The folder may have changed meanwhile (a copy deleted in Finder, a disk plugged back in).
        .onAppear { book.refresh() }
    }
}
