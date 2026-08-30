'use strict';

// ══════════════════════════════════════════════════════════
//  AUSTRALIAN RENT vs BUY CALCULATOR ENGINE (FY 2025–26)
//  Nominal-dollar year-by-year simulation:
//  - Standard P&I (or interest-only) mortgage amortisation
//  - Real 100% offset account vs ETF surplus investing
//  - Owner carrying costs: maintenance, rates/strata, insurance, land tax
//  - Renter invests deposit + upfront costs and cash-flow differential
//  - Australian dividend gross-up and refundable franking credits
//  - Capital Gains Tax: FY27 CPI-indexation method or Legacy 50% discount
//  - Monte Carlo volatility simulation (400 runs) with 10–90% percentile cone
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

// Effective marginal tax rate (income tax bracket rate + 2% Medicare Levy).
function marginalTaxRate(income) {
  if (income <= 18200) return 0;
  for (const b of TAX_BRACKETS_2526) {
    if (income <= b.upTo) return b.rate + MEDICARE_LEVY_RATE;
  }
  return TAX_BRACKETS_2526[TAX_BRACKETS_2526.length - 1].rate + MEDICARE_LEVY_RATE;
}

// General transfer duty schedules by state/territory for owner-occupiers.
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
    : 120270 + (price - 2000000) * 0.065, // Continuous marginal calculation over $2M
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
  NT: price => price <= 525000 ? price * (0.06571441 - 15294.68 / Math.max(1, price))
    : price <= 3000000 ? price * 0.0495
    : price * 0.0575,
};

// First-home-buyer [full_exemption_cap, taper_upper_limit]
const FHB_THRESHOLDS = {
  NSW: [800000, 1000000],
  VIC: [600000, 750000],
  QLD: [700000, 800000],  // Updated: QLD raised FHB threshold in 2024
  WA:  [450000, 600000],  // Updated: WA raised FHB threshold
  SA:  [650000, 800000],  // SA FHB exemption/concession thresholds
  TAS: [600000, 750000],
  ACT: [1000000, 1455000],
  NT:  [0, 0],
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

function estimateLMI(loanAmount, propertyPrice) {
  if (propertyPrice <= 0 || loanAmount <= 0) return 0;
  const lvr = loanAmount / propertyPrice * 100;
  let rate = 0;
  if (lvr <= 80) rate = 0;
  else if (lvr <= 85) rate = 0.008;
  else if (lvr <= 90) rate = 0.015;
  else if (lvr <= 95) rate = 0.025;
  else rate = 0.035;
  return Math.round(loanAmount * rate / 100) * 100;
}

// Scheduled annual P&I (or IO) mortgage repayment
function annualMortgageRepayment(principal, annualRate, termYears, interestOnly) {
  if (principal <= 0 || termYears <= 0) return 0;
  if (interestOnly) return principal * annualRate;
  if (annualRate <= 0) return principal / termYears;
  const r = annualRate / 12;
  const n = termYears * 12;
  const monthly = principal * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
  return monthly * 12;
}

// Advance mortgage by 1 year (12 monthly compounding steps).
// An offset balance reduces the interest-bearing balance dollar-for-dollar.
function amortizeYear(balance, annualRate, annualPayment, interestOnly, offsetBalance = 0) {
  if (balance <= 0) return { balance: 0, interest: 0, principal: 0, totalPaid: 0 };
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
  return {
    balance: Math.max(0, balance),
    interest,
    principal,
    totalPaid: interest + principal,
  };
}

// Grows an ETF portfolio balance by 1 year:
// Australian Franking Credit Math: Grossed up for 30% company tax, with refundable
// tax offsets if marginal tax rate is below 30%.
function growEtfYear(balance, year, opts) {
  const { dividendYield, frankedFraction, taxRate, companyTaxRate, priceGrowthRate, lots } = opts;
  const div = Math.max(0, balance) * dividendYield;
  const frankedDiv = div * frankedFraction;
  const unfrankedDiv = div - frankedDiv;

  const grossedFrankedDiv = frankedDiv > 0 ? (frankedDiv / (1 - companyTaxRate)) : 0;
  const frankingCredit = grossedFrankedDiv * companyTaxRate;
  const taxOnGrossed = grossedFrankedDiv * taxRate;
  const netFrankedTax = taxOnGrossed - frankingCredit; // Can be negative (refund) if taxRate < 0.30
  const unfrankedTax = unfrankedDiv * taxRate;
  const divTax = netFrankedTax + unfrankedTax;
  const netDiv = div - divTax;

  let newBalance = balance + netDiv;
  let basisDelta = Math.max(0, netDiv);
  if (netDiv > 0 && lots) lots.push({ year, amount: netDiv });

  newBalance *= (1 + priceGrowthRate);
  newBalance = Math.max(0, newBalance);
  return { balance: newBalance, basisDelta, divTax };
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
    taxRateMethod = 'income', grossSalary = 0, salaryGrowth = true,
    isInvestmentProperty, rentalIncome, allowNegativeGearing,
    vacancyWeeks = 0, propertyManagementRate = 0, landTax = 0, depreciationDeduction = 0,
    cgtDiscount, mainResidence, inflation,
    cgtMethod = 'fy27', isPensioner = false,
  } = inp;

  const light = !!opts.light;
  const vol   = opts.vol || 0;
  const shock = opts.shock || null;

  const companyTaxRate = 0.30;
  const frankedFraction = frankingLevel;

  // Buyer upfront cash beyond deposit
  const buyerUpfrontCash = Math.max(0, (financeStampDuty ? 0 : stampDuty) + legalFeesBuy
    + (financeLMI ? 0 : lmiAmount) - fhogAmount);

  // Exact Day-1 parity: Deposit + upfront costs are capped to total savings
  const maxDeposit = Math.max(0, totalSavings - buyerUpfrontCash);
  const actualDeposit = Math.min(deposit, maxDeposit);
  const buyerSurplus = Math.max(0, totalSavings - actualDeposit - buyerUpfrontCash);

  const loanAmount = Math.max(0, propertyPrice - actualDeposit + (financeStampDuty ? stampDuty : 0) + (financeLMI ? lmiAmount : 0));
  const annualRepayment = annualMortgageRepayment(loanAmount, mortgageRate, loanTerm, interestOnly);

  let offsetBalance = surplusDestination === 'offset' ? buyerSurplus : 0;
  let buyerEtf = surplusDestination === 'etf' ? buyerSurplus : 0;
  let buyerEtfBasis = buyerEtf;
  const buyerEtfLots = buyerEtf > 0 ? [{ year: 0, amount: buyerEtf }] : [];

  // Renter invests 100% of Total Savings from Day 0
  const renterInitial = Math.max(0, totalSavings);

  let propertyValue = propertyPrice;
  let mortgageBalance = loanAmount;
  let portfolio = renterInitial;
  let portfolioBasis = renterInitial;
  const basisLots = renterInitial > 0 ? [{ year: 0, amount: renterInitial }] : [];

  const rows = [];
  let breakevenYear = null;
  let finalTaxRate = taxRate;

  for (let year = 1; year <= years; year++) {
    const z = shock ? shock(year - 1) : 0;
    const propGrowthY = propertyGrowth + vol * z * 0.5;
    const investReturnY = investReturn + vol * z;

    const salaryY = salaryGrowth ? grossSalary * Math.pow(1 + inflation, year - 1) : grossSalary;
    const taxRateY = taxRateMethod === 'income' ? marginalTaxRate(salaryY) : taxRate;
    finalTaxRate = taxRateY;

    propertyValue *= (1 + propGrowthY);

    const maint = propertyValue * maintenanceRate;
    const rates = councilRates * Math.pow(1 + inflation, year - 1)
      + bodyCorp * Math.pow(1 + bodyCorpGrowth, year - 1);
    const ownerIns = ownerInsurance * Math.pow(1 + inflation, year - 1);

    // Amortise mortgage and capture ACTUAL repayments made this year
    const { balance: newBalance, interest: interestPaid, principal: principalPaid, totalPaid: mortgagePaid } =
      amortizeYear(mortgageBalance, mortgageRate, annualRepayment, interestOnly, offsetBalance);
    mortgageBalance = newBalance;

    // Offset balance overflow to buyer ETF if loan is fully covered/paid
    if (offsetBalance > mortgageBalance) {
      const excess = offsetBalance - mortgageBalance;
      offsetBalance = mortgageBalance;
      buyerEtf += excess;
      buyerEtfBasis += excess;
      buyerEtfLots.push({ year, amount: excess });
    }

    const annualRent = (weeklyRent * 52) * Math.pow(1 + rentGrowth, year - 1);
    const renterIns = renterInsurance * Math.pow(1 + inflation, year - 1);
    const landTaxY = isInvestmentProperty ? landTax * Math.pow(1 + inflation, year - 1) : 0;

    let annualRentalIncome = 0, negGearingBenefit = 0;
    if (isInvestmentProperty) {
      const grossRentalIncome = (rentalIncome * 52) * Math.pow(1 + rentGrowth, year - 1);
      const occupancyFactor = Math.max(0, 1 - vacancyWeeks / 52);
      const managementFee = grossRentalIncome * occupancyFactor * (propertyManagementRate / 100);
      annualRentalIncome = grossRentalIncome * occupancyFactor - managementFee;

      const depreciationY = depreciationDeduction * Math.pow(1 + inflation, year - 1);
      const cashLoss = mortgagePaid + maint + rates + ownerIns + landTaxY - annualRentalIncome;
      const taxableLoss = cashLoss + depreciationY;
      if (allowNegativeGearing && taxableLoss > 0) negGearingBenefit = taxableLoss * taxRateY;
      else if (taxableLoss < 0) {
        negGearingBenefit = taxableLoss * taxRateY;
      }
    }

    // Actual owner carry based on real cash paid (no phantom payments after payoff)
    const ownerCarry = mortgagePaid + maint + rates + ownerIns + landTaxY - annualRentalIncome - negGearingBenefit;
    const renterCarry = annualRent + renterIns;
    const gap = ownerCarry - renterCarry;

    // Differential Cash-Flow Allocation (Symmetric):
    if (gap < 0) {
      // Owning is cheaper: Buyer saves surplus
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
    } else if (gap > 0) {
      // Renting is cheaper: Renter saves surplus
      portfolio += gap;
      portfolioBasis += gap;
      basisLots.push({ year, amount: gap });
    }

    // Compound ETF portfolios
    const priceGrowthRate = Math.max(investReturnY - dividendYield, -0.99);
    const etfOpts = { dividendYield, frankedFraction, taxRate: taxRateY, companyTaxRate, priceGrowthRate };

    const rGrown = growEtfYear(portfolio, year, { ...etfOpts, lots: basisLots });
    portfolio = rGrown.balance;
    portfolioBasis += rGrown.basisDelta;
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
        annualRepayment: mortgagePaid, maint, rates, ownerIns, landTax: landTaxY, ownerCarry,
        annualRent, renterIns, renterCarry, gap,
        interestPaid, principalPaid,
        portfolio, divTax,
        annualRentalIncome, negGearingBenefit,
        offsetBalance, buyerEtf,
      });

      if (breakevenYear == null && equity >= portfolio) breakevenYear = year;
    }
  }

  // CGT Calculator
  const computeCgt = (balance, basis, lots) => {
    if (cgtMethod === 'fy27') {
      const indexedBasis = lots.reduce((sum, lot) => sum + lot.amount * Math.pow(1 + inflation, years - lot.year), 0);
      const taxableGain = Math.max(0, balance - indexedBasis);
      const effRate = isPensioner ? finalTaxRate : Math.max(finalTaxRate, 0.30);
      return effRate * taxableGain;
    }
    const taxableGain = (1 - cgtDiscount) * Math.max(0, balance - basis);
    return finalTaxRate * taxableGain;
  };

  // Exit liquidations
  const sellingCosts = agentFeeRate * propertyValue + legalFeesSell;
  const bond = (weeklyRent * bondWeeks) * Math.pow(1 + rentGrowth, years - 1);

  const buyerEtfSellFee = buyerEtf * etfSellFeeRate;
  const buyerEtfCgt = buyerEtf > 0 ? computeCgt(buyerEtf, buyerEtfBasis, buyerEtfLots) : 0;
  const buyerEtfNet = buyerEtf - buyerEtfCgt - buyerEtfSellFee;
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

function discountToday(futureValue, rate, years) {
  if (rate == null) return futureValue;
  return futureValue / Math.pow(1 + rate, years);
}

// ══════════════════════════════════════════════════════════
//  MONTE CARLO SIMULATION & PERCENTILE CONE
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
  let buyWins = 0;

  const equityYearly = Array.from({ length: years + 1 }, () => []);
  const portfolioYearly = Array.from({ length: years + 1 }, () => []);

  for (let s = 0; s < nSims; s++) {
    const zs = new Array(years);
    for (let i = 0; i < years; i += 2) {
      const u1 = Math.max(rand(), 1e-9), u2 = rand();
      const m = Math.sqrt(-2 * Math.log(u1));
      zs[i] = m * Math.cos(2 * Math.PI * u2);
      if (i + 1 < years) zs[i + 1] = m * Math.sin(2 * Math.PI * u2);
    }
    const res = project(inp, { light: false, shock: y => zs[y] ?? 0, vol: inp.retVol });
    if (res.buyNet >= res.rentNet) buyWins++;

    equityYearly[0].push(res.actualDeposit);
    portfolioYearly[0].push(res.renterInitial);
    for (let y = 0; y < res.rows.length; y++) {
      equityYearly[y + 1].push(res.rows[y].equity);
      portfolioYearly[y + 1].push(res.rows[y].portfolio);
    }
  }

  const percentile = (arr, p) => {
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.floor(sorted.length * p);
    return sorted[Math.min(idx, sorted.length - 1)];
  };

  const equityP10 = equityYearly.map(arr => percentile(arr, 0.10));
  const equityP90 = equityYearly.map(arr => percentile(arr, 0.90));
  const portfolioP10 = portfolioYearly.map(arr => percentile(arr, 0.10));
  const portfolioP90 = portfolioYearly.map(arr => percentile(arr, 0.90));

  return {
    buySuccess: buyWins / nSims,
    n: nSims,
    equityP10, equityP90,
    portfolioP10, portfolioP90,
  };
}

// ══════════════════════════════════════════════════════════
//  CITY BENCHMARK PRESETS
// ══════════════════════════════════════════════════════════

const CITY_PRESETS = {
  sydney: {
    state: 'NSW', propertyPrice: 1150000, deposit: 230000, totalSavings: 290000,
    weeklyRent: 780, councilRates: 1800, bodyCorp: 1200, ownerInsurance: 2200, renterInsurance: 550,
  },
  melbourne: {
    state: 'VIC', propertyPrice: 880000, deposit: 176000, totalSavings: 230000,
    weeklyRent: 620, councilRates: 2200, bodyCorp: 1000, ownerInsurance: 1800, renterInsurance: 500,
  },
  brisbane: {
    state: 'QLD', propertyPrice: 820000, deposit: 164000, totalSavings: 210000,
    weeklyRent: 610, councilRates: 2400, bodyCorp: 900, ownerInsurance: 2400, renterInsurance: 500,
  },
  perth: {
    state: 'WA', propertyPrice: 720000, deposit: 144000, totalSavings: 185000,
    weeklyRent: 580, councilRates: 2000, bodyCorp: 800, ownerInsurance: 1700, renterInsurance: 450,
  },
  adelaide: {
    state: 'SA', propertyPrice: 700000, deposit: 140000, totalSavings: 180000,
    weeklyRent: 560, councilRates: 1900, bodyCorp: 750, ownerInsurance: 1600, renterInsurance: 450,
  },
  canberra: {
    state: 'ACT', propertyPrice: 850000, deposit: 170000, totalSavings: 220000,
    weeklyRent: 650, councilRates: 3000, bodyCorp: 1100, ownerInsurance: 1900, renterInsurance: 500,
  },
};

function applyCityPreset(cityName) {
  const preset = CITY_PRESETS[cityName];
  if (!preset) return;
  Object.entries(preset).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  });
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.classList.toggle('active', btn.textContent.toLowerCase().includes(cityName));
  });
  autoStampDuty();
  calc();
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

const STORAGE_KEY = 'au-rentvsbuy-calc-v2';

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
  } catch (_) {}
}

function loadState() {
  try {
    const savedStr = localStorage.getItem(STORAGE_KEY);
    if (!savedStr) return false;
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
    btn.textContent = '✓ Copied';
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
      prompt('Copy the logs here:', window._lastAuditLog);
    });
  } else {
    prompt('Copy the logs here:', window._lastAuditLog);
  }
}

function resetDefaults() {
  if (!confirm('Reset all inputs to defaults?')) return;
  localStorage.removeItem(STORAGE_KEY);
  location.href = location.pathname;
}

function csvField(v) {
  const s = v == null ? '' : String(v);
  const needsQuoting = s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1;
  return needsQuoting ? '"' + s.split('"').join('""') + '"' : s;
}
function csvRow(vals) { return vals.map(csvField).join(','); }

function exportCSV() {
  if (!_lastRows.length || !_lastResult || !_lastInp) return;
  const inp = _lastInp, result = _lastResult, mc = _lastMc;
  const out = [];

  out.push('Australian Rent vs Buy Calculator — Comprehensive Financial Export');
  out.push('All values in nominal AUD unless labeled NPV or today\'s dollars');
  out.push('');

  out.push('=== SUMMARY ===');
  const npvDelta = result.npvRent - result.npvBuy;
  out.push(csvRow(['Analysis Horizon (years)', inp.years]));
  out.push(csvRow(['NPV of Buying', Math.round(result.npvBuy)]));
  out.push(csvRow(['NPV of Renting', Math.round(result.npvRent)]));
  out.push(csvRow(['NPV Verdict', npvDelta >= 0 ? 'Rent wins' : 'Buy wins']));
  out.push(csvRow(['NPV Margin', Math.round(Math.abs(npvDelta))]));
  out.push(csvRow(['Nominal Buy Net Position', Math.round(result.buyNet)]));
  out.push(csvRow(['Nominal Rent Net Position', Math.round(result.rentNet)]));
  out.push(csvRow(['Break-even Year', result.breakevenYear ?? 'Not reached']));
  if (mc) out.push(csvRow(['Monte Carlo Buy Win Rate', pct(mc.buySuccess)]));
  out.push('');

  out.push('=== YEAR-BY-YEAR PROJECTION ===');
  out.push(csvRow(['Year', 'Property Value', 'Mortgage Balance', 'Offset Balance', 'Buyer ETF Surplus',
    'Owner Equity', 'Mortgage Repayment', 'Maintenance', 'Rates/Strata', 'Owner Insurance', 'Land Tax',
    'Total Owning Cost', 'Annual Rent', 'Renter Insurance', 'Total Renting Cost',
    'Cash-flow Gap (Renter Savings)', 'Renter Portfolio', 'Dividend Tax']));
  _lastRows.forEach(r => {
    out.push(csvRow([
      r.year, Math.round(r.propertyValue), Math.round(r.mortgageBalance),
      Math.round(r.offsetBalance || 0), Math.round(r.buyerEtf || 0), Math.round(r.equity),
      Math.round(r.annualRepayment), Math.round(r.maint), Math.round(r.rates), Math.round(r.ownerIns),
      Math.round(r.landTax || 0),
      Math.round(r.ownerCarry), Math.round(r.annualRent), Math.round(r.renterIns), Math.round(r.renterCarry),
      Math.round(r.gap), Math.round(r.portfolio), Math.round(r.divTax || 0),
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
  document.getElementById('dark-toggle').textContent = dark ? '☀️' : '🌙';
  Chart.defaults.color = dark ? '#94A3B8' : '#64748B';
  _calc();
}

function initDark() {
  const dark = localStorage.getItem('au-rentvsbuy-dark') === '1';
  if (dark) {
    document.body.classList.add('dark');
    Chart.defaults.color = '#94A3B8';
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

function switchMobileTab(tab) {
  const inputPanel = document.getElementById('input-panel');
  const resultsPanel = document.getElementById('results-panel');
  const tabInputs = document.getElementById('tab-btn-inputs');
  const tabResults = document.getElementById('tab-btn-results');

  if (tab === 'inputs') {
    inputPanel.classList.remove('mobile-hidden');
    resultsPanel.classList.add('mobile-hidden');
    tabInputs.classList.add('active');
    tabResults.classList.remove('active');
  } else {
    inputPanel.classList.add('mobile-hidden');
    resultsPanel.classList.remove('mobile-hidden');
    tabInputs.classList.remove('active');
    tabResults.classList.add('active');
  }
}

function syncRange(el, lblId, pre, suf) {
  const v = parseFloat(el.value);
  const lbl = document.getElementById(lblId);
  if (lbl) lbl.textContent = pre + v + suf;
  const min = parseFloat(el.min || 0), max = parseFloat(el.max || 100);
  el.style.setProperty('--val', ((v - min) / (max - min) * 100).toFixed(1) + '%');
}

function syncDualInput(sourceId, targetId, lblId, pre, suf) {
  const src = document.getElementById(sourceId);
  const tgt = document.getElementById(targetId);
  if (!src) return;
  const v = parseFloat(src.value);
  if (tgt && !isNaN(v)) tgt.value = v;
  const lbl = document.getElementById(lblId);
  if (lbl && !isNaN(v)) lbl.textContent = pre + v + suf;
  const min = parseFloat(src.min || 0), max = parseFloat(src.max || 100);
  src.style.setProperty('--val', ((v - min) / (max - min) * 100).toFixed(1) + '%');
  if (tgt && tgt.type === 'range') {
    tgt.style.setProperty('--val', ((v - min) / (max - min) * 100).toFixed(1) + '%');
  }
}

function updateRangeLabels() {
  [
    ['years', 'yearsNum', 'lbl-years', '', ' yrs'],
    ['taxRate', 'taxRateNum', 'lbl-taxrate', '', '%'],
    ['propertyGrowth', 'propertyGrowthNum', 'lbl-propgrowth', '', '%'],
    ['agentFeeRate', 'agentFeeRateNum', 'lbl-agent', '', '%'],
    ['maintenanceRate', 'maintenanceRateNum', 'lbl-maint', '', '%'],
    ['bodyCorpGrowth', 'bodyCorpGrowthNum', 'lbl-bcgrowth', '', '%'],
    ['rentGrowth', 'rentGrowthNum', 'lbl-rentgrowth', '', '%'],
    ['investReturn', 'investReturnNum', 'lbl-invret', '', '%'],
    ['dividendYield', 'dividendYieldNum', 'lbl-divyield', '', '%'],
    ['frankingLevel', 'frankingLevelNum', 'lbl-franking', '', '%'],
    ['etfSellFeeRate', 'etfSellFeeRateNum', 'lbl-etfsell', '', '%'],
    ['inflation', 'inflationNum', 'lbl-inflation', '', '%'],
    ['retVol', 'retVolNum', 'lbl-vol', '', '%'],
  ].forEach(([rangeId, numId, lbl, pre, suf]) => {
    syncDualInput(rangeId, numId, lbl, pre, suf);
  });
}

function autoStampDuty() {
  const price = parseFloat(document.getElementById('propertyPrice').value) || 0;
  const fhb = document.getElementById('firstHomeBuyer')?.checked;
  const state = document.getElementById('state')?.value || 'NSW';
  document.getElementById('stampDuty').value = estimateStampDuty(price, fhb, state);
  calc();
}

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

Chart.defaults.font.family = "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif";
Chart.defaults.font.size   = 11;
Chart.defaults.color       = '#64748B';

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
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px, area.top);
      ctx.lineTo(px, area.bottom);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = '700 10px sans-serif';
      ctx.textAlign = 'left';
      ctx.translate(px, area.top);
      ctx.rotate(Math.PI / 2);
      ctx.fillText(label, 6, -6);
      ctx.restore();
    });
  },
};
Chart.register(msLinesPlugin);

function gc() { return isDark() ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'; }

function buildProjectionChart(rows, result, inp, mc) {
  const ctx = document.getElementById('chart-projection').getContext('2d');
  const isD = isDark();
  const G = gc();

  const labels = ['Yr 0', ...rows.map(r => `Yr ${r.year}`)];
  const equityData = [result.actualDeposit, ...rows.map(r => r.equity)];
  const portData   = [result.renterInitial, ...rows.map(r => r.portfolio)];

  const datasets = [];

  // Render Monte Carlo confidence band if enabled
  if (mc && mc.equityP10 && mc.equityP90) {
    datasets.push({
      label: 'Owner Equity (90th percentile)',
      data: mc.equityP90,
      borderColor: 'transparent',
      backgroundColor: isD ? 'rgba(52, 211, 153, 0.08)' : 'rgba(5, 150, 105, 0.08)',
      pointRadius: 0,
      fill: '+1',
    });
    datasets.push({
      label: 'Owner Equity (10th percentile)',
      data: mc.equityP10,
      borderColor: 'transparent',
      backgroundColor: 'transparent',
      pointRadius: 0,
      fill: false,
    });
    datasets.push({
      label: 'Renter Portfolio (90th percentile)',
      data: mc.portfolioP90,
      borderColor: 'transparent',
      backgroundColor: isD ? 'rgba(96, 165, 250, 0.08)' : 'rgba(37, 99, 235, 0.08)',
      pointRadius: 0,
      fill: '+1',
    });
    datasets.push({
      label: 'Renter Portfolio (10th percentile)',
      data: mc.portfolioP10,
      borderColor: 'transparent',
      backgroundColor: 'transparent',
      pointRadius: 0,
      fill: false,
    });
  }

  datasets.push({
    label: 'Owner Equity (Deterministic)',
    data: equityData,
    borderColor: isD ? '#34D399' : '#059669',
    backgroundColor: isD ? 'rgba(52, 211, 153, 0.15)' : 'rgba(5, 150, 105, 0.10)',
    fill: true,
    tension: 0.35,
    borderWidth: 2.5,
    pointRadius: 0,
    pointHoverRadius: 5,
  });

  datasets.push({
    label: 'Renter Portfolio (Deterministic)',
    data: portData,
    borderColor: isD ? '#60A5FA' : '#2563EB',
    backgroundColor: isD ? 'rgba(96, 165, 250, 0.15)' : 'rgba(37, 99, 235, 0.10)',
    fill: true,
    tension: 0.35,
    borderWidth: 2.5,
    pointRadius: 0,
    pointHoverRadius: 5,
  });

  const msLines = [];
  if (result.breakevenYear != null) {
    msLines.push({ idx: result.breakevenYear, color: isD ? '#FBBF24' : '#D97706', label: `Break-even (Yr ${result.breakevenYear})` });
  }

  if (charts.proj) charts.proj.destroy();
  charts.proj = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        msLines: { lines: msLines },
        legend: {
          position: 'bottom',
          labels: {
            filter: item => !item.text.includes('percentile'),
            boxWidth: 12,
            padding: 12,
            font: { size: 11, weight: '600' },
          },
        },
        tooltip: {
          callbacks: {
            label: c => c.dataset.label.includes('percentile') ? '' : ` ${c.dataset.label}: ${fmt(c.parsed.y)}`,
          },
        },
      },
      scales: {
        x: { grid: { color: G } },
        y: {
          grid: { color: G },
          ticks: { callback: v => v >= 1e6 ? '$' + (v / 1e6).toFixed(2) + 'M' : '$' + (v / 1000).toFixed(0) + 'K' },
        },
      },
    },
  });
}

function buildFinalChart(result) {
  const ctx = document.getElementById('chart-final').getContext('2d');
  const isD = isDark();
  const labels = ['Buy (PPOR)', 'Rent & Invest'];
  const colorNom = isD ? ['#34D399', '#60A5FA'] : ['#059669', '#2563EB'];
  const colorNpv = isD ? ['#6EE7B7', '#93C5FD'] : ['#10B981', '#3B82F6'];

  if (charts.final) charts.final.destroy();
  charts.final = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: `Nominal (Year ${result.rows.length})`, data: [result.buyNet, result.rentNet], backgroundColor: colorNom.map(c => c + 'CC'), borderColor: colorNom, borderWidth: 1.5, borderRadius: 6 },
        { label: "NPV (Today's $)", data: [result.npvBuy, result.npvRent], backgroundColor: colorNpv.map(c => c + 'CC'), borderColor: colorNpv, borderWidth: 1.5, borderRadius: 6 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10, font: { weight: '600' } } },
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
  const labels = ['Mortgage Repayments', 'Maintenance', 'Rates / Strata', 'Building Insurance', 'Land Tax'];
  const colors = isD ? ['#34D399', '#F87171', '#FBBF24', '#60A5FA', '#A78BFA'] : ['#059669', '#DC2626', '#D97706', '#2563EB', '#7C3AED'];
  const vals = raw.map((v, i) => ({ v, l: labels[i], c: colors[i] })).filter(x => x.v > 0);
  const grossCost = vals.reduce((s, x) => s + x.v, 0);

  if (charts.owncost) charts.owncost.destroy();
  charts.owncost = new Chart(ctx, {
    type: 'doughnut',
    data: { labels: vals.map(x => x.l), datasets: [{ data: vals.map(x => x.v), backgroundColor: vals.map(x => x.c + 'DD'), borderColor: vals.map(x => x.c), borderWidth: 2, hoverOffset: 6 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 10, padding: 8 } },
        tooltip: { callbacks: { label: c => ` ${c.label}: ${fmt(c.parsed)} (${(c.parsed / Math.max(1, grossCost) * 100).toFixed(0)}%)` } },
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
      labels: rows.map(r => `Yr ${r.year}`),
      datasets: [{
        label: 'Cash-flow Differential',
        data: rows.map(r => r.gap),
        backgroundColor: rows.map(r => r.gap >= 0 ? (isD ? 'rgba(96,165,250,0.7)' : 'rgba(37,99,235,0.7)') : (isD ? 'rgba(52,211,153,0.7)' : 'rgba(5,150,105,0.7)')),
        borderColor: rows.map(r => r.gap >= 0 ? (isD ? '#60A5FA' : '#2563EB') : (isD ? '#34D399' : '#059669')),
        borderWidth: 1,
        borderRadius: 3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => ` ${fmt(c.parsed.y)}/yr ${c.parsed.y >= 0 ? '(Renter saves difference)' : '(Buyer saves difference)'}` } },
      },
      scales: {
        x: { grid: { display: false } },
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
      labels: rows.map(r => `Yr ${r.year}`),
      datasets: [
        { label: 'Property Value', data: rows.map(r => r.propertyValue), borderColor: isD ? '#34D399' : '#059669', backgroundColor: 'transparent', fill: false, tension: 0.35, borderWidth: 2, pointRadius: 0 },
        { label: 'Mortgage Balance', data: rows.map(r => r.mortgageBalance), borderColor: isD ? '#FB7185' : '#E11D48', backgroundColor: 'transparent', fill: false, tension: 0.35, borderWidth: 2, pointRadius: 0 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10 } },
        tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${fmt(c.parsed.y)}` } },
      },
      scales: {
        x: { grid: { color: G } },
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
  const npvWinner = npvDelta >= 0 ? 'Renting &amp; Investing' : 'Buying (PPOR)';
  const npvMargin = Math.abs(npvDelta);
  const kicker = `Over a ${inp.years}-Year Horizon · In Today's Dollars (NPV @ ${(inp.npvDiscountRate * 100).toFixed(1)}%)`;

  const surplusReason = inp.surplusDestination === 'offset'
    ? `buyer surplus (${fmt(result.buyerSurplus)}) earning tax-free mortgage offset returns`
    : `buyer surplus (${fmt(result.buyerSurplus)}) invested in ETFs`;
  const reason = result.buyerSurplus > 0.5
    ? `accounting for mortgage amortisation, all carrying costs, taxes, and ${surplusReason}`
    : `accounting for mortgage amortisation, ongoing property costs, and differential tax treatment`;

  const head = `<b>${npvWinner}</b> leads by <b>${fmtK(npvMargin)}</b> in real present value ${reason}`;

  const chip = (label, val) => `<span class="chip">${label}: <b>${val}</b></span>`;

  let mcChip = '';
  if (mc) {
    const s = Math.round(mc.buySuccess * 100);
    mcChip = `<span class="chip mc-badge ${s >= 50 ? 'good' : 'bad'}" title="Share of ${mc.n} Monte Carlo simulation runs favoring Buying">Monte Carlo: <b>${s}%</b> favor Buying</span>`;
  }

  const breakevenChip = result.breakevenYear != null
    ? chip('Break-even', `Year ${result.breakevenYear}`)
    : chip('Break-even', 'Beyond horizon');

  const nominalWinner = result.delta >= 0 ? 'Rent' : 'Buy';

  el.classList.remove('hero-rent-wins', 'hero-buy-wins');
  el.classList.add(npvDelta >= 0 ? 'hero-rent-wins' : 'hero-buy-wins');

  el.innerHTML = `
    <div class="hero-kicker">${kicker}</div>
    <div class="hero-headline">${head}</div>
    <div class="hero-chips">
      ${chip('NPV Buy', fmtK(result.npvBuy))}
      ${chip('NPV Rent', fmtK(result.npvRent))}
      ${chip('Nominal Winner', nominalWinner + ' by ' + fmtK(Math.abs(result.delta)))}
      ${breakevenChip}
      ${mcChip}
    </div>
  `;
}

// ══════════════════════════════════════════════════════════
//  MILESTONE CARDS
// ══════════════════════════════════════════════════════════

function renderCard(prefix, valueLabel, subNumber, descLines, progressPct, pctLabel) {
  const ageEl  = document.getElementById(`${prefix}-age`);
  const numEl  = document.getElementById(`${prefix}-number`);
  const descEl = document.getElementById(`${prefix}-desc`);
  const barEl  = document.getElementById(`${prefix}-bar`);
  const pctEl  = document.getElementById(`${prefix}-pct`);
  if (!ageEl) return;

  ageEl.textContent = valueLabel;
  if (numEl) numEl.textContent = subNumber || '';
  if (descEl) descEl.innerHTML = descLines;

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
    const cls = favoursBuy ? 'ready' : 'gap';
    const badgeCls = favoursBuy ? 'sc-badge-ready' : 'sc-badge-gap';
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
        <div class="sc-row"><span>Δ Net Position (Rent − Buy)</span><span class="${delta >= 0 ? 'sc-blue' : 'sc-green'}">${fmtK(delta)}</span></div>
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
// ══════════════════════════════════════════════════════════

function solveBreakeven(f, lo, hi, iterations = 40) {
  let fLo = f(lo), fHi = f(hi);
  if (fLo === 0) return lo;
  if (fHi === 0) return hi;
  if ((fLo > 0) === (fHi > 0)) return null;
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
            <div class="sc-sub">No break-even point in realistic range</div>
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
        <div class="sc-row"><span>Break-even Value</span><span class="sc-green">${fmtVal(breakeven)}</span></div>
        <div class="sc-row"><span>Required Change</span><span>${movedUp ? '+' : ''}${fmtVal(breakeven - current, true)}</span></div>
      </div>
      ${note ? `<div class="sc-foot">${note}</div>` : ''}
    </div>`;
  };

  const pctVal = (v, delta) => (delta ? (v * 100 >= 0 ? '+' : '') : '') + (v * 100).toFixed(2) + '%';
  const dollarVal = (v, delta) => (delta && v >= 0 ? '+' : '') + fmt(v);

  const rows = [];
  rows.push(card('🔑', 'Weekly Rent', inp.weeklyRent, solveBreakeven(x => npvDiff('weeklyRent', x), 0, inp.weeklyRent * 5), dollarVal,
    'Starting weekly rent that equalises NPV of both paths.'));
  rows.push(card('📈', 'Rent Growth Rate', inp.rentGrowth, solveBreakeven(x => npvDiff('rentGrowth', x), -0.05, 0.20), pctVal,
    'Annual rent escalation rate required to equalise outcomes.'));
  rows.push(card('🏦', 'Mortgage Interest Rate', inp.mortgageRate, solveBreakeven(x => npvDiff('mortgageRate', x), 0, 0.25), pctVal,
    'Mortgage rate that equalises buying and renting.'));
  rows.push(card('🏠', 'Property Capital Growth', inp.propertyGrowth, solveBreakeven(x => npvDiff('propertyGrowth', x), -0.10, 0.25), pctVal,
    'Annual capital growth needed for equity to match portfolio.'));
  rows.push(card('💹', 'ETF Investment Return', inp.investReturn, solveBreakeven(x => npvDiff('investReturn', Math.max(x, inp.dividendYield)), 0, 0.30), pctVal,
    'Total investment return needed for portfolio to match equity.'));
  rows.push(card('💰', 'Property Purchase Price', inp.propertyPrice, solveBreakeven(x => npvDiff('propertyPrice', x), inp.propertyPrice * 0.2, inp.propertyPrice * 3), dollarVal,
    'Purchase price that equalises the outcome holding other inputs fixed.'));
  rows.push(card('🧾', 'Council Rates', inp.councilRates, solveBreakeven(x => npvDiff('councilRates', x), 0, inp.councilRates * 8 + 5000), dollarVal,
    'Annual municipal rates required to reach break-even.'));
  rows.push(card('🔧', 'Maintenance Rate', inp.maintenanceRate, solveBreakeven(x => npvDiff('maintenanceRate', x), 0, 0.10), pctVal,
    'Annual maintenance cost (% of value) required to equalise.'));

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
  const npvDelta = testRes.npvRent - testRes.npvBuy;
  const winner = npvDelta >= 0 ? 'Rent &amp; Invest' : 'Buying';
  const winnerCls = npvDelta >= 0 ? 'wb-delta-good' : 'wb-delta-bad';

  document.getElementById('wi-global-result').innerHTML = `
    <div class="whatif-box">
      <div class="wb-label">NPV Winner at ${testYears} yrs</div>
      <div class="wb-val ${winnerCls}">${winner}</div>
      <div class="wb-sub">leads by ${fmtK(Math.abs(npvDelta))} (today's $)</div>
    </div>
    <div class="whatif-box">
      <div class="wb-label">Buy Net Position</div>
      <div class="wb-val">${fmtK(testRes.buyNet)}</div>
      <div class="wb-sub">NPV: ${fmtK(testRes.npvBuy)}</div>
    </div>
    <div class="whatif-box">
      <div class="wb-label">Rent Net Position</div>
      <div class="wb-val">${fmtK(testRes.rentNet)}</div>
      <div class="wb-sub">NPV: ${fmtK(testRes.npvRent)}</div>
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
      <td class="yt-l">Yr ${r.year}</td>
      <td>${fmtK(r.propertyValue)}</td>
      <td>${fmtK(r.mortgageBalance)}</td>
      <td>${fmtK(r.offsetBalance || 0)}</td>
      <td>${fmtK(r.buyerEtf || 0)}</td>
      <td><strong>${fmtK(r.equity)}</strong></td>
      <td>${f(r.annualRepayment)}</td>
      <td>${f(r.maint)}</td>
      <td>${f(r.rates)}</td>
      <td>${f(r.ownerIns)}</td>
      <td>${f(r.ownerCarry)}</td>
      <td>${f(r.annualRent)}</td>
      <td>${f(r.renterCarry)}</td>
      <td class="${r.gap >= 0 ? 'sc-blue' : 'sc-green'}">${f(r.gap)}</td>
      <td><strong>${fmtK(r.portfolio)}</strong></td>
    </tr>`).join('');

  el.innerHTML = `
    <table class="year-table">
      <thead><tr>
        <th class="yt-l">Year</th><th>Property Value</th><th>Mortgage Debt</th><th>Offset</th><th>Buyer ETF</th><th>Owner Equity</th>
        <th>Repayment</th><th>Maint.</th><th>Rates/Strata</th><th>Insurance</th><th>Total Owning</th>
        <th>Rent</th><th>Total Renting</th><th>Cash-Flow Gap</th><th>Renter Portfolio</th>
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
  debounceTimer = setTimeout(_calc, 60);
}

function _calc() {
  const inp = getInputs();
  _lastInp = inp;

  updateConditionalUI();

  // Dynamic header horizon pill
  const horizonPill = document.getElementById('header-horizon-pill');
  if (horizonPill) horizonPill.textContent = `${inp.years}yr Outcome`;

  const buyerUpfrontCash = Math.max(0, (inp.financeStampDuty ? 0 : inp.stampDuty) + inp.legalFeesBuy
    + (inp.financeLMI ? 0 : inp.lmiAmount) - inp.fhogAmount);
  const maxDeposit = Math.max(0, inp.totalSavings - buyerUpfrontCash);
  const actualDeposit = Math.min(inp.deposit, maxDeposit);
  const surplus = Math.max(0, inp.totalSavings - actualDeposit - buyerUpfrontCash);

  const depositSavingsHint = document.getElementById('deposit-savings-hint');
  if (depositSavingsHint) {
    depositSavingsHint.textContent = inp.deposit > maxDeposit
      ? `⚠ Deposit exceeds available cash after upfront costs (${fmt(maxDeposit)}) — auto-adjusted to ${fmt(actualDeposit)}`
      : '';
  }

  const lvrHint = document.getElementById('lvr-hint');
  if (lvrHint) {
    const loan = Math.max(0, inp.propertyPrice - actualDeposit + (inp.financeStampDuty ? inp.stampDuty : 0) + (inp.financeLMI ? inp.lmiAmount : 0));
    const lvr = inp.propertyPrice > 0 ? (loan / inp.propertyPrice * 100) : 0;
    const lmiNote = lvr > 80 && inp.lmiAmount <= 0 ? ' — LMI required (click Auto-estimate)' : '';
    lvrHint.textContent = `Loan: ${fmt(loan)} · LVR ${lvr.toFixed(1)}%${lmiNote}`;
  }

  const mortgageHint = document.getElementById('mortgage-repayment-hint');
  if (mortgageHint) {
    const loan = Math.max(0, inp.propertyPrice - actualDeposit
      + (inp.financeStampDuty ? inp.stampDuty : 0)
      + (inp.financeLMI ? inp.lmiAmount : 0));
    const repay = annualMortgageRepayment(loan, inp.mortgageRate, inp.loanTerm, inp.interestOnly);
    mortgageHint.textContent = repay > 0
      ? `Repayment: ${fmt(repay)}/yr (${fmt(repay / 52)}/wk)${inp.interestOnly ? ' — Interest Only' : ''}`
      : '';
  }

  const savingsBreakdownHint = document.getElementById('savings-breakdown-hint');
  if (savingsBreakdownHint) {
    savingsBreakdownHint.textContent = `Day 1 Parity: Buy = ${fmt(actualDeposit)} deposit + ${fmt(buyerUpfrontCash)} upfront + ${fmt(surplus)} surplus → ${inp.surplusDestination} · Rent = ${fmt(inp.totalSavings)} fully invested in ETFs`;
  }

  const divYieldWarn = document.getElementById('divyield-warn');
  if (divYieldWarn) {
    divYieldWarn.classList.toggle('show', inp.dividendYield > inp.investReturn);
  }

  const taxRateHint = document.getElementById('tax-rate-hint');
  if (taxRateHint && inp.taxRateMethod === 'income') {
    const startRate = marginalTaxRate(inp.grossSalary);
    const endSalary = inp.salaryGrowth ? inp.grossSalary * Math.pow(1 + inp.inflation, inp.years - 1) : inp.grossSalary;
    const endRate = marginalTaxRate(endSalary);
    taxRateHint.textContent = `Marginal Tax Rate: ${pct(startRate)} today`
      + (Math.abs(endRate - startRate) > 0.001 ? ` → ${pct(endRate)} at Year ${inp.years} (${fmt(endSalary)} salary)` : ` (stays in ${pct(startRate)} bracket over horizon)`);
  }

  const negGearingHint = document.getElementById('neg-gearing-hint');
  if (negGearingHint) {
    negGearingHint.textContent = inp.allowNegativeGearing
      ? 'Negative gearing enabled: net rental losses offset other taxable income at your marginal rate.'
      : 'Negative gearing disabled: net rental losses cannot offset salary (post-FY27 policy baseline).';
  }

  const result = project(inp);
  const mc = runMonteCarlo(inp);
  _lastRows = result.rows;
  _lastResult = result;
  _lastMc = mc;

  window._lastAuditLog = [
    '🏡 Australian Rent vs Buy Calculator Audit Logs',
    '1. Parsed Inputs:\n' + JSON.stringify(inp, null, 2),
    '2. Projection Result:\n' + JSON.stringify(result, null, 2),
    '3. Monte Carlo Result:\n' + JSON.stringify(mc, null, 2),
  ].join('\n\n');

  renderHero(inp, result, mc);

  // ── MILESTONE CARDS ──
  const surplusNote = result.buyerSurplus > 0
    ? (inp.surplusDestination === 'offset'
        ? ` + ${fmt(result.finalOffsetBalance)} offset + ${fmt(result.buyerEtfNet)} surplus ETF`
        : ` + ${fmt(result.buyerEtfNet)} surplus ETF`)
    : '';

  renderCard('buy', fmtK(result.buyNet), `NPV: ${fmtK(result.npvBuy)}`,
    `Property ${fmt(result.finalPropertyValue)} minus debt ${fmt(result.finalMortgageBalance)} and selling agent costs ${fmt(result.sellingCosts)}${surplusNote}<br>
     <span style="font-size:10.5px;color:var(--text-muted)">${inp.mainResidence ? 'PPOR — 100% CGT Exempt' : 'Investment Property — CGT applicable'}</span>`,
    result.buyNet >= result.rentNet ? 100 : (result.buyNet / Math.max(1, result.rentNet) * 100),
    result.buyNet >= result.rentNet ? 'Leading' : '');

  renderCard('rent', fmtK(result.rentNet), `NPV: ${fmtK(result.npvRent)}`,
    `Portfolio ${fmt(result.finalPortfolio)} minus CGT ${fmt(result.cgt)} and selling brokerage ${fmt(result.etfSellFee)} + bond refund ${fmt(result.bond)}<br>
     <span style="font-size:10.5px;color:var(--text-muted)">${inp.cgtMethod === 'fy27' ? 'FY27 Real Gain Indexation' : 'Legacy 50% CGT Discount'}</span>`,
    result.rentNet >= result.buyNet ? 100 : (result.rentNet / Math.max(1, result.buyNet) * 100),
    result.rentNet >= result.buyNet ? 'Leading' : '');

  renderCard('breakeven', result.breakevenYear != null ? `Year ${result.breakevenYear}` : `Beyond ${inp.years} yrs`,
    result.breakevenYear != null ? `Crossover at Yr ${result.breakevenYear}` : 'No crossover',
    result.breakevenYear != null
      ? `Owner equity overtakes renter portfolio from Year ${result.breakevenYear} onward.`
      : `Owner equity does not overtake renter portfolio within the ${inp.years}-year horizon.`,
    result.breakevenYear != null ? Math.max(0, 100 - (result.breakevenYear / inp.years * 100)) : 0,
    result.breakevenYear != null ? `${inp.years - result.breakevenYear} yrs to spare` : '');

  const npvDelta = result.npvRent - result.npvBuy;
  renderCard('delta', (npvDelta >= 0 ? '+' : '') + fmtK(npvDelta), npvDelta >= 0 ? 'Rent Wins (NPV)' : 'Buy Wins (NPV)',
    npvDelta >= 0
      ? `Renting &amp; investing is worth ${fmt(Math.abs(npvDelta))} more in today's dollars (NPV @ ${(inp.npvDiscountRate * 100).toFixed(1)}%).`
      : `Buying is worth ${fmt(Math.abs(npvDelta))} more in today's dollars (NPV @ ${(inp.npvDiscountRate * 100).toFixed(1)}%).`,
    Math.min(100, Math.abs(npvDelta) / Math.max(result.npvBuy, result.npvRent, 1) * 100),
    npvDelta >= 0 ? 'Rent Ahead' : 'Buy Ahead');

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
    document.getElementById('ts-gap-note').textContent = row1.gap >= 0 ? 'Renter saves difference' : 'Buyer saves difference';
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

function initUX() {
  document.querySelectorAll('input[type="number"]').forEach(el => {
    el.addEventListener('focus', function () { this.select(); });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initDark();
  if (!applyUrlParams()) loadState();
  initUX();
  updateRangeLabels();
  updateConditionalUI();
  calc();
});
