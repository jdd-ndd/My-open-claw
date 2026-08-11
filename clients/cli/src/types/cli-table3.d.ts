/**
 * cli-table3 类型声明文件
 *
 * 为 cli-table3 提供 TypeScript 类型支持。
 * cli-table3 是一个纯 JavaScript 库，没有官方类型定义。
 *
 * @module cli-table3
 */

declare module 'cli-table3' {
  interface TableOptions {
    /** 表头数组或对象 */
    head?: string[];
    /** 列宽度数组 */
    colWidths?: number[];
    /** 列对齐方式 */
    colAligns?: ('left' | 'center' | 'right')[];
    /** 行对齐方式 */
    rowAligns?: ('top' | 'middle' | 'bottom')[];
    /** 字符样式 */
    chars?: {
      top?: string;
      'top-mid'?: string;
      'top-left'?: string;
      'top-right'?: string;
      bottom?: string;
      'bottom-mid'?: string;
      'bottom-left'?: string;
      'bottom-right'?: string;
      left?: string;
      'left-mid'?: string;
      mid?: string;
      'mid-mid'?: string;
      right?: string;
      'right-mid'?: string;
      middle?: string;
    };
    /** 样式选项 */
    style?: {
      'padding-left'?: number;
      'padding-right'?: number;
      head?: string[];
      border?: string[];
    };
    /** 是否 wordWrap */
    wordWrap?: boolean;
    /** 缩进空间 */
    wordWrapWidth?: number;
  }

  class Table {
    constructor(options?: TableOptions);

    /** 添加一行数据 */
    push(row: (string | number | boolean | null | undefined)[]): number;

    /** 添加多行数据 */
    push(rows: (string | number | boolean | null | undefined)[][]): number;

    /** 转换为字符串 */
    toString(): string;

    /** 获取表数据 */
    length: number;
  }

  export = Table;
}
