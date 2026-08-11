/**
 * 消息归一化器单元测试
 *
 * @module server/tests/unit/channels
 */

import { describe, it, expect } from 'vitest';
import { normalizeQQBotMessage, isQQBotHello, isQQBotHeartbeatAck } from '../../../src/channels/qqbot/normalizer.js';
import type { QQBotPayload } from '../../../src/channels/qqbot/normalizer.js';
import { normalizeFeishuMessage, extractFeishuPostText } from '../../../src/channels/feishu/normalizer.js';
import type { FeishuEvent } from '../../../src/channels/feishu/normalizer.js';
import { normalizeWeChatMessage, parseWeChatXml } from '../../../src/channels/wechat/normalizer.js';
import type { WeChatMessage } from '../../../src/channels/wechat/normalizer.js';
import { MessageType } from '../../../src/channels/types.js';

// ══════════════════════════════════════════════════════════════
// QQBot 归一化器测试
// ══════════════════════════════════════════════════════════════

describe('normalizeQQBotMessage', () => {
  it('应该正确处理 Hello 事件（不返回消息）', () => {
    const result = normalizeQQBotMessage({ op: 10, d: { heartbeat_interval: 30000 } as QQBotPayload['d'] });
    expect(result).toBeNull();
  });

  it('应该正确处理心跳确认（不返回消息）', () => {
    const result = normalizeQQBotMessage({ op: 11 });
    expect(result).toBeNull();
  });

  it('应该正确处理未知事件类型（不返回消息）', () => {
    const result = normalizeQQBotMessage({ op: 0, t: 'GUILD_CREATE', d: {} as QQBotPayload['d'] });
    expect(result).toBeNull();
  });

  it('应该正确归一化频道文本消息', () => {
    const payload: QQBotPayload = {
      op: 0,
      t: 'MESSAGE_CREATE',
      d: {
        id: 'msg_001',
        author: { id: 'user_001', username: '测试用户', avatar: 'http://avatar.png' },
        content: '你好，世界！',
        timestamp: '2024-01-15T10:30:00.000Z',
        channel_id: 'ch_001',
        guild_id: 'guild_001',
      },
    };

    const result = normalizeQQBotMessage(payload);
    expect(result).not.toBeNull();
    expect(result!.messageId).toBe('qq_msg_001');
    expect(result!.channelId).toBe('qqbot');
    expect(result!.userId).toBe('user_001');
    expect(result!.username).toBe('测试用户');
    expect(result!.text).toBe('你好，世界！');
    expect(result!.chatType).toBe('group');
    expect(result!.groupId).toBe('guild_001');
    expect(result!.messageType).toBe(MessageType.TEXT);
  });

  it('应该正确归一化频道私聊消息', () => {
    const payload: QQBotPayload = {
      op: 0,
      t: 'DIRECT_MESSAGE_CREATE',
      d: {
        id: 'msg_002',
        author: { id: 'user_002', username: '私聊用户', avatar: 'http://avatar2.png' },
        content: '私聊消息',
        timestamp: '2024-01-15T10:31:00.000Z',
        channel_id: 'dm_001',
      },
    };

    const result = normalizeQQBotMessage(payload);
    expect(result).not.toBeNull();
    expect(result!.messageId).toBe('qq_dm_msg_002');
    expect(result!.chatType).toBe('private');
  });

  it('应该正确归一化带图片附件的消息', () => {
    const payload: QQBotPayload = {
      op: 0,
      t: 'MESSAGE_CREATE',
      d: {
        id: 'msg_003',
        author: { id: 'user_003', username: '图片用户', avatar: '' },
        content: '看看这张图',
        timestamp: '2024-01-15T10:32:00.000Z',
        channel_id: 'ch_002',
        attachments: [{
          url: 'http://img.png',
          filename: 'photo.png',
          content_type: 'image/png',
          width: 800,
          height: 600,
          size: 102400,
        }],
      },
    };

    const result = normalizeQQBotMessage(payload);
    expect(result).not.toBeNull();
    expect(result!.messageType).toBe(MessageType.IMAGE);
    expect(result!.attachments).toBeDefined();
    expect(result!.attachments![0].type).toBe('image');
    expect(result!.attachments![0].url).toBe('http://img.png');
    expect(result!.attachments![0].width).toBe(800);
    expect(result!.attachments![0].height).toBe(600);
  });
});

describe('isQQBotHello', () => {
  it('op=10 应是 Hello', () => expect(isQQBotHello({ op: 10 })).toBe(true));
  it('op=0 不是 Hello', () => expect(isQQBotHello({ op: 0 })).toBe(false));
});

describe('isQQBotHeartbeatAck', () => {
  it('op=11 应是心跳确认', () => expect(isQQBotHeartbeatAck({ op: 11 })).toBe(true));
  it('op=0 不是心跳确认', () => expect(isQQBotHeartbeatAck({ op: 0 })).toBe(false));
});

// ══════════════════════════════════════════════════════════════
// 飞书归一化器测试
// ══════════════════════════════════════════════════════════════

describe('normalizeFeishuMessage', () => {
  it('应该正确归一化飞书文本消息', () => {
    const event: FeishuEvent = {
      schema: '2.0',
      header: {
        event_id: 'evt_001',
        event_type: 'im.message.receive_v1',
        create_time: '1705314600000',
      },
      event: {
        sender: {
          sender_id: { open_id: 'ou_user001' },
        },
        message: {
          message_id: 'om_msg001',
          chat_id: 'oc_chat001',
          chat_type: 'p2p',
          message_type: 'text',
          content: JSON.stringify({ text: '你好飞书' }),
          create_time: '1705314600000',
        },
      },
    };

    const result = normalizeFeishuMessage(event);
    expect(result).not.toBeNull();
    expect(result!.messageId).toBe('fs_om_msg001');
    expect(result!.channelId).toBe('feishu');
    expect(result!.userId).toBe('ou_user001');
    expect(result!.text).toBe('你好飞书');
    expect(result!.chatType).toBe('private');
    expect(result!.messageType).toBe(MessageType.TEXT);
  });

  it('应该正确归一化飞书群聊消息', () => {
    const event: FeishuEvent = {
      schema: '2.0',
      header: {
        event_id: 'evt_002',
        event_type: 'im.message.receive_v1',
        create_time: '1705314700000',
      },
      event: {
        sender: {
          sender_id: { open_id: 'ou_user002' },
        },
        message: {
          message_id: 'om_msg002',
          chat_id: 'oc_group001',
          chat_type: 'group',
          message_type: 'text',
          content: JSON.stringify({ text: '群聊消息' }),
          create_time: '1705314700000',
        },
      },
    };

    const result = normalizeFeishuMessage(event);
    expect(result).not.toBeNull();
    expect(result!.chatType).toBe('group');
    expect(result!.groupId).toBe('oc_group001');
  });

  it('应该处理无效的 JSON content', () => {
    const event: FeishuEvent = {
      schema: '2.0',
      header: { event_id: 'evt', event_type: '', create_time: '0' },
      event: {
        sender: { sender_id: { open_id: 'ou' } },
        message: {
          message_id: 'om',
          chat_id: 'oc',
          chat_type: 'p2p',
          message_type: 'text',
          content: '不是 JSON',
          create_time: '0',
        },
      },
    };

    const result = normalizeFeishuMessage(event);
    expect(result).toBeNull();
  });
});

describe('extractFeishuPostText', () => {
  it('应该提取富文本标题和段落', () => {
    const content = {
      zh_cn: {
        title: '这里是标题',
        content: [
          [{ tag: 'text', text: '第一段文字' }],
          [{ tag: 'text', text: '段落二A' }, { tag: 'text', text: '段落二B' }],
          [{ tag: 'a', text: '链接文字', href: 'https://example.com' }],
          [{ tag: 'at', user_name: '张三', user_id: 'ou_xxx' }],
          [{ tag: 'img', image_key: 'img_xxx' }],
        ],
      },
    };

    const result = extractFeishuPostText(content);
    expect(result).toContain('这里是标题');
    expect(result).toContain('第一段文字');
    expect(result).toContain('段落二A段落二B');
    expect(result).toContain('链接文字');
    expect(result).toContain('@张三');
    expect(result).toContain('[图片]');
  });
});

// ══════════════════════════════════════════════════════════════
// 微信归一化器测试
// ══════════════════════════════════════════════════════════════

describe('normalizeWeChatMessage', () => {
  it('应该正确归一化微信文本消息', () => {
    const msg: WeChatMessage = {
      ToUserName: 'gh_test',
      FromUserName: 'oUser001',
      CreateTime: 1705314600,
      MsgType: 'text',
      MsgId: 'msg_001',
      Content: '你好微信',
    };

    const result = normalizeWeChatMessage(msg);
    expect(result).not.toBeNull();
    expect(result!.messageId).toBe('wx_msg_001');
    expect(result!.channelId).toBe('wechat');
    expect(result!.userId).toBe('oUser001');
    expect(result!.username).toBe('oUser001');
    expect(result!.text).toBe('你好微信');
    expect(result!.chatType).toBe('private');
    expect(result!.messageType).toBe(MessageType.TEXT);
    expect(result!.timestamp).toBe(1705314600000);
  });

  it('应该正确归一化微信图片消息', () => {
    const msg: WeChatMessage = {
      ToUserName: 'gh_test',
      FromUserName: 'oUser002',
      CreateTime: 1705314700,
      MsgType: 'image',
      MsgId: 'msg_002',
      PicUrl: 'http://img.jpg',
      MediaId: 'media_001',
    };

    const result = normalizeWeChatMessage(msg);
    expect(result).not.toBeNull();
    expect(result!.messageType).toBe(MessageType.IMAGE);
    expect(result!.attachments![0].type).toBe('image');
    expect(result!.attachments![0].url).toBe('http://img.jpg');
  });

  it('应该正确归一化微信语音消息（包含识别结果）', () => {
    const msg: WeChatMessage = {
      ToUserName: 'gh_test',
      FromUserName: 'oUser003',
      CreateTime: 1705314800,
      MsgType: 'voice',
      MsgId: 'msg_003',
      MediaId: 'media_002',
      Recognition: '今天天气不错',
    };

    const result = normalizeWeChatMessage(msg);
    expect(result).not.toBeNull();
    expect(result!.messageType).toBe(MessageType.AUDIO);
    expect(result!.text).toBe('今天天气不错');
  });

  it('应该正确归一化微信位置消息', () => {
    const msg: WeChatMessage = {
      ToUserName: 'gh_test',
      FromUserName: 'oUser004',
      CreateTime: 1705314900,
      MsgType: 'location',
      MsgId: 'msg_004',
      Location_X: '39.9042',
      Location_Y: '116.4074',
      Label: '北京市',
    };

    const result = normalizeWeChatMessage(msg);
    expect(result).not.toBeNull();
    expect(result!.messageType).toBe(MessageType.LOCATION);
    expect(result!.text).toContain('北京市');
  });

  it('应该正确归一化微信关注事件', () => {
    const msg: WeChatMessage = {
      ToUserName: 'gh_test',
      FromUserName: 'oUser005',
      CreateTime: 1705315000,
      MsgType: 'event',
      Event: 'subscribe',
    };

    const result = normalizeWeChatMessage(msg);
    expect(result).not.toBeNull();
    expect(result!.text).toBe('[关注事件]');
  });

  it('应该处理不支持的微信消息类型', () => {
    const msg: WeChatMessage = {
      ToUserName: 'gh_test',
      FromUserName: 'oUser006',
      CreateTime: 1705315100,
      MsgType: 'unknown_type',
      MsgId: 'msg_005',
    };

    const result = normalizeWeChatMessage(msg);
    expect(result).not.toBeNull();
    expect(result!.text).toContain('不支持的消息类型');
  });
});

describe('parseWeChatXml', () => {
  it('应该正确解析微信 XML 消息', () => {
    // 使用 join 避免换行符干扰正则匹配
    const xml = '<xml><ToUserName><![CDATA[gh_test]]></ToUserName><FromUserName><![CDATA[oUser001]]></FromUserName><CreateTime>1705314600</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[你好]]></Content><MsgId>123456</MsgId></xml>';

    const result = parseWeChatXml(xml);
    expect(result.ToUserName).toBe('gh_test');
    expect(result.FromUserName).toBe('oUser001');
    expect(result.MsgType).toBe('text');
    expect(result.Content).toBe('你好');
    expect(result.CreateTime).toBe('1705314600');
    expect(result.MsgId).toBe('123456');
  });

  it('应该处理空 XML', () => {
    const result = parseWeChatXml('');
    expect(Object.keys(result).length).toBe(0);
  });
});
