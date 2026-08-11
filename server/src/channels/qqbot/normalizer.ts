/**
 * QQBot 消息归一化器
 *
 * 将 QQ Bot API v2 WebSocket 推送的 Payload 转换为统一的 InboundMessage 结构。
 *
 * QQ Bot WebSocket 推送的消息分为以下类型：
 * - op=0:  服务端推送事件（消息事件、事件通知）
 * - op=10: 连接建立成功（Hello）
 * - op=11: 心跳回复（Heartbeat ACK）
 *
 * 字段映射依据 QQ Bot 官方文档：
 * https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/send-receive/event.html
 *
 * @module @myopenclaw/server/channels/qqbot
 */

import type { InboundMessage, MessageAttachment } from '../types.js';
import { MessageType } from '../types.js';

/**
 * QQBot WebSocket Payload 消息对象类型
 *
 * QQ Bot API v2 WebSocket 协议中的 Dispatch 事件结构。
 */
export interface QQBotPayload {
  /** 操作码 */
  op: number;
  /** 事件类型（op=0 时有效） */
  t?: string;
  /** 序列号 */
  s?: number;
  /** 事件数据 */
  d?: QQBotMessageData;
}

/**
 * QQBot 消息数据
 *
 * 注意：C2C 消息和群@消息的 author 字段结构与频道消息不同：
 * - C2C_MESSAGE_CREATE:        author.user_openid
 * - GROUP_AT_MESSAGE_CREATE:   author.member_openid
 * - 频道消息:                   author.id + author.username
 */
export interface QQBotMessageData {
  /** 平台消息 ID（用于被动回复） */
  id: string;
  /** 消息作者（结构因事件类型而异） */
  author: {
    /** 用户 OpenID（频道消息使用） */
    id?: string;
    /** 用户名（频道消息使用） */
    username?: string;
    /** 用户头像 URL */
    avatar?: string;
    /** C2C 单聊用户 OpenID */
    user_openid?: string;
    /** 群成员 OpenID（群@消息使用） */
    member_openid?: string;
    /** 群成员角色：owner / admin / member */
    member_role?: string;
    /** 是否是机器人 */
    bot?: boolean;
  };
  /** 消息文本内容 */
  content: string;
  /** 时间戳（RFC3339） */
  timestamp: string;
  /** 频道 ID（频道消息使用） */
  channel_id?: string;
  /** 频道群 ID（频道群聊场景存在） */
  guild_id?: string;
  /** 群 OpenID（群@消息使用） */
  group_openid?: string;
  /** 附件列表 */
  attachments?: Array<{
    url: string;
    filename?: string;
    content_type?: string;
    width?: number;
    height?: number;
    size?: number;
  }>;
  /** 回复的消息 ID */
  message_reference?: {
    message_id: string;
  };
}

/**
 * QQBot 配置类型
 */
export interface QQBotConfig {
  /** Bot AppID */
  appId: string;
  /** Bot Token */
  botToken: string;
  /** WebSocket URL */
  wsUrl?: string;
  /** 心跳间隔（毫秒） */
  heartbeatInterval?: number;
}

/**
 * 将 QQBot Payload 归一化为 InboundMessage
 *
 * @param payload - QQ Bot WebSocket 推送的 Payload 对象
 * @returns 归一化后的消息，非消息事件返回 null
 */
export function normalizeQQBotMessage(payload: { op: number; t?: string; d?: unknown }): InboundMessage | null {
  // 调试日志：显示收到的 payload 结构
  console.log(`[QQBot Normalizer] 收到 payload: op=${payload.op}, t=${payload.t}, d=${JSON.stringify(payload.d)?.substring(0, 500)}`);

  // 只处理消息事件（op=0 且事件类型为消息创建）
  if (payload.op !== 0 || !payload.d) {
    console.log(`[QQBot Normalizer] 忽略 payload: op=${payload.op} (需要 op=0), d=${!!payload.d}`);
    return null;
  }

  // d 必须是消息数据结构
  const data = payload.d as QQBotMessageData;
  const eventType = payload.t ?? '';

  console.log(`[QQBot Normalizer] 事件类型: ${eventType}, 内容: ${data.content}`);

  // 处理不同类型的 QQBot 事件
  switch (eventType) {
    case 'MESSAGE_CREATE':
      // 频道公开消息
      return normalizeChannelMessage(data);
    case 'AT_MESSAGE_CREATE':
      // 频道 @机器人消息
      return normalizeChannelMessage(data);
    case 'DIRECT_MESSAGE_CREATE':
      // 频道私信
      return normalizeDirectMessage(data);
    case 'C2C_MESSAGE_CREATE':
      // C2C 单聊消息（QQ 客户端直接与机器人私聊）
      return normalizeC2CMessage(data);
    case 'GROUP_AT_MESSAGE_CREATE':
      // 群聊 @机器人 消息
      return normalizeGroupAtMessage(data);
    default:
      // 非消息事件，忽略 - 但记录日志以便调试
      console.log(`[QQBot Normalizer] 未知事件类型: ${eventType}`);
      return null;
  }
}

/**
 * 归一化频道消息（频道公开消息 / @机器人消息）
 *
 * 频道消息使用 author.id + author.username + channel_id + guild_id 结构。
 */
function normalizeChannelMessage(data: QQBotMessageData): InboundMessage {
  const { messageType, attachments } = extractMessageContent(data);

  // guild_id 存在则为频道群聊
  const isGroup = !!(data.guild_id);

  return {
    messageId: `qq_${data.id}`,
    platformMessageId: data.id,
    channelId: 'qqbot',
    userId: data.author.id ?? 'unknown',
    username: data.author.username ?? 'unknown',
    chatType: isGroup ? 'group' : 'private',
    groupId: isGroup ? data.guild_id : undefined,
    messageType,
    text: data.content || undefined,
    attachments: attachments.length > 0 ? attachments : undefined,
    replyToMessageId: data.message_reference?.message_id,
    raw: data,
    timestamp: new Date(data.timestamp).getTime(),
  };
}

/**
 * 归一化频道私信（DIRECT_MESSAGE_CREATE 事件）
 */
function normalizeDirectMessage(data: QQBotMessageData): InboundMessage {
  const { messageType, attachments } = extractMessageContent(data);

  return {
    messageId: `qq_dm_${data.id}`,
    platformMessageId: data.id,
    channelId: 'qqbot',
    userId: data.author.id ?? 'unknown',
    username: data.author.username ?? 'unknown',
    chatType: 'private',
    messageType,
    text: data.content || undefined,
    attachments: attachments.length > 0 ? attachments : undefined,
    replyToMessageId: data.message_reference?.message_id,
    raw: data,
    timestamp: new Date(data.timestamp).getTime(),
  };
}

/**
 * 归一化 C2C 单聊消息（C2C_MESSAGE_CREATE 事件）
 *
 * 用户在 QQ 客户端直接与机器人私聊的场景。
 * 字段结构与频道消息不同：author.user_openid（没有 username）。
 */
function normalizeC2CMessage(data: QQBotMessageData): InboundMessage {
  const { messageType, attachments } = extractMessageContent(data);
  const userOpenid = data.author.user_openid ?? 'unknown';

  return {
    messageId: `qq_c2c_${data.id}`,
    platformMessageId: data.id,
    channelId: 'qqbot',
    userId: userOpenid,
    // C2C 消息没有 username 字段，使用 user_openid 作为显示名
    username: userOpenid,
    displayName: userOpenid,
    chatType: 'private',
    messageType,
    text: data.content || undefined,
    attachments: attachments.length > 0 ? attachments : undefined,
    replyToMessageId: data.message_reference?.message_id,
    raw: data,
    timestamp: new Date(data.timestamp).getTime(),
  };
}

/**
 * 归一化群聊 @机器人消息（GROUP_AT_MESSAGE_CREATE 事件）
 *
 * 字段结构：author.member_openid + group_openid（没有 username，没有 guild_id）。
 */
function normalizeGroupAtMessage(data: QQBotMessageData): InboundMessage {
  const { messageType, attachments } = extractMessageContent(data);
  const memberOpenid = data.author.member_openid ?? 'unknown';
  const groupOpenid = data.group_openid;

  return {
    messageId: `qq_group_at_${data.id}`,
    platformMessageId: data.id,
    channelId: 'qqbot',
    userId: memberOpenid,
    // 群@消息没有 username 字段，使用 member_openid 作为显示名
    username: memberOpenid,
    displayName: memberOpenid,
    chatType: 'group',
    // 群聊场景使用 group_openid，发送回复时也用它
    groupId: groupOpenid,
    messageType,
    text: data.content || undefined,
    attachments: attachments.length > 0 ? attachments : undefined,
    replyToMessageId: data.message_reference?.message_id,
    raw: data,
    timestamp: new Date(data.timestamp).getTime(),
  };
}

/**
 * 从消息数据中提取类型和附件
 */
function extractMessageContent(data: QQBotMessageData): {
  messageType: MessageType;
  attachments: MessageAttachment[];
} {
  let messageType: MessageType = MessageType.TEXT;
  const attachments: MessageAttachment[] = [];

  if (data.attachments && data.attachments.length > 0) {
    for (const att of data.attachments) {
      if (att.content_type?.startsWith('image/')) {
        messageType = MessageType.IMAGE;
        attachments.push({
          type: 'image',
          url: att.url,
          filename: att.filename,
          width: att.width,
          height: att.height,
          size: att.size,
          mimeType: att.content_type,
        });
      } else if (att.content_type?.startsWith('audio/')) {
        messageType = MessageType.AUDIO;
        attachments.push({
          type: 'audio',
          url: att.url,
          filename: att.filename,
          size: att.size,
          mimeType: att.content_type,
        });
      } else if (att.content_type?.startsWith('video/')) {
        messageType = MessageType.VIDEO;
        attachments.push({
          type: 'video',
          url: att.url,
          filename: att.filename,
          width: att.width,
          height: att.height,
          size: att.size,
          mimeType: att.content_type,
        });
      } else {
        messageType = MessageType.FILE;
        attachments.push({
          type: 'file',
          url: att.url,
          filename: att.filename,
          size: att.size,
          mimeType: att.content_type,
        });
      }
    }
  }

  return { messageType, attachments };
}

/**
 * 判断 Payload 是否为 QQBot Hello 事件（op=10 且无 t 字段）
 *
 * QQ Bot WebSocket 协议中，Hello 事件没有 t 字段：
 * { op: 10, d: { heartbeat_interval: 4125 } }
 *
 * 而 READY 事件有 t='READY' 字段：
 * { op: 0, t: 'READY', d: { ... } }
 *
 * 注意：READY 实际是 Dispatch(op=0) 事件，不是 op=10。
 */
export function isQQBotHello(payload: QQBotPayload): boolean {
  return payload.op === 10 && !payload.t;
}

/**
 * 判断 Payload 是否为 QQBot READY 事件（op=0，且 t=READY）
 *
 * READY 事件在 IDENTIFY 认证成功后由服务端发送，
 * 实际协议中 READY 是作为 Dispatch(op=0) 事件下发的，
 * 包含 session_id、user、shard 等信息。
 * 客户端收到 READY 后才算真正认证成功，可以开始心跳。
 */
export function isQQBotReady(payload: QQBotPayload): boolean {
  return payload.op === 0 && payload.t === 'READY';
}

/**
 * 判断 Payload 是否为 QQBot 心跳确认（op=11）
 */
export function isQQBotHeartbeatAck(payload: QQBotPayload): boolean {
  return payload.op === 11;
}

/**
 * 判断 Payload 是否为 RESUMED 事件（op=0，t=RESUMED）
 *
 * 当客户端使用 session_id 进行 RESUME 操作成功后，服务端会发送此事件。
 */
export function isQQBotResumed(payload: QQBotPayload): boolean {
  return payload.op === 0 && payload.t === 'RESUMED';
}
