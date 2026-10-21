import model from "./weather-model.json";
import type { HourForecast, ShootMode } from "../api/types";

interface RegressionModel {
  bias: number;
  weights: number[];
}

const models = model.models as Record<ShootMode, RegressionModel>;

function bounded(value: number, minimum = 0, maximum = 100): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function predictWeatherScore(hour: HourForecast, mode: ShootMode): number {
  const clouds = bounded(hour.cloudCover ?? 55);
  const rainAmount = Math.max(hour.precipitation ?? 0, (hour.precipitationProbability ?? 0) * 0.025);
  const wind = Math.max(0, hour.gusts ?? hour.wind ?? 12);
  const humidity = bounded(hour.humidity ?? 60);
  const features = [
    bounded(100 - clouds) / 100,
    bounded(100 - Math.abs(clouds - 65) * 1.7) / 100,
    bounded(100 - rainAmount * 40) / 100,
    bounded(100 - wind * 3.2) / 100,
    bounded(100 - humidity * 0.25) / 100,
  ];
  const selectedModel = models[mode];
  const rawScore = selectedModel.bias + features.reduce(
    (sum, feature, index) => sum + feature * selectedModel.weights[index],
    0,
  );
  return Math.round(bounded(rawScore));
}

export const weatherModelVersion = model.version;
