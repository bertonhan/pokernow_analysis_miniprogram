# 德扑格局 Agent

基于微信小程序 + 云开发的 PokerNow 对局记录、分析与复盘工具。  
目标是把原始日志转成可读的战绩、可比较的指标、可复盘的玩家画像。

---

## 1. 当前功能总览

### 1.1 对局列表（`/pages/match/list`）

- 新建对局：粘贴 PokerNow 链接后创建并自动启动爬取。
- 对局管理：暂停/继续记录、结束对局。
- 管理员删除：仅管理员可左滑并执行删除操作，非管理员不响应横向拖动。
- 实时刷新：登录后自动轮询更新列表。

### 1.2 对局详情（`/pages/match/detail`）

- 展示对局元信息：名称、状态、对局 ID、当前手牌。
- 选手战绩分析：按盈利排序展示核心指标与标签。
- 复制战绩：一键复制文本战绩。
- 冠军改名：满足规则后可重命名对局名称（仅一次）。
- AI 快速分析：支持流式输出对局评述（Markdown 渲染）。

### 1.3 绑定页（`/pages/match/bind`）

- 选手身份绑定/解绑（玩家位 <-> 用户）。
- 支持同一用户绑定多个选手名（多马甲聚合）。
- 隐私规则：
  - 对局进行中：隐藏他人真实身份映射。
  - 对局已结束：公开绑定信息用于复盘。

### 1.4 玩家页（`/pages/player/index` + `/pages/player/detail`）

- 跨局总榜：`全部 / 已绑定 / 未绑定` 筛选。
- 一键刷新：触发全局统计重建。
- 玩家详情：展示聚合指标、风格标签、最近对局（按开始时间展示日期）。
- 标签策略：玩家页不展示“运气类标签”（长期维度默认回归均值）。

### 1.5 我的页（`/pages/profile/index`）

- 登录态资料维护：头像、昵称、格局 ID。

### 1.6 全局体验

- 小程序首页默认是对局列表页。
- 登录校验完成前显示全局 Loading 遮罩，不闪“未登录态”页面。
- 已启用组件按需注入：`miniprogram/app.json` 配置 `lazyCodeLoading: "requiredComponents"`。

---

## 2. 核心业务规则

1. **防作弊优先**：对局进行中不暴露对手真实身份关系。  
2. **复盘优先**：对局结束后开放绑定信息用于复盘讨论。  
3. **统计口径固定**：先聚合分子/分母计数，再计算比率（避免“先算百分比再平均”的偏差）。  
4. **管理员操作隔离**：删除等高风险操作仅管理员可见可用。  
5. **重计算前置**：ETL 先产出基础事实表，详情分析以聚合为主，减少实时开销。  

---

## 3. 技术架构与数据链路

### 3.1 技术栈

- 前端：微信小程序原生（WXML / WXSS / JS）
- 后端：微信云开发（云函数 + 云数据库）
- 数据源：PokerNow（日志 + 账单）
- AI：云开发 AI Bot（`agent-gejuai-3g1et8v907e82c71`）

### 3.2 核心数据流

1. `match_manager` 创建对局并触发 `match_crawler`。  
2. `match_crawler` 拉取 `log_v3` 日志写入 `match_hands`，并同步账单到 `matches.ledger`。  
3. 每手结束触发 `match_hand_etl`，写入 `match_hand_facts`。  
4. 详情页调用 `match_analysis`，从 `match_hand_facts` 聚合结果并写回 `match_player_stats`。  
5. 玩家页调用 `player_global_build / player_global_query`，构建并读取 `player_global_stats`。  
6. AI 分析链路：`match_ai_context` 组装上下文，前端调用 AI Bot 流式返回。  

---

## 4. 目录结构（当前）

```text
cloudfunctions/
  login/
  user_manager/
  match_manager/
  match_crawler/
  match_hand_etl/
  match_hand_etl_batch/
  match_analysis/
  match_analysis_batch/
  match_bind_tool/
  player_global_build/
  player_global_query/
  match_ai_context/
  agent-gejuai-3g1et8v907e82c71/

miniprogram/
  pages/
    match/list
    match/detail
    match/bind
    player
    player/detail
    profile
  config/
    ai-agent.js
    ai-prompts.js
    ai-prompt-texts.js
  styles/
    design-tokens.wxss
  utils/
    ai-bot-client.js
    ai-scene-runner.js
    markdown-renderer.js
  app.js
  app.json
  app.wxss
```

---

## 5. 云函数能力清单

### 5.1 用户与登录

- `login`：返回调用者 `openid/appid/unionid`。
- `user_manager`：
  - `action: "get"` 获取当前用户资料
  - `action: "update"` 更新资料（头像、昵称、格局 ID）

### 5.2 对局管理与采集

- `match_manager`：
  - `list`：对局列表
  - `create`：创建对局并触发爬虫
  - `toggle_status`：暂停/继续
  - `end_match`：结束对局（并触发 ETL 兜底补算）
  - `delete`：管理员删除
  - `rename_match`：冠军改名
- `match_crawler`：持续抓取手牌日志与账单，支持超时接力与异常自动暂停。

### 5.3 计算链路

- `match_hand_etl`：
  - 单手模式：`{ gameId, handNumber }`
  - 分片全量模式：`{ gameId, startOffset, maxRuntimeMs, maxHandsPerRun, enableRelay }`
- `match_hand_etl_batch`：多局批量触发 ETL，支持接力。
- `match_analysis`：读取 `match_hand_facts` 聚合并写回 `match_player_stats`。
- `match_analysis_batch`：批量触发分析，支持接力。

### 5.4 绑定与玩家总榜

- `match_bind_tool`：`getOpenId / getGejuIds / bind / unbind`
- `player_global_build`：构建跨局玩家总榜数据（写 `player_global_stats`）。
- `player_global_query`：`list / detail / rebuild`。

### 5.5 AI 相关

- `match_ai_context`：输出对局 AI 分析所需上下文。
- `agent-gejuai-3g1et8v907e82c71`：AI Bot 运行入口（由云开发 AI 调用）。

---

## 6. 数据库集合

### 6.1 核心集合（必需）

- `matches`：对局元信息（状态、名称、当前手牌、账单等）
- `match_hands`：原始手牌日志（`raw_logs`）
- `match_hand_facts`：ETL 后每手事实数据
- `match_player_bindings`：绑定关系
- `match_player_stats`：单局聚合分析结果（`match_analysis` 写回）
- `player_global_stats`：跨局玩家统计结果（`player_global_build` 写回）
- `users`：用户资料

### 6.2 AI 相关集合（建议创建）

- `ai_bot_chat_history`
- `ai_bot_chat_trace`

---

## 7. 指标与标签口径（当前实现）

### 7.1 指标口径（关键）

所有比率类指标都遵循：

1. 先把原始计数项累计（分子/分母）。
2. 最后统一计算百分比或比值。

常见指标：

- `VPIP = vpipHands / hands`
- `PFR = pfrHands / hands`
- `Limp = limpHands / hands`
- `AF = (bets + raises) / calls`（calls=0 时做兜底）
- `3Bet = bet3Count / bet3Opp`
- `CBet = cbetCount / cbetOpp`
- `WTSD = showdowns / sawFlopHands`
- `WSD = showdownWins / showdowns`

### 7.2 标签规则

- 对局详情标签：主风格 + 翻前策略 + 翻后策略 + 运气类标签（含慈善家等）。
- 玩家页标签：与对局标签同体系，但**过滤运气类标签**（`天选/欧皇/倒霉/非酋/跑马王`）。

---

## 8. 本地开发与部署

### 8.1 前置准备

1. 微信开发者工具导入项目根目录。
2. 打开 `miniprogram/app.js`，确认云环境 ID（当前代码示例为 `cloud1-2gpsa3y0fb62239f`）。
3. 打开 `miniprogram/app.json`，确认：
   - 首页为 `pages/match/list/index`
   - `lazyCodeLoading: "requiredComponents"`

### 8.2 小程序依赖

在 `miniprogram` 目录执行：

```bash
npm install
```

然后在微信开发者工具执行“构建 npm”。

### 8.3 云函数部署（改哪个传哪个）

在微信开发者工具中：

- 右键目标云函数目录
- 选择“上传并部署：云端安装依赖”

---

## 9. 常用手动操作（云函数测试参数）

### 9.1 单局全量 ETL（分片接力）

调用 `match_hand_etl`：

```json
{
  "gameId": "你的gameId",
  "startOffset": 0,
  "maxRuntimeMs": 2200,
  "maxHandsPerRun": 12,
  "enableRelay": true
}
```

判定标准：

- 返回 `msg: "分片 ETL 进行中，已触发接力"`：正常接力中
- 返回 `data.done: true`：该局 ETL 完成

### 9.2 单局分析

调用 `match_analysis`：

```json
{
  "gameId": "你的gameId"
}
```

成功后会：

- 返回详情页所需选手数据
- 写回 `match_player_stats`

### 9.3 批量 ETL

调用 `match_hand_etl_batch`：

```json
{
  "gameIds": ["gameId1", "gameId2"],
  "maxPerRun": 1,
  "maxRuntimeMs": 1200,
  "awaitEtl": false,
  "etlMaxRuntimeMs": 2200,
  "maxHandsPerRun": 12
}
```

### 9.4 批量分析

调用 `match_analysis_batch`：

```json
{
  "gameIds": ["gameId1", "gameId2"],
  "maxPerRun": 1,
  "maxRuntimeMs": 1200,
  "awaitAnalysis": false
}
```

### 9.5 刷新玩家总榜

调用 `player_global_query`：

```json
{
  "action": "rebuild",
  "awaitBuild": true
}
```

---

## 10. 常见问题排查

### 10.1 `Invoking task timed out after 3 seconds`

含义：云函数测试超时，不一定是业务逻辑错误。  
处理：把云函数测试超时时间调大，或使用分片 + 接力参数（见第 9 章）。

### 10.2 `对局不存在`

高概率原因：

1. `gameId` 传错（复制了名称而不是 ID）。
2. 该局还未写入 `matches`。

先查：`matches` 集合里是否存在对应 `gameId`。

### 10.3 对局详情“暂无数据”

排查顺序：

1. `match_hands` 是否有该局数据。
2. `match_hand_facts` 是否已生成。
3. 手动触发 `match_analysis` 看返回信息。

### 10.4 头像 403 / 图片加载失败

含义：旧签名 URL 过期或外链不可用。  
当前策略：服务端优先转换临时链接（`cloud.getTempFileURL`），客户端失败时降级为默认头像。

### 10.5 iOS 时间解析告警

不要直接依赖 `new Date("yyyy-MM-dd HH:mm")` 在所有环境都可用。  
当前代码已做兼容解析，后续新增日期字段时继续沿用统一解析函数。

---

## 11. 最小验收清单（每次改动后）

1. 对局列表：新建/暂停/继续/结束至少成功一次。
2. 对局详情：可拉到分析数据，指标和标签正常展示。
3. 绑定页：可绑定与解绑，进行中与结束后隐私规则正确。
4. 玩家页：列表加载正常，刷新数据后详情可打开。
5. AI 分析：详情页点击后有流式文本输出（至少一次成功）。

---

## 12. 设计与架构文档

- 前端设计规范：`docs/frontend_design_spec.md`
- 技术架构说明：`docs/architecture_overview.md`
- AI 云函数说明：`cloudfunctions/agent-gejuai-3g1et8v907e82c71/README.md`

---

## 13. 安全与配置说明

- 不要把真实密钥提交到仓库。
- AI 模型配置请放到云函数环境变量（可参考 `cloudfunctions/agent-gejuai-3g1et8v907e82c71/.env.example`）。
- 涉及删除、清库、批量覆盖写入等高风险操作，先备份再执行。
