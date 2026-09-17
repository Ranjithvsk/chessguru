#!/usr/bin/env bash
# Nightly ChessGuru vision self-improve loop.
#   1. Dump every visionCornerLabels doc to a training-ready JSONL.
#   2. If Vinayaka reachable AND there are >= 5 NEW labels since last run,
#      push data + retrain YOLO on RTX 3080 → pull ONNX → hot-swap.
#   3. Log run summary to /var/log/chessguru-vision-retrain.log
#
# Skips silently on: 0 new labels, Vinayaka unreachable, ONNX pull failure.
set -uo pipefail

LOG=/var/log/chessguru-vision-retrain.log
STATE=/var/lib/chessguru-vision-retrain-state
mkdir -p "$STATE"
log() { echo "$(date -Iseconds) $*" | tee -a "$LOG"; }

log "== nightly retrain start =="

# 1. dump labels
DUMP=/tmp/chessguru-corrections.jsonl
/opt/chessguru-vision/.venv/bin/python /opt/chessguru-vision/dump_corner_labels.py "$DUMP" 2>&1 | tee -a "$LOG"
CUR=$(wc -l < "$DUMP" 2>/dev/null || echo 0)
LAST=$(cat "$STATE/last-label-count" 2>/dev/null || echo 0)
DELTA=$((CUR - LAST))
log "labels: current=$CUR last=$LAST delta=$DELTA"

if [ "$DELTA" -lt 3 ] && [ "$CUR" -lt 3 ]; then
  log "skip: only $DELTA new label(s); need >= 3 to justify a training run"
  exit 0
fi

# 2. reach vinayaka?
if ! ssh -o ConnectTimeout=10 -o BatchMode=yes vinayaka 'hostname' >/dev/null 2>&1; then
  log "skip: vinayaka unreachable"
  exit 0
fi

# 3. push composites (existing) + new labels
log "pushing training data to vinayaka..."
ROOT="C:/yolo-book-v2"
# labels only — composites already on vinayaka
scp -q "$DUMP" "vinayaka:$ROOT/corrections.jsonl"
scp -q /opt/chessguru-vision/retrain_yolo_with_corrections.py \
  "vinayaka:$ROOT/retrain_yolo_with_corrections.py"

# 4. train (blocking; typically 5-15 min on RTX 3080)
log "kicking off retrain on vinayaka..."
ssh vinayaka "cd $ROOT & \"C:\\Program Files\\Python311\\python.exe\" retrain_yolo_with_corrections.py $ROOT corrections.jsonl" 2>&1 | tee -a "$LOG"

# 5. pull artifacts
BEST_PT=/tmp/nightly-best.pt
BEST_ONNX=/tmp/nightly-best.onnx
scp -q vinayaka:"$ROOT/runs/chessboard-seg-corrections/weights/best.pt" "$BEST_PT" || {
  log "!! best.pt pull failed"; exit 2; }
scp -q vinayaka:"$ROOT/runs/chessboard-seg-corrections/weights/best.onnx" "$BEST_ONNX" || {
  log "!! best.onnx pull failed"; exit 2; }

# 6. hot-swap
STAMP=$(date +%Y%m%d-%H%M%S)
DST=/opt/chessguru-vision/mit-weights
sudo cp "$DST/chessguru-board-seg.pt" "$DST/chessguru-board-seg.pt.$STAMP.bak" 2>/dev/null || true
sudo cp "$BEST_PT" "$DST/chessguru-board-seg.pt"
sudo cp "$BEST_ONNX" "$DST/chessguru-board-seg.onnx"
sudo chown ubuntu:ubuntu "$DST/chessguru-board-seg.pt" "$DST/chessguru-board-seg.onnx"
sudo chmod 644 "$DST/chessguru-board-seg.pt" "$DST/chessguru-board-seg.onnx"
sudo systemctl restart chessguru-ultra-vision.service
log "hot-swapped + restarted service"

# 7. Classifier retrain (piece-recognition). Fresh 10K composites (with
#    per-square ground-truth labels), push to Vinayaka, retrain YOLOv8n-cls,
#    pull ONNX + hot-swap. Skipped silently on any failure so the extractor
#    swap above stays live.
log "== classifier retrain =="
CROOT=/opt/chessguru-vision/training-data
sudo rm -rf "$CROOT/cls-nightly" "$CROOT/composites-nightly" 2>/dev/null || true
mkdir -p "$CROOT/cls-nightly" "$CROOT/composites-nightly"
/opt/chessguru-vision/.venv/bin/python /opt/chessguru-vision/gen_book_composites.py \
  --n 10000 --out "$CROOT/composites-nightly" --sq-out "$CROOT/cls-nightly" 2>&1 \
  | tail -3 | tee -a "$LOG"

# Rename to Windows-tar-safe folder names (bking/wking/… + empty).
DS_C="$CROOT/cls-nightly"
declare -A MAP=([K]=king [Q]=queen [R]=rook [B]=bishop [N]=knight [P]=pawn)
for split in train val; do
  for lbl in K Q R B N P; do sudo mv "$DS_C/$split/$lbl" "$DS_C/$split/w${MAP[$lbl]}" 2>/dev/null || true; done
  for lbl in k q r b n p; do U=${lbl^^}; sudo mv "$DS_C/$split/$lbl" "$DS_C/$split/b${MAP[$U]}" 2>/dev/null || true; done
  sudo mv "$DS_C/$split/f" "$DS_C/$split/empty" 2>/dev/null || true
done

tar czf /tmp/cls-nightly.tgz -C "$CROOT" cls-nightly 2>&1 | tail -3 | tee -a "$LOG"
scp -q /tmp/cls-nightly.tgz vinayaka:C:/yolo-cls/
ssh vinayaka "rmdir /S /Q C:\\yolo-cls\\cls-nightly 2>NUL & cd C:\\yolo-cls & tar xzf cls-nightly.tgz" 2>&1 | tail -1 | tee -a "$LOG"
scp -q /opt/chessguru-vision/train_yolo_cls_on_vinayaka.py vinayaka:C:/yolo-cls/
ssh vinayaka "rmdir /S /Q C:\\yolo-cls\\runs\\chessguru-cls 2>NUL & cd C:\\yolo-cls & \"C:\\Program Files\\Python311\\python.exe\" train_yolo_cls_on_vinayaka.py C:\\yolo-cls\\cls-nightly" 2>&1 | tail -3 | tee -a "$LOG"

if scp -q vinayaka:C:/yolo-cls/runs/chessguru-cls/weights/best.pt /tmp/cls-nightly-best.pt \
   && scp -q vinayaka:C:/yolo-cls/runs/chessguru-cls/weights/best.onnx /tmp/cls-nightly-best.onnx; then
  # MEASURE BEFORE PROMOTING. "best.pt" is only best on its own synthetic
  # validation split. Promoting it blind shipped a worse model every night from
  # 10 to 16 September 2026: photographs fell 94.37% -> 93.09% square accuracy
  # and printed book diagrams that read as legal positions fell 95% -> 33%.
  # Unreadable diagrams are dropped silently from a book, so nobody saw it until
  # an academy reported boards they could not click. The gate serves the
  # candidate on a scratch port and compares it with the model in use, on
  # photographs AND on book diagrams — the photo score moved barely a point while
  # the book score collapsed, so a photo-only gate would have waved it through.
  # NOT piped to tee: a pipeline reports the LAST command's status, so `| tee`
  # would swallow the gate's verdict and promote everything.
  if sudo -u ubuntu /opt/chessguru-vision/.venv/bin/python \
       /opt/chessguru-vision/gate_classifier.py /tmp/cls-nightly-best.pt >> "$LOG" 2>&1; then
    sudo cp "$DST/chessguru-cls.pt" "$DST/chessguru-cls.pt.$STAMP.bak" 2>/dev/null || true
    sudo cp /tmp/cls-nightly-best.pt "$DST/chessguru-cls.pt"
    sudo cp /tmp/cls-nightly-best.onnx "$DST/chessguru-cls.onnx"
    sudo chown ubuntu:ubuntu "$DST/chessguru-cls.pt" "$DST/chessguru-cls.onnx"
    sudo chmod 644 "$DST/chessguru-cls.pt" "$DST/chessguru-cls.onnx"
    sudo systemctl restart chessguru-ultra-vision.service
    log "classifier hot-swapped (gate passed)"
  else
    log "!! candidate classifier REJECTED by the gate; keeping the model in use"
  fi
else
  log "!! classifier pull failed; keeping current classifier weights"
fi

# 8. record state
echo "$CUR" > "$STATE/last-label-count"
log "== nightly retrain OK =="
