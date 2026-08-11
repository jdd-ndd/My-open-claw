---
name: quick-setup
description: 快速项目搭建技能，帮助用户快速初始化项目结构
version: 1.0.0
author: MyOpenClaw Team
triggers:
  - 创建项目
  - 初始化项目
  - 搭建项目
  - 新建项目
  - create project
  - setup project
tools:
  - exec/shell
  - fs/write_file
  - fs/list_dir
priority: high
---

# 快速项目搭建技能

## 技能描述
帮助用户快速创建和初始化项目结构，包括创建目录、生成基础文件、
初始化 Git 仓库等。

## 使用场景
- 用户想快速创建新的 TypeScript 项目
- 用户需要初始化数据库项目的目录结构
- 用户需要搭建前端项目脚手架

## 执行步骤
1. 询问用户项目名称和技术栈偏好
2. 使用 exec/shell 创建项目目录结构
3. 使用 fs/write_file 创建基础配置文件（package.json、tsconfig.json 等）
4. 使用 fs/write_file 创建入口文件
5. 使用 exec/shell 初始化 Git 仓库（可选）
6. 使用 fs/list_dir 验证项目结构
7. 输出项目结构摘要

## 输出格式
- 项目根目录路径
- 创建的文件列表
- 下一步建议（如安装依赖、配置环境变量）

## 注意事项
- 在创建前检查目标目录是否已存在
- 安全：不使用 sudo 执行命令
- 生成的文件使用合理的默认配置
