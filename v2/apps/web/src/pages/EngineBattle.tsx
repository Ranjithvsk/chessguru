import { useEffect, useRef, useState } from "react";
import Board from "../components/Board";

interface EngineInfo { id: string; name: string; elo?: number; type?: string }
interface Standing { name: string; points?: number; w?: number; d?: number; l?: number; games?: number }

export default function EngineBattlePage() {
  const ws = useRef<WebSocket | null>(null);
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [connected, setConnected] = useState(false);
  const [fen, setFen] = useState("start");
  const [match, setMatch] = useState("");
  const [standings, setStandings] = useState<Standing[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [thinkMs, setThinkMs] = useState(500);
  const [maxGames, setMaxGames] = useState(0);

  const addLog = (s: string) => setLog((l) => [s, ...l].slice(0, 60));

  useEffect(() => {
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws-engine`;
    const sock = new WebSocket(url);
    ws.current = sock;
    sock.onopen = () => setConnected(true);
    sock.onclose = () => setConnected(false);
    sock.onmessage = (ev) => {
      let m: any; try { m = JSON.parse(ev.data); } catch { return; }
      switch (m.type) {
        case "connected": setEngines(m.engines ?? []); setRunning(!!m.running); break;
        case "tournament_start": addLog(`Tournament started (${m.totalGames ?? "?"} games)`); setRunning(true); break;
        case "game_start": setMatch(`${m.whiteName ?? m.white?.name ?? "White"} vs ${m.blackName ?? m.black?.name ?? "Black"}`); break;
        case "move": if (m.fen) setFen(m.fen); break;
        case "standings_update": if (m.standings) setStandings(m.standings); break;
        case "game_end": addLog(`Game: ${m.result ?? ""} ${m.termination ?? ""}`); break;
        case "tournament_end": addLog("Tournament finished"); setRunning(false); break;
        case "stopped": addLog("Stopped"); setRunning(false); break;
        case "error": addLog(`Error: ${m.message ?? ""}`); break;
      }
    };
    return () => sock.close();
  }, []);

  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const start = () => {
    if (selected.size < 2) { addLog("Select at least 2 engines"); return; }
    ws.current?.send(JSON.stringify({ type: "start_tournament", engineIds: [...selected], thinkMs, maxGames }));
  };
  const stop = () => ws.current?.send(JSON.stringify({ type: "stop" }));

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section>
        <Board fen={fen} orientation="white" viewOnly />
        <div className="mt-3 text-sm text-ink-400">
          <span className={`mr-2 inline-block h-2 w-2 rounded-full ${connected ? "bg-accent-400" : "bg-rose-500"}`} />
          {connected ? (running ? "Running" : "Connected") : "Connecting…"}{match && <span className="ml-2 text-white">{match}</span>}
        </div>
      </section>

      <aside className="flex flex-col gap-4">
        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
          <h1 className="mb-3 font-display text-xl text-white">Engine Battle</h1>
          <div className="max-h-44 overflow-y-auto rounded-lg border border-ink-700 p-2">
            {engines.length === 0 && <p className="text-sm text-ink-400">No engines loaded.</p>}
            {engines.map((e) => (
              <label key={e.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-ink-800">
                <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggle(e.id)} className="accent-brand-500" />
                <span className="text-white">{e.name}</span>
                {e.elo && <span className="ml-auto text-ink-400">{e.elo}</span>}
              </label>
            ))}
          </div>
          <div className="mt-3 text-sm">
            <label className="block text-ink-400">Think time: {thinkMs} ms</label>
            <input type="range" min={50} max={3000} step={50} value={thinkMs} onChange={(e) => setThinkMs(Number(e.target.value))} className="w-full accent-brand-500" />
            <label className="mt-2 block text-ink-400">Max games (0 = all)</label>
            <input type="number" min={0} value={maxGames} onChange={(e) => setMaxGames(Number(e.target.value))}
              className="w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-1.5 text-white" />
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={start} disabled={!connected || running} className="flex-1 rounded-lg bg-brand-600 px-3 py-2 font-semibold text-white hover:bg-brand-500 disabled:opacity-50">▶ Start</button>
            <button onClick={stop} disabled={!running} className="rounded-lg border border-ink-600 px-3 py-2 text-ink-300 hover:bg-ink-800 disabled:opacity-50">⏹ Stop</button>
          </div>
        </div>

        {standings.length > 0 && (
          <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Standings</h2>
            {standings.map((s, i) => (
              <div key={i} className="flex justify-between py-0.5 text-sm">
                <span className="text-white">{i + 1}. {s.name}</span>
                <span className="text-ink-400">{s.points ?? 0} pts</span>
              </div>
            ))}
          </div>
        )}

        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Log</h2>
          <div className="max-h-40 space-y-1 overflow-y-auto font-mono text-xs text-ink-400">
            {log.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        </div>
      </aside>
    </div>
  );
}
