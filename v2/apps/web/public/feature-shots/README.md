# Feature screenshots for /signup-academy

Drop PNG screenshots here named `<featureId>.png` (matching `id` in
`apps/web/src/lib/features.ts`).

- Recommended dimensions: **1200×800** (3:2 aspect).
- Missing shots fall back to a gradient tile with the feature's emoji, so
  incomplete coverage never breaks the page.
- Real screenshots dramatically improve conversion — grab them from the live
  app (`https://harinitharanjith.com`) at 2× zoom for crispness.

Current features that would benefit from a shot (see `features.ts` for full list):

- `puzzle-of-the-day.png`
- `daily-history-strip.png`
- `weekly-digest.png`
- `streak-reminder.png`
- `push-notifications.png`
- `rating-milestones.png`
- `count-milestones.png`
- `live-class.png`
- `snap-position.png`
- `dashboard.png`
- `heatmap.png`
- `speed-by-theme.png`
- `students.png`
- `fees.png`
- `attendance.png`

Copy in with:
```bash
scp your-shot.png ubuntu@harinitharanjith.com:/home/ubuntu/chessguru/v2/apps/web/public/feature-shots/<id>.png
sudo -u ubuntu bash -c 'cd /home/ubuntu/chessguru/v2 && bash scripts/deploy.sh'
```
