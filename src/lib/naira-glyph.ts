// Stop "₦0" being read as the word "NO".
//
// The naira sign is a capital N with two bars; a zero is an O. Set solid at
// bold weight they merge into a word, and Bright reported it five times across
// different pages.
//
// ⚠️ The obvious fix - `font-variant-numeric: slashed-zero` - does NOT work
// here. Google Fonts serves Inter with only these OpenType features:
//     calt ccmp dnom frac locl numr pnum tnum
// There is no `zero` feature to activate, so the CSS is inert. Nor would a
// font fix help the people who hit this most: reps on phones where the webfont
// may never load and a system fallback renders instead.
//
// So the glyphs are separated in the STRING, which works in every font,
// including fallbacks. A narrow no-break space is used rather than a normal
// space: it is visually tighter than a word space and can never wrap the
// amount onto two lines.

/** U+202F. Tight, and never a line-break opportunity. */
export const NARROW_NBSP = " ";

/**
 * Put a narrow gap between a leading ₦ and whatever follows it.
 *
 * Only the naira sign is touched. Dollar and pound have no such collision, and
 * respacing them would change how every foreign-currency figure reads for no
 * benefit.
 */
export function spaceNaira(formatted: string): string {
  const text = String(formatted ?? "");
  if (!text.includes("₦")) return text;
  // Already spaced (normal, narrow or non-breaking) - leave it exactly as is,
  // so calling this twice can never widen the gap.
  return text.replace(/₦(?![\s  ])/g, `₦${NARROW_NBSP}`);
}
