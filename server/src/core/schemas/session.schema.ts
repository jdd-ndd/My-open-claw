/**
 * Session 的 Zod Schema 定义
 *
 * @module @myopenclaw/server/core/schemas
 */

import { z } from 'zod';

export const SessionConfigSchema = z
  .object({
    agentId: z.string().min(1, 'Agent ID 不能为空'),
    model: z.string().optional(),
    systemPrompt: z.string().max(8192, '系统提示词不能超过 8192 字符').optional(),
    memoryWindowSize: z.number().int().min(1).max(100).default(20),
    longTermMemoryEnabled: z.boolean().default(false),
    allowedTools: z.array(z.string()).optional(),
    temperature: z.number().min(0).max(2).default(0.7),
    maxTokens: z.number().int().min(1).max(32768).default(4096),
    idleTimeout: z.number().int().min(1000).default(30 * 60 * 1000),
    maxLifetime: z.number().int().min(60000).optional(),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export type SessionConfigType = z.infer<typeof SessionConfigSchema>;

export const CreateSessionRequestSchema = z.object({
  userId: z.string().min(1),
  channelId: z.string().min(1),
  title: z.string().max(100).optional(),
  config: SessionConfigSchema,
}).strict();
