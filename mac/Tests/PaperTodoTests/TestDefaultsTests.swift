import Foundation

/// #278: the checks' throwaway preferences (TestDefaults) never touch the real app's, and leave nothing behind.
/// scripts/test-defaults-cleanup.sh builds and runs this, then checks the shell side and the cleanup script.
@main
enum TestDefaultsTests {
    static var failures = 0

    static func expect(_ condition: Bool, _ message: String) {
        if condition { print("ok   \(message)") } else { failures += 1; print("FAIL \(message)") }
    }

    static func main() {
        // The real app's name, in any spelling, and anything that isn't a test name: refused.
        for name in ["com.noa.PaperTodo", "COM.NOA.PAPERTODO", "com.noa.papertodo", "com.noa.PaperTodo.", "com.noa.PaperTodoX",
                     "com.noa.PaperTodo.plist", "com.noa.PaperTodo..Perf2", "com.noa.PaperTodo.Perf2.plist", "PaperTodo", "PaperTodo.", "",
                     " com.noa.PaperTodo", "com.noa.PaperTodo ", "com.noa.PaperTodo/../com.noa.PaperTodo",
                     NSHomeDirectory() + "/Library/Preferences/com.noa.PaperTodo", "NSGlobalDomain", "com.apple.finder"] {
            expect(!TestDefaults.isTestName(name), "refuses ‘\(name)’")
        }
        // The checks' suites and the test copies' bundle ids: allowed.
        for name in ["PaperTodo.Design.\(UUID().uuidString)", "PaperTodo.Preview", "com.noa.PaperTodo.Perf2", "com.noa.PaperTodo.LiveTest"] {
            expect(TestDefaults.isTestName(name), "allows ‘\(name)’")
        }

        // A suite works like any UserDefaults, lives in the temporary folder, and goes away with its file.
        let suite = TestDefaults("TestDefaultsTests")
        let preferences = NSHomeDirectory() + "/Library/Preferences/"
        expect(!suite.path.hasPrefix(preferences), "the suite is not in ~/Library/Preferences")
        expect(suite.path.hasPrefix(FileManager.default.temporaryDirectory.path), "the suite is in the temporary folder")
        suite.defaults.set("장보기", forKey: "sample")
        suite.defaults.set(true, forKey: "reminder.enabled")
        expect(suite.defaults.string(forKey: "sample") == "장보기", "reads back what it wrote")
        expect(UserDefaults(suiteName: suite.path)?.bool(forKey: "reminder.enabled") == true, "another handle sees it")
        suite.remove()
        expect(suite.defaults.string(forKey: "sample") == nil, "empty after remove()")
        expect(!FileManager.default.fileExists(atPath: suite.path + ".plist"), "its file is gone after remove()")
        expect(!FileManager.default.fileExists(atPath: preferences + suite.name + ".plist"), "nothing in ~/Library/Preferences")
        suite.remove()
        // The shell checks again after this process has ended (cfprefsd used to write the file back then).
        print("suite \(suite.name) \(suite.path)")
        if failures > 0 { print("\(failures) failed"); exit(1) }
        print("All TestDefaults checks passed.")
    }
}
