# APIMart Image Studio

基于 APIMart GPT-Image-2.6 API 的网页生成工具和服务端代理，支持文生图、参考图生成、任务查询、历史记录，以及 PNG、JPEG、WebP、GIF、SVG 输出。

公用演示站：[image2.hatsuneniku.shop](https://image2.hatsuneniku.shop/)。演示站由他人运营，请勿填写个人 API Key。

## 部署

需要 Docker 和 Docker Compose：

```bash
git clone https://github.com/luckyumimi/apimart-image-Transit.git
cd apimart-image-Transit
docker compose up -d --build
docker compose ps
```

服务默认只绑定 `127.0.0.1:43888`。使用宝塔或 Nginx 配置反向代理，目标设为 `http://127.0.0.1:43888`，并在反代层配置 HTTPS。

Linux 服务器更新：

```bash
chmod +x update.sh refresh.sh
./update.sh   # 拉取代码并重建；要求 Git 工作区干净
./refresh.sh  # 不拉代码，只重建
```

`update.sh` 使用 `git pull --ff-only`；有未提交改动时会退出。查看容器日志：`docker compose logs -f apimart-image-bridge`。

### 本机运行

Node.js 20+ 可运行网站和 CLI：

```bash
npm start
```

默认监听 `0.0.0.0:43888`，仅建议用于本机调试，不要直接暴露公网。需要通过 mihomo 代理访问外网时，使用 Node.js 22.21+ 或 24.5+：

```powershell
$env:HTTP_PROXY = "http://127.0.0.1:7890"
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
$env:PORT = "43889"
npm run start:proxied
```

## 使用

1. 在设置中填写 [APIMart API Key](https://apimart.ai/zh)。Key 会发送给当前网站实例代理请求，只使用你信任的实例。
2. 输入提示词，或拖入、粘贴、上传 JPEG、PNG、GIF、WebP 参考图，最多 16 张。
3. 系统按参考图数量选择文生图、图生图或多图生图；结果保存在本机浏览器历史中。
4. 可预览、下载图片、重新查询任务或删除单条历史。

默认模型为固定单价的 **2.6 Ext Flare**。Ext 仅支持 1K 和单张生成；普通 Flare / Sunburst 按实际 Token 用量计费。使用前请确认当前模型与价格。

普通模型支持 1K、2K、4K 和文档允许的比例或精确尺寸；Ext 仅支持文档列出的比例。GIF 使用自动尺寸；SVG 不支持参考图，Ext GIF 也不支持参考图。

## CLI 与 Skill

CLI 通过已运行的网站代理调用生成、上传、轮询和下载接口，不是独立 API 服务。PowerShell 示例：

```powershell
$secureKey = Read-Host "APIMart API Key" -AsSecureString
$env:APIMART_API_KEY = [System.Net.NetworkCredential]::new("", $secureKey).Password
$env:IMAGE_STUDIO_URL = "http://127.0.0.1:43888"
npm run image -- --prompt "雨夜中的红色跑车" --model ext-flare --size 16:9 --output .\generated
```

省略 `--model` 时使用 `ext-flare`。参数列表见 `node cli.js --help`；CLI 和网站 HTTP API 的完整调用示例见 [cliapi Skill](.agents/skills/cliapi/SKILL.md)。远程调用时只连接可信 HTTPS 实例，不要将 Key 写入命令参数、脚本或日志。

在 Codex 中打开本仓库即可使用项目级 `$cliapi`。要安装为用户级 Skill，在仓库根目录运行：

```powershell
$skillsRoot = if ($env:CODEX_HOME) { Join-Path $env:CODEX_HOME "skills" } else { Join-Path $env:USERPROFILE ".codex\skills" }
$skillTarget = Join-Path $skillsRoot "cliapi"
New-Item -ItemType Directory -Path $skillTarget -Force | Out-Null
Copy-Item ".\.agents\skills\cliapi\SKILL.md" -Destination $skillTarget -Force
```

复制后重新加载 Codex 或开启新会话。运行 `npm test` 执行 CLI 模拟路由测试；测试不访问 APIMart。

## 请求与计费

- 每次生成提交 1 次 `/api/generate`；每张参考图上传 1 次；任务默认每 3 秒轮询，最长 120 秒；下载时每张结果调用 1 次下载路由。
- 自动重试和模型回退均为 0。参数校验、比例预览和历史界面由程序确定性处理，不增加模型推理。
- 历史删除只改本地记录；详情不触发生成或轮询。未缓存的远程图片可能经图片代理加载，缓存使用 IndexedDB。
- 余额查询使用用户级 `/v1/user/balance`，与单令牌的 `/v1/balance` 不同。页面载入、保存 Key 和手动刷新时各查一次，不定时轮询、不自动重试、不触发图像生成；页面只显示剩余积分和已用积分。
- Ext 费用显示公开档位区间估算，实际扣费取决于 API Key 档位；普通 Flare / Sunburst 按实际 Token 用量结算。

容器重启后，服务器内存中的任务上下文会丢失；查询失败时需重新提交任务。
