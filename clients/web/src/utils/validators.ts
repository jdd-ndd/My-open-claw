import { z } from 'zod';

/** 会话 ID 校验 */
export const sessionIdSchema = z.string().uuid();

/** 消息内容校验 */
export const messageTextSchema = z.string().min(1, '消息不能为空').max(50000, '消息过长');

/** WebSocket URL 校验 */
export const wsUrlSchema = z.string().url().startsWith('ws', { message: '不是有效的 WebSocket URL' });

/** 温度参数校验 */
export const temperatureSchema = z.number().min(0).max(2);
