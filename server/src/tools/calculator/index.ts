/**
 * 运算工具模块
 *
 * 暴露四个内置工具供 Agent 调用：
 *   - calculator/express   : 数学表达式求值
 *   - calculator/unit      : 单位换算（长度/重量/温度/面积/体积/速度）
 *   - calculator/currency  : 货币汇率换算（实时汇率）
 *   - calculator/base      : 进制转换（2/8/10/16 互转）
 *
 * 所有工具均为 low risk（除货币换算需联网外，其余纯本地计算）。
 *
 * @module @myopenclaw/server/tools/calculator
 */

import type { InvokeContext, JSONSchema, Tool, ToolResult } from '../../core/types/index.js';
import { CalculatorService, CalculatorServiceError } from '../../services/calculator.js';

const calculatorService = new CalculatorService();

/** 运算工具基类，统一处理错误格式 */
abstract class CalculatorToolBase implements Tool {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly parameters: JSONSchema;
  readonly category = 'calculator';
  readonly risk: 'low' | 'medium' | 'high' = 'low';
  readonly builtin = true;

  protected formatError(error: unknown, startedAt: number): ToolResult {
    if (error instanceof CalculatorServiceError) {
      return {
        success: false,
        status: 'error',
        error: error.message,
        errorCode: error.code,
        metadata: {
          durationMs: Date.now() - startedAt,
          sideEffects: [],
        },
      };
    }

    return {
      success: false,
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown calculator error',
      errorCode: 'CALCULATOR_TOOL_ERROR',
      metadata: {
        durationMs: Date.now() - startedAt,
        sideEffects: [],
      },
    };
  }

  abstract execute(params: Record<string, unknown>, context: InvokeContext): Promise<ToolResult>;
}

/** 数学表达式求值工具 */
export class CalculatorExpressTool extends CalculatorToolBase {
  readonly name = 'calculator/express';
  readonly description = 'Evaluate a math expression with + - * / % ^, parentheses, functions (sin/cos/log/sqrt/...), and constants (pi, e).';
  readonly parameters: JSONSchema = {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: 'Math expression, e.g. "sin(π/4) + log(100)" or "2^10 + 1.5e3".',
      },
    },
    required: ['expression'],
  };

  async execute(params: Record<string, unknown>, _context: InvokeContext): Promise<ToolResult> {
    const startedAt = Date.now();
    try {
      const expression = typeof params.expression === 'string' ? params.expression : '';
      const result = calculatorService.evaluateExpression(expression);

      return {
        success: true,
        status: 'success',
        data: result,
        metadata: {
          durationMs: Date.now() - startedAt,
          sideEffects: [],
        },
      };
    } catch (error) {
      return this.formatError(error, startedAt);
    }
  }
}

/** 单位换算工具 */
export class CalculatorUnitTool extends CalculatorToolBase {
  readonly name = 'calculator/unit';
  readonly description = 'Convert a value between units of the same category (length, weight, temperature, area, volume, speed).';
  readonly parameters: JSONSchema = {
    type: 'object',
    properties: {
      value: { type: 'number', description: 'Numeric value to convert.' },
      from: { type: 'string', description: 'Source unit, e.g. "km", "kg", "celsius", "m2", "L", "km/h".' },
      to: { type: 'string', description: 'Target unit, e.g. "mile", "lb", "fahrenheit", "acre", "gallon", "mph".' },
    },
    required: ['value', 'from', 'to'],
  };

  async execute(params: Record<string, unknown>, _context: InvokeContext): Promise<ToolResult> {
    const startedAt = Date.now();
    try {
      const value = typeof params.value === 'number' ? params.value : Number(params.value);
      const from = typeof params.from === 'string' ? params.from : '';
      const to = typeof params.to === 'string' ? params.to : '';
      const result = calculatorService.convertUnit(value, from, to);

      return {
        success: true,
        status: 'success',
        data: result,
        metadata: {
          durationMs: Date.now() - startedAt,
          sideEffects: [],
        },
      };
    } catch (error) {
      return this.formatError(error, startedAt);
    }
  }
}

/** 货币汇率换算工具 */
export class CalculatorCurrencyTool extends CalculatorToolBase {
  readonly name = 'calculator/currency';
  readonly description = 'Convert an amount from one currency to another using live exchange rates.';
  readonly parameters: JSONSchema = {
    type: 'object',
    properties: {
      amount: { type: 'number', description: 'Amount in base currency.', default: 1 },
      base: { type: 'string', description: '3-letter base currency code, e.g. CNY.' },
      target: { type: 'string', description: '3-letter target currency code, e.g. USD.' },
    },
    required: ['base', 'target'],
  };

  async execute(params: Record<string, unknown>, _context: InvokeContext): Promise<ToolResult> {
    const startedAt = Date.now();
    try {
      const amount = typeof params.amount === 'number' ? params.amount : Number(params.amount) || 1;
      const base = typeof params.base === 'string' ? params.base : '';
      const target = typeof params.target === 'string' ? params.target : '';
      const result = await calculatorService.convertCurrency(amount, base, target);

      return {
        success: true,
        status: 'success',
        data: result,
        metadata: {
          durationMs: Date.now() - startedAt,
          sideEffects: [],
        },
      };
    } catch (error) {
      return this.formatError(error, startedAt);
    }
  }
}

/** 进制转换工具 */
export class CalculatorBaseTool extends CalculatorToolBase {
  readonly name = 'calculator/base';
  readonly description = 'Convert a number between bases (2, 8, 10, 16).';
  readonly parameters: JSONSchema = {
    type: 'object',
    properties: {
      input: { type: 'string', description: 'Input value as string, e.g. "255" or "0xFF".' },
      fromBase: { type: 'number', enum: [2, 8, 10, 16], description: 'Source base.' },
      toBase: { type: 'number', enum: [2, 8, 10, 16], description: 'Target base.' },
    },
    required: ['input', 'fromBase', 'toBase'],
  };

  async execute(params: Record<string, unknown>, _context: InvokeContext): Promise<ToolResult> {
    const startedAt = Date.now();
    try {
      const input = typeof params.input === 'string' ? params.input : String(params.input ?? '');
      const fromBase = typeof params.fromBase === 'number' ? params.fromBase : Number(params.fromBase);
      const toBase = typeof params.toBase === 'number' ? params.toBase : Number(params.toBase);
      const result = calculatorService.convertBase(input, fromBase, toBase);

      return {
        success: true,
        status: 'success',
        data: result,
        metadata: {
          durationMs: Date.now() - startedAt,
          sideEffects: [],
        },
      };
    } catch (error) {
      return this.formatError(error, startedAt);
    }
  }
}
