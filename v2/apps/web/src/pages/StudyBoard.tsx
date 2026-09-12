// My Studies chapter editor — the REAL Dream Meet board, offline.
//
// Not a copy of the class board: literally the same components. SharedClassBoard
// runs in `local` mode against the loopback reducer in lib/localClassRoom, and
// ClassNotationPanel is the exact panel the live class renders. Everything the
// coach knows from Dream Meet works here — variations, glyphs, comments, arrows
// per position, promote / make-mainline / delete, Teach Opening, copy PGN,
// save to repertoire — with no room, no other people, and no camera or mic.
//
// Storage stays the existing study chapter: the flat move list is converted to
// the board's nested tree on load and back on save (lib/studyTree), so chapters
// written by the old editor open here unchanged.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { studiesApi, type Chapter } from "../lib/studies-api";
import SharedClassBoard, {
  setClassSetupOpen,
  triggerClassBoardAction,
  triggerClassFlipOrientation,
  triggerClassSeek,
  triggerClassSetRevise,
  useClassCursorInfo,
  useClassMoveList,
} from "../components/SharedClassBoard";
import { ClassNotationPanel } from "../components/ClassNotationPanel";
import { studyMovesToTree, treeToStudyMoves } from "../lib/studyTree";
import { TagEditor } from "../components/TagEditor";
import type { LocalRoomState, LocalTreeNode } from "../lib/localClassRoom";

type SaveStatus = "saved" | "dirty" | "saving" | "error";

function nodeAt(tree: LocalTreeNode[], path: number[]): LocalTreeNode | null {
  let cur = tree;
  let n: LocalTreeNode | null = null;
  for (const i of path) {
    const k = cur[i];
    if (!k) return null;
    n = k;
    cur = k.children;
  }
  return n;
}

export default function StudyBoardPage() {
  const { sid = "", cid = "" } = useParams<{ sid: string; cid: string }>();
  const [sp, setSp] = useSearchParams();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["chapter", sid, cid],
    queryFn: () => studiesApi.getChapter(sid, cid),
    // The board seeds itself from this once, at mount — refetching underneath
    // it would not reach the reducer and would only invite a stale overwrite.
    refetchOnWindowFocus: false,
  });

  if (q.isLoading) {
    return <div className="p-8 text-sm text-ink-400">Loading chapter…</div>;
  }
  if (q.isError || !q.data) {
    return (
      <div className="p-8">
        <div className="text-sm text-rose-400">Could not open this chapter.</div>
        <Link to={`/studies/${sid}`} className="mt-3 inline-block text-sm text-brand-300 hover:underline">← Back to study</Link>
      </div>
    );
  }
  // Came back from /board-editor?returnTo=… with a scanned notebook position:
  // make it the chapter's starting position (fresh move tree), then drop the
  // param so a reload does not re-apply it.
  const scannedFen = sp.get("fen");
  const applying = useRef(false);
  useEffect(() => {
    if (!scannedFen || !q.data || applying.current) return;
    if (!/^([pnbrqkPNBRQK1-8]+\/){7}[pnbrqkPNBRQK1-8]+ [wb] /.test(scannedFen)) { setSp({}, { replace: true }); return; }
    applying.current = true;
    studiesApi.saveChapter(sid, cid, { startingFen: scannedFen, moves: [] } as any)
      .then(() => qc.invalidateQueries({ queryKey: ["chapter", sid, cid] }))
      .finally(() => { applying.current = false; setSp({}, { replace: true }); });
  }, [scannedFen, q.data, sid, cid]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Keyed on the chapter id so switching chapters rebuilds the board (and its
  // loopback socket) from the new starting state instead of reusing the old.
  return <Editor key={`${cid}:${q.data.startingFen}`} sid={sid} cid={cid} chapter={q.data} />;
}

function Editor({ sid, cid, chapter }: { sid: string; cid: string; chapter: Chapter }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(chapter.title || "Chapter");
  const [tags, setTags] = useState<string[]>(chapter.tags || []);
  // Tags the user already uses anywhere — keeps spellings consistent.
  const tagList = useQuery({ queryKey: ["study-tags"], queryFn: studiesApi.listTags, staleTime: 60_000 });
  const [status, setStatus] = useState<SaveStatus>("saved");
  const stateRef = useRef<LocalRoomState | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Built once — the board copies it at connect time.
  const localInitial = useMemo(() => ({
    startFen: chapter.startingFen,
    tree: studyMovesToTree((chapter.moves || []) as any),
    startShapes: (chapter.startShapes || []) as any,
  }), [chapter]);

  const save = useMutation({
    mutationFn: async (opts?: { title?: string; tags?: string[] }) => {
      const st = stateRef.current;
      const body: any = { title: opts?.title ?? title, tags: opts?.tags ?? tags };
      if (st) {
        body.startingFen = st.startFen;
        body.moves = treeToStudyMoves(st.startFen, st.tree);
        body.startShapes = st.startShapes;
      }
      return studiesApi.saveChapter(sid, cid, body);
    },
    onMutate: () => setStatus("saving"),
    onSuccess: () => {
      setStatus("saved");
      qc.invalidateQueries({ queryKey: ["studies"] });
      qc.invalidateQueries({ queryKey: ["study-tags"] });
      qc.invalidateQueries({ queryKey: ["study", sid] });
    },
    onError: () => setStatus("error"),
  });
  const saveRef = useRef(save);
  useEffect(() => { saveRef.current = save; });

  const flush = useCallback(() => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    saveRef.current.mutate(undefined);
  }, []);

  const onLocalChange = useCallback((st: LocalRoomState) => {
    stateRef.current = st;
    setStatus("dirty");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { saveTimer.current = null; saveRef.current.mutate(undefined); }, 1200);
  }, []);

  // Never lose edits on navigate-away or tab close.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (saveTimer.current) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      if (saveTimer.current) { clearTimeout(saveTimer.current); saveRef.current.mutate(undefined); }
    };
  }, []);

  const room = `study:${cid}`;

  return (
    <div className="mx-auto max-w-[1500px] px-3 py-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Link to={`/studies/${sid}`} className="text-sm text-brand-300 hover:underline">← Back to study</Link>
        <input
          value={title}
          onChange={(e) => { setTitle(e.target.value); setStatus("dirty"); }}
          onBlur={() => saveRef.current.mutate({ title })}
          className="min-w-[14rem] flex-1 rounded-lg border border-ink-700 bg-ink-900/60 px-3 py-1.5 font-display text-lg text-white outline-none focus:border-brand-500"
          placeholder="Chapter title"
        />
        <SavePill status={status} onClick={flush} />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-ink-500">Topics</span>
        <div className="min-w-[18rem] flex-1">
          <TagEditor
            tags={tags}
            suggestions={tagList.data?.tags || []}
            onChange={(next) => { setTags(next); setStatus("dirty"); saveRef.current.mutate({ tags: next }); }}
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex min-w-0 flex-col">
          {/* SharedClassBoard sizes itself in container-query units, so its
              parent MUST be a sized container — without containerType + a real
              height the board resolves against the viewport and swallows the
              notation panel. Same wrapper the live class uses. */}
          <div
            className="relative flex min-h-0 items-center justify-center overflow-hidden"
            style={{ containerType: "size", height: "min(74vh, 680px)" } as any}
          >
            <SharedClassBoard
              local
              room={room}
              localInitial={localInitial}
              onLocalChange={onLocalChange}
            />
          </div>
          <BoardChrome />
        </div>
        <div className="min-w-0 overflow-y-auto" style={{ maxHeight: "min(74vh, 680px)" }}>
          <ClassNotationPanel room={room} role="coach" />
        </div>
      </div>
    </div>
  );
}

function SavePill({ status, onClick }: { status: SaveStatus; onClick: () => void }) {
  const meta: Record<SaveStatus, { text: string; cls: string }> = {
    saved:  { text: "● Saved",      cls: "text-emerald-400" },
    dirty:  { text: "● Unsaved",    cls: "text-amber-300" },
    saving: { text: "● Saving…",    cls: "text-ink-400" },
    error:  { text: "● Save failed", cls: "text-rose-400" },
  };
  const m = meta[status];
  return (
    <button
      onClick={onClick}
      title="Save now"
      className={`rounded-lg border border-ink-700 bg-ink-900/60 px-3 py-1.5 text-xs font-semibold ${m.cls} hover:border-ink-500`}
    >
      {m.text}
    </button>
  );
}

/** Board controls that sit under the board — the same actions the class footer
 *  drives, minus everything that needs a second person in the room. */
function BoardChrome() {
  const { sid = "", cid = "" } = useParams<{ sid: string; cid: string }>();
  const navigate = useNavigate();
  const { cursorIdx, historyLen } = useClassCursorInfo();
  const { tree, cursorPath } = useClassMoveList();
  const node = nodeAt(tree as any, cursorPath);
  const isRevise = !!(node as any)?.revise;
  const atRoot = cursorPath.length === 0;

  const btn = "rounded-lg border border-ink-700 bg-ink-900/60 px-2.5 py-1.5 text-sm text-ink-200 hover:border-ink-500 disabled:opacity-40";
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <button className={btn} title="Start position" onClick={() => triggerClassSeek(0)} disabled={atRoot}>⏮</button>
      <button className={btn} title="Previous move" onClick={() => triggerClassBoardAction("stepBack")} disabled={atRoot}>◀</button>
      <span className="px-1 font-mono text-xs text-ink-400">{cursorIdx} / {historyLen}</span>
      <button className={btn} title="Next move" onClick={() => triggerClassBoardAction("stepForward")}>▶</button>
      <span className="mx-1 h-5 w-px bg-ink-700" aria-hidden />
      <button className={btn} title="Flip board" onClick={() => triggerClassFlipOrientation()}>🔄 Flip</button>
      <button className={btn} title="Photograph a diagram from your notebook; the scanned position becomes this chapter's start"
        onClick={() => navigate(`/board-editor?returnTo=${encodeURIComponent(`/studies/${sid}/edit/${cid}`)}`)}>📷 Scan notebook</button>
      <button className={btn} title="Set up a position" onClick={() => setClassSetupOpen(true)}>📋 Setup</button>
      <button
        className={`${btn} ${isRevise ? "border-amber-400/60 text-amber-300" : ""}`}
        title={atRoot ? "Play a move first — revise points mark a move" : isRevise ? "Remove from daily revision" : "Add this position to daily revision"}
        disabled={atRoot}
        onClick={() => triggerClassSetRevise(cursorPath, !isRevise)}
      >
        {isRevise ? "⭐ Revise point" : "☆ Mark for revision"}
      </button>
    </div>
  );
}
