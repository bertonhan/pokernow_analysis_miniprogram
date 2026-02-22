# 德扑格局 (PokerNow Analysis Mini Program)

基于微信小程序 + 云开发的德州扑克对局记录与复盘工具。  
核心目标是把 PokerNow 日志转成可读、可比较、可复盘的选手数据。

## 1. 当前能力概览

- 对局管理：创建、更新、结束、删除、冠军改名。
- 对局分析：VPIP/PFR/AF、3bet、4bet、isolate、C-bet、SPR、位置分布等。
- 摊牌记录：底牌、起手牌力分组（169 组）、各街牌型、各街 SPR、各街动作。
- 标签系统：主风格 + 翻前策略 + 翻后策略 + 运气标签。
- 隐私机制：进行中隐藏对手真实身份；结束后公开绑定关系用于复盘。

## 2. 数据链路（本版本）

1. `match_crawler` 拉取并写入 `match_hands` 原始日志。  
2. `match_hand_etl` 将每手牌清洗到 `match_hand_facts`（基础事实表）。  
3. `match_analysis` 从 `match_hand_facts` 聚合选手统计，返回详情页数据，并写回 `match_player_stats`。  
4. 详情页 `pages/match/detail` 展示结果与标签。

设计目标：把重计算前置到 ETL，详情页分析仅做聚合，降低实时开销。

## 3. 标签体系（当前线上代码）

说明：同一名选手可同时命中多个标签。

### 3.1 主风格标签

- `松凶`：`hands >= 10`，`vpip >= 33%`，且翻前主动度高（`pfr >= 16%` 且 `pfr/vpip >= 0.45`）。
- `松弱`：`hands >= 10`，`vpip >= 33%`，但翻前主动度不足。
- `紧凶`：`hands >= 10`，`vpip <= 22%`，且翻前主动度高。
- `紧弱`：`hands >= 10`，`vpip <= 22%`，且翻前主动度不足。
- `平衡`：未命中任何其他标签时兜底。

### 3.2 翻前策略标签

- `limper`：`hands >= 12`，且同时满足：
  - `vpip >= 28%`
  - `limp >= 10%`
  - `limpRate >= pfrRate * 0.8`
  - `limpHands >= 3`
- `3bet压制`：`bet3Opp >= 5` 且 `3bet频率 >= 14%`。
- `4bet战士`：`bet4Opp >= 3` 且 `4bet频率 >= 16%`。
- `剥削`：`isolateOpp >= 4` 且 `isolate频率 >= 30%`。
- `怕3bet`：`foldTo3BetOpp >= 4` 且 `foldTo3Bet >= 62%`。

### 3.3 翻后策略标签

- `持续施压`：`cbetOpp >= 5` 且 `cbet频率 >= 62%`。
- `翻后保守`：`foldToFlopCbetOpp >= 4` 且 `foldToFlopCbet >= 62%`。
- `翻后反击`：`raiseVsFlopCbetOpp >= 4` 且 `raiseVsFlopCbet >= 22%`。
- `激进`：`AF >= 2.8`。
- `跟注`：`0 < AF < 0.9`。

### 3.4 运气标签（方案 2）

核心思路：比较“翻前权益预期”与“实际输赢”。

- `luckExpectedWins`：按摊牌玩家 `rangeEquity` 归一化后得到的预期胜局。
- `luckActualWins`：实际胜局（摊牌赢记 1，输记 0）。
- `luckDiff = luckActualWins - luckExpectedWins`。

触发条件（一般需 `luckHands >= 4`）：

- `天选`：`luckDiff >= 0.9`，或 `luckAllInDogWins >= 2`。
- `欧皇`：`luckDiff >= 0.45`，或 `luckGoodHits >= 2`。
- `倒霉`：`luckDiff <= -0.9`，或 `luckAllInFavLoses >= 2`。
- `非酋`：`luckDiff <= -0.45`，或 `luckBadBeats >= 2`。
- `跑马王`：`luckAllInDogWins >= 2`。
- `慈善家`（新版定义）：
  - 牌力落后（`equity <= 40%` 或与当手最高权益差距 `>= 8%`）；
  - 且主动进攻（`bets/raises/all-in`）；
  - 且最终输掉；
  - 聚合后满足 `charityAttempts >= 2`、`charityFails >= 2`、`charityRate >= 0.7`。

## 4. 目录结构

```text
cloudfunctions/
  login/
  user_manager/
  match_manager/
  match_bind_tool/
  match_crawler/
  match_hand_etl/
  match_hand_etl_batch/
  match_analysis/
  match_analysis_batch/

miniprogram/
  pages/match/list/
  pages/match/detail/
  pages/match/bind/
  app.js
```

## 5. 数据集合

- `matches`：对局元数据与 ledger。
- `match_hands`：原始手牌日志（raw_logs）。
- `match_hand_facts`：ETL 后的每手事实数据。
- `match_player_bindings`：选手与用户绑定关系。
- `match_player_stats`：`match_analysis` 聚合并写回的结果。
- `users`：用户资料（含 gejuId、头像等）。

## 6. 本地开发与部署

1. 用微信开发者工具导入项目根目录。  
2. 在 `miniprogram/app.js` 配置云环境 ID。  
3. 对改动过的云函数执行“上传并部署：云端安装依赖”。  
4. 重新编译小程序并验证详情页。

## 7. 常用手动操作

### 7.1 单局全量 ETL（推荐分片接力）

在云函数 `match_hand_etl` 测试参数中传：

```json
{
  "gameId": "你的gameId",
  "startOffset": 0,
  "maxRuntimeMs": 2200,
  "maxHandsPerRun": 12,
  "enableRelay": true
}
```

返回 `msg = "分片 ETL 进行中，已触发接力"` 表示正常。  
等待接力完成后，可再次调用确认 `data.done = true`。

### 7.2 单局分析

调用 `match_analysis`：

```json
{
  "gameId": "你的gameId"
}
```

成功后会返回 `data`（选手卡片数据），并写回 `match_player_stats`。

### 7.3 批量分析

调用 `match_analysis_batch`：

```json
{
  "gameIds": ["gameId1", "gameId2", "gameId3"],
  "maxPerRun": 1,
  "maxRuntimeMs": 1200,
  "awaitAnalysis": false
}
```

返回“已触发接力”属于正常状态。

## 8. 验收清单（微信开发者工具）

- 对局列表可正常展示，创建/结束/删除不报错。
- 详情页可看到统计项与标签，且不出现“暂无数据”异常。
- 对局结束后，绑定关系与头像按规则显示。
- 手动触发 `match_analysis` 后，`match_player_stats` 有对应写入。

## 9. License

MIT

## 10. 前端设计规范（新增）

为保证后续页面风格一致，已制定并落地项目级前端设计规范：

- `docs/frontend_design_spec.md`

内容包含：

- 全量页面遍历后的视觉基线
- 统一配色、字号、间距、圆角、阴影规范
- 交互反馈规则（加载/确认/错误/空态）
- 前端改动提交前检查清单

## 11. 最近更新（2026-02）

### 11.1 玩家模块（全局统计）

- 新增玩家总榜链路：
  - 云函数：`player_global_build`（重建统计）、`player_global_query`（分页查询/详情查询）
  - 页面：`pages/player/index`（玩家列表）、`pages/player/detail`（玩家详情）
- 展示规则：
  - 已绑定玩家按跨局聚合展示
  - 未绑定玩家按“每局选手”独立展示
  - 支持“全部 / 已绑定 / 未绑定”筛选

### 11.2 前端统一规范落地

- 新增全局 token 文件：`miniprogram/styles/design-tokens.wxss`
  - 5 档字阶、3 档间距、3 档圆角
  - 统一按钮尺寸、语义色、阴影层级
- 新增并持续维护规范文档：`docs/frontend_design_spec.md`
  - 增加“横向字间距”约束：默认 `letter-spacing: 0`（`--ls-0`）
  - 英文/ID 特殊场景可局部使用 `--ls-1 (0.4rpx)`

### 11.3 列表滚动体验修复

- 修复玩家列表页滚动到底部出现“空白遮盖带”的问题：
  - 由固定高度滚动区改为弹性布局（`flex: 1` + `min-height: 0`）
  - 与对局列表页的滚动行为保持一致
