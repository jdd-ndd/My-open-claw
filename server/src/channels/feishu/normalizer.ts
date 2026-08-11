/**
 * 飞书消息归一化器
 *
 * 将飞书开放平台事件回调 JSON 转换为统一的 InboundMessage 结构。
 *
 * @module @myopenclaw/server/channels/feishu
 */

import type { InboundMessage, MessageAttachment } from '../types.js';
import { MessageType } from '../types.js';

/**
 * 飞书事件回调对象类型（简化定义）
 *
 * 支持两种格式：
 * 1. Webhook 格式: { header: {...}, event: { message: ..., sender: ... } }
 * 2. SDK 长连接格式: { message: ..., sender: ... }
 */
export interface FeishuEvent {
  schema?: string;
  header?: {
    event_id: string;
    event_type: string;
    create_time: string;
  };
  event?: {
    sender: {
      sender_id: { open_id: string; union_id?: string };
      sender_type?: string;
    };
    message: {
      message_id: string;
      chat_id: string;
      chat_type: 'p2p' | 'group';
      message_type: string;
      content: string;
      create_time: string;
    };
  };
  // SDK 长连接直接传递 message 和 sender（无外层 event 包装）
  message?: {
    message_id: string;
    chat_id: string;
    chat_type: 'p2p' | 'group';
    message_type: string;
    content: string;
    create_time: string;
  };
  sender?: {
    sender_id: { open_id: string; union_id?: string };
    sender_type?: string;
  };
}

/**
 * 将飞书事件回调归一化为 InboundMessage
 *
 * 兼容两种事件格式：
 * 1. Webhook 格式: event.event.message / event.event.sender
 * 2. SDK 长连接格式: event.message / event.sender
 *
 * @param event - 飞书事件对象
 * @returns 归一化后的消息，无法解析返回 null
 */
export function normalizeFeishuMessage(event: FeishuEvent): InboundMessage | null {
  // 兼容两种格式：优先使用 Webhook 格式 (event.event)，其次使用 SDK 格式 (event.message)
  const msg = event.event?.message || event.message;
  const sender = event.event?.sender || event.sender;

  if (!msg || !sender) {
    return null;  // 无法解析的事件格式
  }

  // 解析消息 content（飞书消息内容为 JSON 字符串）
  let contentObj: Record<string, unknown>;
  try {
    contentObj = JSON.parse(msg.content);
  } catch {
    return null;
  }

  let messageType: MessageType = MessageType.TEXT;
  let text: string | undefined;
  let attachments: MessageAttachment[] | undefined;

  switch (msg.message_type) {
    case 'text':
      messageType = MessageType.TEXT;
      text = (contentObj.text as string) || '';
      break;

    case 'image':
      messageType = MessageType.IMAGE;
      attachments = [{
        type: 'image',
        url: (contentObj.image_key as string) || '',
      }];
      break;

    case 'file':
      messageType = MessageType.FILE;
      attachments = [{
        type: 'file',
        url: (contentObj.file_key as string) || '',
        filename: contentObj.file_name as string | undefined,
      }];
      break;

    case 'audio':
      messageType = MessageType.AUDIO;
      attachments = [{
        type: 'audio',
        url: (contentObj.file_key as string) || '',
        duration: contentObj.duration as number | undefined,
      }];
      break;

    case 'media':
      // 富媒体消息，尝试提取其中的文本
      messageType = MessageType.TEXT;
      text = extractFeishuMediaText(contentObj);
      break;

    case 'post':
      // 富文本消息，提取纯文本
      messageType = MessageType.TEXT;
      text = extractFeishuPostText(contentObj);
      break;

    case 'interactive':
      // 交互式卡片消息
      messageType = MessageType.TEXT;
      text = `[交互卡片] ${extractFeishuInteractiveText(contentObj)}`;
      break;

    case 'sticker':
      messageType = MessageType.STICKER;
      text = `[贴纸] ${(contentObj.file_key as string) || ''}`;
      break;

    default:
      messageType = MessageType.TEXT;
      text = `[不支持的消息类型: ${msg.message_type}]`;
      break;
  }

  return {
    messageId: `fs_${msg.message_id}`,
    channelId: 'feishu',
    userId: sender.sender_id.open_id,
    username: sender.sender_id.open_id,
    chatType: msg.chat_type === 'p2p' ? 'private' : 'group',
    groupId: msg.chat_type === 'group' ? msg.chat_id : undefined,
    messageType,
    text,
    attachments,
    raw: event,
    timestamp: parseInt(msg.create_time, 10),
  };
}

/**
 * 从飞书富文本（Post）消息中提取纯文本
 */
export function extractFeishuPostText(content: Record<string, unknown>): string {
  const texts: string[] = [];

  // 遍历多语言内容
  const locales = ['zh_cn', 'en_us', 'ja_jp'];
  for (const locale of locales) {
    const localeContent = content[locale];
    if (localeContent && typeof localeContent === 'object') {
      const postContent = localeContent as {
        title?: string;
        content?: Array<Array<{ tag: string; text?: string; [key: string]: unknown }>>;
      };

      if (postContent.title) {
        texts.push(postContent.title);
      }

      if (postContent.content) {
        for (const paragraph of postContent.content) {
          const paragraphTexts: string[] = [];
          for (const node of paragraph) {
            if (node.tag === 'text' && node.text) {
              paragraphTexts.push(node.text);
            } else if (node.tag === 'a' && node.text) {
              paragraphTexts.push(node.text);
            } else if (node.tag === 'at') {
              paragraphTexts.push(`@${(node as Record<string, unknown>).user_name || 'unknown'}`);
            } else if (node.tag === 'img') {
              paragraphTexts.push('[图片]');
            }
          }
          if (paragraphTexts.length > 0) {
            texts.push(paragraphTexts.join(''));
          }
        }
      }

      // 使用第一个可用的语言内容
      if (texts.length > 0) break;
    }
  }

  return texts.join('\n') || '[空富文本]';
}

/**
 * 从飞书富媒体消息中提取文本
 */
function extractFeishuMediaText(content: Record<string, unknown>): string {
  const texts: string[] = [];
  if (content.title) {
    texts.push(`标题: ${content.title}`);
  }
  if (content.description) {
    texts.push(`描述: ${content.description}`);
  }
  return texts.join('\n') || '[富媒体消息]';
}

/**
 * 从交互式卡片中提取文本
 */
function extractFeishuInteractiveText(content: Record<string, unknown>): string {
  // 尝试从卡片配置中提取标题和文本
  const card = (content.card || content) as Record<string, unknown>;
  const header = card.header as Record<string, unknown> | undefined;
  const title = header?.title as Record<string, string> | undefined;

  if (title?.content) {
    return title.content;
  }

  // 尝试提取元素中的文本
  const elements = card.elements as Array<Record<string, unknown>> | undefined;
  if (elements) {
    const texts: string[] = [];
    for (const elem of elements) {
      const elemTag = elem.tag as string;
      if (elemTag === 'markdown' || elemTag === 'plain_text') {
        texts.push((elem.content as string) || '');
      } else if (elemTag === 'div') {
        // 递归处理 div 内的文本
        const fieldText = elem.text as Record<string, string> | undefined;
        if (fieldText?.content) {
          texts.push(fieldText.content);
        }
      }
    }
    if (texts.length > 0) return texts.join('\n');
  }

  return '[交互卡片]';
}
