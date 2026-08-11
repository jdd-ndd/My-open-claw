/**
 * 标准输入工具
 *
 * 提供检测和读取标准输入（stdin）的功能，
 * 支持 Unix 管道输入，使 CLI 客户端能够与其他工具链式组合。
 *
 * @module cli/utils
 */

/**
 * 检测是否有管道输入
 *
 * 当 stdin 不是 TTY（终端）时，说明有数据通过管道传入。
 * 这是实现 Unix 管道友好的关键功能。
 *
 * @returns true 表示有管道输入
 *
 * @example
 * ```bash
 * # 有管道输入
 * echo "hello" | myopenclaw send
 * cat file.txt | myopenclaw send
 *
 * # 无管道输入
 * myopenclaw send "hello"
 * ```
 */
export function hasPipeInput(): boolean {
  // 当 stdin 不是 TTY 时，说明有管道输入
  return !process.stdin.isTTY;
}

/**
 * 从 stdin 读取完整内容
 *
 * 读取管道传入的所有数据，返回完整的字符串内容。
 * 适合读取一次性输入，大文件建议使用流式处理。
 *
 * @returns Promise，解析为读取到的完整字符串
 *
 * @example
 * ```typescript
 * const content = await readStdin();
 * console.log(`收到输入: ${content}`);
 * ```
 */
export async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');

    process.stdin.on('data', (chunk: Buffer) => {
      data += chunk.toString();
    });

    process.stdin.on('end', () => {
      resolve(data.trim());
    });

    process.stdin.on('error', (err: Error) => {
      reject(new Error(`读取 stdin 失败: ${err.message}`));
    });
  });
}

/**
 * 从 stdin 按行读取
 *
 * 逐行读取管道输入，每触发一行回调一次。
 * 适合处理大文件或流式输入场景。
 *
 * @param callback - 每行的回调函数
 * @returns Promise，在所有行读取完成后 resolve
 */
export async function readStdinLines(callback: (line: string, index: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    let lineBuffer = '';
    let lineIndex = 0;

    process.stdin.setEncoding('utf8');

    process.stdin.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      const lines = text.split('\n');

      // 处理第一行（可能包含之前的缓冲区内容）
      lineBuffer += lines[0];
      if (lines.length > 1) {
        callback(lineBuffer, lineIndex++);
        lineBuffer = '';

        // 处理中间的完整行
        for (let i = 1; i < lines.length - 1; i++) {
          callback(lines[i], lineIndex++);
        }

        // 处理最后一部分（可能不是完整行）
        lineBuffer = lines[lines.length - 1];
      }
    });

    process.stdin.on('end', () => {
      // 处理剩余的行
      if (lineBuffer) {
        callback(lineBuffer, lineIndex);
      }
      resolve();
    });

    process.stdin.on('error', (err: Error) => {
      reject(new Error(`读取 stdin 失败: ${err.message}`));
    });
  });
}

/**
 * 从 stdin 读取指定大小的数据
 *
 * 限制读取的数据大小，防止读取过大文件导致内存问题。
 *
 * @param maxBytes - 最大读取字节数（默认 1MB）
 * @returns Promise，解析为读取到的字符串
 */
export async function readStdinLimited(maxBytes: number = 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    let totalBytes = 0;

    process.stdin.setEncoding('utf8');

    process.stdin.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        reject(new Error(`输入数据过大，最大允许 ${maxBytes} 字节`));
        process.stdin.pause();
        return;
      }
      data += chunk.toString();
    });

    process.stdin.on('end', () => {
      resolve(data.trim());
    });

    process.stdin.on('error', (err: Error) => {
      reject(new Error(`读取 stdin 失败: ${err.message}`));
    });
  });
}

/**
 * 检查是否有交互式终端输入
 *
 * 判断当前是否可以从终端接收用户交互式输入。
 *
 * @returns true 表示是交互式终端
 */
export function isInteractiveTerminal(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}
