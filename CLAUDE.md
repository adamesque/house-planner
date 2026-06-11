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

State is a plain object kept in module scope. `saveState()` / `loadState()` persist it to `localStorage` as JSON.

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
  currentPayment: '',     // current monthly housing payment (comparison only)
  paycheckAmt: '',        // per-paycheck base take-home (after tax)
  paycheckFreq: '2',      // '2' = semi-monthly, 'biweekly' = ×26/12
  buildMonths: '12',      // construction duration: '9' | '12' | '18' | '24'
  constructionRate: '',   // string %, blank = interestRate + 1
}
```

New fields added later will just default from the initial state object via the `{ ...state, ...JSON.parse(saved) }` spread in `loadState()` — **never bump `STORAGE_KEY`** unless a field is being removed or renamed and you need to drop old data. Migration from legacy keys (`house-planner-v2`, `house-planner-v1`) is already handled.

## Dollar input formatting

Dollar amount inputs are `type="text"` with `inputmode="numeric"`. Two helpers manage them:

- `parseInput(str)` — strips all non-digits, returns raw string (e.g. `'500,000'` → `'500000'`)
- `fmtInput(rawStr)` — adds commas for display (e.g. `'500000'` → `'500,000'`)
- `bindDollarInput(el, getter, setter)` — attaches a single `input` listener that strips, stores raw, reformats, and preserves cursor-from-end position.

State always stores raw digit strings. `computeProjection` receives raw strings and uses `parseFloat()` on them.

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

**DOM tests** use jsdom: `makeDOM()` sets `global.document` and `global.localStorage` before each test. `__setState(s)` and `__getState()` are exported to let tests inject state without touching the DOM.

**Pure logic tests** (`computeProjection`, `monthlyPayment`, etc.) need no DOM setup at all.

`baseState(overrides)` is a test helper that constructs a minimal valid state. Tests that need `sellingCosts`, `otherCosts`, `paycheckAmt`, etc. spread them in explicitly.

## Key gotchas discovered during development

- **Event delegation on `#salePricesList`**: Sale price inputs are dynamically re-rendered. Attaching listeners directly to them fails intermittently in Safari/iOS. Use `list._delegated` guard pattern to attach once to the stable parent container.
- **`step="any"` on number inputs**: Changed to `type="text"`, but if you ever revert, some browsers return `e.target.value = ''` for values that don't match the `step` attribute.
- **`"type": "module"` breaks tests**: `package.json` must NOT have `"type": "module"`. The test file uses `require()`.
- **Census API is CORS-dead on GitHub Pages**: A prior attempt to fetch county-level property tax rates from the Census ACS API failed in production because the keyless endpoint now 302-redirects to `missing_key.html`, which blocks CORS. All tax rate data is now bundled statically.
- **Property tax is on the build value, not total loan**: `monthlyPropertyTax(build, taxRate)` — `build` only, not `build + extraCosts`. This is intentional.

## Affordability widget

`affordHTML(totalMonthly)` generates the comparison bar inside each scenario card. It reads `state.paycheckAmt`, `state.paycheckFreq`, and `state.currentPayment` directly (not passed as arguments) and returns an HTML string or `''` if no comparison data is entered.

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

## What would be natural next additions

- **Spouse / partner income**: A second `paycheckAmt2` + `paycheckFreq2` pair; sum both into `base` in `affordHTML`. A toggle to show/hide when the spouse isn't working yet.
- **Savings / down payment offset**: Reduce the loan by cash on hand (currently only sale proceeds reduce it).
- **Amortization schedule**: Show how many years until equity thresholds are reached.
