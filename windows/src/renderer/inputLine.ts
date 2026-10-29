import { chipText, intentProblem, readIntent, slashHint, slashOf, type Candidate, type IntentKind, type IntentPrefer } from "../core/intent";
import { findSpace, readSpaceLine, spaceColor, spaceLineProblem, takesSpace, type SpaceChoice, type SpaceToken, type TodoSpaces } from "../core/todoSpaces";
import { h, icon, lang, t } from "./api";
import { keyCap } from "./slip";

/**
 * 입력 줄: one line that understands what it is given — a to-do, an event, a timer, an alarm or a
 * note (core intent.ts). While typing, chips above the text show the readings, the picked one
 * outlined in sage; Tab / Shift+Tab pick another, a click picks one, Enter puts the picked one in,
 * Ctrl+Enter makes it an event. Shift+Enter starts a new line (several lines are a note). The
 * note's line (a card at the bottom of the sheet) and 빠른 입력 (a slip) use the same component.
 *
 * 할 일 스페이스 (1.30): `#회사` in the line is taken out before it is read, and a ● 회사 chip (or + 새 스페이스 ‘회사’)
 * follows the to-do's; Shift+Tab goes through the spaces it could mean while there is a `#` (W7), else back through
 * the meanings as before.
 */

const measure = document.createElement("canvas").getContext("2d")!;

export const kindIcon: Record<IntentKind, string> = { todo: "check", event: "calendar", timer: "timer", alarm: "alarm", memo: "note", repeat: "repeat" };

export interface InputLineOptions {
  variant: "note" | "slip";
  /** The long and the short placeholder (the short one in narrow windows). */
  placeholder: () => { long: string; short: string };
  /** "memo" on the 메모 page: Enter makes a note of the text, no chips. */
  mode?: () => "intent" | "memo";
  prefer?: () => IntentPrefer;
  /** The right-hand hint while empty (the note's "Ctrl+N"), or nothing. */
  shortcut?: () => string | undefined;
  /** The spaces and the lens's space (the note on 오늘), for `#회사`; none: the line reads `#` as text. */
  spaces?: () => { data: TodoSpaces; lens?: string } | undefined;
  /** Put `candidate` in (the line clears when it returns true); `space` for a to-do. */
  commit: (candidate: Candidate, candidates: Candidate[], text: string, space?: SpaceChoice) => Promise<boolean> | boolean;
  /** ↑ in the empty line (the note steps into its list). */
  onArrowUp?: (event: KeyboardEvent) => void;
  onEscape?: (event: KeyboardEvent) => void;
  /** The text or the readings changed (the quick entry's window fits itself). */
  onChange?: () => void;
}

export class InputLine {
  readonly element: HTMLElement;
  readonly field: HTMLTextAreaElement;
  private readonly chips: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly side: HTMLElement;
  private candidates: Candidate[] = [];
  private picked = 0;
  /** The spaces the line's `#` could mean (or the lens's), and the one picked. */
  private spaceChoices: SpaceChoice[] = [];
  private spacePicked = 0;
  private token?: SpaceToken;
  private tokenText = "";
  private kinds = "";
  private busy = false;

  constructor(private readonly options: InputLineOptions) {
    this.field = h("textarea", { class: "typed", rows: "1", spellcheck: "false", "aria-label": t("입력 줄"), autocomplete: "off" });
    this.chips = h("div", { class: "reads chips", role: "listbox", "aria-label": t("알아들은 뜻") });
    this.hint = h("div", { class: "inp-hint", "aria-live": "polite" });
    this.side = h("span", { class: "inp-side" });
    const row = h("div", { class: "inp-row" }, this.field, this.side);
    this.element = options.variant === "note"
      ? h("div", { class: "inp" }, this.chips, row, this.hint)
      : h("div", { class: "inp slip-inp" }, this.chips, h("div", { class: "hand-field" }, this.field, this.side), this.hint);
    this.field.addEventListener("input", () => this.refresh());
    this.field.addEventListener("focus", () => this.element.classList.add("focused"));
    this.field.addEventListener("blur", () => this.element.classList.remove("focused"));
    this.field.addEventListener("keydown", (event) => this.key(event));
    // Sized again whenever the line shows or changes width: a line measured while hidden (the focus card
    // or the pick bar in its place) would otherwise keep a 0px-tall field and no placeholder.
    new ResizeObserver(() => this.grow()).observe(this.element);
    // Caveat and Kalam arrive after the first measure: measure again.
    document.fonts.addEventListener("loadingdone", () => this.fitPlaceholder());
    void document.fonts.ready.then(() => this.fitPlaceholder());
    this.refresh();
  }

  get value(): string { return this.field.value; }
  get readings(): readonly Candidate[] { return this.candidates; }
  get pickedIndex(): number { return this.picked; }

  focus(): void { this.field.focus(); }

  set(text: string): void {
    this.field.value = text;
    this.field.setSelectionRange(text.length, text.length);
    this.refresh();
  }

  clear(): void { this.set(""); }

  /** Picks the reading of that kind (snapshots, Ctrl+Enter). */
  pick(index: number): void {
    if (index < 0 || index >= this.candidates.length) return;
    this.picked = index;
    this.drawChips();
  }

  /** Reads the text again (the language's day turned, a preference was learned). */
  refresh(): void {
    const text = this.field.value;
    const memo = this.options.mode?.() === "memo";
    // A slash word still being typed ("/", "/알") reads as nothing yet: the hint lists the words.
    // `#회사`: the line is read without it; the choices are kept for the chip (none while writing a memo).
    const spaces = memo ? undefined : this.options.spaces?.();
    const line = spaces ? readSpaceLine(text, spaces.data, spaces.lens) : { text, choices: [] as SpaceChoice[], token: undefined };
    const tokenText = line.token?.name ?? "";
    if (tokenText !== this.tokenText) this.spacePicked = 0;
    this.tokenText = tokenText;
    this.token = line.token;
    this.spaceChoices = line.choices;
    if (this.spacePicked >= this.spaceChoices.length) this.spacePicked = 0;
    this.candidates = memo ? (text.trim() ? [{ kind: "memo", text: text.trim() }] : []) : this.slashing() ? [] : readIntent(line.text, new Date(), lang(), this.options.prefer?.() ?? {});
    const kinds = this.candidates.map((candidate) => candidate.kind).join(",");
    if (kinds !== this.kinds) this.picked = 0;
    this.kinds = kinds;
    this.element.classList.toggle("typing", text.trim().length > 0);
    this.drawChips();
    this.drawHint();
    this.drawSide();
    this.grow();
    this.options.onChange?.();
  }

  private drawChips(): void {
    const memo = this.options.mode?.() === "memo";
    const show = !memo && this.field.value.trim().length > 0 && this.candidates.length > 0;
    this.chips.hidden = !show;
    if (!show) { this.chips.replaceChildren(); return; }
    const now = new Date();
    const chips: HTMLElement[] = this.candidates.map((candidate, index) => {
      const picked = index === this.picked;
      const element = h("button", { class: `chip${picked ? " on" : ""}`, role: "option", "aria-selected": String(picked), tabindex: "-1" },
        icon(kindIcon[candidate.kind], 13), h("span", {}, chipText(candidate, now, lang())));
      element.addEventListener("mousedown", (event) => event.preventDefault()); // the text keeps the focus
      element.addEventListener("click", () => { this.picked = index; this.drawChips(); this.field.focus(); });
      return element;
    });
    const space = this.spaceChip();
    if (space) chips.splice(this.picked + 1, 0, space);
    // (빠른 입력 says it in its footer: "tab 다른 뜻".)
    const tabHint = this.candidates.length >= 2 && this.options.variant === "note" ? h("span", { class: "chip quiet tab-hint", "aria-hidden": "true" }, icon("tab", 13), "Tab") : undefined;
    if (tabHint) chips.push(tabHint);
    this.chips.replaceChildren(...chips);
    // The hint never takes a line of its own (a ● 회사 chip can push it over): then it goes.
    if (tabHint && space && tabHint.offsetTop > chips[0].offsetTop + 2) tabHint.remove();
  }

  /** The space a to-do put in now would go to (none for an event, a timer…: S9). */
  private pickedSpace(): SpaceChoice | undefined {
    const candidate = this.candidates[this.picked];
    return candidate && takesSpace(candidate) ? this.spaceChoices[this.spacePicked] : undefined;
  }

  /** ● 회사 · + 새 스페이스 ‘회사’ · 스페이스 없음, after the picked to-do's chip; a click (or Shift+Tab) the next one. */
  private spaceChip(): HTMLElement | undefined {
    const choice = this.pickedSpace();
    const spaces = this.options.spaces?.();
    if (!choice || !spaces) return undefined;
    const space = choice.kind === "space" ? findSpace(spaces.data, choice.id) : undefined;
    const label = choice.kind === "new" ? t("새 스페이스 ‘{name}’", { name: choice.name }) : space?.name ?? t("스페이스 없음");
    const mark = choice.kind === "new" ? icon("plus", 12, 2.2) : h("span", { class: "space-dot" });
    if (space) mark.style.setProperty("--band", `var(--band-${spaceColor(space.color)})`);
    const element = h("button", { class: `chip space-chip${choice.kind === "new" ? " new" : ""}`, tabindex: "-1", title: this.spaceChoices.length > 1 ? t("Shift+Tab 다른 스페이스") : label }, mark, h("span", {}, label));
    if (space) element.style.setProperty("--band", `var(--band-${spaceColor(space.color)})`);
    element.addEventListener("mousedown", (event) => event.preventDefault());
    element.addEventListener("click", () => { this.cycleSpace(); this.field.focus(); });
    return element;
  }

  private cycleSpace(): void {
    if (this.spaceChoices.length < 2) return;
    this.spacePicked = (this.spacePicked + 1) % this.spaceChoices.length;
    this.drawChips();
  }

  /** "/" or the start of a slash word that isn't one yet ("/알", "/ti"). */
  private slashing(): boolean {
    const text = this.field.value.trim();
    if (!/^\/\S*$/u.test(text) || slashOf(text, lang())) return false;
    const typed = text.slice(1).toLowerCase();
    return `${slashHint(lang())} ${slashHint("ko")}`.split(" ").some((word) => word.slice(1).startsWith(typed));
  }

  /** Under the line: why a slashed line can't be put in (clay), or the slash words while one is being typed. */
  private drawHint(): void {
    const text = this.field.value.trim();
    const spaces = this.options.mode?.() === "memo" ? undefined : this.options.spaces?.();
    const problem = intentProblem(text, lang()) ?? (spaces ? spaceLineProblem(text, spaces.data, lang()) : undefined);
    const slashing = this.options.mode?.() !== "memo" && this.slashing();
    this.hint.className = `inp-hint${problem ? " bad" : ""}`;
    this.hint.hidden = !problem && !slashing;
    this.hint.textContent = problem ?? (slashing ? `${slashHint(lang())}` : "");
    if (slashing && lang() !== "ko") this.hint.textContent += `  ·  ${slashHint("ko")}`;
  }

  /** The right of the line: the shortcut while empty, ↩ 넣기 while typing. */
  private drawSide(): void {
    const typing = this.field.value.trim().length > 0;
    // A slashed line that can't be read: Enter does nothing, so ↩ 넣기 dims (as on the Mac).
    const stuck = typing && this.candidates.length === 0;
    if (typing && this.options.variant === "note") this.side.replaceChildren(h("span", { class: `kbd${stuck ? " dim" : ""}` }, `↩ ${t("넣기")}`));
    else if (!typing && this.options.shortcut?.()) this.side.replaceChildren(h("span", { class: "kbd" }, this.options.shortcut()!));
    else this.side.replaceChildren();
    this.side.hidden = this.side.childElementCount === 0;
  }

  /** The long placeholder when it fits the field, else the short one (measured in the placeholder's own font). */
  private fitPlaceholder(): void {
    const { long, short } = this.options.placeholder();
    const width = this.field.clientWidth;
    let text = long;
    if (width > 0) {
      const style = getComputedStyle(this.field, "::placeholder");
      measure.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      if (measure.measureText(long).width > width - 6) text = short;
    }
    if (this.field.placeholder !== text) this.field.placeholder = text;
  }

  /** One line, growing to four as lines are added (not measured while the line is hidden). */
  private grow(): void {
    if (!this.field.getClientRects().length) return;
    this.fitPlaceholder();
    this.field.style.height = "auto";
    const line = parseFloat(getComputedStyle(this.field).lineHeight) || 26;
    this.field.style.height = `${Math.min(this.field.scrollHeight, line * 4 + 2)}px`;
  }

  private key(event: KeyboardEvent): void {
    if (event.isComposing) return;
    const text = this.field.value;
    // W7: with a `#` in the line, Shift+Tab is for its space; without one it goes back through the meanings.
    if (event.key === "Tab" && event.shiftKey && this.token && this.spaceChoices.length >= 2 && this.pickedSpace()) {
      event.preventDefault();
      this.cycleSpace();
      return;
    }
    if (event.key === "Tab" && text.trim() && this.candidates.length >= 2) {
      event.preventDefault();
      this.picked = (this.picked + (event.shiftKey ? -1 : 1) + this.candidates.length) % this.candidates.length;
      this.drawChips();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void this.submit(event.ctrlKey || event.metaKey);
      return;
    }
    if (event.key === "ArrowUp" && !text && this.options.onArrowUp) this.options.onArrowUp(event);
    if (event.key === "Escape") this.options.onEscape?.(event);
  }

  /** Enter: the picked reading; Ctrl+Enter: as an event (the line read as /일정). */
  async submit(asEvent = false): Promise<boolean> {
    const text = this.field.value.trim();
    if (!text || this.busy) return false;
    let candidates = this.candidates;
    let index = this.picked;
    if (asEvent && this.options.mode?.() !== "memo") {
      const event = candidates.findIndex((candidate) => candidate.kind === "event");
      if (event >= 0) index = event;
      else {
        const spaces = this.options.spaces?.();
        const read = spaces ? readSpaceLine(text, spaces.data, spaces.lens).text.trim() : text;
        candidates = readIntent(`/일정 ${read}`, new Date(), lang()); // i18n-ok: the Korean slash works in every language
        index = 0;
      }
    }
    const candidate = candidates[index];
    if (!candidate) return false;
    this.busy = true;
    try {
      const space = takesSpace(candidate) ? this.spaceChoices[this.spacePicked] : undefined;
      const done = await this.options.commit(candidate, candidates, text, space);
      if (done) this.clear();
      return done;
    } finally {
      this.busy = false;
    }
  }
}

/** The keycap row of the quick entry's footer: "tab 다른 뜻 · esc 닫기". */
export function lineKeys(): HTMLElement[] {
  return [h("span", {}, keyCap("Tab"), t("다른 뜻")), h("span", {}, keyCap("Esc"), t("닫기"))];
}
