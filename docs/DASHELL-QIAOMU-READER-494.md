# Qiaomu Reader 4.9.4 选择性适配

上游正式版：Qiaomu Reader 4.9.4，2026-11-03 发布，tag `b857729a7e41eeaf5b04a1f58c65e60776872ea6`。适配目标：Dashell Reader 4.5.0，目标仓库 `dashell7/dashell-reader`。

## 适配范围

- 在既有“找书”流程加入 Hacker Books 公共书单，保留原 Gutenberg 下载、Anna's Archive、Z-Library 和 WikiSource 入口。
- 按本地处理的书名/作者搜索公开书目；提供主题筛选、排行榜、经典常青、详情、HN 评论及相关书籍。
- “想读/读过”存入现有 Reader 插件设置并限制为最多 5000 条；个人书库匹配与协同过滤推荐均在本地计算。
- 校验固定书目 API 与公开书目 ID，限制远端文本字段长度；保存串行化，失败恢复原设置并允许重试；关闭弹窗后释放监听器并忽略迟到的详情响应。
- 提供九种 UI 语言文案，并在找书页说明联网请求和 IP 可见范围。

没有新增运行时依赖、凭据、服务端身份或独立持久化组件；没有上传搜索词、书库名称或阅读清单。远端书目和封面来自 `hackerbooks.qiaomu.ai`；详情请求携带该书的公开 ID，服务会看到请求 IP。阅读清单保存在插件设置中。

## 产品边界

不合并与 Dashell 本地学习/阅读身份、书籍下载职责或私有部署不兼容的变更。保留现有正文、书籍文件、阅读进度、划线、笔记、AI 设置、Gutenberg 下载与英语学习数据。

## 验证记录

- 完整 Node 测试：646 passed；Python TTS：6 passed。
- i18n：1602 个键、简体中文及七个内置语言包通过；`tsc` 学习类型检查与 `eslint src/ --max-warnings=0` 通过。
- 标准构建、社区 profile 构建、`npm run verify:release` 与 `git diff --check` 通过。标准资产：`main.js` 5,407,941 字节，SHA256 `ddec08d79e09f943e047028b9bc181ba0456f1877f0b7056b786c9353ef97ba7`；`manifest.json` 336 字节，SHA256 `949d97682e8ec2c128d2f9b32edcb1b3f689c556c0a84ef89af4d0d8881ffcfa`；`styles.css` 3,861,947 字节，SHA256 `c7a408434fd0740d32e141607fe1b621417a9f0011cab662741e7dfbea0545a7`。main.js 仍超过十进制 5 MB。
- 指定 Windows Obsidian 1.15.0 宿主已安装 4.5.0 候选，三项安装资产与标准构建摘要完全一致。UI 控制运行时未能初始化，且未能接管目标窗口；书单弹窗、详情和清单持久化的真实宿主交互尚未验收。没有创建 QA 笔记或修改阅读清单。
- 公开书目服务只读检查返回 600 条排行、29 个主题、15,362 条书目；样例详情 ID 与请求 ID 一致。此项仅验证公开数据接口，不代替插件内网络/界面验收。
- 本轮生产依赖审计为 3 high；全依赖为 8 high、22 moderate、0 critical。依赖树和 lockfile 仅更新项目版本字段，没有升级依赖；审计结果是既有依赖风险，不代表风险已消除。
- GitHub PR、CI、Release 与匿名资产读回待完成；仅计划 GitHub 发布，不提交 Obsidian 社区目录。
