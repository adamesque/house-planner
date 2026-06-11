# Build & Move Planner — Agent Handoff Notes

## What this is

A single-page vanilla JS financial projection tool for someone building a new home while selling their current one. No framework, no build step, no bundler. Just `app.js`, `index.html`, and a Node.js test suite.

Deployed on GitHub Pages from the `main` branch (branch source, not Actions).

## File map

| File | Role |
|------|------|
| `index.html` | All markup and CSS. Loads `app.js` then calls `init()`. |
| `app.js` | All logic and rendering. Works as a browser global AND a Node `require()` target. |
| `test.js` | Node.js test suite using `node:test` + jsdom. |
| `package.json` | Only dev dep is `jsdom`. No `"type": "module"` — must stay CJS. |

## Architecture

Everything lives in `app.js`. The key structural decision is a **pure computation / impure rendering split**:

- `computeProjection(s)` — takes raw state object, returns structured result. No DOM, fully testable without jsdom.
- `renderResults()`, `renderSalePrices()` — read from module-level `state`, mutate the DOM.
- `init()` — wires up event listeners, loads state, calls both renderers.

State is a plain object kept in module scope (initialized from `defaultState()`). `saveState()` / `loadState()` persist it to `localStorage` as JSON.

## Shareable URLs (URL is the source of truth)

State is mirrored into the query string so any URL is a shareable snapshot. The invariant: **the URL drives page state, and every state change is written back to the URL** — they cannot diverge.

- `stateToParams(s)` / `paramsToState(params)` — pure, tested serializers. Params equal to defaults are omitted (pristine page = clean URL). Invalid param values (bad term, unknown state code, junk floats) fall back to defaults; dollar params are run through `parseInput`. `salePrices` serialize as a comma list (`sale=350000,400000`).
- Param names: `build`, `term`, `rate`, `state`, `tax`, `balance`, `sale`, `selling`, `other`, `cash`, `rsu`, `payment`, `paycheck`, `freq`, `paycheck2`, `freq2` (see `URL_PARAMS` map — every state field must have an entry or it silently won't be shareable).
- **Boot order in `init()`**: if the URL has any recognized param, `paramsToState()` wins outright (localStorage is ignored, then overwritten). Only a param-less URL bootstraps from localStorage — and `syncURL()` immediately writes that state into the URL via `replaceState`.
- **Write-back**: `saveState()` persists to localStorage instantly (captures in-progress typing) and schedules a debounced (~400ms) `syncURL()`. Blur handlers and discrete controls (term/freq buttons, state select, sale-price remove) call `syncURL()` directly to flush. The debounce exists because **Safari rate-limits `replaceState` to ~100 calls per 30s** — don't sync on every keystroke.
- **`popstate`** re-derives state from the URL and calls `applyStateToDOM()`, which rewrites every form control + re-renders. Use `applyStateToDOM()` any time state changes wholesale.
- Non-empty values that *differ* from a non-empty default (e.g. tax rate cleared to `''` vs default `1.8`) are still serialized (`tax=`) — skipping them would silently revert to the default on decode.

## State schema

```js
{
  buildCost: '',          // raw digits string (no commas)
  loanTerm: 30,           // number: 15 | 20 | 30
  interestRate: '',       // string, parsed as float %
  stateCode: 'TX',        // 2-letter code, drives propertyTaxRate prefill
  propertyTaxRate: '1.8', // string, annual % — Travis County / Austin default
  currentLoanBalance: '', // raw digits string
  salePrices: [''],       // array of raw digits strings
  sellingCosts: '',       // extra costs that roll into the loan
  otherCosts: '',
  cashOnHand: '',         // savings applied to reduce the loan
  rsuFunds: '',           // after-tax RSU/stock proceeds applied to the loan
  currentPayment: '',     // current monthly housing payment (comparison only)
  paycheckAmt: '',        // per-paycheck base take-home (after tax)
  paycheckFreq: '2',      // '2' = semi-monthly, 'biweekly' = ×26/12
  paycheckAmt2: '',       // partner per-paycheck take-home (optional)
  paycheckFreq2: '2',
  buildMonths: '12',      // construction duration: '9' | '12' | '18' | '24'
  constructionRate: '',   // string %, blank = interestRate + 1
}
```

`cashOnHand + rsuFunds` subtract from `loanNeeded` in **both** projection modes (clamped at 0), and surface as `cashApplied` on the result plus a "Cash applied" breakdown row. They do NOT affect the property tax base.

New fields added later will just default from the initial state object via the `{ ...state, ...JSON.parse(saved) }` spread in `loadState()` — **never bump `STORAGE_KEY`** unless a field is being removed or renamed and you need to drop old data. Migration from legacy keys (`house-planner-v2`, `house-planner-v1`) is already handled.

## Dollar input formatting

Dollar amount inputs are `type="text"` with `inputmode="numeric"`. Two helpers manage them:

- `parseInput(str)` — strips all non-digits, returns raw string (e.g. `'500,000'` → `'500000'`)
- `fmtInput(rawStr)` — adds commas for display (e.g. `'500000'` → `'500,000'`)
- `bindDollarInput(el, getter, setter, steps)` — attaches a single `input` listener that strips, stores raw, reformats, and preserves cursor-from-end position; plus a `blur` listener that flushes the pending URL sync. The optional `steps` ([small, big], see the `STEPS` constant) adds a focus-revealed stepper. Initial values come from `applyStateToDOM()`, not the binding. The static dollar inputs live in the `DOLLAR_FIELDS` map (element id === state field name → stepper increments), which drives both the bindings in `init()` and `applyStateToDOM()`.

State always stores raw digit strings. `computeProjection` receives raw strings and uses `parseFloat()` on them.

## Dollar steppers

Every dollar input gets a row of four nudge buttons (`−big −small +small +big`, e.g. `−100k −25k +25k +100k`) revealed only while the field has focus — repositioning the cursor on the mobile numeric keypad is painful, so coarse adjustments happen by button instead.

- Visibility is pure CSS: `.field:focus-within .dollar-stepper` (and `.sale-price-row:focus-within` for the dynamic rows). No JS show/hide.
- Buttons act on **`pointerdown` with `preventDefault()`** — this stops the input from blurring, which keeps the stepper visible and the iOS keypad open between taps. Do NOT switch to `click`: by the time `click` fires the input has blurred and the (CSS-hidden) button may no longer hit-test.
- Keyboard activation still arrives as a `click` with `e.detail === 0`; both handlers exist, guarded so they never double-fire.
- `stepValue(raw, amt)` is the pure helper (clamps at 0, returns `''` for zero). Sale-price steppers are delegated on `#salePricesList` like the inputs.

## Testing approach

```
npm test   # runs: node --test test.js
```

The test suite imports real `app.js` code via `require('./app.js')`. This works because of the CommonJS guard at the bottom of `app.js`:

```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ... };
}
```

In the browser `module` is undefined, so the block is skipped and everything stays as globals. In Node it exports normally.

**DOM tests** use jsdom: `makeDOM()` sets `global.document` and `global.localStorage` before each test. `__setState(s)` and `__getState()` are exported to let tests inject state without touching the DOM. `makeFullDOM(url)` builds a fixture with every element `init()` needs (plus `global.window/location/history`) for end-to-end URL ⇄ state ⇄ localStorage tests — pass the query string in the jsdom `url`.

**Pure logic tests** (`computeProjection`, `monthlyPayment`, etc.) need no DOM setup at all.

`baseState(overrides)` is a test helper that constructs a minimal valid state. Tests that need `sellingCosts`, `otherCosts`, `paycheckAmt`, etc. spread them in explicitly.

## Key gotchas discovered during development

- **Event delegation on `#salePricesList`**: Sale price inputs are dynamically re-rendered. Attaching listeners directly to them fails intermittently in Safari/iOS. Use `list._delegated` guard pattern to attach once to the stable parent container.
- **`step="any"` on number inputs**: Changed to `type="text"`, but if you ever revert, some browsers return `e.target.value = ''` for values that don't match the `step` attribute.
- **`"type": "module"` breaks tests**: `package.json` must NOT have `"type": "module"`. The test file uses `require()`.
- **Census API is CORS-dead on GitHub Pages**: A prior attempt to fetch county-level property tax rates from the Census ACS API failed in production because the keyless endpoint now 302-redirects to `missing_key.html`, which blocks CORS. All tax rate data is now bundled statically.
- **Property tax is on the build value, not total loan**: `monthlyPropertyTax(build, taxRate)` — `build` only, not `build + extraCosts`. This is intentional.

## Affordability widget

`affordHTML(totalMonthly)` generates the comparison bar inside each scenario card. It reads `state.paycheckAmt`/`paycheckFreq`, `state.paycheckAmt2`/`paycheckFreq2` (partner income, summed into the base), and `state.currentPayment` directly (not passed as arguments) and returns an HTML string or `''` if no comparison data is entered.

Color zones: green < 28%, yellow 28–35%, red ≥ 35% of computed monthly base take-home.

The widget is purely additive — nothing in `computeProjection` changes if you add or remove comparison fields.

## Construction phase ("During the Build")

`computeBuildPhase(s)` (pure, exported) models the carrying cost during
construction: interest-only on the drawn construction loan balance, stacked on
top of `currentPayment`. Design decisions:

- **No draw schedule input.** Draws follow a smoothstep S-curve
  (`drawCurve(t) = 3t² − 2t³`), a standard approximation of residential draw
  schedules (slow start, fast middle, slow finish). The user only picks a
  build duration (segmented 9/12/18/24 mo, `.months-btn` — deliberately a
  separate class from `.term-btn` so the term click handlers don't grab them).
- **Construction rate defaults to `interestRate + 1`** (typical spread over a
  conventional mortgage) when `constructionRate` is blank. `rateAssumed: true`
  flags this so the UI labels it "(assumed)".
- Interest is computed on the **end-of-month** drawn balance — slightly
  conservative (high) by design.
- `renderBuildPhase()` renders into `#buildPhaseArea` and **null-guards the
  container** so DOM tests without that element don't break. The chart is a
  stacked CSS flexbox bar chart (`.bc-col` / `.bc-base` / `.bc-int`) — no
  chart library, no SVG. It reuses `affordHTML(peak.carry)` for the
  affordability bar against the peak month.
- `renderAll()` = `renderBuildPhase()` + `renderResults()`; input listeners
  call it instead of `renderResults()` since build cost, rates, paycheck, and
  current payment feed both views.
- Shareable via URL params `months` and `buildrate` (validated in
  `paramsToState` like every other param).

## What would be natural next additions

The prioritized roadmap and design principles live in [README.md](README.md) —
keep it as the single source of truth for planned features. Highlights:
homeowners insurance and the Texas homestead exemption.
