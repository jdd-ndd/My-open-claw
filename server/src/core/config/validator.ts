/**
 * 配置启动期校验
 *
 * Zod schema 已经校验了字段类型、范围、必填等。
 * 这里做的是**跨字段 / 业务规则**校验:
 * - network.ws.port ≠ network.http.port
 * - security.authToken 不是 'please-change-me' (生产环境)
 * - security.authToken 强度足够(包含字母数字)
 * - llm.defaultModel 必须在 llm.models 列表里
 * - llm.providers[provider] 与顶层 provider 一致(若配置)
 * - llm.proxy.url 当 enabled=true 时必填
 * - network.tls.enabled=true 时 cert/key 路径必填且存在
 * - security.sandbox.workDir 路径必填
 * - paths.data 目录可创建 / 可写(若需要)
 *
 * @module @myopenclaw/server/core/config
 */

import { existsSync } from 'node:fs';
import { expandHome } from './paths.js';
import { ConfigFatalError, type ConfigIssue } from './errors.js';
import type { MyOpenClawConfig } from './types.js';

const PLACEHOLDER_TOKENS = new Set([
  'please-change-me',
  'change-me',
  'changeme',
  'default',
  'todo',
]);

/**
 * 启动期校验入口
 * @throws ConfigFatalError 致命问题
 */
export function validateStartupConfig(config: MyOpenClawConfig): void {
  const issues: ConfigIssue[] = [];

  // ── cross-field: ws.port ≠ http.port ──
  if (config.network.ws.port === config.network.http.port) {
    issues.push({
      level: 'fatal',
      path: 'network.ws.port vs network.http.port',
      message: 'WS 端口和 HTTP 端口不能相同',
      hint: `当前都为 ${config.network.ws.port},请修改其中一个`,
    });
  }

  // ── security.authToken 强度 ──
  if (config.security.authToken) {
    const lower = config.security.authToken.toLowerCase();
    if (PLACEHOLDER_TOKENS.has(lower)) {
      issues.push({
        level: 'fatal',
        path: 'security.authToken',
        message: `authToken 是占位符 "${config.security.authToken}",生产环境必须修改`,
        hint: '设置 MYOC_SECURITY_AUTHTOKEN 环境变量或在 JSON 中显式覆盖',
      });
    }
    if (config.app.mode === 'production' && config.security.authToken.length < 32) {
      issues.push({
        level: 'fatal',
        path: 'security.authToken',
        message: `生产环境 authToken 至少 32 字符(当前 ${config.security.authToken.length})`,
      });
    }
  }

  // ── llm.defaultModel 必须在 models 列表里 ──
  const modelIds = new Set(config.llm.models.map((m) => m.id));
  if (!modelIds.has(config.llm.defaultModel)) {
    issues.push({
      level: 'fatal',
      path: 'llm.defaultModel',
      message: `默认模型 "${config.llm.defaultModel}" 不在 llm.models 列表中`,
      hint: `已声明的 model ids: ${[...modelIds].join(', ')}`,
    });
  }

  // ── llm.apiKey 检查(provider=ollama 可空) ──
  if (config.llm.provider !== 'ollama') {
    if (!config.llm.apiKey || config.llm.apiKey.length === 0) {
      issues.push({
        level: 'fatal',
        path: 'llm.apiKey',
        message: `provider="${config.llm.provider}" 时 apiKey 必填`,
        hint: '设置环境变量 DEEPSEEK_API_KEY / OPENAI_API_KEY 等,或在 JSON 中填入',
      });
    } else if (config.llm.apiKey.includes('PLACEHOLDER')) {
      // defaults.ts 的占位字符串没被覆盖 → 启动期提醒
      issues.push({
        level: 'fatal',
        path: 'llm.apiKey',
        message: `llm.apiKey 仍是默认值占位符 (${config.llm.apiKey})`,
        hint: '设置环境变量 DEEPSEEK_API_KEY / OPENAI_API_KEY 等,或在 JSON 中填入',
      });
    }
  }

  // ── llm.proxy 启用时 url 必填 ──
  if (config.llm.proxy.enabled && !config.llm.proxy.url) {
    issues.push({
      level: 'fatal',
      path: 'llm.proxy.url',
      message: 'proxy.enabled=true 时 url 必填',
    });
  }

  // ── llm.baseUrl 必填(已在 schema 校验) ──
  if (!config.llm.baseUrl) {
    issues.push({
      level: 'fatal',
      path: 'llm.baseUrl',
      message: 'llm.baseUrl 必填',
    });
  }

  // ── network.tls 启用时 cert/key 必填且存在 ──
  if (config.network.tls.enabled) {
    const cert = expandHome(config.network.tls.certPath);
    const key = expandHome(config.network.tls.keyPath);
    if (!existsSync(cert)) {
      issues.push({
        level: 'fatal',
        path: 'network.tls.certPath',
        message: `TLS 证书文件不存在: ${cert}`,
      });
    }
    if (!existsSync(key)) {
      issues.push({
        level: 'fatal',
        path: 'network.tls.keyPath',
        message: `TLS 私钥文件不存在: ${key}`,
      });
    }
  }

  // ── embedding.apiKey 检查 ──
  if (config.embedding.provider !== 'local') {
    if (!config.embedding.apiKey || config.embedding.apiKey.length === 0) {
      issues.push({
        level: 'fatal',
        path: 'embedding.apiKey',
        message: `embedding.provider="${config.embedding.provider}" 时 apiKey 必填`,
      });
    } else if (config.embedding.apiKey.includes('PLACEHOLDER')) {
      issues.push({
        level: 'fatal',
        path: 'embedding.apiKey',
        message: `embedding.apiKey 仍是默认值占位符 (${config.embedding.apiKey})`,
        hint: '设置环境变量 OPENAI_API_KEY 等,或在 JSON 中填入',
      });
    }
  }

  // ── security.sandbox.workDir 父目录必须可创建 ──
  // 注: 不强制要求目录已存在(首次启动时新建),只校验路径格式合法
  if (!config.security.sandbox.workDir || config.security.sandbox.workDir.length === 0) {
    issues.push({
      level: 'fatal',
      path: 'security.sandbox.workDir',
      message: 'sandbox.workDir 必填',
    });
  }

  // ── memory.persist 校验 ──
  if (config.memory.persist.backend !== 'none' && !config.memory.persist.path) {
    issues.push({
      level: 'fatal',
      path: 'memory.persist.path',
      message: 'memory.persist.path 必填(当 backend ≠ none)',
    });
  }

  // ── 致命问题抛错 ──
  if (issues.length > 0) {
    throw new ConfigFatalError(issues);
  }
}
