# Build & Move Planner

A single-page financial projection tool for one specific situation: building a
new home while selling the current one. Vanilla JS, no build step, deployed on
GitHub Pages. Architecture and agent handoff notes live in [CLAUDE.md](CLAUDE.md).

This is **personal software** — it doesn't need to be generally useful, and
features should be built for the actual household using it (Austin, TX),
not a hypothetical audience.

Already covered today: monthly P&I + property tax across sale-price scenarios,
cash toward the build (savings + RSUs reducing the loan), partner income in the
affordability bar, mobile-friendly dollar steppers, and shareable scenario URLs
(state mirrored into query params via the History API — see CLAUDE.md).

## Roadmap

Roughly in priority order.

### 1. Overlap / bridge period + draw schedule model — the biggest gap

The tool currently models the *destination*: the steady-state monthly payment
once the old home is sold and proceeds are applied. But the real financial risk
of build-then-sell is the *overlap period* — the months of paying the current
mortgage **and** build-phase expenses (architect fees, deposits, construction
draws, or interest-only on a construction loan's drawn balance) before the
sale closes.

Planned shape: a section for build-phase expenses with dates (the owner has
contract details to supply — real draw amounts beat a linear assumption),
plus expected sale month. Two new outputs per scenario: peak monthly outflow
during the overlap, and total cash burned before the sale closes. Implemented
as a second pure function alongside `computeProjection`.

### 2. Homeowners insurance

Monthly totals are P&I + property tax only. Texas insurance is expensive enough
(~$200–350/mo) that every scenario understates reality by a meaningful amount.
One dollar input, added into `totalMonthly`.

### 3. Texas homestead exemption

Property tax is computed on the full build cost, but the homestead exemption
removes a six-figure amount from the school-district portion of assessed value.
A toggle that subtracts the exemption before the tax calc — the personalized
alternative to more generic tax features (see design principles below).

### 4. ~~Shareable state via URL hash~~ — done

Shipped as query params (not the hash) driven through the History API: the URL
is the source of truth on load, every change is written back via
`replaceState`, and localStorage only bootstraps a param-less URL. Sync-by-link
and "look at this scenario" sharing work with no backend.

### 5. Second interest rate comparison

Sale price is currently the only scenario axis, but the interest rate at loan
conversion (months away) is at least as uncertain and has a bigger payment
impact. Not a full scenario matrix — just an optional second rate rendered as a
small extra line in each card.

### 6. Amortization / equity thresholds (low priority)

Show how many years until equity thresholds are reached. Interesting, but
doesn't change any near-term decision.

## Design principles (things deliberately not changing)

- **No framework, no bundler, no build step.** At this size all three would
  cost more than they pay.
- **Pure computation / impure rendering split.** `computeProjection` stays
  DOM-free and testable; new math goes in as pure functions next to it.
- **Personalize, don't generalize.** The 50-state tax dropdown is a cautionary
  example: ~70 lines of generic data serving a field set to TX once. Build the
  Travis County version of features, not the everyone version.
- **`affordHTML` refactor note:** it now reads four paycheck fields plus
  `currentPayment` straight from module state. Next time it grows (e.g.
  insurance-aware comparisons), switch it to a small params object instead of
  accumulating more hidden inputs.

## Development

```
npm install
npm test     # node --test test.js
```
