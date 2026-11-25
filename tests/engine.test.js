'use strict';

// Load app.js cleanly in both GJS and Node.js without a browser DOM
(function loadEngine() {
  let code = '';
  if (typeof require === 'function') {
    const fs = require('fs');
    const path = require('path');
    code = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  } else if (typeof imports !== 'undefined' && imports.gi && imports.gi.Gio) {
    const Gio = imports.gi.Gio;
    const ByteArray = imports.byteArray;
    const candidates = ['app.js', '../app.js'];
    let loaded = false;
    for (const p of candidates) {
      const f = Gio.File.new_for_path(p);
      if (f.query_exists(null)) {
        const [, bytes] = f.load_contents(null);
        code = ByteArray.toString(bytes);
        loaded = true;
        break;
      }
    }
    if (!loaded) throw new Error('Could not locate app.js');
  } else {
    throw new Error('Unsupported JS runtime');
  }
  const fn = new Function(code);
  fn();
})();

const E = globalThis.__rentVBuyEngine;
if (!E) throw new Error('Engine failed to export __rentVBuyEngine');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (!cond) {
    failed++;
    throw new Error('Assertion failed: ' + msg);
  }
  passed++;
}

function assertEq(actual, expected, msg) {
  if (actual !== expected) {
    failed++;
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
  passed++;
}

function assertClose(actual, expected, tol, msg) {
  if (Math.abs(actual - expected) > tol) {
    failed++;
    throw new Error(`${msg}: expected ${expected} ± ${tol}, got ${actual}`);
  }
  passed++;
}

function baseInputs(overrides = {}) {
  return {
    years: 10,
    taxRateMethod: 'income',
    grossSalary: 110000,
    salaryGrowth: true,
    taxRate: 0.32,
    firstHomeBuyer: false,
    state: 'NSW',

    totalSavings: 200000,
    surplusDestination: 'offset',
    propertyPrice: 800000,
    deposit: 160000,
    lmiAmount: 0,
    financeLMI: true,
    fhogAmount: 0,
    propertyGrowth: 0.04,
    stampDuty: 32000,
    financeStampDuty: false,
    legalFeesBuy: 2000,
    legalFeesSell: 2000,
    agentFeeRate: 0.02,

    mortgageRate: 0.06,
    loanTerm: 30,
    interestOnly: false,

    maintenanceRate: 0.01,
    councilRates: 2500,
    bodyCorp: 1000,
    bodyCorpGrowth: 0.045,
    ownerInsurance: 1800,

    weeklyRent: 650,
    rentGrowth: 0.035,
    renterInsurance: 500,
    bondWeeks: 4,

    investReturn: 0.075,
    dividendYield: 0.03,
    frankingLevel: 0.70,
    etfSellFeeRate: 0.001,

    isInvestmentProperty: false,
    rentalIncome: 600,
    vacancyWeeks: 2,
    propertyManagementRate: 0.07,
    landTax: 0,
    depreciationDeduction: 0,
    allowNegativeGearing: false,

    cgtMethod: 'fy27',
    isPensioner: false,
    cgtDiscount: 0.5,
    mainResidence: true,
    inflation: 0.03,
    retVol: 0.10,
    npvDiscountRate: 0.03,
    ...overrides,
  };
}

// 1. Formatting helpers
assertEq(E.fmt(5000), '$5,000', 'fmt positive');
assertEq(E.fmt(-5000), '-$5,000', 'fmt negative places minus before dollar sign');
assertEq(E.fmt(-0.1), '$0', 'fmt -0 avoids -$0');
assertEq(E.fmt(null), '—', 'fmt null');
assertEq(E.fmtK(-1250000), '-$1.25M', 'fmtK negative millions');
assertEq(E.fmtK(-100), '$0K', 'fmtK tiny negative avoids -$0K');
assertEq(E.fmtAxis(-50000), '-$50K', 'fmtAxis negative thousands');
assertEq(E.fmtAxis(-1500000), '-$1.5M', 'fmtAxis negative millions');

// 2. ATO Tax & Progressive CGT stacking
assertEq(E.incomeTax(18200), 0, 'tax-free threshold');
assertClose(E.marginalTaxRate(110000), 0.32, 1e-12, 'marginal rate 110k');
assertClose(E.marginalTaxRate(200000), 0.47, 1e-12, 'marginal rate 200k');
assertClose(E.totalIncomeTax(45000), 4288 + (45000 - 18200) * 0.02, 1, 'totalIncomeTax at 45k');
// Stacking 100k gain onto 110k salary crosses 135k & 190k brackets -> > 32% flat rate
const stackedTax = E.computeIncrementalTax(110000, 100000, 'income', 0.32, 0);
assert(stackedTax > 100000 * 0.32, 'progressive bracket stacking pushes gain above base marginal rate');
assertClose(
  E.computeIncrementalTax(40000, 5000, 'income', 0.18, 0.30),
  5000 * 0.30,
  0.01,
  'FY27 30% minimum floor applies to non-pensioner'
);
assert(
  E.computeIncrementalTax(40000, 5000, 'income', 0.18, 0) < 5000 * 0.30,
  'pensioner exemption avoids 30% floor'
);

// 3. Stamp Duty across all 8 states & FHB rules
assertClose(E.estimateStampDuty(200000, false, 'NT'), 5600, 100, 'NT 200k stamp duty');
assertClose(E.estimateStampDuty(500000, false, 'NT'), 23900, 100, 'NT 500k stamp duty');
assertClose(E.estimateStampDuty(525000, false, 'NT'), 26000, 100, 'NT 525k stamp duty continuity');
assertClose(E.estimateStampDuty(2000000, false, 'VIC', false), 110000, 100, 'VIC 2M flat 5.5%');
assert(
  E.estimateStampDuty(400000, false, 'VIC', false) < E.estimateStampDuty(400000, false, 'VIC', true),
  'VIC PPR concession lowers duty vs investment'
);
assert(
  E.estimateStampDuty(500000, false, 'QLD', false) < E.estimateStampDuty(500000, false, 'QLD', true),
  'QLD Home concession lowers duty vs investment'
);
assertEq(E.estimateStampDuty(500000, true, 'WA', false), 0, 'WA FHB <= 500k exempt');
assert(E.estimateStampDuty(600000, true, 'SA', false) > 0, 'SA established home pays duty even for FHB');
assert(E.estimateStampDuty(700000, true, 'NSW', true) > 0, 'Investment property disables FHB exemption');
assertEq(E.estimateStampDuty(700000, true, 'NSW', false), 0, 'NSW PPOR FHB <= 800k exempt');
assertEq(E.estimateStampDuty(800000, true, 'ACT', false), 0, 'ACT PPOR FHB <= 1M exempt');
assert(E.estimateStampDuty(600000, true, 'TAS', false) === 0, 'TAS PPOR FHB <= 600k exempt');

// 4. Upfront & LMI consistency (including $800k price / $160k savings case)
const tightUpfront = E.computeUpfrontAndLoan(baseInputs({ totalSavings: 160000, deposit: 160000, stampDuty: 32000, legalFeesBuy: 2000 }));
assertEq(tightUpfront.actualDeposit, 126000, 'deposit clamped to savings minus upfront cash');
assertEq(tightUpfront.loanAmount, 674000, 'loan reflects clamped deposit');
assert(tightUpfront.lvr > 80, 'LVR exceeds 80% when upfront costs eat into deposit');
assert(E.estimateLMI(tightUpfront.loanAmount, 800000) > 0, 'auto LMI is non-zero when LVR > 80%');

// 5. PPOR Day-1 Parity, Bond Refund (nominal, not inflated), and Surplus Destination
const pporRes = E.project(baseInputs({ years: 10, rentGrowth: 0.08 }));
assertClose(pporRes.year0RentNet, 200000, 0.01, 'Day-1 renter net equals totalSavings (ETF + bond)');
assertClose(pporRes.bond, 650 * 4, 0.01, 'Bond is nominal 4 weeks rent, not compounded by rentGrowth');
assertClose(pporRes.renterInitial + pporRes.bond, 200000, 0.01, 'Renter initial ETF + bond = totalSavings');

// Buyer surplus destination = 'etf' vs 'offset' on ongoing gap < 0
const cheapBuyCommon = {
  years: 5,
  propertyPrice: 500000,
  deposit: 100000,
  totalSavings: 150000,
  weeklyRent: 1400, // high rent so gap < 0 every year
  mortgageRate: 0.05,
  investReturn: 0.09,
  stampDuty: 15000,
};
const resOffset = E.project(baseInputs({ ...cheapBuyCommon, surplusDestination: 'offset' }));
const resEtf = E.project(baseInputs({ ...cheapBuyCommon, surplusDestination: 'etf' }));
assert(resOffset.finalOffsetBalance > resEtf.finalOffsetBalance, 'offset mode accumulates ongoing surplus in offset');
assert(resEtf.finalBuyerEtf > resOffset.finalBuyerEtf, 'etf mode routes ongoing gap < 0 surplus to buyer ETF');

// Sustained break-even check
const beRes = E.project(baseInputs({ years: 20, propertyGrowth: 0.07, investReturn: 0.05, weeklyRent: 900 }));
assert(beRes.breakevenYear != null, 'sustained breakeven reached in buy-favoring scenario');
assert(
  beRes.rows[beRes.breakevenYear - 1].buyNet >= beRes.rows[beRes.breakevenYear - 1].rentNet,
  'at breakevenYear, net Buy liquidation wealth >= net Rent liquidation wealth'
);
assert(beRes.buyNet >= beRes.rentNet, 'final buyNet >= rentNet when breakevenYear is set');

// 6. Investment Property Mode fixes
const ipBase = baseInputs({
  isInvestmentProperty: true,
  mainResidence: false,
  allowNegativeGearing: true,
  rentalIncome: 650,
  vacancyWeeks: 0,
  propertyManagementRate: 0.07, // 7%
  depreciationDeduction: 5000,
  taxRateMethod: 'flat',
  taxRate: 0.40,
  years: 10,
});
const ipRes = E.project(ipBase);
const ipRow1 = ipRes.rows[0];
// Property management fee should be 7% of 650*52 = 33800 * 0.93 = 31434
assertClose(ipRow1.annualRentalIncome, 650 * 52 * 0.93, 1, 'propertyManagementRate applied once as 7%');
// Deductible expense uses interestPaid (not principal) + carrying costs + flat depreciation
const expectedTaxLoss = (ipRow1.interestPaid + ipRow1.maint + ipRow1.rates + ipRow1.ownerIns + ipRow1.landTax + 5000) - ipRow1.annualRentalIncome;
assertClose(ipRow1.negGearingBenefit, expectedTaxLoss * 0.40, 1, 'negative gearing deducts interestPaid (not principal) + flat depreciation');
// Rentvestor gap === ownerCarry (not ownerCarry - renterCarry)
assertClose(ipRow1.gap, ipRow1.ownerCarry, 0.01, 'investment property mode sets gap = ownerCarry');
// Property CGT deducted when !mainResidence
assert(ipRes.propertyCgt > 0, 'property CGT is deducted when mainResidence is false');
const ipExemptRes = E.project({ ...ipBase, mainResidence: true });
assertEq(ipExemptRes.propertyCgt, 0, 'property CGT is 0 when mainResidence is true');
assert(ipExemptRes.buyNet > ipRes.buyNet, 'taxable IP sale produces lower buyNet than CGT-exempt');

// Year-2 depreciation should remain flat (not inflated)
const ipRow2 = ipRes.rows[1];
const expectedLoss2 = (ipRow2.interestPaid + ipRow2.maint + ipRow2.rates + ipRow2.ownerIns + ipRow2.landTax + 5000) - ipRow2.annualRentalIncome;
assertClose(ipRow2.negGearingBenefit, expectedLoss2 * 0.40, 1, 'depreciation stays flat in year 2');

// 7. CGT methods (FY27 vs Legacy, short-term discount exclusion, brokerage deduction)
const cgtInpLegacy1Yr = baseInputs({ years: 1, cgtMethod: 'legacy', cgtDiscount: 0.5, taxRateMethod: 'flat', taxRate: 0.30, investReturn: 0.20, dividendYield: 0 });
const cgt1YrRes = E.project(cgtInpLegacy1Yr);
assert(cgt1YrRes.cgt > 0, '1-year legacy gain is taxed');
// Check no 50% discount at year 1: gain ~ 20% of ~197400 - 0.1% sell fee
const grossPort1 = cgt1YrRes.finalPortfolio;
const netProceeds1 = grossPort1 - cgt1YrRes.etfSellFee;
assertClose(cgt1YrRes.cgt, (netProceeds1 - cgt1YrRes.portfolioBasis) * 0.30, 1, 'legacy 1-year holding gets no 50% CGT discount and deducts brokerage');

// 8. Monte Carlo imperfect correlation & cone ordering
const mc = E.runMonteCarlo(baseInputs({ years: 10, retVol: 0.12 }), 100);
assert(mc !== null, 'Monte Carlo returns result when retVol > 0');
assert(mc.buySuccess >= 0 && mc.buySuccess <= 1, 'buySuccess in [0, 1]');
assertClose(mc.rho, 0.25, 1e-9, 'Monte Carlo uses imperfect correlation rho=0.25');
for (let y = 0; y <= 10; y++) {
  assert(mc.buyP10[y] <= mc.buyP90[y] + 1e-6, `buyP10 <= buyP90 at yr ${y}`);
  assert(mc.rentP10[y] <= mc.rentP90[y] + 1e-6, `rentP10 <= rentP90 at yr ${y}`);
}

// 9. Break-even solver convergence
const defInp = baseInputs();
const beRent = E.solveBreakeven(
  x => {
    const r = E.project({ ...defInp, weeklyRent: x }, { light: true });
    return r.npvRent - r.npvBuy;
  },
  0,
  defInp.weeklyRent * 5
);
assert(beRent !== null && beRent > 0, 'break-even weekly rent converges');
const checkBe = E.project({ ...defInp, weeklyRent: beRent }, { light: true });
assertClose(checkBe.npvRent, checkBe.npvBuy, 50, 'break-even rent equalises NPV Buy and NPV Rent');

print(`ALL TESTS PASSED: ${passed} assertions passed, ${failed} failed.`);
