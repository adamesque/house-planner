const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const app = require('./app.js');
const {
  monthlyPayment, monthlyPropertyTax, netProceeds, computeProjection, fmt,
  fmtInput, parseInput, drawCurve, computeBuildPhase,
  renderResults, renderSalePrices, renderBuildPhase, STATE_TAX_RATES, STATE_NAMES,
  DEFAULT_STATE, DEFAULT_TAX_RATE,
  __setState,
} = app;

// Fresh jsdom document/localStorage before each test that touches the DOM.
function makeDOM() {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>
    <div id="salePricesList"></div>
    <div id="buildPhaseArea"></div>
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

  test('selling costs increase the loan needed', () => {
    const p = computeProjection({
      ...baseState({ buildCost: '500000', interestRate: '6', salePrices: ['200000'] }),
      sellingCosts: '20000',
    });
    assert.equal(p.scenarios[0].loanNeeded, 320000); // 500k + 20k - 200k
  });

  test('other costs roll into the no-sale loan', () => {
    const p = computeProjection({
      ...baseState({ buildCost: '400000', interestRate: '6', salePrices: [] }),
      sellingCosts: '30000', otherCosts: '20000',
    });
    assert.equal(p.scenario.loanNeeded, 450000); // 400k + 50k
  });

  test('additional costs do not affect property tax base', () => {
    const p = computeProjection({
      ...baseState({ buildCost: '500000', interestRate: '6', propertyTaxRate: '1.2', salePrices: [] }),
      otherCosts: '50000',
    });
    assert.equal(p.scenario.propertyTax, 500); // 500k * 1.2% / 12, not 550k
  });

  test('empty sale price strings fall back to no-sale mode', () => {
    const p = computeProjection(baseState({
      buildCost: '500000', interestRate: '6', salePrices: ['', ''],
    }));
    assert.equal(p.mode, 'no-sale');
  });
});

describe('drawCurve', () => {
  test('nothing drawn at start', () => assert.equal(drawCurve(0), 0));
  test('fully drawn at completion', () => assert.equal(drawCurve(1), 1));
  test('half drawn at midpoint', () => assert.equal(drawCurve(0.5), 0.5));
  test('S-shape: slow start', () => assert.ok(drawCurve(0.25) < 0.25));
  test('S-shape: slow finish', () => assert.ok(drawCurve(0.75) > 0.75));
  test('monotonically increasing', () => {
    for (let t = 0.1; t <= 1; t += 0.1) {
      assert.ok(drawCurve(t) > drawCurve(t - 0.1));
    }
  });
});

describe('computeBuildPhase', () => {
  function buildState(overrides = {}) {
    return baseState({ buildCost: '500000', interestRate: '6', buildMonths: '12', ...overrides });
  }

  test('not ready without build cost', () => {
    assert.equal(computeBuildPhase(buildState({ buildCost: '' })).ready, false);
  });
  test('not ready without any rate', () => {
    assert.equal(computeBuildPhase(buildState({ interestRate: '' })).ready, false);
  });
  test('not ready without duration', () => {
    assert.equal(computeBuildPhase(buildState({ buildMonths: '' })).ready, false);
  });

  test('defaults construction rate to mortgage + 1%', () => {
    const bp = computeBuildPhase(buildState());
    assert.equal(bp.rate, 7);
    assert.equal(bp.rateAssumed, true);
  });

  test('explicit construction rate overrides the default', () => {
    const bp = computeBuildPhase(buildState({ constructionRate: '8.5' }));
    assert.equal(bp.rate, 8.5);
    assert.equal(bp.rateAssumed, false);
  });

  test('works with explicit rate and no mortgage rate', () => {
    const bp = computeBuildPhase(buildState({ interestRate: '', constructionRate: '8' }));
    assert.equal(bp.ready, true);
    assert.equal(bp.rate, 8);
  });

  test('one row per month of the build', () => {
    assert.equal(computeBuildPhase(buildState()).rows.length, 12);
    assert.equal(computeBuildPhase(buildState({ buildMonths: '18' })).rows.length, 18);
  });

  test('fully drawn in the final month', () => {
    const bp = computeBuildPhase(buildState());
    assert.equal(bp.peak.drawn, 500000);
  });

  test('peak interest = full balance at construction rate', () => {
    const bp = computeBuildPhase(buildState());
    // 500k * 7% / 12 ≈ 2,916.67
    assert.ok(Math.abs(bp.peak.interest - 2916.67) < 0.01);
  });

  test('interest grows month over month', () => {
    const bp = computeBuildPhase(buildState());
    for (let i = 1; i < bp.rows.length; i++) {
      assert.ok(bp.rows[i].interest > bp.rows[i - 1].interest);
    }
  });

  test('total interest is below worst case (full balance all months)', () => {
    const bp = computeBuildPhase(buildState());
    const worstCase = 500000 * (0.07 / 12) * 12;
    assert.ok(bp.totalInterest > 0 && bp.totalInterest < worstCase);
  });

  test('S-curve total beats half of worst case (back-loaded draws)', () => {
    const bp = computeBuildPhase(buildState());
    const evenAverage = 500000 * (0.07 / 12) * 12 / 2;
    // Smoothstep cumulative averages exactly 50% drawn, sampled at month ends → slightly above half.
    assert.ok(Math.abs(bp.totalInterest - evenAverage) < evenAverage * 0.1);
  });

  test('carry stacks current payment on top of interest', () => {
    const bp = computeBuildPhase({ ...buildState(), currentPayment: '2100' });
    assert.equal(bp.currentPayment, 2100);
    assert.ok(Math.abs(bp.peak.carry - (2100 + bp.peak.interest)) < 0.001);
  });

  test('carry is interest-only without a current payment', () => {
    const bp = computeBuildPhase(buildState());
    assert.equal(bp.peak.carry, bp.peak.interest);
  });
});

describe('fmtInput / parseInput', () => {
  test('fmtInput adds commas', () => assert.equal(fmtInput('500000'), '500,000'));
  test('fmtInput 1M', () => assert.equal(fmtInput('1000000'), '1,000,000'));
  test('fmtInput already formatted', () => assert.equal(fmtInput('500,000'), '500,000'));
  test('fmtInput empty string', () => assert.equal(fmtInput(''), ''));
  test('parseInput strips commas', () => assert.equal(parseInput('500,000'), '500000'));
  test('parseInput raw passthrough', () => assert.equal(parseInput('500000'), '500000'));
  test('parseInput empty string', () => assert.equal(parseInput(''), ''));
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

describe('renderBuildPhase (DOM)', () => {
  beforeEach(makeDOM);

  test('prompts when not ready', () => {
    __setState(baseState({ interestRate: '6', buildMonths: '12' }));
    renderBuildPhase();
    assert.ok(document.getElementById('buildPhaseArea').innerHTML.includes('Enter a build cost'));
  });

  test('renders one chart bar per month', () => {
    __setState(baseState({ buildCost: '500000', interestRate: '6', buildMonths: '18' }));
    renderBuildPhase();
    assert.equal(document.querySelectorAll('.bc-col').length, 18);
  });

  test('headlines the peak monthly carry', () => {
    __setState(baseState({ buildCost: '500000', interestRate: '6', buildMonths: '12' }));
    renderBuildPhase();
    const html = document.getElementById('buildPhaseArea').innerHTML;
    // Peak = 500k fully drawn at 7% (assumed) / 12 ≈ $2,917
    assert.ok(html.includes('$2,917'));
    assert.ok(html.includes('/mo at peak'));
  });

  test('legend and base bars only appear with a current payment', () => {
    __setState(baseState({ buildCost: '500000', interestRate: '6', buildMonths: '12' }));
    renderBuildPhase();
    assert.equal(document.querySelectorAll('.bc-base').length, 0);
    assert.equal(document.querySelectorAll('.bc-legend').length, 0);

    __setState({ ...baseState({ buildCost: '500000', interestRate: '6', buildMonths: '12' }), currentPayment: '2100' });
    renderBuildPhase();
    assert.equal(document.querySelectorAll('.bc-base').length, 12);
    assert.equal(document.querySelectorAll('.bc-legend').length, 1);
  });

  test('no-op when the build phase container is absent', () => {
    document.getElementById('buildPhaseArea').remove();
    __setState(baseState({ buildCost: '500000', interestRate: '6', buildMonths: '12' }));
    assert.doesNotThrow(() => renderBuildPhase());
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
