/**
 * 微信消息归一化器
 *
 * 将微信公众平台/企业微信回调消息转换为统一的 InboundMessage 结构。
 * 支持 XML 格式（公众号回调）和 JSON 格式（企业微信 API）。
 *
 * @module @myopenclaw/server/channels/wechat
 */

import type { InboundMessage, MessageAttachment } from '../types.js';
import { MessageType } from '../types.js';

/**
 * 微信回调消息 XML 解析后的对象类型
 */
export interface WeChatMessage {
  /** 开发者微信号 */
  ToUserName: string;
  /** 发送方账号（用户 OpenID） */
  FromUserName: string;
  /** 消息创建时间（Unix 秒级时间戳） */
  CreateTime: number;
  /** 消息类型 */
  MsgType: string;
  /** 消息 ID */
  MsgId?: string;
  /** 消息数据 ID（企业微信） */
  MsgDataId?: string;
  /** 文本消息内容 */
  Content?: string;
  /** 媒体文件 ID */
  MediaId?: string;
  /** 图片链接 */
  PicUrl?: string;
  /** 语音格式 */
  Format?: string;
  /** 语音识别结果 */
  Recognition?: string;
  /** 视频/小视频缩略图 MediaId */
  ThumbMediaId?: string;
  /** 地理位置纬度 */
  Location_X?: string;
  /** 地理位置经度 */
  Location_Y?: string;
  /** 地图缩放大小 */
  Scale?: string;
  /** 地理位置信息 */
  Label?: string;
  /** 消息标题（链接消息） */
  Title?: string;
  /** 消息描述（链接消息） */
  Description?: string;
  /** 消息链接（链接消息） */
  Url?: string;
  /** 事件类型 */
  Event?: string;
  /** 事件 Key */
  EventKey?: string;
  /** 企业微信：应用 AgentID */
  AgentID?: string;
  /** 事件消息：纬度 */
  Latitude?: string;
  /** 事件消息：经度 */
  Longitude?: string;
  /** 事件消息：位置精度 */
  Precision?: string;
}

/**
 * 企业微信 JSON 格式消息类型
 */
export interface WeComJsonMessage {
  ToUserName: string;
  FromUserName: string;
  CreateTime: string;
  MsgType: string;
  MsgId?: string;
  AgentID?: number;
  Content?: string;
  MediaId?: string;
  PicUrl?: string;
  Format?: string;
  FileName?: string;
}

/**
 * 将微信回调消息归一化为 InboundMessage
 *
 * @param msg - 微信回调消息对象
 * @param mode - 模式：'webhook'（公众号）、'wecom'（企业微信）、'miniprogram'（小程序）
 * @returns 归一化后的消息，无法识别返回 null
 */
export function normalizeWeChatMessage(
  msg: WeChatMessage,
  mode: 'webhook' | 'wecom' | 'miniprogram' = 'webhook',
): InboundMessage | null {
  // 事件消息与普通消息分别处理
  if (msg.MsgType === 'event') {
    return normalizeWeChatEvent(msg);
  }

  let messageType: MessageType = MessageType.TEXT;
  let text: string | undefined = msg.Content;
  let attachments: MessageAttachment[] | undefined;

  switch (msg.MsgType) {
    case 'text':
      messageType = MessageType.TEXT;
      text = msg.Content;
      break;

    case 'image':
      messageType = MessageType.IMAGE;
      attachments = [{
        type: 'image',
        url: msg.PicUrl || msg.MediaId || '',
      }];
      break;

    case 'voice':
      messageType = MessageType.AUDIO;
      attachments = [{
        type: 'audio',
        url: msg.MediaId || '',
      }];
      // 如果有语音识别结果，作为文本附上
      if (msg.Recognition) {
        text = msg.Recognition;
      }
      break;

    case 'video':
    case 'shortvideo':
      messageType = MessageType.VIDEO;
      attachments = [{
        type: 'video',
        url: msg.MediaId || '',
        thumbnailUrl: msg.ThumbMediaId,
      }];
      break;

    case 'file':
      messageType = MessageType.FILE;
      attachments = [{
        type: 'file',
        url: msg.MediaId || '',
      }];
      break;

    case 'location':
      messageType = MessageType.LOCATION;
      text = [
        `位置: ${msg.Label || '未知'}`,
        `纬度: ${msg.Location_X || '?'}, 经度: ${msg.Location_Y || '?'}`,
      ].join('\n');
      break;

    case 'link':
      messageType = MessageType.TEXT;
      text = [
        msg.Title ? `[${msg.Title}]` : '[链接]',
        msg.Description || '',
        msg.Url || '',
      ].filter(Boolean).join('\n');
      break;

    default:
      messageType = MessageType.TEXT;
      text = `[不支持的消息类型: ${msg.MsgType}]`;
  }

  const messageId = msg.MsgId || msg.MsgDataId || `wx_${Date.now()}`;

  // 根据模式确定 channelId
  const channelId = mode === 'wecom' ? 'wechat_wecom' : (mode === 'miniprogram' ? 'wechat_mini' : 'wechat');

  return {
    messageId: `wx_${messageId}`,
    channelId,
    userId: msg.FromUserName,
    username: msg.FromUserName,
    chatType: 'private',
    messageType,
    text,
    attachments,
    raw: msg,
    // 微信时间戳为秒，转为毫秒
    timestamp: msg.CreateTime * 1000,
  };
}

/**
 * 归一化微信事件消息
 */
function normalizeWeChatEvent(msg: WeChatMessage): InboundMessage | null {
  const eventType = msg.Event || 'unknown';
  let text = '';

  switch (eventType) {
    case 'subscribe':
      text = '[关注事件]';
      break;
    case 'unsubscribe':
      text = '[取关事件]';
      break;
    case 'SCAN':
      text = `[扫码事件] ${msg.EventKey || ''}`;
      break;
    case 'LOCATION':
      text = `[位置上报] 纬度: ${msg.Latitude || '?'}, 经度: ${msg.Longitude || '?'}`;
      break;
    case 'CLICK':
      text = `[菜单点击] ${msg.EventKey || ''}`;
      break;
    case 'VIEW':
      text = `[菜单跳转] ${msg.EventKey || ''}`;
      break;
    case 'enter_agent':
      text = '[进入应用]';
      break;
    default:
      text = `[事件: ${eventType}]`;
  }

  const messageId = msg.MsgId || `wx_event_${Date.now()}`;

  return {
    messageId: `wx_${messageId}`,
    channelId: 'wechat',
    userId: msg.FromUserName,
    username: msg.FromUserName,
    chatType: 'private',
    messageType: MessageType.TEXT,
    text,
    raw: msg,
    timestamp: msg.CreateTime * 1000,
  };
}

/**
 * 解析微信 XML 消息为 JavaScript 对象（简易实现）
 *
 * 在生产环境中建议使用 fast-xml-parser 等专业 XML 解析库。
 *
 * @param xml - XML 字符串
 * @returns 解析后的对象
 */
export function parseWeChatXml(xml: string): Record<string, string> {
  const result: Record<string, string> = {};

  // 移除根级 <xml> 包裹标签，避免正则匹配到整个文档
  let cleanXml = xml.trim();
  if (cleanXml.startsWith('<xml>') && cleanXml.endsWith('</xml>')) {
    cleanXml = cleanXml.slice(5, -6);
  }

  const tagRegex = /<(\w+)><!\[CDATA\[(.*?)\]\]><\/\1>/gs;
  const simpleTagRegex = /<(\w+)>(.*?)<\/\1>/g;

  // 匹配 CDATA 标签
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(cleanXml)) !== null) {
    result[match[1]] = match[2];
  }

  // 匹配普通标签
  while ((match = simpleTagRegex.exec(cleanXml)) !== null) {
    // 跳过已由 CDATA 匹配的键和复合结构
    if (!result[match[1]] && !match[2].startsWith('<')) {
      result[match[1]] = match[2];
    }
  }

  return result;
}
