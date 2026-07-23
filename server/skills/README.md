# MyOpenClaw Skills 技能库

本目录存放业务技能定义文件。每个 Skill 以 `SKILL.md` 文件定义，使用 Markdown 格式描述：
- 技能名称与用途
- 使用场景
- 参数要求
- 所需工具组合
- 示例用法

## 如何添加新技能

1. 在 `examples/` 或新建目录中创建 `SKILL.md` 文件
2. 按照现有格式编写技能描述
3. 系统启动时自动扫描并加载

## 技能目录结构

```
skills/
├── README.md              # 本文件
└── examples/              # 示例技能集合
    ├── web-search/        # 网络搜索
    │   └── SKILL.md
    ├── daily-summary/     # 每日总结
    │   └── SKILL.md
    └── text-translation/  # 文本翻译
        └── SKILL.md
```
