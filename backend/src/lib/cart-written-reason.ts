// Cart "Not interested" must carry a WRITTEN reason as well as the listed one
// (Bright, 13 Nov 2026: "they must put a written reason"). The listed reason is
// for counting objections; the words say what the customer actually said.
// Keep in step with writtenReasonProblem in src/App.tsx.

export const WRITTEN_REASON_MIN_WORDS = 3;
export const WRITTEN_REASON_MIN_CHARS = 15;

const squash = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** null when the note is a real written reason; otherwise what is wrong, in plain words. */
export function writtenReasonProblem(note: string | null | undefined, pickedReason: string | null | undefined): string | null {
  const text = String(note ?? "").trim();
  const plain = squash(text);
  if (!plain) return "Write what the customer said. A picked reason alone is not enough.";
  const words = plain.split(" ").filter(Boolean);
  if (words.length < WRITTEN_REASON_MIN_WORDS || plain.replace(/ /g, "").length < WRITTEN_REASON_MIN_CHARS) {
    return `Write what the customer said in at least ${WRITTEN_REASON_MIN_WORDS} words.`;
  }
  const picked = squash(String(pickedReason ?? ""));
  if (plain === picked || plain === "not interested" || plain === "customer not interested" || plain === "he is not interested" || plain === "she is not interested") {
    return "Don't repeat the reason. Write what the customer actually said.";
  }
  return null;
}
