'use strict';

// ══════════════════════════════════════════════════════════
//  RENT vs BUY ENGINE
//  Nominal-dollar year-by-year simulation:
//  - Standard P&I (or interest-only) mortgage amortisation
//  - Owner carrying costs: maintenance, rates/body corp, insurance
//  - Renter invests the deposit (+ duty/legal if not financed) and
//    the annual cash-flow gap between owning and renting (an ETF portfolio)
//  - ETF distributions taxed annually (with franking credit top-up);
//    price growth taxed as CGT (50% discount) only at exit
//  - Optional investment-property treatment (negative gearing)
// ══════════════════════════════════════════════════════════

const AGENT_RATE_DEFAULT = 0.02;

// ATO FY 2025-26 resident individual income tax brackets (excl. Medicare Levy).
const TAX_BRACKETS_2526 = [
  { upTo: 18200, rate: 0, base: 0 },
  { upTo: 45000, rate: 0.16, base: 0 },
  { upTo: 135000, rate: 0.30, base: 4288 },
  { upTo: 190000, rate: 0.37, base: 31288 },
  { upTo: Infinity, rate: 0.45, base: 51638 },
];
const MEDICARE_LEVY_RATE = 0.02;

function incomeTax(income) {
  if (income <= 0) return 0;
  for (let i = 0; i < TAX_BRACKETS_2526.length; i++) {
    const b = TAX_BRACKETS_2526[i];
    if (income <= b.upTo) {
      const prevCap = i === 0 ? 0 : TAX_BRACKETS_2526[i - 1].upTo;
      return b.base + (income - prevCap) * b.rate;
    }
  }
  return 0;
}

// Effective marginal tax rate (income tax bracket rate + 2% Medicare Levy) at a
// given income level — this is what applies to the NEXT dollar earned, which is
// the right rate for taxing investment income/gains stacked on top of salary.
function marginalTaxRate(income) {
  if (income <= 18200) return 0;
  for (const b of TAX_BRACKETS_2526) {
    if (income <= b.upTo) return b.rate + MEDICARE_LEVY_RATE;
  }
  return TAX_BRACKETS_2526[TAX_BRACKETS_2526.length - 1].rate + MEDICARE_LEVY_RATE;
}

// Rough general (non-FHB) transfer duty bands by state/territory, for the
// "Auto-estimate" button only — always confirm with your state revenue office.
// Each band function returns duty for an owner-occupier at the given price.
const STAMP_DUTY_BANDS = {
  NSW: price => price <= 17000 ? price * 0.0125
    : price <= 36000 ? 212 + (price - 17000) * 0.015
    : price <= 97000 ? 497 + (price - 36000) * 0.0175
    : price <= 364000 ? 1564 + (price - 97000) * 0.035
    : price <= 1212000 ? 10909 + (price - 364000) * 0.045
    : 49069 + (price - 1212000) * 0.055,
  VIC: price => price <= 25000 ? price * 0.014
    : price <= 130000 ? 350 + (price - 25000) * 0.024
    : price <= 960000 ? 2870 + (price - 130000) * 0.06
    : price <= 2000000 ? 52670 + (price - 960000) * 0.065
    : price * 0.065,
  QLD: price => price <= 5000 ? 0
    : price <= 75000 ? (price - 5000) * 0.015
    : price <= 540000 ? 1050 + (price - 75000) * 0.035
    : price <= 1000000 ? 17325 + (price - 540000) * 0.045
    : 38025 + (price - 1000000) * 0.0575,
  WA: price => price <= 120000 ? price * 0.019
    : price <= 150000 ? 2280 + (price - 120000) * 0.0285
    : price <= 360000 ? 3135 + (price - 150000) * 0.038
    : price <= 725000 ? 11115 + (price - 360000) * 0.0475
    : 28453 + (price - 725000) * 0.0515,
  SA: price => price <= 12000 ? price * 0.01
    : price <= 30000 ? 120 + (price - 12000) * 0.02
    : price <= 50000 ? 480 + (price - 30000) * 0.03
    : price <= 100000 ? 1080 + (price - 50000) * 0.035
    : price <= 200000 ? 2830 + (price - 100000) * 0.04
    : price <= 250000 ? 6830 + (price - 200000) * 0.0425
    : price <= 300000 ? 8955 + (price - 250000) * 0.0475
    : price <= 500000 ? 11330 + (price - 300000) * 0.05
    : 21330 + (price - 500000) * 0.055,
  TAS: price => price <= 3000 ? 50
    : price <= 25000 ? 50 + (price - 3000) * 0.0175
    : price <= 75000 ? 435 + (price - 25000) * 0.0225
    : price <= 200000 ? 1560 + (price - 75000) * 0.035
    : price <= 375000 ? 5935 + (price - 200000) * 0.04
    : price <= 725000 ? 12935 + (price - 375000) * 0.0425
    : 27810 + (price - 725000) * 0.045,
  ACT: price => price <= 260000 ? price * 0.012
    : price <= 300000 ? 3120 + (price - 260000) * 0.022
    : price <= 500000 ? 4000 + (price - 300000) * 0.034
    : price <= 750000 ? 10800 + (price - 500000) * 0.0432
    : price <= 1000000 ? 21600 + (price - 750000) * 0.059
    : price <= 1455000 ? 36350 + (price - 1000000) * 0.064
    : price * 0.0454,
  NT: price => price <= 525000 ? price * (0.06571441 - 15294.68 / price)
    : price <= 3000000 ? price * 0.0495
    : price * 0.0575,
};

// First-home-buyer concessions vary widely and change often; approximate a
// full exemption under a state-typical threshold, tapering to nothing by an
// upper threshold, for the auto-estimate only.
const FHB_THRESHOLDS = {
  NSW: [800000, 1000000], VIC: [600000, 750000], QLD: [500000, 550000],
  WA: [430000, 530000], SA: [0, 0], TAS: [600000, 750000],
  ACT: [1000000, 1455000], NT: [0, 0],
};

function estimateStampDuty(price, firstHomeBuyer, state) {
  const bandFn = STAMP_DUTY_BANDS[state] || STAMP_DUTY_BANDS.NSW;
  let duty = bandFn(Math.max(0, price));

  if (firstHomeBuyer) {
    const [full, taper] = FHB_THRESHOLDS[state] || FHB_THRESHOLDS.NSW;
    if (full > 0) {
      if (price <= full) duty = 0;
      else if (price < taper) duty *= (price - full) / (taper - full);
    }
  }

  return Math.round(Math.max(0, duty) / 100) * 100;
}

// Very rough LMI premium bands as a % of the loan amount, keyed by LVR — actual
// premiums vary significantly by lender/insurer and loan size. No LMI below 80% LVR.
function estimateLMI(loanAmount, propertyPrice) {
  if (propertyPrice <= 0 || loanAmount <= 0) return 0;
  const lvr = loanAmount / propertyPrice * 100;
  let rate;
  if (lvr <= 80) rate = 0;
  else if (lvr <= 85) rate = 0.008;
  else if (lvr <= 90) rate = 0.015;
  else if (lvr <= 95) rate = 0.025;
  else rate = 0.035;
  return Math.round(loanAmount * rate / 100) * 100;
}

// Annual P&I (or IO) repayment on a nominal mortgage balance.
function annualMortgageRepayment(principal, annualRate, termYears, interestOnly) {
  if (principal <= 0 || termYears <= 0) return 0;
  if (interestOnly) return principal * annualRate;
  if (annualRate <= 0) return principal / termYears;
  const r = annualRate / 12;
  const n = termYears * 12;
  const monthly = principal * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
  return monthly * 12;
}

// Grows an ETF-style balance by one year: annual distributions taxed (with franking
// credit top-up), reinvested net of tax (raising cost basis so CGT isn't double-charged
// later), then the remaining price-growth component compounds tax-free until exit.
// Mutates `lots` (an array of {year, amount}) so the caller can index the cost base later.
function growEtfYear(balance, year, opts) {
  const { dividendYield, frankedFraction, taxRate, companyTaxRate, priceGrowthRate, lots } = opts;
  const div = Math.max(0, balance) * dividendYield;
  const frankedDiv = div * frankedFraction;
  const unfrankedDiv = div - frankedDiv;
  const frankTopup = taxRate > companyTaxRate ? (taxRate - companyTaxRate) * frankedDiv : 0;
  const unfrankedTax = taxRate * unfrankedDiv;
  const divTax = frankTopup + unfrankedTax;
  const netDiv = div - divTax;

  let newBalance = balance + netDiv;
  let basisDelta = netDiv;
  if (netDiv > 0 && lots) lots.push({ year, amount: netDiv });

  newBalance *= (1 + priceGrowthRate);
  newBalance = Math.max(0, newBalance);
  return { balance: newBalance, basisDelta, divTax };
}

// Advance the mortgage by one year (12 monthly compounding steps) at a fixed
// nominal annual payment. Returns the new balance and the interest/principal split.
// An offset balance reduces the interest-bearing amount (never below zero) but the
// scheduled repayment and principal reduction are unaffected — exactly how a real
// 100%-offset account works: interest is only charged on (balance - offset).
function amortizeYear(balance, annualRate, annualPayment, interestOnly, offsetBalance = 0) {
  if (balance <= 0) return { balance: 0, interest: 0, principal: 0 };
  const mRate = annualRate / 12;
  const mPay  = annualPayment / 12;
  let interest = 0, principal = 0;
  for (let i = 0; i < 12; i++) {
    if (balance <= 0) break;
    const interestBearing = Math.max(0, balance - offsetBalance);
    const iPaid = interestBearing * mRate;
    let pPaid = interestOnly ? 0 : (mPay - iPaid);
    if (pPaid > balance) pPaid = balance;
    if (pPaid < 0) pPaid = 0;
    balance -= pPaid;
    interest += iPaid;
    principal += pPaid;
  }
  return { balance: Math.max(0, balance), interest, principal };
}

// ══════════════════════════════════════════════════════════
//  YEAR-BY-YEAR PROJECTION
// ══════════════════════════════════════════════════════════

function project(inp, opts = {}) {
  const {
    years, propertyPrice, deposit, totalSavings, surplusDestination = 'offset',
    propertyGrowth, stampDuty, financeStampDuty,
    legalFeesBuy, legalFeesSell, agentFeeRate,
    lmiAmount = 0, financeLMI = true, fhogAmount = 0,
    mortgageRate, loanTerm, interestOnly,
    maintenanceRate, councilRates, bodyCorp = 0, bodyCorpGrowth = 0, ownerInsurance,
    weeklyRent, rentGrowth, renterInsurance, bondWeeks,
    investReturn, dividendYield, frankingLevel, taxRate, etfSellFeeRate = 0,
    taxRateMethod = 'flat', grossSalary = 0, salaryGrowth = true,
    isInvestmentProperty, rentalIncome, allowNegativeGearing,
    vacancyWeeks = 0, propertyManagementRate = 0, landTax = 0, depreciationDeduction = 0,
    cgtDiscount, mainResidence, inflation,
    cgtMethod = 'legacy', isPensioner = false,
  } = inp;

  const light = !!opts.light;
  const vol   = opts.vol || 0;
  const shock = opts.shock || null;

  const companyTaxRate = 0.30;
  const frankedFraction = frankingLevel;

  // The deposit is drawn from Total Savings; it can never exceed what's available.
  const actualDeposit = Math.max(0, Math.min(deposit, totalSavings));
  const loanAmount = Math.max(0, propertyPrice - actualDeposit + (financeStampDuty ? stampDuty : 0) + (financeLMI ? lmiAmount : 0));
  const annualRepayment = annualMortgageRepayment(loanAmount, mortgageRate, loanTerm, interestOnly);

  // Buyer's day-1 cash outlay beyond the deposit: duty/legal/LMI if not financed, less FHOG.
  const buyerUpfrontCash = Math.max(0, (financeStampDuty ? 0 : stampDuty) + legalFeesBuy
    + (financeLMI ? 0 : lmiAmount) - fhogAmount);

  // Whatever's left of Total Savings after the deposit and upfront cash costs is the
  // buyer's "surplus" — parked in a mortgage offset (tax-free, guaranteed at the
  // mortgage rate) or invested in ETFs (taxed, market-dependent), per the user's choice.
  const buyerSurplus = Math.max(0, totalSavings - actualDeposit - buyerUpfrontCash);
  let offsetBalance = surplusDestination === 'offset' ? buyerSurplus : 0;
  let buyerEtf = surplusDestination === 'etf' ? buyerSurplus : 0;
  let buyerEtfBasis = buyerEtf;
  const buyerEtfLots = buyerEtf > 0 ? [{ year: 0, amount: buyerEtf }] : [];

  // The renter invests the full Total Savings from day one — nothing is held back
  // for a deposit, since there's no property to buy.
  const renterInitial = Math.max(0, totalSavings);

  let propertyValue = propertyPrice;
  let mortgageBalance = loanAmount;
  let portfolio = renterInitial;
  let portfolioBasis = renterInitial;
  // FY27 cost-base indexation tracks each year's basis contribution separately
  // so it can be CPI-indexed from its own contribution year to the exit year.
  const basisLots = renterInitial > 0 ? [{ year: 0, amount: renterInitial }] : [];

  const rows = [];
  let breakevenYear = null;
  let finalTaxRate = taxRate;

  for (let year = 1; year <= years; year++) {
    const z = shock ? shock(year - 1) : 0;
    const propGrowthY = propertyGrowth + vol * z * 0.5; // property less volatile than equities
    const investReturnY = investReturn + vol * z;

    // Marginal rate for this year: either a flat user-set rate, or derived from the ATO
    // FY2025-26 brackets applied to salary (optionally grown with inflation), so bracket
    // creep/relief is reflected in the rate used for dividend tax, negative gearing and CGT.
    const salaryY = salaryGrowth ? grossSalary * Math.pow(1 + inflation, year - 1) : grossSalary;
    const taxRateY = taxRateMethod === 'income' ? marginalTaxRate(salaryY) : taxRate;
    finalTaxRate = taxRateY;

    propertyValue *= (1 + propGrowthY);

    const maint = propertyValue * maintenanceRate;
    const rates = councilRates * Math.pow(1 + inflation, year - 1)
      + bodyCorp * Math.pow(1 + bodyCorpGrowth, year - 1);
    const ownerIns = ownerInsurance * Math.pow(1 + inflation, year - 1);

    const { balance: newBalance, interest: interestPaid, principal: principalPaid } =
      amortizeYear(mortgageBalance, mortgageRate, annualRepayment, interestOnly, offsetBalance);
    mortgageBalance = newBalance;
    // Offset balance is capped to the outstanding loan (no benefit once the loan is paid off);
    // any amount above that effectively becomes free cash, folded into the buyer's ETF side-pot.
    if (offsetBalance > mortgageBalance) {
      const excess = offsetBalance - mortgageBalance;
      offsetBalance = mortgageBalance;
      buyerEtf += excess;
      buyerEtfBasis += excess;
      buyerEtfLots.push({ year, amount: excess });
    }

    const annualRent = (weeklyRent * 52) * Math.pow(1 + rentGrowth, year - 1);
    const renterIns = renterInsurance * Math.pow(1 + inflation, year - 1);

    // Land tax only applies to investment properties, not a main residence.
    const landTaxY = isInvestmentProperty ? landTax * Math.pow(1 + inflation, year - 1) : 0;

    // Investment-property treatment: rental income (net of vacancy & management
    // fees) offsets owner carrying costs; depreciation is a non-cash deduction
    // that reduces taxable loss without affecting actual cash flow; a net loss
    // can be negatively geared against other income if enabled.
    let annualRentalIncome = 0, negGearingBenefit = 0;
    if (isInvestmentProperty) {
      const grossRentalIncome = (rentalIncome * 52) * Math.pow(1 + rentGrowth, year - 1);
      const occupancyFactor = Math.max(0, 1 - vacancyWeeks / 52);
      const managementFee = grossRentalIncome * occupancyFactor * (propertyManagementRate / 100);
      annualRentalIncome = grossRentalIncome * occupancyFactor - managementFee;

      const depreciationY = depreciationDeduction * Math.pow(1 + inflation, year - 1);
      const cashLoss = annualRepayment + maint + rates + ownerIns + landTaxY - annualRentalIncome;
      const taxableLoss = cashLoss + depreciationY; // depreciation adds to the deductible loss but isn't a cash cost
      if (allowNegativeGearing && taxableLoss > 0) negGearingBenefit = taxableLoss * taxRateY;
      else if (!allowNegativeGearing && taxableLoss > 0) {
        // FY27 rule: net rental losses on established residential property (bought after
        // 12 May 2026) can only offset rental/property income or capital gains, not salary.
        // With a single-property model there's no other rental/property income to offset
        // against here, so the loss simply isn't deductible this year (no benefit, no penalty);
        // it is not modelled as carried forward against a future property capital gain.
      } else if (taxableLoss < 0) {
        // Positive geared: rental profit is taxable income
        negGearingBenefit = taxableLoss * taxRateY; // negative value = extra tax owed
      }
    }

    const ownerCarry = annualRepayment + maint + rates + ownerIns + landTaxY - annualRentalIncome - negGearingBenefit;
    const renterCarry = annualRent + renterIns;
    const gap = ownerCarry - renterCarry;

    // If owning costs LESS than renting this year, the buyer has leftover cash flow —
    // exactly like the renter's surplus, it tops up the offset first (up to the
    // outstanding loan), then spills to ETF. If owning costs MORE (the more common
    // case, e.g. mortgage > rent), that's just an ordinary higher cost of living paid
    // out of income — same as a renter facing a rent rise — and does NOT drain the
    // buyer's offset/ETF pot. Draining it there would double-count the cost, since the
    // higher carrying cost is already fully reflected in the mortgage amortisation and
    // is the entire reason `ownerCarry` is used to compute this year's `gap` at all.
    if (gap < 0) {
      let surplusY = -gap;
      const offsetRoom = Math.max(0, mortgageBalance - offsetBalance);
      const toOffset = Math.min(surplusY, offsetRoom);
      offsetBalance += toOffset;
      surplusY -= toOffset;
      if (surplusY > 0) {
        buyerEtf += surplusY;
        buyerEtfBasis += surplusY;
        buyerEtfLots.push({ year, amount: surplusY });
      }
    }

    portfolio += gap;
    if (gap > 0) { portfolioBasis += gap; basisLots.push({ year, amount: gap }); }
    if (portfolio < 0) {
      // Can't go into debt on paper — consume basis lots oldest-first as the shortfall is drawn down.
      let shortfall = -portfolio;
      portfolioBasis = Math.max(0, portfolioBasis - shortfall);
      while (shortfall > 0 && basisLots.length) {
        const lot = basisLots[0];
        const consumed = Math.min(lot.amount, shortfall);
        lot.amount -= consumed;
        shortfall -= consumed;
        if (lot.amount <= 0) basisLots.shift();
      }
      portfolio = 0;
    }

    const priceGrowthRate = Math.max(investReturnY - dividendYield, -0.99);
    const etfOpts = { dividendYield, frankedFraction, taxRate: taxRateY, companyTaxRate, priceGrowthRate };

    const rGrown = growEtfYear(portfolio, year, { ...etfOpts, lots: basisLots });
    portfolio = rGrown.balance;
    portfolioBasis += rGrown.basisDelta; // already taxed as income this year — raise cost basis so CGT isn't double-charged at exit
    const divTax = rGrown.divTax;

    if (buyerEtf > 0) {
      const bGrown = growEtfYear(buyerEtf, year, { ...etfOpts, lots: buyerEtfLots });
      buyerEtf = bGrown.balance;
      buyerEtfBasis += bGrown.basisDelta;
    }

    const equity = propertyValue - mortgageBalance + offsetBalance + buyerEtf;

    if (!light) {
      rows.push({
        year, propertyValue, mortgageBalance, equity,
        annualRepayment, maint, rates, ownerIns, landTax: landTaxY, ownerCarry,
        annualRent, renterIns, renterCarry, gap,
        interestPaid, principalPaid,
        portfolio, divTax,
        annualRentalIncome, negGearingBenefit,
        offsetBalance, buyerEtf,
      });

      if (breakevenYear == null && equity >= portfolio) breakevenYear = year;
    }
  }

  // Computes exit CGT on an ETF-style balance under the chosen method.
  const computeCgt = (balance, basis, lots) => {
    if (cgtMethod === 'fy27') {
      // Treasury Laws Amendment (Tax Reform No. 1) Bill 2026, effective 1 Jul 2027:
      // 50% discount replaced by CPI indexation of each contribution's cost base,
      // taxing only the real gain, at a 30% minimum rate (pensioners exempt from the floor).
      const indexedBasis = lots.reduce((sum, lot) => sum + lot.amount * Math.pow(1 + inflation, years - lot.year), 0);
      const taxableGain = Math.max(0, balance - indexedBasis);
      const effRate = isPensioner ? finalTaxRate : Math.max(finalTaxRate, 0.30);
      return effRate * taxableGain;
    }
    // Legacy current-law method: flat 50% discount on gains held >12 months.
    const taxableGain = (1 - cgtDiscount) * Math.max(0, balance - basis);
    return finalTaxRate * taxableGain;
  };

  // Exit costs
  const sellingCosts = agentFeeRate * propertyValue + legalFeesSell;
  const bond = (weeklyRent * bondWeeks) * Math.pow(1 + rentGrowth, years - 1);

  const buyerEtfSellFee = buyerEtf * etfSellFeeRate;
  const buyerEtfCgt = buyerEtf > 0 ? computeCgt(buyerEtf, buyerEtfBasis, buyerEtfLots) : 0;
  const buyerEtfNet = buyerEtf - buyerEtfCgt - buyerEtfSellFee;
  // Main residence CGT exemption applies to the property itself (assumed PPOR); the
  // offset balance is just cash (no gain, no tax) and the buyer's surplus ETF sub-pot
  // is taxed exactly like the renter's portfolio since it's the same asset class.
  const buyNet = propertyValue - mortgageBalance - sellingCosts + offsetBalance + buyerEtfNet;

  const etfSellFee = portfolio * etfSellFeeRate;
  const grossGain = portfolio - portfolioBasis;
  const cgt = computeCgt(portfolio, portfolioBasis, basisLots);
  const rentNet = portfolio - cgt - etfSellFee + bond;

  if (light) return { finalPropertyValue: propertyValue, buyNet, rentNet };

  return {
    rows, breakevenYear,
    loanAmount, annualRepayment, renterInitial, actualDeposit, buyerUpfrontCash, buyerSurplus,
    finalPropertyValue: propertyValue, finalMortgageBalance: mortgageBalance,
    finalOffsetBalance: offsetBalance, finalBuyerEtf: buyerEtf, buyerEtfCgt, buyerEtfNet,
    sellingCosts, bond, buyNet,
    finalPortfolio: portfolio, portfolioBasis, grossGain, cgt, etfSellFee, rentNet,
    delta: rentNet - buyNet,
    finalTaxRate,
    npvDiscountRate: inp.npvDiscountRate,
    npvBuy: discountToday(buyNet, inp.npvDiscountRate, years),
    npvRent: discountToday(rentNet, inp.npvDiscountRate, years),
  };
}

// Present value today of a single lump sum received in `years` time, at `rate` p.a.
function discountToday(futureValue, rate, years) {
  if (rate == null) return futureValue;
  return futureValue / Math.pow(1 + rate, years);
}

// ══════════════════════════════════════════════════════════
//  MONTE CARLO (seeded — stable across recalcs)
// ══════════════════════════════════════════════════════════

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function runMonteCarlo(inp, nSims = 400) {
  if (!inp.retVol || inp.retVol <= 0) return null;
  const rand = mulberry32(20260703);
  const years = inp.years;

  const equityPaths = [], portfolioPaths = [];
  let buyWins = 0;

  for (let s = 0; s < nSims; s++) {
    const zs = new Array(years);
    for (let i = 0; i < years; i += 2) {
      const u1 = Math.max(rand(), 1e-9), u2 = rand();
      const m = Math.sqrt(-2 * Math.log(u1));
      zs[i] = m * Math.cos(2 * Math.PI * u2);
      if (i + 1 < years) zs[i + 1] = m * Math.sin(2 * Math.PI * u2);
    }
    const res = project(inp, { light: true, shock: y => zs[y] ?? 0, vol: inp.retVol });
    if (res.buyNet >= res.rentNet) buyWins++;
  }

  return { buySuccess: buyWins / nSims, n: nSims };
}

// ══════════════════════════════════════════════════════════
//  FORMATTING HELPERS
// ══════════════════════════════════════════════════════════

const fmt  = n => n == null ? '—' : '$' + Math.round(n).toLocaleString('en-AU');
const fmtK = n => n == null ? '—' : (Math.abs(n) >= 1e6 ? (n < 0 ? '-' : '') + '$' + (Math.abs(n) / 1e6).toFixed(2) + 'M' : (n < 0 ? '-' : '') + '$' + Math.round(Math.abs(n) / 1000) + 'K');
const pct  = n => (n * 100).toFixed(1) + '%';

// ══════════════════════════════════════════════════════════
//  PERSISTENCE & SHARING
// ══════════════════════════════════════════════════════════

const STORAGE_KEY = 'au-rentvsbuy-calc-v1';

function collectFormValues() {
  const vals = {};
  document.querySelectorAll('.input-panel input[id], .input-panel select[id]').forEach(el => {
    vals[el.id] = el.type === 'checkbox' ? el.checked : el.value;
  });
  return vals;
}

function applyFormValues(vals) {
  Object.entries(vals).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === 'checkbox') {
      el.checked = (val === true || val === 'true' || val === '1');
    } else {
      if (el.type === 'number' || el.type === 'range') {
        const num = parseFloat(val);
        if (!isNaN(num) && el.min !== '' && num < parseFloat(el.min)) val = el.min;
        if (!isNaN(num) && el.max !== '' && num > parseFloat(el.max)) val = el.max;
      }
      el.value = val;
    }
  });
}

function saveState() {
  try {
    const data = JSON.stringify(collectFormValues());
    localStorage.setItem(STORAGE_KEY, data);
    document.cookie = `${STORAGE_KEY}=${encodeURIComponent(data)}; max-age=31536000; path=/; SameSite=Strict`;
  } catch (_) {}
}

function loadState() {
  try {
    let savedStr = null;
    const cookieMatch = document.cookie.match(new RegExp('(^| )' + STORAGE_KEY + '=([^;]+)'));
    if (cookieMatch) savedStr = decodeURIComponent(cookieMatch[2]);
    if (!savedStr) savedStr = localStorage.getItem(STORAGE_KEY);
    const saved = JSON.parse(savedStr);
    if (!saved) return false;
    applyFormValues(saved);
    return true;
  } catch (_) { return false; }
}

function applyUrlParams() {
  const p = new URLSearchParams(location.search);
  if (![...p.keys()].length) return false;
  const vals = {};
  p.forEach((val, id) => { vals[id] = val; });
  applyFormValues(vals);
  return true;
}

function shareLink() {
  const p = new URLSearchParams();
  document.querySelectorAll('.input-panel input[id], .input-panel select[id]').forEach(el => {
    p.set(el.id, el.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value);
  });
  const url = location.origin + location.pathname + '?' + p.toString();
  const btn = document.getElementById('share-btn');
  const done = () => {
    if (!btn) return;
    const orig = btn.textContent;
    btn.textContent = '✓';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(done, () => prompt('Copy this link:', url));
  else prompt('Copy this link:', url);
}

function copyAuditLogs() {
  if (!window._lastAuditLog) return alert('No logs generated yet.');
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(window._lastAuditLog).then(() => {
      alert('✅ Diagnostic audit logs copied to clipboard!');
    }).catch(() => {
      prompt('Your browser blocked clipboard access. Copy the logs here:', window._lastAuditLog);
    });
  } else {
    prompt('Copy the logs here:', window._lastAuditLog);
  }
}

function resetDefaults() {
  if (!confirm('Reset all inputs to defaults?')) return;
  localStorage.removeItem(STORAGE_KEY);
  document.cookie = `${STORAGE_KEY}=; max-age=0; path=/; SameSite=Strict`;
  location.href = location.pathname;
}

// Escapes a value for safe inclusion in a CSV field (quotes if it contains a
// comma, quote or newline; doubles any embedded quotes per RFC 4180).
function csvField(v) {
  const s = v == null ? '' : String(v);
  const needsQuoting = s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1;
  return needsQuoting ? '"' + s.split('"').join('""') + '"' : s;
}
function csvRow(vals) { return vals.map(csvField).join(','); }

// Exports everything the app has computed: inputs, headline/NPV verdict, the
// year-by-year projection, the alternate scenarios, and the break-even report —
// all as sections within one CSV file (CSV has no concept of multiple sheets).
function exportCSV() {
  if (!_lastRows.length || !_lastResult || !_lastInp) return;
  const inp = _lastInp, result = _lastResult, mc = _lastMc;
  const out = [];

  out.push('Australian Rent vs Buy Calculator — Full Export');
  out.push('All dollar values are nominal unless marked "(NPV)" or "today\'s $"');
  out.push('');

  // ── SECTION 1: INPUTS ──
  out.push('=== INPUTS ===');
  out.push(csvRow(['Field', 'Value']));
  Object.entries(inp).forEach(([k, v]) => out.push(csvRow([k, v])));
  out.push('');

  // ── SECTION 2: HEADLINE / NPV SUMMARY ──
  out.push('=== SUMMARY ===');
  out.push(csvRow(['Metric', 'Value']));
  const npvDelta = result.npvRent - result.npvBuy;
  out.push(csvRow(['Analysis horizon (years)', inp.years]));
  out.push(csvRow(['NPV discount rate (= inflation)', pct(inp.npvDiscountRate)]));
  out.push(csvRow(['NPV of Buying (today\'s $)', Math.round(result.npvBuy)]));
  out.push(csvRow(['NPV of Renting (today\'s $)', Math.round(result.npvRent)]));
  out.push(csvRow(['NPV verdict', npvDelta >= 0 ? 'Rent wins' : 'Buy wins']));
  out.push(csvRow(['NPV margin (today\'s $)', Math.round(Math.abs(npvDelta))]));
  out.push(csvRow(['Buy net position at year ' + inp.years + ' (nominal)', Math.round(result.buyNet)]));
  out.push(csvRow(['Rent net position at year ' + inp.years + ' (nominal)', Math.round(result.rentNet)]));
  out.push(csvRow(['Nominal verdict', result.delta >= 0 ? 'Rent wins' : 'Buy wins']));
  out.push(csvRow(['Nominal margin', Math.round(Math.abs(result.delta))]));
  out.push(csvRow(['Break-even year (equity overtakes portfolio)', result.breakevenYear ?? 'Not reached']));
  out.push(csvRow(['Final property value', Math.round(result.finalPropertyValue)]));
  out.push(csvRow(['Final mortgage balance', Math.round(result.finalMortgageBalance)]));
  out.push(csvRow(['Final offset balance', Math.round(result.finalOffsetBalance)]));
  out.push(csvRow(['Final buyer ETF surplus (net of CGT)', Math.round(result.buyerEtfNet)]));
  out.push(csvRow(['Final renter portfolio (pre-CGT)', Math.round(result.finalPortfolio)]));
  out.push(csvRow(['Renter CGT paid at exit', Math.round(result.cgt)]));
  out.push(csvRow(['Marginal tax rate used in final year', pct(result.finalTaxRate)]));
  if (mc) {
    out.push(csvRow(['Monte Carlo simulations', mc.n]));
    out.push(csvRow(['Monte Carlo: % of runs favouring Buy', pct(mc.buySuccess)]));
  }
  out.push('');

  // ── SECTION 3: ALTERNATE SCENARIOS ──
  out.push('=== ALTERNATE SCENARIOS ===');
  out.push(csvRow(['Scenario', 'Adjusted Assumption', 'Buy Net (nominal)', 'Rent Net (nominal)', 'Delta (Rent - Buy)', 'Favours']));
  const scenarios = [
    { title: 'Higher Property Growth', sub: `+1.5% p.a. (${((inp.propertyGrowth + 0.015) * 100).toFixed(1)}%)`, patch: { propertyGrowth: inp.propertyGrowth + 0.015 } },
    { title: 'Lower Property Growth', sub: `-1.5% p.a. (${Math.max(0, (inp.propertyGrowth - 0.015) * 100).toFixed(1)}%)`, patch: { propertyGrowth: inp.propertyGrowth - 0.015 } },
    { title: 'Higher Investment Return', sub: `+2.0% p.a. (${((inp.investReturn + 0.02) * 100).toFixed(1)}%)`, patch: { investReturn: inp.investReturn + 0.02 } },
    { title: 'Higher Interest Rate', sub: `+1.5% p.a. (${((inp.mortgageRate + 0.015) * 100).toFixed(1)}%)`, patch: { mortgageRate: inp.mortgageRate + 0.015 } },
    { title: 'Faster Rent Growth', sub: `+2.0% p.a. (${((inp.rentGrowth + 0.02) * 100).toFixed(1)}%)`, patch: { rentGrowth: inp.rentGrowth + 0.02 } },
    { title: 'Longer Horizon', sub: `${inp.years + 10} years`, patch: { years: inp.years + 10 } },
  ];
  scenarios.forEach(sc => {
    const r = project({ ...inp, ...sc.patch });
    out.push(csvRow([sc.title, sc.sub, Math.round(r.buyNet), Math.round(r.rentNet), Math.round(r.delta), r.delta >= 0 ? 'Rent' : 'Buy']));
  });
  out.push('');

  // ── SECTION 4: BREAK-EVEN REPORT ──
  out.push('=== BREAK-EVEN REPORT (value that makes NPV(Buy) = NPV(Rent)) ===');
  out.push(csvRow(['Lever', 'Current Value', 'Break-even Value', 'Change Needed']));
  const npvDiff = (field, value) => project({ ...inp, [field]: value }).npvRent - project({ ...inp, [field]: value }).npvBuy;
  const beRows = [
    ['Weekly Rent', inp.weeklyRent, solveBreakeven(x => npvDiff('weeklyRent', x), 0, inp.weeklyRent * 5), v => fmt(v)],
    ['Rent Growth Rate', inp.rentGrowth, solveBreakeven(x => npvDiff('rentGrowth', x), -0.05, 0.15), v => pct(v)],
    ['Mortgage Interest Rate', inp.mortgageRate, solveBreakeven(x => npvDiff('mortgageRate', x), 0, 0.20), v => pct(v)],
    ['Property Growth Rate', inp.propertyGrowth, solveBreakeven(x => npvDiff('propertyGrowth', x), -0.10, 0.20), v => pct(v)],
    ['ETF Investment Return', inp.investReturn, solveBreakeven(x => npvDiff('investReturn', Math.max(x, inp.dividendYield)), 0, 0.25), v => pct(v)],
    ['Property Purchase Price', inp.propertyPrice, solveBreakeven(x => npvDiff('propertyPrice', x), inp.propertyPrice * 0.3, inp.propertyPrice * 3), v => fmt(v)],
    ['Council Rates', inp.councilRates, solveBreakeven(x => npvDiff('councilRates', x), 0, inp.councilRates * 6 + 5000), v => fmt(v)],
    ['Maintenance Rate (% of value p.a.)', inp.maintenanceRate, solveBreakeven(x => npvDiff('maintenanceRate', x), 0, 0.10), v => pct(v)],
  ];
  beRows.forEach(([label, current, be, fmtFn]) => {
    out.push(csvRow([
      label, fmtFn(current),
      be == null ? 'Not reachable in realistic range' : fmtFn(be),
      be == null ? '' : fmtFn(be - current),
    ]));
  });
  out.push('');

  // ── SECTION 5: YEAR-BY-YEAR PROJECTION ──
  out.push('=== YEAR-BY-YEAR PROJECTION (nominal dollars) ===');
  out.push(csvRow(['Year', 'Property Value', 'Mortgage Balance', 'Offset Balance', 'Buyer ETF Surplus',
    'Owner Equity', 'Mortgage Repayment', 'Maintenance', 'Rates/BodyCorp', 'Insurance', 'Land Tax',
    'Total Owning Cost', 'Annual Rent', 'Renter Insurance', 'Total Renting Cost',
    'Cash-flow Gap Invested', 'Renter Portfolio']));
  _lastRows.forEach(r => {
    out.push(csvRow([
      r.year, Math.round(r.propertyValue), Math.round(r.mortgageBalance),
      Math.round(r.offsetBalance || 0), Math.round(r.buyerEtf || 0), Math.round(r.equity),
      Math.round(r.annualRepayment), Math.round(r.maint), Math.round(r.rates), Math.round(r.ownerIns),
      Math.round(r.landTax || 0),
      Math.round(r.ownerCarry), Math.round(r.annualRent), Math.round(r.renterIns), Math.round(r.renterCarry),
      Math.round(r.gap), Math.round(r.portfolio),
    ]));
  });

  const blob = new Blob([out.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'rent-vs-buy-full-export.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

// ══════════════════════════════════════════════════════════
//  DARK MODE
// ══════════════════════════════════════════════════════════

function isDark() { return document.body.classList.contains('dark'); }

function toggleDark() {
  const dark = document.body.classList.toggle('dark');
  localStorage.setItem('au-rentvsbuy-dark', dark ? '1' : '0');
  document.cookie = `au-rentvsbuy-dark=${dark ? '1' : '0'}; max-age=31536000; path=/; SameSite=Strict`;
  document.getElementById('dark-toggle').textContent = dark ? '☀️' : '🌙';
  Chart.defaults.color = dark ? '#9CA3AF' : '#718096';
  _calc();
}

function initDark() {
  let darkStr = null;
  const cookieMatch = document.cookie.match(/(^| )au-rentvsbuy-dark=([^;]+)/);
  if (cookieMatch) darkStr = cookieMatch[2];
  if (!darkStr) darkStr = localStorage.getItem('au-rentvsbuy-dark');

  const dark = darkStr === '1';
  if (dark) {
    document.body.classList.add('dark');
    Chart.defaults.color = '#9CA3AF';
  }
  const btn = document.getElementById('dark-toggle');
  if (btn) btn.textContent = dark ? '☀️' : '🌙';
}

// ══════════════════════════════════════════════════════════
//  UI HELPERS
// ══════════════════════════════════════════════════════════

function toggleSection(id) {
  document.getElementById(id).classList.toggle('collapsed');
}

function toggleVis(id, show) {
  const el = document.getElementById(id);
  if (el) el.style.display = show ? 'block' : 'none';
}

function syncRange(el, lblId, pre, suf) {
  const v = parseFloat(el.value);
  document.getElementById(lblId).textContent = pre + v + suf;
  const min = parseFloat(el.min), max = parseFloat(el.max);
  el.style.setProperty('--val', ((v - min) / (max - min) * 100).toFixed(1) + '%');
}

function updateRangeLabels() {
  [
    ['years',            'lbl-years',      '', ' yrs'],
    ['taxRate',          'lbl-taxrate',    '', '%'],
    ['propertyGrowth',   'lbl-propgrowth', '', '%'],
    ['agentFeeRate',     'lbl-agent',      '', '%'],
    ['maintenanceRate',  'lbl-maint',      '', '%'],
    ['bodyCorpGrowth',   'lbl-bcgrowth',   '', '%'],
    ['rentGrowth',       'lbl-rentgrowth', '', '%'],
    ['investReturn',     'lbl-invret',     '', '%'],
    ['dividendYield',    'lbl-divyield',   '', '%'],
    ['frankingLevel',    'lbl-franking',   '', '%'],
    ['etfSellFeeRate',   'lbl-etfsell',    '', '%'],
    ['inflation',        'lbl-inflation',  '', '%'],
    ['retVol',           'lbl-vol',        '', '%'],
  ].forEach(([id, lbl, pre, suf]) => {
    const el = document.getElementById(id);
    if (el) syncRange(el, lbl, pre, suf);
  });
}

function autoStampDuty() {
  const price = parseFloat(document.getElementById('propertyPrice').value) || 0;
  const fhb = document.getElementById('firstHomeBuyer').checked;
  const state = document.getElementById('state')?.value || 'NSW';
  document.getElementById('stampDuty').value = estimateStampDuty(price, fhb, state);
  calc();
}

// Sets deposit to the minimum (20% of price) that keeps LVR at 80% — the
// standard threshold below which Lenders Mortgage Insurance isn't required.
function setMinDeposit() {
  const price = parseFloat(document.getElementById('propertyPrice').value) || 0;
  document.getElementById('deposit').value = Math.round(price * 0.2 / 500) * 500;
  calc();
}

function autoLMI() {
  const price = parseFloat(document.getElementById('propertyPrice').value) || 0;
  const totalSavings = parseFloat(document.getElementById('totalSavings').value) || 0;
  const deposit = Math.min(parseFloat(document.getElementById('deposit').value) || 0, totalSavings);
  const stampDuty = parseFloat(document.getElementById('stampDuty').value) || 0;
  const financeStampDuty = document.getElementById('financeStampDuty').checked;
  const loan = Math.max(0, price - deposit + (financeStampDuty ? stampDuty : 0));
  document.getElementById('lmiAmount').value = estimateLMI(loan, price);
  calc();
}

function updateConditionalUI() {
  toggleVis('investment-fields', document.getElementById('isInvestmentProperty')?.checked);
  toggleVis('legacy-cgt-fields', document.getElementById('cgtMethod')?.value === 'legacy');
  const incomeMode = document.getElementById('taxRateMethod')?.value !== 'flat';
  toggleVis('income-tax-fields', incomeMode);
  toggleVis('flat-tax-field', !incomeMode);
}

function getInputs() {
  const g   = id => document.getElementById(id);
  const num = id => { const el = g(id); return el ? (parseFloat(el.value) || 0) : 0; };
  const chk = id => { const el = g(id); return el ? el.checked : false; };
  const sel = id => { const el = g(id); return el ? el.value : ''; };

  return {
    years: parseInt(g('years').value, 10) || 10,
    taxRateMethod: sel('taxRateMethod') || 'income',
    grossSalary: num('grossSalary'),
    salaryGrowth: chk('salaryGrowth'),
    taxRate: num('taxRate') / 100,
    firstHomeBuyer: chk('firstHomeBuyer'),
    state: sel('state') || 'NSW',

    totalSavings: num('totalSavings'),
    surplusDestination: sel('surplusDestination') || 'offset',
    propertyPrice: num('propertyPrice'),
    deposit: num('deposit'),
    lmiAmount: num('lmiAmount'),
    financeLMI: sel('financeLMI') !== 'no',
    fhogAmount: num('fhogAmount'),
    propertyGrowth: num('propertyGrowth') / 100,
    stampDuty: num('stampDuty'),
    financeStampDuty: chk('financeStampDuty'),
    legalFeesBuy: num('legalFeesBuy'),
    legalFeesSell: num('legalFeesSell'),
    agentFeeRate: num('agentFeeRate') / 100,

    mortgageRate: num('mortgageRate') / 100,
    loanTerm: num('loanTerm') || 30,
    interestOnly: sel('repaymentType') === 'io',

    maintenanceRate: num('maintenanceRate') / 100,
    councilRates: num('councilRates'),
    bodyCorp: num('bodyCorp'),
    bodyCorpGrowth: num('bodyCorpGrowth') / 100,
    ownerInsurance: num('ownerInsurance'),

    weeklyRent: num('weeklyRent'),
    rentGrowth: num('rentGrowth') / 100,
    renterInsurance: num('renterInsurance'),
    bondWeeks: num('bondWeeks'),

    investReturn: num('investReturn') / 100,
    dividendYield: num('dividendYield') / 100,
    frankingLevel: num('frankingLevel') / 100,
    etfSellFeeRate: num('etfSellFeeRate') / 100,

    isInvestmentProperty: chk('isInvestmentProperty'),
    rentalIncome: num('rentalIncome'),
    vacancyWeeks: num('vacancyWeeks'),
    propertyManagementRate: num('propertyManagementRate') / 100,
    landTax: num('landTax'),
    depreciationDeduction: num('depreciationDeduction'),
    allowNegativeGearing: chk('allowNegativeGearing'),

    cgtMethod: sel('cgtMethod') || 'fy27',
    isPensioner: chk('isPensioner'),
    cgtDiscount: parseFloat(sel('cgtDiscount')) || 0,
    mainResidence: chk('mainResidence'),
    inflation: num('inflation') / 100,
    retVol: num('retVol') / 100,
    npvDiscountRate: num('inflation') / 100,
  };
}

// ══════════════════════════════════════════════════════════
//  CHARTS
// ══════════════════════════════════════════════════════════

const charts = {};

Chart.defaults.font.family = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
Chart.defaults.font.size   = 11;
Chart.defaults.color       = '#718096';

const msLinesPlugin = {
  id: 'msLines',
  afterDatasetsDraw(chart, args, options) {
    const lines = options.lines || [];
    const xs = chart.scales.x, area = chart.chartArea, ctx = chart.ctx;
    lines.forEach(({ idx, color, label }) => {
      if (idx == null || idx < 0) return;
      const px = xs.getPixelForValue(idx);
      if (px < area.left || px > area.right) return;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.setLineDash([2, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, area.top);
      ctx.lineTo(px, area.bottom);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = '600 9px sans-serif';
      ctx.textAlign = 'left';
      ctx.translate(px, area.top);
      ctx.rotate(Math.PI / 2);
      ctx.fillText(label, 4, -4);
      ctx.restore();
    });
  },
};
Chart.register(msLinesPlugin);

function gc() { return isDark() ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.04)'; }

function makeGradient(ctx, color, alpha1 = 0.3, alpha2 = 0.01) {
  const g = ctx.createLinearGradient(0, 0, 0, 300);
  g.addColorStop(0, color.replace('1)', `${alpha1})`));
  g.addColorStop(1, color.replace('1)', `${alpha2})`));
  return g;
}

function buildProjectionChart(rows, result, inp, mc) {
  const ctx = document.getElementById('chart-projection').getContext('2d');
  const yrs = rows.map(r => r.year);
  const isD = isDark();
  const G = gc();

  const equityGrad = makeGradient(ctx, isD ? 'rgba(251,191,36,1)' : 'rgba(180,83,9,1)', 0.25, 0.02);
  const portGrad   = makeGradient(ctx, isD ? 'rgba(96,165,250,1)' : 'rgba(37,99,235,1)', 0.25, 0.02);

  const ds = [
    { label: 'Owner Equity', data: rows.map(r => r.equity), borderColor: isD ? '#FBBF24' : '#B45309', backgroundColor: equityGrad, fill: true, tension: 0.4, borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 5 },
    { label: 'Renter Portfolio', data: rows.map(r => r.portfolio), borderColor: isD ? '#60A5FA' : '#2563EB', backgroundColor: portGrad, fill: true, tension: 0.4, borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 5 },
  ];

  const msLines = [];
  if (result.breakevenYear != null) {
    msLines.push({ idx: result.breakevenYear - 1, color: isD ? '#34D399' : '#059669', label: 'Break-even' });
  }

  if (charts.proj) charts.proj.destroy();
  charts.proj = new Chart(ctx, {
    type: 'line', data: { labels: yrs, datasets: ds },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        msLines: { lines: msLines },
        legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10, font: { size: 11 } } },
        tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${fmt(c.parsed.y)}` } },
      },
      scales: {
        x: { title: { display: true, text: 'Year', font: { size: 11 } }, grid: { color: G } },
        y: {
          title: { display: true, text: 'Wealth (nominal $)', font: { size: 11 } },
          grid: { color: G },
          ticks: { callback: v => v >= 1e6 ? '$' + (v / 1e6).toFixed(1) + 'M' : '$' + (v / 1000).toFixed(0) + 'K' },
        },
      },
    },
  });
}

function buildFinalChart(result) {
  const ctx = document.getElementById('chart-final').getContext('2d');
  const isD = isDark();
  const labels = ['Buy', 'Rent & Invest'];
  const colorNom = isD ? ['#FBBF24', '#60A5FA'] : ['#B45309', '#2563EB'];
  const colorNpv = isD ? ['#FCD34D', '#93C5FD'] : ['#D97706', '#3B82F6'];

  if (charts.final) charts.final.destroy();
  charts.final = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: `Nominal (year ${result.rows.length})`, data: [result.buyNet, result.rentNet], backgroundColor: colorNom.map(c => c + 'CC'), borderColor: colorNom, borderWidth: 2, borderRadius: 6 },
        { label: "NPV (today's $)", data: [result.npvBuy, result.npvRent], backgroundColor: colorNpv.map(c => c + 'CC'), borderColor: colorNpv, borderWidth: 2, borderRadius: 6 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10 } },
        tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${fmt(c.parsed.y)}` } },
      },
      scales: {
        x: { grid: { display: false } },
        y: { grid: { color: gc() }, ticks: { callback: v => '$' + (v / 1000).toFixed(0) + 'K' } },
      },
    },
  });
}

function buildOwnCostChart(row) {
  const ctx = document.getElementById('chart-owncost').getContext('2d');
  const isD = isDark();
  const raw = [row.annualRepayment, row.maint, row.rates, row.ownerIns, row.landTax || 0];
  const labels = ['Mortgage Repayment', 'Maintenance', 'Rates/Body Corp', 'Insurance', 'Land Tax'];
  const colors = isD ? ['#A78BFA', '#F87171', '#FBBF24', '#34D399', '#60A5FA'] : ['#7C3AED', '#DC2626', '#B45309', '#059669', '#2563EB'];
  const vals = raw.map((v, i) => ({ v, l: labels[i], c: colors[i] })).filter(x => x.v > 0);
  const grossCost = vals.reduce((s, x) => s + x.v, 0);

  if (charts.owncost) charts.owncost.destroy();
  charts.owncost = new Chart(ctx, {
    type: 'doughnut',
    data: { labels: vals.map(x => x.l), datasets: [{ data: vals.map(x => x.v), backgroundColor: vals.map(x => x.c + 'CC'), borderColor: vals.map(x => x.c), borderWidth: 2, hoverOffset: 6 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10 } },
        tooltip: { callbacks: { label: c => ` ${c.label}: ${fmt(c.parsed)} (${(c.parsed / grossCost * 100).toFixed(0)}%)` } },
      },
    },
  });
}

function buildGapChart(rows) {
  const ctx = document.getElementById('chart-gap').getContext('2d');
  const isD = isDark();
  const G = gc();

  if (charts.gap) charts.gap.destroy();
  charts.gap = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: rows.map(r => r.year),
      datasets: [{
        label: 'Cash-flow Gap',
        data: rows.map(r => r.gap),
        backgroundColor: rows.map(r => r.gap >= 0 ? (isD ? 'rgba(52,211,153,0.7)' : 'rgba(5,150,105,0.7)') : (isD ? 'rgba(248,113,113,0.7)' : 'rgba(220,38,38,0.7)')),
        borderColor: rows.map(r => r.gap >= 0 ? (isD ? '#34D399' : '#059669') : (isD ? '#F87171' : '#DC2626')),
        borderWidth: 1, borderRadius: 2,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${fmt(c.parsed.y)}/yr ${c.parsed.y >= 0 ? 'invested' : 'drawn'}` } } },
      scales: {
        x: { title: { display: true, text: 'Year', font: { size: 11 } }, grid: { display: false } },
        y: { grid: { color: G }, ticks: { callback: v => '$' + (v / 1000).toFixed(0) + 'K' } },
      },
    },
  });
}

function buildEquityChart(rows) {
  const ctx = document.getElementById('chart-equity').getContext('2d');
  const isD = isDark();
  const G = gc();

  if (charts.equity) charts.equity.destroy();
  charts.equity = new Chart(ctx, {
    type: 'line',
    data: {
      labels: rows.map(r => r.year),
      datasets: [
        { label: 'Property Value', data: rows.map(r => r.propertyValue), borderColor: isD ? '#34D399' : '#059669', backgroundColor: 'transparent', fill: false, tension: 0.4, borderWidth: 2, pointRadius: 0 },
        { label: 'Mortgage Balance', data: rows.map(r => r.mortgageBalance), borderColor: isD ? '#F87171' : '#DC2626', backgroundColor: 'transparent', fill: false, tension: 0.4, borderWidth: 2, pointRadius: 0 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10 } },
        tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${fmt(c.parsed.y)}` } },
      },
      scales: {
        x: { title: { display: true, text: 'Year', font: { size: 11 } }, grid: { color: G } },
        y: { grid: { color: G }, ticks: { callback: v => '$' + (v / 1000).toFixed(0) + 'K' } },
      },
    },
  });
}

// ══════════════════════════════════════════════════════════
//  HERO HEADLINE
// ══════════════════════════════════════════════════════════

function renderHero(inp, result, mc) {
  const el = document.getElementById('hero');
  if (!el) return;

  const npvDelta = result.npvRent - result.npvBuy;
  const npvWinner = npvDelta >= 0 ? 'Renting & Investing' : 'Buying';
  const npvMargin = Math.abs(npvDelta);
  const kicker = `Over a ${inp.years}-year horizon, in today's dollars (NPV @ ${(inp.npvDiscountRate * 100).toFixed(1)}%)`;

  const surplusReason = inp.surplusDestination === 'offset'
    ? `your ${fmt(result.buyerSurplus)} surplus savings sit in the mortgage offset (saving guaranteed, tax-free interest)`
    : `your ${fmt(result.buyerSurplus)} surplus savings stay invested in ETFs alongside the deposit`;
  const reason = result.buyerSurplus > 0.5
    ? `after accounting for the mortgage, all carrying costs, taxes, and ${surplusReason}`
    : `after accounting for the mortgage, all carrying costs and taxes on both sides`;

  const head = `<b>${npvWinner}</b> is worth <b>${fmtK(npvMargin)}</b> more in today's dollars ${reason}`;

  const chip = (label, val) => `<span class="chip">${label} <b>${val}</b></span>`;

  let mcChip = '';
  if (mc) {
    const s = Math.round(mc.buySuccess * 100);
    mcChip = `<span class="chip mc-badge ${s >= 50 ? 'good' : 'bad'}" title="Share of ${mc.n} simulated market/property histories where Buying wins">Monte Carlo: <b>${s}%</b> favour buying</span>`;
  }

  const breakevenChip = result.breakevenYear != null
    ? chip('Equity overtakes portfolio', `year ${result.breakevenYear}`)
    : chip('Equity overtakes portfolio', 'never in horizon');

  const nominalWinner = result.delta >= 0 ? 'Rent' : 'Buy';

  el.classList.remove('hero-rent-wins', 'hero-buy-wins');
  el.classList.add(npvDelta >= 0 ? 'hero-rent-wins' : 'hero-buy-wins');

  el.innerHTML = `
    <div class="hero-kicker">${kicker}</div>
    <div class="hero-headline">${head}</div>
    <div class="hero-chips">
      ${chip('NPV of Buying', fmtK(result.npvBuy))}
      ${chip('NPV of Renting', fmtK(result.npvRent))}
      ${chip('Nominal winner at year ' + inp.years, nominalWinner + ' by ' + fmtK(Math.abs(result.delta)))}
      ${breakevenChip}
      ${mcChip}
    </div>
  `;
}

// ══════════════════════════════════════════════════════════
//  MILESTONE CARDS
// ══════════════════════════════════════════════════════════

function renderCard(prefix, valueLabel, value, descLines, progressPct, pctLabel) {
  const ageEl  = document.getElementById(`${prefix}-age`);
  const yrsEl  = document.getElementById(`${prefix}-years`);
  const numEl  = document.getElementById(`${prefix}-number`);
  const descEl = document.getElementById(`${prefix}-desc`);
  const barEl  = document.getElementById(`${prefix}-bar`);
  const pctEl  = document.getElementById(`${prefix}-pct`);
  if (!ageEl) return;

  ageEl.textContent = valueLabel;
  yrsEl.innerHTML = '';
  numEl.textContent = fmtK(value);
  descEl.innerHTML = descLines;

  const clampedPct = Math.min(100, Math.max(0, progressPct || 0));
  if (barEl) barEl.style.width = clampedPct.toFixed(1) + '%';
  if (pctEl) pctEl.textContent = pctLabel || '';
}

// ══════════════════════════════════════════════════════════
//  SCENARIO ANALYSIS
// ══════════════════════════════════════════════════════════

function renderScenarios(inp, result) {
  const el = document.getElementById('scenario-grid');
  if (!el) return;

  const scCard = (icon, title, sub, delta, footer) => {
    const favoursBuy = delta < 0;
    const cls = Math.abs(delta) < 1000 ? 'gap' : (favoursBuy ? 'ready' : 'ready');
    const badgeCls = Math.abs(delta) < 1000 ? 'sc-badge-gap' : 'sc-badge-ready';
    const badgeLabel = Math.abs(delta) < 1000 ? 'Toss-up' : (favoursBuy ? 'Favours Buy' : 'Favours Rent');
    return `
    <div class="sc-card ${cls}">
      <div class="sc-head">
        <div class="sc-icon">${icon}</div>
        <div class="sc-titlewrap">
          <div class="sc-title">${title}</div>
          <div class="sc-sub">${sub}</div>
        </div>
        <div class="sc-badge ${badgeCls}">${badgeLabel}</div>
      </div>
      <div class="sc-body">
        <div class="sc-row"><span>Δ Net position (Rent − Buy)</span><span class="${delta >= 0 ? 'sc-green' : 'sc-red'}">${fmtK(delta)}</span></div>
      </div>
      ${footer ? `<div class="sc-foot">${footer}</div>` : ''}
    </div>`;
  };

  const scenarios = [
    { icon: '📈', title: 'Higher Property Growth', sub: `+1.5% p.a. (${((inp.propertyGrowth + 0.015) * 100).toFixed(1)}%)`, patch: { propertyGrowth: inp.propertyGrowth + 0.015 } },
    { icon: '📉', title: 'Lower Property Growth', sub: `-1.5% p.a. (${Math.max(0, (inp.propertyGrowth - 0.015) * 100).toFixed(1)}%)`, patch: { propertyGrowth: inp.propertyGrowth - 0.015 } },
    { icon: '💹', title: 'Higher Investment Return', sub: `+2.0% p.a. (${((inp.investReturn + 0.02) * 100).toFixed(1)}%)`, patch: { investReturn: inp.investReturn + 0.02 } },
    { icon: '🏦', title: 'Higher Interest Rate', sub: `+1.5% p.a. (${((inp.mortgageRate + 0.015) * 100).toFixed(1)}%)`, patch: { mortgageRate: inp.mortgageRate + 0.015 } },
    { icon: '🏠', title: 'Faster Rent Growth', sub: `+2.0% p.a. (${((inp.rentGrowth + 0.02) * 100).toFixed(1)}%)`, patch: { rentGrowth: inp.rentGrowth + 0.02 } },
    { icon: '⏳', title: 'Longer Horizon', sub: `${inp.years + 10} years`, patch: { years: inp.years + 10 } },
  ];

  el.innerHTML = scenarios.map(sc => {
    const testRes = project({ ...inp, ...sc.patch });
    const footer = `Buy: ${fmtK(testRes.buyNet)} · Rent: ${fmtK(testRes.rentNet)}`;
    return scCard(sc.icon, sc.title, sc.sub, testRes.delta, footer);
  }).join('');
}

// ══════════════════════════════════════════════════════════
//  BREAK-EVEN REPORT
//  Solves, for one input at a time, the value that makes NPV(Buy) = NPV(Rent),
//  holding everything else fixed — i.e. "how far would X need to move to flip
//  (or exactly equalise) the verdict?"
// ══════════════════════════════════════════════════════════

// Bisection solver for f(x) = 0 over [lo, hi]. Returns null if the range doesn't bracket
// a root (both endpoints give the same sign) — the input isn't the lever that would flip it.
function solveBreakeven(f, lo, hi, iterations = 40) {
  let fLo = f(lo), fHi = f(hi);
  if (fLo === 0) return lo;
  if (fHi === 0) return hi;
  if ((fLo > 0) === (fHi > 0)) return null; // no sign change in range — can't equalise here
  for (let i = 0; i < iterations; i++) {
    const mid = (lo + hi) / 2;
    const fMid = f(mid);
    if (fMid === 0) return mid;
    if ((fMid > 0) === (fLo > 0)) { lo = mid; fLo = fMid; }
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function renderBreakevenReport(inp, result) {
  const el = document.getElementById('breakeven-grid');
  if (!el) return;

  // f(x) > 0 means Rent wins at x; f(x) < 0 means Buy wins. The root is break-even.
  const npvDiff = (field, value) => {
    const r = project({ ...inp, [field]: value });
    return r.npvRent - r.npvBuy;
  };

  const card = (icon, title, current, breakeven, fmtVal, note) => {
    if (breakeven == null) {
      return `
      <div class="sc-card gap">
        <div class="sc-head">
          <div class="sc-icon">${icon}</div>
          <div class="sc-titlewrap">
            <div class="sc-title">${title}</div>
            <div class="sc-sub">No break-even within a realistic range</div>
          </div>
          <div class="sc-badge sc-badge-gap">Not reachable</div>
        </div>
        <div class="sc-body">
          <div class="sc-row"><span>Current</span><span>${fmtVal(current)}</span></div>
        </div>
        ${note ? `<div class="sc-foot">${note}</div>` : ''}
      </div>`;
    }
    const movedUp = breakeven > current;
    const badgeLabel = Math.abs(breakeven - current) < 1e-6 ? 'Already even' : (movedUp ? 'Needs to rise' : 'Needs to fall');
    return `
    <div class="sc-card ready">
      <div class="sc-head">
        <div class="sc-icon">${icon}</div>
        <div class="sc-titlewrap">
          <div class="sc-title">${title}</div>
          <div class="sc-sub">Current: ${fmtVal(current)}</div>
        </div>
        <div class="sc-badge sc-badge-ready">${badgeLabel}</div>
      </div>
      <div class="sc-body">
        <div class="sc-row"><span>Break-even value</span><span class="sc-green">${fmtVal(breakeven)}</span></div>
        <div class="sc-row"><span>Change needed</span><span>${movedUp ? '+' : ''}${fmtVal(breakeven - current, true)}</span></div>
      </div>
      ${note ? `<div class="sc-foot">${note}</div>` : ''}
    </div>`;
  };

  const pctVal = (v, delta) => (delta ? (v * 100 >= 0 ? '+' : '') : '') + (v * 100).toFixed(2) + '%';
  const dollarVal = (v, delta) => (delta && v >= 0 ? '+' : '') + fmt(v);

  const rows = [];

  // 1. Weekly rent — how much would rent need to be (today) to equalise?
  const rentBE = solveBreakeven(x => npvDiff('weeklyRent', x), 0, inp.weeklyRent * 5);
  rows.push(card('🔑', 'Weekly Rent', inp.weeklyRent, rentBE, dollarVal,
    'Holding rent growth, mortgage rate and everything else fixed — the starting weekly rent that makes NPV(Buy) = NPV(Rent).'));

  // 2. Rent growth rate
  const rentGrowthBE = solveBreakeven(x => npvDiff('rentGrowth', x), -0.05, 0.15);
  rows.push(card('📈', 'Rent Growth Rate', inp.rentGrowth, rentGrowthBE, pctVal,
    'The annual rent escalation rate that would equalise the two paths, holding the starting rent fixed.'));

  // 3. Mortgage interest rate
  const mortRateBE = solveBreakeven(x => npvDiff('mortgageRate', x), 0, 0.20);
  rows.push(card('🏦', 'Mortgage Interest Rate', inp.mortgageRate, mortRateBE, pctVal,
    'The interest rate that would make owning exactly as good as renting & investing.'));

  // 4. Property growth rate
  const propGrowthBE = solveBreakeven(x => npvDiff('propertyGrowth', x), -0.10, 0.20);
  rows.push(card('🏠', 'Property Growth Rate', inp.propertyGrowth, propGrowthBE, pctVal,
    'The annual capital growth the property would need to deliver to equalise the outcome.'));

  // 5. Investment return (ETF)
  const investReturnBE = solveBreakeven(x => npvDiff('investReturn', Math.max(x, inp.dividendYield)), 0, 0.25);
  rows.push(card('💹', 'ETF Investment Return', inp.investReturn, investReturnBE, pctVal,
    "The renter's total investment return that would equalise the outcome (dividend yield capped to not exceed it)."));

  // 6. Property purchase price
  const priceBE = solveBreakeven(x => npvDiff('propertyPrice', x), inp.propertyPrice * 0.3, inp.propertyPrice * 3);
  rows.push(card('💰', 'Property Purchase Price', inp.propertyPrice, priceBE, dollarVal,
    'The purchase price that would equalise the outcome, holding the deposit and all other $ inputs fixed (so the loan size absorbs the difference).'));

  // 7. Council rates (body corp held fixed at its current level)
  const ratesBE = solveBreakeven(x => npvDiff('councilRates', x), 0, inp.councilRates * 6 + 5000);
  rows.push(card('🧾', 'Council Rates', inp.councilRates, ratesBE, dollarVal,
    'Annual council rates that would equalise the outcome, holding body corp fees fixed at their current level.'));

  // 8. Maintenance rate
  const maintBE = solveBreakeven(x => npvDiff('maintenanceRate', x), 0, 0.10);
  rows.push(card('🔧', 'Maintenance Rate (% of value p.a.)', inp.maintenanceRate, maintBE, pctVal,
    'Annual maintenance cost, as a % of property value, that would equalise the outcome.'));

  el.innerHTML = rows.join('');
}

// ══════════════════════════════════════════════════════════
//  WHAT-IF: ANALYSIS HORIZON
// ══════════════════════════════════════════════════════════

window.runWhatIf = function () {
  const inp = _lastInp;
  if (!inp) return;
  const yearsEl = document.getElementById('wi-years');
  const testYears = yearsEl ? parseInt(yearsEl.value, 10) : inp.years;

  const testRes = project({ ...inp, years: testYears });
  const winner = testRes.delta >= 0 ? 'Rent & Invest' : 'Buy';
  const winnerCls = testRes.delta >= 0 ? 'wb-delta-good' : 'wb-delta-bad';

  document.getElementById('wi-global-result').innerHTML = `
    <div class="whatif-box">
      <div class="wb-label">Winner at ${testYears} years</div>
      <div class="wb-val ${winnerCls}">${winner}</div>
      <div class="wb-sub">by ${fmtK(Math.abs(testRes.delta))}</div>
    </div>
    <div class="whatif-box">
      <div class="wb-label">Buy Net Position</div>
      <div class="wb-val">${fmtK(testRes.buyNet)}</div>
      <div class="wb-sub">after selling costs</div>
    </div>
    <div class="whatif-box">
      <div class="wb-label">Rent Net Position</div>
      <div class="wb-val">${fmtK(testRes.rentNet)}</div>
      <div class="wb-sub">after CGT</div>
    </div>
  `;
};

function renderWhatIf(inp) {
  const yearsSlider = document.getElementById('wi-years');
  if (!yearsSlider) return;
  yearsSlider.min = 1;
  yearsSlider.max = 30;
  yearsSlider.value = inp.years;
  syncRange(yearsSlider, 'wi-years-val', '', ' yrs');
  runWhatIf();
}

// ══════════════════════════════════════════════════════════
//  YEAR-BY-YEAR TABLE
// ══════════════════════════════════════════════════════════

function renderYearTable(rows) {
  const el = document.getElementById('year-table');
  if (!el) return;
  const f = n => Math.abs(n) > 0.5 ? fmt(n) : '—';
  const body = rows.map(r => `
    <tr>
      <td class="yt-l">${r.year}</td>
      <td>${fmtK(r.propertyValue)}</td>
      <td>${fmtK(r.mortgageBalance)}</td>
      <td>${fmtK(r.offsetBalance || 0)}</td>
      <td>${fmtK(r.buyerEtf || 0)}</td>
      <td><strong>${fmtK(r.equity)}</strong></td>
      <td>${f(r.ownerCarry)}</td>
      <td>${f(r.renterCarry)}</td>
      <td class="${r.gap >= 0 ? 'sc-green' : 'sc-red'}">${f(r.gap)}</td>
      <td><strong>${fmtK(r.portfolio)}</strong></td>
    </tr>`).join('');

  el.innerHTML = `
    <table class="year-table">
      <thead><tr>
        <th class="yt-l">Year</th><th>Property Value</th><th>Mortgage Balance</th><th>Offset Balance</th><th>Buyer ETF Surplus</th><th>Owner Equity</th>
        <th>Owning Cost</th><th>Renting Cost</th><th>Cash-flow Gap</th><th>Renter Portfolio</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

// ══════════════════════════════════════════════════════════
//  MAIN CALCULATE
// ══════════════════════════════════════════════════════════

let debounceTimer;
let _lastRows = [];
let _lastInp  = null;
let _lastResult = null;
let _lastMc = null;

function calc() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(_calc, 80);
}

function _calc() {
  const inp = getInputs();
  _lastInp = inp;

  updateConditionalUI();

  const actualDeposit = Math.max(0, Math.min(inp.deposit, inp.totalSavings));

  const depositSavingsHint = document.getElementById('deposit-savings-hint');
  if (depositSavingsHint) {
    depositSavingsHint.textContent = inp.deposit > inp.totalSavings
      ? `⚠ Deposit exceeds Total Savings (${fmt(inp.totalSavings)}) — capped to ${fmt(actualDeposit)}`
      : '';
  }

  const lvrHint = document.getElementById('lvr-hint');
  if (lvrHint) {
    const loan = Math.max(0, inp.propertyPrice - actualDeposit);
    const lvr = inp.propertyPrice > 0 ? (loan / inp.propertyPrice * 100) : 0;
    const lmiNote = lvr > 80 && inp.lmiAmount <= 0 ? ' — LMI likely applies, set an amount above' : '';
    lvrHint.textContent = `Loan: ${fmt(loan)} · LVR ${lvr.toFixed(0)}%${lmiNote}`;
  }

  const mortgageHint = document.getElementById('mortgage-repayment-hint');
  if (mortgageHint) {
    const loan = Math.max(0, inp.propertyPrice - actualDeposit
      + (inp.financeStampDuty ? inp.stampDuty : 0)
      + (inp.financeLMI ? inp.lmiAmount : 0));
    const repay = annualMortgageRepayment(loan, inp.mortgageRate, inp.loanTerm, inp.interestOnly);
    mortgageHint.textContent = repay > 0
      ? `Annual repayment: ${fmt(repay)}/yr (${fmt(repay / 12)}/mo)${inp.interestOnly ? ' — interest only' : ''}`
      : '';
  }

  const savingsBreakdownHint = document.getElementById('savings-breakdown-hint');
  if (savingsBreakdownHint) {
    const buyerUpfrontCash = Math.max(0, (inp.financeStampDuty ? 0 : inp.stampDuty) + inp.legalFeesBuy
      + (inp.financeLMI ? 0 : inp.lmiAmount) - inp.fhogAmount);
    const surplus = Math.max(0, inp.totalSavings - actualDeposit - buyerUpfrontCash);
    savingsBreakdownHint.textContent = `Buy: ${fmt(actualDeposit)} deposit + ${fmt(buyerUpfrontCash)} upfront costs, ${fmt(surplus)} surplus → ${inp.surplusDestination === 'offset' ? 'offset' : 'ETF'} · Rent: ${fmt(inp.totalSavings)} fully invested`;
  }

  const divYieldWarn = document.getElementById('divyield-warn');
  if (divYieldWarn) {
    const rawYield = (parseFloat(document.getElementById('dividendYield')?.value) || 0) / 100;
    divYieldWarn.classList.toggle('show', rawYield > inp.investReturn);
  }

  const taxRateHint = document.getElementById('tax-rate-hint');
  if (taxRateHint && inp.taxRateMethod === 'income') {
    const startRate = marginalTaxRate(inp.grossSalary);
    const endSalary = inp.salaryGrowth ? inp.grossSalary * Math.pow(1 + inp.inflation, inp.years - 1) : inp.grossSalary;
    const endRate = marginalTaxRate(endSalary);
    taxRateHint.textContent = `Marginal rate (incl. Medicare): ${pct(startRate)} now`
      + (Math.abs(endRate - startRate) > 0.001 ? ` → ${pct(endRate)} by year ${inp.years} (${fmt(endSalary)} salary)` : ` — stays in the same bracket over ${inp.years} years`);
  }

  const negGearingHint = document.getElementById('neg-gearing-hint');
  if (negGearingHint) {
    negGearingHint.textContent = inp.allowNegativeGearing
      ? 'Negative gearing enabled: rental losses are deducted against your other taxable income at your marginal rate.'
      : 'Negative gearing disabled: rental losses are not deductible against other income (post-abolition scenario).';
  }

  const result = project(inp);
  const mc = runMonteCarlo(inp);
  _lastRows = result.rows;
  _lastResult = result;
  _lastMc = mc;

  window._lastAuditLog = [
    '🏡 Rent vs Buy Calculator Audit Logs',
    '1. Parsed Inputs:\n' + JSON.stringify(inp, null, 2),
    '2. Projection Result:\n' + JSON.stringify(result, null, 2),
    '3. Monte Carlo Result:\n' + JSON.stringify(mc, null, 2),
  ].join('\n\n');

  console.groupCollapsed('🏡 Rent vs Buy Calculator Audit Logs');
  console.log(window._lastAuditLog);
  console.groupEnd();

  renderHero(inp, result, mc);

  // ── MILESTONE CARDS ──
  const surplusNote = result.buyerSurplus > 0
    ? (inp.surplusDestination === 'offset'
        ? ` plus ${fmt(result.finalOffsetBalance)} offset + ${fmt(result.buyerEtfNet)} surplus ETF (net of CGT)`
        : ` plus ${fmt(result.buyerEtfNet)} surplus ETF (net of CGT)`)
    : '';
  renderCard('buy', fmtK(result.buyNet), result.buyNet,
    `Property value ${fmt(result.finalPropertyValue)} minus mortgage ${fmt(result.finalMortgageBalance)} and selling costs ${fmt(result.sellingCosts)}${surplusNote}<br>
     <span style="font-size:10px;color:var(--text-muted)">${inp.mainResidence ? 'Main residence — CGT exempt' : 'Investment property — no CGT modelled on sale'}</span>`,
    result.buyNet >= result.rentNet ? 100 : (result.buyNet / Math.max(1, result.rentNet) * 100),
    result.buyNet >= result.rentNet ? 'Leading' : '');

  renderCard('rent', fmtK(result.rentNet), result.rentNet,
    `Portfolio ${fmt(result.finalPortfolio)} minus CGT ${fmt(result.cgt)} plus bond refund ${fmt(result.bond)}<br>
     <span style="font-size:10px;color:var(--text-muted)">50% CGT discount ${inp.cgtDiscount > 0 ? 'applied' : 'not applied'} on gains over cost basis</span>`,
    result.rentNet >= result.buyNet ? 100 : (result.rentNet / Math.max(1, result.buyNet) * 100),
    result.rentNet >= result.buyNet ? 'Leading' : '');

  renderCard('breakeven', result.breakevenYear != null ? `Year ${result.breakevenYear}` : `${inp.years}+`,
    result.breakevenYear != null ? result.finalPropertyValue : 0,
    result.breakevenYear != null
      ? `Owner equity overtakes the renter's portfolio value from year ${result.breakevenYear} onward`
      : `Owner equity does not overtake the renter's portfolio within ${inp.years} years`,
    result.breakevenYear != null ? Math.max(0, 100 - (result.breakevenYear / inp.years * 100)) : 0,
    result.breakevenYear != null ? `${inp.years - result.breakevenYear} yrs to spare` : '');

  const npvDelta = result.npvRent - result.npvBuy;
  renderCard('delta', (npvDelta >= 0 ? '+' : '') + fmtK(npvDelta), Math.abs(npvDelta),
    npvDelta >= 0
      ? `Renting &amp; investing is worth ${fmt(Math.abs(npvDelta))} more than buying, in today's dollars (NPV @ ${(inp.npvDiscountRate * 100).toFixed(1)}%)`
      : `Buying is worth ${fmt(Math.abs(npvDelta))} more than renting &amp; investing, in today's dollars (NPV @ ${(inp.npvDiscountRate * 100).toFixed(1)}%)`,
    Math.min(100, Math.abs(npvDelta) / Math.max(result.npvBuy, result.npvRent, 1) * 100),
    npvDelta >= 0 ? 'Rent wins (NPV)' : 'Buy wins (NPV)');

  renderScenarios(inp, result);
  renderBreakevenReport(inp, result);
  renderWhatIf(inp);

  // ── TAX STRIP (year 1) ──
  const row1 = result.rows[0];
  if (row1) {
    document.getElementById('ts-mortgage').textContent = fmt(row1.annualRepayment);
    document.getElementById('ts-mortgage-weekly').textContent = fmt(row1.annualRepayment / 52) + '/wk';
    document.getElementById('ts-owner-extra').textContent = fmt(row1.maint + row1.rates + row1.ownerIns + (row1.landTax || 0));
    document.getElementById('ts-owner-total').textContent = fmt(row1.ownerCarry);
    document.getElementById('ts-rent').textContent = fmt(row1.annualRent);
    document.getElementById('ts-rent-weekly').textContent = fmt(row1.annualRent / 52) + '/wk';
    document.getElementById('ts-gap').textContent = (row1.gap >= 0 ? '+' : '') + fmt(row1.gap);
    document.getElementById('ts-gap-note').textContent = row1.gap >= 0 ? 'invested by renter' : 'drawn from portfolio';
    document.getElementById('ts-initial-invest').textContent = fmt(result.renterInitial);
  }

  // ── CHARTS & TABLE ──
  buildProjectionChart(result.rows, result, inp, mc);
  buildFinalChart(result);
  if (row1) buildOwnCostChart(row1);
  buildGapChart(result.rows);
  buildEquityChart(result.rows);
  renderYearTable(result.rows);

  saveState();
}

// ══════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════

function initRanges() {
  document.querySelectorAll('input[type="range"]').forEach(el => {
    const min = parseFloat(el.min), max = parseFloat(el.max), v = parseFloat(el.value);
    el.style.setProperty('--val', ((v - min) / (max - min) * 100).toFixed(1) + '%');
  });
}

function initUX() {
  document.querySelectorAll('input[type="number"]').forEach(el => {
    el.addEventListener('focus', function () { this.select(); });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initDark();
  if (!applyUrlParams()) loadState();
  initRanges();
  initUX();
  updateRangeLabels();
  updateConditionalUI();
  calc();
});
