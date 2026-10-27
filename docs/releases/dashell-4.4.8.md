# Dashell Reader 4.4.8

发布日期：2026-10-27。本版汇总 4.4.7 之后已合入的更新，选择性适配截至 Qiaomu Reader 4.9.2 的正式版本，继续使用 Dashell 的英语学习与阅读数据。

## 主要更新

- **书目信息与查找**：新导入保留书名、作者、年份、语言、ISBN、出版社与来源；首页和书库可按这些信息搜索，并选择最近阅读、最近添加或书名排序。历史记录缺少的信息不会被猜测或批量改写。
- **避免重复导入**：通过 SHA-256 识别相同文件内容，同书并发下载与提交只导入一次；保存元数据失败后可重试并复用已下载文件，不覆盖内容不同的版本。
- **公共找书更清楚**：修正 Gutenberg 作者识别，显示准备、下载、导入、完成和重试状态；关闭、换搜索或卸载后，旧响应不再开始新的导入。已经开始的写入允许完成一次。
- **离线阅读与体积**：无损压缩本地语言字典和 PDF CMap，保留离线解码；EPUB 加载局部兼容缺少 Object.groupBy / Map.groupBy 的环境，不改共享全局 API。
- **Codex 登录检测**：支持 API key configured 与既有 ChatGPT/API Key 登录状态，避免把未登录、未知输出或失败退出误报为可用。

## 安装与升级

插件 ID 仍为 dashell-reader，最低 Obsidian 版本仍为 1.11.4。通过 BRAT 更新，或下载本 Release 的 main.js、manifest.json、styles.css，替换插件目录内的三个同名文件后重载；保留 data.json、阅读进度、学习记录和其他文件。

本项目通过 GitHub 分发，尚未进入 Obsidian 社区目录；本次只发布 GitHub，不提交官方目录或执行官方预扫描。保留原有许可和第三方声明。

## 验证与边界

发版运行完整 Node/Python 回归、语言与学习类型检查、源码 ESLint、标准及社区构建和资产校验；CI 在 Windows/Ubuntu 重建并比较 Reader 资产。最终 Release 三个资产另做下载摘要和指定 Windows Obsidian 测试库升级、阅读及重载验证。逐次功能验证范围见 [4.7.9](../DASHELL-QIAOMU-READER-479.md)、[4.8.3](../DASHELL-QIAOMU-READER-483.md)、[4.9.1](../DASHELL-QIAOMU-READER-491.md)、[4.9.2](../DASHELL-QIAOMU-READER-492.md)。

main.js 约 5.36 MB，仍超过十进制 5 MB；不声称满足该大小限制。现有锁定 Vue/编译依赖的审计告警未在本次升级中修复，依赖树未变；不声称依赖审计无漏洞。

本次不包含 Kindle、乔木激活书库、其他账号或新增语音服务；macOS、物理手机、冷启动和双设备同步未验证。缺失 API 的受控回归不等于旧版 iOS 实机验收。
