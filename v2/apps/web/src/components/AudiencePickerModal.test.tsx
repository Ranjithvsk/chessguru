// "who can join in dream meet should not have skip or x option on new class,
// only when coach rejoins existing class no need for that banner" (owner,
// 2026-09-21).
//
// Who can enter the room is decided here, so on a NEW class the dialog must not
// be dismissible — waving it away used to leave the class reachable by anyone
// holding the link. Opened by hand later it IS dismissible, because the coach
// may just be checking and submitting re-notifies the whole roster.
//
// (A rejoin never renders this at all; that lives in ClassV2, which only mounts
// the modal when audienceKind is unset or the coach pressed 🎯 Students.)

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";

const audience = {
  audienceKind: null as string | null,
  audienceBatchId: null,
  batchStudentIds: null,
  students: [] as any[],
  batches: [] as any[],
};
vi.mock("../lib/api", () => ({
  get: async () => audience,
  patch: async () => ({ ok: true, audienceCount: 1, notified: 1 }),
}));

import AudiencePickerModal from "./AudiencePickerModal";

const CLOSE_TITLE = "Close (audience unchanged)";
const show = (required: boolean, onClose = vi.fn()) => {
  render(<AudiencePickerModal room="c1" required={required} onClose={onClose} onDone={vi.fn()} />);
  return onClose;
};
const ready = () => waitFor(() => expect(screen.getByTestId("audience-actions")).toBeTruthy());

describe("AudiencePickerModal", () => {
  beforeEach(() => { cleanup(); audience.students = []; audience.batches = []; audience.audienceKind = null; });

  describe("new class (required) — the audience must be chosen", () => {
    beforeEach(() => { audience.students = [{ _id: "s1", name: "Asha" }]; });

    it("offers no Skip", async () => {
      show(true); await ready();
      expect(screen.queryByText("Skip")).toBeNull();
    });

    it("offers no × close button", async () => {
      show(true); await ready();
      expect(screen.queryByTitle(CLOSE_TITLE)).toBeNull();
    });

    it("ignores Escape", async () => {
      const onClose = show(true); await ready();
      fireEvent.keyDown(screen.getByTestId("audience-actions"), { key: "Escape" });
      expect(onClose).not.toHaveBeenCalled();
    });

    it("keeps Start & notify as the way forward", async () => {
      show(true); await ready();
      expect(screen.getByText("Start & notify")).toBeTruthy();
    });
  });

  describe("nothing is notified until the coach picks", () => {
    beforeEach(() => {
      audience.students = [{ _id: "s1", name: "Asha" }, { _id: "s2", name: "Ravi" }];
      audience.audienceKind = null;
    });

    it("starts with NO audience selected on a new class", async () => {
      show(true); await ready();
      // Used to default to "All my students", so one click notified everyone.
      expect(screen.getByText(/Choose who this class is for/)).toBeTruthy();
      expect(screen.queryByText(/Will invite/)).toBeNull();
    });

    it("cannot submit until something is picked", async () => {
      show(true); await ready();
      expect((screen.getByText("Start & notify") as HTMLButtonElement).disabled).toBe(true);
    });

    it("enables submit once the coach picks a group", async () => {
      show(true); await ready();
      // [0] is the tab; the empty-state prompt names it too.
      fireEvent.click(screen.getAllByText("All my students")[0]);
      await waitFor(() =>
        expect((screen.getByText("Start & notify") as HTMLButtonElement).disabled).toBe(false));
      expect(screen.getByText(/Will invite/)).toBeTruthy();
      expect(screen.queryByText(/Choose who this class is for/)).toBeNull();
    });

    it("still restores an audience that was already chosen", async () => {
      audience.audienceKind = "coach_students";
      show(false); await ready();
      expect((screen.getByText("Start & notify") as HTMLButtonElement).disabled).toBe(false);
    });
  });

  describe("required, but the dialog cannot be answered", () => {
    it("still offers a way out with no students and no batches", async () => {
      audience.students = []; audience.batches = [];
      show(true); await ready();
      // 'Start & notify' can never enable here, so with no exit the coach
      // would be dead-ended inside their own class.
      expect(screen.getByText("Close")).toBeTruthy();
      expect(screen.getByTitle(CLOSE_TITLE)).toBeTruthy();
    });
  });

  describe("opened by hand on an existing class — dismissible", () => {
    beforeEach(() => { audience.students = [{ _id: "s1", name: "Asha" }]; });

    it("offers Cancel and the × button", async () => {
      show(false); await ready();
      expect(screen.getByText("Cancel")).toBeTruthy();
      expect(screen.getByTitle(CLOSE_TITLE)).toBeTruthy();
    });

    it("closes on Escape", async () => {
      const onClose = show(false); await ready();
      fireEvent.keyDown(screen.getByTestId("audience-actions"), { key: "Escape" });
      expect(onClose).toHaveBeenCalled();
    });

    it("never shows the old Skip wording", async () => {
      show(false); await ready();
      expect(screen.queryByText("Skip")).toBeNull();
    });
  });
});
