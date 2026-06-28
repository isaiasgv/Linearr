# Linearr e2e (Playwright)

End-to-end tests that drive a **running** Linearr instance in a real browser.
This package is isolated from the frontend build (its own `package.json`), so it
never touches the app's lockfile.

## Setup

```bash
cd e2e
npm install
npm run install-browsers   # downloads the Chromium Playwright build
```

## Run

Point it at a live instance and provide the app password (matches `APP_PASSWORD`):

```bash
PLAYWRIGHT_BASE_URL="http://your-plex-host:8777" \
E2E_PASSWORD="your-app-password" \
npm test
```

Environment variables:

| Var | Default | Purpose |
|-----|---------|---------|
| `PLAYWRIGHT_BASE_URL` | `http://localhost:8777` | The running Linearr URL |
| `E2E_USERNAME` | `admin` | Login username |
| `E2E_PASSWORD` | — (required) | Login password (`APP_PASSWORD`) |
| `E2E_CHANNEL_NAME` | — | A channel with a Plex movie library; enables the assign-movie regression test (skipped if unset) |

```bash
# Also run the movie-assign regression:
E2E_CHANNEL_NAME="Galaxy ONE" PLAYWRIGHT_BASE_URL=... E2E_PASSWORD=... npm test
```

## Tests

- `smoke.spec.ts` — logs in and confirms the app shell loads.
- `assign-movie.spec.ts` — regression for "movies aren't getting added": assigns a
  movie in Browse and verifies it appears under **Assigned → Movies** (the original
  bug was the global type filter silently hiding it). Skips unless `E2E_CHANNEL_NAME`
  is set.

## Notes

- `assign-movie.spec.ts` targets the current Browse UI (library `<select>` + a
  "Browse" button). After the denser-Browse redesign (Library/Collection source
  toggle) ships, update the marked selector lines.
- For more durable selectors, consider adding `data-testid` attributes to the
  channel list, Browse controls, and Assigned grid.
