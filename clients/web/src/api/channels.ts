/**
 * 外部渠道监控 API
 *
 * 用于 Web 端监控会话加载历史消息和反向推送消息到外部渠道（QQBot/飞书）用户
 */
import { httpClient } from './http';

/** 渠道历史消息（跨用户聚合） */
export interface ChannelMessage {
  messageId: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  userId: string;
  channelId: string;
}

/** 渠道历史消息响应 */
export interface ChannelMessagesResponse {
  channelId: string;
  total: number;
  messages: ChannelMessage[];
}

/**
 * 获取指定外部渠道的历史消息
 *
 * @param channelId - 渠道 ID（qqbot/feishu/wechat）
 * @param limit - 返回消息数量上限（默认 100，最大 500）
 */
export async function fetchChannelMessages(
  channelId: string,
  limit = 100,
): Promise<ChannelMessagesResponse> {
  return httpClient.get(`/channels/${channelId}/messages`, {
    params: { limit },
  }) as Promise<ChannelMessagesResponse>;
}

/** 反向推送请求体 */
export interface ChannelReplyRequest {
  /** 目标用户的渠道内 ID */
  userId: string;
  /** 聊天类型，默认 private */
  chatType?: 'private' | 'group';
  /** 群组 ID（chatType=group 时必填） */
  groupId?: string;
  /** 消息文本 */
  content: string;
}

/** 反向推送响应 */
export interface ChannelReplyResponse {
  success: boolean;
  platformMessageId?: string;
  timestamp: number;
}

/**
 * 从 Web 端向外部渠道用户反向推送消息
 *
 * @param channelId - 渠道 ID（qqbot/feishu/wechat）
 * @param payload - 请求体
 */
export async function replyToChannelUser(
  channelId: string,
  payload: ChannelReplyRequest,
): Promise<ChannelReplyResponse> {
  return httpClient.post(`/channels/${channelId}/reply`, payload) as Promise<ChannelReplyResponse>;
}
