export interface WeatherLocation {
  name: string;
  country?: string;
  admin1?: string;
  latitude: number;
  longitude: number;
  timezone?: string;
}

export interface WeatherCurrentResult {
  city: string;
  location: WeatherLocation;
  timezone: string;
  current: {
    temperatureC: number | null;
    windSpeedKph: number | null;
    windDirection: number | null;
    weatherCode: number | null;
    isDay: boolean | null;
    observedAt: string | null;
  };
}

export interface WeatherForecastDay {
  date: string;
  weatherCode: number | null;
  tempMaxC: number | null;
  tempMinC: number | null;
  precipitationProbabilityMax: number | null;
  sunrise: string | null;
  sunset: string | null;
}

export interface WeatherForecastResult {
  city: string;
  location: WeatherLocation;
  timezone: string;
  days: WeatherForecastDay[];
}

export class WeatherServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode = 500,
  ) {
    super(message);
    this.name = 'WeatherServiceError';
  }
}

interface OpenMeteoGeocodeResponse {
  results?: Array<{
    name: string;
    country?: string;
    admin1?: string;
    latitude: number;
    longitude: number;
    timezone?: string;
  }>;
}

interface OpenMeteoCurrentResponse {
  timezone: string;
  current?: {
    time?: string;
    temperature_2m?: number;
    wind_speed_10m?: number;
    wind_direction_10m?: number;
    weather_code?: number;
    is_day?: number;
  };
}

interface OpenMeteoForecastResponse {
  timezone: string;
  daily?: {
    time?: string[];
    weather_code?: Array<number | null>;
    temperature_2m_max?: Array<number | null>;
    temperature_2m_min?: Array<number | null>;
    precipitation_probability_max?: Array<number | null>;
    sunrise?: Array<string | null>;
    sunset?: Array<string | null>;
  };
}

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'myopenclaw-weather/1.0',
    },
  });

  if (!response.ok) {
    throw new WeatherServiceError(
      `Weather upstream request failed with status ${response.status}`,
      'WEATHER_UPSTREAM_ERROR',
      502,
    );
  }

  return response.json() as Promise<T>;
}

function buildLocationLabel(location: WeatherLocation): string {
  return [location.name, location.admin1, location.country].filter(Boolean).join(', ');
}

export class WeatherService {
  async lookupCity(query: string, count = 5): Promise<WeatherLocation[]> {
    const normalized = query.trim();
    if (!normalized) {
      throw new WeatherServiceError('City query is required', 'WEATHER_QUERY_REQUIRED', 400);
    }

    // ── 先尝试原始查询 ──
    const baseUrl = `${GEOCODE_URL}?count=${Math.max(1, Math.min(count, 10))}&language=zh&format=json`;
    const tryQuery = async (q: string): Promise<WeatherLocation[] | null> => {
      const url = `${baseUrl}&name=${encodeURIComponent(q)}`;
      const data = await fetchJson<OpenMeteoGeocodeResponse>(url);
      const results = data.results ?? [];
      if (!results.length) return null;
      return results.map((item) => ({
        name: item.name,
        country: item.country,
        admin1: item.admin1,
        latitude: item.latitude,
        longitude: item.longitude,
        timezone: item.timezone,
      }));
    };

    // 1. 先试原始查询
    let locations = await tryQuery(normalized);
    if (locations) return locations;

    // 2. 渐进降级：对中国区级地名（如 "西安市阎良区"），Open-Meteo 可能只认识简称
    const fallbacks: string[] = [];
    // 去掉 "XX省/XX市" 前缀 → "阎良区"
    const short = normalized.replace(/^.+?[省市]/, '');
    if (short && short !== normalized) fallbacks.push(short);
    // 再去掉 "区/县/镇/乡" 后缀 → "阎良"
    const shorter = short.replace(/[区县镇乡]$/, '');
    if (shorter && shorter !== short) fallbacks.push(shorter);
    // 只保留地级市 → "西安市"
    const city = normalized.match(/^(.+?[市])/)?.[1];
    if (city && city !== normalized && !fallbacks.includes(city)) fallbacks.push(city);

    for (const q of fallbacks) {
      locations = await tryQuery(q);
      if (locations) return locations;
    }

    throw new WeatherServiceError(`No weather location found for "${normalized}"`, 'WEATHER_CITY_NOT_FOUND', 404);
  }

  async getCurrentWeather(city: string): Promise<WeatherCurrentResult> {
    const [location] = await this.lookupCity(city, 1);
    const url = `${FORECAST_URL}?latitude=${location.latitude}&longitude=${location.longitude}&current=temperature_2m,wind_speed_10m,wind_direction_10m,weather_code,is_day&timezone=auto`;
    const data = await fetchJson<OpenMeteoCurrentResponse>(url);

    return {
      city: buildLocationLabel(location),
      location,
      timezone: data.timezone,
      current: {
        temperatureC: data.current?.temperature_2m ?? null,
        windSpeedKph: data.current?.wind_speed_10m ?? null,
        windDirection: data.current?.wind_direction_10m ?? null,
        weatherCode: data.current?.weather_code ?? null,
        isDay: typeof data.current?.is_day === 'number' ? data.current.is_day === 1 : null,
        observedAt: data.current?.time ?? null,
      },
    };
  }

  async getForecast(city: string, days = 3): Promise<WeatherForecastResult> {
    const [location] = await this.lookupCity(city, 1);
    const forecastDays = Math.max(1, Math.min(days, 7));
    const url = `${FORECAST_URL}?latitude=${location.latitude}&longitude=${location.longitude}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset&forecast_days=${forecastDays}&timezone=auto`;
    const data = await fetchJson<OpenMeteoForecastResponse>(url);
    const daily = data.daily;
    const dates = daily?.time ?? [];

    return {
      city: buildLocationLabel(location),
      location,
      timezone: data.timezone,
      days: dates.map((date, index) => ({
        date,
        weatherCode: daily?.weather_code?.[index] ?? null,
        tempMaxC: daily?.temperature_2m_max?.[index] ?? null,
        tempMinC: daily?.temperature_2m_min?.[index] ?? null,
        precipitationProbabilityMax: daily?.precipitation_probability_max?.[index] ?? null,
        sunrise: daily?.sunrise?.[index] ?? null,
        sunset: daily?.sunset?.[index] ?? null,
      })),
    };
  }
}
