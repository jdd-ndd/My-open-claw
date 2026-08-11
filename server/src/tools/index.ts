/**
 * Tools — 工具模块聚合导出（v1.0.2 完整版）
 *
 * 导出所有内置工具、ToolRegistry、SecurityManager。
 * 构建时统一使用 createToolRegistry() 工厂函数快速组装完整工具集。
 *
 * @module @myopenclaw/server/tools
 */

import { ToolRegistry } from './registry.js';
import {
  FsReadFileTool,
  FsWriteFileTool,
  FsDeleteTool,
  FsListDirTool,
} from './fs/index.js';
import {
  ExecShellTool,
  ExecProcessTool,
} from './exec/index.js';
import {
  BrowserOpenTool,
  BrowserClickTool,
  BrowserFillFormTool,
  BrowserScrapeTool,
} from './browser/index.js';
import { MemorySearchTool } from './memory_search/index.js';
import { HttpRequestTool } from './http/index.js';
import { SystemTimeTool, PptMakeTool } from './system/index.js';
import { WeatherLookupTool, WeatherCurrentTool, WeatherForecastTool } from './weather/index.js';
import { ExchangeRateTool, IpLocationTool, HolidaysTool, TopNewsTool, CryptoPriceTool } from './utility/index.js';
import { RoutingGeocodeTool, RoutingPlanTool } from './routing/index.js';
import {
  CalculatorExpressTool,
  CalculatorUnitTool,
  CalculatorCurrencyTool,
  CalculatorBaseTool,
} from './calculator/index.js';
import { createLogger } from '../core/utils/logger.js';
import type { MemoryManager } from '../memory/manager.js';

const log = createLogger('tools:factory');

/**
 * 工具集工厂 — 快速创建并注册全部内置工具的注册中心
 *
 * 默认装载 13 个内置工具(对齐 docs/06 §4):
 * - fs/read_file, fs/write_file, fs/delete, fs/list_dir
 * - exec/shell, exec/process
 * - browser/open, browser/click, browser/fill_form, browser/scrape
 * - memory_search/search
 * - system/time
 * - http/get, http/post
 *
 * 使用示例:
 * ```ts
 * const registry = await createToolRegistry();
 * await registry.invoke('fs/read_file', { path: '/etc/hosts' }, ctx);
 * ```
 */
export async function createToolRegistry(options?: { force?: boolean; memory?: MemoryManager }): Promise<ToolRegistry> {
  const registry = new ToolRegistry();
  const vectorMemory = options?.memory?.vector;
  const force = options?.force ?? true; // 多次调用同进程安全

  const builtinTools = [
    new FsReadFileTool(),
    new FsWriteFileTool(),
    new FsDeleteTool(),
    new FsListDirTool(),
    new ExecShellTool(),
    new ExecProcessTool(),
    new BrowserOpenTool(),
    new BrowserClickTool(),
    new BrowserFillFormTool(),
    new BrowserScrapeTool(),
    new MemorySearchTool(vectorMemory),
    new SystemTimeTool(),
    new PptMakeTool(),
    new WeatherLookupTool(),
    new WeatherCurrentTool(),
    new WeatherForecastTool(),
    new ExchangeRateTool(),
    new IpLocationTool(),
    new HolidaysTool(),
    new TopNewsTool(),
    new CryptoPriceTool(),
    new RoutingGeocodeTool(),
    new RoutingPlanTool(),
    new CalculatorExpressTool(),
    new CalculatorUnitTool(),
    new CalculatorCurrencyTool(),
    new CalculatorBaseTool(),
    new HttpRequestTool(),
  ];

  for (const tool of builtinTools) {
    await registry.register(tool, { builtin: true, force });
  }

  log.info({ count: builtinTools.length }, '内置工具集已注册');
  return registry;
}

// ── 注册中心 ──
export { ToolRegistry } from './registry.js';

// ── 安全模块 ──
export { SecurityManager, getSecurityManager, resetSecurityManager } from './security/index.js';
export type { DangerousPattern } from './security/index.js';

// ── 文件操作工具 ──
export {
  FsReadFileTool,
  FsWriteFileTool,
  FsDeleteTool,
  FsListDirTool,
  FsTool,
} from './fs/index.js';

// ── 系统执行工具 ──
export {
  ExecShellTool,
  ExecProcessTool,
  ExecTool,
} from './exec/index.js';

// ── 浏览器工具 ──
export {
  BrowserOpenTool,
  BrowserClickTool,
  BrowserFillFormTool,
  BrowserScrapeTool,
  BrowserTool,
} from './browser/index.js';

// ── 记忆检索工具 ──
export { MemorySearchTool } from './memory_search/index.js';
export { SystemTimeTool, PptMakeTool } from './system/index.js';
export { WeatherLookupTool, WeatherCurrentTool, WeatherForecastTool } from './weather/index.js';
export { ExchangeRateTool, IpLocationTool, HolidaysTool, TopNewsTool, CryptoPriceTool } from './utility/index.js';
export { RoutingGeocodeTool, RoutingPlanTool } from './routing/index.js';
export {
  CalculatorExpressTool,
  CalculatorUnitTool,
  CalculatorCurrencyTool,
  CalculatorBaseTool,
} from './calculator/index.js';

// ── 网络请求工具 ──
export {
  HttpRequestTool,
  HttpTool,
} from './http/index.js';

// ── 类型重导出（便捷导入） ──
export type {
  Tool,
  ToolResult,
  ToolContext,
  InvokeContext,
  RegisterOptions,
  ToolFilter,
  ToolDescriptor,
  ToolCall,
  RegistryChangeEvent,
  JSONSchema,
} from '../core/types/index.js';
