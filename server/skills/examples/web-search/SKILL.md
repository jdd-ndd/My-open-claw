# 网络搜索技能

## 用途
使用搜索引擎查询网络信息，获取实时数据和知识。

## 使用场景
- 查询最新新闻和事件
- 搜索技术文档和解决方案
- 获取实时股价、天气等信息

## 参数
- `query` (必填): 搜索关键词
- `maxResults` (可选): 返回结果数量，默认 5

## 所需工具
- `http` — 发起 HTTP 请求调用搜索 API
- `browser` — 自动打开搜索结果页面获取详细内容

## 示例
> 用户：帮我查一下 OpenAI 最新发布的模型
> Agent：调用 web_search(query="OpenAI latest model release 2026")
