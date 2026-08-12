import { access, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path, { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { checkHealth, createGatewayClient, getSystemStatus, GatewayApiError } from '../api/client.js';
import { getConfigPath } from '../config/loader.js';
import type { HealthCheck, SystemStatus } from '../api/types.js';
import type { MyOpenClawConfig } from '../config/schema.js';
import { OutputFormatter } from '../utils/output.js';
import { ExitCode, handleErrorAndExit } from '../utils/errors.js';

type CheckStatus = 'pass' | 'warn' | 'fail';

interface DoctorCommandOptions {}

interface GlobalOptions {
  gateway?: string;
  websocket?: string;
  json?: boolean;
  verbose?: boolean;
}

interface CheckResult {
  id: string;
  label: string;
  status: CheckStatus;
  message: string;
  critical?: boolean;
  details?: Record<string, unknown>;
}

interface WorkspaceInfo {
  root: string | null;
  skillsDir: string | null;
  memoryDir: string | null;
  channelsDir: string | null;
}

const CHANNEL_FILES = ['qqbot.yaml', 'feishu.yaml', 'wechat.yaml', 'webchat.yaml'] as const;
const REQUIRED_RUNTIME_ENV = ['DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'] as const;

export function createDoctorCommand(config: MyOpenClawConfig): Command {
  return new Command('doctor')
    .description('run local diagnostics for gateway, runtime, and workspace')
    .action(async (_options: DoctorCommandOptions, command: Command) => {
      const globalOpts = (command.parent?.opts() as GlobalOptions) || {};
      const formatter = new OutputFormatter(globalOpts.json ? 'json' : 'text');

      try {
        await runDoctor(globalOpts, config, formatter);
      } catch (error) {
        if (error instanceof GatewayApiError) {
          process.exit(ExitCode.GATEWAY_UNREACHABLE);
        }
        handleErrorAndExit(error, globalOpts.verbose);
      }
    });
}

async function runDoctor(
  globalOpts: GlobalOptions,
  config: MyOpenClawConfig,
  formatter: OutputFormatter,
): Promise<void> {
  const gatewayUrl = globalOpts.gateway || config.gateway.url;
  const websocketUrl = globalOpts.websocket || config.gateway.websocketUrl;
  const workspace = resolveWorkspaceInfo();
  const configPath = await getConfigPath();

  const spinner = ora('Running doctor checks...').start();

  let results: CheckResult[];
  try {
    results = await collectChecks({
      gatewayUrl,
      websocketUrl,
      workspace,
      configPath,
      timeoutMs: config.cli.timeout * 1000,
      verbose: globalOpts.verbose === true,
    });
    spinner.stop();
  } catch (error) {
    spinner.fail('Doctor checks failed');
    throw error;
  }

  const summary = summarizeResults(results, gatewayUrl, websocketUrl, workspace, configPath);

  if (formatter.format === 'json') {
    formatter.print(summary);
  } else {
    renderDoctorReport(summary);
  }

  if (summary.failedCritical > 0) {
    process.exit(selectExitCode(results));
  }
}

async function collectChecks(input: {
  gatewayUrl: string;
  websocketUrl: string;
  workspace: WorkspaceInfo;
  configPath: string;
  timeoutMs: number;
  verbose: boolean;
}): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  results.push({
    id: 'config-path',
    label: 'Config file',
    status: 'pass',
    message: input.configPath,
  });

  results.push(validateHttpUrl('gateway-url', 'Gateway URL', input.gatewayUrl));
  results.push(validateWsUrl('websocket-url', 'WebSocket URL', input.websocketUrl));

  const client = createGatewayClient({
    baseURL: input.gatewayUrl,
    timeout: input.timeoutMs,
    verbose: input.verbose,
  });

  try {
    const health = await checkHealth<HealthCheck>(client);
    results.push({
      id: 'gateway-health',
      label: 'Gateway health',
      status: health.status === 'healthy' ? 'pass' : 'warn',
      message: `health=${health.status}`,
      critical: true,
      details: health.components ? { components: health.components } : undefined,
    });
  } catch (error) {
    results.push({
      id: 'gateway-health',
      label: 'Gateway health',
      status: 'fail',
      message: toErrorMessage(error),
      critical: true,
    });
  }

  try {
    const status = await getSystemStatus<SystemStatus>(client);
    results.push({
      id: 'gateway-status',
      label: 'Gateway status',
      status: 'pass',
      message: `version=${status.version}, sessions=${status.activeSessions}, channels=${status.channels}`,
      critical: true,
      details: {
        status: status.status,
        uptime: status.uptime,
        connections: status.connectionCount,
        agents: Array.isArray(status.agents) ? status.agents.length : 0,
      },
    });
  } catch (error) {
    results.push({
      id: 'gateway-status',
      label: 'Gateway status',
      status: 'fail',
      message: toErrorMessage(error),
      critical: true,
    });
  }

  results.push(await inspectWorkspace(input.workspace));
  results.push(await inspectSkillsDirectory(input.workspace.skillsDir));
  results.push(await inspectMemoryDirectory(input.workspace.memoryDir));
  results.push(await inspectChannelConfigs(input.workspace.channelsDir));
  results.push(inspectEnvironment());

  return results;
}

function summarizeResults(
  results: CheckResult[],
  gatewayUrl: string,
  websocketUrl: string,
  workspace: WorkspaceInfo,
  configPath: string,
) {
  const passCount = results.filter((item) => item.status === 'pass').length;
  const warnCount = results.filter((item) => item.status === 'warn').length;
  const failCount = results.filter((item) => item.status === 'fail').length;
  const failedCritical = results.filter((item) => item.status === 'fail' && item.critical).length;

  return {
    ok: failedCritical === 0,
    passCount,
    warnCount,
    failCount,
    failedCritical,
    gatewayUrl,
    websocketUrl,
    workspaceRoot: workspace.root,
    configPath,
    checks: results,
  };
}

function renderDoctorReport(summary: ReturnType<typeof summarizeResults>): void {
  const headline = summary.ok
    ? chalk.green('MyOpenClaw doctor: ready')
    : chalk.red('MyOpenClaw doctor: action required');

  console.log(headline);
  console.log(chalk.gray(`Gateway: ${summary.gatewayUrl}`));
  console.log(chalk.gray(`WebSocket: ${summary.websocketUrl}`));
  console.log(chalk.gray(`Workspace: ${summary.workspaceRoot ?? 'not detected'}`));
  console.log(chalk.gray(`Config: ${summary.configPath}`));
  console.log();

  for (const check of summary.checks) {
    console.log(`${formatStatus(check.status)} ${chalk.bold(check.label)}`);
    console.log(`  ${check.message}`);

    if (check.details) {
      for (const [key, value] of Object.entries(check.details)) {
        console.log(`  ${chalk.gray(`${key}:`)} ${formatValue(value)}`);
      }
    }

    console.log();
  }

  console.log(
    `${chalk.green(`${summary.passCount} passed`)}, ${chalk.yellow(`${summary.warnCount} warnings`)}, ${chalk.red(`${summary.failCount} failed`)}`,
  );
}

function validateHttpUrl(id: string, label: string, value: string): CheckResult {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return {
        id,
        label,
        status: 'fail',
        message: `unsupported protocol: ${parsed.protocol}`,
        critical: true,
      };
    }

    return {
      id,
      label,
      status: 'pass',
      message: value,
      critical: true,
    };
  } catch {
    return {
      id,
      label,
      status: 'fail',
      message: `invalid URL: ${value}`,
      critical: true,
    };
  }
}

function validateWsUrl(id: string, label: string, value: string): CheckResult {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
      return {
        id,
        label,
        status: 'warn',
        message: `expected ws:// or wss://, got ${parsed.protocol}`,
      };
    }

    return {
      id,
      label,
      status: 'pass',
      message: value,
    };
  } catch {
    return {
      id,
      label,
      status: 'fail',
      message: `invalid URL: ${value}`,
      critical: true,
    };
  }
}

function resolveWorkspaceInfo(): WorkspaceInfo {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [process.cwd(), moduleDir];

  const root = findWorkspaceRoot(candidates);
  if (!root) {
    return {
      root: null,
      skillsDir: null,
      memoryDir: null,
      channelsDir: null,
    };
  }

  return {
    root,
    skillsDir: process.env.MYOC_PROJECT_SKILLS_DIR
      ? resolve(process.env.MYOC_PROJECT_SKILLS_DIR)
      : path.join(root, 'server', 'skills'),
    memoryDir: process.env.MYOC_MEMORY_DIR
      ? resolve(process.env.MYOC_MEMORY_DIR)
      : path.join(root, 'server', 'data', 'memory'),
    channelsDir: path.join(root, 'config', 'channels'),
  };
}

function findWorkspaceRoot(startDirs: string[]): string | null {
  const MAX_DEPTH = 20;
  for (const startDir of startDirs) {
    let current = resolve(startDir);

    for (let depth = 0; depth < MAX_DEPTH; depth++) {
      const serverDir = path.join(current, 'server');
      const clientsDir = path.join(current, 'clients');
      const configDir = path.join(current, 'config');

      if (existsSync(serverDir) && existsSync(clientsDir) && existsSync(configDir)) {
        return current;
      }

      const parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
  }

  return null;
}

async function inspectWorkspace(workspace: WorkspaceInfo): Promise<CheckResult> {
  if (!workspace.root) {
    return {
      id: 'workspace',
      label: 'Workspace root',
      status: 'warn',
      message: 'project root not detected from current working directory or CLI module path',
    };
  }

  return {
    id: 'workspace',
    label: 'Workspace root',
    status: 'pass',
    message: workspace.root,
  };
}

async function inspectSkillsDirectory(skillsDir: string | null): Promise<CheckResult> {
  if (!skillsDir) {
    return {
      id: 'skills-dir',
      label: 'Skills directory',
      status: 'warn',
      message: 'skipped because workspace root was not detected',
    };
  }

  try {
    await access(skillsDir);
    return {
      id: 'skills-dir',
      label: 'Skills directory',
      status: 'pass',
      message: skillsDir,
    };
  } catch {
    return {
      id: 'skills-dir',
      label: 'Skills directory',
      status: 'warn',
      message: `not found: ${skillsDir}`,
      details: { envOverride: process.env.MYOC_PROJECT_SKILLS_DIR ?? null },
    };
  }
}

async function inspectMemoryDirectory(memoryDir: string | null): Promise<CheckResult> {
  if (!memoryDir) {
    return {
      id: 'memory-dir',
      label: 'Memory directory',
      status: 'warn',
      message: 'skipped because workspace root was not detected',
    };
  }

  try {
    await access(memoryDir);
    return {
      id: 'memory-dir',
      label: 'Memory directory',
      status: 'pass',
      message: memoryDir,
    };
  } catch {
    return {
      id: 'memory-dir',
      label: 'Memory directory',
      status: 'warn',
      message: `not found yet: ${memoryDir}`,
      details: { note: 'the runtime can create this directory on first initialization' },
    };
  }
}

async function inspectChannelConfigs(channelsDir: string | null): Promise<CheckResult> {
  if (!channelsDir) {
    return {
      id: 'channel-configs',
      label: 'Channel configs',
      status: 'warn',
      message: 'skipped because workspace root was not detected',
    };
  }

  try {
    await access(channelsDir);
  } catch {
    return {
      id: 'channel-configs',
      label: 'Channel configs',
      status: 'warn',
      message: `missing directory: ${channelsDir}`,
    };
  }

  const present: string[] = [];
  const enabled: string[] = [];

  for (const fileName of CHANNEL_FILES) {
    const filePath = path.join(channelsDir, fileName);
    if (!existsSync(filePath)) {
      continue;
    }

    present.push(fileName);

    const content = await readFile(filePath, 'utf-8');
    if (/enabled\s*:\s*true/i.test(content)) {
      enabled.push(fileName.replace(/\.yaml$/i, ''));
    }
  }

  if (present.length === 0) {
    return {
      id: 'channel-configs',
      label: 'Channel configs',
      status: 'warn',
      message: 'no channel YAML files found',
      details: { expectedDir: channelsDir },
    };
  }

  return {
    id: 'channel-configs',
    label: 'Channel configs',
    status: enabled.length > 0 ? 'pass' : 'warn',
    message: `${present.length} config files found, ${enabled.length} enabled`,
    details: {
      files: present,
      enabled,
    },
  };
}

function inspectEnvironment(): CheckResult {
  const configuredRuntimeKeys = REQUIRED_RUNTIME_ENV.filter((name) => Boolean(process.env[name]));
  const embeddingProvider = process.env.EMBEDDING_PROVIDER ?? 'local';

  if (configuredRuntimeKeys.length > 0) {
    return {
      id: 'runtime-env',
      label: 'Runtime environment',
      status: 'pass',
      message: `${configuredRuntimeKeys.length} common LLM credential variables detected`,
      details: {
        llmKeys: configuredRuntimeKeys,
        embeddingProvider,
      },
    };
  }

  return {
    id: 'runtime-env',
    label: 'Runtime environment',
    status: 'warn',
    message: 'no common LLM credential variables detected in current shell',
    details: {
      checked: REQUIRED_RUNTIME_ENV,
      embeddingProvider,
    },
  };
}

function selectExitCode(results: CheckResult[]): number {
  if (results.some((item) => item.critical && item.id.startsWith('gateway-') && item.status === 'fail')) {
    return ExitCode.GATEWAY_UNREACHABLE;
  }

  return ExitCode.CONFIG_ERROR;
}

function formatStatus(status: CheckStatus): string {
  switch (status) {
    case 'pass':
      return chalk.green('[PASS]');
    case 'warn':
      return chalk.yellow('[WARN]');
    case 'fail':
      return chalk.red('[FAIL]');
    default:
      return status;
  }
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.join(', ');
  }

  if (value && typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
