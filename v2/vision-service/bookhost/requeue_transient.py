"""Put back every book that failed for a reason that was not its own fault.

Two waves of collateral damage from running 30 workers:
  * torch/CUDA errors  — 30 copies of the models overcommitted a 10 GB card
  * FileNotFoundError  — Drive File Stream stopped serving files entirely, so
                         G: stayed mounted but went empty and every read failed

Neither says anything about the PDF. A file that genuinely will not open keeps
its error, because retrying that forever just churns.
"""
import io, json, os

QUEUE = r"F:\chessguru-books\queue.json"
TRANSIENT = ("torch", "CUDA", "cuda", "out of memory",
             "FileNotFoundError", "no such file", "WinError")

q = json.load(io.open(QUEUE, encoding="utf8"))
back = kept = 0
for x in q:
    if x.get("state") != "error":
        continue
    err = str(x.get("error") or "")
    if any(t in err for t in TRANSIENT):
        x["state"] = "queued"
        x.pop("error", None)
        x.pop("finishedAt", None)
        x.pop("startedAt", None)
        back += 1
    else:
        kept += 1

tmp = QUEUE + ".tmp"
io.open(tmp, "w", encoding="utf8").write(json.dumps(q))
os.replace(tmp, QUEUE)
print("requeued %d, left %d genuinely unopenable files as errors" % (back, kept))
