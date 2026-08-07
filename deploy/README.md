# Docker 单机部署

当前编排面向单机 SQLite 部署。Compose 构建四个职责独立的镜像，但只把玩家端和管理端绑定到宿主机回环地址：

| 服务 | 容器端口 | 宿主机默认入口 | 公开访问 |
| --- | --- | --- | --- |
| `web` | 80 | `127.0.0.1:8080` | 由宿主机 Nginx 暴露玩家域名 |
| `admin` | 80 | `127.0.0.1:8081` | 由宿主机 Nginx 暴露管理域名 |
| `game-server` | 8787 | 不映射 | 仅 Docker 网络 |
| `content-server` | 8788 | 不映射 | 仅 Docker 网络 |

SQLite 房间库保存在 `game-data` 卷，账号、内容生命周期数据库和上传资源保存在 `content-data` 卷。该模式只能运行一个 `game-server` 实例，不要设置副本数。

## 首次启动

服务器需要 Docker Engine、Compose 插件和可用的宿主机 Nginx。Node.js 不需要安装在宿主机。

```bash
cp deploy/.env.example deploy/.env
openssl rand -hex 32
openssl rand -base64 32
```

把两个随机值分别写入 `CONTENT_RUNTIME_TOKEN` 和 `CONTENT_BOOTSTRAP_PASSWORD`，再把玩家、管理域名改成实际 HTTPS 地址。`deploy/.env` 已被 Git 忽略。

```bash
docker compose --env-file deploy/.env build
docker compose --env-file deploy/.env up -d
docker compose --env-file deploy/.env ps
```

本机入口默认是 `http://127.0.0.1:8080` 和 `http://127.0.0.1:8081`。生产环境必须通过下面的 HTTPS 反向代理访问；管理登录 Cookie 默认带 `Secure`，不会用于普通 HTTP。

## 宿主机 Nginx

下面示例假设证书配置由宿主机现有方案管理。玩家入口必须转发 WebSocket Upgrade，并由最外层代理覆盖而不是信任客户端提交的 `X-Forwarded-For`。

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}

server {
    listen 443 ssl http2;
    server_name play.example.com;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 1h;
    }
}

server {
    listen 443 ssl http2;
    server_name admin.example.com;
    client_max_body_size 6m;

    location / {
        proxy_pass http://127.0.0.1:8081;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $remote_addr;
    }
}
```

确认宿主机防火墙没有公开 `8080`、`8081`、`8787` 或 `8788`。Compose 默认把前两个端口绑定到 `127.0.0.1`，后两个完全不发布。

## 验收

```bash
curl -I http://127.0.0.1:8080/
curl -I http://127.0.0.1:8081/
docker compose --env-file deploy/.env ps
docker compose --env-file deploy/.env logs --tail=100 game-server content-server
```

通过正式域名继续确认：创建私人房间、第二个浏览器加入、WebSocket 对局、管理端登录、上传图片、创建草稿及发布。发布后的地图和皮肤资源应能从玩家域名的 `/content-assets/` 读取。

## 备份与升级

升级前停止两个写入服务，备份卷后再替换镜像：

```bash
docker compose --env-file deploy/.env stop game-server content-server
mkdir -p backups
docker run --rm -v goose-chess_game-data:/source:ro -v "$PWD/backups:/backup" alpine tar czf /backup/game-data.tgz -C /source .
docker run --rm -v goose-chess_content-data:/source:ro -v "$PWD/backups:/backup" alpine tar czf /backup/content-data.tgz -C /source .
docker compose --env-file deploy/.env build
docker compose --env-file deploy/.env up -d
```

不要只备份 SQLite 主文件而遗漏 WAL/SHM 文件；停止写入服务后归档整个卷可以避免这种问题。静态前端容器可以独立更新，但修改协议或内容格式时仍应执行完整仓库门禁和跨浏览器发布验收。
