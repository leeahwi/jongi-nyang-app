import { app } from "electron";
import { createRequire } from "node:module";
import path from "node:path";
import { offscreenEnabled } from "../env";

/**
 * #408: the app's one door to Windows' own calls — Koffi's prebuilt Windows binary (MIT, about 1 MB; package.json
 * `optionalDependencies`, shipped as resources/native/koffi.node and fetched for a build on another system by
 * tools/native.mjs), loaded once, with user32 and kernel32 opened once. 바탕화면에 두기 (main/stayBehind.ts), 모든 앱에서
 * (main/keyHook.ts) and 노트 위쪽 두 번 눌러 접기 (main/captionClicks.ts) each declare the few functions they call on it.
 * Anywhere else — macOS, an off-screen run, a test — there is none, and a binary that won't load fails every caller
 * with the same error (each says what it does without it).
 */

type Call = (...args: never[]) => unknown;

/** The part of Koffi the app uses. */
export interface Koffi {
  load(name: string): Library;
  proto?(prototype: string): unknown;
  callback?(prototype: string): unknown;
  struct(name: string, members: Record<string, string>): unknown;
  pointer(type: unknown): unknown;
  register(callback: Call, type: unknown): unknown;
  unregister(callback: unknown): void;
  decode(pointer: unknown, type: unknown): unknown;
}

export interface Library {
  func(prototype: string): (...args: unknown[]) => unknown;
}

export interface Native {
  koffi: Koffi;
  user32: Library;
  kernel32: Library;
  /** A callback type (Koffi's `proto`, `callback` in older versions); each name may be declared once. */
  proto(prototype: string): unknown;
}

/** Where the binary is: beside the app in a release (extraResources), in node_modules while developing. */
export function koffiPath(packaged: boolean, resources: string, appPath: string): string {
  return packaged
    ? path.join(resources, "native", "koffi.node")
    : path.join(appPath, "node_modules", "@koromix", "koffi-win32-x64", "win32_x64", "koffi.node");
}

let loaded: Native | undefined;
let failed: unknown;

/**
 * Koffi with user32 and kernel32, loaded the first time anything asks; undefined where there is none (not Windows, an
 * off-screen run). Throws when the binary won't load — the same error to every caller, without trying again.
 */
export function windowsNative(): Native | undefined {
  if (process.platform !== "win32" || offscreenEnabled) return undefined;
  if (failed !== undefined) throw failed;
  if (loaded) return loaded;
  try {
    const koffi = createRequire(__filename)(koffiPath(app.isPackaged, process.resourcesPath, app.getAppPath())) as Koffi;
    const proto = (koffi.proto ?? koffi.callback)!.bind(koffi);
    loaded = { koffi, user32: koffi.load("user32.dll"), kernel32: koffi.load("kernel32.dll"), proto };
    return loaded;
  } catch (error) {
    failed = error ?? new Error("koffi.node didn't load");
    throw failed;
  }
}
