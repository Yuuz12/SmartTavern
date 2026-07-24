# SmartTavern 安装指南

## 环境要求

- Node.js >= 18
- npm

## 安装步骤

### 1. 解压

将本压缩包解压到任意目录。

### 2. 安装依赖

在解压后的根目录执行：

```bash
npm run install:all
```

该命令会同时安装根目录与 `backend/` 的依赖。

### 3. 配置环境变量

复制 `backend/.env.example` 为 `backend/.env`，并按需修改：

```bash
copy backend\.env.example backend\.env
```

重点配置项：

- `JWT_SECRET`：**生产环境务必改为随机长字符串**
- `PORT`：服务端口，默认 3000
- `CORS_ORIGIN`：前端访问地址（默认同源 http://localhost:3000）

### 4. 启动服务

本发布包已包含后端构建产物（`backend/dist/`），可直接以生产模式启动：

```bash
npm run start:backend
```

开发模式（源码热重载）：

```bash
npm run dev
```

### 5. 访问

浏览器打开 http://localhost:3000

## 说明

- **数据目录**：首次启动会自动创建 `backend/data`、`backend/uploads`、`backend/backups` 目录。
- **用户隔离**：用户数据按账户隔离存储在 `backend/data/users/{用户ID}/` 下，每个用户的角色卡、世界书、对话各自独立。
- **首次使用**：首次访问需注册账号（若管理员未关闭注册）。
- **重新构建后端**（如修改了后端源码）：在根目录执行 `npm run build:backend`。
