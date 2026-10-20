import SwiftUI

/// What an empty page shows: one of the cat's poses, faint, and a short line of what goes here.
/// Sits a little below the last ruled row, so the page still reads as paper. Centred on the whole
/// sheet (not on the part right of the margin line, which put it ~27 pt right of the window's
/// centre); the poses differ from the header cat's (happy · curious · tea).
struct EmptySheetNote: View {
    let pose: PetArt.Pose
    let text: String

    var body: some View {
        VStack(spacing: 8) {
            Image(nsImage: PetArt.image(pose) ?? PaperTheme.mascot)
                .resizable()
                .scaledToFit()
                .frame(width: 84, height: 84)
                .opacity(0.9)
                .accessibilityHidden(true)
            Text(text)
                .font(.system(size: 12))
                .foregroundStyle(PaperTheme.faded)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 24)
        .frame(maxWidth: .infinity)
        .padding(.top, 36)
    }
}
