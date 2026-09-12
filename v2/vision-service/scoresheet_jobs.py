"""Scoresheet reading as a background job for the vision service.

A 60-move sheet takes minutes on the CPU (≈3.5 s per cell), far past any HTTP
timeout, so /scoresheet/start returns a job id at once and /scoresheet/status
reports progress and, at the end, the moves. The heavy lifting runs in the OCR
venv (transformers 5 + torch) as a subprocess, because the live scanner's venv
deliberately carries none of that — see 20-dream-ocr.md, "Two venvs".

Job dir: /opt/chessguru-vision/scoresheet-jobs/<job_id>/
  sheet.png [sheet2.png]  the uploaded (rectified) page(s)
  cells/ [cells2/]        split cells
  result.json / result.pgn  reader output (per-cell status, candidates)
  status.json             {state: queued|splitting|reading|done|error, ...}
"""
from __future__ import annotations
import json, os, subprocess, threading, time, uuid
from typing import Any

HERE = os.path.dirname(os.path.abspath(__file__))
JOBS = os.environ.get("SCORESHEET_JOBS", "/opt/chessguru-vision/scoresheet-jobs")
OCR_PY = os.environ.get("SCORESHEET_PY", "/opt/chessguru-vision/.venv-ocr/bin/python")
MODEL = os.environ.get("SCORESHEET_MODEL", "/opt/chessguru-vision/models/scoresheet-trocr-current")


def _dir(job_id: str) -> str:
    return os.path.join(JOBS, job_id)


def read_status(job_id: str) -> dict[str, Any]:
    p = os.path.join(_dir(job_id), "status.json")
    if not os.path.isfile(p):
        return {"state": "unknown", "job_id": job_id}
    with open(p) as f:
        return json.load(f)


def _write(job_id: str, **kw) -> None:
    p = os.path.join(_dir(job_id), "status.json")
    cur = read_status(job_id) if os.path.isfile(p) else {"job_id": job_id, "created": time.time()}
    cur.update(kw); cur["updated"] = time.time()
    tmp = p + ".tmp"
    with open(tmp, "w") as f:
        json.dump(cur, f)
    os.replace(tmp, p)


def _run(job_id: str, paired: bool) -> None:
    d = _dir(job_id)
    try:
        _write(job_id, state="splitting")
        import split_scoresheet as sp
        n1 = len(sp.split(os.path.join(d, "sheet.png"), os.path.join(d, "cells")))
        n2 = 0
        if paired:
            n2 = len(sp.split(os.path.join(d, "sheet2.png"), os.path.join(d, "cells2")))
        if n1 < 2:
            _write(job_id, state="error", error="no move grid found on the sheet — is the photo rectified and the whole grid in frame?")
            return
        _write(job_id, state="reading", cells=n1, cells2=n2)
        model = os.path.realpath(MODEL)
        tight = "1" if os.path.isfile(os.path.join(model, "RECIPE.txt")) and "TIGHT=1" in open(os.path.join(model, "RECIPE.txt")).read() else "0"
        env = dict(os.environ, TIGHT=tight, OMP_NUM_THREADS=str(max(1, (os.cpu_count() or 4) - 1)))
        cmd = [OCR_PY, os.path.join(HERE, "read_scoresheet.py"), model, "--device", "cpu", "--fast",
               "--json", os.path.join(d, "result.json"), "--pgn", os.path.join(d, "result.pgn")]
        cmd += ["--pair", os.path.join(d, "cells"), os.path.join(d, "cells2")] if paired else [os.path.join(d, "cells")]
        t0 = time.time()
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=3600, env=env, cwd=HERE)
        if p.returncode != 0:
            _write(job_id, state="error", error=(p.stderr or p.stdout)[-800:])
            return
        with open(os.path.join(d, "result.json")) as f:
            cells = json.load(f)
        pgn = open(os.path.join(d, "result.pgn")).read().strip()
        summary = {s: sum(c["status"] == s for c in cells) for s in ("verified", "agreed", "guess", "inferred", "unknown")}
        _write(job_id, state="done", pgn=pgn, cells=cells, summary=summary, seconds=int(time.time() - t0), model=os.path.basename(model))
    except Exception as e:  # noqa: BLE001
        _write(job_id, state="error", error=str(e)[:800])


def start(sheet_png: bytes, sheet2_png: bytes | None = None, owner: str = "") -> str:
    job_id = time.strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:6]
    d = _dir(job_id); os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, "sheet.png"), "wb") as f:
        f.write(sheet_png)
    if sheet2_png:
        with open(os.path.join(d, "sheet2.png"), "wb") as f:
            f.write(sheet2_png)
    _write(job_id, state="queued", owner=owner, paired=bool(sheet2_png))
    threading.Thread(target=_run, args=(job_id, bool(sheet2_png)), daemon=True).start()
    return job_id
