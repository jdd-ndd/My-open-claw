/**
 * 默认配置值
 *
 * 定义 CLI 客户端的完整默认配置，包括 Gateway 连接参数、
 * LLM 模型设置、渠道配置和 CLI 行为选项。这些默认值作为
 * 配置加载的基础，用户可通过配置文件或命令行参数覆盖。
 *
 * @module cli/config
 */

import type { MyOpenClawConfig } from './schema.js';
import { SHARED_CHANNEL_ID } from './sync-defaults.js';

/**
 * CLI 客户端默认配置
 *
 * 当没有找到任何配置文件时使用此配置作为 fallback。
 * 所有字段均有合理的默认值，确保 CLI 开箱即用。
 */
export const DEFAULT_CONFIG: MyOpenClawConfig = {
  gateway: {
    url: 'http://localhost:18780',
    websocketUrl: 'ws://localhost:18780/ws',
  },
  model: {
    default: 'gpt-4o',
    temperature: 0.7,
    maxTokens: 4096,
  },
  channel: {
    default: SHARED_CHANNEL_ID,
  },
  cli: {
    outputFormat: 'text',
    timeout: 60,
    historySize: 100,
    enableColors: true,
  },
};

/**
 * 配置文件查找路径
 *
 * 按优先级从高到低排列。CLI 会依次检查这些位置，
 * 找到第一个有效配置文件后停止查找。
 *
 * 优先级说明：
 * 1. 命令行指定的 --config 参数
 * 2. 环境变量 OPENCLAW_CONFIG 指向的文件
 * 3. 当前工作目录下的 .myopenclawrc
 * 4. 当前工作目录下的 .myopenclaw/config
 * 5. 用户主目录下的 ~/.myopenclawrc
 * 6. 用户主目录下的 ~/.config/myopenclaw/config
 */
export const CONFIG_SEARCH_PATHS = {
  /** 用户主目录配置文件名 */
  RC_FILE: '.myopenclawrc',
  /** 项目级配置目录名 */
  CONFIG_DIR: '.myopenclaw',
  /** 系统级配置路径后缀 */
  SYSTEM_CONFIG_PATH: '.config/myopenclaw/config',
  /** 环境变量名：指定配置文件路径 */
  ENV_CONFIG_PATH: 'OPENCLAW_CONFIG',
  /** 环境变量名：Gateway URL 快捷设置 */
  ENV_GATEWAY_URL: 'OPENCLAW_GATEWAY',
  /** 环境变量名：默认模型快捷设置 */
  ENV_DEFAULT_MODEL: 'OPENCLAW_MODEL',
  /** 配置文件名 */
  CONFIG_FILE_NAME: 'config',
} as const;

/**
 * 支持的配置文件格式
 */
export const SUPPORTED_CONFIG_FORMATS = {
  JSON: 'json',
  YAML: 'yaml',
  YML: 'yml',
  JavaScript: 'js',
  CJS: 'cjs',
  MJS: 'mjs',
} as const;

/**
 * 配置优先级层级
 *
 * 数字越小优先级越高，高优先级的配置会覆盖低优先级的配置。
 */
export const CONFIG_PRIORITY = {
  /** 命令行参数（最高优先级） */
  CLI_ARGS: 1,
  /** 环境变量 */
  ENV_VARS: 2,
  /** 项目级配置文件 */
  PROJECT_CONFIG: 3,
  /** 用户级配置文件 */
  USER_CONFIG: 4,
  /** 系统级配置文件 */
  SYSTEM_CONFIG: 5,
  /** 内置默认值（最低优先级） */
  DEFAULTS: 6,
} as const;
