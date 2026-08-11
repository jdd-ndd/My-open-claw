import type { InvokeContext, JSONSchema, Tool, ToolResult } from '../../core/types/index.js';
import { UtilityApiError, UtilityApiService } from '../../services/utility-api.js';

const utilityService = new UtilityApiService();

abstract class UtilityToolBase implements Tool {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly parameters: JSONSchema;
  readonly category = 'utility';
  readonly risk: 'low' | 'medium' | 'high' = 'low';
  readonly builtin = true;

  protected formatError(error: unknown, startedAt: number): ToolResult {
    if (error instanceof UtilityApiError) {
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
      error: error instanceof Error ? error.message : 'Unknown utility API error',
      errorCode: 'UTILITY_TOOL_ERROR',
      metadata: {
        durationMs: Date.now() - startedAt,
        sideEffects: [],
      },
    };
  }

  abstract execute(params: Record<string, unknown>, context: InvokeContext): Promise<ToolResult>;
}

export class ExchangeRateTool extends UtilityToolBase {
  readonly name = 'utility/exchange_rate';
  readonly description = 'Convert one currency amount to another using live exchange rates.';
  readonly parameters: JSONSchema = {
    type: 'object',
    properties: {
      base: { type: 'string', description: '3-letter base currency code, for example CNY.' },
      target: { type: 'string', description: '3-letter target currency code, for example USD.' },
      amount: { type: 'number', description: 'Amount in base currency to convert.', default: 1 },
    },
    required: ['base', 'target'],
  };

  async execute(params: Record<string, unknown>, _context: InvokeContext): Promise<ToolResult> {
    const startedAt = Date.now();
    try {
      const result = await utilityService.getExchangeRate(
        typeof params.base === 'string' ? params.base : '',
        typeof params.target === 'string' ? params.target : '',
        typeof params.amount === 'number' ? params.amount : 1,
      );

      return {
        success: true,
        status: 'success',
        data: result,
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

export class IpLocationTool extends UtilityToolBase {
  readonly name = 'utility/ip_location';
  readonly description = 'Look up the approximate geographic location and ISP information of an IP address.';
  readonly parameters: JSONSchema = {
    type: 'object',
    properties: {
      ip: { type: 'string', description: 'Optional IPv4 or IPv6 address. When omitted, use the current server public IP.' },
    },
    required: [],
  };

  async execute(params: Record<string, unknown>, _context: InvokeContext): Promise<ToolResult> {
    const startedAt = Date.now();
    try {
      const result = await utilityService.getIpLocation(typeof params.ip === 'string' ? params.ip : undefined);

      return {
        success: true,
        status: 'success',
        data: result,
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

export class HolidaysTool extends UtilityToolBase {
  readonly name = 'utility/holidays';
  readonly description = 'Query the public holidays of a country for a given year.';
  readonly parameters: JSONSchema = {
    type: 'object',
    properties: {
      countryCode: { type: 'string', description: '2-letter ISO country code, for example CN or US.' },
      year: { type: 'number', description: 'Target year, defaults to the current year.' },
    },
    required: ['countryCode'],
  };

  async execute(params: Record<string, unknown>, _context: InvokeContext): Promise<ToolResult> {
    const startedAt = Date.now();
    try {
      const result = await utilityService.getHolidays(
        typeof params.countryCode === 'string' ? params.countryCode : '',
        typeof params.year === 'number' ? params.year : undefined,
      );

      return {
        success: true,
        status: 'success',
        data: result,
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

export class TopNewsTool extends UtilityToolBase {
  readonly name = 'utility/top_news';
  readonly description = 'Fetch the latest top news headlines for quick web-aware summaries.';
  readonly parameters: JSONSchema = {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'Number of headlines to return, from 1 to 10.', default: 5 },
    },
    required: [],
  };

  async execute(params: Record<string, unknown>, _context: InvokeContext): Promise<ToolResult> {
    const startedAt = Date.now();
    try {
      const result = await utilityService.getTopNews(typeof params.limit === 'number' ? params.limit : 5);

      return {
        success: true,
        status: 'success',
        data: result,
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

export class CryptoPriceTool extends UtilityToolBase {
  readonly name = 'utility/crypto_price';
  readonly description = 'Query live cryptocurrency market prices such as BTC, ETH, or SOL.';
  readonly parameters: JSONSchema = {
    type: 'object',
    properties: {
      symbol: { type: 'string', description: 'Crypto ticker symbol or coin id, for example BTC or bitcoin.' },
      vsCurrency: { type: 'string', description: 'Quote currency, for example USD or CNY.', default: 'USD' },
    },
    required: ['symbol'],
  };

  async execute(params: Record<string, unknown>, _context: InvokeContext): Promise<ToolResult> {
    const startedAt = Date.now();
    try {
      const result = await utilityService.getCryptoPrice(
        typeof params.symbol === 'string' ? params.symbol : '',
        typeof params.vsCurrency === 'string' ? params.vsCurrency : 'USD',
      );

      return {
        success: true,
        status: 'success',
        data: result,
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
