[README.md](https://github.com/user-attachments/files/29641019/README.md)
# 动态围栏智能警务系统

警务指挥通信平台 — 基于三层不规则动态地理围栏算法的实时指挥调度系统。

## 技术栈

- **后端**: Spring Boot 3.1.10 + MyBatis-Plus 3.5.9 + MySQL 8.3 + WebSocket
- **前端**: Vue 3.4 CDN + 高德地图 JS API 2.0 + Three.js 0.160
- **安全**: JWT认证 + BCrypt密码哈希 + 限流防护
- **部署**: Docker + docker-compose

## 快速启动

### 前置条件
- JDK 17 或 21（JDK 25 不兼容 Spring Boot 3.1.x）
- MySQL 8.x

### 开发环境

```bash
# 1. 初始化数据库
mysql -u root -p < src/main/resources/schema.sql

# 2. 设置环境变量
export DB_PASSWORD=your_db_password
export AMAP_KEY=your_amap_key
export AMAP_SEC=your_amap_secret
export JWT_SECRET=$(openssl rand -base64 32)

# 3. 启动服务 (端口 6061)
cd tongxin-project
./mvnw spring-boot:run

# 4. 访问
# 浏览器打开 http://localhost:6061
# 健康检查 http://localhost:6061/actuator/health
```

### Docker部署

```bash
cd tongxin-project
./mvnw package -DskipTests
DB_PASSWORD=xxx AMAP_KEY=xxx AMAP_SEC=xxx JWT_SECRET=xxx docker-compose up -d
```

## 架构

```
Frontend (Vue 3 + Three.js 3D背景)
    ↓ REST + WebSocket
Backend (Spring Boot, port 6061)
    ├── controller/  — 6 REST controllers
    ├── service/     — FenceService(核心围栏算法), TrafficService(ETA)
    ├── config/      — WebSocket(/ws/command, 14种消息类型)
    └── common/      — JWT, RateLimiter, GeoUtils
    ↓ MyBatis-Plus
MySQL 8.3 (tongxin, 7 tables)
```

## 核心功能

- **三层动态围栏**: 核心圈(~3km) / 缓冲圈(~8km) / 扩展圈(~15km)，36方向采样 × 10种环境因素
- **ETD四层保护**: 借鉴美团配送ETA算法，取四种时间估算最大值
- **实时指挥通信**: WebSocket 14种消息类型，指令下达→状态推进→任务完成全链路
- **三端合一**: 指挥端(桌面) / 警员端(手机) / 公众端(平板) 共享单页应用
- **3D态势感知**: Three.js科技背景 + 独立3D指挥中心页面

## API端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/user/login` | 登录(JWT) |
| POST | `/api/user/register` | 注册 |
| GET | `/api/fence/dynamic-polygon` | 核心：三层围栏多边形 |
| POST | `/api/dispatch/nearest` | 核心：最近警力调度 |
| GET | `/api/commander/events` | 事件列表 |
| POST | `/api/officer/report` | 警员上报 |
| GET | `/api/guest/public/event` | 公示事件 |
| WS | `/ws/command` | 实时消息 |
