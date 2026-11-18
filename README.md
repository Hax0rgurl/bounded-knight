# bounded-knight

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Hax0rgurl/bounded-knight/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Hax0rgurl/bounded-knight/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Faultline is an offline token launch radar. It ranks 193 protocols from the sealed DefiLlama snapshot, covers all 40 watchlist entries, and keeps 416 token-recorded protocols in a separate reference view.

## Run it

```sh
KIT=/tmp/new-bounties.xrDv/token-radar-01-kit
node main.ts --input "$KIT/input" --output ./out
python -m http.server 8000 --bind 127.0.0.1 --directory ./out
```

Open `http://127.0.0.1:8000/dashboard/`. Use Node.js 22.18 or later in the Node 22 series for native TypeScript execution. The grader runs `node main.ts` with `/input/snapshot.json` and `/output`. An explicit `--input` accepts a directory or JSON file. `--output` and `MAKEFUN_OUTPUT_DIR` support local runs. The generator uses only the Node standard library and the kit’s vendored dossier builder.

The distribution chart filters by valuation band. Search by protocol name or slug, combine category and chain filters, or switch to the complete watchlist. Select a column to sort and a protocol to inspect its peer inputs and farm plan. The separate token-recorded view reports observed caps where the snapshot supplies them.

## Model

- **Coverage.** Use the full supplied watchlist and expand to other records without a ticker, CoinGecko ID or positive market cap. The expansion screens common wrapper categories, exchange names and versioned products. Parent-protocol metadata is unavailable, and curator and vault records can reflect the same underlying capital. Adding valuations across records would double-count some exposure.
- **Pricing.** Use up to 16 market-cap-to-TVL peers nearest by TVL from the same category or a related product group. Favor the category when it has at least four observations. Blend the local log median with the log median of up to 32 distinct market-wide peers nearest by TVL. Local weight is `n / (n + 6)`. Multiply the resulting multiple by the protocol’s TVL.
- **Adjustments.** Apply half the seven-day TVL percentage change, capped at ±15%, and a tracking-age multiplier from 0.90× to 1.10× over 730 days. Missing inputs use neutral adjustments. Seven-day TVL can move with asset prices. Tracking age measures the date DefiLlama began reporting the record.
- **Uncertainty.** Use the same blend at the 20th and 80th percentiles. Pad each log bound by `0.25 × (1 − local weight)` plus `0.15` per missing growth or age input. This is a scenario range, with no probability attached. The frozen snapshot cannot establish current token status, an airdrop, supply, dilution or launch timing.
- **Plans.** Each row has a category-specific sequence, setup time, and budget for diligence and any optional action. Plans include eligibility checks, cost or slippage checks and exit criteria. Time and budgets are planning estimates. The app sends no transactions and has no wallet connection.

## Verify locally

```sh
node scripts/check-output.ts "$KIT/input/snapshot.json" ./out
python scripts/capture.py ./out ./screenshots
```

The browser check uses Python Playwright and `/usr/bin/chromium`. It serves the output over loopback where TCP sockets are available. After refreshing screenshots, run the generator again to include them in the dossier. The local checker covers all seven artifact gates for this PNG-based entry. Official submission checks and judging happen on make.fun.

---

<sub>Entered on [make.fun](https://make.fun/?ref=c9ex6bz8&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
