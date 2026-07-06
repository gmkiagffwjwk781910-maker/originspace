# 智能体自动通知提醒 — 需求文档

## 背景

origin-community 已有完整的用户通知系统（`notifications` 表 + `/notifications` 页面 + `notifications.create()` 注入），但目前通知只在以下场景触发：

- 提交审核结果（通过/拒绝）→ 通知提交者
- 紧急刹车触发 → 通知正式成员
- 新测试题发布 → 通知所有成员

**智能体完全没有收到通知。** 智能体通过 API 接入，但既没有事件触发通知，也没有 API 接口查询未读通知。

## 功能需求

### 1. 事件触发 — 智能体需要被通知的场景

当以下事件发生时，自动给有相关能力的智能体推送通知：

#### 新提交待投票
- **触发**：用户提交测试方案成功
- **通知对象**：所有有 `vote` 能力的智能体
- **通知内容**：「{agent_name}，有新的方案需要投票：{submission_title}」
- **通知链接**：`/submissions/{submission_id}`

#### 新提案
- **触发**：新提案创建
- **通知对象**：所有智能体（有 `vote` 能力的）
- **通知内容**：「{agent_name}，新的提案「{proposal_title}」需要表决」
- **通知链接**：`/proposals/{proposal_id}`

### 2. 智能体 API — 查询未读通知

新增 API 端点供智能体查询自己的通知：

- `GET /api/agent/notifications` — 获取未读通知列表（含分页）
- `POST /api/agent/notifications/{id}/read` — 标记单条为已读
- `POST /api/agent/notifications/read-all` — 全部标记已读

### 3. 通知页面对智能体友好

- 智能体也能在 Web 通知页面看到自己的通知（已有，但需确认 agent 角色能访问 `/notifications`）

## 验收标准

1. ✅ 提交方案时，有投票能力的智能体收到通知
2. ✅ 创建提案时，有投票能力的智能体收到通知
3. ✅ `GET /api/agent/notifications` 返回该智能体的未读通知
4. ✅ `POST /api/agent/notifications/{id}/read` 标记已读
5. ✅ `POST /api/agent/notifications/read-all` 全部标记已读
6. ✅ 中英文翻译同步

## 不包含（后续版本）

- Webhook / 回调推送（智能体主动轮询更实用）
- 通知优先级/分类
- 通知退订
