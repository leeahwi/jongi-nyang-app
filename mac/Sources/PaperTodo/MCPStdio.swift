import Foundation
import JavaScriptCore

/// #389: `PaperTodo --mcp-stdio` — how Claude Code starts 종이냥 for Claude, the same way as Windows (#175): the app
/// itself runs the server it carries (Contents/Resources/mcp/server/index.js, the .mcpb's program) in JavaScriptCore,
/// which every Mac has, so no Node.js is needed. Nothing of the app starts — no NSApplication, windows, Dock icon or
/// menu bar item, so a running 종이냥 is never woken. stdout carries only MCP messages; it ends when Claude closes
/// stdin. The few parts of Node the server uses come from MCPStdioPrelude (fs, path, os, crypto, process,
/// Buffer, timers, URL). There is no argument naming a script: it runs only the app's own copy.
enum MCPStdio {
    static let flag = "--mcp-stdio"

    /// Exactly `--mcp-stdio` after the program, nothing more.
    static func wanted(_ arguments: [String]) -> Bool { arguments.count == 2 && arguments[1] == flag }

    /// The app's copy of the server. Test builds may name another (`PAPERTODO_MCP_SERVER`: the test build that reads
    /// PAPERTODO_AI_HOME, #174); a release build reads no switch (TestHooks).
    static func serverFile(resources: URL?, environment: [String: String], testHooks: Bool) -> URL? {
        if testHooks, let named = environment["PAPERTODO_MCP_SERVER"], !named.isEmpty { return URL(fileURLWithPath: named) }
        return resources?.appendingPathComponent("mcp/server/index.js")
    }

    static func run() -> Never {
        signal(SIGPIPE, SIG_IGN) // Claude went away: a write fails with EPIPE and the server ends.
        guard let file = serverFile(resources: Bundle.main.resourceURL, environment: ProcessInfo.processInfo.environment,
                                    testHooks: TestHooks.enabled),
              let source = try? String(contentsOf: file, encoding: .utf8) else {
            fail("the extension isn't inside the app. Reinstall Jongi-nyang.")
        }
        let host = MCPStdioHost()
        host.start(source)
        Thread.detachNewThread { host.readStdin() }
        dispatchMain()
    }

    static func fail(_ text: String) -> Never {
        FileHandle.standardError.write(Data("jongi-nyang: \(text)\n".utf8))
        exit(1)
    }
}

/// The JavaScriptCore side: one context on the main queue; Node's calls the prelude makes become POSIX calls here.
/// Failures come back as a negative errno (the prelude throws Node's error with its code).
final class MCPStdioHost: @unchecked Sendable {
    private let context = JSContext()!
    private var emit: JSValue?
    private var fire: JSValue?
    private var newBuffer: JSValue?

    func start(_ source: String) {
        context.exceptionHandler = { _, error in MCPStdio.fail(error?.toString() ?? "error") }
        let host = JSValue(newObjectIn: context)!
        let env = ProcessInfo.processInfo.environment
        host.setObject(env, forKeyedSubscript: "env" as NSString)
        host.setObject(env["HOME"].flatMap { $0.isEmpty ? nil : $0 } ?? NSHomeDirectory(), forKeyedSubscript: "home" as NSString) // as os.homedir()
        host.setObject(getpid(), forKeyedSubscript: "pid" as NSString)
        define(host)
        guard let prelude = context.evaluateScript(MCPStdioPrelude.source, withSourceURL: URL(string: "prelude.js")),
              let require = prelude.call(withArguments: [host]) else { MCPStdio.fail("prelude") }
        emit = host.objectForKeyedSubscript("emit")
        fire = host.objectForKeyedSubscript("fire")
        newBuffer = host.objectForKeyedSubscript("newBuffer")
        let wrapped = "(function (exports, require, module, __filename, __dirname) {\n\(source)\n})"
        let module = JSValue(newObjectIn: context)!
        let exports = JSValue(newObjectIn: context)!
        module.setObject(exports, forKeyedSubscript: "exports" as NSString)
        context.evaluateScript(wrapped, withSourceURL: URL(string: "jongi-nyang.js"))?
            .call(withArguments: [exports, require, module, "jongi-nyang.js", "."])
    }

    /// Blocking reads on a thread of its own; each chunk goes to the server on the main queue. The end: Claude is done.
    func readStdin() {
        var chunk = [UInt8](repeating: 0, count: 65_536)
        while true {
            let count = read(0, &chunk, chunk.count)
            if count < 0, errno == EINTR { continue }
            guard count > 0 else { DispatchQueue.main.async { exit(0) }; return }
            let data = Data(chunk[0..<count])
            DispatchQueue.main.async { [self] in
                guard let buffer = bytes(of: data) else { return }
                emit?.call(withArguments: [buffer])
            }
        }
    }

    /// A Buffer (the prelude's) holding `data`.
    private func bytes(of data: Data) -> JSValue? {
        guard let buffer = newBuffer?.call(withArguments: [data.count]) else { return nil }
        data.withUnsafeBytes { source in
            if let target = pointer(buffer), let base = source.baseAddress { target.copyMemory(from: base, byteCount: data.count) }
        }
        return buffer
    }

    /// Where a Uint8Array's own bytes start, valid until the next call into JavaScript. The pointer is its buffer's
    /// start: a subarray's offset is added here.
    private func pointer(_ value: JSValue) -> UnsafeMutableRawPointer? {
        let ref = context.jsGlobalContextRef
        guard let object = JSValueToObject(ref, value.jsValueRef, nil),
              let base = JSObjectGetTypedArrayBytesPtr(ref, object, nil) else { return nil }
        return base + JSObjectGetTypedArrayByteOffset(ref, object, nil)
    }

    private func length(_ value: JSValue) -> Int {
        let ref = context.jsGlobalContextRef
        guard let object = JSValueToObject(ref, value.jsValueRef, nil) else { return 0 }
        return JSObjectGetTypedArrayByteLength(ref, object, nil)
    }

    private static func result(_ value: Int) -> Int { value < 0 ? -Int(errno) : value }

    private func define(_ host: JSValue) {
        func put(_ name: String, _ block: Any) { host.setObject(block, forKeyedSubscript: name as NSString) }
        put("open", { (path: String, flags: Int32, mode: Int32) -> Int in Self.result(Int(Darwin.open(path, flags, mode_t(mode)))) } as @convention(block) (String, Int32, Int32) -> Int)
        put("close", { (fd: Int32) -> Int in Self.result(Int(Darwin.close(fd))) } as @convention(block) (Int32) -> Int)
        put("read", { [unowned self] (fd: Int32, buffer: JSValue, offset: Int, count: Int, position: Int) -> Int in
            guard offset >= 0, count >= 0, offset + count <= length(buffer), let base = pointer(buffer) else { return -Int(EINVAL) }
            let target = base + offset
            return Self.result(position < 0 ? Darwin.read(fd, target, count) : pread(fd, target, count, off_t(position)))
        } as @convention(block) (Int32, JSValue, Int, Int, Int) -> Int)
        put("write", { [unowned self] (fd: Int32, buffer: JSValue, offset: Int, count: Int, position: Int) -> Int in
            guard offset >= 0, count >= 0, offset + count <= length(buffer), let base = pointer(buffer) else { return -Int(EINVAL) }
            let source = UnsafeRawPointer(base + offset)
            return Self.result(position < 0 ? Darwin.write(fd, source, count) : pwrite(fd, source, count, off_t(position)))
        } as @convention(block) (Int32, JSValue, Int, Int, Int) -> Int)
        let status: @convention(block) (JSValue, Int32) -> Any = { target, how in
            var info = stat()
            let follow: (UnsafePointer<CChar>, UnsafeMutablePointer<stat>) -> Int32 = how == 1 ? stat : lstat
            let done = target.isNumber ? fstat(target.toInt32(), &info) : follow(target.toString(), &info)
            guard done == 0 else { return -Int(errno) }
            let ms = { (time: timespec) in Double(time.tv_sec) * 1000 + Double(time.tv_nsec) / 1_000_000 }
            return [Int(info.st_mode), Int(info.st_size), ms(info.st_mtimespec), Int(info.st_nlink), Int(info.st_ino), Int(info.st_dev),
                    Int(info.st_uid), Int(info.st_gid), ms(info.st_atimespec), ms(info.st_ctimespec), ms(info.st_birthtimespec)]
        }
        put("stat", status)
        put("rename", { (from: String, to: String) -> Int in Self.result(Int(Darwin.rename(from, to))) } as @convention(block) (String, String) -> Int)
        put("unlink", { (path: String) -> Int in Self.result(Int(Darwin.unlink(path))) } as @convention(block) (String) -> Int)
        put("mkdir", { (path: String, mode: Int32) -> Int in Self.result(Int(Darwin.mkdir(path, mode_t(mode)))) } as @convention(block) (String, Int32) -> Int)
        put("readdir", { (path: String) -> Any in
            guard let directory = opendir(path) else { return -Int(errno) }
            defer { closedir(directory) }
            var names: [String] = []
            while let entry = Darwin.readdir(directory) {
                let name = withUnsafeBytes(of: entry.pointee.d_name) { String(decoding: $0.prefix(Int(entry.pointee.d_namlen)), as: UTF8.self) }
                if name != ".", name != ".." { names.append(name) }
            }
            return names
        } as @convention(block) (String) -> Any)
        // Text in and out: UTF-8 as Node does it (a broken sequence reads as U+FFFD).
        put("decode", { [unowned self] (buffer: JSValue, start: Int, end: Int) -> String in
            let size = length(buffer)
            let (from, to) = (max(0, min(start, size)), max(0, min(end, size)))
            guard to > from, let base = pointer(buffer) else { return "" }
            return String(decoding: UnsafeRawBufferPointer(start: base + from, count: to - from), as: UTF8.self)
        } as @convention(block) (JSValue, Int, Int) -> String)
        put("encode", { [unowned self] (text: String) -> JSValue in bytes(of: Data(text.utf8)) ?? JSValue(undefinedIn: context) } as @convention(block) (String) -> JSValue)
        put("same", { [unowned self] (a: JSValue, b: JSValue) -> Bool in
            let count = length(a)
            guard count == length(b) else { return false }
            guard count > 0 else { return true }
            guard let left = pointer(a), let right = pointer(b) else { return false }
            return memcmp(left, right, count) == 0
        } as @convention(block) (JSValue, JSValue) -> Bool)
        put("random", { [unowned self] (buffer: JSValue) in
            if let base = pointer(buffer) { arc4random_buf(base, length(buffer)) }
        } as @convention(block) (JSValue) -> Void)
        put("sleep", { (ms: Double) in usleep(useconds_t(max(0, min(ms, 60_000)) * 1000)) } as @convention(block) (Double) -> Void)
        put("timer", { [unowned self] (id: Int, ms: Double) in
            DispatchQueue.main.asyncAfter(deadline: .now() + max(0, ms) / 1000) { [self] in fire?.call(withArguments: [id]) }
        } as @convention(block) (Int, Double) -> Void)
        put("exit", { (code: Int32) in exit(code) } as @convention(block) (Int32) -> Void)
    }
}
