// Sparring bot: seeks a casual game and plays a fixed opening line on its turn.
// Used to drive the /play UI in a browser e2e (no chess.js needed).
import WebSocket from "ws";
const URL = process.env.WS_URL ?? "ws://127.0.0.1:18080/ws";
const TC = { initial: 300000, increment: 3000 };
const LINE = ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "a7a6", "b5a4", "g8f6"];
const ws = new WebSocket(URL);
let g = null, color = null;
const send = (o) => ws.send(JSON.stringify(o));
function maybeMove(turn, ply) {
  if (g && color && turn === color && ply < LINE.length) send({ v: 1, t: "move", g, d: { uci: LINE[ply], ply } });
}
ws.on("open", () => { send({ v: 1, t: "hello", d: { token: "sparring" } }); send({ v: 1, t: "seek", d: { clock: TC, rated: false } }); console.log("[spar] seeking"); });
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.t === "matched") { g = m.d.game; color = m.d.color; send({ v: 1, t: "sub", g }); console.log("[spar] matched", g, color); }
  else if (m.t === "game-state") maybeMove(m.d.turn, m.d.ply);
  else if (m.t === "moved") maybeMove(m.d.turn, m.d.ply + 1);
  else if (m.t === "game-end") console.log("[spar] game-end", m.d.result);
});
ws.on("error", (e) => console.error("[spar] err", e.message));
