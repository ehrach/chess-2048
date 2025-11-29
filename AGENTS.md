# Repository Guidelines

## Project Structure & Module Organization
- `index.html` wires the layout, scoreboard, timer, overlay, and loads `style.css` plus `game.js`.
- `style.css` holds all visuals: grid layout, monochrome tile palette, selection/move dots, animations, and overlay styling.
- `game.js` contains config constants, board state, rendering, move legality, win conditions, timer, and sound triggers; vanilla DOM only.
- Audio assets `move.wav` and `merge.wav` live in the repo root; keep future media alongside them or in a new `assets/` folder.

## Build, Test, and Development Commands
- `python -m http.server 8000` — serve the game locally from the repo root; then open `http://localhost:8000/` to allow audio to load reliably.
- `start index.html` (Windows) — quick open without a server; fine for fast visual checks but some browsers may throttle audio on `file://`.
- Use browser DevTools for live tweaks; no bundler or transpiler is required.

## Coding Style & Naming Conventions
- Use 2-space indentation and terminate statements with semicolons, matching existing files.
- Prefer double quotes in JS and lower-case class/id names in HTML/CSS.
- Use `camelCase` for variables/functions, `UPPER_SNAKE_CASE` for constants (e.g., `TARGET_TILE`), and keep DOM ids/class names stable to avoid breaking selectors.
- Keep functions small and pure where possible; reuse helpers like `getTypeForValue`, `computeScores`, and `renderBoard` instead of duplicating logic.

## Testing Guidelines
- No automated tests yet; rely on manual playthrough.
- Recommended checks: start the server, confirm timer counts down from 05:00; move pieces for both colors; verify merges play the merge sound and double values; ensure scores update; trigger a win via reaching 512, capturing all pieces, or stalemate; hit "Restart" to confirm board/timer reset and overlay clears.

## Commit & Pull Request Guidelines
- Use concise, imperative commits (e.g., "Fix pawn promotion" or "Add move highlight animation").
- In PRs, describe gameplay/UX changes, list manual test steps and browser(s) used, and attach screenshots or short clips for visual tweaks.
- Note any new assets or external sources and confirm licensing/attribution when applicable.
