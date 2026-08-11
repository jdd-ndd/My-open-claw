/**
 * 配置路径解析
 *
 * 优先级:
 * 1. 环境变量 MYOC_CONFIG_PATH (完整路径)
 * 2. 环境变量 MYOC_CONFIG_DIR (目录) + '/config.json'
 * 3. ~/.myopenclaw/config.json (用户家目录,XDG 风格)
 * 4. 失败(返回 null,调用方降级到项目 YAML)
 *
 * @module @myopenclaw/server/core/config
 */

import { homedir } from 'node:os';
import { join, resolve, isAbsolute } from 'node:path';
import { existsSync } from 'node:fs';

/** 展开 ~ 开头为用户家目录 */
export function expandHome(p: string): string {
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) {
    return join(homedir(), p.slice(1));
  }
  return p;
}

/** 解析 ~/.myopenclaw/config.json 的实际路径 */
export function resolveUserConfigPath(): string | null {
  // 1. 显式覆盖
  if (process.env.MYOC_CONFIG_PATH) {
    const p = expandHome(process.env.MYOC_CONFIG_PATH);
    return isAbsolute(p) ? p : resolve(p);
  }
  if (process.env.MYOC_CONFIG_DIR) {
    const dir = expandHome(process.env.MYOC_CONFIG_DIR);
    return join(isAbsolute(dir) ? dir : resolve(dir), 'config.json');
  }
  // 2. 默认 ~/.myopenclaw/config.json
  return join(homedir(), '.myopenclaw', 'config.json');
}

/** 检查用户配置文件是否存在 */
export function userConfigExists(): boolean {
  const p = resolveUserConfigPath();
  return p !== null && existsSync(p);
}

/** 解析项目根 config/config.yaml (保留向后兼容) */
export function resolveProjectConfigPath(cwd: string = process.cwd()): string {
  return join(cwd, 'config', 'config.yaml');
}
