const STORAGE_KEY = 'house-planner-v3';
const LEGACY_KEYS = ['house-planner-v2', 'house-planner-v1'];

// Default local rate: Travis County (Austin, TX) effective property tax rate.
const DEFAULT_STATE = 'TX';
const DEFAULT_TAX_RATE = '1.8';

// Average effective property tax rates by US state (% of home value / year).
// Source: Tax Foundation / U.S. Census ACS 2024. These are statewide averages
// and are meant as editable starting points — local rates vary by county/city.
const STATE_TAX_RATES = {
  AL: 0.41, AK: 1.04, AZ: 0.45, AR: 0.64, CA: 0.71, CO: 0.51, CT: 1.54,
  DE: 0.58, DC: 0.55, FL: 0.79, GA: 0.81, HI: 0.27, ID: 0.49, IL: 1.88,
  IN: 0.71, IA: 1.40, KS: 1.26, KY: 0.74, LA: 0.55, ME: 1.09, MD: 0.95,
  MA: 1.04, MI: 1.24, MN: 0.98, MS: 0.67, MO: 0.91, MT: 0.69, NE: 1.38,
  NV: 0.48, NH: 1.50, NJ: 2.23, NM: 0.67, NY: 1.54, NC: 0.63, ND: 0.98,
  OH: 1.30, OK: 0.76, OR: 0.77, PA: 1.26, RI: 1.23, SC: 0.46, SD: 1.01,
  TN: 0.48, TX: 1.40, UT: 0.47, VT: 1.51, VA: 0.72, WA: 0.76, WV: 0.55,
  WI: 1.38, WY: 0.55,
};

const STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan',
  MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
  OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

function defaultState() {
  return {
    buildCost: '',
    loanTerm: 30,
    interestRate: '',
    stateCode: DEFAULT_STATE,
    propertyTaxRate: DEFAULT_TAX_RATE,
    currentLoanBalance: '',
    salePrices: [''],
    sellingCosts: '',
    otherCosts: '',
    cashOnHand: '',     // savings applied directly to reduce the loan
    rsuFunds: '',       // expected after-tax RSU/stock proceeds applied to the loan
    currentPayment: '',
    paycheckAmt: '',
    paycheckFreq: '2',
    paycheckAmt2: '',   // partner per-paycheck take-home (optional)
    paycheckFreq2: '2',
    buildMonths: '12',      // construction duration in months
    constructionRate: '',   // string %, blank = interestRate + 1
  };
}

let state = defaultState();

// Nudge increments for the focus-revealed stepper under each dollar input:
// [small, big] — rendered as −big −small +small +big.
const STEPS = {
  large: [25000, 100000],   // build cost, sale prices
  medium: [10000, 50000],   // loan balance, cash on hand, RSUs
  small: [5000, 25000],     // selling / other costs
  monthly: [100, 500],      // monthly payment, paychecks
};

// Strip all non-digit characters — used to parse user-typed dollar inputs.
function parseInput(str) {
  return String(str).replace(/[^\d]/g, '');
}

// Format a raw digit string for display in a dollar input field (adds commas).
function fmtInput(rawStr) {
  const digits = parseInput(rawStr);
  if (!digits) return '';
  return parseInt(digits, 10).toLocaleString('en-US');
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) { state = { ...state, ...JSON.parse(saved) }; return; }
    // Migrate from older storage keys so users don't lose saved data.
    for (const key of LEGACY_KEYS) {
      const legacy = localStorage.getItem(key);
      if (legacy) {
        state = { ...state, ...JSON.parse(legacy) };
        saveState();
        break;
      }
    }
  } catch {}
}

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
  // Mirror every persisted change into the URL so the two can't diverge.
  // Debounced so localStorage still captures in-progress typing immediately
  // while the URL catches up at most ~400ms behind (or instantly on blur).
  scheduleURLSync();
}

// ── Shareable URLs ──────────────────────────────────────────────────────────
// The query string is the canonical, shareable form of the state. On load,
// URL params win; localStorage only bootstraps state when the URL carries no
// recognized params. After that every state change is written back via
// history.replaceState, and popstate re-derives state from the URL.
// Params equal to their defaults are omitted to keep URLs short.

const URL_PARAMS = {
  build: 'buildCost',
  term: 'loanTerm',
  rate: 'interestRate',
  state: 'stateCode',
  tax: 'propertyTaxRate',
  balance: 'currentLoanBalance',
  sale: 'salePrices',
  selling: 'sellingCosts',
  other: 'otherCosts',
  cash: 'cashOnHand',
  rsu: 'rsuFunds',
  payment: 'currentPayment',
  paycheck: 'paycheckAmt',
  freq: 'paycheckFreq',
  paycheck2: 'paycheckAmt2',
  freq2: 'paycheckFreq2',
  months: 'buildMonths',
  buildrate: 'constructionRate',
};

const FLOAT_RE = /^\d*\.?\d*$/;
const PAY_FREQS = ['2', 'biweekly'];

function stateToParams(s) {
  const defaults = defaultState();
  const params = new URLSearchParams();
  for (const [name, field] of Object.entries(URL_PARAMS)) {
    if (field === 'salePrices') {
      const prices = (s.salePrices || []).map(parseInput).filter(Boolean);
      if (prices.length) params.set(name, prices.join(','));
      continue;
    }
    const value = String(s[field] == null ? '' : s[field]);
    if (value !== String(defaults[field])) params.set(name, value);
  }
  return params;
}

// Builds a full state object from URL params. Unknown or invalid values fall
// back to defaults, and dollar amounts are stripped to raw digit strings, so
// a hand-edited or truncated URL can never produce a malformed state.
function paramsToState(params) {
  const s = defaultState();
  if (params.has('build')) s.buildCost = parseInput(params.get('build'));
  if (params.has('term')) {
    const term = Number(params.get('term'));
    if ([15, 20, 30].includes(term)) s.loanTerm = term;
  }
  if (params.has('rate') && FLOAT_RE.test(params.get('rate'))) {
    s.interestRate = params.get('rate');
  }
  if (params.has('state')) {
    const code = params.get('state');
    if (code === '' || STATE_NAMES[code]) s.stateCode = code;
  }
  if (params.has('tax') && FLOAT_RE.test(params.get('tax'))) {
    s.propertyTaxRate = params.get('tax');
  }
  if (params.has('balance')) s.currentLoanBalance = parseInput(params.get('balance'));
  if (params.has('sale')) {
    const prices = params.get('sale').split(',').map(parseInput).filter(Boolean);
    s.salePrices = prices.length ? prices : [''];
  }
  if (params.has('selling')) s.sellingCosts = parseInput(params.get('selling'));
  if (params.has('other')) s.otherCosts = parseInput(params.get('other'));
  if (params.has('cash')) s.cashOnHand = parseInput(params.get('cash'));
  if (params.has('rsu')) s.rsuFunds = parseInput(params.get('rsu'));
  if (params.has('payment')) s.currentPayment = parseInput(params.get('payment'));
  if (params.has('paycheck')) s.paycheckAmt = parseInput(params.get('paycheck'));
  if (params.has('freq') && PAY_FREQS.includes(params.get('freq'))) {
    s.paycheckFreq = params.get('freq');
  }
  if (params.has('paycheck2')) s.paycheckAmt2 = parseInput(params.get('paycheck2'));
  if (params.has('freq2') && PAY_FREQS.includes(params.get('freq2'))) {
    s.paycheckFreq2 = params.get('freq2');
  }
  if (params.has('months')) {
    const m = parseInt(params.get('months'), 10);
    if (m > 0 && m <= 60) s.buildMonths = String(m);
  }
  if (params.has('buildrate') && FLOAT_RE.test(params.get('buildrate'))) {
    s.constructionRate = params.get('buildrate');
  }
  return s;
}

function hasStateParams(params) {
  return Object.keys(URL_PARAMS).some(name => params.has(name));
}

let urlSyncTimer = null;

// Writes the current state into the URL right now (also flushes any pending
// debounced sync). Safe to call anywhere: no-ops outside a browser context.
function syncURL() {
  if (urlSyncTimer !== null) { clearTimeout(urlSyncTimer); urlSyncTimer = null; }
  if (typeof history === 'undefined' || typeof location === 'undefined') return;
  // Decode commas in the sale-price list for a friendlier shareable URL.
  const qs = stateToParams(state).toString().replace(/%2C/gi, ',');
  const url = location.pathname + (qs ? '?' + qs : '') + location.hash;
  try { history.replaceState(null, '', url); } catch {}
}

// Debounced sync so fast typing doesn't hit Safari's replaceState rate limit
// (~100 calls per 30s). Blur and discrete controls call syncURL() directly.
function scheduleURLSync() {
  if (typeof history === 'undefined') return;
  clearTimeout(urlSyncTimer);
  urlSyncTimer = setTimeout(syncURL, 400);
  if (urlSyncTimer.unref) urlSyncTimer.unref(); // don't hold Node test process open
}

// ── Pure calculation helpers ────────────────────────────────────────────────

function monthlyPayment(principal, annualRate, years) {
  if (principal <= 0 || years <= 0) return null;
  if (annualRate <= 0) return principal / (years * 12);
  const r = annualRate / 100 / 12;
  const n = years * 12;
  return principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

function monthlyPropertyTax(homeValue, annualRatePercent) {
  if (homeValue <= 0 || annualRatePercent <= 0) return 0;
  return homeValue * (annualRatePercent / 100) / 12;
}

// Cash left from selling the current home after paying off its mortgage.
// Can be negative if the home is underwater (owe more than it sells for).
function netProceeds(salePrice, currentLoanBalance) {
  return salePrice - currentLoanBalance;
}

// Builds the full projection from raw (string) form state. Pure: no DOM.
function computeProjection(s) {
  const build = parseFloat(s.buildCost) || 0;
  const rate = parseFloat(s.interestRate) || 0;
  const term = Number(s.loanTerm) || 0;
  const taxRate = parseFloat(s.propertyTaxRate) || 0;
  const balance = parseFloat(s.currentLoanBalance) || 0;
  const extraCosts = (parseFloat(s.sellingCosts) || 0) + (parseFloat(s.otherCosts) || 0);
  const cash = (parseFloat(s.cashOnHand) || 0) + (parseFloat(s.rsuFunds) || 0);

  if (build <= 0 || rate <= 0) return { ready: false };

  // Property tax is based on the new home's assessed value, not extra costs.
  const propertyTax = monthlyPropertyTax(build, taxRate);

  const validPrices = (s.salePrices || [])
    .map(p => parseFloat(p))
    .filter(p => !isNaN(p) && p >= 0);

  function scenarioFor(salePrice) {
    const proceeds = netProceeds(salePrice, balance);
    const loanNeeded = Math.max(0, build + extraCosts - proceeds - cash);
    const principalInterest = loanNeeded > 0 ? monthlyPayment(loanNeeded, rate, term) : 0;
    const totalMonthly = principalInterest + propertyTax;
    return {
      salePrice, proceeds, loanNeeded, principalInterest, propertyTax, totalMonthly,
      fullyCovered: loanNeeded <= 0,
    };
  }

  if (validPrices.length === 0) {
    const loanNeeded = Math.max(0, build + extraCosts - cash);
    const pi = loanNeeded > 0 ? monthlyPayment(loanNeeded, rate, term) : 0;
    return {
      ready: true, mode: 'no-sale', term, rate, taxRate, propertyTax, cashApplied: cash,
      scenario: {
        loanNeeded, principalInterest: pi, propertyTax, totalMonthly: pi + propertyTax,
        fullyCovered: loanNeeded <= 0,
      },
    };
  }

  return {
    ready: true, mode: 'scenarios', term, rate, taxRate, propertyTax, cashApplied: cash,
    scenarios: validPrices.map(scenarioFor),
  };
}

// Cumulative fraction of the build cost drawn at progress t (0..1).
// Smoothstep S-curve approximates a typical residential draw schedule:
// slow start (site work), fast middle (framing/mechanicals), slow finish
// (trim/punch list) — so no per-draw amounts are ever needed.
function drawCurve(t) {
  return t * t * (3 - 2 * t);
}

// Month-by-month carrying cost during construction: interest-only on the
// drawn balance, on top of the current housing payment. Pure: no DOM.
function computeBuildPhase(s) {
  const build = parseFloat(s.buildCost) || 0;
  const months = parseInt(s.buildMonths, 10) || 0;
  const mortgageRate = parseFloat(s.interestRate) || 0;
  const explicit = parseFloat(s.constructionRate);
  // Construction loans typically price about a point above a conventional
  // mortgage, so that's the default when no explicit rate is given.
  const rateAssumed = !(explicit > 0);
  const rate = rateAssumed ? (mortgageRate > 0 ? mortgageRate + 1 : 0) : explicit;
  const currentPayment = parseFloat(s.currentPayment) || 0;

  if (build <= 0 || months <= 0 || rate <= 0) return { ready: false };

  const r = rate / 100 / 12;
  const rows = [];
  let totalInterest = 0;
  for (let m = 1; m <= months; m++) {
    const drawn = build * drawCurve(m / months);
    const interest = drawn * r;
    totalInterest += interest;
    rows.push({ month: m, drawn, interest, carry: currentPayment + interest });
  }

  return {
    ready: true, rate, rateAssumed, months, currentPayment,
    rows, totalInterest, peak: rows[months - 1],
  };
}

function fmt(n) {
  return '$' + Math.round(n).toLocaleString('en-US');
}

// ── Dollar steppers ─────────────────────────────────────────────────────────
// Nudge buttons revealed under a dollar input while it has focus — easier than
// repositioning the cursor on a mobile numeric keypad.

function stepLabel(n) {
  return n >= 1000 ? (n / 1000) + 'k' : String(n);
}

function stepperHTML(steps, extraAttrs = '') {
  const [small, big] = steps;
  return `<div class="dollar-stepper"${extraAttrs ? ' ' + extraAttrs : ''}>` +
    [-big, -small, small, big].map(amt =>
      `<button type="button" class="step-btn" data-amt="${amt}">` +
      `${amt > 0 ? '+' : '−'}${stepLabel(Math.abs(amt))}</button>`).join('') +
    '</div>';
}

// Apply a step amount to a raw digit string, clamping at zero.
function stepValue(raw, amt) {
  const next = Math.max(0, (parseInt(raw, 10) || 0) + amt);
  return next > 0 ? String(next) : '';
}

// ── Rendering ───────────────────────────────────────────────────────────────

// Compact delta + affordability bar comparing totalMonthly to the user's
// current payment and base take-home. Returns '' when no comparison data set.
function affordHTML(totalMonthly) {
  const freqMult = f => (f === 'biweekly' ? 26 / 12 : 2);
  const base = (parseFloat(state.paycheckAmt) || 0) * freqMult(state.paycheckFreq)
    + (parseFloat(state.paycheckAmt2) || 0) * freqMult(state.paycheckFreq2);
  const current = parseFloat(state.currentPayment) || 0;
  if (base <= 0 && current <= 0) return '';

  let html = '<div class="afford-wrap">';

  if (current > 0) {
    const delta = totalMonthly - current;
    let deltaStr, deltaCls;
    if (delta > 0) {
      deltaStr = `+${fmt(delta)}/mo vs. today`;
      deltaCls = 'delta-up';
    } else if (delta < 0) {
      deltaStr = `-${fmt(Math.abs(delta))}/mo vs. today`;
      deltaCls = 'delta-down';
    } else {
      deltaStr = 'Same as today';
      deltaCls = 'delta-neutral';
    }
    html += `<div class="afford-delta ${deltaCls}">${deltaStr}</div>`;
  }

  if (base > 0) {
    const pct = (totalMonthly / base) * 100;
    const capped = Math.min(pct, 100);
    const color = pct < 28 ? '#4f7a1e' : pct < 35 ? '#a87a12' : '#b23c2a';
    const note = pct >= 35 ? ' — above 35% guideline' : pct >= 28 ? ' — above 28% guideline' : '';
    html += `
      <div class="afford-track">
        <div class="afford-fill" style="width:${capped.toFixed(1)}%;background:${color}"></div>
      </div>
      <div class="afford-label">${Math.round(pct)}% of base take-home${note}</div>`;
  }

  return html + '</div>';
}

function renderSalePrices() {
  const list = document.getElementById('salePricesList');

  function applySaleStep(btn) {
    const idx = +btn.closest('.dollar-stepper').dataset.idx;
    state.salePrices[idx] = stepValue(state.salePrices[idx], Number(btn.dataset.amt));
    const input = list.querySelector(`.sale-price-input[data-idx="${idx}"]`);
    if (input) input.value = fmtInput(state.salePrices[idx]);
    saveState();
    renderResults();
  }

  // Event delegation on the stable parent so listeners survive re-renders.
  if (!list._delegated) {
    list._delegated = true;
    list.addEventListener('input', e => {
      if (!e.target.classList.contains('sale-price-input')) return;
      const raw = parseInput(e.target.value);
      state.salePrices[+e.target.dataset.idx] = raw;
      const formatted = fmtInput(raw);
      const cursorFromEnd = e.target.value.length - (e.target.selectionEnd || 0);
      e.target.value = formatted;
      e.target.setSelectionRange(
        Math.max(0, formatted.length - cursorFromEnd),
        Math.max(0, formatted.length - cursorFromEnd),
      );
      saveState();
      renderResults();
    });
    // focusout bubbles (blur doesn't) — flush the pending URL sync on blur.
    list.addEventListener('focusout', e => {
      if (e.target.classList.contains('sale-price-input')) syncURL();
    });
    // Steppers act on pointerdown with preventDefault so the price input keeps
    // focus (the stepper stays visible and the mobile keypad stays open).
    list.addEventListener('pointerdown', e => {
      const btn = e.target.closest('.step-btn');
      if (!btn) return;
      e.preventDefault();
      applySaleStep(btn);
    });
    list.addEventListener('click', e => {
      // Keyboard activation of a step button arrives as a click with detail 0.
      const stepBtn = e.target.closest('.step-btn');
      if (stepBtn) {
        if (e.detail === 0) applySaleStep(stepBtn);
        return;
      }
      const btn = e.target.closest('.btn-remove');
      if (!btn) return;
      state.salePrices.splice(+btn.dataset.idx, 1);
      if (state.salePrices.length === 0) state.salePrices = [''];
      saveState();
      syncURL();
      renderSalePrices();
      renderResults();
    });
  }

  list.innerHTML = '';
  state.salePrices.forEach((price, i) => {
    const row = document.createElement('div');
    row.className = 'sale-price-row';
    row.innerHTML = `
      <div class="sale-price-main">
        <div class="input-wrap has-prefix">
          <span class="input-prefix">$</span>
          <input type="text" inputmode="numeric" placeholder="e.g. 350,000"
            value="${fmtInput(price)}" data-idx="${i}" class="sale-price-input" />
        </div>
        <button class="btn-remove" data-idx="${i}" title="Remove">×</button>
      </div>
      ${stepperHTML(STEPS.large, `data-idx="${i}"`)}
    `;
    list.appendChild(row);
  });
}

function renderTermButtons() {
  document.querySelectorAll('.term-btn').forEach(btn => {
    btn.classList.toggle('active', Number(btn.dataset.term) === Number(state.loanTerm));
  });
}

function renderMonthsButtons() {
  document.querySelectorAll('.months-btn').forEach(btn => {
    btn.classList.toggle('active', String(btn.dataset.months) === String(state.buildMonths));
  });
}

function renderPayfreqBtns() {
  const paint = (id, val) => {
    const wrap = document.getElementById(id);
    if (!wrap) return;
    wrap.querySelectorAll('.payfreq-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.freq === val);
    });
  };
  paint('payfreqBtns1', state.paycheckFreq);
  paint('payfreqBtns2', state.paycheckFreq2);
}

function rowsHTML(rows) {
  return rows.map(([label, value, opts = {}]) => `
    <div class="line ${opts.total ? 'line-total' : ''}">
      <span class="line-label">${label}</span>
      <span class="line-value">${value}</span>
    </div>`).join('');
}

function renderResults() {
  const area = document.getElementById('resultsArea');
  const p = computeProjection(state);

  if (!p.ready) {
    area.innerHTML = '<p class="no-sale-msg">Enter a build cost and interest rate above to see your monthly payment.</p>';
    return;
  }

  const taxNote = p.taxRate > 0 ? `incl. property tax @ ${p.taxRate}%` : 'no property tax set';

  if (p.mode === 'no-sale') {
    const s = p.scenario;
    area.innerHTML = `
      <div class="scenario-card single">
        <div class="card-head">
          <span class="card-title">Financing the full build</span>
          <span class="card-sub">No sale proceeds applied</span>
        </div>
        <div class="big-number">${fmt(s.totalMonthly)}<span class="per-mo">/mo</span></div>
        <div class="big-sub">${s.fullyCovered ? 'Covered by cash — tax only' : taxNote}</div>
        ${affordHTML(s.totalMonthly)}
        <details class="scenario-details">
          <summary>Show breakdown</summary>
          ${rowsHTML([
            ...(p.cashApplied > 0 ? [['Cash applied', '−' + fmt(p.cashApplied)]] : []),
            ['Loan amount', fmt(s.loanNeeded)],
            ['Principal & interest', s.principalInterest > 0 ? fmt(s.principalInterest) + '/mo' : '—'],
            ['Property tax', fmt(s.propertyTax) + '/mo'],
            ['Total monthly', fmt(s.totalMonthly) + '/mo', { total: true }],
          ])}
        </details>
      </div>`;
    return;
  }

  area.innerHTML = `
    <div class="sale-scenarios">
      ${p.scenarios.map(s => `
        <div class="scenario-card">
          <div class="card-head">
            <span class="card-title">Sell for ${fmt(s.salePrice)}</span>
            <span class="card-sub">${s.proceeds < 0
              ? 'Underwater by ' + fmt(Math.abs(s.proceeds))
              : fmt(s.proceeds) + ' net after payoff'}</span>
          </div>
          <div class="big-number">${fmt(s.totalMonthly)}<span class="per-mo">/mo</span></div>
          <div class="big-sub">${s.fullyCovered ? 'Build fully covered — tax only' : taxNote}</div>
          ${affordHTML(s.totalMonthly)}
          <details class="scenario-details">
            <summary>Show breakdown</summary>
            ${rowsHTML([
              ['Net sale proceeds', fmt(s.proceeds)],
              ...(p.cashApplied > 0 ? [['Cash applied', '−' + fmt(p.cashApplied)]] : []),
              ['Loan needed', fmt(s.loanNeeded)],
              ['Principal & interest', s.principalInterest > 0 ? fmt(s.principalInterest) + '/mo' : '—'],
              ['Property tax', fmt(s.propertyTax) + '/mo'],
              ['Total monthly', fmt(s.totalMonthly) + '/mo', { total: true }],
            ])}
          </details>
        </div>
      `).join('')}
    </div>`;
}

function renderBuildPhase() {
  const area = document.getElementById('buildPhaseArea');
  if (!area) return;
  const bp = computeBuildPhase(state);

  if (!bp.ready) {
    area.innerHTML = '<p class="no-sale-msg">Enter a build cost and interest rate above to see your carrying cost while you build.</p>';
    return;
  }

  const peakCarry = bp.peak.carry || 1;
  const bars = bp.rows.map(row => {
    const baseH = (bp.currentPayment / peakCarry) * 100;
    const intH = (row.carry / peakCarry) * 100 - baseH;
    return `
      <div class="bc-col" title="Month ${row.month}: ${fmt(row.carry)}/mo (${fmt(row.interest)} construction interest)">
        <div class="bc-int" style="height:${intH.toFixed(1)}%"></div>
        ${bp.currentPayment > 0 ? `<div class="bc-base" style="height:${baseH.toFixed(1)}%"></div>` : ''}
      </div>`;
  }).join('');

  const legend = bp.currentPayment > 0
    ? `<div class="bc-legend">
        <span class="bc-key bc-key-base"></span>current payment
        <span class="bc-key bc-key-int"></span>construction interest
      </div>`
    : '';

  const rateNote = `interest-only @ ${bp.rate}%${bp.rateAssumed ? ' (assumed)' : ''}`;
  const mid = bp.rows[Math.ceil(bp.months / 2) - 1];

  area.innerHTML = `
    <div class="scenario-card single">
      <div class="card-head">
        <span class="card-title">Carrying cost while you build</span>
        <span class="card-sub">Peaks in month ${bp.months}</span>
      </div>
      <div class="big-number">${fmt(bp.peak.carry)}<span class="per-mo">/mo at peak</span></div>
      <div class="big-sub">${bp.currentPayment > 0 ? 'current payment + ' : ''}${rateNote}</div>
      <div class="build-chart" aria-hidden="true">${bars}</div>
      <div class="bc-axis"><span>month 1</span><span>month ${bp.months}</span></div>
      ${legend}
      ${affordHTML(bp.peak.carry)}
      <details class="scenario-details">
        <summary>Show breakdown</summary>
        ${rowsHTML([
          ['Construction rate', bp.rate.toFixed(2).replace(/\.?0+$/, '') + '%' + (bp.rateAssumed ? ' (mortgage + 1%)' : '')],
          [`Month 1`, fmt(bp.rows[0].carry) + '/mo'],
          [`Month ${mid.month} (midpoint)`, fmt(mid.carry) + '/mo'],
          [`Month ${bp.months} (final)`, fmt(bp.peak.carry) + '/mo'],
          ['Total construction interest', fmt(bp.totalInterest), { total: true }],
        ])}
        <p class="hint" style="margin-top:0.7rem">Draws assume a typical S-curve — slow start, fast middle, slow finish — so you don't need a draw schedule from your builder. You pay interest only on funds drawn so far${bp.currentPayment > 0 ? ', while still making your current payment until you move' : ''}.</p>
      </details>
    </div>`;
}

function renderAll() {
  renderBuildPhase();
  renderResults();
}

// ── Wiring ──────────────────────────────────────────────────────────────────

// Static dollar inputs whose element id matches their state field name 1:1,
// with the stepper increments each one gets. Drives both the event bindings
// in init() and the value rewrites in applyStateToDOM().
const DOLLAR_FIELDS = {
  buildCost: STEPS.large,
  sellingCosts: STEPS.small,
  otherCosts: STEPS.small,
  cashOnHand: STEPS.medium,
  rsuFunds: STEPS.medium,
  currentLoanBalance: STEPS.medium,
  currentPayment: STEPS.monthly,
  paycheckAmt: STEPS.monthly,
  paycheckAmt2: STEPS.monthly,
};

// Binds a text input to a dollar-amount state field with live comma formatting.
// Preserves cursor position relative to end of input so editing feels natural.
// `steps` ([small, big]) adds a focus-revealed stepper below the input.
function bindDollarInput(el, getter, setter, steps) {
  el.addEventListener('input', e => {
    const raw = parseInput(e.target.value);
    const formatted = fmtInput(raw);
    const cursorFromEnd = e.target.value.length - (e.target.selectionEnd || 0);
    setter(raw);
    e.target.value = formatted;
    const newPos = Math.max(0, formatted.length - cursorFromEnd);
    e.target.setSelectionRange(newPos, newPos);
    saveState();
    renderAll();
  });
  el.addEventListener('blur', syncURL);

  if (!steps) return;
  const wrap = el.closest('.input-wrap');
  wrap.insertAdjacentHTML('afterend', stepperHTML(steps));
  const stepper = wrap.nextElementSibling;

  const apply = btn => {
    setter(stepValue(getter(), Number(btn.dataset.amt)));
    el.value = fmtInput(getter());
    saveState();
    renderAll();
  };
  // pointerdown + preventDefault keeps the input focused, so the stepper stays
  // visible and the mobile keypad stays open between taps.
  stepper.addEventListener('pointerdown', e => {
    const btn = e.target.closest('.step-btn');
    if (!btn) return;
    e.preventDefault();
    apply(btn);
  });
  // Keyboard activation arrives as a click with detail 0 (no pointerdown).
  stepper.addEventListener('click', e => {
    const btn = e.target.closest('.step-btn');
    if (btn && e.detail === 0) apply(btn);
  });
}

// Writes the current state into every form control and re-renders. Used on
// init and whenever the URL changes underneath us (popstate), so the page
// always reflects exactly what the URL/state says.
function applyStateToDOM() {
  for (const field of Object.keys(DOLLAR_FIELDS)) {
    const el = document.getElementById(field);
    if (el) el.value = fmtInput(state[field]);
  }
  const rateInput = document.getElementById('interestRate');
  if (rateInput) rateInput.value = state.interestRate;
  const taxInput = document.getElementById('propertyTaxRate');
  if (taxInput) taxInput.value = state.propertyTaxRate;
  const stateSelect = document.getElementById('stateSelect');
  if (stateSelect) stateSelect.value = state.stateCode;
  const crInput = document.getElementById('constructionRate');
  if (crInput) crInput.value = state.constructionRate;
  renderTermButtons();
  renderMonthsButtons();
  renderPayfreqBtns();
  renderSalePrices();
  renderAll();
}

function populateStateSelect() {
  const sel = document.getElementById('stateSelect');
  if (!sel || sel._populated) return;
  sel._populated = true;
  const codes = Object.keys(STATE_NAMES).sort((a, b) =>
    STATE_NAMES[a].localeCompare(STATE_NAMES[b]));
  sel.insertAdjacentHTML('beforeend',
    codes.map(c => `<option value="${c}">${STATE_NAMES[c]}</option>`).join(''));
}

function init() {
  // URL params are the source of truth when present; localStorage only
  // bootstraps state when the URL carries none. Either way the URL is
  // immediately rewritten from state, so it always reflects the page.
  const params = typeof location !== 'undefined'
    ? new URLSearchParams(location.search)
    : new URLSearchParams();
  if (hasStateParams(params)) {
    state = paramsToState(params);
    saveState();
  } else {
    state = defaultState();
    loadState();
  }
  syncURL();

  populateStateSelect();

  for (const [field, steps] of Object.entries(DOLLAR_FIELDS)) {
    bindDollarInput(
      document.getElementById(field),
      () => state[field],
      v => { state[field] = v; },
      steps,
    );
  }

  const rateInput = document.getElementById('interestRate');
  rateInput.addEventListener('input', e => {
    state.interestRate = e.target.value;
    saveState(); renderAll();
  });
  rateInput.addEventListener('blur', syncURL);

  const constructionRateInput = document.getElementById('constructionRate');
  constructionRateInput.addEventListener('input', e => {
    state.constructionRate = e.target.value;
    saveState(); renderAll();
  });
  constructionRateInput.addEventListener('blur', syncURL);

  document.querySelectorAll('.months-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.buildMonths = btn.dataset.months;
      renderMonthsButtons();
      saveState(); syncURL(); renderAll();
    });
  });

  document.querySelectorAll('.term-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.loanTerm = Number(btn.dataset.term);
      renderTermButtons();
      saveState(); syncURL(); renderResults();
    });
  });

  const taxInput = document.getElementById('propertyTaxRate');

  // Picking a state fills its average rate as a convenient starting point;
  // the rate field is freely editable for your exact local (county/city) rate.
  const stateSelect = document.getElementById('stateSelect');
  stateSelect.addEventListener('change', e => {
    state.stateCode = e.target.value;
    if (STATE_TAX_RATES[state.stateCode] != null) {
      state.propertyTaxRate = String(STATE_TAX_RATES[state.stateCode]);
      taxInput.value = state.propertyTaxRate;
    }
    saveState(); syncURL(); renderResults();
  });

  taxInput.addEventListener('input', e => {
    state.propertyTaxRate = e.target.value;
    saveState(); renderResults();
  });
  taxInput.addEventListener('blur', syncURL);

  function bindPayFreq(containerId, setter) {
    document.getElementById(containerId).addEventListener('click', e => {
      const btn = e.target.closest('.payfreq-btn');
      if (!btn) return;
      setter(btn.dataset.freq);
      renderPayfreqBtns();
      saveState(); syncURL();
      renderAll();
    });
  }
  bindPayFreq('payfreqBtns1', v => { state.paycheckFreq = v; });
  bindPayFreq('payfreqBtns2', v => { state.paycheckFreq2 = v; });

  document.getElementById('btnAddPrice').addEventListener('click', () => {
    state.salePrices.push('');
    saveState();
    renderSalePrices();
  });

  // Back/forward navigation: re-derive state from the URL and redraw the
  // whole form so the page can never disagree with the address bar.
  if (typeof window !== 'undefined') {
    window.addEventListener('popstate', () => {
      const p = new URLSearchParams(location.search);
      if (hasStateParams(p)) {
        state = paramsToState(p);
      } else {
        state = defaultState();
        loadState();
      }
      saveState();
      applyStateToDOM();
    });
  }

  applyStateToDOM();
}

// Export pure + internal helpers for the Node test suite. In the browser
// `module` is undefined, so this block is skipped and functions stay global.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    STATE_TAX_RATES, STATE_NAMES, DEFAULT_STATE, DEFAULT_TAX_RATE, STEPS,
    monthlyPayment, monthlyPropertyTax, netProceeds, computeProjection, fmt,
    fmtInput, parseInput, stepValue, stepperHTML, affordHTML,
    stateToParams, paramsToState, hasStateParams, syncURL, defaultState,
    drawCurve, computeBuildPhase,
    renderResults, renderSalePrices, renderBuildPhase, init,
    __setState: s => { state = s; },
    __getState: () => state,
  };
}
