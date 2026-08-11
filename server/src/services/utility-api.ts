export class UtilityApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode = 500,
  ) {
    super(message);
    this.name = 'UtilityApiError';
  }
}

interface ExchangeRateResponse {
  base_code?: string;
  time_last_update_utc?: string;
  rates?: Record<string, number>;
}

interface IpApiResponse {
  status?: string;
  message?: string;
  query?: string;
  country?: string;
  countryCode?: string;
  regionName?: string;
  city?: string;
  timezone?: string;
  isp?: string;
  org?: string;
  lat?: number;
  lon?: number;
}

interface HolidayApiResponse {
  date?: string;
  localName?: string;
  name?: string;
  countryCode?: string;
  global?: boolean;
  counties?: string[] | null;
  launchYear?: number | null;
  types?: string[];
}

interface HackerNewsItemResponse {
  id?: number;
  title?: string;
  url?: string;
  by?: string;
  score?: number;
  time?: number;
  descendants?: number;
  type?: string;
}

interface CoinGeckoMarketsResponseItem {
  id?: string;
  symbol?: string;
  name?: string;
  current_price?: number;
  market_cap?: number;
  market_cap_rank?: number;
  total_volume?: number;
  high_24h?: number;
  low_24h?: number;
  price_change_percentage_24h?: number;
  last_updated?: string;
}

async function fetchJson<T>(url: string, userAgent: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': userAgent,
    },
  });

  if (!response.ok) {
    throw new UtilityApiError(
      `Utility upstream request failed with status ${response.status}`,
      'UTILITY_UPSTREAM_ERROR',
      502,
    );
  }

  return response.json() as Promise<T>;
}

function normalizeCurrency(code: string, fieldName: string): string {
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new UtilityApiError(`${fieldName} must be a 3-letter currency code`, 'UTILITY_INVALID_CURRENCY', 400);
  }
  return normalized;
}

function normalizeYear(year?: number): number {
  const value = typeof year === 'number' && Number.isFinite(year) ? Math.trunc(year) : new Date().getFullYear();
  if (value < 1900 || value > 2100) {
    throw new UtilityApiError('Year must be between 1900 and 2100', 'UTILITY_INVALID_YEAR', 400);
  }
  return value;
}

function normalizeCountryCode(countryCode: string): string {
  const normalized = countryCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) {
    throw new UtilityApiError('Country code must be a 2-letter ISO code', 'UTILITY_INVALID_COUNTRY', 400);
  }
  return normalized;
}

export class UtilityApiService {
  async getExchangeRate(base: string, target: string, amount = 1): Promise<{
    base: string;
    target: string;
    amount: number;
    rate: number;
    convertedAmount: number;
    updatedAt: string | null;
  }> {
    const normalizedBase = normalizeCurrency(base, 'Base currency');
    const normalizedTarget = normalizeCurrency(target, 'Target currency');
    const normalizedAmount = typeof amount === 'number' && Number.isFinite(amount) ? amount : Number(amount);

    if (!Number.isFinite(normalizedAmount)) {
      throw new UtilityApiError('Amount must be a valid number', 'UTILITY_INVALID_AMOUNT', 400);
    }

    const url = `https://open.er-api.com/v6/latest/${encodeURIComponent(normalizedBase)}`;
    const data = await fetchJson<ExchangeRateResponse>(url, 'myopenclaw-utility/1.0');
    const rate = data.rates?.[normalizedTarget];

    if (typeof rate !== 'number') {
      throw new UtilityApiError(`Exchange rate for ${normalizedTarget} not found`, 'UTILITY_RATE_NOT_FOUND', 404);
    }

    return {
      base: normalizedBase,
      target: normalizedTarget,
      amount: normalizedAmount,
      rate,
      convertedAmount: normalizedAmount * rate,
      updatedAt: data.time_last_update_utc ?? null,
    };
  }

  async getIpLocation(ip?: string): Promise<{
    ip: string | null;
    country: string | null;
    countryCode: string | null;
    region: string | null;
    city: string | null;
    timezone: string | null;
    isp: string | null;
    organization: string | null;
    latitude: number | null;
    longitude: number | null;
  }> {
    const normalizedIp = typeof ip === 'string' && ip.trim() ? ip.trim() : '';
    const suffix = normalizedIp ? `/${encodeURIComponent(normalizedIp)}` : '/';
    const url = `http://ip-api.com/json${suffix}?lang=zh-CN`;
    const data = await fetchJson<IpApiResponse>(url, 'myopenclaw-utility/1.0');

    if (data.status !== 'success') {
      throw new UtilityApiError(data.message || 'IP lookup failed', 'UTILITY_IP_LOOKUP_FAILED', 404);
    }

    return {
      ip: data.query ?? null,
      country: data.country ?? null,
      countryCode: data.countryCode ?? null,
      region: data.regionName ?? null,
      city: data.city ?? null,
      timezone: data.timezone ?? null,
      isp: data.isp ?? null,
      organization: data.org ?? null,
      latitude: typeof data.lat === 'number' ? data.lat : null,
      longitude: typeof data.lon === 'number' ? data.lon : null,
    };
  }

  async getHolidays(countryCode: string, year?: number): Promise<{
    countryCode: string;
    year: number;
    total: number;
    holidays: Array<{
      date: string | null;
      localName: string | null;
      name: string | null;
      global: boolean;
      types: string[];
    }>;
  }> {
    const normalizedCountry = normalizeCountryCode(countryCode);
    const normalizedYear = normalizeYear(year);
    const url = `https://date.nager.at/api/v3/PublicHolidays/${normalizedYear}/${normalizedCountry}`;
    const data = await fetchJson<HolidayApiResponse[]>(url, 'myopenclaw-utility/1.0');

    return {
      countryCode: normalizedCountry,
      year: normalizedYear,
      total: data.length,
      holidays: data.map((item) => ({
        date: item.date ?? null,
        localName: item.localName ?? null,
        name: item.name ?? null,
        global: item.global ?? false,
        types: item.types ?? [],
      })),
    };
  }

  async getTopNews(limit = 5): Promise<{
    total: number;
    articles: Array<{
      id: number | null;
      title: string | null;
      url: string | null;
      author: string | null;
      score: number | null;
      commentCount: number | null;
      publishedAt: string | null;
      source: string;
    }>;
  }> {
    const normalizedLimit = Math.max(1, Math.min(limit, 10));
    const ids = await fetchJson<number[]>(
      'https://hacker-news.firebaseio.com/v0/topstories.json',
      'myopenclaw-utility/1.0',
    );

    const selectedIds = ids.slice(0, normalizedLimit);
    const items = await Promise.all(selectedIds.map(async (id) => {
      const item = await fetchJson<HackerNewsItemResponse>(
        `https://hacker-news.firebaseio.com/v0/item/${id}.json`,
        'myopenclaw-utility/1.0',
      );
      return {
        id: item.id ?? null,
        title: item.title ?? null,
        url: item.url ?? null,
        author: item.by ?? null,
        score: typeof item.score === 'number' ? item.score : null,
        commentCount: typeof item.descendants === 'number' ? item.descendants : null,
        publishedAt: typeof item.time === 'number' ? new Date(item.time * 1000).toISOString() : null,
        source: 'Hacker News',
      };
    }));

    return {
      total: items.length,
      articles: items,
    };
  }

  async getCryptoPrice(symbol: string, vsCurrency = 'usd'): Promise<{
    symbol: string;
    vsCurrency: string;
    coinId: string;
    name: string | null;
    currentPrice: number | null;
    marketCap: number | null;
    marketCapRank: number | null;
    totalVolume: number | null;
    high24h: number | null;
    low24h: number | null;
    change24hPercent: number | null;
    lastUpdated: string | null;
  }> {
    const normalizedSymbol = symbol.trim().toLowerCase();
    const normalizedVsCurrency = vsCurrency.trim().toLowerCase();

    if (!normalizedSymbol) {
      throw new UtilityApiError('Crypto symbol is required', 'UTILITY_CRYPTO_SYMBOL_REQUIRED', 400);
    }

    if (!normalizedVsCurrency) {
      throw new UtilityApiError('Quote currency is required', 'UTILITY_CRYPTO_QUOTE_REQUIRED', 400);
    }

    const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=${encodeURIComponent(normalizedVsCurrency)}&order=market_cap_desc&per_page=250&page=1&sparkline=false`;
    const data = await fetchJson<CoinGeckoMarketsResponseItem[]>(url, 'myopenclaw-utility/1.0');
    const match = data.find((item) => item.symbol?.toLowerCase() === normalizedSymbol || item.id?.toLowerCase() === normalizedSymbol);

    if (!match) {
      throw new UtilityApiError(`Crypto asset not found for symbol ${symbol}`, 'UTILITY_CRYPTO_NOT_FOUND', 404);
    }

    return {
      symbol: match.symbol?.toUpperCase() ?? normalizedSymbol.toUpperCase(),
      vsCurrency: normalizedVsCurrency.toUpperCase(),
      coinId: match.id ?? normalizedSymbol,
      name: match.name ?? null,
      currentPrice: typeof match.current_price === 'number' ? match.current_price : null,
      marketCap: typeof match.market_cap === 'number' ? match.market_cap : null,
      marketCapRank: typeof match.market_cap_rank === 'number' ? match.market_cap_rank : null,
      totalVolume: typeof match.total_volume === 'number' ? match.total_volume : null,
      high24h: typeof match.high_24h === 'number' ? match.high_24h : null,
      low24h: typeof match.low_24h === 'number' ? match.low_24h : null,
      change24hPercent: typeof match.price_change_percentage_24h === 'number' ? match.price_change_percentage_24h : null,
      lastUpdated: match.last_updated ?? null,
    };
  }
}
