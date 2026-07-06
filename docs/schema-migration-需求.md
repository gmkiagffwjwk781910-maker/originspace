# 数据库 Schema 迁移工具 — 需求文档

## 背景

当前 origin-community 的 schema 变更通过散装的 `try/catch` + `ALTER TABLE` 在 `kernel/core.js` 启动时执行。这种方式存在几个问题：

- **不可追踪**：无法知道哪些迁移已应用、哪些没有
- **脆弱的错误处理**：`try/catch` 把预期失败（列已存在）和真实错误混在一起
- **不可复现**：新环境部署时无法保证 schema 一致性
- **不可回滚**：没有撤销迁移的能力

## 功能需求

### 1. 迁移框架

- 内核启动时自动检测并执行未应用的迁移
- 使用 `_migrations` 表跟踪已应用的迁移（记录 id、名称、哈希、执行时间）
- 迁移文件放在 `migrations/` 目录，按序号命名：`001-initial.sql`, `002-add-agent-caps.sql`
- 迁移文件是纯 SQL，可包含多条语句（用 `;` 分隔）
- 每个迁移执行后记录文件名和内容哈希，防止篡改或重复执行

### 2. 迁移文件格式

```
-- migration: 001-initial
-- description: 初始数据库结构

CREATE TABLE IF NOT EXISTS users (...);
CREATE TABLE IF NOT EXISTS submissions (...);
...
```

```
-- migration: 002-add-agent-caps
-- description: 智能体能力标签列

ALTER TABLE users ADD COLUMN agent_capabilities TEXT DEFAULT '[]';
ALTER TABLE users ADD COLUMN last_api_at TEXT;
```

### 3. 迁移执行规则

- **幂等性**：已在 `_migrations` 表中的迁移跳过执行
- **顺序执行**：按文件名排序，逐条执行
- **事务保护**：每个迁移在一个事务中执行
- **失败处理**：迁移失败则记录错误日志，不阻塞内核启动（标记为 failed，下次重试）

### 4. 管理端点

- `GET /api/admin/migrations` — 列出所有迁移及其状态（pending/applied/failed）
- `POST /api/admin/migrations/run` — 手动运行待处理迁移（管理员）

### 5. 现有迁移迁移

- 将当前的散装 `ALTER TABLE` 逻辑转化为正式的迁移文件
- 迁移 001：初始表结构（将现有 `CREATE TABLE IF NOT EXISTS` 提取）
- 迁移 002：历史列变更（合并所有散装 `ALTER TABLE`）

## 验收标准

1. ✅ 内核启动自动运行待处理迁移
2. ✅ `_migrations` 表记录已应用迁移
3. ✅ 同一迁移不会重复执行（幂等）
4. ✅ 迁移文件按文件名排序执行
5. ✅ 失败迁移不阻塞启动，标记为 failed
6. ✅ API 端点可查询迁移状态
7. ✅ API 端点可手动触发迁移运行
8. ✅ 现有散装 ALTER TABLE 代码被迁移文件替代
9. ✅ 中英文翻译同步

## 设计提案

### 架构

```
kernel/
  migrate.js    ← 迁移引擎（核心逻辑）
migrations/
  001-init-tables.sql
  002-legacy-alters.sql
  ...
```

### migrate.js 职责

1. 连接数据库后创建 `_migrations` 表
2. 扫描 `migrations/` 目录，按文件名排序
3. 比对 `_migrations` 表，找出未应用的
4. 逐条在事务中执行，记录结果
5. 提供 `list()` 和 `runPending()` 接口给模块和 API

### 内核集成

在 `kernel/core.js` 中：
- 完成 `CREATE TABLE IF NOT EXISTS _kernel_modules` 等基础设施后
- 调用 `migrate.runPending(db, log)`
- 保留 `CREATE TABLE IF NOT EXISTS`（这些是表存在性保证，不是迁移）
- **移除**所有散装 `try/catch` + `ALTER TABLE`

### 迁移文件

**001-init-tables.sql**：当前已有的所有表（CREATE TABLE IF NOT EXISTS）—— 注意这些已在 core.js 中执行，迁移文件只需记录它们已存在，不重复执行

**002-legacy-alters.sql**：所有散装 ALTER TABLE 语句迁移
