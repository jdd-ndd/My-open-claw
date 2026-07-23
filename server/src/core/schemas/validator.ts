/**
 * 统一校验器接口与工厂
 *
 * @module @myopenclaw/server/core/schemas
 */

import type { TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { validationError } from '../errors/index.js';

export interface Validator<T> {
  validate(data: unknown): T;
  isValid(data: unknown): data is T;
  safeValidate(data: unknown): { success: true; data: T } | { success: false; error: string };
  toJsonSchema?: () => Record<string, unknown>;
}

/**
 * 使用 TypeBox Schema 校验数据
 */
export function validate<T>(schema: TSchema, data: unknown, label?: string): T {
  const errors = [...Value.Errors(schema, data)];
  if (errors.length > 0) {
    const details = errors.map((e) => ({
      field: e.path.slice(1) || label || 'root',
      message: e.message,
    }));
    throw validationError(`${label ?? '数据'}校验失败`, details);
  }
  return data as T;
}

/**
 * 创建统一校验器实例
 */
export function createValidator<T>(schema: TSchema): Validator<T> {
  return {
    validate(data: unknown): T {
      return validate<T>(schema, data);
    },
    isValid(data: unknown): data is T {
      return Value.Check(schema, data);
    },
    safeValidate(data: unknown) {
      if (Value.Check(schema, data)) {
        return { success: true, data: data as T };
      }
      return { success: false, error: 'Schema 校验失败' };
    },
  };
}

/** 安全校验（不抛异常） */
export function isvalid<T>(schema: TSchema, data: unknown): data is T {
  return Value.Check(schema, data);
}

/** 安全校验返回结果对象 */
export function safeValidate<T>(
  schema: TSchema,
  data: unknown,
): { success: true; data: T } | { success: false; error: string } {
  if (isvalid<T>(schema, data)) {
    return { success: true, data: data as T };
  }
  return { success: false, error: 'Schema 校验失败' };
}
