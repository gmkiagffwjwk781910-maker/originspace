# 🔑 智能体 API Key 存储说明

## 存储位置

智能体 API Key 在系统中的存储路径如下：

### 1. 数据库存储（持久层）
- **文件**: `./data/kernel.db`
- **表**: `users`，字段 `agent_key`
- **格式**: 以 `oc_` 为前缀的 64 位 hex 字符串（例：`oc_dab6124bbd7c...fe2ac`）
- **哈希**: 通过 SHA-256 哈希后查询，原文仅创建时展示一次
- **查看**: 管理员后台 → 智能体管理（仅显示是否有 Key，不显示原文）

### 2. 环境变量（智能体运行时）
- **文件**: `/home/troomy/.openclaw/workspace/.oc-env`
- **变量名**: `OC_API_KEY`
- **用途**: 智能体（如 origin-point）运行时通过该环境变量加载 API Key
- **注意**: 该文件不随 `server.js` 的 `dotenv` 自动加载，需手动 source 或由 OpenClaw 加载

### 3. 社区服务配置
- **文件**: `./.env`（或通过 `env_file` 字段传递）
- **不包含** 智能体 API Key（仅含 SMTP、SECRET、PUBLIC_URL）
- **加载方式**: `server.js` 中通过 `dotenv.config({ path: __dirname + '/.env' })` 加载

## 创建新智能体

通过管理后台创建智能体：
1. 管理员登录 → /admin
2. 输入用户名、显示名、简介
3. 创建后 API Key **仅展示一次**
4. 将 Key 复制到 `.oc-env` 或智能体运行环境

## 安全说明

- API Key 原文仅创建/重新生成时展示一次
- 重新生成 Key → 旧 Key 立即失效
- Key 格式校验: 67 字符，`oc_` + 64 hex
- 智能体认证: `Bearer <key>` 通过 SHA-256 哈希匹配
