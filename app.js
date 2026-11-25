'use strict';

// ══════════════════════════════════════════════════════════
//  AUSTRALIAN RENT vs BUY CALCULATOR ENGINE (FY 2025–26)
//  Nominal-dollar year-by-year simulation:
//  - Standard P&I (or interest-only) mortgage amortisation
//  - Real 100% offset account vs ETF surplus investing
//  - Owner carrying costs: maintenance, rates/strata, insurance, land tax
//  - Renter invests savings (less nominal bond) and cash-flow gap
//  - Australian dividend gross-up and refundable franking credits
//  - Capital Gains Tax: FY27 CPI-indexation method or Legacy 50% discount
//    with progressive bracket stacking and optional investment property CGT
//  - Monte Carlo volatility simulation (400 runs, correlated shocks)
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

// Combined income tax + 2% Medicare Levy above tax-free threshold.
function totalIncomeTax(income) {
  if (income <= 0) return 0;
  return incomeTax(income) + Math.max(0, income - 18200) * MEDICARE_LEVY_RATE;
}

// Effective marginal tax rate (income tax bracket rate + 2% Medicare Levy).
function marginalTaxRate(income) {
  if (income <= 18200) return 0;
  for (const b of TAX_BRACKETS_2526) {
    if (income <= b.upTo) return b.rate + MEDICARE_LEVY_RATE;
  }
  return TAX_BRACKETS_2526[TAX_BRACKETS_2526.length - 1].rate + MEDICARE_LEVY_RATE;
}

// Incremental tax on realised capital gains stacked onto base taxable income.
function computeIncrementalTax(baseSalary, extraTaxableGain, taxRateMethod, flatRate, minFloorRate = 0) {
  if (extraTaxableGain <= 0) return 0;
  if (taxRateMethod === 'income') {
    const base = Math.max(0, baseSalary || 0);
    const incTax = totalIncomeTax(base + extraTaxableGain) - totalIncomeTax(base);
    return Math.max(incTax, extraTaxableGain * minFloorRate);
  }
  return extraTaxableGain * Math.max(flatRate || 0, minFloorRate);
}

// General transfer duty schedules by state/territory.
const VIC_GENERAL_DUTY = price => price <= 25000 ? price * 0.014
  : price <= 130000 ? 350 + (price - 25000) * 0.024
  : price <= 960000 ? 2870 + (price - 130000) * 0.06
  : price <= 2000000 ? price * 0.055
  : 110000 + (price - 2000000) * 0.065;

const VIC_PPR_DUTY = price => price <= 25000 ? price * 0.014
  : price <= 130000 ? 350 + (price - 25000) * 0.024
  : price <= 440000 ? 2870 + (price - 130000) * 0.05
  : price <= 550000 ? 18370 + (price - 440000) * 0.06
  : VIC_GENERAL_DUTY(price);

const QLD_GENERAL_DUTY = price => price <= 5000 ? 0
  : price <= 75000 ? (price - 5000) * 0.015
  : price <= 540000 ? 1050 + (price - 75000) * 0.035
  : price <= 1000000 ? 17325 + (price - 540000) * 0.045
  : 38025 + (price - 1000000) * 0.0575;

const QLD_HOME_DUTY = price => price <= 350000 ? price * 0.01
  : price <= 540000 ? 3500 + (price - 350000) * 0.035
  : price <= 1000000 ? 10150 + (price - 540000) * 0.045
  : 30850 + (price - 1000000) * 0.0575;

const STAMP_DUTY_BANDS = {
  NSW: price => price <= 17000 ? price * 0.0125
    : price <= 36000 ? 212 + (price - 17000) * 0.015
    : price <= 97000 ? 497 + (price - 36000) * 0.0175
    : price <= 364000 ? 1564 + (price - 97000) * 0.035
    : price <= 1212000 ? 10909 + (price - 364000) * 0.045
    : 49069 + (price - 1212000) * 0.055,
  VIC: (price, isInvestmentProperty) => isInvestmentProperty ? VIC_GENERAL_DUTY(price) : VIC_PPR_DUTY(price),
  QLD: (price, isInvestmentProperty) => isInvestmentProperty ? QLD_GENERAL_DUTY(price) : QLD_HOME_DUTY(price),
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
  NT: price => {
    if (price <= 525000) {
      const v = price / 1000;
      return (0.06571441 * v * v) + (15 * v);
    }
    return price <= 3000000 ? price * 0.0495 : price * 0.0575;
  },
};

// First-home-buyer [full_exemption_cap, taper_upper_limit] for established PPOR
const FHB_THRESHOLDS = {
  NSW: [800000, 1000000],
  VIC: [600000, 750000],
  QLD: [700000, 800000],
  WA:  [500000, 700000],  // Metro FHB concession range
  SA:  [0, 0],            // SA FHB exemption applies to new builds only
  TAS: [600000, 750000],
  ACT: [1000000, 1455000],
  NT:  [0, 0],
};

function estimateStampDuty(price, firstHomeBuyer, state, isInvestmentProperty = false) {
  const p = Math.max(0, price || 0);
  const bandFn = STAMP_DUTY_BANDS[state] || STAMP_DUTY_BANDS.NSW;
  let duty = bandFn(p, !!isInvestmentProperty);

  if (firstHomeBuyer && !isInvestmentProperty) {
    const [full, taper] = FHB_THRESHOLDS[state] || FHB_THRESHOLDS.NSW;
    if (full > 0) {
      if (p <= full) duty = 0;
      else if (p < taper) duty *= (p - full) / (taper - full);
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

// Shared Day-1 capital allocation, deposit clamping, loan sizing, and bond parity.
function computeUpfrontAndLoan(inp) {
  const totalSavings = Math.max(0, inp.totalSavings || 0);
  const propertyPrice = Math.max(0, inp.propertyPrice || 0);
  const deposit = Math.max(0, inp.deposit || 0);
  const stampDuty = Math.max(0, inp.stampDuty || 0);
  const legalFeesBuy = Math.max(0, inp.legalFeesBuy || 0);
  const lmiAmount = Math.max(0, inp.lmiAmount || 0);
  const fhogAmount = Math.max(0, inp.fhogAmount || 0);

  const buyerUpfrontCash = Math.max(0, (inp.financeStampDuty ? 0 : stampDuty) + legalFeesBuy
    + (inp.financeLMI ? 0 : lmiAmount) - fhogAmount);
  const maxDeposit = Math.max(0, totalSavings - buyerUpfrontCash);
  const actualDeposit = Math.min(deposit, maxDeposit);
  const buyerSurplus = Math.max(0, totalSavings - actualDeposit - buyerUpfrontCash);
  const loanAmount = Math.max(0, propertyPrice - actualDeposit
    + (inp.financeStampDuty ? stampDuty : 0)
    + (inp.financeLMI ? lmiAmount : 0));
  const lvr = propertyPrice > 0 ? (loanAmount / propertyPrice * 100) : 0;

  // In PPOR mode, rental bond ties up cash at 0% return and refunds nominally at exit.
  // In Investment Property mode, both paths rent elsewhere so bond cancels out.
  const rawBond = !inp.isInvestmentProperty
    ? Math.max(0, (inp.weeklyRent || 0) * (inp.bondWeeks || 0))
    : 0;
  const bond = Math.min(totalSavings, rawBond);
  const renterInitial = Math.max(0, totalSavings - bond);

  return {
    buyerUpfrontCash,
    maxDeposit,
    actualDeposit,
    buyerSurplus,
    loanAmount,
    lvr,
    bond,
    renterInitial,
  };
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

function calcDividendTax(div, frankedFraction, taxRate, companyTaxRate) {
  if (div <= 0) return 0;
  const frankedDiv = div * frankedFraction;
  const unfrankedDiv = div - frankedDiv;
  const grossedFrankedDiv = frankedDiv > 0 ? (frankedDiv / (1 - companyTaxRate)) : 0;
  const frankingCredit = grossedFrankedDiv * companyTaxRate;
  const taxOnGrossed = grossedFrankedDiv * taxRate;
  const netFrankedTax = taxOnGrossed - frankingCredit; // Refundable if taxRate < 0.30
  const unfrankedTax = unfrankedDiv * taxRate;
  return netFrankedTax + unfrankedTax;
}

// Grows an ETF portfolio balance by 1 year with mid-year contribution timing
// and avoids compounding full-year capital growth onto same-year distributions.
function growEtfYear(startBalance, contribution, year, opts) {
  const { dividendYield, frankedFraction, taxRate, companyTaxRate, priceGrowthRate, lots } = opts;
  const start = Math.max(0, startBalance);
  const contrib = Math.max(0, contribution || 0);

  const divStart = start * dividendYield;
  const divTaxStart = calcDividendTax(divStart, frankedFraction, taxRate, companyTaxRate);
  const netDivStart = divStart - divTaxStart;
  const grownStart = start * (1 + priceGrowthRate) + netDivStart;

  const divContrib = 0.5 * contrib * dividendYield;
  const divTaxContrib = calcDividendTax(divContrib, frankedFraction, taxRate, companyTaxRate);
  const netDivContrib = divContrib - divTaxContrib;
  const grownContrib = contrib * (1 + 0.5 * priceGrowthRate) + netDivContrib;

  const newBalance = Math.max(0, grownStart + grownContrib);
  const netDivTotal = netDivStart + netDivContrib;
  const divTax = divTaxStart + divTaxContrib;
  const basisDelta = contrib + Math.max(0, netDivTotal);

  if (lots) {
    if (contrib > 0) lots.push({ year, amount: contrib });
    if (netDivTotal > 0) lots.push({ year, amount: netDivTotal });
  }

  return { balance: newBalance, basisDelta, divTax };
}

function computePortfolioCgt(balance, sellFee, basis, lots, atYear, baseSalary, inp) {
  if (balance <= 0) return { cgt: 0, taxableGain: 0 };
  const netProceeds = Math.max(0, balance - sellFee);
  const minFloor = inp.isPensioner ? 0 : 0.30;

  if (inp.cgtMethod === 'fy27') {
    const indexedBasis = lots.reduce((sum, lot) => sum + lot.amount * Math.pow(1 + inp.inflation, atYear - lot.year), 0);
    const taxableGain = Math.max(0, netProceeds - indexedBasis);
    const cgt = computeIncrementalTax(baseSalary, taxableGain, inp.taxRateMethod, inp.taxRate, minFloor);
    return { cgt, taxableGain };
  }

  const nominalGain = Math.max(0, netProceeds - basis);
  if (nominalGain <= 0) return { cgt: 0, taxableGain: 0 };
  if (atYear <= 1) {
    const cgt = computeIncrementalTax(baseSalary, nominalGain, inp.taxRateMethod, inp.taxRate, 0);
    return { cgt, taxableGain: nominalGain };
  }
  const longTermBasis = lots.reduce((sum, lot) => (lot.year < atYear ? sum + lot.amount : sum), 0);
  const longTermFrac = basis > 0 ? Math.min(1, Math.max(0, longTermBasis / basis)) : 1;
  const taxableGain = (1 - inp.cgtDiscount * longTermFrac) * nominalGain;
  const cgt = computeIncrementalTax(baseSalary, taxableGain, inp.taxRateMethod, inp.taxRate, 0);
  return { cgt, taxableGain };
}

function computePropertyCgt(propertyValue, sellingCosts, propCostBase, atYear, baseSalary, inp) {
  if (inp.mainResidence) return { cgt: 0, taxableGain: 0 };
  const netProceeds = Math.max(0, propertyValue - sellingCosts);
  if (inp.cgtMethod === 'fy27') {
    const indexedCostBase = propCostBase * Math.pow(1 + inp.inflation, atYear);
    const taxableGain = Math.max(0, netProceeds - indexedCostBase);
    const minFloor = inp.isPensioner ? 0 : 0.30;
    const cgt = computeIncrementalTax(baseSalary, taxableGain, inp.taxRateMethod, inp.taxRate, minFloor);
    return { cgt, taxableGain };
  }
  const nominalGain = Math.max(0, netProceeds - propCostBase);
  const taxableGain = (atYear > 1 ? (1 - inp.cgtDiscount) : 1) * nominalGain;
  const cgt = computeIncrementalTax(baseSalary, taxableGain, inp.taxRateMethod, inp.taxRate, 0);
  return { cgt, taxableGain };
}

// ══════════════════════════════════════════════════════════
//  YEAR-BY-YEAR PROJECTION
// ══════════════════════════════════════════════════════════

function project(inp, opts = {}) {
  const {
    years, propertyPrice, surplusDestination = 'offset',
    propertyGrowth, stampDuty,
    legalFeesBuy, legalFeesSell, agentFeeRate,
    mortgageRate, loanTerm, interestOnly,
    maintenanceRate, councilRates, bodyCorp = 0, bodyCorpGrowth = 0, ownerInsurance,
    weeklyRent, rentGrowth, renterInsurance,
    investReturn, dividendYield, frankingLevel, taxRate, etfSellFeeRate = 0,
    taxRateMethod = 'income', grossSalary = 0, salaryGrowth = true,
    isInvestmentProperty = false, rentalIncome = 0, allowNegativeGearing = false,
    vacancyWeeks = 0, propertyManagementRate = 0, landTax = 0, depreciationDeduction = 0,
    inflation,
  } = inp;

  const light = !!opts.light;
  const mcTrack = !!opts.mcTrack;
  const vol   = opts.vol || 0;
  const shockEq = opts.shockEq || opts.shock || null;
  const shockProp = opts.shockProp || opts.shock || null;

  const companyTaxRate = 0.30;
  const frankedFraction = frankingLevel;

  const upfront = computeUpfrontAndLoan(inp);
  const {
    buyerUpfrontCash, actualDeposit, buyerSurplus,
    loanAmount, bond, renterInitial,
  } = upfront;

  const annualRepayment = annualMortgageRepayment(loanAmount, mortgageRate, loanTerm, interestOnly);
  const propCostBase = propertyPrice + stampDuty + legalFeesBuy;

  let offsetBalance = surplusDestination === 'offset' ? buyerSurplus : 0;
  let buyerEtf = surplusDestination === 'etf' ? buyerSurplus : 0;
  let buyerEtfBasis = buyerEtf;
  const buyerEtfLots = buyerEtf > 0 ? [{ year: 0, amount: buyerEtf }] : [];

  let propertyValue = propertyPrice;
  let mortgageBalance = loanAmount;
  let portfolio = renterInitial;
  let portfolioBasis = renterInitial;
  const basisLots = renterInitial > 0 ? [{ year: 0, amount: renterInitial }] : [];

  const year0BuyNet = propertyPrice - loanAmount + buyerSurplus;
  const year0RentNet = renterInitial + bond;

  const rows = [];
  const buyNetSeries = mcTrack ? [year0BuyNet] : null;
  const rentNetSeries = mcTrack ? [year0RentNet] : null;

  let finalTaxRate = taxRate;
  let finalSalary = grossSalary;
  let finalBuyNet = year0BuyNet;
  let finalRentNet = year0RentNet;
  let finalSellingCosts = 0;
  let finalPropertyCgt = 0;
  let finalBuyerEtfCgt = 0;
  let finalBuyerEtfNet = 0;
  let finalRentCgt = 0;
  let finalEtfSellFee = 0;

  for (let year = 1; year <= years; year++) {
    const zEq = shockEq ? shockEq(year - 1) : 0;
    const zProp = shockProp ? shockProp(year - 1) : 0;
    const propGrowthY = Math.max(propertyGrowth + vol * zProp * 0.5, -0.50);
    const investReturnY = Math.max(investReturn + vol * zEq, -0.90);

    const salaryY = salaryGrowth ? grossSalary * Math.pow(1 + inflation, year - 1) : grossSalary;
    const taxRateY = taxRateMethod === 'income' ? marginalTaxRate(salaryY) : taxRate;
    finalTaxRate = taxRateY;
    finalSalary = salaryY;

    propertyValue *= (1 + propGrowthY);

    const maint = propertyValue * maintenanceRate;
    const rates = councilRates * Math.pow(1 + inflation, year - 1)
      + bodyCorp * Math.pow(1 + bodyCorpGrowth, year - 1);
    const ownerIns = ownerInsurance * Math.pow(1 + inflation, year - 1);

    // Amortise mortgage and capture ACTUAL repayments made this year
    const { balance: newBalance, interest: interestPaid, principal: principalPaid, totalPaid: mortgagePaid } =
      amortizeYear(mortgageBalance, mortgageRate, annualRepayment, interestOnly, offsetBalance);
    mortgageBalance = newBalance;

    // Offset balance overflow to buyer ETF if loan is paid below offset
    let buyerEtfContrib = 0;
    if (offsetBalance > mortgageBalance) {
      const excess = offsetBalance - mortgageBalance;
      offsetBalance = mortgageBalance;
      buyerEtfContrib += excess;
    }

    const annualRent = (weeklyRent * 52) * Math.pow(1 + rentGrowth, year - 1);
    const renterIns = renterInsurance * Math.pow(1 + inflation, year - 1);
    const landTaxY = isInvestmentProperty ? landTax * Math.pow(1 + inflation, year - 1) : 0;

    let annualRentalIncome = 0, negGearingBenefit = 0;
    if (isInvestmentProperty) {
      const grossRentalIncome = (rentalIncome * 52) * Math.pow(1 + rentGrowth, year - 1);
      const occupancyFactor = Math.max(0, 1 - vacancyWeeks / 52);
      const managementFee = grossRentalIncome * occupancyFactor * propertyManagementRate;
      annualRentalIncome = grossRentalIncome * occupancyFactor - managementFee;

      // Only loan interest (not principal) + non-capital carrying costs + flat depreciation are tax deductible.
      const deductibleExpenses = interestPaid + maint + rates + ownerIns + landTaxY;
      const depreciationY = depreciationDeduction;
      const netRentalResult = annualRentalIncome - deductibleExpenses - depreciationY;
      if (netRentalResult < 0) {
        negGearingBenefit = allowNegativeGearing ? (-netRentalResult) * taxRateY : 0;
      } else if (netRentalResult > 0) {
        negGearingBenefit = -netRentalResult * taxRateY; // Tax payable on net rental profit
      }
    }

    const ownerCarry = mortgagePaid + maint + rates + ownerIns + landTaxY - annualRentalIncome - negGearingBenefit;
    const renterCarry = annualRent + renterIns;
    // In investment-property mode, both scenarios rent elsewhere so renterCarry cancels out.
    const gap = isInvestmentProperty ? ownerCarry : (ownerCarry - renterCarry);

    let renterContrib = 0;
    if (gap < 0) {
      let surplusY = -gap;
      if (surplusDestination === 'offset') {
        const offsetRoom = Math.max(0, mortgageBalance - offsetBalance);
        const toOffset = Math.min(surplusY, offsetRoom);
        offsetBalance += toOffset;
        surplusY -= toOffset;
      }
      if (surplusY > 0) {
        buyerEtfContrib += surplusY;
      }
    } else if (gap > 0) {
      renterContrib = gap;
    }

    // Compound ETF portfolios
    const priceGrowthRate = Math.max(investReturnY - dividendYield, -0.99);
    const etfOpts = { dividendYield, frankedFraction, taxRate: taxRateY, companyTaxRate, priceGrowthRate };

    const rGrown = growEtfYear(portfolio, renterContrib, year, { ...etfOpts, lots: basisLots });
    portfolio = rGrown.balance;
    portfolioBasis += rGrown.basisDelta;
    const divTax = rGrown.divTax;

    if (buyerEtf > 0 || buyerEtfContrib > 0) {
      const bGrown = growEtfYear(buyerEtf, buyerEtfContrib, year, { ...etfOpts, lots: buyerEtfLots });
      buyerEtf = bGrown.balance;
      buyerEtfBasis += bGrown.basisDelta;
    }

    const equity = propertyValue - mortgageBalance + offsetBalance + buyerEtf;

    if (!light || mcTrack || year === years) {
      const sellingCostsY = agentFeeRate * propertyValue + legalFeesSell;
      const propCgtRes = computePropertyCgt(propertyValue, sellingCostsY, propCostBase, year, salaryY, inp);
      const buyerEtfSellFeeY = buyerEtf * etfSellFeeRate;
      const buyerEtfCgtRes = computePortfolioCgt(
        buyerEtf, buyerEtfSellFeeY, buyerEtfBasis, buyerEtfLots, year,
        salaryY + propCgtRes.taxableGain, inp
      );
      const buyerEtfNetY = buyerEtf - buyerEtfCgtRes.cgt - buyerEtfSellFeeY;
      const buyNetY = propertyValue - mortgageBalance - sellingCostsY - propCgtRes.cgt + offsetBalance + buyerEtfNetY;

      const rentEtfSellFeeY = portfolio * etfSellFeeRate;
      const rentEtfCgtRes = computePortfolioCgt(portfolio, rentEtfSellFeeY, portfolioBasis, basisLots, year, salaryY, inp);
      const rentNetY = portfolio - rentEtfCgtRes.cgt - rentEtfSellFeeY + bond;

      if (mcTrack) {
        buyNetSeries.push(buyNetY);
        rentNetSeries.push(rentNetY);
      }

      if (!light && !mcTrack) {
        rows.push({
          year, propertyValue, mortgageBalance, equity,
          annualRepayment: mortgagePaid, maint, rates, ownerIns, landTax: landTaxY, ownerCarry,
          annualRent, renterIns, renterCarry, gap,
          interestPaid, principalPaid,
          portfolio, divTax,
          annualRentalIncome, negGearingBenefit,
          offsetBalance, buyerEtf,
          buyNet: buyNetY, rentNet: rentNetY,
          propertyCgt: propCgtRes.cgt, etfCgt: rentEtfCgtRes.cgt,
        });
      }

      if (year === years) {
        finalBuyNet = buyNetY;
        finalRentNet = rentNetY;
        finalSellingCosts = sellingCostsY;
        finalPropertyCgt = propCgtRes.cgt;
        finalBuyerEtfCgt = buyerEtfCgtRes.cgt;
        finalBuyerEtfNet = buyerEtfNetY;
        finalRentCgt = rentEtfCgtRes.cgt;
        finalEtfSellFee = rentEtfSellFeeY;
      }
    }
  }

  const npvBuy = discountToday(finalBuyNet, inp.npvDiscountRate, years);
  const npvRent = discountToday(finalRentNet, inp.npvDiscountRate, years);

  if (light) {
    return {
      finalPropertyValue: propertyValue,
      buyNet: finalBuyNet,
      rentNet: finalRentNet,
      npvBuy,
      npvRent,
    };
  }

  if (mcTrack) {
    return {
      buyNet: finalBuyNet,
      rentNet: finalRentNet,
      buyNetSeries,
      rentNetSeries,
    };
  }

  // Sustained break-even: earliest year from which Buy stays ahead on net liquidation wealth through exit.
  let breakevenYear = null;
  if (rows.length > 0 && rows[rows.length - 1].buyNet >= rows[rows.length - 1].rentNet) {
    let idx = rows.length - 1;
    while (idx > 0 && rows[idx - 1].buyNet >= rows[idx - 1].rentNet) {
      idx--;
    }
    breakevenYear = rows[idx].year;
  }

  const grossGain = portfolio - portfolioBasis;

  return {
    rows, breakevenYear,
    loanAmount, annualRepayment, renterInitial, actualDeposit, buyerUpfrontCash, buyerSurplus,
    year0BuyNet, year0RentNet,
    finalPropertyValue: propertyValue, finalMortgageBalance: mortgageBalance,
    finalOffsetBalance: offsetBalance, finalBuyerEtf: buyerEtf,
    buyerEtfCgt: finalBuyerEtfCgt, buyerEtfNet: finalBuyerEtfNet,
    propertyCgt: finalPropertyCgt,
    sellingCosts: finalSellingCosts, bond, buyNet: finalBuyNet,
    finalPortfolio: portfolio, portfolioBasis, grossGain,
    cgt: finalRentCgt, etfSellFee: finalEtfSellFee, rentNet: finalRentNet,
    delta: finalRentNet - finalBuyNet,
    finalTaxRate, finalSalary,
    npvDiscountRate: inp.npvDiscountRate,
    npvBuy, npvRent,
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
  const rho = 0.25;
  const rhoComp = Math.sqrt(1 - rho * rho);
  let buyWins = 0;

  const buyYearly = Array.from({ length: years + 1 }, () => []);
  const rentYearly = Array.from({ length: years + 1 }, () => []);

  const randNormPair = () => {
    const u1 = Math.max(rand(), 1e-9), u2 = rand();
    const m = Math.sqrt(-2 * Math.log(u1));
    return [m * Math.cos(2 * Math.PI * u2), m * Math.sin(2 * Math.PI * u2)];
  };

  for (let s = 0; s < nSims; s++) {
    const zEq = new Array(years);
    const zProp = new Array(years);
    for (let i = 0; i < years; i++) {
      const [z1, z2] = randNormPair();
      zEq[i] = z1;
      zProp[i] = rho * z1 + rhoComp * z2;
    }
    const res = project(inp, {
      mcTrack: true,
      vol: inp.retVol,
      shockEq: y => zEq[y] ?? 0,
      shockProp: y => zProp[y] ?? 0,
    });
    if (res.buyNet >= res.rentNet) buyWins++;

    for (let y = 0; y <= years; y++) {
      buyYearly[y].push(res.buyNetSeries[y]);
      rentYearly[y].push(res.rentNetSeries[y]);
    }
  }

  const percentile = (arr, p) => {
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.floor(sorted.length * p);
    return sorted[Math.min(idx, sorted.length - 1)];
  };

  const buyP10 = buyYearly.map(arr => percentile(arr, 0.10));
  const buyP90 = buyYearly.map(arr => percentile(arr, 0.90));
  const rentP10 = rentYearly.map(arr => percentile(arr, 0.10));
  const rentP90 = rentYearly.map(arr => percentile(arr, 0.90));

  return {
    buySuccess: buyWins / nSims,
    n: nSims,
    rho,
    buyP10, buyP90,
    rentP10, rentP90,
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

function clearActivePreset() {
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.classList.remove('active');
    btn.setAttribute('aria-pressed', 'false');
  });
}

function applyCityPreset(cityName) {
  const preset = CITY_PRESETS[cityName];
  if (!preset) return;
  Object.entries(preset).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  });
  document.querySelectorAll('.preset-btn').forEach(btn => {
    const isMatch = btn.textContent.toLowerCase().includes(cityName);
    btn.classList.toggle('active', isMatch);
    btn.setAttribute('aria-pressed', isMatch ? 'true' : 'false');
  });
  autoStampDuty(true);
  autoLMI(true);
  calc();
}

// ══════════════════════════════════════════════════════════
//  FORMATTING HELPERS
// ══════════════════════════════════════════════════════════

const fmt = n => {
  if (n == null || !Number.isFinite(n)) return '—';
  const r = Math.round(n) || 0;
  return (r < 0 ? '-$' : '$') + Math.abs(r).toLocaleString('en-AU');
};

const fmtK = n => {
  if (n == null || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e6) return (n < 0 ? '-' : '') + '$' + (abs / 1e6).toFixed(2) + 'M';
  const k = Math.round(abs / 1000);
  return (n < 0 && k > 0 ? '-' : '') + '$' + k + 'K';
};

const fmtAxis = v => {
  if (v == null || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e6) return (v < 0 ? '-' : '') + '$' + (abs / 1e6).toFixed(1) + 'M';
  const k = Math.round(abs / 1000);
  return (v < 0 && k > 0 ? '-' : '') + '$' + k + 'K';
};

const pct = n => (n * 100).toFixed(1) + '%';

// ══════════════════════════════════════════════════════════
//  PERSISTENCE & SHARING
// ══════════════════════════════════════════════════════════

const STORAGE_KEY = 'au-rentvsbuy-calc-v2';

function collectFormValues() {
  const vals = {};
  document.querySelectorAll('.input-panel input[id]:not(.range-num-input), .input-panel select[id]').forEach(el => {
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

function flashButtonFeedback(btn, label, duration = 1800) {
  if (!btn) return;
  if (!btn.dataset.origLabel) btn.dataset.origLabel = btn.textContent;
  clearTimeout(btn._feedbackTimer);
  btn.textContent = label;
  btn._feedbackTimer = setTimeout(() => {
    btn.textContent = btn.dataset.origLabel;
  }, duration);
}

function shareLink() {
  const p = new URLSearchParams();
  document.querySelectorAll('.input-panel input[id]:not(.range-num-input), .input-panel select[id]').forEach(el => {
    p.set(el.id, el.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value);
  });
  const url = location.origin + location.pathname + '?' + p.toString();
  const btn = document.getElementById('share-btn');
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(url).then(
      () => flashButtonFeedback(btn, '✓ Copied'),
      () => flashButtonFeedback(btn, '⚠ Copy failed')
    );
  } else {
    flashButtonFeedback(btn, '⚠ Unavailable');
  }
}

function copyAuditLogs() {
  const btn = document.getElementById('logs-btn');
  if (!window._lastAuditLog) {
    flashButtonFeedback(btn, 'No logs');
    return;
  }
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(window._lastAuditLog).then(
      () => flashButtonFeedback(btn, '✓ Copied'),
      () => flashButtonFeedback(btn, '⚠ Copy failed')
    );
  } else {
    flashButtonFeedback(btn, '⚠ Unavailable');
  }
}

let _resetArmed = false;
let _resetTimer = null;
function resetDefaults() {
  const btn = document.getElementById('reset-btn');
  if (!_resetArmed) {
    _resetArmed = true;
    if (btn) {
      if (!btn.dataset.origLabel) btn.dataset.origLabel = btn.textContent;
      btn.textContent = 'Confirm?';
      btn.classList.add('ctrl-btn-confirm');
    }
    _resetTimer = setTimeout(() => {
      _resetArmed = false;
      if (btn) {
        btn.textContent = btn.dataset.origLabel || '↺';
        btn.classList.remove('ctrl-btn-confirm');
      }
    }, 3000);
    return;
  }
  clearTimeout(_resetTimer);
  _resetArmed = false;
  try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
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
  out.push("All values in nominal AUD unless labeled NPV or today's dollars");
  out.push('');

  out.push('=== INPUTS ===');
  Object.entries(collectFormValues()).forEach(([key, val]) => {
    out.push(csvRow([key, val]));
  });
  out.push('');

  out.push('=== SUMMARY ===');
  const npvDelta = result.npvRent - result.npvBuy;
  out.push(csvRow(['Analysis Horizon (years)', inp.years]));
  out.push(csvRow(['Property Mode', inp.isInvestmentProperty ? 'Investment Property' : 'PPOR (Main Residence)']));
  out.push(csvRow(['CGT Method', inp.cgtMethod === 'fy27' ? 'FY27 CPI Indexation + 30% Floor' : 'Legacy CGT Discount']));
  out.push(csvRow(['NPV of Buying', Math.round(result.npvBuy)]));
  out.push(csvRow(['NPV of Renting', Math.round(result.npvRent)]));
  out.push(csvRow(['NPV Verdict', npvDelta >= 0 ? 'Rent wins' : 'Buy wins']));
  out.push(csvRow(['NPV Margin', Math.round(Math.abs(npvDelta))]));
  out.push(csvRow(['Nominal Buy Net Position', Math.round(result.buyNet)]));
  out.push(csvRow(['Nominal Rent Net Position', Math.round(result.rentNet)]));
  out.push(csvRow(['Property CGT Paid', Math.round(result.propertyCgt || 0)]));
  out.push(csvRow(['Renter ETF CGT Paid', Math.round(result.cgt || 0)]));
  out.push(csvRow(['Break-even Year', result.breakevenYear ?? 'Not reached']));
  if (mc) out.push(csvRow(['Monte Carlo Buy Win Rate', pct(mc.buySuccess)]));
  out.push('');

  out.push('=== ALTERNATE SCENARIOS ===');
  out.push(csvRow(['Scenario', 'Condition', 'NPV Delta (Rent - Buy)', 'NPV Buy', 'NPV Rent', 'Nominal Buy', 'Nominal Rent']));
  buildScenarios(inp).forEach(sc => {
    const r = project({ ...inp, ...sc.patch }, { light: true });
    out.push(csvRow([
      sc.title, sc.sub,
      Math.round(r.npvRent - r.npvBuy),
      Math.round(r.npvBuy), Math.round(r.npvRent),
      Math.round(r.buyNet), Math.round(r.rentNet),
    ]));
  });
  out.push('');

  out.push('=== BREAK-EVEN SENSITIVITY REPORT ===');
  out.push(csvRow(['Lever', 'Current Value', 'Break-even Value', 'Change Required']));
  buildBreakevenItems(inp).forEach(item => {
    out.push(csvRow([
      item.title,
      item.fmtPlain(item.current),
      item.breakeven == null ? 'Not reachable' : item.fmtPlain(item.breakeven),
      item.breakeven == null ? '—' : item.fmtPlain(item.breakeven - item.current, true),
    ]));
  });
  out.push('');

  out.push('=== YEAR-BY-YEAR PROJECTION ===');
  out.push(csvRow([
    'Year', 'Property Value', 'Mortgage Balance', 'Offset Balance', 'Buyer ETF Surplus',
    'Owner Equity', 'Mortgage Repayment', 'Interest Paid', 'Principal Paid',
    'Maintenance', 'Rates/Strata', 'Owner Insurance', 'Land Tax',
    'Rental Income (Net)', 'Neg Gearing / Tax Effect', 'Total Owning Cost',
    'Annual Rent', 'Renter Insurance', 'Total Renting Cost',
    'Cash-flow Gap', 'Renter Portfolio', 'Dividend Tax',
    'Buy Net (After Costs/CGT)', 'Rent Net (After Costs/CGT)',
  ]));
  _lastRows.forEach(r => {
    out.push(csvRow([
      r.year, Math.round(r.propertyValue), Math.round(r.mortgageBalance),
      Math.round(r.offsetBalance || 0), Math.round(r.buyerEtf || 0), Math.round(r.equity),
      Math.round(r.annualRepayment), Math.round(r.interestPaid || 0), Math.round(r.principalPaid || 0),
      Math.round(r.maint), Math.round(r.rates), Math.round(r.ownerIns), Math.round(r.landTax || 0),
      Math.round(r.annualRentalIncome || 0), Math.round(r.negGearingBenefit || 0), Math.round(r.ownerCarry),
      Math.round(r.annualRent), Math.round(r.renterIns), Math.round(r.renterCarry),
      Math.round(r.gap), Math.round(r.portfolio), Math.round(r.divTax || 0),
      Math.round(r.buyNet || 0), Math.round(r.rentNet || 0),
    ]));
  });

  const blob = new Blob([out.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'rent-vs-buy-full-export.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ══════════════════════════════════════════════════════════
//  DARK MODE
// ══════════════════════════════════════════════════════════

function isDark() { return typeof document !== 'undefined' && document.body.classList.contains('dark'); }

function toggleDark() {
  const dark = document.body.classList.toggle('dark');
  try { localStorage.setItem('au-rentvsbuy-dark', dark ? '1' : '0'); } catch (_) {}
  const btn = document.getElementById('dark-toggle');
  if (btn) btn.textContent = dark ? '☀️' : '🌙';
  if (typeof Chart !== 'undefined') Chart.defaults.color = dark ? '#94A3B8' : '#64748B';
  _calc();
}

function initDark() {
  let dark = false;
  try { dark = localStorage.getItem('au-rentvsbuy-dark') === '1'; } catch (_) {}
  if (dark) {
    document.body.classList.add('dark');
    if (typeof Chart !== 'undefined') Chart.defaults.color = '#94A3B8';
  }
  const btn = document.getElementById('dark-toggle');
  if (btn) btn.textContent = dark ? '☀️' : '🌙';
}

// ══════════════════════════════════════════════════════════
//  UI HELPERS
// ══════════════════════════════════════════════════════════

function toggleSection(id) {
  const sec = document.getElementById(id);
  if (!sec) return;
  const collapsed = sec.classList.toggle('collapsed');
  const hdr = sec.querySelector('.section-header');
  if (hdr) hdr.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
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
  if (!inputPanel || !resultsPanel) return;

  if (tab === 'inputs') {
    inputPanel.classList.remove('mobile-hidden');
    resultsPanel.classList.add('mobile-hidden');
    tabInputs?.classList.add('active');
    tabResults?.classList.remove('active');
    tabInputs?.setAttribute('aria-selected', 'true');
    tabResults?.setAttribute('aria-selected', 'false');
  } else {
    inputPanel.classList.add('mobile-hidden');
    resultsPanel.classList.remove('mobile-hidden');
    tabInputs?.classList.remove('active');
    tabResults?.classList.add('active');
    tabInputs?.setAttribute('aria-selected', 'false');
    tabResults?.setAttribute('aria-selected', 'true');
    requestAnimationFrame(() => {
      Object.values(charts).forEach(c => { if (c && typeof c.resize === 'function') c.resize(); });
    });
  }
}

function syncRange(el, lblId, pre, suf) {
  if (!el) return;
  const v = parseFloat(el.value);
  const lbl = document.getElementById(lblId);
  if (lbl && !isNaN(v)) lbl.textContent = pre + v + suf;
  const min = parseFloat(el.min || 0), max = parseFloat(el.max || 100);
  const pctVal = max > min ? Math.min(100, Math.max(0, (v - min) / (max - min) * 100)) : 0;
  el.style.setProperty('--val', pctVal.toFixed(1) + '%');
}

function syncDualInput(sourceId, targetId, lblId, pre, suf) {
  const src = document.getElementById(sourceId);
  const tgt = document.getElementById(targetId);
  if (!src) return;
  const rawV = parseFloat(src.value);
  if (isNaN(rawV)) return;
  const min = parseFloat(src.min !== '' ? src.min : (tgt?.min || 0));
  const max = parseFloat(src.max !== '' ? src.max : (tgt?.max || 100));
  const clamped = Math.min(max, Math.max(min, rawV));
  if (tgt) tgt.value = clamped;
  const lbl = document.getElementById(lblId);
  if (lbl) lbl.textContent = pre + clamped + suf;
  const pctVal = max > min ? Math.min(100, Math.max(0, (clamped - min) / (max - min) * 100)) : 0;
  if (src.type === 'range') src.style.setProperty('--val', pctVal.toFixed(1) + '%');
  if (tgt && tgt.type === 'range') tgt.style.setProperty('--val', pctVal.toFixed(1) + '%');
}

const DUAL_INPUT_PAIRS = [
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
];

function updateRangeLabels() {
  DUAL_INPUT_PAIRS.forEach(([rangeId, numId, lbl, pre, suf]) => {
    syncDualInput(rangeId, numId, lbl, pre, suf);
  });
}

function autoStampDuty(silent = false) {
  const price = parseFloat(document.getElementById('propertyPrice')?.value) || 0;
  const fhb = document.getElementById('firstHomeBuyer')?.checked;
  const state = document.getElementById('state')?.value || 'NSW';
  const isIP = document.getElementById('isInvestmentProperty')?.checked;
  const el = document.getElementById('stampDuty');
  if (el) el.value = estimateStampDuty(price, fhb, state, isIP);
  if (!silent) calc();
}

function setMinDeposit() {
  const price = parseFloat(document.getElementById('propertyPrice')?.value) || 0;
  const el = document.getElementById('deposit');
  if (el) el.value = Math.round(price * 0.2 / 500) * 500;
  clearActivePreset();
  calc();
}

function autoLMI(silent = false) {
  const inp = getInputs();
  const preLmiUpfront = Math.max(0, (inp.financeStampDuty ? 0 : inp.stampDuty) + inp.legalFeesBuy - inp.fhogAmount);
  const maxDep1 = Math.max(0, inp.totalSavings - preLmiUpfront);
  const dep1 = Math.min(inp.deposit, maxDep1);
  const baseLoan = Math.max(0, inp.propertyPrice - dep1 + (inp.financeStampDuty ? inp.stampDuty : 0));
  let lmi = estimateLMI(baseLoan, inp.propertyPrice);
  if (!inp.financeLMI && lmi > 0) {
    const maxDep2 = Math.max(0, inp.totalSavings - preLmiUpfront - lmi);
    const dep2 = Math.min(inp.deposit, maxDep2);
    const loan2 = Math.max(0, inp.propertyPrice - dep2 + (inp.financeStampDuty ? inp.stampDuty : 0));
    lmi = estimateLMI(loan2, inp.propertyPrice);
  }
  const el = document.getElementById('lmiAmount');
  if (el) el.value = lmi;
  if (!silent) calc();
}

function onInvestmentPropertyToggle(checked) {
  const mrEl = document.getElementById('mainResidence');
  if (mrEl) mrEl.checked = !checked;
  updateConditionalUI();
  autoStampDuty(true);
  calc();
}

function updateConditionalUI() {
  toggleVis('investment-fields', document.getElementById('isInvestmentProperty')?.checked);
  const isLegacy = document.getElementById('cgtMethod')?.value === 'legacy';
  toggleVis('legacy-cgt-fields', isLegacy);
  toggleVis('pensioner-field', !isLegacy);
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
    years: parseInt(g('years')?.value, 10) || 10,
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

function isMobileView() {
  return typeof window !== 'undefined' && window.innerWidth < 640;
}

const msLinesPlugin = {
  id: 'msLines',
  afterDatasetsDraw(chart, args, options) {
    const lines = options.lines || [];
    const xs = chart.scales.x, area = chart.chartArea, ctx = chart.ctx;
    if (!xs || !area) return;
    lines.forEach(({ idx, color, label }) => {
      if (idx == null || idx < 0) return;
      const px = xs.getPixelForValue(idx);
      if (px < area.left || px > area.right) return;
      const nearRight = (area.right - px) < 28;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px, area.top);
      ctx.lineTo(px, area.bottom);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = '700 9.5px sans-serif';
      ctx.textAlign = 'left';
      ctx.translate(px, area.top);
      ctx.rotate(Math.PI / 2);
      ctx.fillText(label, 6, nearRight ? 11 : -5);
      ctx.restore();
    });
  },
};

if (typeof Chart !== 'undefined') {
  Chart.defaults.font.family = "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif";
  Chart.defaults.font.size   = isMobileView() ? 10 : 11;
  Chart.defaults.color       = '#64748B';
  Chart.register(msLinesPlugin);
}

function gc() { return isDark() ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'; }

function ensureChartAvailable(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  if (typeof Chart === 'undefined') {
    const wrap = canvas.parentElement;
    if (wrap && !wrap.querySelector('.chart-offline')) {
      const msg = document.createElement('div');
      msg.className = 'chart-offline';
      msg.textContent = 'Chart library unavailable offline — see the summary cards and year-by-year table below.';
      wrap.appendChild(msg);
      canvas.style.display = 'none';
    }
    return null;
  }
  return canvas.getContext('2d');
}

function buildProjectionChart(rows, result, inp, mc) {
  const ctx = ensureChartAvailable('chart-projection');
  if (!ctx) return;
  const isD = isDark();
  const isM = isMobileView();
  const G = gc();

  const labels = ['Yr 0', ...rows.map(r => `Yr ${r.year}`)];
  const buyNetData  = [result.year0BuyNet, ...rows.map(r => r.buyNet)];
  const rentNetData = [result.year0RentNet, ...rows.map(r => r.rentNet)];

  const datasets = [];

  if (mc && mc.buyP10 && mc.buyP90) {
    datasets.push({
      label: 'Buy Net (90th percentile)',
      data: mc.buyP90,
      borderColor: 'transparent',
      backgroundColor: isD ? 'rgba(52, 211, 153, 0.14)' : 'rgba(5, 150, 105, 0.13)',
      pointRadius: 0,
      fill: '+1',
    });
    datasets.push({
      label: 'Buy Net (10th percentile)',
      data: mc.buyP10,
      borderColor: 'transparent',
      backgroundColor: 'transparent',
      pointRadius: 0,
      fill: false,
    });
    datasets.push({
      label: 'Rent Net (90th percentile)',
      data: mc.rentP90,
      borderColor: 'transparent',
      backgroundColor: isD ? 'rgba(96, 165, 250, 0.14)' : 'rgba(37, 99, 235, 0.13)',
      pointRadius: 0,
      fill: '+1',
    });
    datasets.push({
      label: 'Rent Net (10th percentile)',
      data: mc.rentP10,
      borderColor: 'transparent',
      backgroundColor: 'transparent',
      pointRadius: 0,
      fill: false,
    });
  }

  datasets.push({
    label: 'Buy Net Position',
    data: buyNetData,
    borderColor: isD ? '#34D399' : '#059669',
    backgroundColor: isD ? 'rgba(52, 211, 153, 0.14)' : 'rgba(5, 150, 105, 0.10)',
    fill: !mc,
    tension: 0.35,
    borderWidth: 2.5,
    pointRadius: 0,
    pointHoverRadius: 5,
  });

  datasets.push({
    label: 'Rent Net Position',
    data: rentNetData,
    borderColor: isD ? '#60A5FA' : '#2563EB',
    backgroundColor: isD ? 'rgba(96, 165, 250, 0.14)' : 'rgba(37, 99, 235, 0.10)',
    fill: !mc,
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
            boxWidth: 10,
            padding: isM ? 8 : 12,
            font: { size: isM ? 10 : 11, weight: '600' },
          },
        },
        tooltip: {
          padding: 8,
          bodyFont: { size: 11 },
          filter: item => !item.dataset.label.includes('percentile'),
          callbacks: {
            label: c => ` ${c.dataset.label}: ${fmt(c.parsed.y)}`,
          },
        },
      },
      scales: {
        x: {
          grid: { color: G },
          ticks: {
            autoSkip: true,
            maxTicksLimit: isM ? 6 : 10,
            maxRotation: 0,
            font: { size: isM ? 9.5 : 11 },
          },
        },
        y: {
          grid: { color: G },
          ticks: {
            callback: v => fmtAxis(v),
            maxTicksLimit: 6,
            font: { size: isM ? 9.5 : 11 },
          },
        },
      },
    },
  });
}

function buildFinalChart(result) {
  const ctx = ensureChartAvailable('chart-final');
  if (!ctx) return;
  const isD = isDark();
  const isM = isMobileView();
  const labels = ['Buy', 'Rent & Invest'];
  const colorNom = isD ? ['#34D399', '#60A5FA'] : ['#059669', '#2563EB'];
  const colorNpv = isD ? ['#6EE7B7', '#93C5FD'] : ['#10B981', '#3B82F6'];

  if (charts.final) charts.final.destroy();
  charts.final = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: `Nominal (Yr ${result.rows.length})`, data: [result.buyNet, result.rentNet], backgroundColor: colorNom.map(c => c + 'CC'), borderColor: colorNom, borderWidth: 1.5, borderRadius: 5 },
        { label: "NPV (Today's $)", data: [result.npvBuy, result.npvRent], backgroundColor: colorNpv.map(c => c + 'CC'), borderColor: colorNpv, borderWidth: 1.5, borderRadius: 5 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 10, padding: isM ? 6 : 10, font: { size: isM ? 10 : 11, weight: '600' } } },
        tooltip: { padding: 8, callbacks: { label: c => ` ${c.dataset.label}: ${fmt(c.parsed.y)}` } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: isM ? 10 : 11, weight: '600' } } },
        y: {
          grid: { color: gc() },
          ticks: {
            callback: v => fmtAxis(v),
            maxTicksLimit: 5,
            font: { size: isM ? 9.5 : 11 },
          },
        },
      },
    },
  });
}

function buildOwnCostChart(row) {
  const ctx = ensureChartAvailable('chart-owncost');
  if (!ctx) return;
  const isD = isDark();
  const isM = isMobileView();
  const raw = [row.annualRepayment, row.maint, row.rates, row.ownerIns, row.landTax || 0];
  const labels = ['Mortgage', 'Maintenance', 'Rates/Strata', 'Insurance', 'Land Tax'];
  const colors = isD ? ['#34D399', '#F87171', '#FBBF24', '#60A5FA', '#A78BFA'] : ['#059669', '#DC2626', '#D97706', '#2563EB', '#7C3AED'];
  const vals = raw.map((v, i) => ({ v, l: labels[i], c: colors[i] })).filter(x => x.v > 0);
  const grossCost = vals.reduce((s, x) => s + x.v, 0);

  const chartData = vals.length > 0
    ? {
        labels: vals.map(x => x.l),
        datasets: [{
          data: vals.map(x => x.v),
          backgroundColor: vals.map(x => x.c + 'DD'),
          borderColor: vals.map(x => x.c),
          borderWidth: 1.5,
          hoverOffset: 4,
        }],
      }
    : {
        labels: ['No ongoing costs'],
        datasets: [{
          data: [1],
          backgroundColor: [isD ? '#334155' : '#E2E8F0'],
          borderColor: [isD ? '#475569' : '#CBD5E1'],
          borderWidth: 1,
        }],
      };

  if (charts.owncost) charts.owncost.destroy();
  charts.owncost = new Chart(ctx, {
    type: 'doughnut',
    data: chartData,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '58%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { boxWidth: 8, padding: isM ? 5 : 8, font: { size: isM ? 9.5 : 10.5 } },
        },
        tooltip: {
          padding: 8,
          callbacks: {
            label: c => vals.length > 0
              ? ` ${c.label}: ${fmt(c.parsed)} (${(c.parsed / Math.max(1, grossCost) * 100).toFixed(0)}%)`
              : ' No ongoing costs: $0',
          },
        },
      },
    },
  });
}

function buildGapChart(rows) {
  const ctx = ensureChartAvailable('chart-gap');
  if (!ctx) return;
  const isD = isDark();
  const isM = isMobileView();
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
        borderRadius: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          padding: 8,
          callbacks: {
            label: c => ` ${fmt(c.parsed.y)}/yr ${c.parsed.y >= 0 ? '(Renter saves gap)' : '(Buyer saves gap)'}`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            autoSkip: true,
            maxTicksLimit: isM ? 6 : 10,
            maxRotation: 0,
            font: { size: isM ? 9.5 : 11 },
          },
        },
        y: {
          grid: { color: G },
          ticks: {
            callback: v => fmtAxis(v),
            maxTicksLimit: 5,
            font: { size: isM ? 9.5 : 11 },
          },
        },
      },
    },
  });
}

function buildEquityChart(rows) {
  const ctx = ensureChartAvailable('chart-equity');
  if (!ctx) return;
  const isD = isDark();
  const isM = isMobileView();
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
        legend: { position: 'bottom', labels: { boxWidth: 10, padding: isM ? 6 : 10, font: { size: isM ? 10 : 11 } } },
        tooltip: { padding: 8, callbacks: { label: c => ` ${c.dataset.label}: ${fmt(c.parsed.y)}` } },
      },
      scales: {
        x: {
          grid: { color: G },
          ticks: {
            autoSkip: true,
            maxTicksLimit: isM ? 6 : 10,
            maxRotation: 0,
            font: { size: isM ? 9.5 : 11 },
          },
        },
        y: {
          grid: { color: G },
          ticks: {
            callback: v => fmtAxis(v),
            maxTicksLimit: 6,
            font: { size: isM ? 9.5 : 11 },
          },
        },
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

  const buyLabel = inp.isInvestmentProperty ? 'Buying (Investment)' : 'Buying (PPOR)';
  const npvDelta = result.npvRent - result.npvBuy;
  const npvWinner = npvDelta >= 0 ? 'Renting &amp; Investing' : buyLabel;
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
    mcChip = `<span class="chip mc-badge ${s >= 50 ? 'good' : 'bad'}" title="Share of ${mc.n} Monte Carlo simulation runs favoring Buying (ρ=${mc.rho})">Monte Carlo: <b>${s}%</b> favor Buying</span>`;
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

function buildScenarios(inp) {
  return [
    { icon: '📈', title: 'Higher Property Growth', sub: `+1.5% p.a. (${((inp.propertyGrowth + 0.015) * 100).toFixed(1)}%)`, patch: { propertyGrowth: inp.propertyGrowth + 0.015 } },
    { icon: '📉', title: 'Lower Property Growth', sub: `-1.5% p.a. (${((inp.propertyGrowth - 0.015) * 100).toFixed(1)}%)`, patch: { propertyGrowth: inp.propertyGrowth - 0.015 } },
    { icon: '💹', title: 'Higher Investment Return', sub: `+2.0% p.a. (${((inp.investReturn + 0.02) * 100).toFixed(1)}%)`, patch: { investReturn: inp.investReturn + 0.02 } },
    { icon: '🏦', title: 'Higher Interest Rate', sub: `+1.5% p.a. (${((inp.mortgageRate + 0.015) * 100).toFixed(1)}%)`, patch: { mortgageRate: inp.mortgageRate + 0.015 } },
    { icon: '🏠', title: 'Faster Rent Growth', sub: `+2.0% p.a. (${((inp.rentGrowth + 0.02) * 100).toFixed(1)}%)`, patch: { rentGrowth: inp.rentGrowth + 0.02 } },
    { icon: '⏳', title: 'Longer Horizon', sub: `${inp.years + 10} years`, patch: { years: inp.years + 10 } },
  ];
}

function renderScenarios(inp) {
  const el = document.getElementById('scenario-grid');
  if (!el) return;

  const scCard = (icon, title, sub, npvDelta, footer) => {
    const isTossup = Math.abs(npvDelta) < 1000;
    const favoursBuy = npvDelta < 0;
    const cls = isTossup ? 'neutral' : (favoursBuy ? 'ready' : 'gap');
    const badgeCls = isTossup ? 'sc-badge-neutral' : (favoursBuy ? 'sc-badge-ready' : 'sc-badge-gap');
    const badgeLabel = isTossup ? 'Toss-up' : (favoursBuy ? 'Favours Buy' : 'Favours Rent');
    const valCls = isTossup ? '' : (npvDelta >= 0 ? 'sc-blue' : 'sc-green');
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
        <div class="sc-row"><span>Δ NPV (Rent − Buy)</span><span class="${valCls}">${fmtK(npvDelta)}</span></div>
      </div>
      ${footer ? `<div class="sc-foot">${footer}</div>` : ''}
    </div>`;
  };

  el.innerHTML = buildScenarios(inp).map(sc => {
    const testRes = project({ ...inp, ...sc.patch }, { light: true });
    const npvDelta = testRes.npvRent - testRes.npvBuy;
    const footer = `NPV Buy: ${fmtK(testRes.npvBuy)} · NPV Rent: ${fmtK(testRes.npvRent)} (Nominal: ${fmtK(testRes.buyNet)} vs ${fmtK(testRes.rentNet)})`;
    return scCard(sc.icon, sc.title, sc.sub, npvDelta, footer);
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

function buildBreakevenItems(inp) {
  const npvDiff = (field, value) => {
    const r = project({ ...inp, [field]: value }, { light: true });
    return r.npvRent - r.npvBuy;
  };
  const npvDiffPrice = price => {
    const duty = estimateStampDuty(price, inp.firstHomeBuyer, inp.state, inp.isInvestmentProperty);
    const r = project({ ...inp, propertyPrice: price, stampDuty: duty }, { light: true });
    return r.npvRent - r.npvBuy;
  };

  const pctVal = (v, delta) => (delta && v >= 0 ? '+' : '') + (v * 100).toFixed(2) + '%';
  const dollarVal = (v, delta) => (delta && v >= 0 ? '+' : '') + fmt(v);

  return [
    {
      icon: '🔑', title: 'Weekly Rent', current: inp.weeklyRent,
      breakeven: solveBreakeven(x => npvDiff('weeklyRent', x), 0, Math.max(2000, inp.weeklyRent * 5)),
      fmtVal: dollarVal, fmtPlain: dollarVal,
      note: 'Starting weekly rent that equalises NPV of both paths.',
    },
    {
      icon: '📈', title: 'Rent Growth Rate', current: inp.rentGrowth,
      breakeven: solveBreakeven(x => npvDiff('rentGrowth', x), -0.05, 0.20),
      fmtVal: pctVal, fmtPlain: pctVal,
      note: 'Annual rent escalation rate required to equalise outcomes.',
    },
    {
      icon: '🏦', title: 'Mortgage Interest Rate', current: inp.mortgageRate,
      breakeven: solveBreakeven(x => npvDiff('mortgageRate', x), 0, 0.25),
      fmtVal: pctVal, fmtPlain: pctVal,
      note: 'Mortgage rate that equalises buying and renting.',
    },
    {
      icon: '🏠', title: 'Property Capital Growth', current: inp.propertyGrowth,
      breakeven: solveBreakeven(x => npvDiff('propertyGrowth', x), -0.10, 0.25),
      fmtVal: pctVal, fmtPlain: pctVal,
      note: 'Annual capital growth needed for net equity to match portfolio.',
    },
    {
      icon: '💹', title: 'ETF Investment Return', current: inp.investReturn,
      breakeven: solveBreakeven(x => npvDiff('investReturn', x), -0.05, 0.30),
      fmtVal: pctVal, fmtPlain: pctVal,
      note: 'Total investment return needed for portfolio to match equity.',
    },
    {
      icon: '💰', title: 'Property Purchase Price', current: inp.propertyPrice,
      breakeven: solveBreakeven(npvDiffPrice, inp.propertyPrice * 0.2, inp.propertyPrice * 3),
      fmtVal: dollarVal, fmtPlain: dollarVal,
      note: 'Purchase price (incl. auto stamp duty) that equalises the outcome.',
    },
    {
      icon: '🧾', title: 'Council Rates', current: inp.councilRates,
      breakeven: solveBreakeven(x => npvDiff('councilRates', x), 0, inp.councilRates * 8 + 5000),
      fmtVal: dollarVal, fmtPlain: dollarVal,
      note: 'Annual municipal rates required to reach break-even.',
    },
    {
      icon: '🔧', title: 'Maintenance Rate', current: inp.maintenanceRate,
      breakeven: solveBreakeven(x => npvDiff('maintenanceRate', x), 0, 0.10),
      fmtVal: pctVal, fmtPlain: pctVal,
      note: 'Annual maintenance cost (% of value) required to equalise.',
    },
  ];
}

function renderBreakevenReport(inp) {
  const el = document.getElementById('breakeven-grid');
  if (!el) return;

  const card = ({ icon, title, current, breakeven, fmtVal, note }) => {
    if (breakeven == null) {
      return `
      <div class="sc-card neutral">
        <div class="sc-head">
          <div class="sc-icon">${icon}</div>
          <div class="sc-titlewrap">
            <div class="sc-title">${title}</div>
            <div class="sc-sub">No break-even point in realistic range</div>
          </div>
          <div class="sc-badge sc-badge-neutral">Not reachable</div>
        </div>
        <div class="sc-body">
          <div class="sc-row"><span>Current</span><span>${fmtVal(current, false)}</span></div>
        </div>
        ${note ? `<div class="sc-foot">${note}</div>` : ''}
      </div>`;
    }
    const movedUp = breakeven > current;
    const badgeLabel = Math.abs(breakeven - current) < 1e-6 ? 'Already even' : (movedUp ? 'Needs to rise' : 'Needs to fall');
    return `
    <div class="sc-card breakeven-hit">
      <div class="sc-head">
        <div class="sc-icon">${icon}</div>
        <div class="sc-titlewrap">
          <div class="sc-title">${title}</div>
          <div class="sc-sub">Current: ${fmtVal(current, false)}</div>
        </div>
        <div class="sc-badge sc-badge-breakeven">${badgeLabel}</div>
      </div>
      <div class="sc-body">
        <div class="sc-row"><span>Break-even Value</span><span class="sc-amber">${fmtVal(breakeven, false)}</span></div>
        <div class="sc-row"><span>Required Change</span><span>${fmtVal(breakeven - current, true)}</span></div>
      </div>
      ${note ? `<div class="sc-foot">${note}</div>` : ''}
    </div>`;
  };

  el.innerHTML = buildBreakevenItems(inp).map(card).join('');
}

// ══════════════════════════════════════════════════════════
//  WHAT-IF: ANALYSIS HORIZON
// ══════════════════════════════════════════════════════════

globalThis.runWhatIf = function () {
  const inp = _lastInp;
  if (!inp) return;
  const yearsEl = document.getElementById('wi-years');
  const testYears = yearsEl ? parseInt(yearsEl.value, 10) : inp.years;

  const testRes = project({ ...inp, years: testYears }, { light: true });
  const npvDelta = testRes.npvRent - testRes.npvBuy;
  const buyLabel = inp.isInvestmentProperty ? 'Buying (IP)' : 'Buying';
  const winner = npvDelta >= 0 ? 'Rent &amp; Invest' : buyLabel;
  const winnerCls = npvDelta >= 0 ? 'wb-delta-good' : 'wb-delta-bad';

  const resEl = document.getElementById('wi-global-result');
  if (resEl) {
    resEl.innerHTML = `
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
  }
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

function renderYearTable(rows, inp) {
  const el = document.getElementById('year-table');
  if (!el) return;
  const isIP = !!(inp && inp.isInvestmentProperty);
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
      ${isIP ? `<td>${f(r.landTax || 0)}</td><td>${f(r.annualRentalIncome || 0)}</td><td>${f(r.negGearingBenefit || 0)}</td>` : ''}
      <td>${f(r.ownerCarry)}</td>
      <td>${f(r.annualRent)}</td>
      <td>${f(r.renterCarry)}</td>
      <td class="${r.gap >= 0 ? 'sc-blue' : 'sc-green'}">${f(r.gap)}</td>
      <td><strong>${fmtK(r.portfolio)}</strong></td>
      <td><strong>${fmtK(r.buyNet)}</strong></td>
      <td><strong>${fmtK(r.rentNet)}</strong></td>
    </tr>`).join('');

  el.innerHTML = `
    <table class="year-table">
      <thead><tr>
        <th class="yt-l">Year</th><th>Property Value</th><th>Mortgage Debt</th><th>Offset</th><th>Buyer ETF</th><th>Owner Equity</th>
        <th>Repayment</th><th>Maint.</th><th>Rates/Strata</th><th>Insurance</th>
        ${isIP ? '<th>Land Tax</th><th>Rental Inc.</th><th>Neg Gear / Tax</th>' : ''}
        <th>Total Owning</th>
        <th>Rent</th><th>Total Renting</th><th>Cash-Flow Gap</th><th>Renter Portfolio</th>
        <th>Buy Net</th><th>Rent Net</th>
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

  // Dynamic header pills & subtitle
  const horizonPill = document.getElementById('header-horizon-pill');
  if (horizonPill) horizonPill.textContent = `${inp.years}yr Outcome`;

  const buyPill = document.getElementById('header-buy-pill');
  if (buyPill) buyPill.textContent = inp.isInvestmentProperty ? 'Buy (Investment)' : 'Buy (PPOR)';

  const headerSub = document.getElementById('header-subtitle');
  if (headerSub) {
    const taxDesc = inp.taxRateMethod === 'income' ? 'ATO FY 2025–26 Tax Brackets' : `Flat ${(inp.taxRate * 100).toFixed(0)}% Tax`;
    const cgtDesc = inp.cgtMethod === 'fy27' ? 'FY27 CGT Rules' : 'Legacy CGT Discount';
    headerSub.textContent = `Differential Cash-Flow & Wealth Engine · ${taxDesc} · ${cgtDesc}`;
  }

  const policyBadge = document.getElementById('policy-badge');
  if (policyBadge) {
    const parts = [];
    if (inp.isInvestmentProperty) parts.push('IP');
    parts.push(inp.cgtMethod === 'fy27' ? 'FY27 CGT' : 'Legacy CGT');
    parts.push(`Vol ${(inp.retVol * 100).toFixed(0)}%`);
    policyBadge.textContent = parts.join(' · ');
  }

  const upfront = computeUpfrontAndLoan(inp);

  const depositSavingsHint = document.getElementById('deposit-savings-hint');
  if (depositSavingsHint) {
    depositSavingsHint.textContent = inp.deposit > upfront.maxDeposit
      ? `⚠ Deposit exceeds available cash after upfront costs (${fmt(upfront.maxDeposit)}) — auto-adjusted to ${fmt(upfront.actualDeposit)}`
      : '';
  }

  const lvrHint = document.getElementById('lvr-hint');
  if (lvrHint) {
    const lmiNote = upfront.lvr > 80 && inp.lmiAmount <= 0 ? ' — LMI required (click Auto-estimate)' : '';
    lvrHint.textContent = `Loan: ${fmt(upfront.loanAmount)} · LVR ${upfront.lvr.toFixed(1)}%${lmiNote}`;
  }

  const stampDutyHint = document.getElementById('stamp-duty-hint');
  if (stampDutyHint) {
    stampDutyHint.textContent = (inp.state === 'SA' && inp.firstHomeBuyer && !inp.isInvestmentProperty)
      ? 'ℹ SA FHB stamp duty exemption applies to new builds only (established homes pay full duty; edit to $0 if building new).'
      : '';
  }

  const mortgageHint = document.getElementById('mortgage-repayment-hint');
  if (mortgageHint) {
    const repay = annualMortgageRepayment(upfront.loanAmount, inp.mortgageRate, inp.loanTerm, inp.interestOnly);
    mortgageHint.textContent = repay > 0
      ? `Repayment: ${fmt(repay)}/yr (${fmt(repay / 52)}/wk)${inp.interestOnly ? ' — Interest Only (principal not reduced; full loan remains at exit)' : ''}`
      : '';
  }

  const savingsBreakdownHint = document.getElementById('savings-breakdown-hint');
  if (savingsBreakdownHint) {
    const rentSplit = upfront.bond > 0
      ? `${fmt(upfront.renterInitial)} ETF + ${fmt(upfront.bond)} bond`
      : `${fmt(upfront.renterInitial)} fully invested in ETFs`;
    savingsBreakdownHint.textContent = `Day 1 Parity: Buy = ${fmt(upfront.actualDeposit)} deposit + ${fmt(upfront.buyerUpfrontCash)} upfront + ${fmt(upfront.buyerSurplus)} surplus → ${inp.surplusDestination} · Rent = ${rentSplit}`;
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
  const surplusParts = [];
  if (result.finalOffsetBalance > 0.5) surplusParts.push(`${fmt(result.finalOffsetBalance)} offset`);
  if (result.buyerEtfNet > 0.5) surplusParts.push(`${fmt(result.buyerEtfNet)} surplus ETF`);
  const surplusNote = surplusParts.length ? ` + ${surplusParts.join(' + ')}` : '';
  const propCgtNote = result.propertyCgt > 0.5 ? ` and property CGT ${fmt(result.propertyCgt)}` : '';

  renderCard('buy', fmtK(result.buyNet), `NPV: ${fmtK(result.npvBuy)}`,
    `Property ${fmt(result.finalPropertyValue)} minus debt ${fmt(result.finalMortgageBalance)}, selling costs ${fmt(result.sellingCosts)}${propCgtNote}${surplusNote}<br>
     <span style="font-size:10.5px;color:var(--text-muted)">${inp.mainResidence ? 'PPOR — 100% CGT Exempt' : 'Investment Property — CGT deducted'}</span>`,
    result.buyNet >= result.rentNet ? 100 : (result.buyNet / Math.max(1, result.rentNet) * 100),
    result.buyNet >= result.rentNet ? 'Leading' : '');

  const rentCgtLabel = inp.cgtMethod === 'fy27'
    ? 'FY27 Real Gain Indexation'
    : (inp.cgtDiscount > 0 ? `Legacy ${Math.round(inp.cgtDiscount * 100)}% CGT Discount` : 'Legacy — No CGT Discount');
  const bondNote = result.bond > 0.5 ? ` + bond refund ${fmt(result.bond)}` : '';

  renderCard('rent', fmtK(result.rentNet), `NPV: ${fmtK(result.npvRent)}`,
    `Portfolio ${fmt(result.finalPortfolio)} minus CGT ${fmt(result.cgt)} and selling brokerage ${fmt(result.etfSellFee)}${bondNote}<br>
     <span style="font-size:10.5px;color:var(--text-muted)">${rentCgtLabel}</span>`,
    result.rentNet >= result.buyNet ? 100 : (result.rentNet / Math.max(1, result.buyNet) * 100),
    result.rentNet >= result.buyNet ? 'Leading' : '');

  renderCard('breakeven', result.breakevenYear != null ? `Year ${result.breakevenYear}` : `Beyond ${inp.years} yrs`,
    result.breakevenYear != null ? `Sustained crossover at Yr ${result.breakevenYear}` : 'No sustained crossover',
    result.breakevenYear != null
      ? `Net Buy liquidation wealth stays ahead of Rent from Year ${result.breakevenYear} through Year ${inp.years}.`
      : `Net Buy liquidation wealth does not stay ahead of Rent by Year ${inp.years}.`,
    result.breakevenYear != null ? Math.max(0, 100 - (result.breakevenYear / inp.years * 100)) : 0,
    result.breakevenYear != null ? `${inp.years - result.breakevenYear} yrs to spare` : '');

  const npvDelta = result.npvRent - result.npvBuy;
  renderCard('delta', (npvDelta >= 0 ? '+' : '') + fmtK(npvDelta), npvDelta >= 0 ? 'Rent Wins (NPV)' : 'Buy Wins (NPV)',
    npvDelta >= 0
      ? `Renting &amp; investing is worth ${fmt(Math.abs(npvDelta))} more in today's dollars (NPV @ ${(inp.npvDiscountRate * 100).toFixed(1)}%).`
      : `Buying is worth ${fmt(Math.abs(npvDelta))} more in today's dollars (NPV @ ${(inp.npvDiscountRate * 100).toFixed(1)}%).`,
    Math.min(100, Math.abs(npvDelta) / Math.max(result.npvBuy, result.npvRent, 1) * 100),
    npvDelta >= 0 ? 'Rent Ahead' : 'Buy Ahead');

  renderScenarios(inp);
  renderBreakevenReport(inp);
  renderWhatIf(inp);

  // ── TAX STRIP (year 1) ──
  const row1 = result.rows[0];
  if (row1) {
    document.getElementById('ts-mortgage').textContent = fmt(row1.annualRepayment);
    document.getElementById('ts-mortgage-weekly').textContent = fmt(row1.annualRepayment / 52) + '/wk';
    document.getElementById('ts-owner-extra').textContent = fmt(row1.maint + row1.rates + row1.ownerIns + (row1.landTax || 0));
    const extraSub = document.getElementById('ts-owner-extra-sub');
    if (extraSub) extraSub.textContent = inp.isInvestmentProperty ? 'maint. + rates + ins. + land tax' : 'maint. + rates + insurance';
    document.getElementById('ts-owner-total').textContent = fmt(row1.ownerCarry);
    const totalSub = document.getElementById('ts-owner-total-sub');
    if (totalSub) totalSub.textContent = inp.isInvestmentProperty ? 'net of rent & tax' : 'per year';
    document.getElementById('ts-rent').textContent = fmt(row1.annualRent);
    document.getElementById('ts-rent-weekly').textContent = fmt(row1.annualRent / 52) + '/wk';
    document.getElementById('ts-gap').textContent = (row1.gap > 0 ? '+' : '') + fmt(row1.gap);
    document.getElementById('ts-gap-note').textContent = inp.isInvestmentProperty
      ? (row1.gap >= 0 ? 'Net IP cash cost (saved by renter)' : 'Net IP cash surplus (saved by buyer)')
      : (row1.gap >= 0 ? 'Renter saves difference' : 'Buyer saves difference');
    const gapItem = document.getElementById('ts-gap-item');
    if (gapItem) {
      gapItem.classList.remove('gap-rent', 'gap-buy');
      gapItem.classList.add(row1.gap >= 0 ? 'gap-rent' : 'gap-buy');
    }
    document.getElementById('ts-initial-invest').textContent = fmt(inp.totalSavings);
  }

  // ── CHARTS & TABLE ──
  buildProjectionChart(result.rows, result, inp, mc);
  buildFinalChart(result);
  if (row1) buildOwnCostChart(row1);
  buildGapChart(result.rows);
  buildEquityChart(result.rows);
  renderYearTable(result.rows, inp);

  saveState();
}

// ══════════════════════════════════════════════════════════
//  FLOATING TOOLTIPS & RESPONSIVE EVENT LISTENERS
// ══════════════════════════════════════════════════════════

let _activeTooltipBtn = null;
function initTooltips() {
  const portal = document.createElement('div');
  portal.id = 'floating-tooltip';
  portal.setAttribute('role', 'tooltip');
  portal.hidden = true;
  document.body.appendChild(portal);

  const show = (btn) => {
    const textEl = btn.closest('.tooltip-wrap')?.querySelector('.tooltip-text');
    if (!textEl) return;
    portal.textContent = textEl.textContent.trim();
    portal.hidden = false;
    portal.style.visibility = 'hidden';

    const rect = btn.getBoundingClientRect();
    const tipRect = portal.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 10;

    let left = rect.left + rect.width / 2 - tipRect.width / 2;
    left = Math.max(margin, Math.min(vw - tipRect.width - margin, left));

    let top = rect.top - tipRect.height - 8;
    if (top < margin) {
      top = Math.min(vh - tipRect.height - margin, rect.bottom + 8);
    }
    portal.style.left = `${Math.round(left)}px`;
    portal.style.top = `${Math.round(top)}px`;
    portal.style.visibility = 'visible';
    _activeTooltipBtn = btn;
  };

  const hide = () => {
    portal.hidden = true;
    _activeTooltipBtn = null;
  };

  document.querySelectorAll('.tooltip-icon').forEach(btn => {
    btn.addEventListener('mouseenter', () => show(btn));
    btn.addEventListener('focus', () => show(btn));
    btn.addEventListener('mouseleave', () => { if (document.activeElement !== btn) hide(); });
    btn.addEventListener('blur', hide);
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      if (!portal.hidden && _activeTooltipBtn === btn) hide();
      else show(btn);
    });
  });

  document.addEventListener('click', hide);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
  document.getElementById('input-panel')?.addEventListener('scroll', hide, { passive: true });
}

let resizeDebounce;
function handleResize() {
  clearTimeout(resizeDebounce);
  resizeDebounce = setTimeout(() => {
    if (typeof Chart !== 'undefined') {
      Chart.defaults.font.size = isMobileView() ? 10 : 11;
    }
    if (_lastResult && _lastRows.length && _lastInp) {
      buildProjectionChart(_lastRows, _lastResult, _lastInp, _lastMc);
      buildFinalChart(_lastResult);
      if (_lastRows[0]) buildOwnCostChart(_lastRows[0]);
      buildGapChart(_lastRows);
      buildEquityChart(_lastRows);
    }
  }, 120);
}

function initUX() {
  // Set initial mobile tab visibility cleanly
  const resultsPanel = document.getElementById('results-panel');
  const inputPanel = document.getElementById('input-panel');
  if (inputPanel && resultsPanel) {
    inputPanel.classList.remove('mobile-hidden');
    resultsPanel.classList.add('mobile-hidden');
  }

  document.querySelectorAll('input[type="number"]').forEach(el => {
    el.addEventListener('focus', function () { this.select(); });
  });

  // Snap out-of-range numeric inputs back into slider bounds on commit
  DUAL_INPUT_PAIRS.forEach(([rangeId, numId, lbl, pre, suf]) => {
    const numEl = document.getElementById(numId);
    if (!numEl) return;
    numEl.addEventListener('change', () => {
      const min = parseFloat(numEl.min);
      const max = parseFloat(numEl.max);
      let v = parseFloat(numEl.value);
      if (isNaN(v)) v = parseFloat(document.getElementById(rangeId)?.value || min || 0);
      if (!isNaN(min)) v = Math.max(min, v);
      if (!isNaN(max)) v = Math.min(max, v);
      numEl.value = v;
      syncDualInput(numId, rangeId, lbl, pre, suf);
      calc();
    });
  });

  // Clear preset highlight when preset-controlled fields are edited manually
  const presetFields = new Set(Object.values(CITY_PRESETS).flatMap(p => Object.keys(p)));
  presetFields.forEach(id => {
    document.getElementById(id)?.addEventListener('input', clearActivePreset);
  });

  initTooltips();

  window.addEventListener('resize', handleResize);
  window.addEventListener('orientationchange', handleResize);
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    initDark();
    if (!applyUrlParams()) loadState();
    initUX();
    updateRangeLabels();
    updateConditionalUI();
    _calc();
  });
}

// Export pure engine functions for automated testing in non-browser runtimes
globalThis.__rentVBuyEngine = {
  incomeTax,
  totalIncomeTax,
  marginalTaxRate,
  computeIncrementalTax,
  estimateStampDuty,
  estimateLMI,
  computeUpfrontAndLoan,
  annualMortgageRepayment,
  amortizeYear,
  growEtfYear,
  computePortfolioCgt,
  computePropertyCgt,
  project,
  discountToday,
  runMonteCarlo,
  solveBreakeven,
  fmt,
  fmtK,
  fmtAxis,
  pct,
};
