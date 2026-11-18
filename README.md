# Trainer

A self-paced workout runner. It shows the next exercise and rep target, you tap when
you're done, and it records how long everything took. No fixed intervals.

Design notes: [docs/workout-runner-pwa-design.md](docs/workout-runner-pwa-design.md).

## Using it

- **Tap anywhere** (or Space / Enter) to finish a set or end a rest.
- **Press and hold** (or Backspace) to undo the last tap.
- **Pause** with the corner button (or `P`). Leaving the workout screen pauses too.
- Holds (wall sit, stretches) count down after a tap and move on by themselves.
- "Total" blocks (100 swings in any set size) ask how many reps you just did.
- Sessions are stored on the device only. Export a JSON backup from **History**.

## Workouts

Workouts are JSON files in `src/lib/workouts/`, listed in `index.ts`. Block types:

| Type | Meaning |
| --- | --- |
| `rounds` | Repeat a list of exercises N times. An exercise has `reps` or `holdSeconds`; `perSide: true` splits it into left and right with no rest between. |
| `ladder` | The same exercises with reps stepping from `from` to `to`. |
| `total` | Reach a rep `target` in any number of sets. |

`restHintSeconds` (default 90) is when the rest clock turns amber. A malformed file fails
the build with a message saying what is wrong.

## Developing

```sh
npm install
npm run dev          # http://localhost:5173
npm test             # engine unit tests (Vitest)
npm run test:e2e     # full runs in a phone-sized browser (Playwright, production build)
npm run check        # types
npm run icons        # re-render PNG icons from static/icon.svg
```

Playwright's Chromium needs two system libraries on a fresh Ubuntu/WSL:
`sudo apt install libnss3 libnspr4`.

The engine (`src/lib/engine/`) is pure TypeScript: `compile()` flattens a workout into
steps, `reduce(steps, state, event)` is the whole state machine, and every statistic is
derived by replaying a session's event log.

## Deploying

Pushing to `main` builds and publishes to GitHub Pages (`.github/workflows/deploy.yml`).
In the repository settings, set **Pages → Source** to **GitHub Actions** once.
