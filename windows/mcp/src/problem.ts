/** Something asked that can't be done; its words go back as the answer (isError), its code in the data. */
export class Problem extends Error {
  constructor(message: string, readonly code: "REFUSED" | "ITEM_CHANGED" = "REFUSED") { super(message); }
}
