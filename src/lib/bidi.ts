/**
 * Bidi isolation for places that take a string rather than an element
 * (docs/I18N.md "Left-to-right data"): a name or number interpolated into a
 * translated sentence (`t(key, { name: bdiText(name) })`), native `<option>`
 * text, `window.confirm()` messages.
 *
 * In JSX use `<Ltr>` / `<Bdi>` from components/ui.tsx instead. Never use these
 * for values that leave the screen — CSV exports, clipboard text, URLs, file
 * names, form values or PDF documents — the isolate characters are invisible
 * but they are real characters.
 */
const LRI = "⁦"; // left-to-right isolate
const FSI = "⁨"; // first-strong isolate
const PDI = "⁩"; // pop directional isolate

/** Always left to right: phones, emails, plates, VINs, document numbers, codes. */
export function ltrText(value: string | null | undefined): string {
  return value ? `${LRI}${value}${PDI}` : "";
}

/** Direction from the text's first strong character: user-entered names, titles. */
export function bdiText(value: string | null | undefined): string {
  return value ? `${FSI}${value}${PDI}` : "";
}
