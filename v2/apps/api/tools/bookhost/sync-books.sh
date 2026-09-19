#!/bin/bash
# Nightly: keep France's book store in step with Vinayaka (new ingests, corrections) and pull the
# PDFs those books need from the owner's Drive "Chess" folder. Both are incremental.
set -uo pipefail
export PATH=/usr/local/bin:/usr/bin:/bin
STORE=/srv/data/chessguru-books; LIB=/srv/data/chess-library; LOG=/home/dreamworld/logs/book-sync.log
mkdir -p /home/dreamworld/logs
echo "[$(date -u +%FT%TZ)] store sync from Vinayaka" >> "$LOG"
rclone sync "pc:F:/chessguru-books" "$STORE" --exclude "*.tmp" --exclude "*.part" --transfers 4 --checkers 8 --tpslimit 8 >> "$LOG" 2>&1
python3 - "$STORE" /tmp/needed-pdfs.txt <<'PY'
import json, glob, sys
store, out = sys.argv[1], sys.argv[2]; need = set()
for m in glob.glob(store + '/*/meta.json'):
    try: pdf = json.load(open(m)).get('pdf') or ''
    except Exception: continue
    p = pdf.replace('\\', '/'); i = p.find('My Drive/Chess/')
    if i >= 0: need.add(p[i + len('My Drive/Chess/'):])
open(out, 'w').write('\n'.join(sorted(need)) + '\n'); print(len(need), 'pdfs needed')
PY
free_gb=$(df --output=avail -BG "$LIB" | tail -1 | tr -dc 0-9)
if [ "${free_gb:-0}" -lt 8 ]; then echo "[$(date -u +%FT%TZ)] only ${free_gb} GB free on /srv/data — PDF top-up skipped" >> "$LOG"; exit 0; fi
echo "[$(date -u +%FT%TZ)] PDF top-up from Drive" >> "$LOG"
rclone copy "gdrive:Chess" "$LIB" --files-from /tmp/needed-pdfs.txt --transfers 4 --checkers 8 --tpslimit 8 >> "$LOG" 2>&1
echo "[$(date -u +%FT%TZ)] done; library $(du -sh "$LIB" | cut -f1), free ${free_gb} GB" >> "$LOG"
