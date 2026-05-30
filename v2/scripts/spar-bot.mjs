// Sparring bot: seeks a casual game, plays a fixed opening line on its turn,
// accepts draw offers, and auto-requests a rematch. Used to drive the /play UI.
import WebSocket from "ws";
const URL = process.env.WS_URL ?? "ws://127.0.0.1:18080/ws";
const ME = "u:sparring";
const TC = { initial: 300000, increment: 3000 };
const DELAY = Number(process.env.BOT_DELAY_MS ?? 0);
const LINE = ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "a7a6", "b5a4", "g8f6"];
const ws = new WebSocket(URL);
let g = null, color = null;
const send = (o) => ws.send(JSON.stringify(o));
function maybeMove(turn, ply) {
  if (g && color && turn === color && ply < LINE.length) setTimeout(() => send({ v: 1, t: "move", g, d: { uci: LINE[ply], ply } }), DELAY);
}
ws.on("open", () => { send({ v: 1, t: "hello", d: { token: "sparring" } }); send({ v: 1, t: "seek", d: { clock: TC, rated: false } }); console.log("[spar] seeking"); });
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.t === "matched") { g = m.d.game; color = m.d.color; send({ v: 1, t: "sub", g }); console.log("[spar] matched", g, color); }
  else if (m.t === "rematch-ready") { g = m.d.game; color = m.d.white === ME ? "white" : "black"; send({ v: 1, t: "sub", g }); console.log("[spar] rematch", g, color); }
  else if (m.t === "game-state") maybeMove(m.d.turn, m.d.ply);
  else if (m.t === "moved") maybeMove(m.d.turn, m.d.ply + 1);
  else if (m.t === "offer" && m.d.kind === "draw" && m.d.by !== color) { send({ v: 1, t: "draw-accept", g }); console.log("[spar] accepted draw"); }
  else if (m.t === "game-end") { console.log("[spar] game-end", m.d.result); send({ v: 1, t: "rematch", g }); }
});
ws.on("error", (e) => console.error("[spar] err", e.message));
