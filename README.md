# APIMart Image Studio

面向 [APIMart](https://apimart.ai/zh) GPT-Image-2.6 接口的图像生成中转服务。提供浏览器端交互界面，通过服务端代理调用上游 API，支持文生图、图生图、多图生图，以及 PNG、JPEG、WebP、GIF、SVG 输出。

## 主要文件

- `server.js`：静态服务、APIMart 代理、任务查询、上传和下载
- `app.js`：浏览器界面、尺寸设置、历史记录和参考图处理
- `image-contract.js`：浏览器与 CLI 共用的精确尺寸限制
- `cli.js`：通过本站代理路由生成、轮询和下载
- `.agents/skills/cliapi/SKILL.md`：CLI 与网站 HTTP API 的调用说明
- `test/cli.test.js`：不访问 APIMart 的 CLI 模拟路由测试
- `index.html`、`styles.css`：页面结构和样式

## Codex Skill

`cliapi` 是仓库内的项目级 skill，位于 `.agents/skills/cliapi/SKILL.md`。在 Codex 中打开本仓库即可按 `$cliapi` 使用。要在其他项目中复用，可复制到用户级 skills 目录：

```powershell
$skillsRoot = if ($env:CODEX_HOME) { Join-Path $env:CODEX_HOME "skills" } else { Join-Path $env:USERPROFILE ".codex\skills" }
$skillTarget = Join-Path $skillsRoot "cliapi"
New-Item -ItemType Directory -Path $skillTarget -Force | Out-Null
Copy-Item ".\.agents\skills\cliapi\SKILL.md" -Destination $skillTarget -Force
```

复制后重新加载 Codex 或开启新会话，再调用 `$cliapi`。

## 在线演示

演示站点：[https://image2.hatsuneniku.shop/](https://image2.hatsuneniku.shop/) **你真的敢在在线演示站点填KEY吗？？？**

## 部署方式

推荐以下两种部署路径：

- **面板 + Docker + 反向代理**：适用于宝塔面板环境，通过面板管理域名与证书，Docker 运行服务。
- **纯 Docker 部署**：适用于无面板环境，Docker 直接运行，按需自行配置反向代理。

不推荐直接使用 `npm start` 运行。

## 运行要求

- Docker
- Docker Compose
- Node.js 20+（使用本地 CLI 时）

可选：

- 宝塔面板（或同类管理面板）
- Nginx
- 已解析的域名

### 本机通过代理运行

在 PowerShell 中设置 mihomo 代理后，用支持 `--use-env-proxy` 的 Node.js 版本启动本机服务（Node.js 22.21+ 或 24.5+）：

```powershell
$env:HTTP_PROXY = "http://127.0.0.1:7890"
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
$env:PORT = "43889"
npm run start:proxied
```

该脚本仅用于本机代理调试；Docker 继续使用 `npm start`，不依赖本机 mihomo。

## 部署步骤

### 1. 获取代码

```bash
git clone https://github.com/luckyumimi/apimart-image-Transit.git apimart-image-bridge
cd apimart-image-bridge
```

或直接将项目文件上传至服务器目录。

### 2. 构建并启动

```bash
docker compose up -d --build
```

确认容器运行状态：

```bash
docker compose ps
```

服务默认监听 `127.0.0.1:43888`，仅接受本机回环连接。

### 2.1 Linux 服务器一键更新

项目根目录提供了两个面向 Linux 服务器的脚本：

```bash
chmod +x update.sh refresh.sh
```

- `./update.sh`
  - 检查工作区是否干净
  - `git pull --ff-only`
  - `docker compose build --no-cache`
  - `docker compose up -d --force-recreate`
  - `docker compose ps`
- `./refresh.sh`
  - 不拉代码
  - 只执行无缓存构建和容器重建

推荐在服务器中进入项目目录后这样使用：

```bash
cd /path/to/apimart-image-bridge
./update.sh
```

如果当前目录有未提交改动，`./update.sh` 会直接退出并提示，不会自动覆盖本地文件。

### 3. 验证

在服务器本机访问 `http://127.0.0.1:43888`，页面正常打开即部署成功。

### 4. 配置反向代理

通过反向代理将域名指向本机 43888 端口，实现公网访问。

#### 宝塔面板

在面板中新建网站（无需 FTP、无需数据库），在网站设置中添加反向代理：

- 代理名称：`apimart`
- 目标 URL：`http://127.0.0.1:43888`
- 发送域名：`$host`

#### Nginx

```nginx
location / {
    proxy_pass http://127.0.0.1:43888;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

HTTPS 配置按常规方式添加 SSL 证书即可，`proxy_pass` 指向不变。

## 使用说明

1. 打开页面后，点击右上角设置按钮填写 APIMart API Key（可在 [apimart.ai/zh](https://apimart.ai/zh) 获取）
2. 在提示词输入框中描述所需画面，支持直接粘贴图片或点击"上传图片"附件
3. 按附件数量自动判定模式：无附件为文生图，单张为图生图，多张为多图生图
4. 默认使用 2.6 Ext Flare 固定单价模式；若切换到普通 Flare / Sunburst，图片会按 Token 用量计费。确认参数后点击"开始生成"
5. 生成结果展示在历史记录中，支持点击图片查看大图、下载到本地
6. 可从任意页面区域拖入 JPEG、PNG、GIF 或 WebP 图片添加为参考图；也可继续粘贴到提示词框或点击上传按钮

### CLI 调用

CLI 通过本站代理路由调用同一套 APIMart 生成、上传、任务查询和下载接口，不会绕过服务端直连上游。先启动站点，再在终端设置 API Key：

```powershell
$env:APIMART_API_KEY = [System.Net.NetworkCredential]::new("", (Read-Host "APIMart API Key" -AsSecureString)).Password
$env:IMAGE_STUDIO_URL = "http://127.0.0.1:43888"
npm run image -- --prompt "雨夜中的红色跑车" --model ext-flare --size 16:9 --output .\generated
```

也可以运行 `node cli.js --help` 查看所有参数。`--model` 支持 `ext-flare`、`ext-sunburst`、`flare`、`sunburst`；`--size` 支持 `auto`、比例或精确尺寸，例如 `1536x1024`。普通模型精确尺寸必须满足接口的倍数、像素面积、最长边和比例限制；此模式省略分辨率档位。Ext 只开放 1K、单张和文档支持的比例。

参考图可重复指定 `--reference <文件>`，最多 16 张。`--output <目录>` 会经 `/api/download` 保存图片；省略时输出图片 URL。默认提交后等待结果，首次轮询延迟为 6000 ms；`--no-wait` 只提交并打印任务 ID，稍后可用 `--task <任务 ID>` 继续查询。CLI 从 `APIMART_API_KEY` 环境变量读取密钥，不要把真实密钥写入脚本或命令历史。指定 `IMAGE_STUDIO_URL` 时，密钥会发送给该网站实例，请仅连接你信任的服务。

运行 `npm test` 可执行 CLI 参数和模拟网站路由测试；测试使用虚构响应，不会向 APIMart 发送请求。

### 2.6 模型说明

- `gpt-image-2.6-flare` / `gpt-image-2.6-sunburst`：按图片 Token 用量计费；支持 1K / 2K / 4K 和 15 种比例。质量选择自动时按 max 档预留，再按实际质量档位结算；SVG 还会产生文本模型 Token 用量。
- `gpt-image-2.6-ext`：默认选中，按张固定价，通过 Flare / Sunburst 版本选择；当前只开放 1K 和单张生成，质量档位不影响单张价格。

界面会随模型和输出格式限制参数：Ext 锁定 1K、单张及文档支持的比例，参考图最多 16 张；普通模型还可以指定符合接口限制的精确像素尺寸；GIF 固定使用自动尺寸；SVG 不接受参考图，Ext 的 GIF 也不接受参考图。Ext 不生效的背景参数不会发送。旧版保存的普通 Flare 默认值会迁移到 Ext Flare。

### 架构审查记录

比例预览、Ext 锁定分辨率、设置弹窗交互、卡片悬停和首次轮询默认值修正均由客户端确定性逻辑完成，不增加模型推理。尺寸预览和选择器形状按实际宽高比计算；设置弹窗恢复进场动画，拖选文字离开弹窗不会触发关闭；历史卡片悬停不再变色，内部按钮仍提供反馈。

每个任务仍提交 1 次 `/api/generate`；每张参考图额外调用 1 次上传接口，最多 16 张；轮询每 3000 ms 调用 1 次 `/api/tasks/:taskId`，直到终态或 120000 ms 超时；选择下载目录后每个结果调用 1 次 `/api/download`。首次轮询默认由 12000 ms 改为 6000 ms，网站和 CLI 保持一致；对仍在运行的任务，前 12 秒最多可能多 2 次状态查询，快速完成时结果最多提前约 6 秒显示。生成请求和模型计费不变，自动重试与模型回退仍为 0；变化限于状态查询流量。浏览器历史缩略图缓存仍使用 IndexedDB，CLI 不做远程缓存，仅写入指定目录。API Key 仍只传给调用的可信站点代理。比例选择器的 15 个选项与共享 API 契约一致，窄屏预览保持画布比例且无横向溢出。

历史详情窗、错误占位、耗时和收藏均由本地历史数据确定性渲染；单条删除只更新 localStorage 并清理不再引用的 IndexedDB 图片，不会取消上游任务，也不发请求。详情打开不会调用生成或轮询接口；仅当详情图片尚未进入 IndexedDB/浏览器缓存时，最多按需发起对应的 `/api/proxy-image` 请求，沿用现有图片缓存，不增加模型推理、重试、回退或生成成本。

本机代理启动只改变 Node 出站传输路径；请求体、生成与轮询次数、重试、模型计费均不变。Docker 继续使用 Node 20 默认启动入口。

## 常用运维命令

```bash
# 一键拉代码并更新（Linux 服务器）
./update.sh

# 仅重建并重启容器（不拉代码）
./refresh.sh

# 启动或重建
docker compose up -d --build

# 停止
docker compose down

# 重启
docker compose restart

# 查看状态
docker compose ps

# 查看日志
docker logs -f apimart-image-bridge
```

说明：如果 `docker compose` 提示 `docker-compose.yml` 中的 `version` 字段已过时，可以直接删除；本项目已经移除该字段以避免告警。

## 故障排查

| 问题 | 排查方向 |
|------|----------|
| 反向代理 502 | 检查容器是否运行：`docker ps`、`docker logs apimart-image-bridge` |
| 域名无法访问 | 域名解析、反向代理配置、防火墙 80/443 端口放行 |
| 任务查询失败 | 容器重启后内存中的任务上下文会丢失，需重新提交 |
| 图片加载缓慢 | 首次加载走代理下载，后续自动缓存至浏览器本地 |
