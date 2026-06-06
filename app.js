const STORAGE_KEY = 'house-planner-v2';

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

// FIPS codes used by the Census API to scope a state's counties.
const STATE_FIPS = {
  AL: '01', AK: '02', AZ: '04', AR: '05', CA: '06', CO: '08', CT: '09',
  DE: '10', DC: '11', FL: '12', GA: '13', HI: '15', ID: '16', IL: '17',
  IN: '18', IA: '19', KS: '20', KY: '21', LA: '22', ME: '23', MD: '24',
  MA: '25', MI: '26', MN: '27', MS: '28', MO: '29', MT: '30', NE: '31',
  NV: '32', NH: '33', NJ: '34', NM: '35', NY: '36', NC: '37', ND: '38',
  OH: '39', OK: '40', OR: '41', PA: '42', RI: '44', SC: '45', SD: '46',
  TN: '47', TX: '48', UT: '49', VT: '50', VA: '51', WA: '53', WV: '54',
  WI: '55', WY: '56',
};

const CENSUS_YEAR = 2023;

let state = {
  buildCost: '',
  loanTerm: 30,
  interestRate: '',
  stateCode: '',
  countyCode: '',
  propertyTaxRate: '',
  currentLoanBalance: '',
  salePrices: [''],
};

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) state = { ...state, ...JSON.parse(saved) };
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

  if (build <= 0 || rate <= 0) {
    return { ready: false };
  }

  const propertyTax = monthlyPropertyTax(build, taxRate);

  const validPrices = (s.salePrices || [])
    .map(p => parseFloat(p))
    .filter(p => !isNaN(p) && p >= 0);

  function scenarioFor(salePrice) {
    const proceeds = netProceeds(salePrice, balance);
    const loanNeeded = Math.max(0, build - proceeds);
    const principalInterest = loanNeeded > 0 ? monthlyPayment(loanNeeded, rate, term) : 0;
    const totalMonthly = principalInterest + propertyTax;
    return {
      salePrice,
      proceeds,
      loanNeeded,
      principalInterest,
      propertyTax,
      totalMonthly,
      fullyCovered: loanNeeded <= 0,
    };
  }

  if (validPrices.length === 0) {
    // No sale price entered → finance the whole build.
    const pi = monthlyPayment(build, rate, term);
    return {
      ready: true,
      mode: 'no-sale',
      term, rate, taxRate, propertyTax,
      scenario: {
        loanNeeded: build,
        principalInterest: pi,
        propertyTax,
        totalMonthly: pi + propertyTax,
      },
    };
  }

  return {
    ready: true,
    mode: 'scenarios',
    term, rate, taxRate, propertyTax,
    scenarios: validPrices.map(scenarioFor),
  };
}

function fmt(n) {
  return '$' + Math.round(n).toLocaleString('en-US');
}

// ── County-level property tax via the Census ACS (browser fetch) ─────────────
// Effective rate ≈ median real-estate taxes paid / median home value.

function effectiveRate(medianTax, medianValue) {
  const t = Number(medianTax), v = Number(medianValue);
  // Census uses large negative sentinels (e.g. -666666666) for nulls.
  if (!(t > 0) || !(v > 0)) return null;
  return Math.round((t / v) * 100 * 100) / 100; // percent, 2 decimals
}

function censusCountyUrl(stateFips) {
  return `https://api.census.gov/data/${CENSUS_YEAR}/acs/acs5` +
    `?get=NAME,B25103_001E,B25077_001E&for=county:*&in=state:${stateFips}`;
}

// Turns the Census API's array-of-arrays into sorted {name, code, rate} rows.
function parseCensusCounties(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return [];
  const [header, ...data] = rows;
  const ni = header.indexOf('NAME');
  const ti = header.indexOf('B25103_001E');
  const vi = header.indexOf('B25077_001E');
  const ci = header.indexOf('county');
  if (ni < 0 || ti < 0 || vi < 0 || ci < 0) return [];
  return data
    .map(r => {
      const rate = effectiveRate(r[ti], r[vi]);
      if (rate == null) return null;
      return { name: String(r[ni]).split(',')[0], code: r[ci], rate };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function fetchCounties(stateCode) {
  const fips = STATE_FIPS[stateCode];
  if (!fips) return [];
  const res = await fetch(censusCountyUrl(fips));
  if (!res.ok) throw new Error('Census API ' + res.status);
  return parseCensusCounties(await res.json());
}

// ── Rendering ───────────────────────────────────────────────────────────────

function renderSalePrices() {
  const list = document.getElementById('salePricesList');

  // Event delegation on the stable parent so listeners survive re-renders.
  if (!list._delegated) {
    list._delegated = true;
    list.addEventListener('input', e => {
      if (!e.target.classList.contains('sale-price-input')) return;
      state.salePrices[+e.target.dataset.idx] = e.target.value;
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
        <input type="number" min="0" step="any" placeholder="e.g. 350000"
          value="${price}" data-idx="${i}" class="sale-price-input" />
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
        ${rowsHTML([
          ['Loan amount', fmt(s.loanNeeded)],
          ['Principal & interest', fmt(s.principalInterest) + '/mo'],
          ['Property tax', fmt(s.propertyTax) + '/mo'],
          ['Total monthly', fmt(s.totalMonthly) + '/mo', { total: true }],
        ])}
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
          <div class="big-number">${s.fullyCovered ? fmt(s.totalMonthly) : fmt(s.totalMonthly)}<span class="per-mo">/mo</span></div>
          <div class="big-sub">${s.fullyCovered ? 'Build fully covered — tax only' : taxNote}</div>
          ${rowsHTML([
            ['Net sale proceeds', fmt(s.proceeds)],
            ['Loan needed', fmt(s.loanNeeded)],
            ['Principal & interest', s.principalInterest > 0 ? fmt(s.principalInterest) + '/mo' : '—'],
            ['Property tax', fmt(s.propertyTax) + '/mo'],
            ['Total monthly', fmt(s.totalMonthly) + '/mo', { total: true }],
          ])}
        </div>
      `).join('')}
    </div>`;
}

// ── Wiring ──────────────────────────────────────────────────────────────────

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

  const buildInput = document.getElementById('buildCost');
  buildInput.value = state.buildCost;
  buildInput.addEventListener('input', e => {
    state.buildCost = e.target.value;
    saveState(); renderResults();
  });

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

  const taxInput = document.getElementById('propertyTaxRate');
  const countySelect = document.getElementById('countySelect');
  const countyNote = document.getElementById('countyNote');

  function setRate(value) {
    state.propertyTaxRate = String(value);
    taxInput.value = state.propertyTaxRate;
  }

  // Fetches the state's counties from the Census API and fills the dropdown.
  // Falls back silently to the state-average rate if the API is unavailable.
  async function loadCounties(preselect) {
    countySelect.innerHTML = '<option value="">Statewide average</option>';
    if (!state.stateCode) {
      countySelect.disabled = true;
      countyNote.textContent = '';
      return;
    }
    countySelect.disabled = true;
    countyNote.textContent = 'Loading counties…';
    try {
      const counties = await fetchCounties(state.stateCode);
      if (!counties.length) throw new Error('no data');
      countySelect.insertAdjacentHTML('beforeend', counties
        .map(c => `<option value="${c.code}" data-rate="${c.rate}">${c.name} — ${c.rate}%</option>`)
        .join(''));
      countySelect.disabled = false;
      countyNote.textContent = 'Pick your county for a local rate, or edit it directly.';
      if (preselect) {
        countySelect.value = preselect;
        const opt = countySelect.selectedOptions[0];
        if (opt && opt.dataset.rate) setRate(opt.dataset.rate);
      }
    } catch {
      state.countyCode = '';
      countyNote.textContent = 'County data unavailable — using state average. You can edit the rate below.';
    }
  }

  const stateSelect = document.getElementById('stateSelect');
  stateSelect.value = state.stateCode;
  stateSelect.addEventListener('change', e => {
    state.stateCode = e.target.value;
    state.countyCode = '';
    // Start from the state average; the county dropdown can refine it.
    if (STATE_TAX_RATES[state.stateCode] != null) setRate(STATE_TAX_RATES[state.stateCode]);
    saveState(); renderResults();
    loadCounties();
  });

  countySelect.addEventListener('change', e => {
    state.countyCode = e.target.value;
    const opt = e.target.selectedOptions[0];
    if (opt && opt.dataset.rate) setRate(opt.dataset.rate);
    else if (STATE_TAX_RATES[state.stateCode] != null) setRate(STATE_TAX_RATES[state.stateCode]);
    saveState(); renderResults();
  });

  taxInput.value = state.propertyTaxRate;
  taxInput.addEventListener('input', e => {
    state.propertyTaxRate = e.target.value;
    saveState(); renderResults();
  });

  // Restore county list on load if a state was previously chosen.
  if (state.stateCode) loadCounties(state.countyCode);

  const balanceInput = document.getElementById('currentLoanBalance');
  balanceInput.value = state.currentLoanBalance;
  balanceInput.addEventListener('input', e => {
    state.currentLoanBalance = e.target.value;
    saveState(); renderResults();
  });

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
    STATE_TAX_RATES, STATE_NAMES, STATE_FIPS,
    monthlyPayment, monthlyPropertyTax, netProceeds, computeProjection, fmt,
    effectiveRate, parseCensusCounties, censusCountyUrl,
    renderResults, renderSalePrices,
    __setState: s => { state = s; },
    __getState: () => state,
  };
}
