import Foundation

// MARK: - The cat's own questions (1.38: 컴퓨터 켤 때 같이 열까요?)

extension PetChatter.Answer {
    public init(label: String, reply: String, pose: PetChatter.Pose) {
        self.label = label; self.reply = reply; self.pose = pose; self.action = nil
    }
}

extension PetChatter.Line {
    public init(question id: String, text: String, answers: [PetChatter.Answer]) {
        self.id = id; self.text = text; self.answers = answers
    }
}

/// 컴퓨터 켤 때 같이 열기: after the third start by hand (not at login) with the login item off, the cat asks
/// once.
public enum LoginAsk {
    public static let after = 3

    public static func shouldAsk(manualStarts: Int, loginItemOn: Bool, asked: Bool) -> Bool {
        !asked && !loginItemOn && manualStarts >= after
    }
}
