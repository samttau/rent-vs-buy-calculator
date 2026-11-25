# Australian Rent vs Buy Calculator

A single page financial calculator for comparing buying a home against renting and investing the difference in Australia. It handles mortgage amortisation, stamp duty, CGT, franking credits, negative gearing, a Monte Carlo simulation, NPV, and a break-even sensitivity report.

It runs entirely client side in vanilla JavaScript. No backend, no build tooling, no dependencies apart from [Chart.js](https://www.chartjs.org/) pulled in from a CDN.

## Why this exists

Most rent vs buy calculators either skip the tax side of things or bury the actual driver of the outcome (mortgage interest vs investment returns) under a pile of toggles. This one tries to track every dollar properly. Anything not spent on one path ends up invested, sitting in a mortgage offset, or accounted for as a cost somewhere, so the comparison is genuinely apples to apples rather than a back of envelope guess.

## Running it

```bash
docker compose up -d
```

Then open http://localhost:8182.

Without Docker, it's a static site, so any web server works:

```bash
python3 -m http.server 8000
```

or just open `index.html` directly.

## Running tests

The pure financial engine has an automated unit test suite in [tests/engine.test.js](tests/engine.test.js) runnable with `gjs` or `node`:

```bash
gjs tests/engine.test.js
```

## How the model works

### Differential cash flow

Each year the calculator works out:

```
ownerCarry  = mortgage repayment + maintenance + rates/body corp + insurance
              + land tax - rental income (if investment property) - negative
              gearing tax benefit
renterCarry = rent + contents insurance
gap         = isInvestmentProperty ? ownerCarry : (ownerCarry - renterCarry)
```

When owning costs more than renting (`gap > 0`), the renter's ETF portfolio grows by `gap` (with mid-year contribution averaging), since the renter saves whatever the buyer spends above an equivalent rent. When owning costs less (`gap < 0`), the buyer allocates `-gap` to their chosen surplus destination (mortgage offset or ETFs). In investment-property mode, both paths pay rent elsewhere so `renterCarry` cancels out and `gap = ownerCarry`.

It's a differential model. It never tracks total income or total household spending, only the gap between the two paths. Anything that costs the same either way (groceries, HECS repayments) cancels out and is left out on purpose.

### Money is always sitting somewhere

At any point every dollar is in exactly one of these places:

- the renter's ETF portfolio, starting from day-one `Total Savings` minus the refundable rental bond (which sits at 0% return and refunds at nominal face value at exit), plus annual `gap > 0` contributions
- the buyer's mortgage offset account, reducing the interest-bearing loan balance dollar for dollar (a tax-free, guaranteed return equal to the mortgage rate)
- the buyer's own ETF surplus pot, which absorbs anything left over once the offset fully covers the loan (or receives all buyer surpluses directly when `surplusDestination` is set to ETF)
- property equity (value minus mortgage balance)

Nothing gets silently dropped or double counted. Surplus sitting in one place never also drains another pot for the same dollar.

### Mortgage

Standard principal and interest (or interest only) amortisation, done monthly and rolled up per year. An offset balance reduces the interest-bearing amount (balance minus offset) each month, the way a real 100% offset account works.

### Tax

- Income tax: either a flat marginal rate you set, or derived each year from the ATO FY 2025–26 brackets plus the 2% Medicare Levy, applied to a gross salary that can optionally grow with inflation so bracket creep is captured.
- Dividend/distribution tax: annual ETF distributions are taxed at the marginal rate with a franking credit top-up or refund based on the franking level you set (0% for unfranked/international funds, up to 100% for a fully franked ASX fund).
- Capital gains tax on portfolios (and on the property when `Property is main residence (CGT-exempt)` is turned off), stacked progressively onto exit-year taxable income under Income mode, with two methods to choose from:
  - FY27 rules (the default), modelling CPI indexation of each contribution's cost base so only the real gain is taxed, at a 30% minimum rate. Pensioners and income support recipients keep their ordinary marginal rate instead of the floor.
  - Legacy, meaning current law: a 50% discount on gains held over 12 months (applied to the long-term portion of contributions).
  - The buyer's main residence is treated as fully CGT exempt on sale unless toggled off.
- Negative gearing (only relevant if you flip the property to "investment property" mode) deducts loan **interest** (never principal), carrying costs, and flat annual depreciation against net rental income, defaulting to abolished for rental losses to model an assumed FY27 policy baseline (with a toggle to compare against current-law negative gearing).

### Buying costs modelled

Stamp duty (auto-estimated per state including VIC PPR / QLD Home concessions and first home buyer rules), legal fees, Lenders Mortgage Insurance (auto-estimated by LVR band), the First Home Owner Grant, selling agent fees, council rates, body corporate/strata fees with their own growth rate (zero for a standalone house), building insurance, and ongoing maintenance as a percentage of property value.

### Investment property mode

You can optionally model the property as a rental instead of somewhere you live: rental income net of a vacancy allowance and property management fees, land tax, and flat depreciation deductions (a non-cash deduction that reduces taxable rental income/loss without being a real cash cost), plus optional property CGT on exit.

### NPV and the break-even report

Results are shown two ways: nominal (actual after-tax, after-selling-cost liquidation dollars at the end of the horizon) and NPV (discounted back to today's dollars using the inflation rate). NPV is the fairer basis for comparison, since a dollar in year 30 is worth much less than a dollar today.

Below the main results, a break-even report uses a bisection solver to answer how far each key lever (weekly rent, rent growth, mortgage rate, property growth, investment return, purchase price including stamp duty, council rates, and maintenance rate) would need to move, holding everything else fixed, to equalise NPV.

### Monte Carlo simulation

400 randomised market and property growth histories with imperfect correlation ($\rho = 0.25$), seeded so results stay deterministic between recalculations, report the share of simulations where buying comes out ahead on net liquidation wealth and plot the 10th–90th percentile cones.

## Features

- Per-state stamp duty auto estimation (NSW, VIC, QLD, WA, SA, TAS, ACT, NT), plus an LMI auto estimator based on LVR band
- Mortgage offset vs surplus ETF investing, with automatic overflow between the two
- 5 charts covering net liquidation wealth paths, final position (nominal vs NPV), year 1 cost breakdown, annual cash-flow gap, and property value vs mortgage balance
- Automated break-even sensitivity report using a bisection solver
- Monte Carlo simulation (400 runs) with a buy-success percentage and percentile cones
- Interactive what-if slider for the analysis horizon
- Alternate scenario cards evaluated in NPV (higher rates, faster rent growth, longer horizon, etc.)
- One-click full CSV export covering inputs, summary, scenarios, break-even report, and the full year-by-year table in one file
- Dark mode, shareable links (inputs encoded in the URL), local persistence via `localStorage`
- Diagnostic audit log for copying the full input/output JSON to the clipboard

## Privacy

Everything runs in your browser. There's no backend and no analytics. Inputs never go anywhere except your own browser's local storage (so it remembers your last session) or into a URL if you deliberately use the share link button.

## Project structure

```
.
├── index.html          UI markup and input controls
├── app.js              the financial model, chart rendering, and UI wiring
├── style.css           styling and dark mode
├── tests/
│   └── engine.test.js  unit tests for the financial engine
├── Dockerfile          nginx:alpine static file server
├── .dockerignore       keeps repo/dev files out of container image
├── docker-compose.yml  runs on port 8182
└── vercel.json         security headers and caching for Vercel deployment
```

## Assumptions and limitations

This is a decision support tool, not financial advice. Simplifications worth knowing about:

- The mortgage rate is held constant for the whole horizon. No rate resets or refinancing are modelled, though the "Higher Interest Rate" scenario card and Monte Carlo volatility partially cover for that.
- Stamp duty bands are approximate schedules and change over time, so always check with your state revenue office.
- The Medicare Levy Surcharge, HECS/HELP repayments, and superannuation aren't modelled. HECS cancels out of a differential model because it depends on income rather than housing tenure.
- Utility cost differences and one-off body corporate special levies are assumed to be a wash between renting and owning.
- The FY27 CGT reform and negative gearing defaults model an assumed future policy environment, not enacted law at time of writing, so check current rules before making a real decision.

## License

No license file included, so treat it as all rights reserved unless you add one.
