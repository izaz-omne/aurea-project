import SunCalc from "suncalc";
import tzLookup from "tz-lookup";
import type { ForecastDay, ForecastPayload, HourForecast, Location, LocationSuggestion, SolarEvents } from "./types";

const FORECAST_CACHE_KEY = "aurea.forecast.v2";
const DEFAULT_LOCATION: Location = {
  id: "dhaka-dhaka-bangladesh",
  name: "Dhaka",
  region: "Dhaka Division",
  country: "Bangladesh",
  latitude: 23.8103,
  longitude: 90.4125,
  timezone: "Asia/Dhaka",
};

interface OpenMeteoResponse {
  timezone: string;
  hourly: Record<string, Array<string | number | null>> & { time: string[] };
  daily: Record<string, Array<string | number | null>> & { time: string[] };
}

interface AirQualityResponse {
  hourly?: { time: string[]; us_aqi?: Array<number | null> };
}

function localNoon(dateKey: string, timezone: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  const target = Date.UTC(year, month - 1, day, 12);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(target));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const represented = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute));
  return new Date(target + (target - represented));
}

function clock(value: Date | null, timezone: string): string | null {
  if (!value || Number.isNaN(value.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(value);
}

function azimuthBetween(start: Date, end: Date, latitude: number, longitude: number): number | null {
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const midpoint = new Date((start.getTime() + end.getTime()) / 2);
  const position = SunCalc.getPosition(midpoint, latitude, longitude);
  return (position.azimuth * 180 / Math.PI + 540) % 360;
}

function solarFor(dateKey: string, timezone: string, latitude: number, longitude: number): SolarEvents {
  const noon = localNoon(dateKey, timezone);
  const times = SunCalc.getTimes(noon, latitude, longitude);
  const moon = SunCalc.getMoonTimes(noon, latitude, longitude);
  const illumination = SunCalc.getMoonIllumination(noon);
  return {
    dawn: clock(times.dawn, timezone),
    nauticalDawn: clock(times.nauticalDawn, timezone),
    sunrise: clock(times.sunrise, timezone),
    goldenHourEnd: clock(times.goldenHourEnd, timezone),
    solarNoon: clock(times.solarNoon, timezone),
    goldenHour: clock(times.goldenHour, timezone),
    sunset: clock(times.sunset, timezone),
    dusk: clock(times.dusk, timezone),
    nauticalDusk: clock(times.nauticalDusk, timezone),
    night: clock(times.night, timezone),
    nightEnd: clock(times.nightEnd, timezone),
    moonrise: clock(moon.rise ?? null, timezone),
    moonset: clock(moon.set ?? null, timezone),
    moonIllumination: Math.round(illumination.fraction * 100),
    moonPhase: illumination.phase,
    goldenMorningAzimuth: azimuthBetween(times.sunrise, times.goldenHourEnd, latitude, longitude),
    goldenEveningAzimuth: azimuthBetween(times.goldenHour, times.sunset, latitude, longitude),
    blueMorningAzimuth: azimuthBetween(times.dawn, times.sunrise, latitude, longitude),
    blueEveningAzimuth: azimuthBetween(times.sunset, times.dusk, latitude, longitude),
  };
}

function numberAt(values: Array<string | number | null> | undefined, index: number): number | null {
  const value = values?.[index];
  return typeof value === "number" ? value : null;
}

function dateFromLocalTime(value: string, timezone: string): Date {
  const [date, timeText] = value.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hourText, minuteText = "00"] = timeText.split(":");
  const target = Date.UTC(year, month - 1, day, Number(hourText), Number(minuteText));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(target));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const represented = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute));
  return new Date(target + (target - represented));
}

function makeHour(
  data: OpenMeteoResponse["hourly"],
  index: number,
  airQuality: Map<string, number>,
  timezone: string,
  latitude: number,
  longitude: number,
): HourForecast {
  const time = data.time[index];
  const sun = SunCalc.getPosition(dateFromLocalTime(time, timezone), latitude, longitude);
  return {
    time,
    weatherCode: numberAt(data.weather_code, index),
    temperature: numberAt(data.temperature_2m, index),
    feelsLike: numberAt(data.apparent_temperature, index),
    humidity: numberAt(data.relative_humidity_2m, index),
    precipitationProbability: numberAt(data.precipitation_probability, index),
    precipitation: numberAt(data.precipitation, index),
    cloudCover: numberAt(data.cloud_cover, index),
    cloudLow: numberAt(data.cloud_cover_low, index),
    cloudMid: numberAt(data.cloud_cover_mid, index),
    cloudHigh: numberAt(data.cloud_cover_high, index),
    visibility: numberAt(data.visibility, index),
    wind: numberAt(data.wind_speed_10m, index),
    gusts: numberAt(data.wind_gusts_10m, index),
    uv: numberAt(data.uv_index, index),
    airQuality: airQuality.get(time) ?? null,
    sunAzimuth: (sun.azimuth * 180 / Math.PI + 540) % 360,
    sunElevation: sun.altitude * 180 / Math.PI,
  };
}

function fromOpenMeteo(location: Location, weather: OpenMeteoResponse, airQuality: AirQualityResponse): ForecastPayload {
  const timezone = weather.timezone || location.timezone || "UTC";
  const air = new Map<string, number>();
  airQuality.hourly?.time.forEach((time, index) => {
    const value = airQuality.hourly?.us_aqi?.[index];
    if (typeof value === "number") air.set(time, value);
  });
  const days: ForecastDay[] = weather.daily.time.map((date, dayIndex) => {
    const hours = weather.hourly.time
      .map((time, index) => ({ time, index }))
      .filter((item) => item.time.startsWith(date))
      .map((item) => makeHour(weather.hourly, item.index, air, timezone, location.latitude, location.longitude));
    const solar = solarFor(date, timezone, location.latitude, location.longitude);
    return {
      date,
      sunrise: typeof weather.daily.sunrise?.[dayIndex] === "string" ? String(weather.daily.sunrise[dayIndex]).slice(11, 16) : solar.sunrise,
      sunset: typeof weather.daily.sunset?.[dayIndex] === "string" ? String(weather.daily.sunset[dayIndex]).slice(11, 16) : solar.sunset,
      weatherCode: numberAt(weather.daily.weather_code, dayIndex),
      temperatureHigh: numberAt(weather.daily.temperature_2m_max, dayIndex),
      temperatureLow: numberAt(weather.daily.temperature_2m_min, dayIndex),
      uvMax: numberAt(weather.daily.uv_index_max, dayIndex),
      precipitationMax: numberAt(weather.daily.precipitation_probability_max, dayIndex),
      windMax: numberAt(weather.daily.wind_speed_10m_max, dayIndex),
      hours,
      solar,
    };
  });
  return { location, timezone, generatedAt: new Date().toISOString(), source: "live", days };
}

export function getDefaultLocation(): Location {
  return DEFAULT_LOCATION;
}

export async function searchLocations(query: string): Promise<LocationSuggestion[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.search = new URLSearchParams({ name: trimmed, count: "6", language: "en", format: "json" }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("Location search is taking a pause. Check your connection and try again.");
  const payload = await response.json() as { results?: Array<{ id: number; name: string; admin1?: string; country: string; latitude: number; longitude: number; timezone?: string }> };
  return (payload.results ?? []).map((place) => {
    const region = place.admin1 ?? place.country;
    return {
      id: String(place.id), name: place.name, region, country: place.country, timezone: place.timezone,
      latitude: place.latitude, longitude: place.longitude,
      displayName: [place.name, region, place.country].filter(Boolean).join(", "),
    };
  });
}

export async function getCurrentLocation(): Promise<Location> {
  if (typeof navigator === "undefined" || !navigator.geolocation) throw new Error("Location access is not available in this browser.");
  const position = await new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, timeout: 9000, maximumAge: 600000 });
  });
  const latitude = position.coords.latitude;
  const longitude = position.coords.longitude;
  const timezone = tzLookup(latitude, longitude);
  return {
    id: `coordinates-${latitude.toFixed(3)}-${longitude.toFixed(3)}`,
    name: "Current location", region: "Nearby", country: "", latitude, longitude, timezone,
  };
}

export function readCachedForecast(locationId?: string): ForecastPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(FORECAST_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as ForecastPayload;
    if (cached.source === "sample") return null;
    return locationId && cached.location.id !== locationId ? null : { ...cached, source: "cached" };
  } catch {
    return null;
  }
}

export function writeCachedForecast(forecast: ForecastPayload): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FORECAST_CACHE_KEY, JSON.stringify(forecast));
  } catch {
    // Storage can be unavailable in private browsing; the current forecast still works.
  }
}

export async function loadForecast(location: Location, offline = false): Promise<ForecastPayload> {
  if (offline) {
    const cached = readCachedForecast(location.id);
    if (!cached) throw new Error("No saved forecast for this place is available offline. Connect to the internet and refresh.");
    return cached;
  }
  const params = new URLSearchParams({
    latitude: String(location.latitude), longitude: String(location.longitude), timezone: "auto", forecast_days: "7",
    hourly: "weather_code,temperature_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,precipitation,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility,wind_speed_10m,wind_gusts_10m,uv_index",
    daily: "weather_code,sunrise,sunset,temperature_2m_max,temperature_2m_min,uv_index_max,precipitation_probability_max,wind_speed_10m_max",
  });
  const weatherUrl = `https://api.open-meteo.com/v1/forecast?${params}`;
  const airParams = new URLSearchParams({ latitude: String(location.latitude), longitude: String(location.longitude), timezone: "auto", forecast_days: "7", hourly: "us_aqi" });
  const [weatherResponse, airResponse] = await Promise.all([
    fetch(weatherUrl, { signal: AbortSignal.timeout(12000) }),
    fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?${airParams}`, { signal: AbortSignal.timeout(12000) }).catch(() => null),
  ]);
  if (!weatherResponse.ok) throw new Error(`Open-Meteo forecast request failed with status ${weatherResponse.status}.`);
  const weather = await weatherResponse.json() as OpenMeteoResponse;
  const air = airResponse?.ok ? await airResponse.json() as AirQualityResponse : {};
  const forecast = fromOpenMeteo(location, weather, air);
  writeCachedForecast(forecast);
  return forecast;
}
