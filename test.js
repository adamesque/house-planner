const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const app = require('./app.js');
const {
  monthlyPayment, monthlyPropertyTax, netProceeds, computeProjection, fmt,
  renderResults, renderSalePrices, STATE_TAX_RATES, STATE_NAMES,
  DEFAULT_STATE, DEFAULT_TAX_RATE,
  __setState,
} = app;

// Fresh jsdom document/localStorage before each test that touches the DOM.
function makeDOM() {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>
    <div id="salePricesList"></div>
    <div id="resultsArea"></div>
  </body></html>`, { url: 'http://localhost' });
  global.document = dom.window.document;
  global.localStorage = dom.window.localStorage;
  return dom;
}

function baseState(overrides = {}) {
  return {
    buildCost: '', loanTerm: 30, interestRate: '',
    stateCode: '', propertyTaxRate: '', currentLoanBalance: '',
    salePrices: [''], ...overrides,
  };
}

describe('monthlyPayment', () => {
  test('null for zero principal', () => assert.equal(monthlyPayment(0, 6.5, 30), null));
  test('null for zero term', () => assert.equal(monthlyPayment(500000, 6.5, 0), null));
  test('principal / months when rate is 0%', () => assert.equal(monthlyPayment(120000, 0, 10), 1000));
  test('$400k @ 6% / 30yr ≈ $2,398', () => {
    assert.ok(Math.abs(monthlyPayment(400000, 6, 30) - 2398.20) < 1);
  });
  test('$400k @ 6% / 15yr ≈ $3,375', () => {
    assert.ok(Math.abs(monthlyPayment(400000, 6, 15) - 3375.43) < 1);
  });
  test('higher rate → higher payment', () => {
    assert.ok(monthlyPayment(500000, 8, 30) > monthlyPayment(500000, 5, 30));
  });
  test('shorter term → higher payment', () => {
    assert.ok(monthlyPayment(500000, 6, 15) > monthlyPayment(500000, 6, 30));
  });
});

describe('monthlyPropertyTax', () => {
  test('zero when rate is 0', () => assert.equal(monthlyPropertyTax(500000, 0), 0));
  test('zero when value is 0', () => assert.equal(monthlyPropertyTax(0, 1.5), 0));
  test('$500k @ 1.2% = $500/mo', () => {
    assert.equal(monthlyPropertyTax(500000, 1.2), 500);
  });
  test('$600k @ 2% = $1000/mo', () => {
    assert.equal(monthlyPropertyTax(600000, 2), 1000);
  });
});

describe('netProceeds', () => {
  test('sale minus payoff', () => assert.equal(netProceeds(400000, 150000), 250000));
  test('negative when underwater', () => assert.equal(netProceeds(300000, 350000), -50000));
  test('full sale price when no balance', () => assert.equal(netProceeds(400000, 0), 400000));
});

describe('computeProjection', () => {
  test('not ready without build cost', () => {
    assert.equal(computeProjection(baseState({ interestRate: '6' })).ready, false);
  });
  test('not ready without interest rate', () => {
    assert.equal(computeProjection(baseState({ buildCost: '500000' })).ready, false);
  });

  test('no-sale mode finances full build', () => {
    const p = computeProjection(baseState({ buildCost: '500000', interestRate: '6', salePrices: [] }));
    assert.equal(p.mode, 'no-sale');
    assert.equal(p.scenario.loanNeeded, 500000);
  });

  test('no-sale total = P&I + property tax', () => {
    const p = computeProjection(baseState({
      buildCost: '500000', interestRate: '6', propertyTaxRate: '1.2', salePrices: [],
    }));
    const expectedPI = monthlyPayment(500000, 6, 30);
    assert.ok(Math.abs(p.scenario.totalMonthly - (expectedPI + 500)) < 0.01);
  });

  test('one scenario per valid sale price', () => {
    const p = computeProjection(baseState({
      buildCost: '600000', interestRate: '6.5', salePrices: ['300000', '350000'],
    }));
    assert.equal(p.mode, 'scenarios');
    assert.equal(p.scenarios.length, 2);
  });

  test('loan needed accounts for current mortgage payoff', () => {
    // Build 600k, sell 400k but still owe 150k → net proceeds 250k → loan 350k
    const p = computeProjection(baseState({
      buildCost: '600000', interestRate: '6', currentLoanBalance: '150000', salePrices: ['400000'],
    }));
    assert.equal(p.scenarios[0].proceeds, 250000);
    assert.equal(p.scenarios[0].loanNeeded, 350000);
  });

  test('without payoff, full sale price reduces the loan', () => {
    const p = computeProjection(baseState({
      buildCost: '500000', interestRate: '6', salePrices: ['200000'],
    }));
    assert.equal(p.scenarios[0].loanNeeded, 300000);
  });

  test('underwater home increases the loan needed', () => {
    // Build 500k, sell 300k, owe 350k → proceeds -50k → loan 550k
    const p = computeProjection(baseState({
      buildCost: '500000', interestRate: '6', currentLoanBalance: '350000', salePrices: ['300000'],
    }));
    assert.equal(p.scenarios[0].proceeds, -50000);
    assert.equal(p.scenarios[0].loanNeeded, 550000);
  });

  test('fully covered when proceeds exceed build cost', () => {
    const p = computeProjection(baseState({
      buildCost: '400000', interestRate: '6', salePrices: ['450000'],
    }));
    assert.equal(p.scenarios[0].fullyCovered, true);
    assert.equal(p.scenarios[0].principalInterest, 0);
  });

  test('fully covered still includes property tax in total', () => {
    const p = computeProjection(baseState({
      buildCost: '400000', interestRate: '6', propertyTaxRate: '1.2', salePrices: ['450000'],
    }));
    assert.equal(p.scenarios[0].principalInterest, 0);
    assert.equal(p.scenarios[0].totalMonthly, 400); // 400k * 1.2% / 12
  });

  test('property tax is based on new build value', () => {
    const p = computeProjection(baseState({
      buildCost: '600000', interestRate: '6', propertyTaxRate: '1', salePrices: ['300000'],
    }));
    assert.equal(p.scenarios[0].propertyTax, 500); // 600k * 1% / 12
  });

  test('empty sale price strings fall back to no-sale mode', () => {
    const p = computeProjection(baseState({
      buildCost: '500000', interestRate: '6', salePrices: ['', ''],
    }));
    assert.equal(p.mode, 'no-sale');
  });
});

describe('fmt', () => {
  test('prefixes with $', () => assert.ok(fmt(1000).startsWith('$')));
  test('commas in millions', () => assert.equal(fmt(1000000), '$1,000,000'));
  test('rounds to dollar', () => assert.equal(fmt(1234.56), '$1,235'));
  test('negative amounts', () => assert.equal(fmt(-50000), '$-50,000'));
});

describe('state tax data', () => {
  test('has all 50 states plus DC', () => {
    assert.equal(Object.keys(STATE_TAX_RATES).length, 51);
    assert.equal(Object.keys(STATE_NAMES).length, 51);
  });
  test('every rate has a name', () => {
    for (const code of Object.keys(STATE_TAX_RATES)) {
      assert.ok(STATE_NAMES[code], `missing name for ${code}`);
    }
  });
  test('rates are plausible (0–3%)', () => {
    for (const [code, rate] of Object.entries(STATE_TAX_RATES)) {
      assert.ok(rate > 0 && rate < 3, `${code} rate ${rate} out of range`);
    }
  });
});

describe('defaults (prefilled local rate)', () => {
  test('default state is Texas with a known name', () => {
    assert.equal(DEFAULT_STATE, 'TX');
    assert.equal(STATE_NAMES[DEFAULT_STATE], 'Texas');
  });
  test('default rate is a plausible Austin/Travis rate above the TX average', () => {
    const rate = parseFloat(DEFAULT_TAX_RATE);
    assert.ok(rate > STATE_TAX_RATES.TX, 'Austin rate should exceed TX average');
    assert.ok(rate > 1 && rate < 2.5, `default rate ${rate} out of plausible range`);
  });
  test('default rate feeds straight into a projection', () => {
    const p = computeProjection({
      buildCost: '500000', interestRate: '6', loanTerm: 30,
      propertyTaxRate: DEFAULT_TAX_RATE, currentLoanBalance: '', salePrices: [],
    });
    // 500000 * 1.8% / 12 = 750
    assert.ok(Math.abs(p.scenario.propertyTax - 750) < 0.01);
  });
});

describe('renderResults (DOM)', () => {
  beforeEach(makeDOM);

  test('prompts when not ready', () => {
    __setState(baseState({ interestRate: '6' }));
    renderResults();
    assert.ok(document.getElementById('resultsArea').innerHTML.includes('Enter a build cost'));
  });

  test('renders one card per scenario', () => {
    __setState(baseState({ buildCost: '600000', interestRate: '6.5', salePrices: ['300000', '350000'] }));
    renderResults();
    assert.equal(document.querySelectorAll('.scenario-card').length, 2);
  });

  test('shows underwater warning', () => {
    __setState(baseState({
      buildCost: '500000', interestRate: '6', currentLoanBalance: '350000', salePrices: ['300000'],
    }));
    renderResults();
    assert.ok(document.getElementById('resultsArea').innerHTML.includes('Underwater'));
  });

  test('shows fully-covered note', () => {
    __setState(baseState({ buildCost: '400000', interestRate: '6', salePrices: ['450000'] }));
    renderResults();
    assert.ok(document.getElementById('resultsArea').innerHTML.includes('fully covered'));
  });
});

describe('renderSalePrices (DOM)', () => {
  beforeEach(makeDOM);

  test('one input per sale price', () => {
    __setState(baseState({ salePrices: ['100000', '200000', '300000'] }));
    renderSalePrices();
    assert.equal(document.querySelectorAll('.sale-price-input').length, 3);
  });

  test('remove button per row', () => {
    __setState(baseState({ salePrices: ['100000', '200000'] }));
    renderSalePrices();
    assert.equal(document.querySelectorAll('.btn-remove').length, 2);
  });

  test('clicking remove shrinks the list', () => {
    __setState(baseState({ salePrices: ['100000', '200000'] }));
    renderSalePrices();
    document.querySelector('.btn-remove').click();
    assert.equal(app.__getState().salePrices.length, 1);
  });

  test('removing the last row leaves one empty row', () => {
    __setState(baseState({ salePrices: ['100000'] }));
    renderSalePrices();
    document.querySelector('.btn-remove').click();
    assert.equal(app.__getState().salePrices.length, 1);
    assert.equal(app.__getState().salePrices[0], '');
  });
});
