# APIMart Image Bridge

一个用于调用 APIMart `gpt-image-2` 的轻量中转站。

推荐部署方式不是本地 `npm start`，而是：

1. 先把项目 `git clone` 到服务器
2. 用 `docker compose` 跑起来
3. 用宝塔面板或 Nginx 反向代理
4. 最终通过域名访问

## 推荐部署流程

### 1. 克隆项目

先把项目拉到服务器，例如：

```bash
git clone <your-repo-url> apimart-image-bridge
cd apimart-image-bridge
```

如果你是直接上传代码包，也可以把项目放到类似目录：

```text
/www/wwwroot/apimart-image-bridge
```

### 2. 使用 Docker Compose 启动

项目已经自带 [docker-compose.yml](D:/codex/apimart/apimart%20image%20Transit/docker-compose.yml)。

直接执行：

```bash
docker compose up -d --build
```

启动后检查容器：

```bash
docker ps
```

正常情况下你会看到：

```text
0.0.0.0:3000->3000/tcp
```

### 3. 本机测试

如果你在服务器本机测试，可以访问：

```text
http://127.0.0.1:3000
```

### 4. 配置域名反代

如果你使用宝塔面板，网站反向代理目标地址填：

```text
http://127.0.0.1:3000
```

配置完成后，就可以通过域名访问。

## 宝塔面板部署

### 方法一：宝塔 Docker 管理 + Compose

1. 上传或克隆项目到服务器
2. 确保项目目录中包含 `docker-compose.yml`
3. 在宝塔中进入 Docker 管理
4. 导入或使用该 Compose 项目
5. 启动项目
6. 确认容器监听 `3000` 端口
7. 在宝塔网站里添加反向代理，目标地址填 `http://127.0.0.1:3000`

### 方法二：直接在服务器命令行执行

进入项目目录后执行：

```bash
docker compose up -d --build
```

然后在宝塔网站中添加反向代理即可。

## 宝塔反向代理怎么填

在宝塔网站设置里添加反向代理：

- 代理名称：`apimart`
- 目标 URL：`http://127.0.0.1:3000`
- 发送域名：`$host`

## Nginx 反向代理示例

如果你是直接写 Nginx 配置，可以用：

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

## HTTPS 示例

如果你的域名已经在宝塔中配置好了证书，可以参考：

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
        proxy_pass http://127.0.0.1:3000;
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

## 常用命令

### 启动

```bash
docker compose up -d --build
```

### 停止

```bash
docker compose down
```

### 重启

```bash
docker compose restart
```

### 查看状态

```bash
docker compose ps
```

### 查看日志

```bash
docker logs -f apimart-image-bridge
```

## 常见问题

### 1. 宝塔反代后出现 502

先检查容器是否正常运行：

```bash
docker ps
docker logs apimart-image-bridge
```

如果 `3000` 端口没起来，宝塔反代一定会报 502。

### 2. 域名无法访问

检查这些地方：

- 域名是否解析到服务器
- 宝塔网站是否创建成功
- 反向代理是否已经开启
- 服务器安全组是否放行 `80` / `443`
- 防火墙是否放行 `80` / `443`

### 3. 查询任务失败

当前任务上下文保存在服务端内存中。如果容器重启，未完成任务的上下文会丢失，需要重新提交请求。

## 可选：本地 Node 方式运行

如果你只是本地开发调试，也可以用 Node.js 直接运行：

```bash
npm install
npm start
```

默认访问地址：

```text
http://127.0.0.1:3000
```

但正式部署时，仍然推荐优先使用 Docker + 反代。
