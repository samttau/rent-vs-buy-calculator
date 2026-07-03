# 🏡 Australian Rent vs Buy Calculator

A single-page, no-build-step financial calculator that models the real, after-tax
cost of **buying a home** versus **renting and investing the difference** in
Australia — with proper mortgage amortisation, stamp duty, CGT, franking
credits, negative gearing, Monte Carlo simulation, NPV analysis, and an
automatic break-even sensitivity report.

Everything runs client-side in vanilla JavaScript. There's no backend, no
build tooling, and no external dependencies beyond [Chart.js](https://www.chartjs.org/)
loaded from a CDN.

## Why this exists

Most rent-vs-buy calculators either oversimplify (ignore tax, ignore
opportunity cost of the deposit) or bury the real driver of the outcome
(mortgage interest vs investment returns) under too many toggles. This tool
tries to model **every dollar** — every dollar not spent on one path is
either invested, sitting in a mortgage offset, or explicitly accounted for as
a cost — so the comparison is a true apples-to-apples one, not a rough
guess.

## Live demo

```bash
docker compose up -d
```

Then open **http://localhost:8182**.

## Quick start (no Docker)

This is a static site — any web server works:

```bash
python3 -m http.server 8000
# or just open index.html directly in a browser
```

## How the model works

### The core idea: differential cash flow

Each year, the calculator computes:

```
ownerCarry  = mortgage repayment + maintenance + rates/body corp + insurance
              + land tax − rental income (if investment property) − negative
              gearing tax benefit
renterCarry = rent + contents insurance
gap         = ownerCarry − renterCarry
```

If `gap > 0` (owning costs more that year), the **renter's portfolio grows**
by that amount — the renter is saving exactly what the buyer is spending on
top of an equivalent rent. If `gap < 0`, the renter draws down their
portfolio to cover the shortfall (or, symmetrically, the buyer's own surplus
pot grows).

This is a **differential model**: it never tracks total income or total
household spending, only the *difference* between the two paths. Anything
that costs exactly the same regardless of whether you rent or buy (e.g.
groceries, HECS/HELP repayments) cancels out of the comparison and is
deliberately left out.

### Money is always sitting somewhere

Every dollar in the model is at all times in exactly one of:

- **Renter's ETF portfolio** — grows from the day-1 "Total Savings" investment
  plus/minus the annual cash-flow gap
- **Buyer's mortgage offset account** — reduces the interest-bearing loan
  balance dollar-for-dollar (tax-free, guaranteed return equal to the
  mortgage rate)
- **Buyer's own ETF surplus pot** — once the offset account fully covers the
  outstanding loan, any further surplus automatically spills into ETFs
  (taxed like the renter's portfolio)
- **Property equity** (value minus mortgage balance)

Nothing is silently discarded or double-counted — surplus in one place never
also reduces or drains another pot for the same dollar.

### Mortgage

Standard principal & interest (or interest-only) amortisation, computed
monthly and rolled up annually. A mortgage offset balance reduces the
interest-bearing amount (`balance − offset`) each month, exactly like a real
100% offset account.

### Tax

- **Income tax**: either a flat user-set marginal rate, or derived each year
  from the ATO FY 2025–26 resident tax brackets (+ 2% Medicare Levy) applied
  to a gross salary that can optionally grow with inflation (bracket creep).
- **Dividend/distribution tax**: annual ETF distributions are taxed at the
  marginal rate, with a franking credit top-up/discount based on the
  franking level you set (0% for international/unfranked funds, up to 100%
  for a fully franked ASX fund).
- **Capital gains tax** on the renter's (and buyer's surplus) portfolio, with
  two selectable methods:
  - **FY27 rules** (default) — models the *Treasury Laws Amendment (Tax
    Reform No. 1) Bill 2026*: the 50% CGT discount is replaced by CPI
    indexation of each contribution's cost base, so only the **real** gain
    is taxed, at a 30% minimum rate (pensioners/income-support recipients
    keep their ordinary marginal rate instead of the floor).
  - **Legacy** — current law: a flat 50% discount on gains held over 12
    months.
  - The buyer's main residence (PPOR) is always assumed fully CGT-exempt on
    sale, regardless of which method is chosen for the ETF side.
- **Negative gearing** (only relevant if you flip the property to "treat as
  investment property"): defaults to **abolished** for properties bought
  after 12 May 2026, reflecting an assumed FY27 policy change — rental
  losses can't offset your salary income. Toggle it on to compare against
  the current/historical rules.

### Buying costs modelled

Stamp duty (auto-estimated per state/territory, with rough first-home-buyer
concessions), legal fees, Lenders Mortgage Insurance (auto-estimated by
LVR band), the First Home Owner Grant, selling agent fees, council rates,
body corporate/strata fees (with their own growth rate — $0 for a
standalone house), building insurance, and ongoing maintenance as a % of
property value.

### Investment property mode

Optionally model the property as a rental (not lived in): rental income net
of vacancy allowance and property management fees, land tax, and
depreciation deductions (a non-cash deduction that reduces taxable loss
without being a real cash cost).

### NPV & the break-even report

Every result is shown two ways: **nominal** (actual dollars at the end of
the horizon) and **NPV** (discounted back to today's dollars using the
general inflation rate) — NPV is the real basis for "which is actually
better," since a nominal dollar in year 30 is worth much less than one
today.

At the bottom of the results, a **break-even report** uses a bisection
solver to answer questions like *"how much would rent need to rise to make
buying and renting exactly equal?"* for each key lever — weekly rent, rent
growth, mortgage rate, property growth, investment return, purchase price,
council rates, and maintenance rate — holding everything else fixed.

### Monte Carlo simulation

400 randomised market/property-growth histories (seeded, so results are
stable across recalculations) report the share of simulations where buying
comes out ahead, giving a sense of how sensitive the verdict is to
volatility rather than just the single point-estimate case.

## Features

- 🌏 Per-state stamp duty auto-estimation (NSW, VIC, QLD, WA, SA, TAS, ACT, NT)
- 🏦 Mortgage offset vs surplus-ETF investing, with automatic overflow between the two
- 📊 5 charts: wealth paths, final position (nominal vs NPV), year-1 cost breakdown, annual cash-flow gap, and property value vs mortgage balance
- ⚖️ Automated break-even sensitivity report (bisection solver)
- 🎲 Monte Carlo simulation (400 runs) with a Buy-success percentage
- 🎛️ Interactive "what-if" slider for the analysis horizon
- 📋 Alternate scenario cards (higher rates, faster rent growth, longer horizon, etc.)
- 📄 One-click full CSV export — inputs, summary, scenarios, break-even report, and the full year-by-year table, all in one file
- 🌙 Dark mode, shareable links (all inputs encoded in the URL), local persistence
- 🔍 Diagnostic audit log (copy full input/output JSON to clipboard for debugging)

## Project structure

```
.
├── index.html          # All UI markup and input controls
├── app.js              # Entire financial model, chart rendering, and UI wiring
├── style.css           # Styling (shared lineage with the companion FIRE calculator)
├── Dockerfile           # nginx:alpine static file server
├── docker-compose.yml   # Runs on port 8182
└── vercel.json          # Security headers + caching for Vercel deployment
```

There's no build step and no package.json — `app.js` is loaded directly by
`index.html` as a plain `<script>` tag.

## Deployment

**Docker:**
```bash
docker compose up -d --build
```
Serves on `http://localhost:8182` (nginx:alpine, static files).

**Vercel:** connect the repo — `vercel.json` sets security headers and long
cache lifetimes for `.css`/`.js`, with clean URLs enabled.

**Anywhere else:** it's three static files (`index.html`, `app.js`,
`style.css`) — drop them on any static host.

## Assumptions & limitations

This is a decision-support tool, not financial advice. Notable
simplifications, all disclosed in-app:

- The mortgage interest rate is held constant for the whole horizon — no
  rate resets or refinancing is modelled (the "Higher Interest Rate"
  scenario card and Monte Carlo volatility partially compensate for this).
- Stamp duty bands are approximate general (non-surcharge) owner-occupier
  rates and change over time — always confirm with your state revenue
  office.
- The Medicare Levy Surcharge, HECS/HELP repayments, and superannuation are
  not modelled — HECS in particular is deliberately excluded because it's a
  differential model: since HECS is a function of income and doesn't differ
  between renting and buying, it cancels out of the comparison entirely and
  would only add UI complexity with zero effect on the verdict.
- Utility cost differences and one-off body-corporate special levies are
  assumed to be a wash between renting and owning.
- The FY27 CGT reform and negative-gearing defaults model an *assumed*
  future policy environment (per user-supplied legislative detail), not
  confirmed enacted law at the time of writing — always verify current
  rules before making a real decision.

## License

No license file included — treat as private/all-rights-reserved unless you
add one.
