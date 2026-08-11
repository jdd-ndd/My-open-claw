/**
 * MemoryStorage 内存存储适配器单元测试
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStorage } from '../../../src/gateway/storage.js';

describe('Gateway - MemoryStorage', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  describe('ensureTable', () => {
    it('应能创建新表', () => {
      storage.ensureTable('users', '');
      // ensureTable 不应抛出错误，重复调用也不应报错
      expect(() => storage.ensureTable('users', '')).not.toThrow();
    });

    it('重复创建同名表不应报错', () => {
      storage.ensureTable('users', '');
      storage.ensureTable('users', '');
      storage.ensureTable('users', '');

      // 重复创建后表仍可用
      const stmt = storage.prepare('SELECT * FROM users');
      const rows = stmt.all();
      expect(rows).toEqual([]);
    });
  });

  describe('prepare().run()', () => {
    it('应能插入行数据', () => {
      storage.ensureTable('users', '');
      const stmt = storage.prepare('INSERT INTO users (id, name) VALUES (?, ?)');
      expect(() => stmt.run('user-1', 'alice')).not.toThrow();
    });

    it('未建表时插入应自动创建表', () => {
      const stmt = storage.prepare('INSERT INTO tasks (id, name) VALUES (?, ?)');
      expect(() => stmt.run('task-1', 'task-name')).not.toThrow();
    });
  });

  describe('prepare().get()', () => {
    it('应能通过 ID 检索已插入的行', () => {
      storage.ensureTable('users', '');
      storage.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run('user-1', 'alice');
      storage.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run('user-2', 'bob');

      const row = storage.prepare('SELECT * FROM users WHERE id = ?').get('user-1');
      expect(row).toBeDefined();
      expect(row?.id).toBe('user-1');
    });

    it('查询不存在的 ID 应返回 undefined', () => {
      storage.ensureTable('users', '');
      storage.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run('user-1', 'alice');

      const row = storage.prepare('SELECT * FROM users WHERE id = ?').get('nonexistent');
      expect(row).toBeUndefined();
    });

    it('查询不存在的表应返回 undefined', () => {
      const row = storage.prepare('SELECT * FROM nonexistent_table').get('any-id');
      expect(row).toBeUndefined();
    });
  });

  describe('prepare().all()', () => {
    it('应返回所有行', () => {
      storage.ensureTable('users', '');
      storage.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run('user-1', 'alice');
      storage.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run('user-2', 'bob');
      storage.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run('user-3', 'charlie');

      const rows = storage.prepare('SELECT * FROM users').all();
      expect(rows).toHaveLength(3);
      expect(rows.map((r) => r.id)).toEqual(['user-1', 'user-2', 'user-3']);
    });

    it('空表应返回空数组', () => {
      storage.ensureTable('empty_table', '');
      const rows = storage.prepare('SELECT * FROM empty_table').all();
      expect(rows).toEqual([]);
    });

    it('不存在的表应返回空数组', () => {
      const rows = storage.prepare('SELECT * FROM missing_table').all();
      expect(rows).toEqual([]);
    });
  });

  describe('多表独立性', () => {
    it('不同表之间数据应相互隔离', () => {
      storage.ensureTable('users', '');
      storage.ensureTable('tasks', '');

      storage.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run('u1', 'alice');
      storage.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run('u2', 'bob');
      storage.prepare('INSERT INTO tasks (id, name) VALUES (?, ?)').run('t1', 'task-alpha');
      storage.prepare('INSERT INTO tasks (id, name) VALUES (?, ?)').run('t2', 'task-beta');
      storage.prepare('INSERT INTO tasks (id, name) VALUES (?, ?)').run('t3', 'task-gamma');

      const users = storage.prepare('SELECT * FROM users').all();
      const tasks = storage.prepare('SELECT * FROM tasks').all();

      expect(users).toHaveLength(2);
      expect(tasks).toHaveLength(3);
    });

    it('一表的数据不应出现在另一表中', () => {
      storage.ensureTable('users', '');
      storage.ensureTable('orders', '');

      storage.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run('u1', 'alice');
      storage.prepare('INSERT INTO orders (id, name) VALUES (?, ?)').run('o1', 'order-001');

      const users = storage.prepare('SELECT * FROM users').all();
      expect(users.map((r) => r.id)).toEqual(['u1']);

      const orders = storage.prepare('SELECT * FROM orders').all();
      expect(orders.map((r) => r.id)).toEqual(['o1']);
    });
  });
});
