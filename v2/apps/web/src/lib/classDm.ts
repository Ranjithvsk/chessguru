// In-class private messaging, shared between ClassV2 (which owns the panel) and
// the Navbar (whose 💬 must not navigate away from a live class).
//
// A coach or student mid-lesson who taps Messages should not lose the room. The
// navbar link went to /messages, which unmounts the class: the call tears down,
// the board socket drops, and on a tablet the whole tab gets suspended. Owner
// 2026-09-24: "he is distracted to another page, same page message will be good".
//
// `available` is set by the class page while it is mounted, so the Navbar can ask
// "is there a panel to open here?" without knowing anything about routing. When
// no class is on screen the link behaves normally.
export type ClassDmTarget = { name?: string; userId?: string };

let _open: ClassDmTarget | null = null;
let _available = false;
const subs = new Set<() => void>();
const notify = (): void => { subs.forEach((f) => f()); };

export function openClassDm(t?: ClassDmTarget): void { _open = t ?? {}; notify(); }
export function closeClassDm(): void { _open = null; notify(); }
export function setClassDmAvailable(v: boolean): void {
  if (_available === v) return;
  _available = v;
  if (!v) _open = null;          // leaving the class closes the panel with it
  notify();
}
export function subscribeClassDm(f: () => void): () => void {
  subs.add(f);
  return () => { subs.delete(f); };
}
export function getClassDmState(): { open: ClassDmTarget | null; available: boolean } {
  return { open: _open, available: _available };
}
