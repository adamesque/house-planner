const STORAGE_KEY = 'house-planner-v1';

let state = {
  buildCost: '',
  loanTerm: 30,
  interestRate: '',
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

function monthlyPayment(principal, annualRate, years) {
  if (principal <= 0 || years <= 0) return null;
  if (annualRate <= 0) return principal / (years * 12);
  const r = annualRate / 100 / 12;
  const n = years * 12;
  return principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

function fmt(n) {
  return '$' + Math.round(n).toLocaleString('en-US');
}

function renderSalePrices() {
  const list = document.getElementById('salePricesList');

  // Use event delegation on the stable parent so listeners survive re-renders
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
      const idx = +btn.dataset.idx;
      state.salePrices.splice(idx, 1);
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
        <input type="number" min="0" step="any" placeholder="350000"
          value="${price}" data-idx="${i}" class="sale-price-input" />
      </div>
      <button class="btn-remove" data-idx="${i}" title="Remove">×</button>
    `;
    list.appendChild(row);
  });
}

function renderResults() {
  const area = document.getElementById('resultsArea');
  const build = parseFloat(state.buildCost) || 0;
  const rate = parseFloat(state.interestRate) || 0;
  const term = state.loanTerm;

  const validPrices = state.salePrices
    .map(p => parseFloat(p))
    .filter(p => !isNaN(p) && p >= 0);

  if (build <= 0 || rate <= 0) {
    area.innerHTML = '<p class="no-sale-msg">Enter a build cost and interest rate to see projections.</p>';
    return;
  }

  if (validPrices.length === 0) {
    const payment = monthlyPayment(build, rate, term);
    area.innerHTML = `
      <div class="results-grid">
        <div class="result-item highlight">
          <div class="result-label">Monthly payment</div>
          <div class="result-value">${fmt(payment)}</div>
          <div class="result-sub">No sale proceeds applied</div>
        </div>
        <div class="result-item">
          <div class="result-label">Loan amount</div>
          <div class="result-value">${fmt(build)}</div>
          <div class="result-sub">${term}-year @ ${rate}%</div>
        </div>
      </div>`;
    return;
  }

  const scenarios = validPrices.map(salePrice => {
    const loan = Math.max(0, build - salePrice);
    const payment = loan > 0 ? monthlyPayment(loan, rate, term) : 0;
    return { salePrice, loan, payment };
  });

  area.innerHTML = `
    <div class="sale-scenarios">
      ${scenarios.map(s => `
        <div class="scenario-card">
          <div class="result-item">
            <div class="result-label">Sale price</div>
            <div class="result-value">${fmt(s.salePrice)}</div>
          </div>
          <div class="result-item">
            <div class="result-label">Loan needed</div>
            <div class="result-value">${fmt(s.loan)}</div>
            <div class="result-sub">${term}-yr @ ${rate}%</div>
          </div>
          <div class="result-item highlight">
            <div class="result-label">Monthly payment</div>
            <div class="result-value">${s.payment > 0 ? fmt(s.payment) : '—'}</div>
            <div class="result-sub">${s.loan <= 0 ? 'Fully covered' : ''}</div>
          </div>
        </div>
      `).join('')}
    </div>`;
}

function init() {
  loadState();

  const buildInput = document.getElementById('buildCost');
  buildInput.value = state.buildCost;
  buildInput.addEventListener('input', e => {
    state.buildCost = e.target.value;
    saveState(); renderResults();
  });

  const termSlider = document.getElementById('loanTerm');
  termSlider.value = state.loanTerm;
  document.getElementById('loanTermDisplay').textContent = state.loanTerm;
  termSlider.addEventListener('input', e => {
    state.loanTerm = +e.target.value;
    document.getElementById('loanTermDisplay').textContent = state.loanTerm;
    saveState(); renderResults();
  });

  const rateInput = document.getElementById('interestRate');
  rateInput.value = state.interestRate;
  rateInput.addEventListener('input', e => {
    state.interestRate = e.target.value;
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
