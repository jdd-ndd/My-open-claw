// MyOpenClaw 环境检查脚本
import { existsSync } from 'node:fs';

console.log('=== MyOpenClaw 环境检查 ===\n');

// Node.js 版本
const nodeVersion = process.version;
console.log(`Node.js 版本: ${nodeVersion}`);
const major = parseInt(nodeVersion.slice(1).split('.')[0]);
if (major < 20) {
  console.error('错误: Node.js 版本需要 >= 20 LTS');
  process.exit(1);
}
console.log('  ✓ 通过\n');

// .env 文件
if (!existsSync('.env') && existsSync('.env.example')) {
  console.warn('警告: 未找到 .env 文件，请复制 .env.example 并配置');
} else if (existsSync('.env')) {
  console.log('.env 配置: ✓ 存在\n');
} else {
  console.warn('警告: .env.example 未找到\n');
}

// 依赖检查
console.log('检查依赖...');
try {
  const pkg = JSON.parse(
    await import('fs').then(fs => fs.readFileSync('package.json', 'utf-8'))
  );
  console.log(`  package.json: ✓ (${pkg.name} v${pkg.version})`);
} catch {
  console.error('  package.json: ✗ 读取失败');
}

console.log('\n环境检查完成！');
