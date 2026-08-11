import type { InvokeContext, JSONSchema, Tool, ToolResult } from '../../core/types/index.js';
import { WeatherService, WeatherServiceError } from '../../services/weather.js';

const weatherService = new WeatherService();

abstract class WeatherToolBase implements Tool {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly parameters: JSONSchema;
  readonly category = 'weather';
  readonly risk: 'low' | 'medium' | 'high' = 'low';
  readonly builtin = true;

  protected formatError(error: unknown, startedAt: number): ToolResult {
    if (error instanceof WeatherServiceError) {
      return {
        success: false,
        status: 'error',
        error: error.message,
        errorCode: error.code,
        metadata: {
          durationMs: Date.now() - startedAt,
          sideEffects: [],
        },
      };
    }

    return {
      success: false,
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown weather error',
      errorCode: 'WEATHER_TOOL_ERROR',
      metadata: {
        durationMs: Date.now() - startedAt,
        sideEffects: [],
      },
    };
  }

  abstract execute(params: Record<string, unknown>, context: InvokeContext): Promise<ToolResult>;
}

export class WeatherLookupTool extends WeatherToolBase {
  readonly name = 'weather/lookup';
  readonly description = 'Search supported weather locations by city keyword before querying weather.';
  readonly parameters: JSONSchema = {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'City or region keyword, for example 北京 or Shanghai.' },
      count: { type: 'number', description: 'Maximum number of results to return, from 1 to 10.', default: 5 },
    },
    required: ['query'],
  };

  async execute(params: Record<string, unknown>, _context: InvokeContext): Promise<ToolResult> {
    const startedAt = Date.now();
    try {
      const query = typeof params.query === 'string' ? params.query : '';
      const count = typeof params.count === 'number' ? params.count : 5;
      const locations = await weatherService.lookupCity(query, count);

      return {
        success: true,
        status: 'success',
        data: {
          total: locations.length,
          locations,
        },
        metadata: {
          durationMs: Date.now() - startedAt,
          sideEffects: [],
        },
      };
    } catch (error) {
      return this.formatError(error, startedAt);
    }
  }
}

export class WeatherCurrentTool extends WeatherToolBase {
  readonly name = 'weather/current';
  readonly description = 'Get the current weather for a city, including temperature, wind, day/night, and observation time.';
  readonly parameters: JSONSchema = {
    type: 'object',
    properties: {
      city: { type: 'string', description: 'City name to query, for example 北京.' },
    },
    required: ['city'],
  };

  async execute(params: Record<string, unknown>, _context: InvokeContext): Promise<ToolResult> {
    const startedAt = Date.now();
    try {
      const city = typeof params.city === 'string' ? params.city : '';
      const weather = await weatherService.getCurrentWeather(city);

      return {
        success: true,
        status: 'success',
        data: weather,
        metadata: {
          durationMs: Date.now() - startedAt,
          sideEffects: [],
        },
      };
    } catch (error) {
      return this.formatError(error, startedAt);
    }
  }
}

export class WeatherForecastTool extends WeatherToolBase {
  readonly name = 'weather/forecast';
  readonly description = 'Get the weather forecast for the next few days for a city.';
  readonly parameters: JSONSchema = {
    type: 'object',
    properties: {
      city: { type: 'string', description: 'City name to query, for example 杭州.' },
      days: { type: 'number', description: 'Forecast days from 1 to 7.', default: 3 },
    },
    required: ['city'],
  };

  async execute(params: Record<string, unknown>, _context: InvokeContext): Promise<ToolResult> {
    const startedAt = Date.now();
    try {
      const city = typeof params.city === 'string' ? params.city : '';
      const days = typeof params.days === 'number' ? params.days : 3;
      const forecast = await weatherService.getForecast(city, days);

      return {
        success: true,
        status: 'success',
        data: forecast,
        metadata: {
          durationMs: Date.now() - startedAt,
          sideEffects: [],
        },
      };
    } catch (error) {
      return this.formatError(error, startedAt);
    }
  }
}
