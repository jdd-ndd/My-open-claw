#!/usr/bin/env node

/**
 * MyOpenClaw CLI 客户端入口文件
 *
 * 这是 CLI 客户端的主入口点，负责：
 * 1. 加载配置文件
 * 2. 创建 Commander 程序实例
 * 3. 注册所有子命令
 * 4. 解析命令行参数并执行对应命令
 *
 * 命令体系：
 * - chat:    交互式对话模式
 * - send:    发送单条消息
 * - sessions: 会话管理
 * - tools:   工具管理
 * - skills:  技能管理
 * - config:  配置管理
 * - status:  系统状态查询
 * - logs:    日志查看
 * - doctor:  系统诊断 (gateway / workspace / env)
 *
 * @module cli
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig, clearConfigCache } from './config/loader.js';
import { createChatCommand } from './commands/chat.js';
import { createSendCommand } from './commands/send.js';
import { createSessionsCommand } from './commands/sessions.js';
import { createToolsCommand } from './commands/tools.js';
import { createSkillsCommand } from './commands/skills.js';
import { createConfigCommand } from './commands/config.js';
import { createStatusCommand } from './commands/status.js';
import { createLogsCommand } from './commands/logs.js';
import { createPptCommand } from './commands/ppt.js';
import { createDoctorCommand } from './commands/doctor.js';
import { createMemoryCommand } from './commands/memory.js';
import { OutputFormatter } from './utils/output.js';
import { ExitCode } from './utils/errors.js';

/**
 * CLI 版本号
 */
const CLI_VERSION = '1.1.5';

/**
 * MyOpenClaw CLI 主函数
 *
 * 完整的启动流程：
 * 1. 加载配置（文件 → 环境变量 → 默认值）
 * 2. 创建 Commander 程序并注册全局选项
 * 3. 注册所有子命令
 * 4. 解析命令行参数并执行
 * 5. 统一处理未捕获的错误
 */
async function main(): Promise<void> {
  // ── 步骤 1: 加载配置 ──
  let config;
  try {
    config = await loadConfig();
  } catch (error) {
    // 配置加载失败，使用默认配置继续
    const formatter = new OutputFormatter();
    formatter.warning(`配置加载失败: ${error instanceof Error ? error.message : String(error)}`);
    formatter.info('使用默认配置继续...');
    // 重新加载（使用默认值）
    clearConfigCache();
    config = await loadConfig({ useCache: false });
  }

  // ── 步骤 2: 创建顶层命令 ──
  const program = new Command('myopenclaw')
    .description('MyOpenClaw CLI - 本地优先的 AI Agent 命令行客户端')
    .version(CLI_VERSION, '-V, --version', '显示版本号')
    // 全局选项：所有子命令均可使用
    .option('-g, --gateway <url>', 'Gateway HTTP 地址', config.gateway.url)
    .option('-w, --websocket <url>', 'Gateway WebSocket 地址', config.gateway.websocketUrl)
    .option('-j, --json', '以 JSON 格式输出结果（适合脚本解析）', false)
    .option('-v, --verbose', '显示详细日志和调试信息', false)
    .option('--no-color', '禁用终端颜色输出')
    // 配置全局帮助信息格式
    .configureHelp({
      sortSubcommands: true,
      showGlobalOptions: true,
    })
    // 配置 usage 模板
    .configureOutput({
      writeOut: (str) => process.stdout.write(str),
      writeErr: (str) => process.stderr.write(str),
    });

  // ── 步骤 3: 全局前置钩子 ──
  program.hook('preAction', (thisCommand) => {
    const options = thisCommand.opts();

    // 根据 --no-color 选项禁用 chalk 颜色
    if (options.color === false) {
      process.env.FORCE_COLOR = '0';
    }

    // 在 verbose 模式下打印配置信息
    if (options.verbose) {
      console.error(chalk.gray('═══ 调试信息 ═══'));
      console.error(chalk.gray('配置:'), JSON.stringify(config, null, 2));
      console.error(chalk.gray('选项:'), JSON.stringify(options, null, 2));
      console.error(chalk.gray('═══════════════'));
      console.error();
    }
  });

  // ── 步骤 4: 全局后置钩子 ──
  program.hook('postAction', () => {
    // 命令执行完成后的清理工作
    if (config) {
      // 确保配置缓存已更新
    }
  });

  // ── 步骤 5: 注册所有子命令 ──
  program.addCommand(createChatCommand(config));
  program.addCommand(createSendCommand(config));
  program.addCommand(createSessionsCommand(config));
  program.addCommand(createToolsCommand(config));
  program.addCommand(createSkillsCommand(config));
  program.addCommand(createConfigCommand(config));
  program.addCommand(createStatusCommand(config));
  program.addCommand(createLogsCommand(config));
  program.addCommand(createPptCommand(config));
  program.addCommand(createDoctorCommand(config));
  program.addCommand(createMemoryCommand(config));

  // ── 步骤 6: 添加补全命令 ──
  // 生成 Shell 补全脚本
  program
    .command('completions <shell>')
    .description('生成 Shell 命令补全脚本')
    .helpOption(false)
    .action((shell: string) => {
      const shellLower = shell.toLowerCase();
      let script = '';

      switch (shellLower) {
        case 'bash':
          script = generateBashCompletions();
          break;
        case 'zsh':
          script = generateZshCompletions();
          break;
        case 'fish':
          script = generateFishCompletions();
          break;
        default:
          console.error(`不支持的 Shell: ${shell}`);
          console.error('支持的 Shell: bash, zsh, fish');
          process.exit(ExitCode.USAGE_ERROR);
      }

      console.log(script);
    });

  // ── 步骤 7: 解析命令行参数并执行 ──
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    const formatter = new OutputFormatter();
    const message = error instanceof Error ? error.message : String(error);
    formatter.error(message);

    // 根据错误类型确定退出码
    let exitCode: number = ExitCode.GENERAL_ERROR;
    if (message.includes('ECONNREFUSED') || message.includes('无法连接')) {
      exitCode = ExitCode.GATEWAY_UNREACHABLE;
    } else if (message.includes('超时') || message.includes('timeout')) {
      exitCode = ExitCode.TIMEOUT;
    } else if (message.includes('参数') || message.includes('用法')) {
      exitCode = ExitCode.USAGE_ERROR;
    }

    process.exit(exitCode);
  }
}

// ── Shell 补全脚本生成 ──

/**
 * 生成 Bash 补全脚本
 */
function generateBashCompletions(): string {
  return `# Bash completion for myopenclaw
# 安装: myopenclaw completions bash > /etc/bash_completion.d/myopenclaw

_myopenclaw_completions() {
  local cur prev opts commands
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"

  commands="chat send sessions memory tools skills config status logs ppt doctor completions help"

  opts="--gateway --websocket --json --verbose --no-color --help --version"

  # 子命令选项
  case "\${prev}" in
    myopenclaw)
      COMPREPLY=(\\$(compgen -W "\${commands}" -- "\${cur}"))
      return 0
      ;;
    chat)
      COMPREPLY=(\\$(compgen -W "--session --model --channel --no-stream --help" -- "\${cur}"))
      return 0
      ;;
    send)
      COMPREPLY=(\\$(compgen -W "--session --model --file --no-stream --wait --help" -- "\${cur}"))
      return 0
      ;;
    sessions)
      COMPREPLY=(\\$(compgen -W "list list-all create delete switch rename clear --title --limit --help" -- "\${cur}"))
      return 0
      ;;
    memory)
      COMPREPLY=(\\$(compgen -W "list search show clear --topK --threshold --session --vector --force --limit --help" -- "\${cur}"))
      return 0
      ;;
    tools)
      COMPREPLY=(\\$(compgen -W "list info execute --args --help" -- "\${cur}"))
      return 0
      ;;
    skills)
      COMPREPLY=(\\$(compgen -W "list info use --file --help" -- "\${cur}"))
      return 0
      ;;
    config)
      COMPREPLY=(\\$(compgen -W "get set list init reset --help" -- "\${cur}"))
      return 0
      ;;
    status)
      COMPREPLY=(\\$(compgen -W "--watch --help" -- "\${cur}"))
      return 0
      ;;
    logs)
      COMPREPLY=(\\$(compgen -W "--follow --lines --level --since --help" -- "\${cur}"))
      return 0
      ;;
    ppt)
      COMPREPLY=(\\$(compgen -W "themes templates make --theme --spec --out --help" -- "\${cur}"))
      return 0
      ;;
    doctor)
      COMPREPLY=(\\$(compgen -W "--help" -- "\${cur}"))
      return 0
      ;;
  esac

  # 全局选项补全
  if [[ "\${cur}" == -* ]]; then
    COMPREPLY=(\\$(compgen -W "\${opts}" -- "\${cur}"))
    return 0
  fi
}

complete -F _myopenclaw_completions myopenclaw
`;
}

/**
 * 生成 Zsh 补全脚本
 */
function generateZshCompletions(): string {
  return `# Zsh completion for myopenclaw
# 安装: myopenclaw completions zsh > /usr/local/share/zsh/site-functions/_myopenclaw

#compdef myopenclaw

_myopenclaw() {
  local -a commands
  commands=(
    'chat:进入交互式对话模式'
    'send:发送单条消息'
    'sessions:会话管理'
    'memory:Memory管理(v1.1.8+ list/search/show/clear)'
    'tools:工具管理'
    'skills:技能管理'
    'config:配置管理'
    'status:系统状态查询'
    'logs:日志查看'
    'ppt:PPT制作'
    'doctor:系统诊断'
    'completions:生成Shell补全脚本'
    'help:显示帮助信息'
  )

  _arguments -C \\
    '(- *)'{-V,--version}'[显示版本号]' \\
    '(- *)'{-h,--help}'[显示帮助信息]' \\
    '(-g --gateway)'{-g,--gateway}'[Gateway地址]:url:_urls' \\
    '(-w --websocket)'{-w,--websocket}'[WebSocket地址]:url:_urls' \\
    '(-j --json)'{-j,--json}'[以JSON格式输出]' \\
    '(-v --verbose)'{-v,--verbose}'[显示详细日志]' \\
    '(- *)--no-color[禁用颜色输出]' \\
    '1:command:->command' \\
    '*::arg:->args'

  case $state in
    command)
      _describe -t commands 'commands' commands
      ;;
    args)
      case $words[1] in
        chat)
          _arguments \\
            '(-s --session)'{-s,--session}'[会话ID]:id' \\
            '(-m --model)'{-m,--model}'[模型名称]:model' \\
            '(-c --channel)'{-c,--channel}'[渠道]:channel' \\
            '--no-stream[禁用流式输出]' \\
            '(-h --help)'{-h,--help}'[显示帮助]'
          ;;
        send)
          _arguments \\
            '(-s --session)'{-s,--session}'[会话ID]:id' \\
            '(-m --model)'{-m,--model}'[模型名称]:model' \\
            '(-f --file)'{-f,--file}'[附件文件]:file:_files' \\
            '--no-stream[禁用流式输出]' \\
            '(-w --wait)'{-w,--wait}'[超时时间]:seconds' \\
            '(-h --help)'{-h,--help}'[显示帮助]' \\
            '1:message:message'
          ;;
        memory)
          _arguments \\
            '1:action:(list search show clear)' \\
            '2:target:target' \\
            '--topK[topK]:n' \\
            '--threshold[threshold]:n' \\
            '--session[限定sessionId]:id' \\
            '--vector[clear模式:删除vector]' \\
            '-f[跳过确认]' \\
            '-l[返回数量限制]:n'
          ;;
      esac
      ;;
  esac
}

_myopenclaw "$@"
`;
}

/**
 * 生成 Fish 补全脚本
 */
function generateFishCompletions(): string {
  return `# Fish completion for myopenclaw
# 安装: myopenclaw completions fish > ~/.config/fish/completions/myopenclaw.fish

function __myopenclaw_use_command
    set -l cmd (commandline -opc)
    if [ (count $cmd) -gt 0 ]
        switch $cmd
            case 'chat'
                return 0
            case 'send'
                return 0
            case 'sessions'
                return 0
            case 'tools'
                return 0
            case 'skills'
                return 0
            case 'config'
                return 0
            case 'status'
                return 0
            case 'logs'
                return 0
            case 'ppt'
                return 0
        end
    end
    return 1
end

# 主命令补全
complete -c myopenclaw -n "not __myopenclaw_use_command" \\
    -s V -l version -d '显示版本号' \\
    -s h -l help -d '显示帮助信息' \\
    -s g -l gateway -r -d 'Gateway地址' \\
    -s w -l websocket -r -d 'WebSocket地址' \\
    -s j -l json -d '以JSON格式输出' \\
    -s v -l verbose -d '显示详细日志' \\
    -l no-color -d '禁用颜色输出' \\
    -f -a "chat send sessions memory tools skills config status logs ppt doctor completions" \\
    -d '子命令'

# chat 命令补全
complete -c myopenclaw -n "__myopenclaw_use_command; and __fish_use_subcommand chat" \\
    -s s -l session -r -d '会话ID' \\
    -s m -l model -r -d '模型名称' \\
    -s c -l channel -r -d '渠道' \\
    -l no-stream -d '禁用流式输出'

# send 命令补全
complete -c myopenclaw -n "__myopenclaw_use_command; and __fish_use_subcommand send" \\
    -s s -l session -r -d '会话ID' \\
    -s m -l model -r -d '模型名称' \\
    -s f -l file -r -d '附件文件' \\
    -l no-stream -d '禁用流式输出' \\
    -s w -l wait -r -d '超时时间'

# sessions 命令补全
complete -c myopenclaw -n "__myopenclaw_use_command; and __fish_use_subcommand sessions" \\
    -s t -l title -r -d '会话标题' \\
    -s l -l limit -r -d '返回数量限制'

# memory 命令补全
complete -c myopenclaw -n "__myopenclaw_use_command; and __fish_use_subcommand memory" \\
    -l topK -r -d '语义检索topK (1-50)' \\
    -l threshold -r -d '语义检索阈值 (0-1)' \\
    -l session -r -d '限定sessionId' \\
    -l vector -d 'clear模式:删除vector' \\
    -s f -l force -d '跳过确认' \\
    -s l -l limit -r -d 'list返回数量限制'

# status 命令补全
complete -c myopenclaw -n "__myopenclaw_use_command; and __fish_use_subcommand status" \\
    -s w -l watch -d '持续监视模式'

# logs 命令补全
complete -c myopenclaw -n "__myopenclaw_use_command; and __fish_use_subcommand logs" \\
    -s f -l follow -d '持续跟踪' \\
    -s n -l lines -r -d '显示行数' \\
    -s l -l level -r -d '日志级别' \\
    -l since -r -d '起始时间'

# ppt 命令补全
complete -c myopenclaw -n "__myopenclaw_use_command; and __fish_use_subcommand ppt" \\
    -s t -l theme -r -d '主题ID' \\
    -s s -l spec -r -d 'JSON规格文件路径' \\
    -s o -l out -r -d '输出文件路径'

# doctor 命令补全 (继承全局选项, 无专属参数)
complete -c myopenclaw -n "__myopenclaw_use_command; and __fish_use_subcommand doctor"
`;
}

// ── 执行主函数 ──
main().catch((error) => {
  const formatter = new OutputFormatter();
  formatter.error(error instanceof Error ? error.message : String(error));
  process.exit(ExitCode.GENERAL_ERROR);
});
