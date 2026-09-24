// Runs inside the page (serialized by page.evaluate): must stay self-contained.
export function pageProbe({ gateTitles, loadingTexts }) {
  const visible = (el) => {
    if (!el) return false;
    const st = getComputedStyle(el);
    if (st.visibility === "hidden" || st.display === "none" || Number(st.opacity) === 0) return false;
    return el.getClientRects().length > 0;
  };
  const root = document.getElementById("root");
  const bodyText = document.body?.innerText ?? "";
  const rootEmpty = !root || root.children.length === 0 || (root.innerText ?? "").trim() === "";

  // Text-node + attribute candidates for raw i18n keys.
  const keyRe = /^[a-z][A-Za-z]+(\.[A-Za-z0-9_]+){1,}$/;
  const candidates = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    const t = n.nodeValue.trim();
    if (t && keyRe.test(t) && visible(n.parentElement)) candidates.add(t);
  }
  for (const el of document.querySelectorAll("[placeholder],[title],[aria-label],[alt]")) {
    for (const attr of ["placeholder", "title", "aria-label", "alt"]) {
      const v = el.getAttribute(attr)?.trim();
      if (v && keyRe.test(v)) candidates.add(v);
    }
  }

  // Horizontal overflow + the innermost elements that stick out.
  const se = document.scrollingElement ?? document.documentElement;
  const iw = window.innerWidth;
  const overflow = se.scrollWidth > iw + 1;
  const offenders = [];
  if (overflow) {
    const clips = (el) => {
      for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === "hidden" || ox === "auto" || ox === "scroll" || ox === "clip") return true;
      }
      return false;
    };
    const sticks = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && (r.right > iw + 1 || r.left < -1);
    };
    const all = [...document.body.querySelectorAll("*")].filter((el) => sticks(el) && !clips(el));
    for (const el of all) {
      if ([...el.children].some((c) => sticks(c) && !clips(c))) continue; // report innermost
      const r = el.getBoundingClientRect();
      const cls = typeof el.className === "string" ? el.className.split(/\s+/).slice(0, 6).join(".") : "";
      offenders.push({
        el: `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${cls ? "." + cls : ""}`,
        left: Math.round(r.left),
        right: Math.round(r.right),
        width: Math.round(r.width),
        text: (el.innerText ?? "").trim().slice(0, 60),
      });
      if (offenders.length >= 8) break;
    }
  }

  const visibleText = (needle) => {
    if (!bodyText.includes(needle)) return false;
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let t;
    while ((t = w.nextNode())) if (t.nodeValue.includes(needle) && visible(t.parentElement)) return true;
    return false;
  };

  return {
    url: location.href,
    path: location.pathname + location.search,
    title: document.title,
    dir: document.documentElement.dir,
    lang: document.documentElement.lang,
    theme: document.documentElement.dataset.theme ?? null,
    rootEmpty,
    textLength: bodyText.trim().length,
    gated: gateTitles.some(visibleText),
    stuckLoading: loadingTexts.some(visibleText),
    errorBoundary: (bodyText.match(/Unexpected Application Error!?|Something went wrong|Application error/i) ?? [null])[0],
    candidates: [...candidates],
    overflow: {
      overflow, scrollWidth: se.scrollWidth, innerWidth: iw, offenders,
      // Informational: the app shell is fixed-height with a scrolling <main>, so
      // a document taller than the viewport means something sticks out vertically.
      docHeight: se.scrollHeight, innerHeight: window.innerHeight,
    },
  };
}
