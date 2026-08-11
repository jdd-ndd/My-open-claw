/**
 * HTTP REST 路由注册模块
 */

import type { FastifyInstance } from 'fastify';
import type { ConnectionStore } from './connection-store.js';
import type { MessageRouter } from '../routing/index.js';
import type { SessionManager } from '../sessions/index.js';
import type { GatewayServerConfig } from './types.js';
import type { TokenService } from '../security/token-service.js';
import type { AuditLogger } from '../audit/index.js';
import type { AuditCategoryType } from '../audit/types.js';
import type { TaskScheduler } from '../scheduler/index.js';
import type { StateManager } from '../state/index.js';
import type { AgentRuntimeAdapter } from './agent-runtime-adapter.js';
import type { Session } from '../sessions/types.js';
import { WeatherService, WeatherServiceError } from '../../services/weather.js';
import { UtilityApiService, UtilityApiError } from '../../services/utility-api.js';
import { RoutingService, RoutingServiceError } from '../../services/routing.js';
import { CalculatorService, CalculatorServiceError } from '../../services/calculator.js';
import { createPptModule } from '../../modules/ppt/index.js';
import { registerPptRoutes } from '../../modules/ppt/routes.js';
import type { Messenger } from './messaging.js';
import { ChannelManager } from '../../channels/manager.js';
import { MessageType } from '../../channels/types.js';
import { createLogger } from '../../core/utils/logger.js';

const log = createLogger('gateway:http-routes');

const okResponse = {
  200: {
    description: '成功',
    type: 'object',
    properties: {
      ok: { type: 'boolean' },
      data: { type: 'object', additionalProperties: true },
    },
  },
};

const errorResponse = {
  description: 'Error',
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    error: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        retryable: { type: 'boolean' },
      },
    },
  },
};

export interface ExtendedHttpRouteDeps {
  store: ConnectionStore;
  router: MessageRouter;
  sessions: SessionManager;
  config: GatewayServerConfig;
  tokenService?: TokenService;
  audit?: AuditLogger;
  scheduler?: TaskScheduler;
  stateManager?: StateManager;
  runtimeAdapter?: AgentRuntimeAdapter;
  /** 消息广播器（用于跨端会话变更通知） */
  messenger?: Messenger;
}

export async function registerHttpRoutes(
  fastify: FastifyInstance,
  store: ConnectionStore,
  router: MessageRouter,
  sessions: SessionManager,
  config: GatewayServerConfig,
  deps?: Partial<ExtendedHttpRouteDeps>,
): Promise<void> {
  const tokenService = deps?.tokenService;
  const audit = deps?.audit;
  const scheduler = deps?.scheduler;
  const stateManager = deps?.stateManager;
  const runtimeAdapter = deps?.runtimeAdapter;
  const messenger = deps?.messenger;
  const weatherService = new WeatherService();
  const utilityApiService = new UtilityApiService();
  const routingService = new RoutingService();
  const calculatorService = new CalculatorService();

  const toApiError = (error: unknown) => {
    if (error instanceof WeatherServiceError) {
      return {
        statusCode: error.statusCode,
        body: {
          ok: false,
          error: {
            code: error.code,
            message: error.message,
            retryable: error.statusCode >= 500,
          },
        },
      };
    }

    return {
      statusCode: 500,
      body: {
        ok: false,
        error: {
          code: 'WEATHER_INTERNAL_ERROR',
          message: error instanceof Error ? error.message : 'Unknown weather error',
          retryable: true,
        },
      },
    };
  };

  const toUtilityApiError = (error: unknown) => {
    if (error instanceof UtilityApiError) {
      return {
        statusCode: error.statusCode,
        body: {
          ok: false,
          error: {
            code: error.code,
            message: error.message,
            retryable: error.statusCode >= 500,
          },
        },
      };
    }

    return {
      statusCode: 500,
      body: {
        ok: false,
        error: {
          code: 'UTILITY_INTERNAL_ERROR',
          message: error instanceof Error ? error.message : 'Unknown utility API error',
          retryable: true,
        },
      },
    };
  };

  // 路线规划错误转换器
  const toRoutingApiError = (error: unknown) => {
    if (error instanceof RoutingServiceError) {
      return {
        statusCode: error.statusCode,
        body: {
          ok: false,
          error: {
            code: error.code,
            message: error.message,
            retryable: error.statusCode >= 500,
          },
        },
      };
    }

    return {
      statusCode: 500,
      body: {
        ok: false,
        error: {
          code: 'ROUTING_INTERNAL_ERROR',
          message: error instanceof Error ? error.message : 'Unknown routing error',
          retryable: true,
        },
      },
    };
  };

  // 运算服务错误转换器
  const toCalculatorApiError = (error: unknown) => {
    if (error instanceof CalculatorServiceError) {
      return {
        statusCode: error.statusCode,
        body: {
          ok: false,
          error: {
            code: error.code,
            message: error.message,
            retryable: error.statusCode >= 500,
          },
        },
      };
    }

    return {
      statusCode: 500,
      body: {
        ok: false,
        error: {
          code: 'CALCULATOR_INTERNAL_ERROR',
          message: error instanceof Error ? error.message : 'Unknown calculator error',
          retryable: true,
        },
      },
    };
  };

  fastify.get('/api/health', {
    schema: {
      description: '检查网关服务是否正常运行',
      tags: ['Health'],
      response: okResponse,
    },
  }, async () => ({ ok: true, data: { status: 'healthy' as const } }));

  fastify.get('/api/health/deep', {
    schema: {
      description: '深度健康检查',
      tags: ['Health'],
      response: okResponse,
    },
  }, async () => {
    const components: Record<string, string> = {
      gateway: 'healthy',
      sessions: sessions.activeCount >= 0 ? 'healthy' : 'unhealthy',
      storage: 'healthy',
    };

    if (stateManager) components.stateManager = 'healthy';
    if (scheduler) components.scheduler = 'healthy';

    const allHealthy = Object.values(components).every((s) => s === 'healthy');
    return {
      ok: true,
      data: {
        status: allHealthy ? ('healthy' as const) : ('degraded' as const),
        components,
        uptime: process.uptime(),
      },
    };
  });

  fastify.get('/api/status', {
    schema: {
      description: '获取网关运行状态',
      tags: ['Status'],
      response: okResponse,
    },
  }, async () => {
    const snapshot = stateManager?.getSnapshot();
      return {
        ok: true,
        data: {
          status: 'running' as const,
          serverTime: new Date().toISOString(),
          serverTimestamp: Date.now(),
          uptime: process.uptime(),
          connectionCount: store.size,
          maxConnections: config.maxConnections,
          activeSessions: sessions.activeCount,
        ruleCount: router.getRules().length,
        host: config.host,
        port: config.port,
        version: config.version,
        memoryUsage: snapshot?.resources.memoryUsage,
        channels: stateManager?.getAllChannelStates().length ?? 0,
        agents: stateManager ? Array.from(snapshot?.agents.values() ?? []) : [],
        },
      };
    });

  fastify.get('/api/time', {
    schema: {
      description: '鑾峰彇鏈嶅姟绔疄鏃堕棿',
      tags: ['Status'],
      response: okResponse,
    },
  }, async () => ({
    ok: true,
    data: {
      serverTime: new Date().toISOString(),
      serverTimestamp: Date.now(),
    },
  }));

  fastify.get('/api/weather/lookup', {
    schema: {
      description: 'Search weather-supported cities by keyword',
      tags: ['Weather'],
      querystring: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string' },
          count: { type: 'number' },
        },
      },
      response: {
        ...okResponse,
        400: errorResponse,
        404: errorResponse,
        500: errorResponse,
        502: errorResponse,
      },
    },
  }, async (request, reply) => {
    const query = request.query as { query: string; count?: number };
    try {
      const locations = await weatherService.lookupCity(query.query, query.count ?? 5);
      return { ok: true, data: { total: locations.length, locations } };
    } catch (error) {
      const apiError = toApiError(error);
      reply.status(apiError.statusCode);
      return apiError.body;
    }
  });

  fastify.get('/api/weather/current', {
    schema: {
      description: 'Get current weather by city name',
      tags: ['Weather'],
      querystring: {
        type: 'object',
        required: ['city'],
        properties: {
          city: { type: 'string' },
        },
      },
      response: {
        ...okResponse,
        400: errorResponse,
        404: errorResponse,
        500: errorResponse,
        502: errorResponse,
      },
    },
  }, async (request, reply) => {
    const query = request.query as { city: string };
    try {
      const weather = await weatherService.getCurrentWeather(query.city);
      return { ok: true, data: weather };
    } catch (error) {
      const apiError = toApiError(error);
      reply.status(apiError.statusCode);
      return apiError.body;
    }
  });

  fastify.get('/api/weather/forecast', {
    schema: {
      description: 'Get multi-day weather forecast by city name',
      tags: ['Weather'],
      querystring: {
        type: 'object',
        required: ['city'],
        properties: {
          city: { type: 'string' },
          days: { type: 'number' },
        },
      },
      response: {
        ...okResponse,
        400: errorResponse,
        404: errorResponse,
        500: errorResponse,
        502: errorResponse,
      },
    },
  }, async (request, reply) => {
    const query = request.query as { city: string; days?: number };
    try {
      const forecast = await weatherService.getForecast(query.city, query.days ?? 3);
      return { ok: true, data: forecast };
    } catch (error) {
      const apiError = toApiError(error);
      reply.status(apiError.statusCode);
      return apiError.body;
    }
  });

  fastify.get('/api/utility/exchange-rate', {
    schema: {
      description: 'Convert currencies using live exchange rates',
      tags: ['Utility'],
      querystring: {
        type: 'object',
        required: ['base', 'target'],
        properties: {
          base: { type: 'string' },
          target: { type: 'string' },
          amount: { type: 'number' },
        },
      },
      response: {
        ...okResponse,
        400: errorResponse,
        404: errorResponse,
        500: errorResponse,
        502: errorResponse,
      },
    },
  }, async (request, reply) => {
    const query = request.query as { base: string; target: string; amount?: number };
    try {
      const result = await utilityApiService.getExchangeRate(query.base, query.target, query.amount ?? 1);
      return { ok: true, data: result };
    } catch (error) {
      const apiError = toUtilityApiError(error);
      reply.status(apiError.statusCode);
      return apiError.body;
    }
  });

  fastify.get('/api/utility/ip-location', {
    schema: {
      description: 'Look up IP geographic location and ISP information',
      tags: ['Utility'],
      querystring: {
        type: 'object',
        properties: {
          ip: { type: 'string' },
        },
      },
      response: {
        ...okResponse,
        400: errorResponse,
        404: errorResponse,
        500: errorResponse,
        502: errorResponse,
      },
    },
  }, async (request, reply) => {
    const query = request.query as { ip?: string };
    try {
      const result = await utilityApiService.getIpLocation(query.ip);
      return { ok: true, data: result };
    } catch (error) {
      const apiError = toUtilityApiError(error);
      reply.status(apiError.statusCode);
      return apiError.body;
    }
  });

  fastify.get('/api/utility/holidays', {
    schema: {
      description: 'Query public holidays by country and year',
      tags: ['Utility'],
      querystring: {
        type: 'object',
        required: ['countryCode'],
        properties: {
          countryCode: { type: 'string' },
          year: { type: 'number' },
        },
      },
      response: {
        ...okResponse,
        400: errorResponse,
        404: errorResponse,
        500: errorResponse,
        502: errorResponse,
      },
    },
  }, async (request, reply) => {
    const query = request.query as { countryCode: string; year?: number };
    try {
      const result = await utilityApiService.getHolidays(query.countryCode, query.year);
      return { ok: true, data: result };
    } catch (error) {
      const apiError = toUtilityApiError(error);
      reply.status(apiError.statusCode);
      return apiError.body;
    }
  });

  fastify.get('/api/utility/top-news', {
    schema: {
      description: 'Fetch the latest top news headlines',
      tags: ['Utility'],
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'number' },
        },
      },
      response: {
        ...okResponse,
        400: errorResponse,
        404: errorResponse,
        500: errorResponse,
        502: errorResponse,
      },
    },
  }, async (request, reply) => {
    const query = request.query as { limit?: number };
    try {
      const result = await utilityApiService.getTopNews(query.limit ?? 5);
      return { ok: true, data: result };
    } catch (error) {
      const apiError = toUtilityApiError(error);
      reply.status(apiError.statusCode);
      return apiError.body;
    }
  });

  fastify.get('/api/utility/crypto-price', {
    schema: {
      description: 'Query live cryptocurrency market prices',
      tags: ['Utility'],
      querystring: {
        type: 'object',
        required: ['symbol'],
        properties: {
          symbol: { type: 'string' },
          vsCurrency: { type: 'string' },
        },
      },
      response: {
        ...okResponse,
        400: errorResponse,
        404: errorResponse,
        500: errorResponse,
        502: errorResponse,
      },
    },
  }, async (request, reply) => {
    const query = request.query as { symbol: string; vsCurrency?: string };
    try {
      const result = await utilityApiService.getCryptoPrice(query.symbol, query.vsCurrency ?? 'USD');
      return { ok: true, data: result };
    } catch (error) {
      const apiError = toUtilityApiError(error);
      reply.status(apiError.statusCode);
      return apiError.body;
    }
  });

  // ── 路线规划：地理编码 ──
  fastify.get('/api/routing/geocode', {
    schema: {
      description: '将地名转换为经纬度坐标（用于路线规划前置步骤）',
      tags: ['Routing'],
      querystring: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string' },
        },
      },
      response: {
        ...okResponse,
        400: errorResponse,
        404: errorResponse,
        500: errorResponse,
        502: errorResponse,
      },
    },
  }, async (request, reply) => {
    const query = request.query as { query: string };
    try {
      const endpoint = await routingService.geocode(query.query);
      return { ok: true, data: endpoint };
    } catch (error) {
      const apiError = toRoutingApiError(error);
      reply.status(apiError.statusCode);
      return apiError.body;
    }
  });

  // ── 路线规划：起终点 → 详细路径 ──
  fastify.get('/api/routing/plan', {
    schema: {
      description: '根据起终点和出行方式生成详细路线（距离/时长/步骤）',
      tags: ['Routing'],
      querystring: {
        type: 'object',
        required: ['origin', 'destination'],
        properties: {
          origin: { type: 'string' },
          destination: { type: 'string' },
          profile: { type: 'string', enum: ['driving', 'walking', 'cycling'] },
        },
      },
      response: {
        ...okResponse,
        400: errorResponse,
        404: errorResponse,
        500: errorResponse,
        502: errorResponse,
      },
    },
  }, async (request, reply) => {
    const query = request.query as { origin: string; destination: string; profile?: 'driving' | 'walking' | 'cycling' };
    try {
      const plan = await routingService.planRoute(
        query.origin,
        query.destination,
        query.profile ?? 'driving',
      );
      return { ok: true, data: plan };
    } catch (error) {
      const apiError = toRoutingApiError(error);
      reply.status(apiError.statusCode);
      return apiError.body;
    }
  });

  // ── 运算：数学表达式求值 ──
  fastify.get('/api/calculator/express', {
    schema: {
      description: '对数学表达式求值（支持 + - * / % ^、括号、函数、π/e 常量）',
      tags: ['Calculator'],
      querystring: {
        type: 'object',
        required: ['expression'],
        properties: {
          expression: { type: 'string' },
        },
      },
      response: {
        ...okResponse,
        400: errorResponse,
        500: errorResponse,
      },
    },
  }, async (request, reply) => {
    const query = request.query as { expression: string };
    try {
      const result = calculatorService.evaluateExpression(query.expression);
      return { ok: true, data: result };
    } catch (error) {
      const apiError = toCalculatorApiError(error);
      reply.status(apiError.statusCode);
      return apiError.body;
    }
  });

  // ── 运算：单位换算 ──
  fastify.get('/api/calculator/unit', {
    schema: {
      description: '在同一类别内进行单位换算（长度/重量/温度/面积/体积/速度）',
      tags: ['Calculator'],
      querystring: {
        type: 'object',
        required: ['value', 'from', 'to'],
        properties: {
          value: { type: 'number' },
          from: { type: 'string' },
          to: { type: 'string' },
        },
      },
      response: {
        ...okResponse,
        400: errorResponse,
        500: errorResponse,
      },
    },
  }, async (request, reply) => {
    const query = request.query as { value: number; from: string; to: string };
    try {
      const result = calculatorService.convertUnit(query.value, query.from, query.to);
      return { ok: true, data: result };
    } catch (error) {
      const apiError = toCalculatorApiError(error);
      reply.status(apiError.statusCode);
      return apiError.body;
    }
  });

  // ── 运算：货币汇率换算 ──
  fastify.get('/api/calculator/currency', {
    schema: {
      description: '基于实时汇率进行货币换算',
      tags: ['Calculator'],
      querystring: {
        type: 'object',
        required: ['base', 'target'],
        properties: {
          amount: { type: 'number', default: 1 },
          base: { type: 'string' },
          target: { type: 'string' },
        },
      },
      response: {
        ...okResponse,
        400: errorResponse,
        500: errorResponse,
        502: errorResponse,
      },
    },
  }, async (request, reply) => {
    const query = request.query as { amount?: number; base: string; target: string };
    try {
      const result = await calculatorService.convertCurrency(
        typeof query.amount === 'number' ? query.amount : 1,
        query.base,
        query.target,
      );
      return { ok: true, data: result };
    } catch (error) {
      const apiError = toCalculatorApiError(error);
      reply.status(apiError.statusCode);
      return apiError.body;
    }
  });

  // ── 运算：进制转换 ──
  fastify.get('/api/calculator/base', {
    schema: {
      description: '在 2/8/10/16 进制之间进行数值转换',
      tags: ['Calculator'],
      querystring: {
        type: 'object',
        required: ['input', 'fromBase', 'toBase'],
        properties: {
          input: { type: 'string' },
          fromBase: { type: 'number', enum: [2, 8, 10, 16] },
          toBase: { type: 'number', enum: [2, 8, 10, 16] },
        },
      },
      response: {
        ...okResponse,
        400: errorResponse,
        500: errorResponse,
      },
    },
  }, async (request, reply) => {
    const query = request.query as { input: string; fromBase: number; toBase: number };
    try {
      const result = calculatorService.convertBase(query.input, query.fromBase, query.toBase);
      return { ok: true, data: result };
    } catch (error) {
      const apiError = toCalculatorApiError(error);
      reply.status(apiError.statusCode);
      return apiError.body;
    }
  });

  fastify.get('/api/connections', {
    schema: {
      description: '获取当前所有活跃 WebSocket 连接',
      tags: ['Connections'],
      response: okResponse,
    },
  }, async () => {
    const list = store.getMetadataList();
    return { ok: true, data: { total: list.length, connections: list } };
  });

  fastify.get('/api/sessions', {
    schema: {
      description: '获取会话列表和路由规则',
      tags: ['Sessions'],
      response: okResponse,
    },
  }, async (request) => {
    const query = request.query as {
      channelId?: string;
      userId?: string;
      includeClosed?: boolean | string;
    };
    const rules = router.getRules();
    const includeClosed = query.includeClosed === true || query.includeClosed === 'true';
    const sessionList = sessions.listSessions({
      channelId: query.channelId,
      userId: query.userId,
      includeClosed,
    });

    return {
      ok: true,
      data: {
        activeSessionCount: sessions.activeCount,
        total: sessionList.length,
        sessions: sessionList,
        ruleCount: rules.length,
        rules: rules.map((r) => ({
          id: r.id,
          priority: r.priority,
          channelId: r.channelId,
          agentId: r.agentId,
          enabled: r.enabled,
        })),
      },
    };
  });

  fastify.post('/api/sessions', {
    schema: {
      description: '创建新的对话会话',
      tags: ['Sessions'],
      body: {
        type: 'object',
        required: ['agentId', 'channelId', 'userId'],
        properties: {
          agentId: { type: 'string' },
          channelId: { type: 'string' },
          userId: { type: 'string' },
          title: { type: 'string' },
        },
      },
    },
  }, async (request) => {
    const { agentId, channelId, userId, title } = request.body as {
      agentId: string;
      channelId: string;
      userId: string;
      title?: string;
    };

    try {
      // 使用 createNewSession 而非 resolve，确保每次都创建全新会话
      // resolve 会返回同一 channelId+userId 下的已有会话，不适合"新建"场景
      const session = sessions.createNewSession(channelId, userId, agentId, title);

      audit?.logEntry({
        category: 'system',
        event: 'session.created',
        sessionId: session.sessionId,
        agentId,
        channelId,
        userId,
        success: true,
        details: { title },
      });

      // 跨端同步：向同 channel 下所有连接广播 session.created 事件
      // 其他端收到后可刷新会话列表，实现实时同步
      if (messenger) {
        const broadcastResult = messenger.broadcastToChannel(channelId, {
          type: 'event',
          id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          timestamp: new Date().toISOString(),
          event: 'session.created',
          payload: {
            session,
            source: 'rest',
          },
        });
        log.info({ channelId, sessionId: session.sessionId, broadcastResult }, 'Broadcast session.created result');
      }

      return { ok: true, data: session };
    } catch (err) {
      // 创建失败时返回结构化错误，便于前端展示具体原因
      const error = err instanceof Error ? err : new Error(String(err));
      log.error(
        { agentId, channelId, userId, title, err: error.message },
        '创建会话失败',
      );

      audit?.logEntry({
        category: 'system',
        event: 'session.created',
        sessionId: 'unknown',
        agentId,
        channelId,
        userId,
        success: false,
        error: error.message,
        details: { title },
      });

      return {
        ok: false,
        error: {
          code: 500000,
          message: `会话创建失败：${error.message}`,
          retryable: true,
        },
      };
    }
  });

  fastify.get('/api/sessions/:id', {
    schema: {
      description: '获取指定会话详情',
      tags: ['Sessions'],
    },
  }, async (request) => {
    const { id } = request.params as { id: string };
    const session = sessions.getSession(id);
    if (!session) {
      return { ok: false, error: { code: 500001, message: '会话不存在', retryable: false } };
    }

    const history = sessions.getHistory(id, 50);

    return {
      ok: true,
      data: {
        ...session,
        messageCount: history.length,
        messages: history.map((m) => ({
          messageId: m.messageId,
          content: m.content.slice(0, 500),
          role: (() => {
            const raw = m.raw;
            if (raw && typeof raw === 'object') {
              const candidate = raw as Record<string, unknown>;
              if (candidate.role === 'user' || candidate.role === 'assistant') {
                return candidate.role;
              }
              if (candidate.source === 'user' || candidate.source === 'assistant') {
                return candidate.source;
              }
            }
            return 'assistant';
          })(),
          type: m.messageType,
          timestamp: m.timestamp,
        })),
      },
    };
  });

  fastify.patch('/api/sessions/:id', {
    schema: {
      description: '更新指定会话元数据',
      tags: ['Sessions'],
      body: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          pinnedAt: { anyOf: [{ type: 'number' }, { type: 'null' }] },
          status: { type: 'string' },
          metadata: { type: 'object', additionalProperties: true },
        },
      },
    },
  }, async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      title?: string;
      pinnedAt?: number | null;
      status?: Session['status'];
      metadata?: Record<string, unknown>;
    };

    const updated = sessions.updateSession(id, body);
    if (!updated) {
      return { ok: false, error: { code: 500001, message: '会话不存在', retryable: false } };
    }

    audit?.logEntry({
      category: 'system',
      event: 'session.updated',
      sessionId: id,
      success: true,
      details: body,
    });

    // 跨端同步：向同 channel 下所有连接广播 session.updated 事件
    // 用于其他端同步标题修改、置顶、状态变更等
    if (messenger && updated.channelId) {
      const broadcastResult = messenger.broadcastToChannel(updated.channelId, {
        type: 'event',
        id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: new Date().toISOString(),
        event: 'session.updated',
        payload: {
          session: updated,
          changes: body,
          source: 'rest',
        },
      });
      log.info({ channelId: updated.channelId, sessionId: id, broadcastResult }, 'Broadcast session.updated result');
    }

    return { ok: true, data: updated };
  });

  fastify.get('/api/memory/sessions/:id', {
    schema: {
      description: '读取 memory 模块中的会话详情',
      tags: ['Sessions'],
    },
  }, async (request) => {
    const { id } = request.params as { id: string };
    const memory = runtimeAdapter?.getMemory();

    if (!memory) {
      return { ok: false, error: { code: 500001, message: 'Memory runtime unavailable', retryable: false } };
    }

    const session = await memory.session.read(id);
    if (!session) {
      return { ok: false, error: { code: 500001, message: 'Memory session not found', retryable: false } };
    }

    return {
      ok: true,
      data: {
        sessionId: session.sessionId,
        userId: session.userId,
        channelId: session.channelId,
        agentId: session.agentId,
        metadata: session.metadata,
        taskState: session.taskState ?? null,
        messages: session.messages,
      },
    };
  });

  fastify.delete('/api/sessions/:id', {
    schema: {
      description: '关闭指定会话',
      tags: ['Sessions'],
    },
  }, async (request) => {
    const { id } = request.params as { id: string };
    // 删除前先取出会话，用于获取 channelId 以便跨端广播
    const beforeDelete = sessions.getSession(id);
    const deleted = sessions.deleteSession(id);
    if (!deleted) {
      return { ok: false, error: { code: 500001, message: '会话不存在', retryable: false } };
    }

    audit?.logEntry({
      category: 'system',
      event: 'session.deleted',
      sessionId: id,
      success: true,
      details: {},
    });

    // 跨端同步：向同 channel 下所有连接广播 session.deleted 事件
    // 其他端收到后从本地列表中移除该会话
    if (messenger && beforeDelete?.channelId) {
      const broadcastResult = messenger.broadcastToChannel(beforeDelete.channelId, {
        type: 'event',
        id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: new Date().toISOString(),
        event: 'session.deleted',
        payload: {
          sessionId: id,
          channelId: beforeDelete.channelId,
          source: 'rest',
        },
      });
      log.info({ channelId: beforeDelete.channelId, sessionId: id, broadcastResult }, 'Broadcast session.deleted result');
    }

    return { ok: true, data: { sessionId: id, deleted: true } };
  });

  // ══════════════════════════════════════════════════════════════
  // 外部渠道监控 API：加载渠道历史消息 + Web 端反向推送
  // ══════════════════════════════════════════════════════════════

  /**
   * 获取指定外部渠道（qqbot/feishu/wechat）的所有历史消息
   *
   * 用于 Web 端监控会话加载历史：
   *   1. 列出该渠道下所有 session
   *   2. 合并每个 session 的消息
   *   3. 按时间排序，返回最近的 N 条
   */
  fastify.get('/api/channels/:channelId/messages', {
    schema: {
      description: '获取指定外部渠道的历史消息（跨用户聚合，用于 Web 端监控会话）',
      tags: ['Channels'],
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'number', minimum: 1, maximum: 500, default: 100 },
        },
      },
    },
  }, async (request) => {
    const { channelId } = request.params as { channelId: string };
    const query = request.query as { limit?: number };
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);

    // 1. 列出该渠道所有 session
    const channelSessions = sessions.listSessions({ channelId, includeClosed: true });

    // 2. 合并所有 session 的消息
    type AggregatedMessage = {
      messageId: string;
      sessionId: string;
      role: 'user' | 'assistant' | 'system';
      content: string;
      timestamp: number;
      userId: string;
      channelId: string;
    };

    const allMessages: AggregatedMessage[] = [];
    for (const session of channelSessions) {
      const history = sessions.getHistory(session.sessionId, 1000);
      for (const msg of history) {
        // 从 raw 中提取 role，持久化时已写入
        const raw = msg.raw as { role?: string; source?: string } | undefined;
        const role = (raw?.role as 'user' | 'assistant' | 'system') ?? 'user';
        allMessages.push({
          messageId: msg.messageId,
          sessionId: session.sessionId,
          role,
          content: msg.content,
          timestamp: msg.timestamp,
          userId: msg.userId,
          channelId: msg.channelId,
        });
      }
    }

    // 3. 按时间升序排序，截取最近 limit 条
    allMessages.sort((a, b) => a.timestamp - b.timestamp);
    const recent = allMessages.slice(-limit);

    return {
      ok: true,
      data: {
        channelId,
        total: allMessages.length,
        messages: recent,
      },
    };
  });

  /**
   * Web 端反向推送：从 Web 监控会话向外部渠道用户发送消息
   *
   * 请求体：
   *   - userId: 目标用户的渠道内 ID（必填）
   *   - chatType: 'private' | 'group'（默认 private）
   *   - groupId: 群组 ID（chatType=group 时必填）
   *   - content: 消息文本（必填）
   *
   * 实现说明：
   *   1. 通过 ChannelManager.sendToChannel 直接发送（主动消息，可能受渠道频控）
   *   2. 同时持久化到对应对话 session（不持久化到监控会话）
   *   3. 通过 messenger 广播 channel.message 事件，让 Web 端其他连接也看到这条消息
   */
  fastify.post('/api/channels/:channelId/reply', {
    schema: {
      description: 'Web 端反向推送消息到外部渠道用户',
      tags: ['Channels'],
      body: {
        type: 'object',
        required: ['userId', 'content'],
        properties: {
          userId: { type: 'string' },
          chatType: { type: 'string', enum: ['private', 'group'] },
          groupId: { type: 'string' },
          content: { type: 'string' },
        },
      },
    },
  }, async (request) => {
    const { channelId } = request.params as { channelId: string };
    const body = request.body as {
      userId: string;
      chatType?: 'private' | 'group';
      groupId?: string;
      content: string;
    };

    const chatType = body.chatType ?? 'private';
    if (chatType === 'group' && !body.groupId) {
      return {
        statusCode: 400,
        body: {
          ok: false,
          error: { code: 400001, message: '群聊消息必须提供 groupId', retryable: false },
        },
      };
    }

    // 1. 通过 ChannelManager 发送消息到目标渠道
    const manager = ChannelManager.getInstance();
    const target = chatType === 'group'
      ? { chatType: 'group' as const, groupId: body.groupId }
      : { chatType: 'private' as const, userId: body.userId };

    const sendResult = await manager.sendToChannel(channelId, target, {
      messageType: MessageType.TEXT,
      text: body.content,
      markdown: true,
      // 主动消息不带 replyToMessageId，可能受渠道频控限制
    });

    if (!sendResult.success) {
      log.error({ channelId, userId: body.userId, error: sendResult.error }, 'Web 反向推送消息失败');
      return {
        statusCode: 500,
        body: {
          ok: false,
          error: { code: 500002, message: sendResult.error ?? '发送失败', retryable: false },
        },
      };
    }

    // 2. 持久化到对应用户的 session（让渠道侧会话也有记录）
    // 使用 resolve 找到/创建该用户的会话
    try {
      const session = sessions.resolve(channelId, body.userId, 'default');
      sessions.persistMessage(session, {
        messageId: `web-reply-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        channelId,
        userId: 'web-monitor',
        content: body.content,
        messageType: 'text' as const,
        raw: { role: 'assistant', source: 'web-monitor' },
        timestamp: Date.now(),
      });
      sessions.touch(session.sessionId);

      // 3. 通过 messenger 广播 channel.message 事件，让 Web 端其他连接也看到这条消息
      if (messenger) {
        messenger.broadcastToChannel('myopenclaw', {
          type: 'event',
          id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          timestamp: new Date().toISOString(),
          event: 'channel.message',
          payload: {
            sourceChannel: channelId,
            sourceUserId: body.userId,
            sourceSessionId: session.sessionId,
            chatType,
            groupId: body.groupId,
            fromWebMonitor: true,
            message: {
              role: 'assistant',
              content: body.content,
              messageId: sendResult.platformMessageId ?? `web-reply-${Date.now()}`,
              timestamp: Date.now(),
            },
          },
        });
      }
    } catch (err) {
      // 持久化失败不影响发送结果，只记录日志
      log.warn({ err: (err as Error).message }, 'Web 反向推送消息持久化失败（不影响发送）');
    }

    audit?.logEntry({
      category: 'system',
      event: 'channel.web_reply',
      channelId,
      userId: body.userId,
      success: true,
      details: { content: body.content.slice(0, 100), chatType, platformMessageId: sendResult.platformMessageId },
    });

    return {
      ok: true,
      data: {
        success: true,
        platformMessageId: sendResult.platformMessageId,
        timestamp: sendResult.timestamp,
      },
    };
  });

  if (tokenService) {
    fastify.get('/api/tokens', {
      schema: {
        description: '列出当前用户 Token',
        tags: ['Auth'],
      },
    }, async (request) => {
      const tokens = tokenService.listTokens(request.auth?.userId);
      return {
        ok: true,
        data: {
          total: tokens.length,
          tokens: tokens.map((t) => ({
            id: t.id,
            userId: t.userId,
            scopes: t.scopes,
            createdAt: t.createdAt,
            expiresAt: t.expiresAt,
            prefix: t.prefix,
          })),
        },
      };
    });

    fastify.post('/api/tokens', {
      schema: {
        description: '创建新 Token',
        tags: ['Auth'],
        body: {
          type: 'object',
          properties: {
            scopes: { type: 'array', items: { type: 'string' } },
            expiryDays: { type: 'number' },
          },
        },
      },
    }, async (request) => {
      const { scopes, expiryDays } = request.body as { scopes?: string[]; expiryDays?: number };
      const { token, info } = tokenService.issue(
        request.auth?.userId ?? 'admin',
        scopes ?? ['session:read', 'session:write', 'message:write'],
        expiryDays,
      );
      return { ok: true, data: { token, info } };
    });

    fastify.delete('/api/tokens/:id', {
      schema: {
        description: '撤销指定 Token',
        tags: ['Auth'],
      },
    }, async (request) => {
      const { id } = request.params as { id: string };
      tokenService.revoke(id);
      return { ok: true, data: { revoked: id } };
    });
  }

  fastify.get('/api/agents', {
    schema: {
      description: '列出所有 Agent 及其状态',
      tags: ['Agents'],
      response: okResponse,
    },
  }, async () => {
    const agents = stateManager?.getSnapshot().agents;
    const agentList = agents
      ? Array.from(agents.values()).map((a) => ({
        agentId: a.agentId,
        status: a.status,
        lastActiveAt: a.lastActiveAt,
        stats: a.stats,
      }))
      : [];
    return { ok: true, data: { total: agentList.length, agents: agentList } };
  });

  fastify.get('/api/agents/:id/status', {
    schema: {
      description: '获取指定 Agent 的运行状态',
      tags: ['Agents'],
    },
  }, async (request) => {
    const { id } = request.params as { id: string };
    const agent = stateManager?.getAgentState(id);
    if (!agent) {
      return { ok: false, error: { code: 500001, message: 'Agent 不存在', retryable: false } };
    }
    return { ok: true, data: agent };
  });

  // ── 工具能力查询 ──
  fastify.get('/api/tools', {
    schema: {
      description: '列出所有已注册工具（供 CLI / Web 客户端动态发现能力）',
      tags: ['Tools'],
      querystring: {
        type: 'object',
        properties: {
          category: { type: 'string', description: '按分类过滤（如 fs、exec、http）' },
          risk: { type: 'string', enum: ['low', 'medium', 'high'] },
          builtinOnly: { type: 'boolean', description: '仅返回内置工具' },
        },
      },
      response: okResponse,
    },
  }, async (request) => {
    // 若 runtimeAdapter 未注入，返回空列表（避免崩溃）
    if (!runtimeAdapter) {
      return { ok: true, data: { total: 0, tools: [], note: 'runtimeAdapter 未注入，工具列表不可用' } };
    }

    const q = request.query as {
      category?: string;
      risk?: 'low' | 'medium' | 'high';
      builtinOnly?: boolean;
    };

    const registry = runtimeAdapter.getOrchestrator().getToolRegistry();
    // 使用 any 兼容 MockToolRegistry（inputSchema 字段）与 ToolRegistry（parameters 字段）
    let tools: any[] = registry.listAll();

    // 应用过滤条件
    if (q.category) {
      tools = tools.filter((t) => t.category === q.category);
    }
    if (q.risk) {
      tools = tools.filter((t) => t.risk === q.risk);
    }
    if (q.builtinOnly) {
      tools = tools.filter((t) => t.builtin === true);
    }

    // 标准化输出字段（兼容 Mock 与真实 Registry 的字段差异）
    const toolList = tools.map((t) => ({
      name: t.name,
      description: t.description,
      category: t.category,
      risk: t.risk ?? 'low',
      builtin: t.builtin ?? true,
      parameters: t.parameters ?? t.inputSchema ?? {},
    }));

    return { ok: true, data: { total: toolList.length, tools: toolList } };
  });

  // ── 技能能力查询 ──
  fastify.get('/api/skills', {
    schema: {
      description: '列出所有已注册技能（供 CLI / Web 客户端动态发现能力）',
      tags: ['Skills'],
      response: okResponse,
    },
  }, async () => {
    // 若 runtimeAdapter 未注入，返回空列表（避免崩溃）
    if (!runtimeAdapter) {
      return { ok: true, data: { total: 0, skills: [], note: 'runtimeAdapter 未注入，技能列表不可用' } };
    }

    const registry = runtimeAdapter.getOrchestrator().getSkillRegistry();
    // 使用 any 兼容 MockSkillRegistry 与 SkillRegistry
    const skills: any[] = registry.listAll();

    // 标准化输出字段（仅暴露元数据，不暴露 SKILL.md 全文）
    const skillList = skills.map((s) => ({
      name: s.meta?.name,
      description: s.meta?.description,
      version: s.meta?.version,
      author: s.meta?.author,
      triggers: s.meta?.triggers ?? [],
      tools: s.meta?.tools ?? [],
      requires: s.meta?.requires ?? [],
      priority: s.meta?.priority ?? 'normal',
      filePath: s.filePath,
    }));

    return { ok: true, data: { total: skillList.length, skills: skillList } };
  });

  if (audit) {
    fastify.get('/api/audit', {
      schema: {
        description: '查询审计日志',
        tags: ['Audit'],
        querystring: {
          type: 'object',
          properties: {
            category: { type: 'string' },
            startTime: { type: 'number' },
            endTime: { type: 'number' },
            limit: { type: 'number' },
          },
        },
      },
    }, async (request) => {
      const q = request.query as {
        category?: string;
        startTime?: number;
        endTime?: number;
        limit?: number;
      };
      const logs = audit.query({
        category: q.category as AuditCategoryType,
        startTime: q.startTime,
        endTime: q.endTime,
        limit: q.limit ?? 50,
      });
      return { ok: true, data: { total: logs.length, logs } };
    });
  }

  if (scheduler) {
    fastify.get('/api/scheduler/tasks', {
      schema: {
        description: '列出所有定时任务',
        tags: ['Scheduler'],
      },
    }, async () => {
      const tasks = scheduler.listTasks();
      return { ok: true, data: { total: tasks.length, tasks } };
    });
  }

  fastify.setNotFoundHandler(async (_request, reply) => {
    reply.code(404).send({ ok: false, error: { code: 100001, message: 'Not found', retryable: false } });
  });

  // PPT 制作能力模块：异步初始化后注册路由
  // 失败不阻断主流程（PPT 仅作为可选能力）
  try {
    const pptModule = await createPptModule();
    registerPptRoutes(fastify, pptModule);
    log.info('ppt module registered: /api/ppt/{themes,templates,make}');
  } catch (err) {
    log.warn({ err }, 'ppt module failed to initialize, skipping registration');
  }
}
