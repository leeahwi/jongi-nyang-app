import path from "node:path";
import type { Lang } from "../../src/core/lang";
import { Busy, FileFailed, Unreadable, errnoOf } from "./files";
import { RefusedFile } from "../../src/main/safeFiles";
import { fileLimits, megabytes } from "../../src/core/fileLimits";
import { Problem } from "./tools";
import { say } from "./words";

/**
 * What a tool says when it can't do something (#109): a fixed code and a short fixed sentence in the app's
 * language, never the system's own text — that names the whole path of the storage folder and with it the
 * user's name. A data file is named only by its own name ("todos.json"). Problem's words are the tools' own
 * (what was asked can't be done) and go back as they are; everything the tools don't know becomes UNKNOWN.
 *
 *   FILE_UNREADABLE  the file is there but isn't the app's (broken JSON) — nothing written over it (M17)
 *   FILE_BUSY        it kept changing under three tries
 *   ITEM_CHANGED     an item changed after the preview (apply_changes) — nothing applied (M10 · M33)
 *   FILE_IS_FOLDER   EISDIR · ENOTDIR — a folder where the file should be
 *   FILE_IS_LINK     a symbolic link where the file should be — not read, not written over (#173)
 *   FILE_TOO_LARGE   the file is past the size limit (32MB, core/fileLimits.ts) — not read, not written over (#173)
 *   FILE_NO_ACCESS   EACCES · EPERM · EROFS — no permission, or read only
 *   FILE_NOT_FOUND   ENOENT on a write — the storage folder isn't there (any more)
 *   DISK_FULL        ENOSPC · EDQUOT
 *   FILE_ERROR       any other system code on a data file
 *   WRITE_HALF_DONE  a write stopped halfway and a file couldn't be put back (should not happen)
 *   UNKNOWN          anything else
 *   REFUSED          (structured data only) the tools' own Problem; ITEM_CHANGED when it is about a change
 */

export type Code =
  | "FILE_UNREADABLE" | "FILE_BUSY" | "ITEM_CHANGED" | "FILE_IS_FOLDER" | "FILE_IS_LINK" | "FILE_TOO_LARGE" | "FILE_NO_ACCESS" | "FILE_NOT_FOUND"
  | "DISK_FULL" | "FILE_ERROR" | "WRITE_HALF_DONE" | "UNKNOWN" | "REFUSED";

export interface Failure { code: Code; text: string; detail: string }

const codeOf = (errno: string): Code =>
  errno === "EISDIR" || errno === "ENOTDIR" ? "FILE_IS_FOLDER"
    : errno === "EACCES" || errno === "EPERM" || errno === "EROFS" ? "FILE_NO_ACCESS"
      : errno === "ENOENT" ? "FILE_NOT_FOUND"
        : errno === "ENOSPC" || errno === "EDQUOT" ? "DISK_FULL"
          : "FILE_ERROR";

/** Only the file names the extension itself uses go into a sentence. */
const known = new Set(["todos.json", "events.json", "memos.json", "memo-folders.json", "repeats.json"]);
const fileName = (file: string): string => (known.has(file) ? file : "종이냥");

const unchanged = (lang: Lang) => say(lang, "아무것도 바뀌지 않았어요.", "Nothing was changed.", "Er is niets gewijzigd.");

const sentences: Record<Exclude<Code, "REFUSED" | "ITEM_CHANGED">, (file: string, lang: Lang) => string> = {
  FILE_UNREADABLE: (file, lang) => say(lang, `${file}을 읽지 못해서 손대지 않았어요. 종이냥 앱에서 먼저 열어 주세요.`, `${file} couldn’t be read, so nothing was changed. Open 종이냥 first.`, `${file} kon niet worden gelezen, dus er is niets gewijzigd. Open eerst 종이냥.`),
  FILE_BUSY: (file, lang) => say(lang, `${file}이 계속 바뀌고 있어서 쓰지 못했어요. 잠시 뒤에 다시 해 주세요.`, `${file} kept changing, so it wasn’t written. Try again in a moment.`, `${file} bleef veranderen, dus er is niets geschreven. Probeer het zo nog eens.`),
  FILE_IS_FOLDER: (file, lang) => say(lang, `${file} 자리에 파일이 아닌 것이 있어서 읽거나 쓰지 못했어요. ${unchanged(lang)}`, `${file} isn’t a file, so it couldn’t be read or written. ${unchanged(lang)}`, `${file} is geen bestand, dus het kon niet worden gelezen of geschreven. ${unchanged(lang)}`),
  FILE_IS_LINK: (file, lang) => say(lang, `${file} 자리에 링크가 있어서 읽거나 쓰지 않았어요. ${unchanged(lang)}`, `${file} is a link, so it wasn’t read or written. ${unchanged(lang)}`, `${file} is een koppeling, dus het is niet gelezen of geschreven. ${unchanged(lang)}`),
  FILE_TOO_LARGE: (file, lang) => say(lang, `${file}이 ${megabytes(fileLimits.dataFileBytes)}보다 커서 읽지 않았어요. ${unchanged(lang)}`, `${file} is bigger than ${megabytes(fileLimits.dataFileBytes)}, so it wasn’t read. ${unchanged(lang)}`, `${file} is groter dan ${megabytes(fileLimits.dataFileBytes)}, dus het is niet gelezen. ${unchanged(lang)}`),
  FILE_NO_ACCESS: (file, lang) => say(lang, `${file}을 열 권한이 없어서 읽거나 쓰지 못했어요. ${unchanged(lang)}`, `No permission to open ${file}, so it couldn’t be read or written. ${unchanged(lang)}`, `Geen toestemming om ${file} te openen, dus het kon niet worden gelezen of geschreven. ${unchanged(lang)}`),
  FILE_NOT_FOUND: (file, lang) => say(lang, `${file}을 쓸 자리를 찾지 못했어요. 종이냥 앱에서 저장 폴더를 확인해 주세요. ${unchanged(lang)}`, `Couldn’t find where to write ${file}. Check the storage folder in 종이냥. ${unchanged(lang)}`, `Kon de plek voor ${file} niet vinden. Controleer de opslagmap in 종이냥. ${unchanged(lang)}`),
  DISK_FULL: (file, lang) => say(lang, `디스크에 자리가 없어서 ${file}을 쓰지 못했어요. ${unchanged(lang)}`, `The disk is full, so ${file} wasn’t written. ${unchanged(lang)}`, `De schijf is vol, dus ${file} is niet geschreven. ${unchanged(lang)}`),
  FILE_ERROR: (file, lang) => say(lang, `${file}을 읽거나 쓰지 못했어요. 잠시 뒤에 다시 해 주세요. ${unchanged(lang)}`, `${file} couldn’t be read or written. Try again in a moment. ${unchanged(lang)}`, `${file} kon niet worden gelezen of geschreven. Probeer het zo nog eens. ${unchanged(lang)}`),
  WRITE_HALF_DONE: (file, lang) => say(lang, `${file}을 쓰다가 멈췄고 되돌리지 못했어요. 일부만 바뀌었을 수 있으니 종이냥에서 확인해 주세요.`, `Writing ${file} stopped halfway and couldn’t be undone. Some of it may have changed; check in 종이냥.`, `Het schrijven van ${file} stopte halverwege en kon niet ongedaan worden gemaakt. Een deel kan gewijzigd zijn; controleer het in 종이냥.`),
  UNKNOWN: (_file, lang) => say(lang, "알 수 없는 문제로 하지 못했어요. 잠시 뒤에 다시 해 주세요.", "Something unexpected went wrong. Try again in a moment.", "Er ging iets onverwachts mis. Probeer het zo nog eens."),
};

/** "(코드 FILE_IS_FOLDER)" after the sentence. */
const withCode = (text: string, code: Code, lang: Lang) => `${text} (${say(lang, "코드", "code", "code")} ${code})`;

/**
 * The answer for an error a tool threw. `detail` is for stderr (Claude's MCP log on this device): the code,
 * the system's code and the file's name — no path there either.
 */
export function failure(error: unknown, lang: Lang): Failure {
  if (error instanceof Problem) return { code: error.code, text: error.message, detail: error.code };
  if (error instanceof Unreadable) {
    const file = fileName(error.file);
    return { code: "FILE_UNREADABLE", text: withCode(sentences.FILE_UNREADABLE(file, lang), "FILE_UNREADABLE", lang), detail: `FILE_UNREADABLE ${file}` };
  }
  if (error instanceof RefusedFile) {
    const file = fileName(path.basename(error.file));
    const code: Code = error.why === "link" ? "FILE_IS_LINK" : "FILE_TOO_LARGE";
    return { code, text: withCode(sentences[code](file, lang), code, lang), detail: `${code} ${file}` };
  }
  if (error instanceof Busy) {
    const file = fileName(error.file);
    return { code: "FILE_BUSY", text: withCode(sentences.FILE_BUSY(file, lang), "FILE_BUSY", lang), detail: `FILE_BUSY ${file}` };
  }
  const errno = error instanceof FileFailed ? error.errno : errnoOf(error);
  if (errno) {
    const file = fileName(error instanceof FileFailed ? error.file : "");
    const code: Code = error instanceof FileFailed && !error.rolledBack ? "WRITE_HALF_DONE" : codeOf(errno);
    return { code, text: withCode(sentences[code as keyof typeof sentences](file, lang), code, lang), detail: `${code} ${errno} ${file}` };
  }
  const kind = error instanceof Error ? error.constructor.name : typeof error;
  return { code: "UNKNOWN", text: withCode(sentences.UNKNOWN("", lang), "UNKNOWN", lang), detail: `UNKNOWN ${/^\w{1,40}$/.test(kind) ? kind : "error"}` };
}
