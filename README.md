# Aurea

Aurea turns tomorrow's forecast into a photographer's go/skip call and the best light windows. Built with Next.js, TypeScript, React, and SunCalc.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000 for the landing page or http://localhost:3000/forecast for the live forecast workspace. Weather and weather codes come from Open-Meteo without an API key; SunCalc supplies local sunrise, golden/blue hour, moon events, and solar direction/elevation. The app caches successful forecasts for offline use and reports an error rather than presenting generated sample weather when no live or cached data is available.

## Structure

- `app/`: Next.js entry point, metadata, and global visual system.
- `components/landing-page.tsx`: Dhaka-focused landing page and working forecast preview.
- `components/forecast-dashboard.tsx`: responsive forecast workspace and interactions.
- `lib/api/`: typed provider boundary, Open-Meteo requests, geocoding, local cache, and SunCalc astronomy.
- `lib/api/types.ts`: shared location and forecast shapes.
- `lib/api/recommendation.ts`: weather-model predictions and best-window selection.
- `lib/ml/weather-score.ts` and `lib/ml/weather-model.json`: lightweight per-shoot-mode model inference and its trained coefficients.
- `train.py`: standard-library-only trainer. It downloads Open-Meteo historical weather, fits regression models against Aurea's weather-suitability rubric, and exports the model JSON used by the app.

To switch weather providers, implement the provider-facing functions in `lib/api/index.ts` while preserving the types in `lib/api/types.ts`. Keep location search, caching, and provider error handling behind that boundary.

The forecast score is cached in the browser once per target date, location, model version, and shoot type. Training labels are weather-based rules, not user feedback or measured photography outcomes.
