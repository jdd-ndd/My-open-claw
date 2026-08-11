/**
 * 路线规划工具模块
 *
 * 暴露三个内置工具供 Agent 调用：
 *   - routing/geocode  ：将地名转换为经纬度
 *   - routing/plan     ：起终点 -> 详细路线（距离/时长/步骤）
 *
 * 所有工具均为 low risk（只读上游 API），属于 builtin 工具集。
 *
 * @module @myopenclaw/server/tools/routing
 */

import type { InvokeContext, JSONSchema, Tool, ToolResult } from '../../core/types/index.js';
import {
  RoutingService,
  RoutingServiceError,
  type RoutingProfile,
} from '../../services/routing.js';

const routingService = new RoutingService();

/** 路线规划工具基类，统一处理错误格式 */
abstract class RoutingToolBase implements Tool {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly parameters: JSONSchema;
  readonly category = 'routing';
  readonly risk: 'low' | 'medium' | 'high' = 'low';
  readonly builtin = true;

  protected formatError(error: unknown, startedAt: number): ToolResult {
    if (error instanceof RoutingServiceError) {
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
      error: error instanceof Error ? error.message : 'Unknown routing error',
      errorCode: 'ROUTING_TOOL_ERROR',
      metadata: {
        durationMs: Date.now() - startedAt,
        sideEffects: [],
      },
    };
  }

  abstract execute(params: Record<string, unknown>, context: InvokeContext): Promise<ToolResult>;
}

/** 地理编码工具：将地名转换为经纬度 */
export class RoutingGeocodeTool extends RoutingToolBase {
  readonly name = 'routing/geocode';
  readonly description = 'Convert a place name (e.g. 北京天安门) to latitude/longitude before planning a route.';
  readonly parameters: JSONSchema = {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Place name to geocode, supports Chinese and English, e.g. "上海外滩".',
      },
    },
    required: ['query'],
  };

  async execute(params: Record<string, unknown>, _context: InvokeContext): Promise<ToolResult> {
    const startedAt = Date.now();
    try {
      const query = typeof params.query === 'string' ? params.query : '';
      const endpoint = await routingService.geocode(query);

      return {
        success: true,
        status: 'success',
        data: endpoint,
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

/** 路线规划工具：根据起终点和出行方式生成详细路径 */
export class RoutingPlanTool extends RoutingToolBase {
  readonly name = 'routing/plan';
  readonly description = 'Plan a detailed route between two places, including distance, duration, geometry, and turn-by-turn steps.';
  readonly parameters: JSONSchema = {
    type: 'object',
    properties: {
      origin: {
        type: 'string',
        description: 'Origin place name, e.g. "北京天安门".',
      },
      destination: {
        type: 'string',
        description: 'Destination place name, e.g. "上海外滩".',
      },
      profile: {
        type: 'string',
        enum: ['driving', 'walking', 'cycling'],
        description: 'Travel mode: driving (default), walking, cycling.',
        default: 'driving',
      },
    },
    required: ['origin', 'destination'],
  };

  async execute(params: Record<string, unknown>, _context: InvokeContext): Promise<ToolResult> {
    const startedAt = Date.now();
    try {
      const origin = typeof params.origin === 'string' ? params.origin : '';
      const destination = typeof params.destination === 'string' ? params.destination : '';
      const profileInput = typeof params.profile === 'string' ? params.profile : 'driving';

      // 校验出行方式
      const validProfiles: RoutingProfile[] = ['driving', 'walking', 'cycling'];
      const profile: RoutingProfile = validProfiles.includes(profileInput as RoutingProfile)
        ? (profileInput as RoutingProfile)
        : 'driving';

      const plan = await routingService.planRoute(origin, destination, profile);

      return {
        success: true,
        status: 'success',
        data: plan,
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
