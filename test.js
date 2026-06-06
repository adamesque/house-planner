import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// ── DOM setup ─────────────────────────────────────────────────────────────────

function makeDOM() {
  const dom = new JSDOM(`<!DOCTYPE html>
    <html><body>
      <input id="buildCost" type="number" />
      <input id="loanTerm" type="range" value="30" />
      <span id="loanTermDisplay"></span>
      <input id="interestRate" type="number" />
      <div id="salePricesList"></div>
      <button id="btnAddPrice"></button>
      <div id="resultsArea"></div>
    </body></html>`,
    { url: 'http://localhost' }
  );
  global.document = dom.window.document;
  global.localStorage = dom.window.localStorage;
  return dom;
}

// ── Load app functions ────────────────────────────────────────────────────────

// Inline the pure functions so tests don't depend on a browser module loader.
// These must stay in sync with app.js.

const STORAGE_KEY = 'house-planner-v1';

let state;

function resetState(overrides = {}) {
  state = { buildCost: '', loanTerm: 30, interestRate: '', salePrices: [''], ...overrides };
}

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
  list.innerHTML = '';
  state.salePrices.forEach((price, i) => {
    const row = document.createElement('div');
    row.className = 'sale-price-row';
    row.innerHTML = `
      <input type="number" value="${price}" data-idx="${i}" class="sale-price-input" />
      <button class="btn-remove" data-idx="${i}">×</button>
    `;
    list.appendChild(row);
  });
  list.querySelectorAll('.btn-remove').forEach(btn => {
    btn.addEventListener('click', e => {
      const idx = +e.currentTarget.dataset.idx;
      state.salePrices.splice(idx, 1);
      if (state.salePrices.length === 0) state.salePrices = [''];
      renderSalePrices();
      renderResults();
    });
  });
}

function renderResults() {
  const area = document.getElementById('resultsArea');
  const build = parseFloat(state.buildCost) || 0;
  const rate = parseFloat(state.interestRate) || 0;
  const term = state.loanTerm;
  const validPrices = state.salePrices.map(p => parseFloat(p)).filter(p => !isNaN(p) && p >= 0);

  if (build <= 0 || rate <= 0) {
    area.innerHTML = '<p class="no-sale-msg">Enter a build cost and interest rate to see projections.</p>';
    return;
  }
  if (validPrices.length === 0) {
    const payment = monthlyPayment(build, rate, term);
    area.innerHTML = `<div class="result-value">${fmt(payment)}</div><div class="loan-amount">${fmt(build)}</div>`;
    return;
  }
  const scenarios = validPrices.map(salePrice => {
    const loan = Math.max(0, build - salePrice);
    const payment = loan > 0 ? monthlyPayment(loan, rate, term) : 0;
    return { salePrice, loan, payment };
  });
  area.innerHTML = `<div class="sale-scenarios">${scenarios.map(s => `
    <div class="scenario-card">
      <div class="sale-price">${fmt(s.salePrice)}</div>
      <div class="loan-needed">${fmt(s.loan)}</div>
      <div class="monthly-payment">${s.payment > 0 ? fmt(s.payment) : '—'}</div>
      <div class="result-sub">${s.loan <= 0 ? 'Fully covered' : ''}</div>
    </div>`).join('')}</div>`;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('monthlyPayment', () => {
  test('returns null for zero principal', () => {
    assert.equal(monthlyPayment(0, 6.5, 30), null);
  });

  test('returns null for zero term', () => {
    assert.equal(monthlyPayment(500000, 6.5, 0), null);
  });

  test('returns principal/months when rate is 0%', () => {
    assert.equal(monthlyPayment(120000, 0, 10), 1000);
  });

  test('$400k at 6% for 30yr ≈ $2,398/mo', () => {
    const payment = monthlyPayment(400000, 6, 30);
    assert.ok(Math.abs(payment - 2398.20) < 1, `got ${payment}`);
  });

  test('$400k at 6% for 15yr ≈ $3,375/mo', () => {
    const payment = monthlyPayment(400000, 6, 15);
    assert.ok(Math.abs(payment - 3375.43) < 1, `got ${payment}`);
  });

  test('higher rate → higher payment', () => {
    assert.ok(monthlyPayment(500000, 8, 30) > monthlyPayment(500000, 5, 30));
  });

  test('shorter term → higher payment', () => {
    assert.ok(monthlyPayment(500000, 6, 15) > monthlyPayment(500000, 6, 30));
  });
});

describe('fmt', () => {
  test('prefixes with $', () => {
    assert.ok(fmt(1000).startsWith('$'));
  });

  test('formats millions with commas', () => {
    assert.equal(fmt(1000000), '$1,000,000');
  });

  test('rounds to nearest dollar', () => {
    assert.equal(fmt(1234.56), '$1,235');
  });

  test('handles small amounts', () => {
    assert.equal(fmt(500), '$500');
  });
});

describe('localStorage persistence', () => {
  test('saveState writes values to localStorage', () => {
    makeDOM();
    resetState({ buildCost: '600000', interestRate: '6.5' });
    saveState();
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    assert.equal(saved.buildCost, '600000');
    assert.equal(saved.interestRate, '6.5');
  });

  test('loadState restores saved values', () => {
    makeDOM();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      buildCost: '750000', loanTerm: 15, interestRate: '7', salePrices: ['300000']
    }));
    resetState();
    loadState();
    assert.equal(state.buildCost, '750000');
    assert.equal(state.loanTerm, 15);
    assert.equal(state.salePrices[0], '300000');
  });

  test('loadState is a no-op when nothing is saved', () => {
    makeDOM();
    resetState();
    loadState();
    assert.equal(state.buildCost, '');
    assert.equal(state.loanTerm, 30);
  });

  test('loadState handles corrupt JSON without throwing', () => {
    makeDOM();
    localStorage.setItem(STORAGE_KEY, 'not valid json{{');
    resetState();
    assert.doesNotThrow(() => loadState());
    assert.equal(state.buildCost, '');
  });
});

describe('renderResults', () => {
  test('shows prompt when build cost is missing', () => {
    makeDOM();
    resetState({ interestRate: '6.5' });
    renderResults();
    assert.ok(document.getElementById('resultsArea').innerHTML.includes('Enter a build cost'));
  });

  test('shows prompt when interest rate is missing', () => {
    makeDOM();
    resetState({ buildCost: '500000' });
    renderResults();
    assert.ok(document.getElementById('resultsArea').innerHTML.includes('Enter a build cost'));
  });

  test('shows payment on full build cost when no sale prices entered', () => {
    makeDOM();
    resetState({ buildCost: '500000', interestRate: '6', salePrices: [] });
    renderResults();
    const html = document.getElementById('resultsArea').innerHTML;
    assert.ok(html.includes('$500,000'), `expected $500,000 in: ${html}`);
  });

  test('renders one scenario card per valid sale price', () => {
    makeDOM();
    resetState({ buildCost: '600000', interestRate: '6.5', salePrices: ['300000', '350000'] });
    renderResults();
    const cards = document.getElementById('resultsArea').querySelectorAll('.scenario-card');
    assert.equal(cards.length, 2);
  });

  test('loan = build cost minus sale price', () => {
    makeDOM();
    resetState({ buildCost: '500000', interestRate: '6', salePrices: ['200000'] });
    renderResults();
    assert.ok(document.getElementById('resultsArea').innerHTML.includes('$300,000'));
  });

  test('shows "Fully covered" when sale price >= build cost', () => {
    makeDOM();
    resetState({ buildCost: '400000', interestRate: '6', salePrices: ['450000'] });
    renderResults();
    assert.ok(document.getElementById('resultsArea').innerHTML.includes('Fully covered'));
  });

  test('ignores empty sale price inputs', () => {
    makeDOM();
    resetState({ buildCost: '500000', interestRate: '6', salePrices: ['', ''] });
    renderResults();
    // Empty inputs → treated as no sale prices, shows single payment view
    const html = document.getElementById('resultsArea').innerHTML;
    assert.ok(html.includes('$500,000'));
  });
});

describe('renderSalePrices DOM', () => {
  test('renders one input per sale price', () => {
    makeDOM();
    resetState({ salePrices: ['100000', '200000', '300000'] });
    renderSalePrices();
    const inputs = document.querySelectorAll('.sale-price-input');
    assert.equal(inputs.length, 3);
  });

  test('renders a remove button for each row', () => {
    makeDOM();
    resetState({ salePrices: ['100000', '200000'] });
    renderSalePrices();
    assert.equal(document.querySelectorAll('.btn-remove').length, 2);
  });

  test('clicking remove reduces the list length', () => {
    makeDOM();
    resetState({ salePrices: ['100000', '200000'] });
    renderSalePrices();
    document.querySelector('.btn-remove').click();
    assert.equal(state.salePrices.length, 1);
  });

  test('removing the last item resets to one empty row', () => {
    makeDOM();
    resetState({ salePrices: ['100000'] });
    renderSalePrices();
    document.querySelector('.btn-remove').click();
    assert.equal(state.salePrices.length, 1);
    assert.equal(state.salePrices[0], '');
  });
});
