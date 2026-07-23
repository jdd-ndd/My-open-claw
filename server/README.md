# @myopenclaw/server

MyOpenClaw 服务端核心包，包含 Gateway 网关、Channels 渠道适配、Agent Runtime 智能体运行时、Tools 工具执行、Skills 技能描述、Memory 记忆存储、Core 公共基础模块和 Hooks 生命周期钩子。

## 目录结构

```
server/
├── src/                    # TypeScript 源码
│   ├── index.ts            # 服务端统一入口
│   ├── core/               # 公共基础模块（配置、日志、类型、错误、Schema、常量、工具函数）
│   ├── gateway/            # 网关核心模块（控制平面入口）
│   ├── channels/           # 全渠道适配器
│   ├── agents/             # Agent 智能体运行时核心
│   ├── tools/              # 底层可执行工具
│   ├── skills/             # 技能描述框架
│   ├── memory/             # 持久记忆存储引擎
│   └── hooks/              # 生命周期钩子
├── config/                 # 配置模板（YAML）
├── skills/                 # 业务技能库（SKILL.md 描述式技能）
├── tests/                  # 测试用例
├── scripts/                # 构建与运维脚本
├── Dockerfile              # 容器化构建文件
├── package.json
└── tsconfig.json
```

## 开发

```bash
# 开发模式（热重载）
pnpm dev

# 类型检查
pnpm typecheck

# 构建
pnpm build
```
