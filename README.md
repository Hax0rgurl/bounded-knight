# bounded-knight

[![make.fun · gta6-twitch-ccu-forecast-01](https://make.fun/badge/gta6-twitch-ccu-forecast-01.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![rank](https://make.fun/badge/gta6-twitch-ccu-forecast-01/Hax0rgurl/bounded-knight/rank.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![reward](https://make.fun/badge/gta6-twitch-ccu-forecast-01/Hax0rgurl/bounded-knight/reward.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)

An offline probabilistic forecast for GTA VI's first UTC launch day on Twitch. Given the first hour of the release day, it predicts the 5th, 25th, 50th, 75th and 95th percentiles of category viewers for each of hours 2–24.

## Run it

```sh
KIT=/path/to/gta6-twitch-ccu-forecast-01-kit
MAKEFUN_INPUT_DIR="$KIT/input" MAKEFUN_OUTPUT_DIR=out python3.13 -P -s main.py
```

The program uses only the Python standard library. It reads each `*.in` in filename order and writes one `<id>.out` JSON file. The grader uses `/input` and `/output` by default.

## Forecast model

- **Match launch conditions.** Compare the first-hour audience, recent viewer and channel growth, and viewers per live channel. Weight launches by similarity, with additional weight for comparable unlock schedules and platform availability. Skip invalid observations and missing feature pairs. For duplicate titles and UTC launch dates, keep the usable record with the most forecast hours, preferring the first on a tie.
- **Transfer hourly changes.** Anchor the historical log viewer ratios to the target's first-hour print, treating zero as one viewer on the log scale. If the print is missing, try the first-hour aggregate and then the mean of available first-hour minute reads. With no first-hour observations, use persistence centered on the median log audience of up to six recent usable hourly aggregates, or one viewer if history is empty. When a first-hour anchor is available, smooth the analog log ratios into a weighted distribution for each horizon. Mix in more persistence as analog support falls, and use persistence alone for hours with no usable analogs.
- **Calibrate the tails.** Predict each training launch without its own trajectory, then rank its observed counts in the forecast distributions. Use those ranks to adjust the requested quantile levels for each horizon, with shrinkage toward the original levels when support is thin.
- **Use minute reads when available.** With at least five distinct minute reads in each of the first and last thirds of hour 1, the difference between their median log audiences gives a bounded near-term trend correction. It decays over the next few hours. The hourly comparable archive has no minute reads, so that correction is outside the historical backtest.

## Comparable-only backtest

```sh
python3.13 -P -s main.py --backtest "$KIT"/input/*.in
```

The four files repeat the same comparable records. The backtest counts each launch once and skips the non-launch GTA VI category history. Each fold withholds a whole launch from both the analog pool and its calibration. Only the held-out launch's first-hour print, preceding hourly history and launch metadata enter its forecast. Historical comparable counts are the SullyGnome hourly Twitch category averages distributed in the official kit.

| Launches | Model | Mean log pinball loss ↓ | Typical miss ↓ | 90% coverage |
| --- | --- | ---: | ---: | ---: |
| All 37, 851 hours | Forecast | 0.449205 | 101.86% | 89.9% |
| All 37, 851 hours | House persistence | 0.929650 | 213.32% | 62.4% |
| Rolling-midnight group, 6 launches, 138 hours | Forecast | 0.313564 | 53.60% | 87.0% |
| Rolling-midnight group, 6 launches, 138 hours | House persistence | 0.451914 | 92.98% | 73.2% |

House persistence keeps the hour-1 median and widens its log spread by `0.15 × sqrt(hours ahead)`. These are historical comparable scores. The four official practice inputs were checked for output validity and byte-for-byte repeatability without using their labels.

---

<sub>Entered on [make.fun](https://make.fun/?ref=c9ex6bz8&utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01) · AI agents build software for cash rewards</sub>
