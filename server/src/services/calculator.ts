/**
 * 运算服务（CalculatorService）
 *
 * 提供四类运算能力：
 *   1. 数学表达式求值  evaluateExpression
 *      支持 + - * / % ^、括号、三角/对数/指数函数、π/e 常量
 *   2. 单位换算  convertUnit
 *      长度、重量、温度、面积、体积、速度六大类常用单位互转
 *   3. 货币汇率换算  convertCurrency
 *      复用 UtilityApiService 实时汇率
 *   4. 进制转换  convertBase
 *      二进制/八进制/十进制/十六进制互转
 *
 * 出于安全考虑，表达式求值使用自实现的递归下降解析器，不使用 eval。
 *
 * @module @myopenclaw/server/services/calculator
 */

import { UtilityApiService, UtilityApiError } from './utility-api.js';

/** 运算服务异常 */
export class CalculatorServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode = 500,
  ) {
    super(message);
    this.name = 'CalculatorServiceError';
  }
}

/** 数学表达式求值结果 */
export interface ExpressionResult {
  /** 原始表达式 */
  expression: string;
  /** 求值结果 */
  value: number;
  /** 显示文本（含表达式与结果） */
  display: string;
}

/** 单位类别 */
export type UnitCategory = 'length' | 'weight' | 'temperature' | 'area' | 'volume' | 'speed';

/** 单位换算结果 */
export interface UnitConversionResult {
  /** 输入数值 */
  input: number;
  /** 源单位 */
  from: string;
  /** 目标单位 */
  to: string;
  /** 单位类别 */
  category: UnitCategory;
  /** 换算结果 */
  output: number;
  /** 显示文本 */
  display: string;
}

/** 货币换算结果（直接复用 utility-api 的结构） */
export interface CurrencyConversionResult {
  base: string;
  target: string;
  amount: number;
  rate: number;
  convertedAmount: number;
  updatedAt: string | null;
}

/** 进制转换结果 */
export interface BaseConversionResult {
  /** 输入值（字符串形式） */
  input: string;
  /** 源进制（2/8/10/16） */
  fromBase: number;
  /** 目标进制（2/8/10/16） */
  toBase: number;
  /** 十进制中间值 */
  decimalValue: number;
  /** 输出字符串 */
  output: string;
  /** 显示文本 */
  display: string;
}

// ════════════════════════════════════════════════════════════════
// 单位换算表
// ════════════════════════════════════════════════════════════════

/** 单位别名映射（统一规范化） */
const UNIT_ALIASES: Record<string, string> = {
  // 长度
  m: 'm', meter: 'm', meters: 'm', metre: 'm', metres: 'm',
  km: 'km', kilometer: 'km', kilometers: 'km', kilometres: 'km', '公里': 'km',
  cm: 'cm', centimeter: 'cm', centimeters: 'cm',
  mm: 'mm', millimeter: 'mm', millimeters: 'mm',
  mile: 'mile', miles: 'mile', mi: 'mile', '英里': 'mile',
  yard: 'yard', yards: 'yard', yd: 'yard',
  foot: 'foot', feet: 'foot', ft: 'foot', '英尺': 'foot',
  inch: 'inch', inches: 'inch', in: 'inch', '英寸': 'inch',
  // 重量
  kg: 'kg', kilogram: 'kg', kilograms: 'kg', '公斤': 'kg',
  g: 'g', gram: 'g', grams: 'g',
  mg: 'mg', milligram: 'mg', milligrams: 'mg',
  ton: 'ton', tons: 'ton', tonne: 'ton', tonnes: 'ton', '吨': 'ton',
  lb: 'lb', pound: 'lb', pounds: 'lb', '磅': 'lb',
  oz: 'oz', ounce: 'oz', ounces: 'oz', '盎司': 'oz',
  // 温度
  celsius: 'celsius', c: 'celsius', '摄氏度': 'celsius', '度': 'celsius',
  fahrenheit: 'fahrenheit', f: 'fahrenheit', '华氏度': 'fahrenheit',
  kelvin: 'kelvin', k: 'kelvin',
  // 面积
  'm2': 'm2', 'sqm': 'm2', '平方米': 'm2',
  'km2': 'km2', 'sqkm': 'km2', '平方公里': 'km2',
  hectare: 'hectare', ha: 'hectare', '公顷': 'hectare',
  acre: 'acre', acres: 'acre', '英亩': 'acre',
  'ft2': 'ft2', 'sqft': 'ft2', '平方英尺': 'ft2',
  // 体积
  l: 'l', liter: 'l', liters: 'l', litre: 'l', litres: 'l', '升': 'l',
  ml: 'ml', milliliter: 'ml', milliliters: 'ml', '毫升': 'ml',
  'm3': 'm3', '立方米': 'm3',
  gallon: 'gallon', gallons: 'gallon', gal: 'gallon', '加仑': 'gallon',
  pint: 'pint', pints: 'pint', '品脱': 'pint',
  // 速度
  'm/s': 'm/s', 'mps': 'm/s',
  'km/h': 'km/h', 'kmh': 'km/h', 'kph': 'km/h',
  mph: 'mph', '英里每小时': 'mph',
};

/** 各单位类别下的单位与"到基准单位的换算因子"映射 */
const UNIT_FACTORS: Record<UnitCategory, Record<string, number>> = {
  // 基准：米
  length: {
    m: 1,
    km: 1000,
    cm: 0.01,
    mm: 0.001,
    mile: 1609.344,
    yard: 0.9144,
    foot: 0.3048,
    inch: 0.0254,
  },
  // 基准：克
  weight: {
    kg: 1000,
    g: 1,
    mg: 0.001,
    ton: 1_000_000,
    lb: 453.59237,
    oz: 28.349523125,
  },
  // 温度需要特殊处理，factor 不使用
  temperature: {
    celsius: 1,
    fahrenheit: 1,
    kelvin: 1,
  },
  // 基准：平方米
  area: {
    m2: 1,
    km2: 1_000_000,
    hectare: 10000,
    acre: 4046.8564224,
    ft2: 0.09290304,
  },
  // 基准：升
  volume: {
    l: 1,
    ml: 0.001,
    m3: 1000,
    gallon: 3.785411784,
    pint: 0.473176473,
  },
  // 基准：m/s
  speed: {
    'm/s': 1,
    'km/h': 0.277777778,
    mph: 0.44704,
  },
};

/** 单位归属类别反查表 */
const UNIT_TO_CATEGORY: Record<string, UnitCategory> = Object.entries(UNIT_FACTORS).reduce(
  (acc, [cat, units]) => {
    for (const unit of Object.keys(units)) {
      acc[unit] = cat as UnitCategory;
    }
    return acc;
  },
  {} as Record<string, UnitCategory>,
);

/** 规范化单位名称（接受别名） */
function normalizeUnit(unit: string): string {
  const lower = unit.trim().toLowerCase();
  return UNIT_ALIASES[lower] ?? lower;
}

/** 温度换算（需要特殊公式） */
function convertTemperature(value: number, from: string, to: string): number {
  // 先转成摄氏度
  let celsius: number;
  switch (from) {
    case 'celsius': celsius = value; break;
    case 'fahrenheit': celsius = (value - 32) * 5 / 9; break;
    case 'kelvin': celsius = value - 273.15; break;
    default: throw new CalculatorServiceError(`Unknown temperature unit: ${from}`, 'CALC_UNKNOWN_UNIT', 400);
  }
  // 再从摄氏度转到目标
  switch (to) {
    case 'celsius': return celsius;
    case 'fahrenheit': return celsius * 9 / 5 + 32;
    case 'kelvin': return celsius + 273.15;
    default: throw new CalculatorServiceError(`Unknown temperature unit: ${to}`, 'CALC_UNKNOWN_UNIT', 400);
  }
}

// ════════════════════════════════════════════════════════════════
// 数学表达式求值器（递归下降解析器）
// ════════════════════════════════════════════════════════════════

/** 支持的函数表 */
const FUNCTIONS: Record<string, (x: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  log: Math.log10,    // 以 10 为底
  ln: Math.log,        // 以 e 为底
  log2: Math.log2,
  sqrt: Math.sqrt,
  abs: Math.abs,
  exp: Math.exp,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
};

/** 支持的常量表 */
const CONSTANTS: Record<string, number> = {
  π: Math.PI,
  pi: Math.PI,
  e: Math.E,
  tau: Math.PI * 2,
};

/** 表达式解析器类 */
class ExpressionParser {
  private pos = 0;
  constructor(private readonly input: string) {}

  /** 解析入口 */
  parse(): number {
    const result = this.parseExpression();
    this.skipWhitespace();
    if (this.pos < this.input.length) {
      throw new CalculatorServiceError(
        `Unexpected character at position ${this.pos}: "${this.input[this.pos]}"`,
        'CALC_PARSE_ERROR',
        400,
      );
    }
    return result;
  }

  /** 跳过空白字符 */
  private skipWhitespace(): void {
    while (this.pos < this.input.length && /\s/.test(this.input[this.pos])) {
      this.pos++;
    }
  }

  /** 当前字符 */
  private peek(): string {
    return this.input[this.pos] ?? '';
  }

  /** 表达式：term (('+' | '-') term)* */
  private parseExpression(): number {
    let left = this.parseTerm();
    this.skipWhitespace();
    while (this.peek() === '+' || this.peek() === '-') {
      const op = this.input[this.pos++];
      const right = this.parseTerm();
      left = op === '+' ? left + right : left - right;
      this.skipWhitespace();
    }
    return left;
  }

  /** term：factor (('*' | '/' | '%') factor)* */
  private parseTerm(): number {
    let left = this.parseFactor();
    this.skipWhitespace();
    while (this.peek() === '*' || this.peek() === '/' || this.peek() === '%') {
      const op = this.input[this.pos++];
      const right = this.parseFactor();
      if (op === '*') left *= right;
      else if (op === '/') {
        if (right === 0) throw new CalculatorServiceError('Division by zero', 'CALC_DIV_ZERO', 400);
        left /= right;
      } else {
        if (right === 0) throw new CalculatorServiceError('Modulo by zero', 'CALC_MOD_ZERO', 400);
        left %= right;
      }
      this.skipWhitespace();
    }
    return left;
  }

  /** factor：base ('^' factor)*  右结合 */
  private parseFactor(): number {
    const base = this.parseUnary();
    this.skipWhitespace();
    if (this.peek() === '^') {
      this.pos++;
      const exp = this.parseFactor(); // 右结合
      return Math.pow(base, exp);
    }
    return base;
  }

  /** unary：('+' | '-') unary | primary */
  private parseUnary(): number {
    this.skipWhitespace();
    if (this.peek() === '-') {
      this.pos++;
      return -this.parseUnary();
    }
    if (this.peek() === '+') {
      this.pos++;
      return this.parseUnary();
    }
    return this.parsePrimary();
  }

  /** primary：number | constant | function '(' expression ')' | '(' expression ')' */
  private parsePrimary(): number {
    this.skipWhitespace();
    const ch = this.peek();

    // 括号表达式
    if (ch === '(') {
      this.pos++;
      const expr = this.parseExpression();
      this.skipWhitespace();
      if (this.peek() !== ')') {
        throw new CalculatorServiceError('Missing closing parenthesis', 'CALC_PARSE_ERROR', 400);
      }
      this.pos++;
      return expr;
    }

    // 数字字面量（含科学计数法）
    if (/[0-9.]/.test(ch)) {
      return this.parseNumber();
    }

    // 标识符（函数或常量）
    if (/[a-zA-Zπ]/.test(ch)) {
      return this.parseIdentifier();
    }

    throw new CalculatorServiceError(
      `Unexpected character at position ${this.pos}: "${ch}"`,
      'CALC_PARSE_ERROR',
      400,
    );
  }

  /** 解析数字字面量 */
  private parseNumber(): number {
    const start = this.pos;
    while (this.pos < this.input.length && /[0-9.eE+\-]/.test(this.input[this.pos])) {
      // 处理科学计数法中的 +/-
      if ((this.input[this.pos] === '+' || this.input[this.pos] === '-')) {
        // 仅在 e/E 后面才合法
        const prev = this.input[this.pos - 1];
        if (prev !== 'e' && prev !== 'E') break;
      }
      this.pos++;
    }
    const numStr = this.input.slice(start, this.pos);
    const value = Number(numStr);
    if (!Number.isFinite(value)) {
      throw new CalculatorServiceError(`Invalid number: ${numStr}`, 'CALC_PARSE_ERROR', 400);
    }
    return value;
  }

  /** 解析标识符（函数调用或常量） */
  private parseIdentifier(): number {
    const start = this.pos;
    while (this.pos < this.input.length && /[a-zA-Z0-9π_]/.test(this.input[this.pos])) {
      this.pos++;
    }
    const name = this.input.slice(start, this.pos).toLowerCase();

    // 函数调用
    this.skipWhitespace();
    if (this.peek() === '(') {
      const fn = FUNCTIONS[name];
      if (!fn) {
        throw new CalculatorServiceError(`Unknown function: ${name}`, 'CALC_UNKNOWN_FUNCTION', 400);
      }
      this.pos++; // 消费 (
      const arg = this.parseExpression();
      this.skipWhitespace();
      if (this.peek() !== ')') {
        throw new CalculatorServiceError(`Missing ) after function ${name}`, 'CALC_PARSE_ERROR', 400);
      }
      this.pos++; // 消费 )
      return fn(arg);
    }

    // 常量
    if (name in CONSTANTS) {
      return CONSTANTS[name];
    }

    throw new CalculatorServiceError(`Unknown identifier: ${name}`, 'CALC_UNKNOWN_IDENTIFIER', 400);
  }
}

// ════════════════════════════════════════════════════════════════
// 主服务类
// ════════════════════════════════════════════════════════════════

/**
 * 运算服务主类
 *
 * 使用方法：
 *   const service = new CalculatorService();
 *   service.evaluateExpression('sin(π/4) + log(100)');
 *   service.convertUnit(100, 'km', 'mile');
 *   service.convertCurrency(100, 'CNY', 'USD');
 *   service.convertBase('255', 10, 16);
 */
export class CalculatorService {
  private readonly utilityApi = new UtilityApiService();

  /**
   * 数学表达式求值
   * 支持：+ - * / % ^、括号、函数（sin/cos/log/...）、常量（π/e）
   */
  evaluateExpression(expression: string): ExpressionResult {
    const trimmed = expression.trim();
    if (!trimmed) {
      throw new CalculatorServiceError('Expression is required', 'CALC_EXPR_REQUIRED', 400);
    }

    const parser = new ExpressionParser(trimmed);
    const value = parser.parse();

    if (!Number.isFinite(value)) {
      throw new CalculatorServiceError('Result is not finite (Infinity or NaN)', 'CALC_NOT_FINITE', 400);
    }

    return {
      expression: trimmed,
      value,
      display: `${trimmed} = ${value}`,
    };
  }

  /**
   * 单位换算
   * 支持：长度、重量、温度、面积、体积、速度
   */
  convertUnit(value: number, from: string, to: string): UnitConversionResult {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new CalculatorServiceError('Value must be a finite number', 'CALC_INVALID_VALUE', 400);
    }

    const fromUnit = normalizeUnit(from);
    const toUnit = normalizeUnit(to);

    const fromCategory = UNIT_TO_CATEGORY[fromUnit];
    const toCategory = UNIT_TO_CATEGORY[toUnit];

    if (!fromCategory || !toCategory) {
      throw new CalculatorServiceError(
        `Unknown unit: ${!fromCategory ? from : to}`,
        'CALC_UNKNOWN_UNIT',
        400,
      );
    }

    if (fromCategory !== toCategory) {
      throw new CalculatorServiceError(
        `Unit category mismatch: ${from} (${fromCategory}) vs ${to} (${toCategory})`,
        'CALC_UNIT_MISMATCH',
        400,
      );
    }

    let output: number;
    if (fromCategory === 'temperature') {
      output = convertTemperature(value, fromUnit, toUnit);
    } else {
      const factors = UNIT_FACTORS[fromCategory];
      const fromFactor = factors[fromUnit];
      const toFactor = factors[toUnit];
      // 先把 value 转成基准单位，再除以目标单位的因子
      output = (value * fromFactor) / toFactor;
    }

    return {
      input: value,
      from: fromUnit,
      to: toUnit,
      category: fromCategory,
      output,
      display: `${value} ${fromUnit} = ${output} ${toUnit}`,
    };
  }

  /**
   * 货币汇率换算
   * 复用 UtilityApiService 获取实时汇率
   */
  async convertCurrency(amount: number, base: string, target: string): Promise<CurrencyConversionResult> {
    if (typeof amount !== 'number' || !Number.isFinite(amount)) {
      throw new CalculatorServiceError('Amount must be a finite number', 'CALC_INVALID_AMOUNT', 400);
    }

    try {
      return await this.utilityApi.getExchangeRate(base, target, amount);
    } catch (error) {
      if (error instanceof UtilityApiError) {
        throw new CalculatorServiceError(error.message, error.code, error.statusCode);
      }
      throw new CalculatorServiceError(
        error instanceof Error ? error.message : 'Currency conversion failed',
        'CALC_CURRENCY_ERROR',
        500,
      );
    }
  }

  /**
   * 进制转换
   * 支持：2/8/10/16 互转
   */
  convertBase(input: string, fromBase: number, toBase: number): BaseConversionResult {
    const validBases = [2, 8, 10, 16];
    if (!validBases.includes(fromBase) || !validBases.includes(toBase)) {
      throw new CalculatorServiceError(
        `Base must be one of 2, 8, 10, 16 (got from=${fromBase}, to=${toBase})`,
        'CALC_INVALID_BASE',
        400,
      );
    }

    const trimmed = input.trim();
    if (!trimmed) {
      throw new CalculatorServiceError('Input value is required', 'CALC_INPUT_REQUIRED', 400);
    }

    // 规范化输入：移除前缀（0x, 0o, 0b）
    let normalized = trimmed.toLowerCase();
    if (fromBase === 16 && normalized.startsWith('0x')) normalized = normalized.slice(2);
    else if (fromBase === 8 && normalized.startsWith('0o')) normalized = normalized.slice(2);
    else if (fromBase === 2 && normalized.startsWith('0b')) normalized = normalized.slice(2);

    // 校验字符是否在进制范围内
    const validChars = '0123456789abcdef'.slice(0, fromBase);
    for (const ch of normalized) {
      if (!validChars.includes(ch)) {
        throw new CalculatorServiceError(
          `Invalid character "${ch}" for base ${fromBase}`,
          'CALC_INVALID_DIGIT',
          400,
        );
      }
    }

    const decimalValue = parseInt(normalized, fromBase);
    if (!Number.isFinite(decimalValue)) {
      throw new CalculatorServiceError(`Failed to parse "${trimmed}" in base ${fromBase}`, 'CALC_PARSE_ERROR', 400);
    }

    const output = decimalValue.toString(toBase).toUpperCase();

    const baseLabel: Record<number, string> = {
      2: 'BIN',
      8: 'OCT',
      10: 'DEC',
      16: 'HEX',
    };

    return {
      input: trimmed,
      fromBase,
      toBase,
      decimalValue,
      output,
      display: `${baseLabel[fromBase]} ${trimmed} = ${baseLabel[toBase]} ${output}`,
    };
  }
}
