# 2026-09-19 — France Borg repo moved onto the Hetzner storage box

Owner: "move the borg backups to storage box".

## What changed
- **Repo location.** `/home/dreamworld/scripts/borg-backup.sh` now writes straight to
  `ssh://u672213@u672213.your-storagebox.de/./backups/france/borg` (borg-serve on the box),
  the same repo that was previously only a mirror of `/srv/data/borg/france`. The third
  copy (`THIRD_COPY` in `/etc/backup-remotes.conf`, currently `b2:dreamworld-backups/borg/france`)
  is `rclone sync`ed FROM the box.
  The local repo is deleted (see verification below); rollback is the comment in the
  script (`REPO=/srv/data/borg/france` + `rclone sync sbox:… /srv/data/borg/france`).
- **No more 15.5 GB staging.** The first run against the box (18:10 UTC) staged the mongodump
  on `/srv/data` as before and filled the disk to 12 KB free — the chess library and book
  store moved there earlier today. The dump is now streamed through a FIFO
  (`mkfifo` + `mongodump --archive | tee fifo`, `borg create --read-special` with the FIFO as
  the first path). Borg stores it under the same path as before
  (`srv/data/borg/staging/chessguru.archive`), so dedup, restores and the monthly drill are
  unchanged. A guard ends the dump if borg never opened the pipe, and the run is marked
  failed if mongodump exits non-zero (the archive would hold a truncated dump).
- **Root can reach the box.** `/root/.ssh/config` gained a Host entry for the box using
  dreamworld's `id_ed25519`. The shared `/usr/local/sbin/borg-maintenance.sh` and
  `borg-verify.sh` hardcode `BORG_RSH` without `-i`, so this file is what makes the weekly
  and monthly root jobs work; it was tested with an sftp put/rm.
- **Weekly retention.** `/usr/local/sbin/borg-maint-france.sh` → `REPO=ssh://…`,
  `CFG_MODE=sftp`, `CFG_PATH=backups/france/borg/config` (append-only flag flipped on the
  box over sftp, exactly like Mumbai). `borg-verify-france.sh` → `REPO=ssh://…`.
- Reference copies + README in the home repo under `scripts/borg/`.

## Verification
- Local FIFO rig on a scratch repo: streamed dump stored with the exact byte count,
  `borg extract --stdout | mongorestore --archive --dryRun` parsed it; failure path
  (unreachable repo) → guard killed the dump, no leftover processes, stage dir empty.
- 18:10 UTC run (file-staged, repo on the box): borg create OK in 10 m 28 s, pgbackrest
  mirror OK, third copy OK (b2), `=== done OK ===`. Filled `/srv/data` to 12 KB free while
  the dump was staged.
- `borg-verify-france.sh` against the box (18:25): verify-data OK, drill 25 restored
  byte-identical / 0 skipped / 0 bad of 29,842 paths, `=== done OK ===`.
- Local repo `/srv/data/borg/france` (5.3 GB, id ff781f76…) deleted 18:30 after the owner's
  "delete the local copy once verify passes". `/srv/data`: 100 % → 80 % (20 GB free).
- 18:30 UTC run (streamed dump): mongodump OK 15,522,536,234 bytes streamed, borg create OK
  in 4 m 56 s (was 10 m 28 s), stored file size matches the byte count exactly, archive
  dedups to 295.76 MB new data (file-staged one: 295.52 MB), mirrors OK, `=== done OK ===`.
  Disk usage did not move during the run.
- Read-back drill (18:38–18:43): `borg extract --stdout … chessguru.archive` from the box
  piped through `mongorestore --archive --nsInclude chessguru.fees_counters` into a scratch
  `borgdrill` database — 15,522,536,234 bytes came back (exact match), the restored document
  was identical to live, all pipe stages exit 0, scratch DB dropped. (A plain `--dryRun` is
  NOT a read-back: mongorestore closes stdin after the archive prelude.)

## Open items
- `/srv/data` (100 GB) is tight: library 42 GB + vision ~28 GB + book store 3.7 GB + staging
  ~3 GB + pgbackrest ~1 GB. A bigger data disk or moving the vision data is the next lever.
- Owner-side: Google Cloud OAuth client for rclone (Drive rate limits on the shared client).
