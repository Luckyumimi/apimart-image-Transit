# APIMart Image Studio

面向 [APIMart](https://apimart.ai/zh) GPT-Image-2.6 接口的图像生成中转服务。提供浏览器端交互界面，通过服务端代理调用上游 API，支持文生图、图生图、多图生图，以及 PNG、JPEG、WebP、GIF、SVG 输出。

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

可选：

- 宝塔面板（或同类管理面板）
- Nginx
- 已解析的域名

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

### 2.6 模型说明

- `gpt-image-2.6-flare` / `gpt-image-2.6-sunburst`：按图片 Token 用量计费；支持 1K / 2K / 4K 和 15 种比例。质量选择自动时按 max 档预留，再按实际质量档位结算；SVG 还会产生文本模型 Token 用量。
- `gpt-image-2.6-ext`：默认选中，按张固定价，通过 Flare / Sunburst 版本选择；当前只开放 1K 和单张生成，质量档位不影响单张价格。

界面会随模型和输出格式限制参数：Ext 锁定 1K、单张及文档支持的比例，参考图最多 16 张；GIF 固定使用自动比例；SVG 不接受参考图，Ext 的 GIF 也不接受参考图。Ext 不生效的背景参数不会发送。旧版保存的普通 Flare 默认值会迁移到 Ext Flare。

### 架构审查记录

本阶段只调整客户端默认值和确定性参数约束，不增加模型推理或 API 请求：无参考图时一次生成仍提交 1 次 `/api/generate`，之后沿用现有任务轮询；有参考图时仍按每张图调用现有上传接口，客户端最多接受 16 张。自动重试和回退请求均为 0，缓存、延迟与失败恢复策略不变。默认计费模式改为 Ext 固定单价，用户显式选择普通 Flare / Sunburst 后仍按 Token 结算；自动质量的 max 档预留和 SVG 文本 Token 用量会在界面提示。客户端拦截不支持的参数组合，避免无效提交；不宣称具体节省金额，收益是降低误选计费模式和因参数不匹配而失败的概率。

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
