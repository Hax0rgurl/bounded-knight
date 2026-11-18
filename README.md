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

The build sandbox refuses listening sockets (`EPERM`) and Chromium crashpad sockets, so browser rendering and actual screenshots require the coordinator's external Chromium session. No screenshots from the unrelated starter are included. The screenshots directory is intentionally empty pending genuine capture; the competition requires **3–4 real images** before submission. Capture the title, active play with cargo/HUD, and results with restart. Suggested viewport 1200×800; JPEG each below 256 KiB, with a long side ≤1280 and short side ≥480. Name them `1-start.jpg`, `2-play.jpg`, `3-end.jpg`. For the results capture, play to a finish or let the 110-second timer expire while the browser stays focused; do not fabricate state or composite images.

## Package

Kit `main.ts` and `vendor/makefun-game.ts` are copied unchanged. After screenshots are captured, run `MAKEFUN_OUTPUT_DIR=/tmp/lantern-tide-output node main.ts` to generate a reviewable local output folder and dossier. This does not submit or publish. Root MIT license covers the original game.

## Structure

`world.js` owns rules and time-stepped simulation; `render.js` owns procedural artwork and six screens; `audio.js` owns synthesized feedback; `main.js` owns input, state transitions, storage, and animation loop. No external assets are used.
