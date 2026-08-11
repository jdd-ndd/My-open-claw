import type { InvokeContext, Tool, ToolResult } from '../../core/types/index.js';
import { SystemTimeTool } from '../../tools/system/index.js';
import {
  WeatherCurrentTool,
  WeatherForecastTool,
} from '../../tools/weather/index.js';
import {
  ExchangeRateTool,
  HolidaysTool,
  TopNewsTool,
  CryptoPriceTool,
} from '../../tools/utility/index.js';

export interface RealtimeShortcutMatch {
  reply: string;
  reasoning?: string;
}

const timeTool = new SystemTimeTool();
const weatherCurrentTool = new WeatherCurrentTool();
const weatherForecastTool = new WeatherForecastTool();
const exchangeRateTool = new ExchangeRateTool();
const holidaysTool = new HolidaysTool();
const topNewsTool = new TopNewsTool();
const cryptoPriceTool = new CryptoPriceTool();

const TIME_PATTERN = /(现在几点|几点了|当前时间|现在时间|实时时间|北京时间|日期时间|今天几号|今天星期几)/i;
const WEATHER_PATTERN = /(.{1,20}?)(天气|气温|温度|天气预报)/;
const FORECAST_PATTERN = /(今天|明天|后天|未来\d+天|未来几天|最近\d+天|最近几天|最近一周|接下来\d+天|接下来几天|一周|这周|本周|近\d+天|连续\d+天)/;
const EXCHANGE_PATTERN = /([A-Za-z]{3}|人民币|美元|欧元|日元|英镑|港币|韩元)\s*(\d+(?:\.\d+)?)?\s*(?:兑换|换算|等于|转成|转换成)\s*([A-Za-z]{3}|人民币|美元|欧元|日元|英镑|港币|韩元)/i;
const HOLIDAY_PATTERN = /((?:20)?\d{2})?年?.{0,6}?(中国|美国|日本|英国|法国|德国|韩国|新加坡|加拿大|澳大利亚|CN|US|JP|GB|FR|DE|KR|SG|CA|AU).{0,6}?(节假日|假期)/i;
const NEWS_PATTERN = /(今日新闻|热点新闻|最新新闻|头条新闻|新闻头条)/i;
const CRYPTO_PATTERN = /(BTC|ETH|SOL|DOGE|XRP|TRX|BNB|bitcoin|ethereum|solana).{0,8}?(价格|行情|币价)/i;

const CURRENCY_MAP: Record<string, string> = {
  人民币: 'CNY',
  美元: 'USD',
  欧元: 'EUR',
  日元: 'JPY',
  英镑: 'GBP',
  港币: 'HKD',
  韩元: 'KRW',
};

const COUNTRY_MAP: Record<string, string> = {
  中国: 'CN',
  美国: 'US',
  日本: 'JP',
  英国: 'GB',
  法国: 'FR',
  德国: 'DE',
  韩国: 'KR',
  新加坡: 'SG',
  加拿大: 'CA',
  澳大利亚: 'AU',
  CN: 'CN',
  US: 'US',
  JP: 'JP',
  GB: 'GB',
  FR: 'FR',
  DE: 'DE',
  KR: 'KR',
  SG: 'SG',
  CA: 'CA',
  AU: 'AU',
};

function buildContext(sessionId: string, channelId: string, userId: string): InvokeContext {
  return {
    sessionId,
    channelId,
    userId,
    config: {},
  };
}

function unwrapResult(result: ToolResult): unknown {
  return result.data ?? result.result ?? null;
}

function normalizeToolError(result: ToolResult, fallback: string): string {
  return result.error?.trim() || fallback;
}

async function executeTool(
  tool: Tool,
  params: Record<string, unknown>,
  context: InvokeContext,
): Promise<ToolResult> {
  return tool.execute(params, context);
}

function normalizeCity(raw: string): string {
  return raw
    .replace(/请问|帮我|查一下|查询|查看|查找|告诉我|一下|今日|今天|明天|后天|最近\d+天|最近几天|最近一周|最近|未来\d+天|未来几天|接下来\d+天|接下来几天|接下来|这周|本周|一周|两周|近\d+天|连续\d+天|连续|几天|现在|的|查|想/g, '')
    .trim();
}

/** 从用户输入中提取期望的预报天数，例如 "最近5天" → 5，"一周" → 7，默认返回 3 */
function extractForecastDays(content: string): number {
  // 数字+天："最近5天"、"未来3天"、"近7天"
  const numMatch = content.match(/(\d+)\s*天/);
  if (numMatch) return Math.min(Math.max(parseInt(numMatch[1], 10), 1), 7);
  // "一周" → 7 天
  if (/一周/.test(content)) return 7;
  // "两周" → 最多 7（工具上限）
  if (/两周/.test(content)) return 7;
  // 默认 3 天
  return 3;
}

function normalizeCurrency(input: string): string {
  const mapped = CURRENCY_MAP[input];
  if (mapped) return mapped;
  return input.trim().toUpperCase();
}

function formatTimeReply(data: unknown): string {
  const record = (data ?? {}) as Record<string, unknown>;
  const formatted = typeof record.formatted === 'string' ? record.formatted : '';
  const timezone = typeof record.timezone === 'string' ? record.timezone : 'Asia/Shanghai';
  const isoTime = typeof record.isoTime === 'string' ? record.isoTime : '';
  return [
    `当前时间是 ${formatted || isoTime}。`,
    `时区：${timezone}`,
  ].join('\n');
}

function formatWeatherReply(data: unknown, forecast = false): string {
  const record = (data ?? {}) as Record<string, unknown>;
  const location = (record.location ?? {}) as Record<string, unknown>;
  const city = typeof location.label === 'string' ? location.label : (typeof location.name === 'string' ? location.name : '目标城市');

  if (!forecast) {
    const current = (record.current ?? {}) as Record<string, unknown>;
    return [
      `${city} 当前天气：`,
      `温度：${current.temperatureC ?? '--'}°C`,
      `风速：${current.windSpeedKph ?? '--'} km/h`,
      `天气代码：${current.weatherCode ?? '--'}`,
      `观测时间：${current.observedAt ?? '--'}`,
    ].join('\n');
  }

  const days = Array.isArray(record.days) ? record.days as Array<Record<string, unknown>> : [];
  const lines = days.slice(0, 5).map((day) => (
    `${day.date ?? '--'}：${day.tempMinC ?? '--'}°C ~ ${day.tempMaxC ?? '--'}°C，降水概率 ${day.precipitationProbability ?? '--'}%`
  ));

  return [`${city} 未来天气：`, ...lines].join('\n');
}

function formatExchangeReply(data: unknown): string {
  const record = (data ?? {}) as Record<string, unknown>;
  return `${record.amount ?? '--'} ${record.base ?? '--'} 约等于 ${record.convertedAmount ?? '--'} ${record.target ?? '--'}（汇率 ${record.rate ?? '--'}）`;
}

function formatHolidayReply(data: unknown): string {
  const record = (data ?? {}) as Record<string, unknown>;
  const holidays = Array.isArray(record.holidays) ? record.holidays as Array<Record<string, unknown>> : [];
  const header = `${record.countryCode ?? '--'} ${record.year ?? '--'} 年节假日（前 ${Math.min(holidays.length, 8)} 条）：`;
  const lines = holidays.slice(0, 8).map((item) => `${item.date ?? '--'} ${item.localName ?? item.name ?? '--'}`);
  return [header, ...lines].join('\n');
}

function formatNewsReply(data: unknown): string {
  const record = (data ?? {}) as Record<string, unknown>;
  const articles = Array.isArray(record.articles) ? record.articles as Array<Record<string, unknown>> : [];
  return ['最新热点新闻：', ...articles.slice(0, 5).map((item, index) => `${index + 1}. ${item.title ?? '--'}`)].join('\n');
}

function formatCryptoReply(data: unknown): string {
  const record = (data ?? {}) as Record<string, unknown>;
  return `${String(record.symbol ?? '--').toUpperCase()} 当前价格约为 ${record.price ?? '--'} ${record.vsCurrency ?? '--'}。`;
}

export async function resolveRealtimeShortcut(params: {
  content: string;
  sessionId: string;
  channelId: string;
  userId: string;
}): Promise<RealtimeShortcutMatch | null> {
  const content = params.content.trim();
  if (!content) {
    return null;
  }

  const context = buildContext(params.sessionId, params.channelId, params.userId);

  if (TIME_PATTERN.test(content)) {
    const result = await executeTool(timeTool, { timezone: 'Asia/Shanghai', locale: 'zh-CN' }, context);
    if (!result.success) {
      return { reply: `时间查询失败：${normalizeToolError(result, '暂时无法获取当前时间。')}` };
    }

    return {
      reasoning: '识别为实时时间查询，已直接调用 system/time 工具返回结果。',
      reply: formatTimeReply(unwrapResult(result)),
    };
  }

  const weatherMatch = content.match(WEATHER_PATTERN);
  if (weatherMatch) {
    const city = normalizeCity(weatherMatch[1]);
    if (city) {
      const isForecast = FORECAST_PATTERN.test(content);
      const tool = isForecast ? weatherForecastTool : weatherCurrentTool;
      const toolParams = isForecast
        ? { city, days: extractForecastDays(content) }
        : { city };
      const result = await executeTool(tool, toolParams, context);
      if (!result.success) {
        return { reply: `天气查询失败：${normalizeToolError(result, '暂时无法获取天气信息。')}` };
      }

      return {
        reasoning: `识别为${isForecast ? '天气预报' : '实时天气'}查询，已直接调用 ${tool.name}。`,
        reply: formatWeatherReply(unwrapResult(result), isForecast),
      };
    }
  }

  const exchangeMatch = content.match(EXCHANGE_PATTERN);
  if (exchangeMatch) {
    const base = normalizeCurrency(exchangeMatch[1]);
    const amount = exchangeMatch[2] ? Number(exchangeMatch[2]) : 1;
    const target = normalizeCurrency(exchangeMatch[3]);
    const result = await executeTool(exchangeRateTool, { base, target, amount }, context);
    if (!result.success) {
      return { reply: `汇率查询失败：${normalizeToolError(result, '暂时无法获取汇率信息。')}` };
    }

    return {
      reasoning: '识别为汇率换算请求，已直接调用 utility/exchange_rate。',
      reply: formatExchangeReply(unwrapResult(result)),
    };
  }

  const holidayMatch = content.match(HOLIDAY_PATTERN);
  if (holidayMatch) {
    const currentYear = new Date().getFullYear();
    const year = holidayMatch[1] ? Number(holidayMatch[1]) : currentYear;
    const countryCode = COUNTRY_MAP[holidayMatch[2]] ?? holidayMatch[2].toUpperCase();
    const result = await executeTool(holidaysTool, { countryCode, year }, context);
    if (!result.success) {
      return { reply: `节假日查询失败：${normalizeToolError(result, '暂时无法获取节假日信息。')}` };
    }

    return {
      reasoning: '识别为节假日查询，已直接调用 utility/holidays。',
      reply: formatHolidayReply(unwrapResult(result)),
    };
  }

  if (NEWS_PATTERN.test(content)) {
    const result = await executeTool(topNewsTool, { limit: 5 }, context);
    if (!result.success) {
      return { reply: `新闻查询失败：${normalizeToolError(result, '暂时无法获取新闻。')}` };
    }

    return {
      reasoning: '识别为新闻查询，已直接调用 utility/top_news。',
      reply: formatNewsReply(unwrapResult(result)),
    };
  }

  const cryptoMatch = content.match(CRYPTO_PATTERN);
  if (cryptoMatch) {
    const symbol = cryptoMatch[1];
    const result = await executeTool(cryptoPriceTool, { symbol, vsCurrency: 'USD' }, context);
    if (!result.success) {
      return { reply: `加密货币价格查询失败：${normalizeToolError(result, '暂时无法获取币价信息。')}` };
    }

    return {
      reasoning: '识别为币价查询，已直接调用 utility/crypto_price。',
      reply: formatCryptoReply(unwrapResult(result)),
    };
  }

  return null;
}
