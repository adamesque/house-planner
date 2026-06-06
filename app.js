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

function fmt(n) {
  return '$' + Math.round(n).toLocaleString('en-US');
}

// ── Rendering ───────────────────────────────────────────────────────────────

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
    renderResults();
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
    saveState(); renderResults();
  });

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

  document.getElementById('btnAddPrice').addEventListener('click', () => {
    state.salePrices.push('');
    saveState();
    renderSalePrices();
  });

  renderSalePrices();
  renderResults();
}

// Export pure + internal helpers for the Node test suite. In the browser
// `module` is undefined, so this block is skipped and functions stay global.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    STATE_TAX_RATES, STATE_NAMES, DEFAULT_STATE, DEFAULT_TAX_RATE,
    monthlyPayment, monthlyPropertyTax, netProceeds, computeProjection, fmt,
    fmtInput, parseInput,
    renderResults, renderSalePrices,
    __setState: s => { state = s; },
    __getState: () => state,
  };
}
