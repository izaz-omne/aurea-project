export type Units = "metric" | "imperial";
export type ShootMode = "landscape" | "portrait" | "street" | "astro" | "drone" | "wildlife";
export type ForecastSource = "live" | "cached" | "sample";

export interface Location {
  id: string;
  name: string;
  region: string;
  country: string;
  latitude: number;
  longitude: number;
  timezone?: string;
}

export interface HourForecast {
  time: string;
  weatherCode: number | null;
  temperature: number | null;
  feelsLike: number | null;
  humidity: number | null;
  precipitationProbability: number | null;
  precipitation: number | null;
  cloudCover: number | null;
  cloudLow: number | null;
  cloudMid: number | null;
  cloudHigh: number | null;
  visibility: number | null;
  wind: number | null;
  gusts: number | null;
  uv: number | null;
  airQuality: number | null;
  sunAzimuth: number | null;
  sunElevation: number | null;
}

export interface SolarEvents {
  dawn: string | null;
  nauticalDawn: string | null;
  sunrise: string | null;
  goldenHourEnd: string | null;
  solarNoon: string | null;
  goldenHour: string | null;
  sunset: string | null;
  dusk: string | null;
  nauticalDusk: string | null;
  night: string | null;
  nightEnd: string | null;
  moonrise: string | null;
  moonset: string | null;
  moonIllumination: number;
  moonPhase: number;
  goldenMorningAzimuth: number | null;
  goldenEveningAzimuth: number | null;
  blueMorningAzimuth: number | null;
  blueEveningAzimuth: number | null;
}

export interface ForecastDay {
  date: string;
  sunrise: string | null;
  sunset: string | null;
  weatherCode: number | null;
  temperatureHigh: number | null;
  temperatureLow: number | null;
  uvMax: number | null;
  precipitationMax: number | null;
  windMax: number | null;
  hours: HourForecast[];
  solar: SolarEvents;
}

export interface ForecastPayload {
  location: Location;
  timezone: string;
  generatedAt: string;
  source: ForecastSource;
  days: ForecastDay[];
}

export interface LocationSuggestion extends Location {
  displayName: string;
}
