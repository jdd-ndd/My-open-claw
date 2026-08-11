---
name: website-analyzer
description: 网页分析技能，帮助用户分析网页内容、提取关键信息
version: 1.0.0
author: MyOpenClaw Team
triggers:
  - 分析网页
  - 网页分析
  - 抓取网页
  - 页面分析
  - web analysis
tools:
  - browser/open
  - browser/scrape
  - fs/write_file
priority: normal
---

# 网页分析技能

## 技能描述
分析指定 URL 的网页内容，提取标题、关键信息和结构化数据，
并可选择将分析结果保存到文件。

## 使用场景
- 用户提供 URL，想了解网页内容摘要
- 用户需要从网页中提取特定信息
- 用户需要分析多个网页的 SEO 信息

## 执行步骤
1. 使用 browser/open 打开目标网页，获取页面标题和文本内容
2. 分析网页内容，提取关键信息（标题、摘要、关键词）
3. 如需提取特定结构化数据，使用 browser/scrape 按选择器提取
4. 如需保存结果，使用 fs/write_file 写入文件
5. 输出分析报告

## 输出格式
分析报告应包含：
- 网页标题和 URL
- 内容摘要（200字以内）
- 提取的关键信息
- 页面状态码

## 注意事项
- 注意区分需抓取的公共网页和内部页面
- 大页面可能需要截断内容
