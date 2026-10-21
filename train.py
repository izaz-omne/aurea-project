"""Train Aurea's compact weather-score model using only Python's standard library.

Run `python train.py` to fetch historical Dhaka weather and write the model consumed
by the Next.js app to `lib/ml/weather-model.json`. Use `python train.py --self-test`
to verify the trainer without a network connection.
"""
from __future__ import annotations

import datetime as dt
import json
import math
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

LATITUDE = 23.8103
LONGITUDE = 90.4125
TIMEZONE = "Asia/Dhaka"
START_DATE = "2015-01-01"
END_DATE = "2025-12-31"
OUTPUT_PATH = Path(__file__).parent / "lib" / "ml" / "weather-model.json"

MODE_WEIGHTS = {
    "landscape": (0.40, 0.12, 0.20, 0.12, 0.16),
    "portrait": (0.12, 0.38, 0.22, 0.18, 0.10),
    "street": (0.18, 0.30, 0.24, 0.16, 0.12),
    "astro": (0.62, 0.02, 0.18, 0.04, 0.14),
    "drone": (0.12, 0.08, 0.23, 0.42, 0.15),
    "wildlife": (0.18, 0.08, 0.22, 0.38, 0.14),
}

FEATURE_NAMES = ("open_sky", "diffuse_light", "dry_weather", "calm_air", "low_haze")
HOURLY_FIELDS = (
    "cloud_cover",
    "precipitation",
    "wind_speed_10m",
    "wind_gusts_10m",
    "relative_humidity_2m",
)


def bounded(value: float, low: float = 0, high: float = 100) -> float:
    return max(low, min(high, value))


def feature_row(cloud_cover: float, precipitation_mm: float, wind: float, humidity: float) -> list[float]:
    clouds = bounded(cloud_cover)
    return [
        bounded(100 - clouds) / 100,
        bounded(100 - abs(clouds - 65) * 1.7) / 100,
        bounded(100 - max(0, precipitation_mm) * 40) / 100,
        bounded(100 - max(0, wind) * 3.2) / 100,
        bounded(100 - bounded(humidity) * 0.25) / 100,
    ]


def weather_features(hourly: dict[str, list[Any]]) -> list[tuple[str, list[float]]]:
    rows = []
    for index, timestamp in enumerate(hourly["time"]):
        clouds = _number(hourly, "cloud_cover", index, 55)
        precipitation = _number(hourly, "precipitation", index, 0)
        wind = _number(hourly, "wind_gusts_10m", index, _number(hourly, "wind_speed_10m", index, 12))
        humidity = _number(hourly, "relative_humidity_2m", index, 60)
        rows.append((timestamp, feature_row(clouds, precipitation, wind, humidity)))
    return rows


def _number(data: dict[str, list[Any]], key: str, index: int, fallback: float) -> float:
    values = data.get(key)
    value = values[index] if values and index < len(values) else None
    if isinstance(value, (int, float)) and math.isfinite(value):
        return float(value)
    return fallback


def teacher_score(features: list[float], weights: tuple[float, ...]) -> float:
    return sum(feature * weight for feature, weight in zip(features, weights)) * 100


def solve_linear_system(matrix: list[list[float]], values: list[float]) -> list[float]:
    """Solve a small normal-equation system with partial pivoting."""
    size = len(values)
    augmented = [row[:] + [values[index]] for index, row in enumerate(matrix)]
    for column in range(size):
        pivot = max(range(column, size), key=lambda row: abs(augmented[row][column]))
        if abs(augmented[pivot][column]) < 1e-12:
            raise ValueError("Training data does not span every model feature.")
        augmented[column], augmented[pivot] = augmented[pivot], augmented[column]
        divisor = augmented[column][column]
        augmented[column] = [value / divisor for value in augmented[column]]
        for row in range(size):
            if row == column:
                continue
            factor = augmented[row][column]
            augmented[row] = [
                value - factor * pivot_value
                for value, pivot_value in zip(augmented[row], augmented[column])
            ]
    return [augmented[index][-1] for index in range(size)]


def fit_model(rows: list[tuple[str, list[float]]], weights: tuple[float, ...]) -> dict[str, float | list[float]]:
    feature_count = len(FEATURE_NAMES)
    matrix = [[0.0] * (feature_count + 1) for _ in range(feature_count + 1)]
    target = [0.0] * (feature_count + 1)
    for _, features in rows:
        vector = [1.0, *features]
        label = teacher_score(features, weights) / 100
        for row in range(feature_count + 1):
            target[row] += vector[row] * label
            for column in range(feature_count + 1):
                matrix[row][column] += vector[row] * vector[column]
    for index in range(1, feature_count + 1):
        matrix[index][index] += len(rows) * 1e-6
    coefficients = solve_linear_system(matrix, target)
    return {"bias": coefficients[0] * 100, "weights": [value * 100 for value in coefficients[1:]]}


def predict(features: list[float], model: dict[str, Any]) -> float:
    return bounded(float(model["bias"]) + sum(
        feature * weight for feature, weight in zip(features, model["weights"])
    ))


def mean_absolute_error(rows: list[tuple[str, list[float]]], model: dict[str, Any], teacher_weights: tuple[float, ...]) -> float:
    if not rows:
        return 0.0
    errors = [abs(predict(features, model) - teacher_score(features, teacher_weights)) for _, features in rows]
    return sum(errors) / len(errors)


def fetch_history() -> dict[str, Any]:
    params = urllib.parse.urlencode({
        "latitude": LATITUDE,
        "longitude": LONGITUDE,
        "start_date": START_DATE,
        "end_date": END_DATE,
        "hourly": ",".join(HOURLY_FIELDS),
        "timezone": TIMEZONE,
    })
    request = urllib.request.Request(
        f"https://archive-api.open-meteo.com/v1/archive?{params}",
        headers={"User-Agent": "Aurea-weather-score/1.0"},
    )
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            payload = json.loads(response.read())
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Could not download the Open-Meteo training history: {error}") from error
    if "hourly" not in payload or "time" not in payload["hourly"]:
        raise RuntimeError("Open-Meteo returned no hourly history for model training.")
    return payload


def train(history: dict[str, Any]) -> dict[str, Any]:
    hourly = history["hourly"]
    rows = weather_features(hourly)
    if len(rows) < 100:
        raise ValueError(f"Expected a meaningful weather history; received only {len(rows)} hourly rows.")

    train_rows = [row for row in rows if row[0][:4] < "2024"]
    test_rows = [row for row in rows if row[0][:4] >= "2024"]
    if not train_rows or not test_rows:
        raise ValueError("Training history must include data both before 2024 and from 2024 onward.")

    models = {}
    for mode, weights in MODE_WEIGHTS.items():
        model = fit_model(train_rows, weights)
        models[mode] = {
            **model,
            "rubricMae": round(mean_absolute_error(test_rows, model, weights), 3),
        }

    return {
        "version": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "labelSource": "weather suitability rubric; no user or photographer feedback",
        "trainedOn": {
            "location": [LATITUDE, LONGITUDE],
            "timezone": history.get("timezone", TIMEZONE),
            "start": rows[0][0][:10],
            "end": rows[-1][0][:10],
            "hours": len(rows),
            "trainingHours": len(train_rows),
            "testHours": len(test_rows),
        },
        "featureNames": list(FEATURE_NAMES),
        "models": models,
    }


def self_test() -> None:
    samples = [
        ("2023-01-01T00:00", feature_row(clouds, rain, wind, humidity))
        for clouds in (0, 20, 45, 65, 80, 100)
        for rain in (0, 0.1, 0.8, 2.5)
        for wind in (0, 5, 15, 30)
        for humidity in (20, 45, 70, 100)
    ]
    for mode, weights in MODE_WEIGHTS.items():
        model = fit_model(samples, weights)
        error = mean_absolute_error(samples, model, weights)
        if error > 0.01:
            raise AssertionError(f"{mode} training error was {error:.4f}, expected <= 0.01.")
    print(f"Trainer self-test passed ({len(samples)} weather combinations, {len(MODE_WEIGHTS)} modes).")


def main() -> None:
    if "--self-test" in sys.argv:
        self_test()
        return
    payload = train(fetch_history())
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Saved the weather model to {OUTPUT_PATH}")
    print(f"Trained on {payload['trainedOn']['hours']:,} hourly weather records.")
    for mode, model in payload["models"].items():
        print(f"  {mode}: held-out match to weather rubric {model['rubricMae']:.3f} points")


if __name__ == "__main__":
    main()
