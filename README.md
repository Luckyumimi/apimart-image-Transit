# APIMart Image Bridge

## 概述

APIMart Image Bridge 是一个面向 APIMart `gpt-image-2` 接口的轻量级中转服务。项目提供浏览器端页面用于提交图像生成请求，并通过 Node.js 服务端代理调用上游接口，从而避免浏览器直接访问 APIMart 接口。

本项目推荐采用以下部署路径：

1. 将项目代码克隆至目标服务器
2. 使用 Docker Compose 启动服务
3. 通过宝塔面板或 Nginx 配置反向代理
4. 通过域名对外提供访问

## 架构说明

- 应用服务默认监听 `43888` 端口
- 前端页面通过 `/api/generate` 与 `/api/tasks/:id` 调用本服务
- 本服务再转发请求至 `https://api.apimart.ai`
- 用户在页面内输入 APIMart `API Key`，服务端仅用于本次请求转发
- 任务上下文暂存于服务端内存，不写入数据库

## 运行要求

### 基础要求

- Git
- Docker
- Docker Compose

### 可选要求

- 宝塔面板
- Nginx
- 已完成解析的域名

## 标准部署流程

### 第一步：获取项目代码

在服务器上执行：

```bash
git clone https://github.com/lichi7887/apimart-image-Transit.git apimart-image-bridge
cd apimart-image-bridge
```

如不通过 Git 获取代码，也可将项目上传至服务器目录，例如：

```text
/www/wwwroot/apimart-image-bridge
```

## 第二步：使用 Docker Compose 启动服务

项目根目录已包含 [docker-compose.yml](D:/codex/apimart/apimart%20image%20Transit/docker-compose.yml)。

在项目目录中执行：

```bash
docker compose up -d --build
```

启动完成后，建议执行以下命令确认容器状态：

```bash
docker compose ps
```

或：

```bash
docker ps
```

正常情况下，服务将监听以下端口：

```text
0.0.0.0:43888->43888/tcp
```

## 第三步：验证服务可用性

在服务器本机访问：

```text
http://127.0.0.1:43888
```

若页面可正常打开，则说明容器启动成功。

## 第四步：配置反向代理并绑定域名

如使用宝塔面板，请创建网站并将该网站配置为反向代理站点。反向代理目标地址应设置为：

```text
http://127.0.0.1:43888
```

完成后，即可通过域名访问该服务。

## 宝塔面板部署说明

### 建站建议

在宝塔面板中新建网站时：

- 需要创建网站：是
- 需要创建 FTP：否
- 需要创建数据库：否

原因如下：

- 本项目通过 Docker 容器提供服务
- 宝塔网站仅用于域名接入与反向代理
- 当前版本不依赖 MySQL、MariaDB 或其他关系型数据库

### 反向代理配置项

在宝塔网站设置中新增反向代理时，建议按以下内容填写：

- 代理名称：`apimart`
- 目标 URL：`http://127.0.0.1:43888`
- 发送域名：`$host`

## Nginx 反向代理配置示例

如采用 Nginx 手工配置，可参考以下示例：

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

上述配置可满足本项目当前访问需求，同时保留对升级头的兼容处理。

## HTTPS 配置示例

如需通过 HTTPS 对外提供服务，可参考以下 Nginx 配置结构：

```nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate     /www/server/panel/vhost/cert/your-domain/fullchain.pem;
    ssl_certificate_key /www/server/panel/vhost/cert/your-domain/privkey.pem;

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
}
```

## 常用运维命令

### 启动或重建服务

```bash
docker compose up -d --build
```

### 停止服务

```bash
docker compose down
```

### 重启服务

```bash
docker compose restart
```

### 查看服务状态

```bash
docker compose ps
```

### 查看日志

```bash
docker logs -f apimart-image-bridge
```

## 故障排查

### 1. 宝塔反向代理返回 502

通常表示反向代理目标不可用。建议依次检查：

```bash
docker ps
docker logs apimart-image-bridge
```

并确认 `43888` 端口已正常监听。

### 2. 域名无法访问

请重点检查以下项目：

- 域名是否已解析至服务器公网 IP
- 宝塔网站是否已正确创建
- 反向代理是否已启用
- 防火墙是否已放行 `80` / `443`
- 云服务器安全组是否已放行 `80` / `443`

### 3. 任务查询失败

当前版本将任务上下文保存在服务端内存中。如容器重启，尚未完成的任务上下文将丢失，因此需要重新提交生成请求。

## 本地开发说明

本项目支持通过 Node.js 直接运行，但该方式仅建议用于本地开发或临时调试，不作为标准部署方式。

```bash
npm install
npm start
```

默认访问地址：

```text
http://127.0.0.1:43888
```

## 生产环境注意事项

- 当前版本未引入持久化任务存储
- 如需提高稳定性，建议将任务上下文迁移至 Redis 或数据库
- 如需多人共用，建议补充鉴权、访问控制与审计日志能力
