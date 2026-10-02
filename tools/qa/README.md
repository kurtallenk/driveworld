# QA scripts (UI/UX pass)

Headless-Chromium checks used during the UI/UX project. Requires Playwright
(not a project dependency): `npm i --no-save playwright && npx playwright install chromium`
(or point `CHROME=/path/to/chromium` at an existing binary).

- `qa.mjs` — 9 viewport sizes against the production build. Run `npm run build && npm run preview -- --port 4173`, then `node tools/qa/qa.mjs`. Checks console errors, DRIVE visible, tutorial visible/in-viewport, touch controls in-viewport, tutorial overlapping no control, no page scroll. Expect `sizes with issues: 0`.
- `rot.mjs` — live portrait↔landscape rotation against `npm run dev` (port 5173). Prints control sizes; none should be marked `OUT!`.

Screenshots go to `./qa-shots/` (git-ignore it). Headless WebGL is slow, so in-game speeds/timers advance slowly there; that is expected.
