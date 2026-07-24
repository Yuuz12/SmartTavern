# SmartTavern

<div align="center">

基于 LLM 的智能体角色扮演平台

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6?logo=typescript)](https://www.typescript.org/)
[![Express](https://img.shields.io/badge/Express-4.18-000000?logo=express)](https://expressjs.com/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[简体中文](README.md) · [English](README.en.md)

</div>

---

## 项目介绍

SmartTavern 是一个基于 Node.js 的 **LLM 智能体角色扮演平台**，支持多用户隔离、SillyTavern 格式角色卡（v1/v2）和世界书，适配 OpenAI 和 Anthropic 接口协议的大语言模型。

前端使用原生 HTML + CSS + JavaScript 构建，无需框架依赖，支持插件系统和皮肤切换。

### 核心特性

- **角色卡管理** - 完整支持 SillyTavern v1/v2 格式，支持导入导出
- **世界书系统** - 创建和管理世界观设定，自动注入对话上下文
- **多 LLM 支持** - 支持 OpenAI、Anthropic 及兼容接口（Ollama、LocalAI 等）
- **实时对话** - 流式输出，Markdown 渲染，代码高亮
- **插件系统** - 自由编写插件扩展对话体验
- **皮肤系统** - 多主题切换，支持自定义主题
- **多用户隔离** - 用户数据完全隔离，首个注册用户自动成为管理员
- **JSON 存储** - 无需数据库，轻量部署
- **响应式设计** - 支持桌面、平板、移动端
- **安全可靠** - JWT 认证、API 限流、密码加密

---

## 快速开始

### 环境要求

- Node.js >= 18
- npm >= 9

### 安装步骤

#### 1. 克隆仓库

```bash
git clone https://github.com/Yuuz12/SmartTavern.git
cd SmartTavern
```

#### 2. 安装依赖

```bash
npm run install:all
```

该命令会同时安装根目录与 `backend/` 的依赖。

#### 3. 配置环境变量

复制 `backend/.env.example` 为 `backend/.env`，并按需修改：

```bash
cp backend/.env.example backend/.env
```

重点配置项：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 服务端口 | 3000 |
| `JWT_SECRET` | JWT 密钥（**生产环境务必改为随机长字符串**） | - |
| `NODE_ENV` | 运行环境 | development |
| `CORS_ORIGIN` | 前端访问地址 | http://localhost:3000 |

#### 4. 启动服务

**开发模式**（热重载）：

```bash
npm run dev
```

**生产模式**：

```bash
# 先构建后端
npm run build:backend

# 再启动服务
npm run start:backend
```

#### 5. 访问

浏览器打开 <http://localhost:3000>

首次访问需注册账号（首个注册用户自动成为管理员）。

---

## 项目结构

```
SmartTavern/
├── backend/                      # 后端项目
│   ├── src/                      # 源代码
│   │   ├── config/               # 配置文件
│   │   ├── middleware/           # 中间件（认证、限流、错误处理）
│   │   ├── modules/              # 业务模块
│   │   │   ├── auth/             # 认证模块
│   │   │   ├── user/             # 用户模块
│   │   │   ├── character/        # 角色卡模块
│   │   │   ├── worldbook/        # 世界书模块
│   │   │   ├── conversation/     # 对话模块
│   │   │   └── llm/              # LLM 接入模块
│   │   ├── storage/              # JSON 文件存储层
│   │   ├── shared/               # 共享组件（工具、类型、常量）
│   │   ├── app.ts                # 应用入口
│   │   └── server.ts             # 服务启动
│   ├── data/                     # 数据存储目录
│   │   ├── system/               # 系统配置
│   │   └── users/                # 用户数据（按用户隔离）
│   ├── dist/                     # 构建产物
│   ├── .env.example              # 环境变量模板
│   └── package.json
│
├── frontend/                     # 前端项目
│   ├── index.html                # 入口页面
│   ├── pages/                    # 页面
│   ├── css/                      # 样式
│   ├── js/                       # 脚本
│   │   ├── api/                  # API 接口
│   │   ├── components/           # 原生组件
│   │   ├── pages/                # 页面逻辑
│   │   ├── utils/                # 工具函数
│   │   └── stores/               # 状态管理
│   ├── lib/                      # 第三方库
│   └── assets/                   # 静态资源
│
├── docs/                         # 项目文档
├── .gitignore
├── package.json
└── README.md
```

---

## 配置说明

### 后端配置（backend/.env）

```env
# 服务配置
PORT=3000
NODE_ENV=development

# JWT 配置（生产环境务必修改）
JWT_SECRET=your_random_secret_key_here
JWT_EXPIRES_IN=7d
JWT_REFRESH_EXPIRES_IN=30d

# 数据存储路径
DATA_PATH=./data
UPLOAD_PATH=./uploads
BACKUP_PATH=./backups

# CORS 配置
CORS_ORIGIN=http://localhost:3000

# 文件上传限制（默认 2MB）
MAX_FILE_SIZE=2097152

# 限流配置
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=100

# 日志级别
LOG_LEVEL=info
```

---

## API 接口

### 认证模块

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/auth/register | 用户注册 |
| POST | /api/auth/login | 用户登录 |
| POST | /api/auth/logout | 用户登出 |
| POST | /api/auth/refresh | 刷新 Token |
| GET | /api/auth/me | 获取当前用户信息 |

### 角色卡模块

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/characters | 获取角色卡列表 |
| GET | /api/characters/:id | 获取角色卡详情 |
| POST | /api/characters | 创建角色卡 |
| PUT | /api/characters/:id | 更新角色卡 |
| DELETE | /api/characters/:id | 删除角色卡 |
| POST | /api/characters/import | 导入角色卡 |
| GET | /api/characters/:id/export | 导出角色卡 |

### 世界书模块

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/worldbooks | 获取世界书列表 |
| POST | /api/worldbooks | 创建世界书 |
| PUT | /api/worldbooks/:id | 更新世界书 |
| DELETE | /api/worldbooks/:id | 删除世界书 |

### LLM 配置模块

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/llm-configs | 获取配置列表 |
| POST | /api/llm-configs | 创建配置 |
| PUT | /api/llm-configs/:id | 更新配置 |
| DELETE | /api/llm-configs/:id | 删除配置 |
| POST | /api/llm-configs/:id/test | 测试配置连接 |

### 对话模块

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/conversations | 获取对话列表 |
| POST | /api/conversations | 创建对话 |
| POST | /api/conversations/:id/messages | 发送消息 |
| POST | /api/conversations/:id/regenerate | 重新生成回复 |

更多 API 文档请参考 [docs/api.md](docs/api.md)。

---

## 插件开发

SmartTavern 支持通过插件扩展功能。插件可以在多个阶段介入对话流程。

### 插件类型

| 类型 | 说明 | 钩子点 |
|------|------|--------|
| message-processor | 消息处理插件 | beforeSendMessage, afterReceiveMessage |
| prompt-processor | 提示词插件 | beforeBuildPrompt, processSystemPrompt |
| ui-plugin | UI 插件 | onUIReady, onSidebarRender |
| event-plugin | 事件插件 | onLLMStart, onLLMEnd, onLLMError |

### 插件结构

```
plugin-name/
├── plugin.json          # 插件元数据
├── index.js             # 主入口文件
└── README.md            # 插件说明
```

### 插件示例

```json
// plugin.json
{
  "id": "message-formatter",
  "name": "消息格式化器",
  "version": "1.0.0",
  "type": "message-processor",
  "hooks": ["onRenderMessage"],
  "entry": "index.js"
}
```

```javascript
// index.js
export default class MessageFormatter {
  constructor(context) {
    this.context = context;
    this.config = context.config;
  }

  async onRenderMessage(message, element) {
    // 格式化代码块
    element.querySelectorAll('pre code').forEach(block => {
      // 语法高亮处理
    });
    return element;
  }
}
```

更多插件开发文档请参考 [docs/plugin-development.md](docs/plugin-development.md)。

---

## 皮肤系统

SmartTavern 内置多套主题：

| 主题 ID | 名称 | 类型 |
|---------|------|------|
| default | 默认 | 浅色 |
| dark | 暗色 | 深色 |
| midnight-blue | 午夜蓝 | 深邃蓝 |
| forest-green | 森林绿 | 自然绿 |
| sunset-orange | 日落橙 | 暖色橙 |
| lavender | 薰衣草 | 淡紫色 |

支持跟随系统主题和自定义主题。

---

## 数据存储

SmartTavern 使用 JSON 文件存储数据，无需数据库。数据按用户物理隔离，每个用户拥有独立的子目录存放角色卡、对话和世界书。

```
data/
├── system/
│   └── config.json             # 系统配置
└── users/
    ├── index.json              # 用户索引
    ├── {userId}.json           # 用户完整数据（含LLM配置）
    └── {userId}/               # 用户数据目录
        ├── characters/         # 角色卡
        │   ├── index.json      # 角色卡索引
        │   └── {characterId}.json
        ├── conversations/      # 对话
        │   ├── index.json      # 对话索引
        │   └── {conversationId}.json
        └── worldbooks/         # 世界书
            ├── index.json      # 世界书索引
            └── {worldbookId}.json
```

### 设计特点

- **用户隔离**：每个用户的数据存放在独立的 `{userId}/` 子目录下
- **LLM 配置内嵌**：用户的 LLM 配置直接存储在用户数据中，不单独建表
- **索引加速**：每个数据目录都有 `index.json` 索引文件，避免全量扫描
- **原子写入**：采用临时文件 + 重命名策略，防止写入中断导致数据损坏

### 数据备份与恢复

系统支持一键备份和恢复数据，备份文件存储在 `backups/` 目录。

---

## 测试

```bash
# 运行所有测试
npm --prefix backend test

# 运行单元测试
npm --prefix backend run test:unit

# 运行集成测试
npm --prefix backend run test:integration

# 生成覆盖率报告
npm --prefix backend run test:coverage
```

---

## Docker 部署

### 使用 Docker Compose

```bash
# 构建镜像
docker-compose build

# 启动服务
docker-compose up -d

# 查看日志
docker-compose logs -f
```

### Dockerfile

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY backend/package*.json ./
RUN npm ci --only=production

COPY backend/dist ./dist
COPY backend/data ./data

EXPOSE 3000

CMD ["node", "dist/server.js"]
```

---

## 贡献指南

我们欢迎任何形式的贡献！

1. Fork 本仓库
2. 创建你的功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交你的更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启一个 Pull Request

请确保：

- 代码通过所有测试
- 新增功能包含相应测试
- 代码风格保持一致

---

## 更新日志

### [1.0.0] - 2026-07-23

#### 新增

- 初始版本发布
- 用户认证与多用户隔离
- 角色卡管理（SillyTavern v1/v2）
- 世界书管理
- 多 LLM 提供商支持
- 实时对话系统
- 插件系统
- 皮肤系统
- 响应式设计

---

## 许可证

本项目基于 [MIT](LICENSE) 开源协议。

---

## 致谢

感谢以下开源项目：

- [Express](https://expressjs.com/) - Node.js Web 框架
- [Socket.IO](https://socket.io/) - 实时通信库
- [jsonwebtoken](https://github.com/auth0/node-jsonwebtoken) - JWT 实现
- [bcryptjs](https://github.com/dcodeIO/bcrypt.js) - 密码加密
- [Winston](https://github.com/winstonjs/winston) - 日志库
- [mdui](https://www.mdui.org/) - Material Design UI 框架

---

<div align="center">

如果这个项目对你有帮助，请给一个 Star！

</div>
