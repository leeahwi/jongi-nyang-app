import AppKit
import PaperCore
import SwiftUI

// 지운 메모 (#120, docs/plans/drawer-ux-plan.md B3 · mock ⑦): deleted memos kept 30 days in memo-trash.json (PaperCore
// MemoTrash), the slip that lists them — title · its folder · how long ago · 되돌리기 — with 지금 모두 비우기… under them
// (asked first), opened from the folder ▾ menu's last row and ⚙ (`지운 메모 세 장`, only when there are some).

// MARK: - memo-trash.json in the model

extension AppModel {
    var memoTrashURL: URL { storageFolderURL.appendingPathComponent(MemoTrash.fileName) }

    /// At launch: the file (none: an empty trash); an unreadable one is moved aside with one notice and the trash starts
    /// empty. Entries 30 days old (and those alive in memos.json) go at once.
    func loadMemoTrash(now: Date = Date()) {
        guard let data = try? SafeFile.sharedData(memoTrashURL) else {
            memoTrash = MemoTrash()
            knownTrashData = nil
            return
        }
        do {
            memoTrash = try MemoTrash.decode(data)
            knownTrashData = data
        } catch {
            moveTrashAside(now: now)
            memoTrash = MemoTrash()
            knownTrashData = nil
            return
        }
        let pruned = memoTrash.pruned(now: now, alive: aliveMemoIDs)
        if pruned != memoTrash { changeMemoTrash(now: now) { _, _ in } }
    }

    /// The memos the trash may let go of (an empty list is never read as "every memo is gone").
    private var aliveMemoIDs: Set<String> { Set(memos.map(\.id)) }

    private func moveTrashAside(now: Date) {
        let aside = memoTrashURL.deletingLastPathComponent().appendingPathComponent(
            MemoFolders.asideName(now).replacingOccurrences(of: "memo-folders", with: "memo-trash"))
        let what = L("지운 메모 파일을 읽지 못해서 지운 메모 없이 시작했어요. 메모는 모두 그대로예요.")
        if (try? FileManager.default.moveItem(at: memoTrashURL, to: aside)) != nil {
            storageError = what + " " + Self.keptAside(aside)
        } else {
            storageError = what + " " + L("저장 폴더가 열리는지 확인해 주세요.")
        }
    }

    /// Another device (or an older app's backup) changed the file: joined in (T5).
    func catchUpMemoTrash() {
        guard let data = try? SafeFile.sharedData(memoTrashURL), data != knownTrashData else { return }
        knownTrashData = data
        guard let theirs = try? MemoTrash.decode(data) else { return }
        let merged = MemoTrash.merge(here: memoTrash, theirs: theirs)
        if merged != memoTrash { memoTrash = merged }
    }

    /// Every change: catch up with the file, change, drop what's 30 days old or alive again (T4, T6), write. The file is
    /// small and changes only on a delete, a restore or emptying, so it is written here at once.
    func changeMemoTrash(now: Date = Date(), _ change: (inout MemoTrash, Date) -> Void) {
        guard !savingStopped else { return }
        catchUpMemoTrash()
        var trash = memoTrash
        change(&trash, now)
        trash = trash.pruned(now: now, alive: aliveMemoIDs)
        if trash != memoTrash { memoTrash = trash }
        let text = trash.encoded()
        guard Data(text.utf8) != knownTrashData else { return }
        do {
            try FileManager.default.createDirectory(at: memoTrashURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            let data = Data(text.utf8)
            try data.write(to: memoTrashURL, options: .atomic)
            knownTrashData = data
            if storageError?.hasPrefix(L("지운 메모를 저장하지 못했어요.")) == true { storageError = nil }
        } catch {
            storageError = Self.saveProblem(L("지운 메모를 저장하지 못했어요."))
        }
    }

    /// A memo just deleted: kept with its folder, pin and paper (T1).
    func keepInTrash(_ memo: Memo) {
        let folder = memoFolders.folderID(of: memo.id), pinned = memoFolders.isPinned(memo.id), paper = memoFolders.placement[memo.id]?.paper
        changeMemoTrash { trash, now in trash.add(memo, folder: folder, pinned: pinned, paper: paper, now: now) }
    }

    /// 되돌리기 from 지운 메모 (T2): the memo back in memos.json and in its folder (메모 when that folder is gone), pinned and
    /// papered as it was. Returns the folder it went to, nil when it isn't in the trash.
    @discardableResult
    func restoreFromTrash(_ id: String) -> String? {
        var back: MemoTrash.Entry?
        changeMemoTrash { trash, now in back = trash.remove(id, now: now) }
        guard let entry = back else { return nil }
        putBack(entry.memo)
        let folder = memoFolders.folder(entry.folder) == nil ? MemoFolders.inbox : entry.folder
        changeMemoFolders { folders, now in
            folders.place(id, in: folder, now: now)
            folders.setPinned(id, entry.pinned, now: now)
            folders.setPaper(id, entry.paper.flatMap(MemoFolders.Paper.init(rawValue:)), now: now)
        }
        return folder
    }

    /// 지금 모두 비우기 (T3).
    func emptyMemoTrash() {
        changeMemoTrash { trash, now in trash.empty(now: now) }
    }
}

// MARK: - The drawer's side

extension MemoDrawer {
    /// 지운 메모 as the drawer shows them: newest deleted first; one whose memo is alive again (restored on another
    /// device, the file not yet written here) isn't listed.
    var trashEntries: [MemoTrash.Entry] {
        let entries = model.memoTrash.entries
        guard !entries.isEmpty else { return [] }
        let alive = Set(model.memos.map(\.id))
        return entries.filter { !alive.contains($0.memo.id) }
    }

    func openTrash() {
        commitTrashSheet(open: true)
    }

    func closeTrash() {
        commitTrashSheet(open: false)
    }

    private func commitTrashSheet(open: Bool) {
        if open { folderSheet = nil }
        trashConfirm = false
        trashOpen = open
    }

    /// 되돌리기 on a row: back in its folder, with a word where it went.
    func restore(_ id: String) {
        guard let folder = model.restoreFromTrash(id) else { return }
        let name = model.memoFolders.folder(folder)?.displayName(.current) ?? ""
        say(MemoTrash.restored(to: name, language: .current))
        if trashEntries.isEmpty { closeTrash() }
    }

    /// 모두 비우기, after the question.
    func emptyTrash() {
        model.emptyMemoTrash()
        closeTrash()
        say(L("지운 메모를 비웠어요"))
    }
}

// MARK: - The slip

/// 지운 메모: a slip over the drawer (as the folder sheet) — `지운 메모 · 30일 동안 둬요`, a row for each (its handwritten
/// title; its folder · 3일 전; 되돌리기), then `되돌리면 원래 폴더로 가요` and 지금 모두 비우기…; that asks first
/// (`지운 메모 세 장을 완전히 지울까요?` / `되돌릴 수 없어요.` · 취소 · 모두 비우기). Esc or a click beside it closes it.
struct TrashSheetView: View {
    @ObservedObject var drawer: MemoDrawer
    let palette: DrawerPalette
    let font: NotebookFont

    var body: some View {
        let entries = drawer.trashEntries
        VStack(alignment: .leading, spacing: 0) {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(L("지운 메모")).font(.system(size: 13, weight: .semibold)).foregroundStyle(palette.ink).fixedSize()
                    Text(L("30일 동안 둬요")).font(.system(size: 11)).foregroundStyle(palette.secondary).fixedSize()
                    Spacer(minLength: 4)
                }
                VStack(alignment: .leading, spacing: 1) {
                    Text(L("지운 메모")).font(.system(size: 13, weight: .semibold)).foregroundStyle(palette.ink)
                    Text(L("30일 동안 둬요")).font(.system(size: 11)).foregroundStyle(palette.secondary)
                }
            }
            .padding(.bottom, 8)
            if entries.isEmpty {
                Text(L("지운 메모가 없어요")).font(.system(size: 12)).foregroundStyle(palette.secondary).padding(.vertical, 10)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(entries, id: \.memo.id) { entry in
                            row(entry)
                            if entry.memo.id != entries.last?.memo.id { Rectangle().fill(palette.slipEdge.opacity(0.7)).frame(height: 0.5) }
                        }
                    }
                }
                .frame(maxHeight: 330)
                .fixedSize(horizontal: false, vertical: true)
                .scrollIndicators(.automatic)
            }
            Rectangle().fill(palette.slipEdge).frame(height: 0.5).padding(.top, 6)
            if drawer.trashConfirm {
                confirm(entries.count)
            } else {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 8) { note; Spacer(minLength: 6); emptyButton }
                    VStack(alignment: .leading, spacing: 6) { note; HStack { Spacer(); emptyButton } }
                }
                .padding(.top, 9)
            }
        }
        .padding(14)
        .background(palette.slip, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay { RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(palette.slipEdge, lineWidth: 0.5) }
        .shadow(color: .black.opacity(0.18), radius: 10, y: 3)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(L("지운 메모"))
    }

    private var danger: Color { Color(drawerHex: palette.scheme == .dark ? "#e29a7c" : "#955842") }

    private var note: some View {
        Text(L("되돌리면 원래 폴더로 가요")).font(.system(size: 11)).foregroundStyle(palette.secondary).fixedSize(horizontal: false, vertical: true)
    }

    private var emptyButton: some View {
        Button(L("지금 모두 비우기…")) { drawer.trashConfirm = true }
            .buttonStyle(.plain)
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(danger)
            .disabled(drawer.trashEntries.isEmpty)
            .fixedSize()
    }

    private func row(_ entry: MemoTrash.Entry) -> some View {
        let folder = drawer.folders.folder(entry.folder) ?? drawer.folders.folder(MemoFolders.inbox)
        let place = [folder?.displayName(.current) ?? "", MemoTrash.ago(entry.deletedAt, now: drawer.now(), language: .current)].joined(separator: " · ")
        return ViewThatFits(in: .horizontal) {
            HStack(alignment: .center, spacing: 8) {
                title(entry)
                Spacer(minLength: 4)
                Text(place).font(.system(size: 11)).foregroundStyle(palette.faint).lineLimit(1).fixedSize()
                restoreButton(entry)
            }
            // Narrow drawers, long words: 되돌리기 beside the title, where it was and when on the line under it, whole.
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 8) {
                    title(entry)
                    Spacer(minLength: 4)
                    restoreButton(entry)
                }
                Text(place).font(.system(size: 11)).foregroundStyle(palette.faint).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, 7)
        .accessibilityElement(children: .combine)
    }

    private func title(_ entry: MemoTrash.Entry) -> some View {
        Text(MemoCards.title(entry.memo.text, language: .current).handwritten)
            .font(font.handFont(MemoDrawerView.hand(18)))
            .foregroundStyle(palette.ink)
            .lineLimit(1)
            .truncationMode(.tail)
    }

    private func restoreButton(_ entry: MemoTrash.Entry) -> some View {
        Button(String(localized: "되돌리기", table: "Settings")) { drawer.restore(entry.memo.id) }
            .buttonStyle(.plain)
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(palette.check)
            .fixedSize()
    }

    private func confirm(_ count: Int) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(MemoTrash.emptyQuestion(count, language: .current).keepingParticles)
                .font(.system(size: 12.5, weight: .semibold)).foregroundStyle(palette.ink).fixedSize(horizontal: false, vertical: true)
            Text(L("되돌릴 수 없어요.")).font(.system(size: 11.5)).foregroundStyle(palette.secondary)
            HStack(spacing: 8) {
                Spacer()
                Button(L("취소")) { drawer.trashConfirm = false }
                    .buttonStyle(.plain)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(palette.secondary)
                    .padding(.horizontal, 6)
                    .keyboardShortcut(.cancelAction)
                Button(L("모두 비우기")) { drawer.emptyTrash() }
                    .buttonStyle(.plain)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(palette.scheme == .dark ? Color(drawerHex: "#1f1d18") : Color.white)
                    .padding(.horizontal, 12)
                    .frame(height: 26)
                    .background(danger, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
            }
            .padding(.top, 6)
        }
        .padding(.top, 9)
    }
}
