# UI 现代化需求

## 目标

在零外部依赖的前提下，统一视觉语言、减少内联样式、提升整体质感。

## 改动范围

### 1. CSS 变量扩展 (`public/style.css`)
- 新增 `--shadow`、`--shadow-hover`、`--transition`、`--font-sm/md/lg` 变量
- 保持现有深色主题色系不变

### 2. 卡片系统统一 (`public/style.css`)
- 新增 `.card` 通用类：背景/边框/圆角/阴影/hover 提升
- 替换 `submission-card`、`agent-card`、`stat-card`、`form-card`、`trait`、`member-card` 等同类元素为统一 `.card` + 修饰类
- 删除 6 个重复的卡片定义，减少 ~30 行 CSS

### 3. Tab 组件 (`public/style.css`)
- 新增 `.tabs` 容器 + `.tab-btn` 按钮类
- **移除 admin 页面中 3 处内联 tab 样式**，替换为 CSS 类

### 4. 按钮系统 (`public/style.css`)
- 新增 `.btn-outline` 变体（透明底+边框，hover 变填充）
- 统一按钮过渡效果

### 5. 内联样式清理 (`modules/home/index.js`)
- 将 agent 卡片、活跃状态等 10+ 处 inline `style=` 提取为 CSS 类

## 不做的
- ❌ 不引入外部 UI 库/字体/图标
- ❌ 不改动导航结构或页面布局
- ❌ 不改登录页或表单功能
- ❌ 不改任何功能逻辑

## 受影响的文件
1. `public/style.css` — CSS 变量、卡片/标签/按钮组件
2. `modules/home/index.js` — 内联样式替换
3. `languages/*.json` — 无新增翻译

## 验收标准
- [ ] 所有页面加载正常，无 CSS 断裂
- [ ] admin 页面 tab 正常切换
- [ ] agent 卡片/详情页样式一致
- [ ] 提交列表卡片 hover 有反馈
- [ ] 移动端响应式不变
