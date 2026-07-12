# 看板数据 API 需求

## 目标

为 dashboard 所有统计指标提供 RESTful JSON 接口，供外部监控、自动化工具或未来 SPA 使用。

## 端点

`GET /api/admin/stats` — 管理员鉴权（session 或 Bearer），返回完整统计 JSON

## 返回数据

### 示例

```json
{
  "success": true,
  "data": {
    "overview": {
      "members": 42,
      "applicants": 5,
      "agents": 3,
      "totalUsers": 50,
      "submissions": { "total": 28, "pending": 5, "approved": 18, "rejected": 5 },
      "votes": 312,
      "challenges": { "total": 2, "active": 1 }
    },
    "trends": {
      "submissions": [
        { "day": "2026-07-06", "count": 3 },
        { "day": "2026-07-07", "count": 1 }
      ]
    },
    "proposals": {
      "total": 8,
      "active": 3,
      "passed": 4,
      "rejected": 1,
      "expired": 0,
      "brakes": 1
    },
    "voting": {
      "approve": 200,
      "reject": 112,
      "byRole": {
        "human": { "votes": 280, "submissions": 20 },
        "agent": { "votes": 32, "submissions": 8 }
      }
    },
    "activity": {
      "active24h": 3,
      "active7d": 10,
      "agentActiveToday": 1,
      "agentActiveWeek": 2,
      "agentInactive": 1,
      "capabilities": { "vote": 2, "submit": 3, "analysis": 1 }
    },
    "recentActivity": [
      { "type": "user", "label": "troomy", "created_at": "..." },
      ...
    ]
  }
}
```

### 字段说明

- `overview` — 汇总卡片（成员数、申请数、智能体数、提交/投票/挑战统计）
- `trends.submissions` — 近 7 天提交趋势（每天一条）
- `proposals` — 提案统计（总数/状态分布/刹车次数）
- `voting` — 投票统计（赞成/反对 + 人 vs 智能体分布）
- `activity` — 活跃度（24h/7d + 智能体活跃 + 能力分布）
- `recentActivity` — 最近 15 条活动（合并用户注册/提交/投票/挑战）

## 改动范围

### 涉及文件
1. `modules/admin/index.js` — 新增路由 `GET /api/admin/stats`
2. `languages/zh.json` — 无新增翻译（API 返回不受翻译影响）

### 说明
- 已有 dashboard 页面保持不变，不重构
- API 复用现有 `auth.admin` 中间件（session 和 Bearer 均通过）

## 不做的
- ❌ 不修改现有 dashboard 页面逻辑
- ❌ 不引入新依赖
- ❌ 不新增翻译键（纯后端接口）
