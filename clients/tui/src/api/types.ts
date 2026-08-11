/**
 * Gateway HTTP 响应类型
 */

export interface GatewayResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export interface HealthInfo {
  ok: boolean;
  version: string;
  uptimeSec: number;
}
