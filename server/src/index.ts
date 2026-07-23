/**
 * MyOpenClaw 服务端统一入口
 *
 * 启动 Gateway 网关守护进程，按需加载 Channels、Agent Runtime、
 * Tools、Skills、Memory 等子模块。
 *
 * @author MyOpenClaw Core Team
 * @since 1.0.0
 */

import { GatewayServer } from './gateway/index.js';

/** 应用主启动函数 */
async function main(): Promise<void> {
  const gateway = new GatewayServer();

  // 注册优雅退出处理
  const shutdown = async (signal: string) => {
    console.log(`[MyOpenClaw] 收到 ${signal} 信号，正在关闭...`);
    await gateway.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // 启动网关
  await gateway.start();
  console.log(`[MyOpenClaw] Gateway 已启动 (端口: ${gateway.config.port})`);
}

main().catch((err) => {
  console.error('[MyOpenClaw] 启动失败:', err);
  process.exit(1);
});
