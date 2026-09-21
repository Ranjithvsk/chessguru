// Regression test for: "coach can use arrow keys ... even when hide moves
// selected, right?" (owner, 2026-09-21).
//
// The answer used to be NO. The keydown listener was an effect inside
// ClassNotationPanel, and ClassV2 renders that panel behind
// `{!hideNotationHere && ...}` — so pressing "Hide moves" unmounted the
// panel, tore the listener down, and the arrow keys silently died. The coach
// who hides the move list to get a bigger board is precisely the one who then
// has to walk the line from the keyboard.
//
// These tests pin the fix: the listener lives in its own always-mounted
// component, so it must keep working with no panel rendered at all.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

const stepCalls: string[] = [];
const seekCalls: number[][] = [];
let mockTree: any[] = [];
let mockCursorPath: number[] = [];

vi.mock("./SharedClassBoard", () => ({
  useClassMoveList: () => ({ tree: mockTree, cursorPath: mockCursorPath }),
  triggerClassBoardAction: (a: string) => { stepCalls.push(a); },
  triggerClassSeek: (p: number[]) => { seekCalls.push(p); },
  triggerClassPromoteVariation: () => {},
  triggerClassMakeMainline: () => {},
  triggerClassDeleteFrom: () => {},
  triggerClassAnnotateMove: () => {},
}));

import { ClassBoardKeyboardNav } from "./ClassNotationPanel";

function press(key: string, target?: HTMLElement) {
  const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  (target ?? window).dispatchEvent(ev);
  return ev;
}

describe("ClassBoardKeyboardNav — arrows survive 'Hide moves'", () => {
  beforeEach(() => {
    stepCalls.length = 0; seekCalls.length = 0;
    mockTree = []; mockCursorPath = [];
    cleanup();
  });

  it("steps the board with no notation panel mounted at all", () => {
    // This IS the hidden case: ClassV2 renders only this component when the
    // move list is hidden. Nothing else is on the page.
    render(<ClassBoardKeyboardNav role="coach" />);
    press("ArrowRight");
    press("ArrowLeft");
    expect(stepCalls).toEqual(["stepForward", "stepBack"]);
  });

  it("keeps working after the panel would have unmounted", () => {
    const { rerender } = render(<ClassBoardKeyboardNav role="coach" />);
    press("ArrowRight");
    rerender(<ClassBoardKeyboardNav role="coach" />);
    press("ArrowRight");
    expect(stepCalls).toEqual(["stepForward", "stepForward"]);
  });

  it("switches variation with up/down at a branch", () => {
    mockTree = [{ children: [] }, { children: [] }];
    mockCursorPath = [0];
    render(<ClassBoardKeyboardNav role="coach" />);
    press("ArrowDown");
    expect(seekCalls).toEqual([[1]]);
  });

  it("does not hijack arrows while typing in the chat box", () => {
    render(<ClassBoardKeyboardNav role="coach" />);
    const input = document.createElement("input");
    document.body.appendChild(input);
    press("ArrowLeft", input);
    expect(stepCalls).toEqual([]);
    input.remove();
  });

  it("is coach-only — a student's arrows never move the class board", () => {
    render(<ClassBoardKeyboardNav role="student" />);
    press("ArrowLeft");
    press("ArrowRight");
    expect(stepCalls).toEqual([]);
  });

  it("removes its listener on unmount (no leak across classes)", () => {
    const { unmount } = render(<ClassBoardKeyboardNav role="coach" />);
    unmount();
    press("ArrowRight");
    expect(stepCalls).toEqual([]);
  });
});
