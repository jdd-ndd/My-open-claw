# 文本翻译技能

## 用途
将文本在不同语言之间进行翻译，支持多语言互译。

## 使用场景
- 文档翻译
- 实时对话翻译
- 代码注释翻译

## 参数
- `text` (必填): 待翻译文本
- `sourceLang` (可选): 源语言（自动检测）
- `targetLang` (必填): 目标语言

## 所需工具
- LLM 直接推理（无需额外工具）

## 示例
> 用户：把 "Hello, how are you?" 翻译成中文
> Agent：调用 text_translation(text="Hello, how are you?", targetLang="zh")
