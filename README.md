# 个人网址导航站

一个优雅、快速的书签（网址）收藏与展示平台，完全基于 Cloudflare 全家桶构建：**Pages Functions + D1 数据库 + KV 存储**，免服务器、全球边缘节点加速、免费额度即可长期使用。

> 本版本为个人定制版：已移除页脚 GitHub 链接与默认站点名水印，并将全部服务端逻辑编译为 `_worker.js`，支持 Cloudflare Pages 拖拽直传部署（无需 GitHub）。

---

## ✨ 功能特性

| 特性 | 说明 |
| :--- | :--- |
| 📱 响应式设计 | 适配桌面、平板、手机，移动端可独立配置 1/2/3 列布局 |
| 🎨 高度可定制 | 后台可视化设置：主色调、暗色模式、壁纸、卡片风格/列数/圆角/毛玻璃/切换动画 |
| 🔒 隐私书签 | 书签与分类均支持私密标记，私密内容仅登录管理员可见 |
| 🗂️ 多级分类 | 支持多级分类树与排序，首页菜单自动渲染 |
| 🔍 站内搜索 | 首页即时搜索，可切换 Google / 百度 / GitHub 外部搜索引擎 |
| 📥 导入导出 | 支持 Chrome 书签 HTML 一键导入；数据 JSON 导出/导入 |
| 💾 WebDAV 备份 | 定时备份到任意 WebDAV 网盘（坚果云等），支持备份列表管理 |
| 🤖 AI 描述 | 支持 Workers AI / Gemini / OpenAI 自动补全书签描述（可选） |
| 🛡️ 安全加固 | 恒定时间密码比较、登录限流防爆破、CSRF/Origin 校验、Turnstile 人机验证（可选） |
| ⚡ 边缘缓存 | 首页 HTML 按版本缓存于 KV，读写分离，秒级加载 |

---

## 🚀 快速部署（拖拽直传，无需 GitHub）

> 本方式使用 `_worker.js` 高级模式，部署包为 `public` 目录打成的 zip。

### 步骤 1：创建 D1 数据库

1. Cloudflare 控制台 → **存储和数据库** → **D1 SQL 数据库** → 创建（名称随意，如 `book`）
2. 无需手动建表：应用首次请求时会自动完成建表与迁移

### 步骤 2：创建 KV 命名空间

1. **存储和数据库** → **Worker KV** → 创建命名空间（如 `nav-auth`）

### 步骤 3：创建 Pages 项目并上传部署包

1. **Workers & Pages** → 创建 → **Pages** → **Use direct upload**
2. 填写项目名，将部署包 zip 拖入上传框 → 部署
3. 部署包内容要求：根级包含 `index.html`、`_worker.js`、`_headers`、`_routes.json` 及 `css/`、`js/`、`admin/` 目录

### 步骤 4：配置绑定（关键步骤）

进入 Pages 项目 → **设置** → **绑定**，添加：

| 绑定名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `NAV_DB` | D1 数据库 | 选择步骤 1 创建的数据库（**必需**） |
| `NAV_AUTH` | KV 命名空间 | 选择步骤 2 创建的命名空间（**必需**） |

如需 Workers AI 生成描述，再添加 `AI` 绑定（Workers AI）。

> ⚠️ **绑定保存后必须重新部署一次**才会生效。

### 步骤 5：设置管理员账号

进入 `NAV_AUTH` 对应的 KV 命名空间 → 添加两个条目：

| 键 | 值 |
| :--- | :--- |
| `admin_username` | 管理员用户名 |
| `admin_password` | 管理员密码 |

### 步骤 6：开始使用

1. 访问 `https://<项目名>.pages.dev` 查看首页
2. 访问 `/admin` 登录后台，开始添加书签
3. 建议绑定自定义域名（SSL/TLS → Edge Certificates → 打开 Always Use HTTPS）

> 📌 注意：Direct Upload 方式创建的项目**无法再转为 Git 集成**；以后更新站点 = 重新拖拽上传部署包。

---

## 🔧 备选部署方式

### Wrangler CLI 直传

```bash
npx wrangler login
# 在项目根目录执行（会自动识别 functions/ 目录）
npx wrangler pages deploy public --project-name=<项目名> --branch=main
```

> 使用此方式前请**删除 `public/_worker.js`**，避免与 `functions/` 目录冲突。绑定同样在控制台配置。

### Git 集成（GitHub/GitLab）

构建命令 `npm run build:css`，输出目录 `public`，绑定在控制台配置。本地调试用的 `wrangler.toml` 保持 gitignore，不要提交占位符资源 ID。

---

## ⚙️ 环境变量（Pages 项目 → 设置 → 变量和机密）

| 变量 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `SITE_NAME` | `我的导航` | 首页站点名称（后台设置优先） |
| `SITE_DESCRIPTION` | 一个优雅、快速的书签收藏与分享平台 | 首页副标题 |
| `FOOTER_TEXT` | — | 页脚版权文案 |
| `ENABLE_PUBLIC_SUBMISSION` | `false` | 设为 `true` 开启访客公开投稿 |
| `ICON_API` | `https://faviconsnap.com/api/favicon?url=` | 站点图标生成服务 |
| `AI_REQUEST_DELAY` | `1500` | AI 生成描述的请求间隔（毫秒） |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | 空 | 可选：Cloudflare Turnstile 人机验证 |

站点名称、描述、页脚文案等展示类配置也可直接在后台「设置」中修改，后台设置优先于环境变量。

---

## 🖥️ 后台管理（`/admin`）

- **书签管理**：增删改查、拖拽排序、批量操作、私密标记
- **分类管理**：多级分类、排序、私密分类（其下书签自动私密）
- **站点设置**：布局、壁纸、卡片样式、字体字号、搜索引擎开关等，桌面端/移动端独立配置，实时预览
- **缓存清理**：改完设置如前台未刷新，可在此手动清理首页缓存
- **导入/导出**：Chrome 书签导入、JSON 备份导入导出、WebDAV 备份管理
- **AI 设置**：配置描述自动生成（Workers AI / Gemini / OpenAI）

会话支持 1/7/30/60/90 天有效期，HttpOnly Cookie，后台右上角可退出登录。

---

## 💻 本地开发

```bash
# 1. 复制本地配置模板，填入自己的 D1/KV 资源 ID
cp wrangler.example.toml wrangler.toml

# 2. 安装依赖
npm install

# 3. 初始化本地数据库
npx wrangler d1 execute book --local --file=schema.sql

# 4. 启动本地开发服务
npm run dev
```

其他常用命令：

```bash
npm run check        # 语法检查 + 全量单元测试（308 个用例）
npm run build:css    # 编译压缩 Tailwind CSS
npm run test:e2e     # Playwright 端到端测试
```

---

## 🔄 更新站点流程

**只改静态文件（HTML/CSS/JS）时：**

1. 修改 `public/` 下文件；改了 JS/CSS 后运行 `node scripts/update-versions.js` 刷新 `?v=hash` 缓存版本戳
2. 重新将 `public` 目录打包为 zip，拖拽上传新部署

**改了服务端逻辑（`functions/`）时：**

```bash
# 重新编译 _worker.js
npx wrangler pages functions build --outdir=worker-build
cp worker-build/index.js public/_worker.js

# 打包 public 目录为 zip 后重新拖拽部署
```

> 💡 首页 HTML 在 KV 中按版本缓存（TTL 6 小时），且缓存键跨部署共享。改动首页渲染逻辑后，建议将 `functions/constants.js` 中的 `HOME_CACHE_VERSION` 版本号 +1，新部署即可自动抛弃全部旧缓存。

---

## ❓ 常见问题

**`/admin` 无法登录或反复跳回登录页**
确认 `NAV_AUTH` 已绑定，且 KV 中已创建 `admin_username`、`admin_password` 两个键；绑定后需重新部署。

**首页 500 或数据为空**
确认 `NAV_DB` 绑定正确；首次访问会自动建表，无需手动执行 schema。

**改了设置/书签但首页没变化**
首页 HTML 有 KV 缓存（6 小时）。可在后台「缓存清理」手动清除；也可强制刷新浏览器（Ctrl+F5）。

**改了样式但没生效**
先运行 `npm run build:css`，再运行 `node scripts/update-versions.js`，然后重新部署。

**重新部署后页脚/旧内容仍在**
属于 KV 旧缓存（详见上一条）；若涉及首页渲染改动，按「更新站点流程」升级 `HOME_CACHE_VERSION` 后重新部署。

**公开投稿入口不见了**
公开投稿默认关闭，需将环境变量 `ENABLE_PUBLIC_SUBMISSION` 设为 `true` 并重新部署。

---

## 🧱 技术栈

| 层 | 技术 |
| :--- | :--- |
| 前端 | 原生 JS + Tailwind CSS，服务端渲染首页 |
| 服务端 | Cloudflare Pages Functions（Workers 运行时） |
| 数据库 | Cloudflare D1（SQLite），含自动 Schema 迁移与防环/隐私触发器 |
| 缓存/会话 | Cloudflare KV |
| 构建 | Wrangler（`functions/` → `_worker.js` 编译）、Tailwind CSS |
| 测试 | Node.js 内置 test runner（308 用例）+ Playwright E2E |

---

## 📄 许可证

[MIT](./LICENSE)
