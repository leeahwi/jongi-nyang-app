/// #389: the parts of Node that 종이냥 for Claude (windows/mcp, bundled into one file) uses, for `--mcp-stdio`
/// (MCPStdio.swift): `require` of node:fs · path · os · crypto · process, and the globals Buffer, setTimeout,
/// URL, AbortController and console. Only what the server calls, with Node's names, results and error codes;
/// windows/mcp/test runs against it (scripts/test-mcp-stdio.sh) to keep it that way.
enum MCPStdioPrelude {
    static let source = #"""
(function (host) {
  "use strict";
  const g = globalThis;
  const codes = { 1: "EPERM", 2: "ENOENT", 5: "EIO", 9: "EBADF", 13: "EACCES", 16: "EBUSY", 17: "EEXIST", 18: "EXDEV", 20: "ENOTDIR",
    21: "EISDIR", 22: "EINVAL", 24: "EMFILE", 27: "EFBIG", 28: "ENOSPC", 30: "EROFS", 35: "EAGAIN", 62: "ELOOP", 63: "ENAMETOOLONG", 66: "ENOTEMPTY" };
  const check = (result, syscall, path) => {
    if (typeof result !== "number" || result >= 0) return result;
    const code = codes[-result] || "EIO";
    const error = new Error(`${code}: ${syscall}${path === undefined ? "" : ` '${path}'`}`);
    Object.assign(error, { errno: result, code, syscall }, path === undefined ? {} : { path });
    throw error;
  };

  class Buffer extends Uint8Array {
    static from(value, encoding, length) {
      if (typeof value === "string") {
        if (encoding === "hex") return Buffer.from((value.match(/../g) || []).map((pair) => parseInt(pair, 16)));
        return host.encode(value);
      }
      if (value instanceof ArrayBuffer) return new Buffer(value, encoding || 0, length);
      const copy = new Buffer(value.length);
      copy.set(value);
      return copy;
    }
    static alloc(size, fill) { const buffer = new Buffer(size); if (fill) buffer.fill(typeof fill === "string" ? fill.charCodeAt(0) : fill); return buffer; }
    static allocUnsafe(size) { return new Buffer(size); }
    static isBuffer(value) { return value instanceof Buffer; }
    static byteLength(value) { return typeof value === "string" ? host.encode(value).length : value.byteLength; }
    static concat(list, total) {
      const out = new Buffer(total ?? list.reduce((sum, part) => sum + part.length, 0));
      let at = 0;
      for (const part of list) { if (at >= out.length) break; out.set(part.subarray(0, out.length - at), at); at += part.length; }
      return out;
    }
    toString(encoding = "utf8", start = 0, end = this.length) {
      if (encoding === "hex") return Array.from(this.subarray(start, end), (byte) => byte.toString(16).padStart(2, "0")).join("");
      if (encoding === "latin1" || encoding === "binary" || encoding === "ascii") return String.fromCharCode(...this.subarray(start, end));
      if (encoding === "base64") return btoa(this.toString("latin1", start, end));
      return host.decode(this, start, end);
    }
    equals(other) { return this.length === other.length && host.same(this, other); }
    indexOf(value, from = 0) {
      if (typeof value === "number") return super.indexOf(value, from);
      if (typeof value === "string" && value.length === 1 && value.charCodeAt(0) < 128) return super.indexOf(value.charCodeAt(0), from);
      const needle = typeof value === "string" ? host.encode(value) : value;
      for (let at = from; at <= this.length - needle.length; at++) if (needle.every((byte, index) => this[at + index] === byte)) return at;
      return -1;
    }
    includes(value, from) { return this.indexOf(value, from) !== -1; }
    toJSON() { return { type: "Buffer", data: Array.from(this) }; }
  }
  host.newBuffer = (size) => new Buffer(size);
  const bytesOf = (data, encoding) => (typeof data === "string" ? Buffer.from(data, encoding) : data);

  const constants = { O_RDONLY: 0, O_WRONLY: 1, O_RDWR: 2, O_APPEND: 8, O_CREAT: 0x200, O_TRUNC: 0x400, O_EXCL: 0x800, O_NOFOLLOW: 0x100,
    F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1 };
  const flagsOf = (flag = "r") => (typeof flag === "number" ? flag : ({
    r: 0, "r+": 2, w: 0x601, "w+": 0x602, wx: 0xe01, "wx+": 0xe02, xw: 0xe01, a: 0x209, "a+": 0x20a, ax: 0xa09, xa: 0xa09,
  })[flag] ?? check(-22, "open"));
  const options = (value) => (typeof value === "string" ? { encoding: value } : value || {});
  class Stats {
    constructor([mode, size, mtimeMs, nlink, ino, dev, uid, gid, atimeMs, ctimeMs, birthtimeMs]) {
      Object.assign(this, { mode, size, mtimeMs, nlink, ino, dev, uid, gid, atimeMs, ctimeMs, birthtimeMs });
      Object.assign(this, { mtime: new Date(mtimeMs), atime: new Date(atimeMs), ctime: new Date(ctimeMs), birthtime: new Date(birthtimeMs) });
    }
    isFile() { return (this.mode & 0o170000) === 0o100000; }
    isDirectory() { return (this.mode & 0o170000) === 0o040000; }
    isSymbolicLink() { return (this.mode & 0o170000) === 0o120000; }
  }
  const openSync = (path, flags, mode = 0o666) => check(host.open(String(path), flagsOf(flags), mode), "open", path);
  const closeSync = (fd) => { check(host.close(fd), "close"); };
  const readSync = (fd, buffer, offset = 0, length = buffer.length - offset, position = null) =>
    check(host.read(fd, buffer, offset, length, position ?? -1), "read");
  function writeSync(fd, data, offset, length, position) {
    if (typeof data === "string") { position = offset; data = Buffer.from(data, length); offset = 0; length = data.length; }
    offset = offset ?? 0;
    length = length ?? data.length - offset;
    let done = 0;
    while (done < length) {
      const at = position === null || position === undefined ? -1 : position + done;
      done += check(host.write(fd, data, offset + done, length - done, at), "write");
    }
    return done;
  }
  function readFileSync(file, how) {
    const { encoding, flag } = options(how);
    const fd = typeof file === "number" ? file : openSync(file, flag || "r");
    try {
      const parts = [];
      for (;;) {
        const part = new Buffer(65536);
        const count = readSync(fd, part, 0, part.length, null);
        if (count === 0) break;
        parts.push(part.subarray(0, count));
      }
      const bytes = Buffer.concat(parts);
      return encoding ? bytes.toString(encoding) : bytes;
    } finally { if (typeof file !== "number") closeSync(fd); }
  }
  function writeFileSync(file, data, how) {
    const { encoding, flag, mode } = options(how);
    const fd = typeof file === "number" ? file : openSync(file, flag || "w", mode);
    try { writeSync(fd, bytesOf(data, encoding)); } finally { if (typeof file !== "number") closeSync(fd); }
  }
  const stat = (target, how, name) => new Stats(check(host.stat(target, how), name, typeof target === "number" ? undefined : target));
  const fs = {
    constants, openSync, closeSync, readSync, writeSync, readFileSync, writeFileSync,
    statSync: (file) => stat(String(file), 1, "stat"), lstatSync: (file) => stat(String(file), 0, "lstat"), fstatSync: (fd) => stat(fd, 1, "fstat"),
    existsSync: (file) => { try { stat(String(file), 1, "stat"); return true; } catch { return false; } },
    renameSync: (from, to) => { check(host.rename(String(from), String(to)), "rename", from); },
    unlinkSync: (file) => { check(host.unlink(String(file)), "unlink", file); },
    readdirSync: (dir) => check(host.readdir(String(dir)), "scandir", dir),
    mkdirSync(dir, how) {
      const { recursive, mode = 0o777 } = typeof how === "number" ? { mode: how } : how || {};
      if (!recursive) { check(host.mkdir(String(dir), mode), "mkdir", dir); return; }
      let made = "";
      for (const part of path.resolve(dir).split("/").slice(1)) {
        made += `/${part}`;
        const result = host.mkdir(made, mode);
        if (result < 0 && !(result === -17 && stat(made, 1, "stat").isDirectory())) check(result, "mkdir", made);
      }
    },
  };

  const normalize = (parts, absolute) => {
    const out = [];
    for (const part of parts.join("/").split("/")) {
      if (part === "" || part === ".") continue;
      if (part === "..") { if (out.length && out[out.length - 1] !== "..") out.pop(); else if (!absolute) out.push(".."); } else out.push(part);
    }
    return (absolute ? "/" : "") + out.join("/") || (absolute ? "/" : ".");
  };
  const path = {
    sep: "/", delimiter: ":",
    join: (...parts) => normalize(parts.filter(Boolean), String(parts.find(Boolean) ?? "").startsWith("/")),
    resolve: (...parts) => {
      const from = parts.map(String).reduce((last, part, index) => (part.startsWith("/") ? index : last), -1);
      return normalize(from < 0 ? [process.cwd(), ...parts] : parts.slice(from), true);
    },
    normalize: (file) => normalize([file], file.startsWith("/")),
    isAbsolute: (file) => file.startsWith("/"),
    basename: (file, ext) => { const base = file.replace(/\/+$/, "").split("/").pop() ?? ""; return ext && base.endsWith(ext) && base !== ext ? base.slice(0, -ext.length) : base; },
    dirname: (file) => { const rest = file.replace(/\/+$/, "").split("/").slice(0, -1).join("/"); return rest || (file.startsWith("/") ? "/" : "."); },
    extname: (file) => { const base = path.basename(file); const dot = base.lastIndexOf("."); return dot > 0 ? base.slice(dot) : ""; },
  };
  path.posix = path;

  const randomBytes = (size) => { const buffer = new Buffer(size); host.random(buffer); return buffer; };
  const randomUUID = () => {
    const hex = randomBytes(16).map((byte, index) => (index === 6 ? (byte & 0x0f) | 0x40 : index === 8 ? (byte & 0x3f) | 0x80 : byte)).toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
  const webcrypto = { randomUUID, getRandomValues: (array) => { host.random(array); return array; } };

  class Emitter {
    constructor() { this.listeners = {}; }
    on(name, listener) { (this.listeners[name] ||= []).push({ listener }); return this; }
    once(name, listener) { (this.listeners[name] ||= []).push({ listener, once: true }); return this; }
    off(name, listener) { this.listeners[name] = (this.listeners[name] || []).filter((entry) => entry.listener !== listener); return this; }
    emit(name, ...args) {
      const entries = this.listeners[name] || [];
      this.listeners[name] = entries.filter((entry) => !entry.once);
      for (const entry of entries) entry.listener(...args);
      return entries.length > 0;
    }
    listenerCount(name) { return (this.listeners[name] || []).length; }
  }
  Object.assign(Emitter.prototype, { addListener: Emitter.prototype.on, removeListener: Emitter.prototype.off, pause() { return this; }, resume() { return this; } });
  const output = (fd) => Object.assign(new Emitter(), {
    write(chunk, encoding, done) {
      writeSync(fd, bytesOf(chunk, typeof encoding === "string" ? encoding : undefined));
      (typeof encoding === "function" ? encoding : done)?.();
      return true;
    },
  });
  const stdin = new Emitter();
  host.emit = (chunk) => stdin.emit("data", chunk);
  const process = Object.assign(new Emitter(), {
    env: host.env, platform: "darwin", pid: host.pid, argv: ["jongi-nyang"], version: "v20.0.0", versions: {},
    stdin, stdout: output(1), stderr: output(2),
    exit: (code = 0) => host.exit(code), cwd: () => host.env.PWD || "/",
    nextTick: (callback, ...args) => { Promise.resolve().then(() => callback(...args)); },
    emitWarning() {},
  });
  const os = { homedir: () => host.home, tmpdir: () => host.env.TMPDIR || "/tmp", platform: () => "darwin", EOL: "\n" };

  // Timers: the host calls fire(id) on the main queue after the wait; a cleared one is no longer here.
  const timers = new Map();
  let lastTimer = 0;
  const schedule = (callback, ms, args, repeat) => {
    const id = ++lastTimer;
    const wait = Math.max(0, Number(ms) || 0);
    timers.set(id, { callback, args, repeat: repeat ? wait : undefined });
    host.timer(id, wait);
    return { id, ref() { return this; }, unref() { return this; }, hasRef: () => true, [Symbol.toPrimitive]: () => id };
  };
  host.fire = (id) => {
    const timer = timers.get(id);
    if (!timer) return;
    if (timer.repeat === undefined) timers.delete(id); else host.timer(id, timer.repeat);
    timer.callback(...timer.args);
  };
  const clear = (timer) => { if (timer !== undefined && timer !== null) timers.delete(typeof timer === "object" ? timer.id : timer); };
  g.setTimeout = (callback, ms, ...args) => schedule(callback, ms, args, false);
  g.setInterval = (callback, ms, ...args) => schedule(callback, ms, args, true);
  g.setImmediate = (callback, ...args) => schedule(callback, 0, args, false);
  g.clearTimeout = g.clearInterval = g.clearImmediate = clear;
  g.queueMicrotask = (callback) => { Promise.resolve().then(callback); };

  // The server's resources are jongi-nyang://… addresses: a URL here is scheme, host, path, query and fragment.
  class URL {
    constructor(text, base) {
      const href = String(base === undefined ? text : new URL(base).href.replace(/[^/]*$/, "") + text);
      const parts = /^([a-z][a-z0-9+.-]*:)(?:\/\/([^/?#]*))?([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(href);
      if (!parts) throw new TypeError(`Invalid URL: ${href}`);
      const [, protocol, host = "", pathname, search = "", hash = ""] = parts;
      Object.assign(this, { href: protocol.toLowerCase() + href.slice(protocol.length), protocol: protocol.toLowerCase(), host, hostname: host.replace(/:\d+$/, ""), pathname, search, hash });
    }
    toString() { return this.href; }
    toJSON() { return this.href; }
    static canParse(text, base) { try { new URL(text, base); return true; } catch { return false; } }
  }
  g.URL = URL;
  class AbortSignal extends Emitter {
    constructor() { super(); this.aborted = false; this.reason = undefined; }
    addEventListener(name, listener) { this.once(name, listener); }
    removeEventListener(name, listener) { this.off(name, listener); }
    throwIfAborted() { if (this.aborted) throw this.reason; }
  }
  g.AbortController = class AbortController {
    constructor() { this.signal = new AbortSignal(); }
    abort(reason = new Error("This operation was aborted")) {
      if (this.signal.aborted) return;
      Object.assign(this.signal, { aborted: true, reason });
      this.signal.emit("abort", { type: "abort" });
      this.signal.onabort?.({ type: "abort" });
    }
  };
  const latin1 = (text) => Buffer.from(Array.from(text, (char) => char.charCodeAt(0)));
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  g.btoa = (text) => {
    const bytes = latin1(String(text));
    let out = "";
    for (let at = 0; at < bytes.length; at += 3) {
      const [a, b = 0, c = 0] = bytes.subarray(at, at + 3);
      const n = (a << 16) | (b << 8) | c;
      out += alphabet[n >> 18] + alphabet[(n >> 12) & 63] + (at + 1 < bytes.length ? alphabet[(n >> 6) & 63] : "=") + (at + 2 < bytes.length ? alphabet[n & 63] : "=");
    }
    return out;
  };
  g.atob = (text) => {
    const clean = String(text).replace(/[\s=]+/g, "");
    if (/[^A-Za-z0-9+/]/.test(clean) || clean.length % 4 === 1) throw new Error("The string to be decoded is not correctly encoded.");
    let bits = 0, value = 0, out = "";
    for (const char of clean) { value = (value << 6) | alphabet.indexOf(char); bits += 6; if (bits >= 8) { bits -= 8; out += String.fromCharCode((value >> bits) & 255); } }
    return out;
  };
  // Atomics.wait needs shared memory, which JavaScriptCore keeps off here: the lock's short pause sleeps instead.
  if (typeof g.SharedArrayBuffer === "undefined") g.SharedArrayBuffer = ArrayBuffer;
  Atomics.wait = (_array, _index, _value, ms) => { host.sleep(ms); return "timed-out"; };
  const log = (...args) => { process.stderr.write(args.map((arg) => (typeof arg === "string" ? arg : arg instanceof Error ? arg.stack || arg.message : JSON.stringify(arg))).join(" ") + "\n"); };
  g.console = { log, error: log, warn: log, info: log, debug: log, trace: log };
  Object.assign(g, { Buffer, process, global: g });

  const modules = { fs, path, os, process, crypto: { randomBytes, randomUUID, webcrypto } };
  return (name) => {
    const found = modules[String(name).replace(/^node:/, "")];
    if (!found) throw new Error(`Cannot find module '${name}'`);
    return found;
  };
})
"""#
}
