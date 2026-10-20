import Foundation
import SwiftUI

/// Everything the desktop pet can do. Actions are short clips; `sit` and `sleep` are resting
/// states that need no redraw, so an idle pet costs nothing.
enum PetAction: Equatable {
    case sit, sleep
    case blink, tilt, hop, stretch, groom, yawn, happy, cheer, tea
    case walk(from: CGFloat, to: CGFloat)

    var isResting: Bool { self == .sit || self == .sleep }
}

struct PetActivity: Equatable {
    var action: PetAction
    var start: Date
    var duration: TimeInterval

    init(_ action: PetAction, start: Date = Date()) {
        self.action = action
        self.start = start
        duration = PetMotion.duration(of: action)
    }

    func isOver(at now: Date) -> Bool { !action.isResting && now.timeIntervalSince(start) >= duration }
}

/// What to draw for one moment of an activity.
struct PetFrame {
    var pose = MascotPose.rest
    var image: PetArt.Pose = .idle
    var walkFrame: Int?
    var facingRight = false
    /// Absolute position of the pet's centre along the floor.
    var x: CGFloat
    var eyesClosed = false
    var sleepy = false
    var hearts: Double?
    var sparkles: Double?
}

@MainActor
enum PetMotion {
    nonisolated static let walkSpeed: CGFloat = 24

    nonisolated static func duration(of action: PetAction) -> TimeInterval {
        switch action {
        case .sit, .sleep: 0
        case .blink: 0.2
        case .tilt: 1.5
        case .hop: 0.55
        case .stretch: 2.4
        case .groom: 2.6
        case .yawn: 1.7
        case .happy: 1.5
        case .cheer: 1.7
        case .tea: 4
        case .walk(let from, let to): max(0.6, Double(abs(to - from) / walkSpeed))
        }
    }

    static func frame(_ activity: PetActivity, homeX: CGFloat, at now: Date) -> PetFrame {
        let t = max(0, now.timeIntervalSince(activity.start))
        let u = activity.duration > 0 ? min(1, t / activity.duration) : 1
        var frame = PetFrame(x: homeX)
        switch activity.action {
        case .sit:
            break
        case .sleep:
            frame.image = PetArt.has(.sleep) ? .sleep : .idle
            frame.eyesClosed = !PetArt.has(.sleep)
            frame.sleepy = true
            if !PetArt.has(.sleep) { frame.pose.scaleY = 0.95; frame.pose.scaleX = 1.03 }
        case .blink:
            if PetArt.has(.blink) { frame.image = .blink } else { frame.eyesClosed = true }
        case .tilt:
            let amount = pow(sin(.pi * u), 2)
            if PetArt.has(.curious) { frame.image = .curious; frame.pose.rotation = -2 * amount } else { frame.pose.rotation = -8 * amount }
        case .hop:
            frame.pose = hop(u, height: 10)
        case .stretch:
            let amount = sin(.pi * u)
            if PetArt.has(.stretch) {
                frame.image = u > 0.12 && u < 0.88 ? .stretch : .idle
            } else {
                // Without the pose, a slow squash reads as leaning into a stretch.
                frame.pose.scaleY = 1 - 0.09 * amount
                frame.pose.scaleX = 1 + 0.07 * amount
                frame.eyesClosed = u > 0.2 && u < 0.8
            }
        case .groom:
            frame.image = PetArt.has(.groom) ? .groom : .idle
            frame.pose.rotation = 2 * sin(t * 9) * sin(.pi * u)
        case .yawn:
            if PetArt.has(.yawn) { frame.image = u > 0.1 && u < 0.9 ? .yawn : .idle } else { frame.eyesClosed = u > 0.15 && u < 0.85 }
            frame.pose.scaleY = 1 + 0.04 * sin(.pi * u)
        case .happy:
            if PetArt.has(.happy) { frame.image = .happy } else { frame.eyesClosed = true }
            frame.pose = hop(min(1, u * 2.2), height: 6, keeping: frame.pose)
            frame.hearts = u
        case .tea:
            // A quiet sip: the cup comes up, a small tip of the head, then back to sitting.
            frame.image = PetArt.has(.tea) && u > 0.08 && u < 0.92 ? .tea : .idle
            frame.pose.rotation = -1.5 * pow(sin(.pi * min(1, u * 1.6)), 2)
        case .cheer:
            frame.image = PetArt.has(.cheer) ? .cheer : .idle
            frame.eyesClosed = !PetArt.has(.cheer)
            let bounce = u < 0.5 ? u * 2 : (u - 0.5) * 2
            frame.pose = hop(bounce, height: 12, keeping: frame.pose)
            frame.sparkles = u
        case .walk(let from, let to):
            let eased = 0.5 - 0.5 * cos(.pi * u) // gentle start and stop
            let travelled = abs(to - from) * CGFloat(eased)
            frame.x = from + (to - from) * CGFloat(eased)
            frame.facingRight = to > from
            if let cycle = PetArt.walkCycle {
                frame.walkFrame = Int(travelled / PetArt.walkStride * CGFloat(cycle.count)) % cycle.count
                // Paw lifts are drawn into each frame. Global bounce would lift planted paws too.
            } else {
                frame.pose = MascotMotion.step(Double(travelled) / 16, strength: min(1, u * 6, (1 - u) * 6))
            }
        }
        return frame
    }

    private static func hop(_ u: Double, height: Double, keeping base: MascotPose = .rest) -> MascotPose {
        var pose = base
        let air = sin(.pi * u)
        pose.lift = CGFloat(air * height)
        let squash = u < 0.15 ? 0.05 * (u / 0.15) : u > 0.85 ? 0.05 * ((1 - u) / 0.15) : -0.04 * air
        pose.scaleY = 1 - CGFloat(squash)
        pose.scaleX = 1 + CGFloat(squash * 0.75)
        return pose
    }
}
