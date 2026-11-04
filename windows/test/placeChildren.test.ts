import assert from "node:assert/strict";
import { test } from "node:test";
import { placeChildren, type PlacedNode } from "../src/core/placeChildren";

/** A parent and its children as a plain list, as the DOM keeps them (a node moved in is taken from where it was). */
class Item implements PlacedNode<Item> {
  parent?: Parent;
  constructor(readonly name: string) {}
  get nextSibling(): Item | null { const all = this.parent?.children ?? []; return all[all.indexOf(this) + 1] ?? null; }
  remove(): void { if (this.parent) { this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = undefined; } }
}
class Parent {
  children: Item[] = [];
  get firstChild(): Item | null { return this.children[0] ?? null; }
  insertBefore(node: Item, before: Item | null): void {
    node.remove();
    const at = before ? this.children.indexOf(before) : -1;
    this.children.splice(at < 0 ? this.children.length : at, 0, node);
    node.parent = this;
  }
}
const names = (parent: Parent) => parent.children.map((item) => item.name).join("");
function made(order: string): { parent: Parent; items: Map<string, Item> } {
  const parent = new Parent();
  const items = new Map<string, Item>();
  for (const name of order) { const item = new Item(name); items.set(name, item); parent.insertBefore(item, null); }
  return { parent, items };
}
const pick = (items: Map<string, Item>, order: string) => [...order].map((name) => items.get(name) ?? new Item(name));

test("#4: the drawer's cards end in the order asked, moving as few as they can", () => {
  const cases: [string, string, number][] = [
    ["abcdef", "abcdef", 0], // nothing changed: nothing moves
    ["abcdef", "eabcdf", 1], // an edited memo goes to the top
    ["abcdef", "bcdefa", 1], // the top one goes to the end
    ["abcdef", "abXdef", 1], // one card made again (its memo changed)
    ["abcdef", "abdef", 0], // one went (deleted)
    ["abcdef", "Nabcdef", 1], // a new one on top
    ["abcdef", "fedcba", 5],
    ["", "abc", 3],
    ["abc", "", 0],
  ];
  for (const [from, to, most] of cases) {
    const { parent, items } = made(from);
    const moved = placeChildren(parent, pick(items, to));
    assert.equal(names(parent), to, `${from} → ${to}`);
    assert.ok(moved <= most, `${from} → ${to}: ${moved} moved, at most ${most}`);
  }
});

test("#4: random reorders, drops and new cards always end in the order asked", () => {
  let seed = 7;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let round = 0; round < 500; round += 1) {
    const from = [..."abcdefghijkl"].filter(() => random() < 0.8).join("");
    const kept = [...from].filter(() => random() < 0.85);
    for (let index = kept.length - 1; index > 0; index -= 1) {
      if (random() < 0.3) { const other = Math.floor(random() * (index + 1)); [kept[index], kept[other]] = [kept[other], kept[index]]; }
    }
    if (random() < 0.5) kept.splice(Math.floor(random() * (kept.length + 1)), 0, "X");
    const to = kept.join("");
    const { parent, items } = made(from);
    placeChildren(parent, pick(items, to));
    assert.equal(names(parent), to, `${from} → ${to}`);
  }
});
