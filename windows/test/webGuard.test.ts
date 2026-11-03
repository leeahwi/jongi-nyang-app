import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { deskFramePages, mayNavigate, ownPage, permissionGranted, safeExternalUrl } from "../src/core/webGuard";

/** #171 (security review L-01 · I-02 · I-03): links out, navigation, permissions and the pages' CSP. */

const root = process.cwd();

test("links: only http, https and mailto go to the system", () => {
  assert.equal(safeExternalUrl("https://example.com/a?b=1#c"), "https://example.com/a?b=1#c");
  assert.equal(safeExternalUrl("http://example.com"), "http://example.com/");
  assert.equal(safeExternalUrl("  HTTPS://Example.com/x  "), "https://example.com/x");
  // mailto opens the mail app on Windows too (it was dropped before: I-03).
  assert.equal(safeExternalUrl("mailto:sample@example.com"), "mailto:sample@example.com");
  assert.equal(safeExternalUrl("mailto:sample@example.com?subject=hi"), "mailto:sample@example.com?subject=hi");
  for (const bad of [
    "file:///C:/Windows/System32/calc.exe", "ms-msdt:/id PCWDiagnostic", "search-ms:query=x", "javascript:alert(1)",
    "data:text/html,<b>x</b>", "vbscript:x", "jongi-nyang:alarm-stop", "smb://host/share", "\\\\host\\share", "C:\\x.exe",
    "https://user:secret@example.com/", "https://exa\nmple.com", "http://", "mailto:", "", "   ", `https://example.com/${"a".repeat(5000)}`,
  ]) assert.equal(safeExternalUrl(bad), undefined, bad);
  for (const bad of [undefined, null, 42, {}, ["https://example.com"]]) assert.equal(safeExternalUrl(bad), undefined);
});

test("navigation: windows never navigate; frames only to the desk's pages in the app's folder", () => {
  const mac = "file:///Applications/Sample.app/Contents/Resources/app.asar/out/renderer";
  const win = "file:///C:/Users/sample/AppData/Local/Programs/%EC%A2%85%EC%9D%B4%EB%83%A5/resources/app.asar/out/renderer";
  for (const page of deskFramePages) assert.equal(mayNavigate({ url: `${mac}/${page}?pane=x`, isMainFrame: false }, mac), true, page);
  assert.equal(mayNavigate({ url: `${win.replace("C:", "c:")}/settings.html`, isMainFrame: false }, win), true);
  assert.equal(ownPage(`${win}/settings.html?pane=ai`, `${win}/`), "settings.html");
  assert.equal(mayNavigate({ url: `${mac}/note.html`, isMainFrame: true }, mac), false);
  assert.equal(mayNavigate({ url: "https://example.com/", isMainFrame: true }, mac), false);
  for (const url of [
    "https://example.com/settings.html", `${mac}/note.html`, `${mac}/../renderer2/settings.html`, `${mac}2/settings.html`,
    `${mac}/sub/settings.html`, "file:///etc/passwd", "about:blank", "javascript:alert(1)", "data:text/html,x", "not a url",
  ]) assert.equal(mayNavigate({ url, isMainFrame: false }, mac), false, url);
});

test("permissions: every request and check is refused", () => {
  for (const permission of ["media", "geolocation", "notifications", "clipboard-read", "clipboard-sanitized-write", "fullscreen", "openExternal", "pointerLock", "hid", "serial", "usb", "unknown"]) {
    assert.equal(permissionGranted(permission), false, permission);
  }
});

test("every page's CSP: no plugins, no <base>, no form posts, no remote scripts", () => {
  const pages = fs.readdirSync(path.join(root, "src/renderer")).filter((name) => name.endsWith(".html"));
  assert.ok(pages.length >= 19);
  for (const name of pages) {
    const html = fs.readFileSync(path.join(root, "src/renderer", name), "utf8");
    const policy = /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1];
    assert.ok(policy, `${name}: CSP`);
    const directives = new Map(policy.split(";").map((part) => part.trim().split(/\s+/)).map(([key, ...values]) => [key, values.join(" ")]));
    assert.equal(directives.get("default-src"), "'self'", name);
    assert.equal(directives.get("object-src"), "'none'", name);
    assert.equal(directives.get("base-uri"), "'none'", name);
    assert.equal(directives.get("form-action"), "'none'", name);
    assert.ok(!directives.has("script-src"), `${name}: scripts follow default-src`);
  }
});

test("the main process opens links only through safeExternal", () => {
  for (const file of fs.readdirSync(path.join(root, "src/main")).filter((name) => name.endsWith(".ts"))) {
    const source = fs.readFileSync(path.join(root, "src/main", file), "utf8");
    if (file === "security.ts") { assert.match(source, /shell\.openExternal\(safe\)/); continue; }
    assert.doesNotMatch(source, /shell\.openExternal\(/, file);
  }
});
