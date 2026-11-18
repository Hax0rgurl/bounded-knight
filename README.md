# Lantern Tide

[![make.fun](https://make.fun/badge/best-game-01.svg)](https://make.fun/bounty/best-game-01)
[![Rank](https://make.fun/badge/best-game-01/Hax0rgurl/bounded-knight/rank.svg)](https://make.fun/bounty/best-game-01)
[![Reward](https://make.fun/badge/best-game-01/Hax0rgurl/bounded-knight/reward.svg)](https://make.fun/bounty/best-game-01)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

An original desktop arcade navigation game: pilot a night-post skiff through a luminous procedural harbor, recover drifting lanterns, and bring nine home before dawn. Three beacons illuminate as deliveries arrive. Plain Canvas 2D, native ES modules, procedural Web Audio; no dependencies, build step, fonts, images, or game network requests.

## Play

Run `node serve.ts` (Node 22.18+ or 24), then open `http://localhost:8080` in desktop Chromium. Any static HTTP server rooted at `game/` also works. The game fits a 1200 × 800 logical canvas to the browser window.

- **Enter or click canvas:** start; restart after results. Enter also resumes pause.
- **WASD or arrow keys:** steer in eight directions. Movement accelerates quickly and coasts briefly; diagonal input is normalized.
- **Space (hold):** burst while steering, available every three seconds. Burst does not grant invulnerability.
- **P or Escape:** pause/resume. Losing window focus also pauses and clears held keys.
- **M:** mute/unmute synthesized sound.
- **F:** toggle calm effects (no impact shake or pickup particles). Reduced-motion system preference enables this initially.

Collect mint diamonds by touching them. Carry at most three. Touch the gold **HOME** circle at the bottom center to unload automatically. Each light scores 100 on pickup and 200 on delivery; a full load adds 250. Cargo slows cruising speed, so choose between quick small deliveries and efficient full loads. Each delivery repairs one hull point. Reefs and pink patrol boats cost one hull, one carried light, and 75 points, with 1.8 seconds of protection after a hit. Lost lights respawn so the objective stays achievable. Deliver nine to win, with ten bonus points per second remaining. Four hull hits or the 110-second dawn timer ends the run. Best score is saved locally when storage is available.

## Verify

`node tests/simulation.mjs` checks pickup, full-load delivery, score, win, collision, invulnerability, movement, burst, timeout, loss, and fresh-state reset. It also drives a naive steering route through the live simulation to exercise navigation and damage recovery. `node tests/render-smoke.mjs` executes every rendering branch with finite-coordinate assertions against a Canvas API double. Run `node --check game/src/main.js` for syntax.

The supplied browser captures are in `screenshots/`. The competition takes three or four PNG or JPEG images, with the first by name as the cover. For new captures, use a 1200×800 viewport and keep each file within 256 KiB. The title, active play with its HUD, and results with restart show the full game loop.

## Package

Run `MAKEFUN_OUTPUT_DIR=/tmp/lantern-tide-output node main.ts` with a fresh output location. The packager checks the game files and screenshot count, names, sizes, image headers, and dimensions before writing a package. It uses the kit vendor to build the dossier. The root license is MIT.

## Structure

`world.js` owns rules and time-stepped simulation; `render.js` owns procedural artwork and six screens; `audio.js` owns synthesized feedback; `main.js` owns input, state transitions, storage, and animation loop. No external assets are used.
