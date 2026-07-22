# @hydrooj/contribution

A Codeforces-style **contribution graph** for HydroOJ, shown directly on every
user profile page (`/user/:uid`).

<p>
  <img width="920" alt="contribution graph on the user profile (light)" src="docs/screenshot-light.png" />
</p>
<p>
  <img width="920" alt="contribution graph on the user profile (dark)" src="docs/screenshot-dark.png" />
</p>

## What it shows

A per-year solved-problems heatmap (with a year selector) plus the six
Codeforces profile stats:

- *N* problems solved for all time
- *N* problems solved for the last year
- *N* problems solved for the last month
- *N* days in a row max.
- *N* days in a row for the last year
- *N* days in a row for the last month

"Solved" means a **distinct problem** — a problem is counted once, on the day of
its first accepted submission.

## How it stays fast

The one potentially heavy query is a single aggregation over the `record`
collection that collapses all of a user's AC submissions into one row per solved
problem (its earliest AC). The result is cached per `(domain, user)` in
`contribution.cache` with a TTL (default 10 min), and invalidated the moment the
user gets a new AC (`record/judge`). A dedicated index
(`domainId, uid, status, pid`) keeps the aggregation scoped to that user's AC
records. All the light work — windowed counts, streaks and the calendar grid —
is computed from the tiny cached day-map, never from the database.

So a profile view costs **one indexed `findOne`** in the common case, and at most
**one aggregation per user per TTL window**.

## Install

```bash
hydrooj addon add /abs/path/to/hydro-contribution
pm2 restart hydrooj    # or however you run hydrooj
```

Or just run `./deploy.sh` on the HydroOJ host.

No build step: HydroOJ transpiles `index.ts` at load time and auto-discovers
`templates/`.

## Configuration (optional)

System settings (via the control panel / `SystemModel`):

- `contribution.timezone` — timezone used for day bucketing. Default
  `Asia/Shanghai`.
- `contribution.cacheTtl` — cache lifetime in milliseconds. Default `600000`.

## How it hooks in

The graph renders as its **own card directly below the profile** (not as a tab).
Since Hydro's only built-in profile extension slot lives inside the tab list,
this addon ships a faithful copy of `user_detail.html` that adds one line —
`{% include "partials/contribution_card.html" %}` — right after the profile
section. The data it needs is attached to the response via the
`handler/after/UserDetail` event, so **the core handler is not touched**.

> Note: because it overrides `user_detail.html`, re-sync that template if you
> upgrade HydroOJ to a version whose profile page changed (built against 5.0.4).

## License

AGPL-3.0-or-later.
