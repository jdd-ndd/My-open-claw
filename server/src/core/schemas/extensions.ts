/**
 * 自定义校验扩展
 *
 * @module @myopenclaw/server/core/schemas
 */

import { z } from 'zod';
import { SessionConfigSchema } from './session.schema.js';

/** Zod 自定义校验：工具名称必须为 snake_case */
export const ToolNameSchema = z
  .string()
  .min(1)
  .regex(/^[a-z][a-z0-9_]*$/, '工具名称必须为 snake_case 格式')
  .refine((name) => !name.includes('__'), '工具名称不能包含连续下划线');

/** Zod 跨字段校验：maxTokens 不能超过模型上限 */
export const ModelAwareConfigSchema = SessionConfigSchema.refine(
  (config) => {
    const modelMaxTokens: Record<string, number> = {
      'gpt-4o': 16384,
      'claude-3-5-sonnet': 8192,
    };
    const limit = modelMaxTokens[config.model ?? 'gpt-4o'] ?? 4096;
    return (config.maxTokens ?? 4096) <= limit;
  },
  { message: 'maxTokens 超过模型上限', path: ['maxTokens'] },
);
