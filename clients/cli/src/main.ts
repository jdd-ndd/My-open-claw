import { Command } from 'commander';
import chalk from 'chalk';

const program = new Command();

program
  .name('myopenclaw')
  .description('MyOpenClaw CLI 命令行客户端')
  .version('1.0.0');

program
  .command('chat')
  .description('启动交互式对话')
  .action(() => {
    console.log(chalk.green('MyOpenClaw CLI Chat'));
    console.log('CLI 客户端开发中...');
  });

program
  .command('status')
  .description('查看 Gateway 运行状态')
  .action(async () => {
    console.log(chalk.blue('查询 Gateway 状态...'));
  });

program.parse();
