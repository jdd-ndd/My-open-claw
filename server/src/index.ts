/**
 * MyOpenClaw 服务端统一入口
 *
 * 启动 Gateway 网关守护进程，并按需加载 Channels、Agent Runtime、
 * Tools、Skills、Memory 等子模块。
 */

import { GatewayServer } from './gateway/index.js';
import { loadConfig, ConfigFatalError, resolveUserConfigPath, userConfigExists } from './core/config/index.js';
import { createLogger } from './core/utils/logger.js';

const log = createLogger('myopenclaw');
let shutdownHooksRegistered = false;

function registerShutdownHooks(gateway: GatewayServer): void {
  if (shutdownHooksRegistered) {
    return;
  }

  shutdownHooksRegistered = true;

  const shutdown = async (signal: string) => {
    log.info({ signal }, '收到关闭信号，正在关闭 Gateway...');
    await gateway.stop();
    process.exit(0);
  };

  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

function logConfigSummary(): void {
  const cfg = loadConfig() as Record<string, unknown>;
  const userCfg = userConfigExists() ? resolveUserConfigPath() : null;
  const mode = (cfg.app as Record<string, unknown>)?.mode ?? 'unknown';
  const network = cfg.network as Record<string, Record<string, unknown>>;
  const llm = cfg.llm as Record<string, unknown>;

  log.info(
    {
      configSource: userCfg ? 'json' : 'yaml',
      userConfigPath: userCfg,
      mode,
      ws: `${network.ws?.host}:${network.ws?.port}`,
      http: `${network.http?.host}:${network.http?.port}`,
      llmProvider: llm.provider,
      llmModel: llm.defaultModel,
      hasApiKey: !!(llm.apiKey && String(llm.apiKey).length > 0),
    },
    '配置加载成功',
  );
}

async function main(): Promise<void> {
  try {
    loadConfig();
    logConfigSummary();
  } catch (err) {
    if (err instanceof ConfigFatalError) {
      process.stderr.write(`\n[MyOpenClaw] 因配置错误启动中止。\n`);
      process.exit(1);
    }
    throw err;
  }

  const gateway = new GatewayServer();
  registerShutdownHooks(gateway);

  await gateway.start();
  log.info({ port: gateway.config.port }, 'Gateway 已启动');
}

main().catch((err) => {
  if (err instanceof ConfigFatalError) {
    process.exit(1);
  }

  log.error({ err: (err as Error).message, stack: (err as Error).stack }, '启动失败');
  process.exit(1);
});
