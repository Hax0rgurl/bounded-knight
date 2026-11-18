# Design and iteration

Question: does slower full cargo make a short collection-and-return route interesting while remaining immediately controllable?
Core verb: steer, collect up to three lights, then bank at the harbor.
Timebox: eight minutes. Shipping source was explicitly requested, so the prototype-fast workflow's separate throwaway project and approval pause were superseded by direct implementation. Engine contract: native requestAnimationFrame, keyboard events, Canvas 2D, ES module imports, Web Audio, no build.

Initial simulation checks exposed one lantern at (600,525) sitting inside a patrol's initial danger zone: a pickup immediately lost its cargo. Retuned that spawn to (580,560); reran the checks successfully. A naive real steering route delivered seven lights with three hull remaining in about 25 seconds, demonstrating reachable pickups and damage recovery while also showing why routing matters. This is automated simulation evidence, not a claim of human fun validation.

Keep the mechanic provisionally: the loop works and rewards efficient full loads. Human playtesting remains needed for subjective handling and visual polish. All start/play/pause/win/loss/dawn drawing branches run in a Canvas API smoke test. Browser launch was attempted twice; the sandbox blocks socket creation, so real visual verification and screenshots are deferred to the external coordinator. No fabricated screenshot or starter screenshot is provided.
