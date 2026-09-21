// Keep an element visible by scrolling ONLY its own scroll container.
//
// scrollIntoView() scrolls every scrollable ancestor, the document included.
// In a move list that means each move played drags the whole PAGE, and the
// board slides off the top — reported twice: students distracted mid-lesson
// when the class shell became a scrolling document (2026-09-21), and again in
// the board editor, where "when moves played the focus moves to notation board,
// so board moves".
//
// This walks up to the nearest scrollable ancestor and adjusts its scrollTop
// directly, so nothing above it ever moves. If the element has no scrollable
// ancestor, it does NOTHING — the whole point is never to move the page.
export function scrollIntoOwnScroller(el: HTMLElement | null | undefined): void {
  if (!el) return;
  let sc: HTMLElement | null = el.parentElement;
  while (sc && sc !== document.body) {
    const oy = getComputedStyle(sc).overflowY;
    if ((oy === "auto" || oy === "scroll") && sc.scrollHeight > sc.clientHeight) break;
    sc = sc.parentElement;
  }
  if (!sc || sc === document.body) return;      // nothing of our own to scroll — leave the page alone

  const top = el.offsetTop - sc.offsetTop;
  const above = top < sc.scrollTop;
  const below = top + el.offsetHeight > sc.scrollTop + sc.clientHeight;
  if (!above && !below) return;                 // already visible: don't scroll at all

  let smooth = true;
  try { smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { /* jsdom */ }
  sc.scrollTo({
    top: above ? top : top + el.offsetHeight - sc.clientHeight,
    behavior: smooth ? "smooth" : "auto",
  });
}
