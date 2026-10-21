import SunCalc from "suncalc";
import tzLookup from "tz-lookup";
import type { ForecastDay, ForecastPayload, HourForecast, Location, SolarEvents } from "./types";

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
    goldenMorningAzimuth: null,
    goldenEveningAzimuth: null,
    blueMorningAzimuth: null,
    blueEveningAzimuth: null,
  };
}

function dateKeyFromNow(offset: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day) + offset, 12)).toISOString().slice(0, 10);
}

function createHour(hour: number, dayIndex: number, date: string): HourForecast {
  const daylight = Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI));
  const front = dayIndex === 1;
  const cloud = Math.min(100, Math.max(7, Math.round(26 + 20 * Math.sin((hour + dayIndex * 3) / 3) + dayIndex * 4)));
  return {
    time: `${date}T${String(hour).padStart(2, "0")}:00`,
    weatherCode: null,
    temperature: Math.round(13 + daylight * 9 - dayIndex * 0.4),
    feelsLike: Math.round(12 + daylight * 8 - dayIndex * 0.4),
    humidity: Math.round(78 - daylight * 24),
    precipitationProbability: front && hour >= 15 && hour <= 17 ? 28 : hour >= 0 && hour < 6 ? 8 : 3,
    precipitation: front && hour === 16 ? 0.2 : 0,
    cloudCover: cloud,
    cloudLow: Math.max(0, cloud - 18),
    cloudMid: Math.min(100, cloud + 14),
    cloudHigh: Math.min(100, cloud + 28),
    visibility: Math.round(16000 - cloud * 42),
    wind: Math.round(7 + (hour > 12 ? 5 : 0) + dayIndex),
    gusts: Math.round(12 + (hour > 12 ? 6 : 0) + dayIndex),
    uv: Math.round(daylight * 5),
    airQuality: Math.round(32 + (dayIndex % 3) * 8),
    sunAzimuth: null,
    sunElevation: null,
  };
}

export function createSampleForecast(location: Location, timezone = location.timezone ?? tzLookup(location.latitude, location.longitude)): ForecastPayload {
  const days: ForecastDay[] = Array.from({ length: 7 }, (_, index) => {
    const date = dateKeyFromNow(index, timezone);
    const solar = solarFor(date, timezone, location.latitude, location.longitude);
    const hours = Array.from({ length: 24 }, (_, hour) => createHour(hour, index, date));
    return {
      date,
      sunrise: solar.sunrise,
      sunset: solar.sunset,
      weatherCode: null,
      temperatureHigh: 22 - index,
      temperatureLow: 12 - Math.floor(index / 2),
      uvMax: Math.max(2, 6 - Math.floor(index / 2)),
      precipitationMax: index === 1 ? 28 : 10,
      windMax: 16 + index,
      hours,
      solar,
    };
  });
  return { location, timezone, generatedAt: new Date().toISOString(), source: "sample", days };
}
