# Aurea ML API Contract

This document defines the backend contract for replacing Aurea's demo recommendation scorer with a trained model. It is intentionally provider-independent: the frontend continues to call `lib/api`, while the backend owns weather retrieval, solar calculations, feature construction, model inference, and caching.

## 1. Model Boundary

The model should predict **photographic opportunity**, not invent weather.

- Open-Meteo remains the source for forecast weather: temperature, cloud layers, precipitation, visibility, wind, gusts, UV, and air quality.
- SunCalc or an equivalent deterministic astronomy library remains the source for sunrise, golden hour, twilight, moonrise/moonset, and moon illumination.
- The ML model scores how useful a time window is for a specific shoot type, based on those forecast and astronomy inputs.
- A policy layer converts calibrated model output to `GO`, `SKIP`, or `MARGINAL`; the threshold is configuration, not an unexplained model constant.
- Natural-language advice must be derived from returned factors and templates. Do not ask an LLM to make the underlying verdict.

This keeps facts auditable and lets Aurea change weather providers without retraining the UI contract.

## 2. Service Shape

Recommended production shape:

```text
Browser
  -> Next.js frontend / lib/api
      -> Aurea Forecast API (BFF)
          -> Weather provider adapter (Open-Meteo initially)
          -> Astronomy calculator (SunCalc)
          -> Feature builder + unit normalization
          -> Model inference service
          -> Verdict policy + explanation templates
          -> Forecast cache
```

Do not call a private model endpoint directly from the browser. Keep provider credentials, model routing, rate limits, and cache policy on the server. Open-Meteo currently needs no API key, but the boundary should not rely on that remaining true.

Start with one deployable Forecast API and a separately versioned model artifact. Split inference into its own service only when scaling, deployment cadence, or language/runtime needs justify it.

## 3. HTTP Conventions

- Base path: `/v1`
- JSON: `Content-Type: application/json; charset=utf-8`
- Timezone: IANA name derived by the server from coordinates, e.g. `Asia/Dhaka`; never use the photographer's device timezone for solar events.
- Dates: ISO local calendar date `YYYY-MM-DD` in the selected location's timezone.
- Instants: ISO 8601 timestamps with an explicit offset, e.g. `2026-10-22T05:59:00+06:00`.
- Units: the API returns canonical metric values; the frontend formats metric/imperial for display.
- Null means unavailable. Zero means a measured/predicted zero. Never replace missing input with a fabricated zero.
- Every response includes a request ID. Errors use the common shape below.

## 4. Endpoints

### `GET /v1/healthz`

Liveness only. It must not call weather providers or load a large model artifact.

```json
{"status":"ok"}
```

### `GET /v1/readyz`

Readiness for traffic: API configuration is valid, model artifact is loaded, and required dependencies are reachable or in a supported degraded state.

```json
{
  "status": "ready",
  "model": {"name": "light-opportunity", "version": "2026-10-01"},
  "weatherProvider": "open-meteo"
}
```

### `GET /v1/locations/search?q=Dhaka&limit=6`

Proxies/normalizes the geocoder. Do not expose the browser to provider-specific response shapes.

```json
{
  "results": [
    {
      "id": "dhaka-dhaka-bangladesh",
      "name": "Dhaka",
      "region": "Dhaka Division",
      "country": "Bangladesh",
      "latitude": 23.8103,
      "longitude": 90.4125,
      "timezone": "Asia/Dhaka",
      "displayName": "Dhaka, Dhaka Division, Bangladesh"
    }
  ]
}
```

Validation: trim `q`, require 2–100 characters, cap `limit` at 10, and return an empty result list rather than an error when the query has no matches.

### `GET /v1/forecast`

The main screen endpoint. Fetch weather and astronomy, score the requested shoot mode, and return a complete forecast view in one request.

Query parameters:

| Parameter | Required | Meaning |
| --- | --- | --- |
| `latitude` | yes | Decimal degrees, -90 to 90 |
| `longitude` | yes | Decimal degrees, -180 to 180 |
| `startDate` | no | Location-local ISO date; defaults to today at that location |
| `days` | no | 1–7, default 7 |
| `shootType` | no | `landscape`, `portrait`, `street`, `astro`, `drone`, or `wildlife`; default `landscape` |
| `units` | no | `metric` or `imperial`; default `metric` for presentation metadata only |

Example:

```http
GET /v1/forecast?latitude=23.8103&longitude=90.4125&startDate=2026-10-21&days=7&shootType=landscape
```

The server derives the timezone from the coordinates. If the caller supplies a location ID, it may be echoed as metadata but coordinates remain the source of truth.

Response shape (abbreviated values shown):

```json
{
  "requestId": "req_01J...",
  "generatedAt": "2026-10-20T22:15:00+06:00",
  "dataUpdatedAt": "2026-10-20T22:05:00+06:00",
  "timezone": "Asia/Dhaka",
  "source": "live",
  "model": {
    "name": "light-opportunity",
    "version": "2026-10-01",
    "calibrationVersion": "cal-3",
    "status": "active"
  },
  "location": {
    "id": "dhaka-dhaka-bangladesh",
    "name": "Dhaka",
    "region": "Dhaka Division",
    "country": "Bangladesh",
    "latitude": 23.8103,
    "longitude": 90.4125,
    "timezone": "Asia/Dhaka"
  },
  "days": [
    {
      "date": "2026-10-21",
      "sunrise": "05:59",
      "sunset": "17:29",
      "temperatureHigh": 31.2,
      "temperatureLow": 24.1,
      "uvMax": 8.1,
      "precipitationMax": 10,
      "windMax": 13.0,
      "solar": {
        "dawn": "05:36",
        "nauticalDawn": "05:11",
        "sunrise": "05:59",
        "goldenHourEnd": "06:29",
        "solarNoon": "11:44",
        "goldenHour": "16:58",
        "sunset": "17:29",
        "dusk": "17:52",
        "nauticalDusk": "18:17",
        "night": "18:41",
        "nightEnd": "04:50",
        "moonrise": "12:10",
        "moonset": "23:28",
        "moonIllumination": 37,
        "moonPhase": 0.31
      },
      "recommendation": {
        "shootType": "landscape",
        "score": 74,
        "verdict": "GO",
        "confidence": 0.82,
        "summary": "Last light is the stronger window; mid-level cloud may catch colour while gusts stay manageable.",
        "windows": [
          {
            "id": "golden-morning",
            "label": "First light",
            "start": "2026-10-21T05:59:00+06:00",
            "end": "2026-10-21T06:29:00+06:00",
            "score": 68,
            "confidence": 0.77,
            "reasons": ["broken mid cloud", "low rain risk"]
          },
          {
            "id": "golden-evening",
            "label": "Last light",
            "start": "2026-10-21T16:58:00+06:00",
            "end": "2026-10-21T17:29:00+06:00",
            "score": 74,
            "confidence": 0.82,
            "reasons": ["useful mid cloud", "manageable gusts"]
          }
        ],
        "hourlyScores": [
          {"time": "2026-10-21T05:00:00+06:00", "score": 52, "confidence": 0.7},
          {"time": "2026-10-21T06:00:00+06:00", "score": 68, "confidence": 0.77}
        ],
        "factors": [
          {"key": "cloud_mid", "label": "Mid cloud", "value": 42, "unit": "%", "effect": "helpful", "contribution": 0.18},
          {"key": "gusts", "label": "Wind gusts", "value": 17, "unit": "km/h", "effect": "caution", "contribution": -0.06},
          {"key": "precipitation_probability", "label": "Rain chance", "value": 10, "unit": "%", "effect": "helpful", "contribution": 0.04}
        ]
      },
      "hours": [
        {
          "time": "2026-10-21T06:00:00+06:00",
          "temperature": 25.4,
          "feelsLike": 26.2,
          "humidity": 84,
          "precipitationProbability": 4,
          "precipitation": 0.0,
          "cloudCover": 43,
          "cloudLow": 7,
          "cloudMid": 32,
          "cloudHigh": 18,
          "visibility": 14500,
          "wind": 7.0,
          "gusts": 12.0,
          "uv": 0.2,
          "airQuality": 38,
          "photoScore": 68,
          "photoConfidence": 0.77
        }
      ]
    }
  ]
}
```

Use the existing Aurea frontend concepts: `ForecastPayload`, `ForecastDay`, `HourForecast`, `SolarEvents`, `ShootMode`, and `Recommendation` in `lib/api/types.ts` and `lib/api/recommendation.ts`. Add fields rather than renaming existing ones during the first integration. Keep timestamps timezone-aware at the API boundary; the current UI can format them to its local display format in the adapter.

### `POST /v1/recommendations` (optional split endpoint)

Use this if forecast retrieval and inference need different scaling or deployment cadences. The BFF calls it; browsers should not.

```json
{
  "location": {"latitude": 23.8103, "longitude": 90.4125, "timezone": "Asia/Dhaka"},
  "shootType": "astro",
  "targetDate": "2026-10-21",
  "solar": {"sunset": "17:29", "night": "18:41", "moonIllumination": 37},
  "hours": [
    {
      "time": "2026-10-21T20:00:00+06:00",
      "cloudCover": 12,
      "cloudLow": 0,
      "cloudMid": 8,
      "cloudHigh": 19,
      "precipitationProbability": 0,
      "visibility": 18000,
      "wind": 4,
      "gusts": 7,
      "humidity": 63,
      "temperature": 25,
      "airQuality": 42
    }
  ]
}
```

Return one score per hour plus window aggregates and a model metadata block. Keep this endpoint stateless: identical normalized input and model version should produce the same output.

### `POST /v1/feedback`

Capture explicit human outcome labels to build the training set. Keep feedback optional and do not block forecast use.

```json
{
  "requestId": "req_01J...",
  "locationId": "dhaka-dhaka-bangladesh",
  "targetDate": "2026-10-21",
  "shootType": "landscape",
  "windowId": "golden-evening",
  "rating": "worth_it",
  "actualConditions": {
    "cloudTexture": "broken",
    "rainOccurred": false,
    "windUsable": true,
    "colourQuality": 4
  }
}
```

Allowed rating values: `worth_it`, `not_worth_it`, `did_not_go`, `not_sure`. Return `202 Accepted` with a feedback ID. Do not treat `did_not_go` as a negative weather label; it is missing outcome data.

## 5. Common Error Shape

```json
{
  "error": {
    "code": "FORECAST_PROVIDER_UNAVAILABLE",
    "message": "A fresh forecast is unavailable. Showing the last saved report.",
    "retryable": true,
    "requestId": "req_01J..."
  }
}
```

Suggested codes:

| Status | Code | Client behavior |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` | Show validation message; do not retry automatically |
| 404 | `LOCATION_NOT_FOUND` | Offer location search |
| 422 | `UNSUPPORTED_SHOOT_TYPE` | Fall back to a supported mode |
| 429 | `RATE_LIMITED` | Respect `Retry-After`; continue with cache |
| 502/503 | `FORECAST_PROVIDER_UNAVAILABLE` | Use cached report, then labeled sample fallback |
| 503 | `MODEL_UNAVAILABLE` | Use the deterministic baseline scorer; label the active scorer |
| 504 | `INFERENCE_TIMEOUT` | Use cached/baseline result; do not leave the page loading |

## 6. Training Target

Do not train against the current demo's `score >= 58` rule as if it were ground truth; that only teaches the model to imitate the existing heuristic.

Recommended first target:

- Primary: per-hour/per-window ordinal `photographic_value` from an explicit photographer rating (1–5 or `worth_it` / `not_worth_it`).
- Secondary tasks: probability of usable golden-hour color, precipitation during the window, safe drone wind, and usable astro darkness. These are separately measurable outcomes and make mode-specific behavior easier to debug.
- Derive the overall verdict from calibrated mode-specific opportunity probabilities and product policy. Keep the threshold configurable and validate it with photographers.
- Keep deterministic astronomical calculations outside the model. Train the model on location-local solar phase/time-to-event features rather than asking it to rediscover sunrise.

A useful training row is one location × local date × shoot mode × candidate window, with the forecast snapshot **as known at recommendation time** and a later outcome label. Store provider issue time and forecast lead time so backtests use the same information the live model would have had.

### Feature groups

- Cloud: total/low/mid/high cover, changes over the window, and cloud-layer spread.
- Precipitation: probability, amount, timing, and forecast uncertainty.
- Visibility: visibility, fog/haze indicators, and AQI; keep AQI's role mode-specific.
- Wind: sustained wind, gusts, direction if available, and changes over the window.
- Temperature/humidity: comfort and condensation/dew risk where relevant.
- Solar: local solar elevation, phase, minutes to sunrise/sunset, golden/blue/twilight interval, and daylight duration.
- Night: moon illumination, phase, moonrise/set relative to the shoot window, and astronomical darkness.
- Context: latitude/longitude or a privacy-safe spatial encoding, elevation/terrain if licensed, local season/monsoon indicators, shoot type, forecast lead time, provider/model version.

Use only data available at prediction time. Never train on observed weather while evaluating a forecast input. Do not include the final user rating, future observations, or post-shot metadata among features.

## 7. Label Collection and Data Quality

- Show a lightweight follow-up after the target window: “Was it worth the trip?” with `Yes`, `No`, `Didn't go`, and `Not sure`.
- Ask optionally for a 1–5 light rating and separate facts (rain occurred, cloud texture, wind usable); keep subjective color quality distinct from measured weather.
- Record the forecast payload hash, provider issue time, model version, location/timezone, selected mode, recommended window, and response time with each label.
- Deduplicate by user/report/window and cap repeat submissions.
- Exclude `did_not_go` from positive/negative training labels. Treat missing feedback as unlabeled, not a negative.
- Track sample balance by shoot mode, climate/region, season, lead time, and outcome. Do not allow Dhaka to dominate or disappear in a global model.
- Obtain consent, define retention/deletion, and avoid collecting precise user location beyond what is required for the forecast.

## 8. Baseline, Model, and Rollout

1. Keep the current rule scorer as `baseline-v1`; save its score beside every model result during shadow mode.
2. Establish a simple interpretable baseline per shoot type before trying complex architectures: calibrated logistic/ordinal regression or gradient-boosted trees work well for tabular forecast features.
3. Split evaluation by time and geography. Use forward-chaining time splits and hold out locations/regions; random row splits leak adjacent hours and repeated locations.
4. Evaluate calibration and ranking, not only accuracy: Brier score/log loss for probabilities, PR-AUC for rare high-value windows, calibration error, top-window hit rate, and false-GO rate. Report each metric by mode, region, season, and lead time.
5. Shadow the model against the baseline without changing user-visible results. Review disagreement examples with photographers.
6. Canary a small share of traffic. Roll back by config if provider drift, latency, calibration, error rate, or false-GO rate regresses.
7. Promote immutable, versioned artifacts. Log model, feature-schema, calibration, and policy versions with each response.

Avoid optimizing solely for overall accuracy: a false `GO` can waste travel and time; a false `SKIP` hides a rare light opportunity. Set different decision costs per shoot mode with users.

## 9. Explanations and Confidence

- `factors` should identify the strongest inputs and mark effects as `helpful`, `neutral`, or `caution` for that specific mode.
- Contributions are model diagnostics, not causal proof. Use language such as “Mid-level cloud may catch color” rather than “Cloud caused a great sunset.”
- Return calibrated confidence/uncertainty and abstain when inputs are missing, stale, outside training coverage, or outside the model's supported geography.
- On abstention, use the deterministic baseline or show “Not enough signal yet”; never return a high-confidence numeric verdict from mostly-null inputs.
- Keep user-facing summary templates in the API/UI layer so copy can be corrected without retraining.

## 10. Caching and Staleness

- Cache raw provider forecasts by rounded coordinates, provider, timezone, and forecast issue time.
- Cache recommendation results by forecast hash, target date, shoot mode, feature-schema version, and model version.
- Return `dataUpdatedAt`, `generatedAt`, `source` (`live`, `cached`, `sample`), and model status with the response.
- Use stale-while-revalidate for the page: render the last usable report immediately, refresh in the background, and keep the previous result visible on refresh failure.
- Never cache one location's result under another location key. Include mode and model version in the recommendation cache key.

## 11. Runtime and Performance Targets

Initial targets (adjust after measuring real traffic):

- Forecast endpoint p95 under 1.5s with warm provider/cache; inference alone p95 under 100ms.
- Model inference timeout 300–500ms; forecast-provider timeout governed separately.
- One request should score all 24 hourly rows for the selected date; batch inference rather than making one HTTP request per hour.
- Bound retries, use provider timeouts, and make retries idempotent.
- Emit structured logs with `requestId`, provider status, feature schema, model version, cache status, and latency. Do not log raw precise coordinates or user feedback text by default.
- Add request rate limits and an allowlisted CORS policy if browser access is unavoidable. Prefer same-origin Next.js/BFF requests.

## 12. Frontend Integration Plan

1. Preserve the UI's existing types in `lib/api/types.ts`; add optional recommendation/model metadata fields so the demo remains usable during migration.
2. Add `recommendation` to each `ForecastDay`, with `score`, `verdict`, `confidence`, `summary`, `windows`, `hourlyScores`, and `factors`.
3. Change `loadForecast()` in `lib/api/index.ts` to call the Aurea Forecast API base URL. Do not put provider or model URLs in components.
4. Keep current `recommendTomorrow()` as the `baseline-v1` fallback. Mark its source/model status as `baseline`, not `live model`.
5. Map UTC/provider timestamps to the server-returned IANA timezone in one adapter. Keep UI display formatting in components.
6. Preserve `sample`/`cached` source labels and offline behavior if the backend is unreachable.
7. Add contract tests for a normal Dhaka response, null/missing features, stale forecast, unknown mode, provider failure, model timeout, and timezone/DST boundaries.

Suggested environment variables:

```dotenv
AUREA_API_BASE_URL=http://localhost:8000
AUREA_MODEL_NAME=light-opportunity
AUREA_MODEL_TIMEOUT_MS=400
AUREA_FORECAST_CACHE_TTL_SECONDS=900
```

Only expose a public API base URL to browser code when it is intentionally public. Provider secrets and model credentials must stay server-side.

## 13. Implementation Checklist

- [ ] Finalize target labels with photographers for all six shoot modes.
- [ ] Freeze a versioned feature schema and units.
- [ ] Build a deterministic baseline and save it for comparison.
- [ ] Create `/v1/forecast`, `/v1/locations/search`, `/v1/healthz`, `/v1/readyz`, and optionally `/v1/feedback`.
- [ ] Add schema validation, timeouts, cache keys, request IDs, and common error responses.
- [ ] Train with time/geography-separated evaluation and mode/region calibration reports.
- [ ] Shadow-score against the current baseline before displaying model results.
- [ ] Add the Aurea API adapter and contract tests under `lib/api`.
- [ ] Canary the model and document rollback/model-version controls.
- [ ] Confirm stale, offline, location-denied, provider-error, and model-error states remain understandable.
