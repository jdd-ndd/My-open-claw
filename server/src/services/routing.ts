/**
 * 路线规划服务（RoutingService）
 *
 * 使用开源 OSRM 公共 API 提供驾车/步行路线规划能力：
 *   - 地理编码：地名 -> 经纬度（复用 Open-Meteo Geocoding）
 *   - 路线规划：起终点经纬度 -> 距离/时长/步骤化路径
 *
 * 所有上游接口均不需要 API Key，适合本地开发与现场验证。
 *
 * @module @myopenclaw/server/services/routing
 */

/** 地理坐标点 */
export interface GeoCoordinate {
  latitude: number;
  longitude: number;
}

/** 路线规划起终点描述 */
export interface RoutingEndpoint {
  /** 显示名称（如"北京天安门"） */
  name: string;
  /** 经纬度 */
  coordinate: GeoCoordinate;
}

/** 路线规划步骤 */
export interface RoutingStep {
  /** 步骤序号（从 1 开始） */
  index: number;
  /** 路段描述（如"向东行驶 200 米"） */
  instruction: string;
  /** 路段距离（米） */
  distanceMeters: number;
  /** 路段时长（秒） */
  durationSeconds: number;
  /** 该路段结束点坐标 */
  coordinate: GeoCoordinate | null;
}

/** 路线规划返回结构 */
export interface RoutingPlanResult {
  /** 起点信息 */
  origin: RoutingEndpoint;
  /** 终点信息 */
  destination: RoutingEndpoint;
  /** 出行方式：driving / walking / cycling */
  profile: RoutingProfile;
  /** 总距离（米） */
  totalDistanceMeters: number;
  /** 总时长（秒） */
  totalDurationSeconds: number;
  /** 路线几何（GeoJSON LineString 坐标序列） */
  geometry: GeoCoordinate[];
  /** 分段步骤（最多 30 段，超出会被截断） */
  steps: RoutingStep[];
}

/** OSRM 支持的出行方式 */
export type RoutingProfile = 'driving' | 'walking' | 'cycling';

/** 路线规划服务异常 */
export class RoutingServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode = 500,
  ) {
    super(message);
    this.name = 'RoutingServiceError';
  }
}

// ── 上游响应类型 ──
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

interface OsrmRouteResponse {
  code?: string;
  message?: string;
  routes?: Array<{
    distance?: number; // 单位：米
    duration?: number; // 单位：秒
    geometry?: {
      coordinates?: Array<[number, number]>; // [lng, lat]
    };
    legs?: Array<{
      steps?: Array<{
        distance?: number;
        duration?: number;
        geometry?: {
          coordinates?: Array<[number, number]>;
        };
        maneuver?: {
          type?: string;
          modifier?: string;
          bearing_after?: number;
        };
        name?: string;
      }>;
    }>;
  }>;
}

// ── 常量 ──
const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const OSRM_BASE_URL = 'https://router.project-osrm.org';

/** 支持的出行方式与对应 OSRM profile */
const PROFILE_MAP: Record<RoutingProfile, string> = {
  driving: 'driving',
  walking: 'foot',
  cycling: 'bike',
};

/** 距离/时长格式化为人类可读字符串 */
export function formatDistance(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(2)} 公里`;
  }
  return `${Math.round(meters)} 米`;
}

export function formatDuration(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes} 分钟`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours} 小时 ${minutes} 分钟` : `${hours} 小时`;
}

/** 通用 fetch JSON 工具函数 */
async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'myopenclaw-routing/1.0',
    },
  });

  if (!response.ok) {
    throw new RoutingServiceError(
      `Routing upstream request failed with status ${response.status}`,
      'ROUTING_UPSTREAM_ERROR',
      502,
    );
  }

  return response.json() as Promise<T>;
}

/** 构造地名展示标签 */
function buildLocationLabel(location: {
  name: string;
  admin1?: string;
  country?: string;
}): string {
  return [location.name, location.admin1, location.country].filter(Boolean).join(', ');
}

/** OSRM maneuver 类型与中文描述映射 */
function describeManeuver(
  maneuver: { type?: string; modifier?: string } | undefined,
  roadName: string | undefined,
): string {
  if (!maneuver) {
    return roadName ? `沿 ${roadName} 行进` : '继续前行';
  }

  const modifierMap: Record<string, string> = {
    left: '向左',
    right: '向右',
    'slight left': '稍向左',
    'slight right': '稍向右',
    'sharp left': '向左急转',
    'sharp right': '向右急转',
    straight: '直行',
    uturn: '掉头',
  };

  const typeMap: Record<string, string> = {
    turn: '转弯',
    'new name': '进入',
    depart: '出发',
    arrive: '到达',
    merge: '汇入',
    'on ramp': '上匝道',
    'off ramp': '下匝道',
    fork: '岔路口',
    'end of road': '道路尽头',
    continue: '继续直行',
    roundabout: '进入环岛',
    'rotary': '进入环岛',
  };

  const modifierKey = maneuver.modifier;
  const typeKey = maneuver.type;
  const modifier = modifierKey ? (modifierMap[modifierKey] ?? '') : '';
  const type = typeKey ? (typeMap[typeKey] ?? '行进') : '行进';
  const road = roadName && roadName.trim() ? `（${roadName}）` : '';

  if (maneuver.type === 'depart') {
    return `出发${road}`;
  }
  if (maneuver.type === 'arrive') {
    return `到达目的地${road}`;
  }
  if (modifier) {
    return `${modifier}${type}${road}`;
  }
  return `${type}${road}`;
}

/**
 * 路线规划服务主类
 *
 * 使用方法：
 *   const service = new RoutingService();
 *   const plan = await service.planRoute('北京天安门', '上海外滩', 'driving');
 */
export class RoutingService {
  /**
   * 地理编码：将地名转换为经纬度坐标
   * 复用 Open-Meteo Geocoding API，与天气模块保持一致
   */
  async geocode(query: string): Promise<RoutingEndpoint> {
    const normalized = query.trim();
    if (!normalized) {
      throw new RoutingServiceError('Location query is required', 'ROUTING_QUERY_REQUIRED', 400);
    }

    const url = `${GEOCODE_URL}?name=${encodeURIComponent(normalized)}&count=1&language=zh&format=json`;
    const data = await fetchJson<OpenMeteoGeocodeResponse>(url);
    const first = data.results?.[0];

    if (!first) {
      throw new RoutingServiceError(
        `Location not found for "${normalized}"`,
        'ROUTING_LOCATION_NOT_FOUND',
        404,
      );
    }

    return {
      name: buildLocationLabel(first),
      coordinate: {
        latitude: first.latitude,
        longitude: first.longitude,
      },
    };
  }

  /**
   * 批量地理编码：用于多途径点的场景
   */
  async geocodeMany(queries: string[]): Promise<RoutingEndpoint[]> {
    return Promise.all(queries.map((q) => this.geocode(q)));
  }

  /**
   * 路线规划：根据起终点名称和出行方式生成详细路径
   *
   * @param origin 起点名称（中文/英文均可）
   * @param destination 终点名称
   * @param profile 出行方式：driving(默认) / walking / cycling
   */
  async planRoute(
    origin: string,
    destination: string,
    profile: RoutingProfile = 'driving',
  ): Promise<RoutingPlanResult> {
    const startedAt = Date.now();
    void startedAt;

    // 1. 并行解析起终点经纬度
    const [originEndpoint, destinationEndpoint] = await Promise.all([
      this.geocode(origin),
      this.geocode(destination),
    ]);

    // 2. 调用 OSRM 路线规划 API
    const osrmProfile = PROFILE_MAP[profile];
    const coordStr = `${originEndpoint.coordinate.longitude},${originEndpoint.coordinate.latitude};${destinationEndpoint.coordinate.longitude},${destinationEndpoint.coordinate.latitude}`;
    const url = `${OSRM_BASE_URL}/route/v1/${osrmProfile}/${coordStr}?overview=full&geometries=geojson&steps=true&annotations=false`;

    const data = await fetchJson<OsrmRouteResponse>(url);

    if (data.code && data.code !== 'Ok') {
      throw new RoutingServiceError(
        data.message || `OSRM routing failed: ${data.code}`,
        'ROUTING_PLAN_FAILED',
        502,
      );
    }

    const route = data.routes?.[0];
    if (!route) {
      throw new RoutingServiceError('No route found between origin and destination', 'ROUTING_NO_ROUTE', 404);
    }

    // 3. 解析路线几何坐标（[lng, lat] -> {latitude, longitude}）
    const geometry: GeoCoordinate[] = (route.geometry?.coordinates ?? []).map(([lng, lat]) => ({
      latitude: lat,
      longitude: lng,
    }));

    // 4. 解析步骤化路径
    const rawSteps = route.legs?.flatMap((leg) => leg.steps ?? []) ?? [];
    const steps: RoutingStep[] = rawSteps.slice(0, 30).map((step, index) => {
      const lastCoord = step.geometry?.coordinates?.[step.geometry.coordinates.length - 1];
      return {
        index: index + 1,
        instruction: describeManeuver(step.maneuver, step.name),
        distanceMeters: step.distance ?? 0,
        durationSeconds: step.duration ?? 0,
        coordinate: lastCoord
          ? { latitude: lastCoord[1], longitude: lastCoord[0] }
          : null,
      };
    });

    return {
      origin: originEndpoint,
      destination: destinationEndpoint,
      profile,
      totalDistanceMeters: route.distance ?? 0,
      totalDurationSeconds: route.duration ?? 0,
      geometry,
      steps,
    };
  }
}
