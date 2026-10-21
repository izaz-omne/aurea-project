import type { ForecastDay, ForecastPayload, HourForecast, ShootMode } from "./types";
import { predictWeatherScore, weatherModelVersion } from "../ml/weather-score";

export interface ShootWindow {
  label: string;
  start: string | null;
  end: string | null;
  score: number;
  reason: string;
}

export interface Recommendation {
  score: number;
  verdict: "GO" | "SKIP";
  summary: string;
  windows: ShootWindow[];
  bestHour: HourForecast | null;
}

const hourNumber = (value: string | null): number | null => value ? Number(value.slice(0, 2)) + Number(value.slice(3, 5)) / 60 : null;

function cachedRecommendation(forecast: ForecastPayload, day: ForecastDay, mode: ShootMode): Recommendation | null {
  if (typeof window === "undefined") return null;
  const key = `aurea.weather-score.${weatherModelVersion}.${forecast.location.id}.${day.date}.${mode}`;
  try {
    const value = window.localStorage.getItem(key);
    if (!value) return null;
    const cached = JSON.parse(value) as Recommendation;
    if (typeof cached.score === "number" && (cached.verdict === "GO" || cached.verdict === "SKIP") && Array.isArray(cached.windows)) return cached;
  } catch {
    return null;
  }
  return null;
}

function saveRecommendation(forecast: ForecastPayload, day: ForecastDay, mode: ShootMode, recommendation: Recommendation): void {
  if (typeof window === "undefined") return;
  const key = `aurea.weather-score.${weatherModelVersion}.${forecast.location.id}.${day.date}.${mode}`;
  try {
    window.localStorage.setItem(key, JSON.stringify(recommendation));
  } catch {
    // The score is still available for this page view when browser storage is unavailable.
  }
}

function windowFor(day: ForecastDay, mode: ShootMode, label: string, start: string | null, end: string | null): ShootWindow {
  const from = hourNumber(start);
  const to = hourNumber(end);
  const candidates = day.hours.filter((hour) => {
    const localHour = Number(hour.time.slice(11, 13));
    return from !== null && to !== null && localHour >= from && localHour <= to;
  });
  const best = candidates.reduce((max, hour) => Math.max(max, predictWeatherScore(hour, mode)), 0);
  const reasons: Record<ShootMode, string> = {
    landscape: "Open sky, clean horizons, and manageable wind.",
    portrait: "Soft cloud cover keeps faces evenly lit.",
    street: "A little cloud keeps contrast and colour in balance.",
    astro: "Clear sky and low ambient light favour the stars.",
    drone: "Lower gusts and open visibility make for steadier flight.",
    wildlife: "Quiet wind and a dry spell help you stay unobtrusive.",
  };
  return { label, start, end, score: best, reason: reasons[mode] };
}

export function recommendTomorrow(forecast: ForecastPayload, mode: ShootMode): Recommendation {
  const day = forecast.days[1] ?? forecast.days[0];
  const cached = cachedRecommendation(forecast, day, mode);
  if (cached) return cached;
  const morningStart = day.solar.sunrise;
  const morningEnd = day.solar.goldenHourEnd;
  const eveningStart = day.solar.goldenHour;
  const eveningEnd = day.solar.sunset;
  const windows = [
    windowFor(day, mode, "First light", morningStart, morningEnd),
    windowFor(day, mode, "Last light", eveningStart, eveningEnd),
  ].filter((window) => window.start && window.end);
  const bestWindow = windows.reduce<ShootWindow | null>((best, window) => !best || window.score > best.score ? window : best, null);
  const score = bestWindow?.score ?? 0;
  const bestHour = day.hours.reduce<HourForecast | null>((best, hour) => !best || predictWeatherScore(hour, mode) > predictWeatherScore(best, mode) ? hour : best, null);
  const verdict: Recommendation["verdict"] = score >= 58 ? "GO" : "SKIP";
  const summary = verdict === "GO"
    ? `${bestWindow?.label ?? "Tomorrow"} is your strongest light. ${bestWindow?.reason ?? "Conditions are worth watching."}`
    : `Tomorrow is a low-return day for ${mode}. Save the trip and watch the next clear window.`;
  const recommendation = { score, verdict, summary, windows, bestHour };
  saveRecommendation(forecast, day, mode, recommendation);
  return recommendation;
}

export function getSkyPotential(day: ForecastDay, evening: boolean): number {
  const hour = evening ? Number((day.solar.sunset ?? "18:00").slice(0, 2)) : Number((day.solar.sunrise ?? "06:00").slice(0, 2));
  const conditions = day.hours.find((item) => Number(item.time.slice(11, 13)) === hour);
  if (!conditions) return 0;
  const clouds = conditions.cloudCover ?? 50;
  const midCloud = conditions.cloudMid ?? clouds;
  const lowCloud = conditions.cloudLow ?? clouds;
  return Math.round(Math.max(0, Math.min(100, 100 - Math.abs(midCloud - 42) * 1.2 - lowCloud * 0.32 - (conditions.precipitationProbability ?? 0) * 0.4)));
}
