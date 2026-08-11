/**
 * 内存 + 文件持久化存储适配器
 *
 * 基于 Map 的轻量级存储，替代 SQLite/better-sqlite3。
 * 提供 INSERT / SELECT / UPDATE 的 SQL 子集解析，
 * 支持按列名（而非数字索引）访问行数据。
 * 支持 JSON 文件持久化，服务器重启后可恢复会话数据。
 *
 * @module @myopenclaw/server/gateway/core
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { createLogger } from '../../core/utils/logger.js';

const log = createLogger('gateway:storage');

export interface StorageRow {
  [columnName: string]: unknown;
}

/**
 * SQL 语句封装
 *
 * 解析 INSERT INTO、SELECT ... FROM、UPDATE ... SET、DELETE 等简单 SQL，
 * 返回按语义列名索引的行数据。
 * 支持写操作后触发持久化回调。
 */
class Stmt {
  constructor(
    private tables: Map<string, Map<string, StorageRow>>,
    private sql: string,
    private onWrite?: () => void,
  ) {}

  /**
   * 执行 INSERT / UPDATE / DELETE 操作
   * 写操作完成后自动触发持久化回调
   */
  run(...params: unknown[]): void {
    const normalised = this.sql.trim();
    let modified = false;

    // ── INSERT ──
    const insMatch = normalised.match(/INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)/i);
    if (insMatch) {
      const [, table, colsStr] = insMatch;
      const columns = colsStr.split(',').map((c) => c.trim());

      if (!this.tables.has(table)) this.tables.set(table, new Map());
      const rows = this.tables.get(table)!;

      const row: StorageRow = {};
      columns.forEach((col, i) => {
        row[col] = params[i] ?? null;
      });

      const pk = String(params[0] ?? Date.now().toString(36));
      rows.set(pk, row);
      modified = true;
    }

    // ── UPDATE ──
    const updMatch = normalised.match(
      /UPDATE\s+(\w+)\s+SET\s+(.+?)\s+WHERE\s+(\w+)\s*=\s*\?\s*$/i,
    );
    if (updMatch) {
      const [, table, setClause] = updMatch;
      const rows = this.tables.get(table);
      if (rows) {
        const idValue = String(params[params.length - 1]);
        const row = rows.get(idValue);
        if (row) {
          const assignments = setClause.split(',').map((s) => s.trim());
          let paramIdx = 0;

          for (const assignment of assignments) {
            const eqIdx = assignment.indexOf('=');
            if (eqIdx === -1) continue;

            const colName = assignment.slice(0, eqIdx).trim();
            const expr = assignment.slice(eqIdx + 1).trim();

            if (expr === '?') {
              row[colName] = params[paramIdx];
              paramIdx++;
            } else {
              const current = Number(row[colName] ?? 0);
              const evalResult = this.evalExpression(expr, current);
              row[colName] = evalResult;
            }
          }
          modified = true;
        }
      }
    }

    // ── DELETE ──
    const delMatch = normalised.match(/DELETE\s+FROM\s+(\w+)\s+WHERE\s+(\w+)\s*=\s*\?\s*$/i);
    if (delMatch) {
      const [, table] = delMatch;
      const rows = this.tables.get(table);
      if (rows) {
        rows.delete(String(params[0]));
        modified = true;
      }
    }

    // 写操作完成后触发持久化
    if (modified && this.onWrite) {
      this.onWrite();
    }
  }

  /**
   * 按主键获取单行数据
   */
  get(...params: unknown[]): StorageRow | undefined {
    const table = this.sql.match(/FROM\s+(\w+)/i)?.[1];
    if (!table) return undefined;
    const rows = this.tables.get(table);
    if (!rows) return undefined;
    return rows.get(String(params[0]));
  }

  /**
   * 获取所有行
   */
  all(..._params: unknown[]): StorageRow[] {
    const table = this.sql.match(/FROM\s+(\w+)/i)?.[1];
    if (!table) return [];
    const rows = this.tables.get(table);
    if (!rows) return [];
    return Array.from(rows.values());
  }

  /**
   * 简单算术表达式求值（仅支持 "current_col + N" 形式）
   */
  private evalExpression(expr: string, current: number): number {
    // 匹配 "colName + N" 或 "colName - N"
    const match = expr.trim().match(/^(\w+)\s*([+\-*/])\s*(\d+(?:\.\d+)?)$/);
    if (match) {
      const [, , op, val] = match;
      const num = Number(val);
      switch (op) {
        case '+': return current + num;
        case '-': return current - num;
        case '*': return current * num;
        case '/': return num !== 0 ? current / num : current;
      }
    }
    return current;
  }
}

/**
 * 内存 + 文件持久化存储适配器
 *
 * 提供与 SQLite 兼容的 prepare() / transaction() 接口，
 * 底层使用 Map 存储，支持简单 SQL 解析。
 * 支持 JSON 文件持久化，确保服务器重启后数据不丢失。
 */
export class MemoryStorage {
  private tables = new Map<string, Map<string, StorageRow>>();
  private readonly filePath?: string;

  /**
   * 创建存储适配器
   * @param filePath 可选的持久化文件路径，指定后数据将自动保存到 JSON 文件
   */
  constructor(filePath?: string) {
    this.filePath = filePath;
    if (filePath) {
      this.load();
    }
  }

  /** 确保表存在 */
  ensureTable(name: string, _schema: string): void {
    if (!this.tables.has(name)) {
      this.tables.set(name, new Map());
    }
  }

  /** 创建 SQL 语句对象，写操作自动触发持久化 */
  prepare(sql: string): Stmt {
    return new Stmt(this.tables, sql, () => this.save());
  }

  /** 事务包装（内存存储中退化为普通函数调用） */
  transaction<T>(fn: (...args: unknown[]) => T): (...args: unknown[]) => T {
    return fn;
  }

  /** 清空所有表（用于测试或重置） */
  clear(): void {
    this.tables.clear();
    if (this.filePath) {
      this.save();
    }
  }

  /**
   * 将内存中的所有表数据保存到 JSON 文件
   * 每次写操作后自动调用
   */
  private save(): void {
    if (!this.filePath) return;
    try {
      const data: Record<string, Record<string, StorageRow>> = {};
      for (const [tableName, rows] of this.tables) {
        data[tableName] = {};
        for (const [pk, row] of rows) {
          data[tableName][pk] = row;
        }
      }
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
      log.debug({ filePath: this.filePath, tables: Object.keys(data) }, 'Storage persisted');
    } catch (error) {
      log.error({ error: String(error), filePath: this.filePath }, 'Failed to persist storage');
    }
  }

  /**
   * 从 JSON 文件加载数据到内存
   * 构造函数中自动调用
   */
  private load(): void {
    if (!this.filePath || !existsSync(this.filePath)) {
      log.info('No storage file found, starting with empty tables');
      return;
    }
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const data = JSON.parse(raw) as Record<string, Record<string, StorageRow>>;
      for (const [tableName, rows] of Object.entries(data)) {
        const map = new Map<string, StorageRow>();
        for (const [pk, row] of Object.entries(rows)) {
          map.set(pk, row);
        }
        this.tables.set(tableName, map);
      }
      const tableCounts = Object.fromEntries(
        Array.from(this.tables.entries()).map(([k, v]) => [k, v.size]),
      );
      log.info({ filePath: this.filePath, tables: tableCounts }, 'Storage loaded from file');
    } catch (error) {
      log.error({ error: String(error), filePath: this.filePath }, 'Failed to load storage file');
    }
  }
}
