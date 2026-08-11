/**
 * config 命令实现
 *
 * 配置管理命令，管理 CLI 客户端的本地配置。
 * 提供以下子操作：
 * - list: 列出当前所有配置
 * - get: 获取指定配置项
 * - set: 设置配置项
 * - init: 交互式初始化配置
 * - reset: 重置为默认配置
 *
 * @module cli/commands
 */

import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { loadConfig, saveConfig, getConfigPath, getConfigValue, setConfigValue, parseConfigValue } from '../config/loader.js';
import { ConfigSchema } from '../config/schema.js';
import { OutputFormatter } from '../utils/output.js';
import { ExitCode, handleErrorAndExit, createOperationError } from '../utils/errors.js';
import type { MyOpenClawConfig } from '../config/schema.js';

/**
 * Config 命令操作类型
 */
type ConfigAction = 'list' | 'get' | 'set' | 'init' | 'reset';

/**
 * 全局选项
 */
interface GlobalOptions {
  /** Gateway HTTP 地址 */
  gateway?: string;
  /** 是否使用 JSON 输出 */
  json?: boolean;
  /** 是否显示详细日志 */
  verbose?: boolean;
}

/**
 * 创建 config 子命令
 *
 * @param config - 加载的配置对象
 * @returns Commander Command 实例
 */
export function createConfigCommand(config: MyOpenClawConfig): Command {
  const command = new Command('config')
    .description('配置管理')
    .alias('cfg')
    .argument('[action]', '操作类型: get, set, list, init, reset', 'list')
    .argument('[key]', '配置键（get/set 时使用，如 gateway.url）')
    .argument('[value]', '配置值（set 时使用）')
    .action(async (action: ConfigAction, key: string | undefined, value: string | undefined, _options: unknown, command: Command) => {
      const globalOpts = command.parent?.opts() as GlobalOptions || {};
      const formatter = new OutputFormatter(globalOpts.json ? 'json' : 'text');

      try {
        await handleConfigAction(action, key, value, config, formatter);
      } catch (error) {
        console.error(createOperationError(`配置 ${action}`, error));
        handleErrorAndExit(error, globalOpts.verbose);
      }
    });

  return command;
}

/**
 * 处理配置操作
 */
async function handleConfigAction(
  action: ConfigAction,
  key: string | undefined,
  value: string | undefined,
  config: MyOpenClawConfig,
  formatter: OutputFormatter
): Promise<void> {
  switch (action) {
    case 'list':
      await listConfig(config, formatter);
      break;
    case 'get':
      await getConfigValueAction(config, key, formatter);
      break;
    case 'set':
      await setConfigValueAction(key, value, formatter);
      break;
    case 'init':
      await initConfig(formatter);
      break;
    case 'reset':
      await resetConfig(formatter);
      break;
    default:
      console.log(chalk.red(`未知操作: ${action}`));
      console.log('可用操作: get, set, list, init, reset');
      process.exit(ExitCode.USAGE_ERROR);
  }
}

/**
 * 列出所有配置
 */
async function listConfig(config: MyOpenClawConfig, formatter: OutputFormatter): Promise<void> {
  const configPath = await getConfigPath();

  if (formatter.format === 'json') {
    formatter.print({
      config,
      configPath,
    });
    return;
  }

  console.log(chalk.bold('当前配置:'));
  console.log(chalk.gray(`配置文件路径: ${configPath}`));
  console.log();

  // Gateway 配置
  console.log(chalk.cyan('[gateway]'));
  console.log(`  url:          ${config.gateway.url}`);
  console.log(`  websocketUrl: ${config.gateway.websocketUrl}`);
  console.log();

  // Model 配置
  console.log(chalk.cyan('[model]'));
  console.log(`  default:      ${config.model.default}`);
  console.log(`  temperature:  ${config.model.temperature}`);
  console.log(`  maxTokens:    ${config.model.maxTokens}`);
  console.log();

  // Channel 配置
  console.log(chalk.cyan('[channel]'));
  console.log(`  default:      ${config.channel.default}`);
  console.log();

  // CLI 配置
  console.log(chalk.cyan('[cli]'));
  console.log(`  outputFormat: ${config.cli.outputFormat}`);
  console.log(`  timeout:      ${config.cli.timeout}`);
  console.log(`  historySize:  ${config.cli.historySize}`);
  console.log(`  enableColors: ${config.cli.enableColors}`);
  console.log();

  console.log(chalk.gray('提示: 使用 "config get <key>" 获取单个配置项'));
  console.log(chalk.gray('      使用 "config set <key> <value>" 设置配置项'));
}

/**
 * 获取单个配置值
 */
async function getConfigValueAction(
  config: MyOpenClawConfig,
  key: string | undefined,
  formatter: OutputFormatter
): Promise<void> {
  if (!key) {
    throw new Error('请提供配置键，如: config get gateway.url');
  }

  const value = getConfigValue(config, key);

  if (value === undefined) {
    throw new Error(`配置键不存在: ${key}`);
  }

  formatter.print(value);
}

/**
 * 设置配置值
 */
async function setConfigValueAction(
  key: string | undefined,
  value: string | undefined,
  formatter: OutputFormatter
): Promise<void> {
  if (!key || value === undefined) {
    throw new Error('用法: config set <key> <value>');
  }

  // 加载当前配置
  const config = await loadConfig();

  // 解析值类型
  const parsedValue = parseConfigValue(value);

  // 创建配置副本并设置值
  const configObj: Record<string, unknown> = { ...config, gateway: { ...config.gateway }, model: { ...config.model }, channel: { ...config.channel }, cli: { ...config.cli } };

  setConfigValue(configObj, key, parsedValue);

  // 使用 Zod 校验新配置
  const result = ConfigSchema.safeParse(configObj);
  if (!result.success) {
    const errorMsg = result.error.errors[0]?.message || '配置值无效';
    throw new Error(`配置值无效: ${errorMsg}`);
  }

  // 保存配置
  const savedPath = await saveConfig(configObj);

  if (formatter.format === 'json') {
    formatter.print({
      success: true,
      key,
      value: parsedValue,
      savedPath,
    });
  } else {
    console.log(chalk.green('✓'), `配置已更新: ${key} = ${parsedValue}`);
    console.log(chalk.gray(`  保存路径: ${savedPath}`));
  }
}

/**
 * 交互式初始化配置
 */
async function initConfig(formatter: OutputFormatter): Promise<void> {
  console.log(chalk.bold('MyOpenClaw CLI 配置向导'));
  console.log(chalk.gray('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log();

  try {
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'gatewayUrl',
        message: 'Gateway HTTP 地址:',
        default: 'http://localhost:18780',
      },
      {
        type: 'input',
        name: 'websocketUrl',
        message: 'Gateway WebSocket 地址:',
        default: 'ws://localhost:18780',
      },
      {
        type: 'input',
        name: 'defaultModel',
        message: '默认 LLM 模型:',
        default: 'gpt-4o',
      },
      {
        type: 'number',
        name: 'temperature',
        message: '默认温度参数 (0-2):',
        default: 0.7,
        validate: (input: number) => {
          if (input < 0 || input > 2) {
            return '温度参数必须在 0-2 之间';
          }
          return true;
        },
      },
      {
        type: 'input',
        name: 'channel',
        message: '默认渠道:',
        default: 'default',
      },
      {
        type: 'confirm',
        name: 'enableColors',
        message: '启用终端颜色输出?',
        default: true,
      },
      {
        type: 'number',
        name: 'timeout',
        message: '请求超时时间（秒）:',
        default: 60,
      },
    ]);

    const config = {
      gateway: {
        url: answers.gatewayUrl as string,
        websocketUrl: answers.websocketUrl as string,
      },
      model: {
        default: answers.defaultModel as string,
        temperature: answers.temperature as number,
        maxTokens: 4096,
      },
      channel: {
        default: answers.channel as string,
      },
      cli: {
        outputFormat: 'text' as const,
        timeout: answers.timeout as number,
        historySize: 100,
        enableColors: answers.enableColors as boolean,
      },
    };

    // 校验并保存
    const validated = ConfigSchema.parse(config);
    const savedPath = await saveConfig(validated);

    if (formatter.format === 'json') {
      formatter.print({
        success: true,
        config: validated,
        savedPath,
      });
    } else {
      console.log();
      console.log(chalk.green('✓'), '配置已保存！');
      console.log(chalk.cyan('  保存路径:'), savedPath);
      console.log();
      console.log(chalk.gray('现在可以使用以下命令开始使用:'));
      console.log(chalk.gray('  myopenclaw chat          # 启动交互式对话'));
      console.log(chalk.gray('  myopenclaw send "你好"    # 发送单条消息'));
      console.log(chalk.gray('  myopenclaw status         # 查看系统状态'));
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('ExitPromptError')) {
      console.log(chalk.gray('\n配置已取消'));
      return;
    }
    throw error;
  }
}

/**
 * 重置配置为默认值
 */
async function resetConfig(formatter: OutputFormatter): Promise<void> {
  console.log(chalk.bold('重置配置'));
  console.log(chalk.yellow('⚠'), '此操作将清除所有自定义配置，恢复为默认值');
  console.log();

  try {
    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: '确定要重置所有配置为默认值吗？',
        default: false,
      },
    ]);

    if (!confirm) {
      console.log(chalk.gray('操作已取消'));
      return;
    }

    // 重置为默认值
    const defaults = ConfigSchema.parse({});
    const savedPath = await saveConfig(defaults);

    if (formatter.format === 'json') {
      formatter.print({
        success: true,
        savedPath,
      });
    } else {
      console.log(chalk.green('✓'), '配置已重置为默认值');
      console.log(chalk.cyan('  保存路径:'), savedPath);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('ExitPromptError')) {
      console.log(chalk.gray('\n操作已取消'));
      return;
    }
    throw error;
  }
}
