"""Offline launch-day Twitch quantiles and a comparable-only backtest."""

import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
from statistics import median

LEVELS = (0.05, 0.25, 0.5, 0.75, 0.95)
NORMAL_LEVELS = (-1.645, -0.674, 0, 0.674, 1.645)
HORIZONS = range(1, 24)
SQRT_TWO = math.sqrt(2)


def log_count(value):
    return math.log(max(1, value))


def utc_timestamp(value):
    if not isinstance(value, str):
        return None
    try:
        timestamp = datetime.fromisoformat(value)
        if timestamp.tzinfo is not None:
            return timestamp.astimezone(timezone.utc)
    except (ValueError, OverflowError):
        return None


def object_rows(rows):
    if isinstance(rows, list):
        yield from (row for row in rows if isinstance(row, dict))


def count(value):
    if type(value) in (int, float) and 0 <= value <= 2**53:
        return value
    return None


def counts(row):
    return {field: count(row.get(field)) for field in ("viewers", "channels")}


def hourly_rows(rows, start, *, history_only=False):
    result = {}
    for row in object_rows(rows):
        timestamp = utc_timestamp(row.get("from"))
        if timestamp is None:
            continue
        offset = (timestamp - start).total_seconds() / 3600
        if offset.is_integer() and (not history_only or offset <= 0):
            key = int(offset)
            values = counts(row)
            if key not in result or result[key]["viewers"] is None:
                result[key] = values
    return result


def regime(description):
    # Ignore the kit's retrospective tier and peak commentary.
    text = description.lower().split("tier:")[0].split("source:")[0]
    if "no early access" not in text and any(
        phrase in text for phrase in ("early access", "early-access")
    ):
        return "early"
    if any(phrase in text for phrase in ("rolling", "midnight local")):
        if "pc single" in text or "steam global" in text or "pc/stadia simultaneous" in text:
            return "mixed"
        return "rolling"
    if ("single" in text or "simultaneous" in text) and "global" in text and "inferred" not in text:
        return "global"
    return "unknown"


def snapshot(rows, launch_regime, platforms):
    first = rows.get(0, {})
    viewers = first.get("viewers")
    channels = first.get("channels")
    level = log_count(viewers) if viewers is not None else None

    def growth(field, current, offsets):
        previous = [
            log_count(rows[h][field])
            for h in offsets
            if h in rows and rows[h].get(field) is not None
        ]
        if current is None or not previous:
            return None
        return max(-4, min(4, log_count(current) - median(previous)))

    features = (
        level,
        growth("viewers", viewers, (-1,)),
        growth("viewers", viewers, (-4, -3, -2)),
        growth("viewers", viewers, (-12, -11, -10, -9, -8, -7, -6)),
        growth("channels", channels, (-4, -3, -2)),
        level - log_count(channels) if level is not None and channels else None,
    )
    pc = "pc" in platforms.lower() if platforms else None
    return Snapshot(level, launch_regime, pc, features)


@dataclass(frozen=True)
class Snapshot:
    level: float | None
    regime: str
    pc: bool | None
    features: tuple


@dataclass(frozen=True)
class Launch:
    name: str
    snapshot: Snapshot
    ratios: dict


def comparable_launches(records):
    launches = {}
    for record in records:
        if not isinstance(record, dict):
            continue
        name = record.get("name")
        start = utc_timestamp(record.get("day_start"))
        if not isinstance(name, str) or not name.strip() or start is None:
            continue
        unlock = record.get("unlock")
        unlock = unlock.strip() if isinstance(unlock, str) else ""
        if "target-history" in unlock.lower() or unlock.lower().startswith("not a launch"):
            continue
        key = (" ".join(name.casefold().split()), start.date())
        rows = hourly_rows(record.get("hourly"), start)
        platforms = record.get("platforms")
        state = snapshot(rows, regime(unlock), platforms if isinstance(platforms, str) else None)
        if state.level is None:
            continue
        ratios = {
            h: log_count(rows[h]["viewers"]) - state.level
            for h in HORIZONS if h in rows and rows[h].get("viewers") is not None
        }
        # A damaged early copy should not crowd out a more complete duplicate.
        if ratios and (key not in launches or len(ratios) > len(launches[key].ratios)):
            launches[key] = Launch(name, state, ratios)
    return list(launches.values())


def similarity(target, analog):
    if target.level is None:
        return 0.0
    scales = (1.30, 0.65, 1.15, 1.70, 1.40, 0.85)
    importance = (1.30, 0.75, 0.90, 0.70, 0.50, 0.45)
    distance = sum(
        weight * math.log1p(((left - right) / scale) ** 2)
        for left, right, scale, weight in zip(
            target.features, analog.features, scales, importance
        )
        if left is not None and right is not None
    )
    weight = math.exp(-0.65 * distance)
    if target.regime != analog.regime:
        if "unknown" in (target.regime, analog.regime):
            weight *= 0.55
        elif {target.regime, analog.regime} == {"rolling", "mixed"}:
            weight *= 0.65
        else:
            weight *= 0.18
    if target.pc is not None and analog.pc is not None and target.pc != analog.pc:
        weight *= 0.65
    return weight


def weighted_launches(target, launches):
    return [(launch, similarity(target, launch.snapshot)) for launch in launches]


def distribution(neighbors, horizon, adjustment=0.0):
    """A weighted Gaussian mixture over log changes from the first hour."""
    analogs = [(launch.ratios[horizon], w) for launch, w in neighbors
               if horizon in launch.ratios and w > 0]
    mass = sum(w for _, w in analogs)
    persistence_spread = 0.15 * math.sqrt(horizon)
    if not mass:
        return [(adjustment, persistence_spread, 1.0)]
    effective = mass * mass / sum(w * w for _, w in analogs)
    bandwidth = 0.13 + 0.025 * math.sqrt(horizon)
    # Reserve more probability for persistence as absolute match quality or support falls.
    prior_mass = min(0.70, 0.06 + 0.30 / (1 + mass) + 0.30 / (1 + effective))
    return [(change + adjustment, bandwidth, (1 - prior_mass) * w / mass)
            for change, w in analogs] + [(adjustment, persistence_spread, prior_mass)]


def cdf(components, value):
    return sum(weight * (1 + math.erf((value - mean) / (spread * SQRT_TWO))) / 2
               for mean, spread, weight in components)


def quantile(components, probability):
    low = min(mean - 8 * spread for mean, spread, _ in components)
    high = max(mean + 8 * spread for mean, spread, _ in components)
    for _ in range(28):
        center = (low + high) / 2
        if cdf(components, center) < probability:
            low = center
        else:
            high = center
    return (low + high) / 2


def calibration_records(launches):
    """PIT values for launches predicted without their own release-day trajectory."""
    records = []
    for position, launch in enumerate(launches):
        neighbors = weighted_launches(launch.snapshot, launches[:position] + launches[position + 1:])
        pits = {
            h: cdf(distribution(neighbors, h), outcome)
            for h, outcome in launch.ratios.items()
        }
        records.append(pits)
    return records


def calibrated_levels(records, neighbors, horizon):
    # Use at most one PIT per launch. Shrink the local PIT CDF toward uniform,
    # reserving 24 observations' worth of weight for the uncalibrated forecast.
    sample = sorted((pits[horizon], weight)
                    for pits, (_, weight) in zip(records, neighbors)
                    if horizon in pits and weight > 0)
    if not sample:
        return LEVELS
    mass = sum(weight for _, weight in sample)
    effective = mass * mass / sum(weight * weight for _, weight in sample)
    strength = effective / (24 + effective) * min(1, mass)
    knots = [(0.0, 0.0)]
    cumulative = 0.0
    for pit, weight in sample:
        cumulative += weight / (2 * mass)
        knots.append(((1 - strength) * pit + strength * cumulative, pit))
        cumulative += weight / (2 * mass)
    knots.append((1.0, 1.0))
    adjusted = []
    for level in LEVELS:
        for (left, bottom), (right, top) in zip(knots, knots[1:]):
            if left < level <= right:
                probability = bottom + (top - bottom) * (level - left) / (right - left)
                adjusted.append(max(0.005, min(0.995, probability)))
                break
    return adjusted


def forecast_logs(target, launches, horizons, minute_trend=0.0, fallback=0.0):
    neighbors = weighted_launches(target, launches)
    records = calibration_records(launches)
    level = target.level if target.level is not None else fallback
    for h in horizons:
        # Hourly archives lack intra-hour reads. Use the live trend only as a
        # bounded near-term correction and let the analog curves take over.
        adjustment = minute_trend * math.exp(-(h - 1) / 1.5)
        components = distribution(neighbors, h, adjustment)
        probabilities = calibrated_levels(records, neighbors, h)
        yield h, [level + quantile(components, p) for p in probabilities]


def first_hour_reads(history, start):
    minutes = {}
    for row in object_rows(history):
        timestamp = utc_timestamp(row.get("at"))
        if timestamp is None:
            continue
        seconds = (timestamp - start).total_seconds()
        if 0 <= seconds < 3600:
            values = counts(row)
            if values["viewers"] is not None:
                minutes.setdefault(int(seconds // 60), values)
    return minutes


def first_hour_trend(minutes):
    early = [log_count(row["viewers"]) for minute, row in minutes.items() if minute < 20]
    late = [log_count(row["viewers"]) for minute, row in minutes.items() if minute >= 40]
    if min(len(early), len(late)) < 5:
        return 0.0
    return max(-0.30, min(0.30, 0.5 * (median(late) - median(early))))


def viewer_quantiles(values):
    return [round(math.exp(max(0, min(math.log(1e9), value))), 6)
            for value in values]


def forecast_case(case):
    records = object_rows(case.get("comparables"))
    launches = comparable_launches(records)
    start = datetime.fromisoformat(case["day_start"])
    rows = hourly_rows(case.get("history_hourly"), start, history_only=True)
    minutes = first_hour_reads(case.get("history"), start)
    first = next((counts(row) for row in object_rows(case.get("known"))
                  if row.get("hour") == 1 and count(row.get("viewers")) is not None), None)
    if first is not None:
        rows[0] = first
    elif rows.get(0, {}).get("viewers") is None and minutes:
        rows[0] = {}
        for field in ("viewers", "channels"):
            readings = [row[field] for row in minutes.values() if row[field] is not None]
            rows[0][field] = math.floor(sum(readings) / len(readings) + 0.5) if readings else None
    # The rules specify console launches with rolling local-midnight unlocks.
    state = snapshot(rows, "rolling", "console")
    previous = [log_count(row["viewers"]) for _, row in sorted(rows.items())
                if row["viewers"] is not None]
    fallback = median(previous[-6:]) if previous else 0.0
    logs = forecast_logs(state, launches, (r["hour"] - 1 for r in case["forecast"]),
                         first_hour_trend(minutes), fallback)
    return {"hours": [
        {"hour": h + 1, "q": viewer_quantiles(values)}
        for h, values in logs
    ]}


def backtest(paths):
    records = (record for path in paths
               for record in object_rows(json.loads(path.read_text(encoding="utf-8")).get("comparables")))
    launches = comparable_launches(records)
    if len(launches) < 2:
        raise SystemExit("Backtesting requires at least two distinct launches.")
    groups = {"all": [], "rolling": []}
    for position, launch in enumerate(launches):
        training = launches[:position] + launches[position + 1:]
        state = launch.snapshot
        results = []
        for h, prediction in forecast_logs(state, training, launch.ratios):
            actual = state.level + launch.ratios[h]
            center = math.exp(state.level)
            baseline = [
                math.log(math.floor(100 * center * math.exp(z * 0.15 * math.sqrt(h)) + 0.5) / 100)
                for z in NORMAL_LEVELS
            ]
            results.append((actual, [math.log(q) for q in viewer_quantiles(prediction)], baseline))
        groups["all"].append(results)
        if state.regime == "rolling":
            groups["rolling"].append(results)
    for name, folds in groups.items():
        hours = [row for fold in folds for row in fold]
        if not hours:
            continue
        print(f"{name}: {len(folds)} launches, {len(hours)} scored hours")
        for index, label in enumerate(("forecast", "house persistence"), start=1):
            loss = error = covered = 0.0
            for row in hours:
                actual, quantiles = row[0], row[index]
                error += abs(actual - quantiles[2])
                covered += quantiles[0] <= actual <= quantiles[-1]
                for level, estimate in zip(LEVELS, quantiles):
                    delta = actual - estimate
                    loss += 2 * max(level * delta, (level - 1) * delta)
            print(f"  {label}: loss {loss / (5 * len(hours)):.6f}, "
                  f"typical miss {100 * math.expm1(error / len(hours)):.2f}%, "
                  f"90% coverage {covered / len(hours):.3f}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backtest", type=Path, nargs="+", metavar="CASE")
    args = parser.parse_args()
    if args.backtest:
        backtest(args.backtest)
        return
    input_dir = Path(os.environ.get("MAKEFUN_INPUT_DIR", "/input"))
    output_dir = Path(os.environ.get("MAKEFUN_OUTPUT_DIR", "/output"))
    output_dir.mkdir(parents=True, exist_ok=True)
    for path in sorted(input_dir.glob("*.in")):
        case = json.loads(path.read_text(encoding="utf-8"))
        result = forecast_case(case)
        (output_dir / f"{path.stem}.out").write_text(
            json.dumps(result, separators=(",", ":"), allow_nan=False) + "\n",
            encoding="utf-8",
        )


if __name__ == "__main__":
    main()
