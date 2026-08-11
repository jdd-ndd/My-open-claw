/**
 * 跨端同步默认配置
 *
 * SHARED_CHANNEL_ID / SHARED_USER_ID：
 *   Web 端普通会话使用的统一 channelId 和 userId，所有 Web 客户端共享同一会话池
 *
 * 监控会话（Monitor Sessions）：
 *   用于同步显示外部渠道（QQBot/飞书）的对话内容
 *   - 纯前端虚拟会话，不入服务端 sessions 表
 *   - 历史通过 GET /api/channels/:channelId/messages 加载
 *   - 实时消息通过 WebSocket channel.message 事件推送
 *   - 反向发送通过 POST /api/channels/:channelId/reply
 */

export const SHARED_CHANNEL_ID = 'myopenclaw';
export const SHARED_USER_ID = 'shared-user';

/** 监控会话虚拟 sessionId（稳定值，用于前端状态管理） */
export const MONITOR_QQBOT_SESSION_ID = 'monitor-qqbot';
export const MONITOR_FEISHU_SESSION_ID = 'monitor-feishu';

/** 监控会话配置 */
export interface MonitorSessionConfig {
  /** 虚拟 sessionId */
  id: string;
  /** 显示标题 */
  title: string;
  /** 对应的外部渠道 ID */
  monitorChannel: 'qqbot' | 'feishu';
  /** SVG 图标 key（供 Sidebar 渲染渠道图标） */
  iconKey: 'qq' | 'feishu';
}

/** 所有监控会话配置列表 */
export const MONITOR_SESSIONS: MonitorSessionConfig[] = [
  {
    id: MONITOR_QQBOT_SESSION_ID,
    title: 'QQ机器人对话',
    monitorChannel: 'qqbot',
    iconKey: 'qq',
  },
  {
    id: MONITOR_FEISHU_SESSION_ID,
    title: '飞书机器人对话',
    monitorChannel: 'feishu',
    iconKey: 'feishu',
  },
];

/** 判断 sessionId 是否为监控会话 */
export function isMonitorSession(sessionId: string | undefined | null): boolean {
  if (!sessionId) return false;
  return MONITOR_SESSIONS.some((s) => s.id === sessionId);
}

/** 根据 sessionId 获取监控会话配置，非监控会话返回 null */
export function getMonitorSessionConfig(sessionId: string | undefined | null): MonitorSessionConfig | null {
  if (!sessionId) return null;
  return MONITOR_SESSIONS.find((s) => s.id === sessionId) ?? null;
}

/** 根据外部渠道 ID 获取对应监控会话配置 */
export function getMonitorSessionByChannel(channelId: string): MonitorSessionConfig | null {
  return MONITOR_SESSIONS.find((s) => s.monitorChannel === channelId) ?? null;
}
