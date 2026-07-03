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

or just open index.html directly.

## How the model works

### Differential cash flow

Each year the calculator works out:

```
ownerCarry  = mortgage repayment + maintenance + rates/body corp + insurance
              + land tax - rental income (if investment property) - negative
              gearing tax benefit
renterCarry = rent + contents insurance
gap         = ownerCarry - renterCarry
```

When owning costs more that year (gap > 0), the renter's portfolio grows by that amount, since the renter is saving whatever the buyer is spending on top of an equivalent rent. When gap < 0, the renter draws down their portfolio to cover the shortfall, and the buyer's surplus pot grows instead.

It's a differential model. It never tracks total income or total household spending, only the gap between the two paths. Anything that costs the same either way (groceries, HECS repayments) cancels out and is left out on purpose.

### Money is always sitting somewhere

At any point every dollar is in exactly one of these places:

- the renter's ETF portfolio, which grows from the day one Total Savings investment plus or minus the annual cash flow gap
- the buyer's mortgage offset account, reducing the interest bearing loan balance dollar for dollar (a tax free, guaranteed return equal to the mortgage rate)
- the buyer's own ETF surplus pot, which absorbs anything left over once the offset fully covers the loan
- property equity (value minus mortgage balance)

Nothing gets silently dropped or double counted. Surplus sitting in one place never also drains another pot for the same dollar.

### Mortgage

Standard principal and interest (or interest only) amortisation, done monthly and rolled up per year. An offset balance reduces the interest bearing amount (balance minus offset) each month, the way a real 100% offset account works.

### Tax

- Income tax: either a flat marginal rate you set, or derived each year from the ATO FY 2025-26 brackets plus the 2% Medicare Levy, applied to a gross salary that can optionally grow with inflation so bracket creep is captured.
- Dividend/distribution tax: annual ETF distributions are taxed at the marginal rate with a franking credit top up or discount based on the franking level you set (0% for unfranked/international funds, up to 100% for a fully franked ASX fund).
- Capital gains tax on the renter's (and buyer's surplus) portfolio, with two methods to choose from:
  - FY27 rules (the default), modelling the Treasury Laws Amendment (Tax Reform No. 1) Bill 2026. The 50% CGT discount is replaced by CPI indexation of each contribution's cost base, so only the real gain is taxed, at a 30% minimum rate. Pensioners and income support recipients keep their ordinary marginal rate instead of the floor.
  - Legacy, meaning current law: a flat 50% discount on gains held over 12 months.
  - The buyer's main residence is always assumed fully CGT exempt on sale regardless of which method applies to the ETF side.
- Negative gearing (only relevant if you flip the property to "investment property" mode) defaults to abolished for properties bought after 12 May 2026, reflecting an assumed FY27 policy change where rental losses can't offset salary income. There's a toggle to compare against the current rules.

### Buying costs modelled

Stamp duty (auto estimated per state, with rough first home buyer concessions), legal fees, Lenders Mortgage Insurance (auto estimated by LVR band), the First Home Owner Grant, selling agent fees, council rates, body corporate/strata fees with their own growth rate (zero for a standalone house), building insurance, and ongoing maintenance as a percentage of property value.

### Investment property mode

You can optionally model the property as a rental instead of somewhere you live: rental income net of a vacancy allowance and property management fees, land tax, and depreciation deductions (a non-cash deduction that reduces the taxable loss without being a real cash cost).

### NPV and the break-even report

Results are shown two ways: nominal (actual dollars at the end of the horizon) and NPV (discounted back to today's dollars using the inflation rate). NPV is really the fairer basis for comparison, since a dollar in year 30 is worth a lot less than a dollar today.

Below the main results, a break-even report uses a bisection solver to answer questions like how much rent would need to rise for buying and renting to end up exactly equal. It does this for each key lever: weekly rent, rent growth, mortgage rate, property growth, investment return, purchase price, council rates, and maintenance rate, holding everything else fixed.

### Monte Carlo simulation

400 randomised market and property growth histories, seeded so results stay stable between recalculations, report the share of simulations where buying comes out ahead. Gives a sense of how sensitive the verdict is to volatility rather than just relying on the single point estimate.

## Features

- Per state stamp duty auto estimation (NSW, VIC, QLD, WA, SA, TAS, ACT, NT), plus an LMI auto estimator based on LVR band
- Mortgage offset vs surplus ETF investing, with automatic overflow between the two
- 5 charts covering wealth paths, final position (nominal vs NPV), year 1 cost breakdown, annual cash flow gap, and property value vs mortgage balance
- Automated break-even sensitivity report using a bisection solver
- Monte Carlo simulation (400 runs) with a buy-success percentage
- Interactive what-if slider for the analysis horizon
- Alternate scenario cards (higher rates, faster rent growth, longer horizon, etc.)
- One click full CSV export covering inputs, summary, scenarios, break-even report, and the full year by year table in one file
- Dark mode, shareable links (inputs encoded in the URL), local persistence via localStorage with a cookie fallback
- Diagnostic audit log for copying the full input/output JSON to the clipboard when debugging

## Privacy

Everything runs in your browser. There's no backend and no analytics. Inputs never go anywhere except your own browser's local storage (so it remembers your last session) or into a URL if you deliberately use the share link button.

## Project structure

```
.
├── index.html          UI markup and input controls
├── app.js              the financial model, chart rendering, and UI wiring
├── style.css           styling (shared lineage with the companion FIRE calculator)
├── Dockerfile           nginx:alpine static file server
├── docker-compose.yml   runs on port 8182
└── vercel.json          security headers and caching for Vercel deployment
```

No build step and no package.json. app.js is loaded directly by index.html as a plain script tag.

## Deployment

Docker:

```bash
docker compose up -d --build
```

Serves on http://localhost:8182 via nginx:alpine.

Vercel: connect the repo. vercel.json sets security headers and long cache lifetimes for .css/.js, with clean URLs on.

Anywhere else: it's three static files (index.html, app.js, style.css), so drop them on any static host.

## Assumptions and limitations

This is a decision support tool, not financial advice. A few simplifications worth knowing about, most of which are also disclosed in the app:

- The mortgage rate is held constant for the whole horizon. No rate resets or refinancing are modelled, though the "Higher Interest Rate" scenario card and Monte Carlo volatility partially cover for that.
- Stamp duty bands are approximate general owner occupier rates and change over time, so always check with your state revenue office.
- The Medicare Levy Surcharge, HECS/HELP repayments, and superannuation aren't modelled. HECS in particular was left out on purpose: since it's a function of income and doesn't differ between renting and buying, it cancels out of a differential model like this one and would add UI complexity for zero effect on the verdict.
- Utility cost differences and one-off body corporate special levies are assumed to be a wash between renting and owning.
- The FY27 CGT reform and negative gearing defaults model an assumed future policy environment, not confirmed enacted law at time of writing, so double check current rules before making a real decision.

## License

No license file included, so treat it as all rights reserved unless you add one.
