# 动态围栏智能警务系统

> Dynamic Geo-Fence Smart Policing System — 基于动态地理围栏的警务指挥调度与态势感知平台

<p align="center">
  <img src="https://img.shields.io/badge/license-Learning%20Only-red?style=flat-square" alt="License">
  <img src="https://img.shields.io/badge/Java-17%2B-orange?style=flat-square&logo=openjdk" alt="Java">
  <img src="https://img.shields.io/badge/Spring%20Boot-3.1-green?style=flat-square&logo=springboot" alt="Spring Boot">
  <img src="https://img.shields.io/badge/Vue-3.x-brightgreen?style=flat-square&logo=vuedotjs" alt="Vue">
  <img src="https://img.shields.io/badge/Build-Maven%20Wrapper-blue?style=flat-square&logo=apachemaven" alt="Maven">
  <img src="https://img.shields.io/badge/Docker-Ready-2496ED?style=flat-square&logo=docker" alt="Docker">
</p>

<p align="center">
  <b>⚠️ 仅供学习研究 · 禁止商业用途 · 禁止二次创作</b><br>
  详见 <a href="LICENSE">LICENSE</a>
</p>

---

## 项目简介

基于动态地理围栏的警务指挥调度与态势感知系统。核心创新：**三层不规则动态围栏算法**，实时融合 10 类环境因素（天气、交通流量、道路类型、水系障碍、铁路、公园绿地、红绿灯密度、建筑密度、地形噪声、高峰时段），沿 24 个方向采样计算，生成符合真实地形的围栏多边形。

### 三种角色视图

| 🖥️ 指挥端 | 📱 警员端 | 👤 公众端 |
|:---:|:---:|:---:|
| 事件监控大屏 | 接警处置 | 安全隐患反馈 |
| 围栏生成与可视化 | 现场状态上报 | 公共事件查看 |
| 自动派警调度 | 一键请求增援 | 地图浏览 |
| 实时双向通信 | GPS 位置同步 | — |

## 技术栈

| 层级 | 技术选型 |
|:---|:---|
| 后端框架 | Spring Boot 3.1.10 · Java 17 |
| ORM | MyBatis-Plus 3.5 |
| 数据库 | MySQL 8.0 |
| 前端 | Vue 3 CDN 单页应用 · 原生 CSS 科幻主题 |
| 地图 | 高德 JS API 2.0 + Web Service API |
| 3D | Three.js 0.160 独立态势中心 |
| 实时通信 | WebSocket 14 种消息类型 |
| 认证 | JWT + BCrypt + 限流器 |
| 构建 | Maven Wrapper (免安装 Maven) |
| 部署 | Docker + Docker Compose 一键编排 |

## 核心算法

### 三层不规则动态围栏

```
事件点 → 24方向采样(每15°) → 10因素加权 → 高斯平滑 → 不规则多边形
```

| 圈层 | 基础半径 | 用途 |
|:---|:---|:---|
| 🔴 核心圈 | ~3km | 优先响应警力 |
| 🟡 缓冲圈 | ~8km | 备选支援警力 |
| 🟢 扩展圈 | ~15km | 长距离调度 |

**10 因素加权模型：**

| # | 因素 | 数据源 | 影响 |
|:--:|:---|:---|:---|
| 1 | 天气 | 高德天气 API | 雨雪雾降低通行速度 10-40% |
| 2 | 实时交通 | 高德驾车路径规划 | 畅通→严重拥堵四级系数 |
| 3 | 道路类型 | 高德逆地理编码 | 高速 1.5x / 快速路 1.2x / 小路 0.5x |
| 4 | 水系障碍 | 高德 POI 搜索 | 河流湖泊降至 35% |
| 5 | 铁路障碍 | 高德 POI 搜索 | 系数 70% |
| 6 | 公园绿地 | 高德 POI 搜索 | 系数 85% |
| 7 | 红绿灯密度 | 道路类型推算 | 每灯 +15s 等待 |
| 8 | 建筑密度 | POI 数量推断 | 高密度区域减速 |
| 9 | 地形噪声 | 多倍频 Perlin 噪声 | 0.6-1.5x 随机波动 |
| 10 | 高峰时段 | 时间判断 | 拥堵概率 +20% |

### ETA 四层保护

借鉴外卖配送 ETA 算法，确保预估到达时间不虚低：

```
最终 ETA = max(模型预估, 城市特性保护, 分段累加保护, 实际距离保护)
```

## 快速开始

### 前提

- JDK 17 / 21
- MySQL 8.0+
- [高德开放平台](https://lbs.amap.com) API Key

### 本地运行

```bash
# 初始化数据库
mysql -u root -p < src/main/resources/schema.sql

# 设置环境变量
export DB_PASSWORD=your_db_password
export AMAP_KEY=your_amap_key
export AMAP_SEC=your_amap_secret
export JWT_SECRET=$(openssl rand -base64 32)

# 启动 (端口 6061)
./mvnw spring-boot:run
```

### Docker 部署

```bash
# 配置 .env 文件
echo "DB_PASSWORD=your_password" > .env
echo "JWT_SECRET=$(openssl rand -base64 32)" >> .env
echo "AMAP_KEY=your_key" >> .env
echo "AMAP_SEC=your_secret" >> .env

# 一键启动
docker-compose up -d
```

### 访问地址

| 页面 | URL |
|:---|:---|
| 主入口 | `http://localhost:6061` |
| 3D 态势中心 | `http://localhost:6061/command-center.html` |
| 健康检查 | `http://localhost:6061/actuator/health` |

## 系统架构

```
┌─────────────────────────────────────────────────────┐
│              前端 (Vue 3 CDN 单页应用)                │
│  index.html / command-center.html / app.js (~3700行) │
│         style.css / three-bg.js / police-badge.png    │
└──────────┬──────── REST + WebSocket ──┬──────────────┘
           │                            │
┌──────────▼────────────────────────────▼──────────────┐
│          后端 (Spring Boot 3.1, Port 6061)            │
│                                                       │
│  controller/ (6个)  ←→  service/ (FenceService 880行) │
│       ↕                        ↕                      │
│  config/ (WebSocket/CORS/JWT)  common/ (GeoUtils等)  │
│       ↕                                               │
│  mapper/ (7个)  ←→  entity/ (7个)  ←→  MySQL 8.0     │
└───────────────────────────────────────────────────────┘
```

## API 概览

| 方法 | 端点 | 说明 |
|:---|:---|:---|
| `POST` | `/api/user/login` | 登录 (BCrypt) |
| `POST` | `/api/user/register` | 注册 |
| `GET` | `/api/fence/dynamic-polygon?lng=&lat=` | 🔑 围栏多边形生成 |
| `POST` | `/api/dispatch/nearest` | 🔑 自动派警调度 |
| `GET` | `/api/commander/events` | 事件列表 |
| `POST` | `/api/officer/report` | 警员上报 |
| `POST` | `/api/officer/reinforce` | 请求增援 |
| `POST` | `/api/guest/feedback` | 公众反馈 |
| `GET` | `/api/guest/public/event` | 公示事件 |
| `WS` | `/ws/command` | 实时通信 |

## 项目结构

```
tongxin-project/
├── pom.xml                    # Maven 配置 (Spring Boot 3.1)
├── Dockerfile                 # 容器镜像
├── docker-compose.yml         # 一键编排 (App + MySQL)
├── LICENSE                    # 学习用途许可协议
├── README.md
│
├── .github/workflows/
│   └── build.yml              # CI 自动构建
│
├── certs/
│   └── san.cnf                # SSL 证书配置
│
├── src/main/java/com/example/tongxinproject/
│   ├── controller/            # 6 个 REST 控制器
│   ├── service/               # 核心算法 (FenceService ~880行)
│   ├── service/impl/          # 服务实现
│   ├── mapper/                # 7 个 MyBatis 数据访问
│   ├── entity/                # 7 个数据实体
│   ├── dto/                   # 数据传输对象
│   ├── config/                # WebSocket / CORS / JWT
│   └── common/                # GeoUtils / JWT / 限流 / 异常
│
├── src/main/resources/
│   ├── application.properties       # 主配置
│   ├── application-dev.properties   # 开发环境
│   ├── application-prod.properties  # 生产环境
│   ├── schema.sql                   # DDL
│   ├── logback-spring.xml           # 日志
│   └── static/                      # 前端 SPA
│       ├── index.html               # 主页面
│       ├── command-center.html      # 3D 态势中心
│       ├── app.js                   # Vue 3 逻辑
│       ├── three-bg.js              # Three.js 背景
│       └── style.css                # 科技感主题
│
└── src/test/
    ├── java/                        # 单元测试
    └── resources/                   # 测试配置
```

## 许可

```
✅ 允许：个人学习 · 教育用途 · 学术引用（需注明出处）
❌ 禁止：商业用途 · 二次创作 · 衍生作品 · 重新分发
```

本项目受 **学习用途许可协议** 保护。未经作者明确书面授权，不得用于商业目的或基于本项目创建衍生作品。

---

<p align="center">
  <sub>Built with Spring Boot · Vue 3 · AMap · Three.js · Docker</sub>
</p>
