/**
 * Message 的 TypeBox Schema 定义
 *
 * @module @myopenclaw/server/core/schemas
 */

import { Type, type Static } from '@sinclair/typebox';

export const MessageSchema = Type.Object({
  id: Type.String({ pattern: '^[0-9A-HJKMNP-TV-Z]{26}$', description: '消息唯一 ID（ulid）' }),
  channelId: Type.String({ minLength: 1, description: '来源渠道 ID' }),
  userId: Type.String({ minLength: 1, description: '用户 ID' }),
  sessionId: Type.String({ minLength: 1, description: '会话 ID' }),
  agentId: Type.String({ minLength: 1, description: 'Agent ID' }),
  type: Type.Union(
    [
      Type.Literal('text'),
      Type.Literal('image'),
      Type.Literal('audio'),
      Type.Literal('video'),
      Type.Literal('file'),
      Type.Literal('system'),
      Type.Literal('tool_call'),
      Type.Literal('tool_result'),
      Type.Literal('error'),
      Type.Literal('control'),
    ],
    { description: '消息类型' },
  ),
  role: Type.Union(
    [Type.Literal('user'), Type.Literal('agent'), Type.Literal('tool'), Type.Literal('system')],
    { description: '发送者角色' },
  ),
  content: Type.String({ default: '', description: '消息文本内容' }),
  attachments: Type.Array(
    Type.Object({
      id: Type.String(),
      type: Type.Union([
        Type.Literal('image'),
        Type.Literal('audio'),
        Type.Literal('video'),
        Type.Literal('file'),
      ]),
      url: Type.Optional(Type.String()),
      data: Type.Optional(Type.String()),
      mimeType: Type.String(),
      filename: Type.Optional(Type.String()),
      size: Type.Optional(Type.Number({ minimum: 0 })),
      metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    }),
    { default: [] },
  ),
  timestamp: Type.Integer({ minimum: 0, description: '生成时间戳（ms）' }),
  metadata: Type.Record(Type.String(), Type.Unknown(), { default: {} }),
  toolCall: Type.Optional(
    Type.Object({
      toolName: Type.String(),
      arguments: Type.Record(Type.String(), Type.Unknown()),
      callId: Type.String(),
    }),
  ),
  toolResult: Type.Optional(
    Type.Object({
      callId: Type.String(),
      result: Type.Unknown(),
      success: Type.Boolean(),
      error: Type.Optional(Type.String()),
      durationMs: Type.Optional(Type.Number({ minimum: 0 })),
    }),
  ),
  parentMessageId: Type.Optional(Type.String()),
  referencedMessageIds: Type.Optional(Type.Array(Type.String())),
  priority: Type.Optional(Type.Integer({ minimum: 0, maximum: 9, default: 5 })),
  ttl: Type.Optional(Type.Integer({ minimum: 0 })),
});

export type MessageSchemaType = Static<typeof MessageSchema>;
