/**
 * #66: a text field's caret blinks while someone is at it, then stays lit. Each blink is a new frame of the whole
 * page, and with 2,000 to-dos on 오늘 a focused note used 1–2 % CPU doing nothing but blinking (0.27 % with the
 * blink off, the same 20 s). After `restMs` without a key, click or focus the field gets `caret-still`, whose CSS
 * (`caret-animation: manual`) keeps the caret shown without blinking; the next key or click makes it blink again.
 */
export const caretRestMs = 5000;

export function restCaret(field: HTMLElement, restMs = caretRestMs): void {
  let timer: number | undefined;
  const wake = () => {
    field.classList.remove("caret-still");
    clearTimeout(timer);
    timer = window.setTimeout(() => field.classList.add("caret-still"), restMs);
  };
  for (const type of ["focus", "keydown", "input", "pointerdown", "compositionupdate"]) field.addEventListener(type, wake);
  field.addEventListener("blur", () => {
    clearTimeout(timer);
    timer = undefined;
    field.classList.remove("caret-still");
  });
  if (document.activeElement === field) wake();
}
