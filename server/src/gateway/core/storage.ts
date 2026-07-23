/**
 * In-Memory 存储适配器
 *
 * 基于 Map 的轻量级内存存储，替代 SQLite/better-sqlite3。
 * 提供 INSERT / SELECT / UPDATE 的 SQL 子集解析，
 * 支持按列名（而非数字索引）访问行数据。
 *
 * @module @myopenclaw/server/gateway/core
 */

export interface StorageRow {
  [columnName: string]: unknown;
}

/**
 * SQL 语句封装
 *
 * 解析 INSERT INTO、SELECT ... FROM、UPDATE ... SET 等简单 SQL，
 * 返回按语义列名索引的行数据。
 */
class Stmt {
  constructor(
    private tables: Map<string, Map<string, StorageRow>>,
    private sql: string,
  ) {}

  /**
   * 执行 INSERT 或 UPDATE 操作
   */
  run(...params: unknown[]): void {
    const normalised = this.sql.trim();

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

      // 主键取第一个参数（id 列）
      const pk = String(params[0] ?? Date.now().toString(36));
      rows.set(pk, row);
      return;
    }

    // ── UPDATE ──
    const updMatch = normalised.match(
      /UPDATE\s+(\w+)\s+SET\s+(.+?)\s+WHERE\s+(\w+)\s*=\s*\?\s*$/i,
    );
    if (updMatch) {
      const [, table, setClause] = updMatch;
      const rows = this.tables.get(table);
      if (!rows) return;

      // WHERE 参数是最后一个
      const idValue = String(params[params.length - 1]);
      const row = rows.get(idValue);
      if (!row) return;

      // 解析 SET 子句中各赋值项
      const assignments = setClause.split(',').map((s) => s.trim());
      let paramIdx = 0;

      for (const assignment of assignments) {
        const eqIdx = assignment.indexOf('=');
        if (eqIdx === -1) continue;

        const colName = assignment.slice(0, eqIdx).trim();
        const expr = assignment.slice(eqIdx + 1).trim();

        if (expr === '?') {
          // 简单占位符
          row[colName] = params[paramIdx];
          paramIdx++;
        } else {
          // 表达式求值（如 "runCount + 1"）
          const current = Number(row[colName] ?? 0);
          const evalResult = this.evalExpression(expr, current);
          row[colName] = evalResult;
        }
      }
      return;
    }

    // ── DELETE ──
    const delMatch = normalised.match(/DELETE\s+FROM\s+(\w+)\s+WHERE\s+(\w+)\s*=\s*\?\s*$/i);
    if (delMatch) {
      const [, table] = delMatch;
      const rows = this.tables.get(table);
      if (rows) {
        rows.delete(String(params[0]));
      }
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
 * 内存存储适配器
 *
 * 提供与 SQLite 兼容的 prepare() / transaction() 接口，
 * 底层使用 Map 存储，支持简单 SQL 解析。
 */
export class MemoryStorage {
  private tables = new Map<string, Map<string, StorageRow>>();

  /** 确保表存在 */
  ensureTable(name: string, _schema: string): void {
    if (!this.tables.has(name)) {
      this.tables.set(name, new Map());
    }
  }

  /** 创建 SQL 语句对象 */
  prepare(sql: string): Stmt {
    return new Stmt(this.tables, sql);
  }

  /** 事务包装（内存存储中退化为普通函数调用） */
  transaction<T>(fn: (...args: unknown[]) => T): (...args: unknown[]) => T {
    return fn;
  }

  /** 清空所有表（用于测试或重置） */
  clear(): void {
    this.tables.clear();
  }
}
