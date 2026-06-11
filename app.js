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

let state = {
  buildCost: '',
  loanTerm: 30,
  interestRate: '',
  stateCode: DEFAULT_STATE,
  propertyTaxRate: DEFAULT_TAX_RATE,
  currentLoanBalance: '',
  salePrices: [''],
  sellingCosts: '',
  otherCosts: '',
  currentPayment: '',
  paycheckAmt: '',
  paycheckFreq: '2',
  buildMonths: '12',      // construction duration in months
  constructionRate: '',   // string %, blank = interestRate + 1
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

  if (build <= 0 || rate <= 0) return { ready: false };

  // Property tax is based on the new home's assessed value, not extra costs.
  const propertyTax = monthlyPropertyTax(build, taxRate);

  const validPrices = (s.salePrices || [])
    .map(p => parseFloat(p))
    .filter(p => !isNaN(p) && p >= 0);

  function scenarioFor(salePrice) {
    const proceeds = netProceeds(salePrice, balance);
    const loanNeeded = Math.max(0, build + extraCosts - proceeds);
    const principalInterest = loanNeeded > 0 ? monthlyPayment(loanNeeded, rate, term) : 0;
    const totalMonthly = principalInterest + propertyTax;
    return {
      salePrice, proceeds, loanNeeded, principalInterest, propertyTax, totalMonthly,
      fullyCovered: loanNeeded <= 0,
    };
  }

  if (validPrices.length === 0) {
    const loanNeeded = build + extraCosts;
    const pi = monthlyPayment(loanNeeded, rate, term);
    return {
      ready: true, mode: 'no-sale', term, rate, taxRate, propertyTax,
      scenario: {
        loanNeeded, principalInterest: pi, propertyTax, totalMonthly: pi + propertyTax,
      },
    };
  }

  return {
    ready: true, mode: 'scenarios', term, rate, taxRate, propertyTax,
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

// ── Rendering ───────────────────────────────────────────────────────────────

// Compact delta + affordability bar comparing totalMonthly to the user's
// current payment and base take-home. Returns '' when no comparison data set.
function affordHTML(totalMonthly) {
  const freq = state.paycheckFreq === 'biweekly' ? 26 / 12 : 2;
  const base = (parseFloat(state.paycheckAmt) || 0) * freq;
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
    list.addEventListener('click', e => {
      const btn = e.target.closest('.btn-remove');
      if (!btn) return;
      state.salePrices.splice(+btn.dataset.idx, 1);
      if (state.salePrices.length === 0) state.salePrices = [''];
      saveState();
      renderSalePrices();
      renderResults();
    });
  }

  list.innerHTML = '';
  state.salePrices.forEach((price, i) => {
    const row = document.createElement('div');
    row.className = 'sale-price-row';
    row.innerHTML = `
      <div class="input-wrap has-prefix">
        <span class="input-prefix">$</span>
        <input type="text" inputmode="numeric" placeholder="e.g. 350,000"
          value="${fmtInput(price)}" data-idx="${i}" class="sale-price-input" />
      </div>
      <button class="btn-remove" data-idx="${i}" title="Remove">×</button>
    `;
    list.appendChild(row);
  });
}

function renderTermButtons() {
  document.querySelectorAll('.term-btn').forEach(btn => {
    btn.classList.toggle('active', Number(btn.dataset.term) === Number(state.loanTerm));
  });
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
        <div class="big-sub">${taxNote}</div>
        ${affordHTML(s.totalMonthly)}
        <details class="scenario-details">
          <summary>Show breakdown</summary>
          ${rowsHTML([
            ['Loan amount', fmt(s.loanNeeded)],
            ['Principal & interest', fmt(s.principalInterest) + '/mo'],
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

// Binds a text input to a dollar-amount state field with live comma formatting.
// Preserves cursor position relative to end of input so editing feels natural.
function bindDollarInput(el, getter, setter) {
  el.value = fmtInput(getter());
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
  loadState();
  populateStateSelect();

  bindDollarInput(
    document.getElementById('buildCost'),
    () => state.buildCost,
    v => { state.buildCost = v; },
  );

  const rateInput = document.getElementById('interestRate');
  rateInput.value = state.interestRate;
  rateInput.addEventListener('input', e => {
    state.interestRate = e.target.value;
    saveState(); renderAll();
  });

  const constructionRateInput = document.getElementById('constructionRate');
  constructionRateInput.value = state.constructionRate;
  constructionRateInput.addEventListener('input', e => {
    state.constructionRate = e.target.value;
    saveState(); renderAll();
  });

  function renderMonthsButtons() {
    document.querySelectorAll('.months-btn').forEach(btn => {
      btn.classList.toggle('active', String(btn.dataset.months) === String(state.buildMonths));
    });
  }
  document.querySelectorAll('.months-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.buildMonths = btn.dataset.months;
      renderMonthsButtons();
      saveState(); renderAll();
    });
  });
  renderMonthsButtons();

  document.querySelectorAll('.term-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.loanTerm = Number(btn.dataset.term);
      renderTermButtons();
      saveState(); renderResults();
    });
  });
  renderTermButtons();

  bindDollarInput(
    document.getElementById('sellingCosts'),
    () => state.sellingCosts,
    v => { state.sellingCosts = v; },
  );

  bindDollarInput(
    document.getElementById('otherCosts'),
    () => state.otherCosts,
    v => { state.otherCosts = v; },
  );

  const taxInput = document.getElementById('propertyTaxRate');

  // Picking a state fills its average rate as a convenient starting point;
  // the rate field is freely editable for your exact local (county/city) rate.
  const stateSelect = document.getElementById('stateSelect');
  stateSelect.value = state.stateCode;
  stateSelect.addEventListener('change', e => {
    state.stateCode = e.target.value;
    if (STATE_TAX_RATES[state.stateCode] != null) {
      state.propertyTaxRate = String(STATE_TAX_RATES[state.stateCode]);
      taxInput.value = state.propertyTaxRate;
    }
    saveState(); renderResults();
  });

  taxInput.value = state.propertyTaxRate;
  taxInput.addEventListener('input', e => {
    state.propertyTaxRate = e.target.value;
    saveState(); renderResults();
  });

  bindDollarInput(
    document.getElementById('currentLoanBalance'),
    () => state.currentLoanBalance,
    v => { state.currentLoanBalance = v; },
  );

  bindDollarInput(
    document.getElementById('currentPayment'),
    () => state.currentPayment,
    v => { state.currentPayment = v; },
  );

  bindDollarInput(
    document.getElementById('paycheckAmt'),
    () => state.paycheckAmt,
    v => { state.paycheckAmt = v; },
  );

  function renderPayfreqBtns() {
    document.querySelectorAll('.payfreq-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.freq === state.paycheckFreq);
    });
  }
  document.querySelectorAll('.payfreq-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.paycheckFreq = btn.dataset.freq;
      renderPayfreqBtns();
      saveState();
      renderAll();
    });
  });
  renderPayfreqBtns();

  document.getElementById('btnAddPrice').addEventListener('click', () => {
    state.salePrices.push('');
    saveState();
    renderSalePrices();
  });

  renderSalePrices();
  renderAll();
}

// Export pure + internal helpers for the Node test suite. In the browser
// `module` is undefined, so this block is skipped and functions stay global.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    STATE_TAX_RATES, STATE_NAMES, DEFAULT_STATE, DEFAULT_TAX_RATE,
    monthlyPayment, monthlyPropertyTax, netProceeds, computeProjection, fmt,
    fmtInput, parseInput, drawCurve, computeBuildPhase,
    renderResults, renderSalePrices, renderBuildPhase,
    __setState: s => { state = s; },
    __getState: () => state,
  };
}
