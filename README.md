# 动态围栏智能警务系统 (Dynamic Geo-Fence Smart Policing System)

> ⚠️ **许可声明**：本项目仅供学习研究使用，**禁止商业用途**，**禁止二次创作**。详见 [LICENSE](LICENSE)。

## 项目简介

基于动态地理围栏的警务指挥调度与态势感知系统。核心创新点在于**三层不规则动态围栏算法**，通过多维度环境因素（天气、交通、道路类型、水系障碍、铁路、公园、红绿灯、建筑密度、地形噪声等）综合计算每个方向的围栏边界距离，生成接近真实地形约束的不规则围栏多边形。

### 三种用户角色

| 角色 | 视图 | 功能 |
|------|------|------|
| **指挥端** (Commander) | 指挥中心大屏 | 事件监控、围栏生成、自动派警、实时通信 |
| **警员端** (Officer) | 移动端 | 接警处置、现场上报、请求增援、位置同步 |
| **公众端** (Guest) | 公众页面 | 安全隐患反馈、公共安全事件查看 |

## 技术栈

| 层级 | 技术 |
|------|------|
| **后端框架** | Spring Boot 3.1.10 + Java 17 |
| **数据层** | MyBatis-Plus + MySQL 8.x |
| **前端框架** | Vue 3 CDN (单页应用) |
| **地图服务** | 高德地图 JS API 2.0 + Web Service API |
| **3D可视化** | Three.js 0.160 (独立态势中心) |
| **实时通信** | WebSocket (14种消息类型) |
| **构建工具** | Maven Wrapper |
| **容器化** | Docker + Docker Compose |

## 核心算法：三层动态围栏

系统以事件点为中心，沿24个方向（每15°一个采样点）进行多点环境采样，综合以下因素计算每个方向的可达距离：

1. **天气**（高德天气API）— 雨/雪/雾降低通行速度
2. **实时交通**（高德驾车路径规划API）— 畅通→严重拥堵四级
3. **道路类型**（高德逆地理编码）— 高速/快速路/城市道路/小路
4. **水系障碍**（高德POI搜索）— 河流/湖泊检测，可达距离降至35%
5. **铁路障碍** — 可达系数70%
6. **公园/绿地障碍** — 可达系数85%
7. **红绿灯密度** — 基于道路类型的预估等待时间
8. **建筑密度** — POI数量和地址类型推断
9. **多倍频地形噪声** — 产生0.6-1.5倍的自然不规则性
10. **高峰时段调整** — 早晚高峰拥堵概率+20%

生成三层围栏：
- **核心圈** (~3km 基础半径)
- **缓冲圈** (~8km 基础半径)
- **扩展圈** (~15km 基础半径)

算法流程：多点采样 → 加权综合 → 高斯平滑(σ=2) → 不规则多边形顶点

## 预计到达时间（ETA）四层保护

借鉴外卖配送ETA算法，最终ETA = max(模型预估时间, 城市特性保护时间, 分段累加保护时间, 实际距离保护时间)

## 快速开始

### 前置条件

- JDK 17 或 21
- MySQL 8.0+
- 高德地图 API Key（从 [高德开放平台](https://lbs.amap.com) 申请）

### 本地开发

```bash
# 1. 创建数据库
mysql -u root -p < src/main/resources/schema.sql

# 2. 配置环境变量
export DB_PASSWORD=your_password
export AMAP_KEY=your_amap_key
export AMAP_SEC=your_amap_secret
export JWT_SECRET=your_jwt_secret

# 3. 启动服务（端口 6061）
cd tongxin-project
./mvnw spring-boot:run
```

### Docker 部署

```bash
docker-compose up -d
```

### 访问

- 主页面：`http://localhost:6061`
- 3D 态势中心：`http://localhost:6061/command-center.html`
- 健康检查：`http://localhost:6061/actuator/health`

## 系统架构

```
Frontend (Vue 3 CDN, 单页应用 + 3D 态势中心)
  ├── index.html          — 虚拟城市枢纽 → 三角色视图
  ├── command-center.html — Three.js 3D 态势感知中心
  ├── app.js              — Vue 3 前端逻辑 (~3700行)
  ├── three-bg.js         — Three.js 动态3D背景
  └── style.css           — 科幻指挥中心主题样式
       ↓ REST + WebSocket
Backend (Spring Boot 3.1.10, Port 6061)
  ├── controller/   — 6个 REST 控制器
  ├── service/      — 核心算法服务 (FenceService, TrafficService)
  ├── mapper/       — MyBatis-Plus 数据访问层
  ├── entity/       — 7个数据实体
  ├── config/       — WebSocket/CORS/JWT 配置
  └── common/       — 地理工具/全局异常/JWT令牌
```

## 主要 API

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | `/api/user/login` | 用户登录 (BCrypt) |
| POST | `/api/user/register` | 用户注册 |
| GET | `/api/fence/dynamic-polygon?lng=&lat=` | **核心**：三层不规则围栏多边形生成 |
| POST | `/api/dispatch/nearest` | **核心**：围栏内最近警力自动指派 |
| GET | `/api/commander/events` | 事件列表 |
| POST | `/api/officer/report` | 警员现场上报 |
| POST | `/api/officer/reinforce` | 警员请求增援 |
| POST | `/api/guest/feedback` | 公众安全隐患反馈 |
| GET | `/api/guest/public/event` | 公共安全事件 |
| WS | `/ws/command` | 实时双向通信 |

## 项目结构

```
tongxin-project/
├── pom.xml                          # Maven 构建配置
├── Dockerfile                       # 容器镜像
├── docker-compose.yml               # 容器编排
├── LICENSE                          # 学习用途许可
│
├── certs/
│   └── san.cnf                      # SSL证书配置
│
├── src/
│   ├── main/
│   │   ├── java/com/example/tongxinproject/
│   │   │   ├── controller/          # REST 控制器 (6个)
│   │   │   ├── service/             # 业务逻辑 (FenceService核心880行)
│   │   │   ├── mapper/              # MyBatis 数据访问 (7个)
│   │   │   ├── entity/              # 数据实体 (7个)
│   │   │   ├── dto/                 # 数据传输对象
│   │   │   ├── config/              # WebSocket/CORS/认证配置
│   │   │   └── common/              # JWT/限流/地理工具/异常处理
│   │   │
│   │   └── resources/
│   │       ├── application.properties      # 主配置
│   │       ├── application-dev.properties  # 开发环境
│   │       ├── application-prod.properties # 生产环境
│   │       ├── schema.sql                  # 数据库 DDL
│   │       ├── logback-spring.xml          # 日志配置
│   │       │
│   │       └── static/
│   │           ├── index.html              # 主页面 SPA
│   │           ├── command-center.html     # 3D 态势中心
│   │           ├── app.js                  # Vue 3 前端逻辑
│   │           ├── three-bg.js             # Three.js 3D 背景
│   │           ├── style.css               # 全局样式
│   │           └── police-badge.png        # 警徽 Logo
│   │
│   └── test/
│       ├── java/                           # 单元测试
│       └── resources/                      # 测试配置
│
└── .github/workflows/
    └── build.yml                           # CI/CD
```

## 许可

本项目采用 **学习用途许可协议 (Learning-Only License)**：

- ✅ 允许个人学习、教育用途、学术引用
- ❌ **禁止商业用途**
- ❌ **禁止二次创作/衍生作品**
- ❌ **禁止重新分发**

详见 [LICENSE](LICENSE) 文件。
