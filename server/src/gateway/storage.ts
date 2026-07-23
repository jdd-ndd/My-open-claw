/**
 * In-Memory 存储适配器
 *
 * 替代 SQLite/better-sqlite3，提供简单的 Map 内存存储。
 * 实现文档中定义的数据库操作方法。
 *
 * @module @myopenclaw/server/gateway
 */

export interface StorageRow {
  [key: string]: unknown;
}

export class MemoryStorage {
  private tables = new Map<string, Map<string, StorageRow>>();

  /** 确保表存在 */
  ensureTable(name: string, _schema: string): void {
    if (!this.tables.has(name)) {
      this.tables.set(name, new Map());
    }
  }

  /** 执行 SQL（简化版，仅支持简单操作） */
  prepare(sql: string) {
    return new Stmt(this.tables, sql);
  }

  /** 事务包装 */
  transaction<T>(fn: (...args: unknown[]) => T): (...args: unknown[]) => T {
    return fn;
  }
}

class Stmt {
  constructor(private tables: Map<string, Map<string, StorageRow>>, private sql: string) {}

  run(...params: unknown[]): void {
    const table = this.sql.match(/INSERT\s+INTO\s+(\w+)/i)?.[1];
    if (!table) return;
    if (!this.tables.has(table)) this.tables.set(table, new Map());
    const rows = this.tables.get(table)!;
    const id = String(params[0] ?? crypto.randomUUID());
    const row: StorageRow = { id };
    params.forEach((p, i) => { row[`col_${i}`] = p; });
    rows.set(id, row);
  }

  get(...params: unknown[]): StorageRow | undefined {
    const table = this.sql.match(/FROM\s+(\w+)/i)?.[1];
    if (!table) return undefined;
    const rows = this.tables.get(table);
    if (!rows) return undefined;
    return rows.get(String(params[0]));
  }

  all(..._params: unknown[]): StorageRow[] {
    const table = this.sql.match(/FROM\s+(\w+)/i)?.[1];
    if (!table) return [];
    const rows = this.tables.get(table);
    if (!rows) return [];
    return Array.from(rows.values());
  }
}
