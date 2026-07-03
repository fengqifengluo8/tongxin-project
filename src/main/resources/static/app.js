(function () {
  const { createApp } = Vue;

  const LS_USERS = "pcmp_users_v2";
  const LS_USERS_LEGACY = "pcmp_users_v1";
  const LS_SESSION = "pcmp_session_v2";
  const LS_AMAP = "pcmp_amap_keys";
  const LS_GUEST_INTRO = "pcmp_guest_intro_seen";
  const LS_TOKEN = "pcmp_token";

  // 调试开关（生产环境应为false）
  const DEBUG = false;

  // JWT令牌管理
  let authToken = null;
  function getToken() {
    if (authToken) return authToken;
    try { authToken = localStorage.getItem(LS_TOKEN); } catch { authToken = null; }
    return authToken;
  }
  function setToken(token) {
    authToken = token;
    if (token) { safeSetItem(LS_TOKEN, token); }
    else { try { localStorage.removeItem(LS_TOKEN); } catch {} }
  }
  function clearToken() { setToken(null); }

  // localStorage安全写入（处理QuotaExceededError）
  function safeSetItem(key, value) {
    try { localStorage.setItem(key, value); }
    catch (e) {
      if (e.name === 'QuotaExceededError') {
        console.warn('localStorage full, clearing old data');
        try { localStorage.clear(); localStorage.setItem(key, value); }
        catch {}
      }
    }
  }

  // 统一的fetch封装（自动附加JWT）
  // 上次连接测试结果（避免重复检测）
  let lastConnectivityCheck = null;

  // 检测服务器连接状态
  async function checkConnectivity() {
    try {
      const res = await fetch("/actuator/health", { method: "HEAD", cache: "no-cache" });
      lastConnectivityCheck = { ok: res.ok, time: Date.now(), error: null };
      return lastConnectivityCheck;
    } catch (e) {
      let hint = "无法连接到服务器";
      if (e.message && e.message.includes("Failed to fetch")) {
        if (location.protocol === "https:") {
          hint = "证书未受信任。请先访问 " + location.protocol + "//" + location.host + "/cert-help 安装CA证书";
        } else {
          hint = "服务未启动或网络不通，请检查服务状态";
        }
      }
      lastConnectivityCheck = { ok: false, time: Date.now(), error: hint };
      return lastConnectivityCheck;
    }
  }

  let onAuthExpired = null; // Token过期回调

  function authFetch(url, options) {
    options = options || {};
    options.headers = options.headers || {};
    const token = getToken();
    if (token) {
      options.headers["Authorization"] = "Bearer " + token;
    }
    if (!options.headers["Content-Type"] && !(options.body instanceof FormData)) {
      options.headers["Content-Type"] = "application/json";
    }
    return fetch(url, options).then(r => {
      // 401表示Token无效或过期，自动清除并触发回调
      if (r.status === 401 && token) {
        clearToken();
        if (onAuthExpired) onAuthExpired();
      }
      return r;
    }).catch(e => {
      if (e.message && e.message.includes("Failed to fetch") && location.protocol === "https:") {
        throw new Error("HTTPS证书未受信任，请安装CA证书: " + location.protocol + "//" + location.host + "/cert-help");
      }
      throw e;
    });
  }

  // XSS防护：HTML转义工具函数
  function escapeHtml(str) {
    if (!str) return "";
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  function loadUsers() {
    try {
      const raw = localStorage.getItem(LS_USERS);
      if (raw) return JSON.parse(raw);
      const leg = localStorage.getItem(LS_USERS_LEGACY);
      if (leg) {
        const old = JSON.parse(leg);
        const next = {};
        for (const k of Object.keys(old)) {
          next[k] = { h: old[k].h, role: "officer" };
        }
        localStorage.setItem(LS_USERS, JSON.stringify(next));
        return next;
      }
      return {};
    } catch {
      return {};
    }
  }

  function saveUsers(map) {
    safeSetItem(LS_USERS, JSON.stringify(map));
  }

  function hashPass(pw) {
    let h = 0;
    for (let i = 0; i < pw.length; i++) h = (Math.imul(31, h) + pw.charCodeAt(i)) | 0;
    return String(h);
  }

  const IDENTITY_TEXT = {
    commander: "您是 · 指挥调度人员",
    officer: "您是 · 一线执勤警员",
    guest: "您是 · 市民访客",
  };

  // 基础默认坐标（武汉），统一管理避免散落硬编码
  const DEFAULT_CENTER_LNG = 114.305558;
  const DEFAULT_CENTER_LAT = 30.592759;
  const DEFAULT_FENCE_DX = 0.015;
  const DEFAULT_FENCE_DY = 0.012;
  const DEFAULT_AUTO_DX = 0.008;
  const DEFAULT_AUTO_DY = 0.006;

  createApp({
    data() {
      return {
        isLoggedIn: false,
        userRole: "",
        authStage: "hub",
        pendingRole: "commander",
        hubHover: "",
        identityLine: "",
        transitionTimer: null,

        isLoginMode: true,
        username: "",
        password: "",
        confirmPassword: "",
        isProcessingAuth: false,
        authError: "",

        guestNickname: "",
        captchaA: 0,
        captchaB: 0,
        captchaUser: "",
        showGuestIntro: false,

        origin: typeof location !== "undefined" ? location.origin : "",

        dutyStatus: '执勤中', // 执勤中、办案中
        transportMode: '步行', // 步行、骑行、开车
        officerLng: null,
        officerLat: null,
        officerAddress: "",
        officerName: "警员",
        officerId: "U-001",
        averageRating: 0,
        mapContext: "",
        mapMarkers: [],
        mapFocusId: "",

        commanderEvents: [],
        completedEventIds: [],
        eventsLoading: false,
        officerOrders: [],
        reportDraft: {
          type: "治安",
          text: "",
          useLocation: true,
          priority: "中"
        },

        nearbyIncidents: [],
        volunteerIncidents: [],

        publicEvents: [],
        selectedPublicEvent: null,
        guestFeedback: { vague: "", text: "" },
        safetyReports: [], // 安全隐患上报列表
        feedbackStatus: null, // 事件反馈状态：success, error
        selectedEventForFeedback: "", // 选中的事件ID
        feedbackRating: 0, // 反馈评分
        feedbackComment: "", // 反馈意见
        completedEvents: [], // 已完成的事件列表
        eventFeedbacks: [], // 事件反馈记录

        dispatchLoading: false,
        dispatchError: "",
        dispatchResult: null,
        incidentAddress: "",

        
        dispatch: {
          incidentLng: null,
          incidentLat: null,
          fenceVertices: [],
          units: [],
        },

        ws: null,
        wsReadyState: 3, // 0: connecting, 1: open, 2: closing, 3: closed
        wsConnecting: false,
        wsLogs: [],
        wsForm: { type: "MESSAGE", payloadPlain: "" },
        connectionRequests: [],
        pendingConnection: null,
        connectedOfficers: [],
        currentChatTarget: null,

        amapKey: "",
        amapSec: "",
        mapLoading: false,
        mapLoaded: false,
        mapError: "",
        mapInstance: null,
        serverOnline: null,    // 服务器连通性: null=检测中, true=在线, false=离线
        serverHint: '',        // 连通性提示
        toasts: [],            // Toast通知队列
        reconnectAttempts: 0,  // WebSocket重连计数
        reconnectTimer: null,  // 重连定时器
        gpsWatchId: null,      // GPS持续追踪ID
        _lastAddrUpdate: 0,    // 上次地址更新时间戳
        useDemoData: true,     // 演示数据开关
        selectedEventType: '', // 公众端事件类型筛选
        publicEventsLoading: false, // 公众事件加载状态
        confirmDialog: { show: false, title: '', message: '', onConfirm: null }, // 确认弹窗
      };
    },
    computed: {
      roleTitle() {
        if (this.userRole === "commander") return "指挥端";
        if (this.userRole === "officer") return this.officerName;
        if (this.userRole === "guest") return "平安城市助手 · 公众端";
        return "";
      },
      dispatchResultText() {
        if (this.dispatchResult === null || this.dispatchResult === undefined) return "";
        if (typeof this.dispatchResult === "string") return this.dispatchResult;
        try {
          // New JSON format: { code, msg, data: DispatchResponse }
          const resp = this.dispatchResult.data || this.dispatchResult;
          if (resp.selectedUnit) {
            const unit = resp.selectedUnit;
            let result = `调度结果：\n`;
            result += `选中警力：${unit.name} (${unit.unitId})\n`;
            result += `警种：${unit.policeType || '未知'}\n`;
            result += `交通方式：${unit.transportMode || '步行'}\n`;
            if (resp.distanceKm != null) {
              result += `距离：${resp.distanceKm.toFixed(2)} 公里\n`;
            }
            if (resp.estimatedTime != null) {
              result += `预计到达时间：${resp.estimatedTime.toFixed(2)} 分钟\n`;
            }
            result += `是否在围栏内：${resp.incidentInsideFence ? '是' : '否'}\n`;
            result += `围栏内候选警力：${resp.candidatesInFence ? resp.candidatesInFence.join(', ') : '无'}\n`;
            result += `消息：${resp.message}`;
            return result;
          } else {
            return resp.message || JSON.stringify(this.dispatchResult, null, 2);
          }
        } catch {
          return String(this.dispatchResult);
        }
      },
      wsLabel() {
        if (!this.ws) return "未连接";
        const s = this.wsReadyState;
        if (s === 0) return "连接中…";
        if (s === 1) return "已连接";
        if (s === 2) return "关闭中…";
        return "已断开";
      },
      wsPillClass() {
        if (!this.ws || this.wsReadyState !== 1) return "off";
        return "on";
      },
      canSendWs() {
        return this.ws && this.wsReadyState === 1 && !this.wsConnecting;
      },
      filteredPublicEvents() {
        if (!this.selectedEventType) return this.publicEvents;
        return this.publicEvents.filter(e => e.type === this.selectedEventType);
      },
      publicEventTypes() {
        return [...new Set(this.publicEvents.map(e => e.type))];
      },
      captchaExpected() {
        return this.captchaA + this.captchaB;
      },
    },
    mounted() {
        const s = localStorage.getItem(LS_SESSION);
        if (s) {
          try {
            const o = JSON.parse(s);
            if (o && o.username && o.role) {
              this.isLoggedIn = true;
              this.userRole = o.role;
              // 如果是警员端，设置警员名字
              if (o.role === 'officer') {
                this.officerName = o.username;
                this.officerId = 'U-' + String(Math.floor(Math.random() * 10000)).padStart(4, '0');
              }
            }
          } catch {
            /* ignore */
          }
        }
        const amap = localStorage.getItem(LS_AMAP);
        if (amap) {
          try {
            const o = JSON.parse(amap);
            if (o.key) this.amapKey = o.key;
            if (o.sec) this.amapSec = o.sec;
          } catch {
            /* ignore */
          }
        }
        // 加载已完成的事件ID
        const completedIds = localStorage.getItem('pcmp_completed_events');
        if (completedIds) {
          try {
            this.completedEventIds = JSON.parse(completedIds);
          } catch {
            this.completedEventIds = [];
          }
        }
        // 加载已完成的事件列表
        const completedEventsList = localStorage.getItem('pcmp_completed_events_list');
        if (completedEventsList) {
          try {
            this.completedEvents = JSON.parse(completedEventsList);
          } catch {
            this.completedEvents = [];
          }
        }
        // 加载事件反馈数据
        const eventFeedbacks = localStorage.getItem('pcmp_event_feedbacks');
        if (eventFeedbacks) {
          try {
            this.eventFeedbacks = JSON.parse(eventFeedbacks);
          } catch {
            this.eventFeedbacks = [];
          }
        } else {
          // 如果localStorage中没有事件反馈数据，初始化为空数组
          this.eventFeedbacks = [];
        }
        // 加载全局事件数据
        const commanderEvents = localStorage.getItem('pcmp_commander_events');
        if (commanderEvents) {
          try {
            this.commanderEvents = JSON.parse(commanderEvents);
          } catch {
            this.commanderEvents = [];
          }
        }
        
        // 计算服务评分
        setTimeout(() => {
          this.calculateAverageRating();
        }, 1000);
        // 页面卸载时释放Three.js资源
        window.addEventListener('beforeunload', () => {
          if (this.bgRendererReady) {
            import('./three-bg.js').then(mod => mod.disposeBg());
          }
        });
        // Token过期回调：自动退出并提示重新登录
        onAuthExpired = () => {
          if (this.isLoggedIn) {
            this.showToast('登录已过期，请重新登录', 'warning', 6000);
            this.logout();
          }
        };

        // 启动时检测服务器连通性
        this.checkServerConnection();
        this.refreshCaptcha();
        this.$nextTick(() => {
          if (
            this.isLoggedIn &&
            (this.userRole === "officer" || this.userRole === "guest") &&
            this.amapKey &&
            this.amapSec
          ) {
            this.loadAmapScriptForRole(this.userRole);
          }
          if (this.isLoggedIn && this.userRole === "commander") {
            // 始终刷新事件列表（覆盖旧localStorage数据）
            this.loadCommanderEvents();
            this.initCommanderDemoData();
            // 自动连接WebSocket以便实时接收警员连接和下达指令
            this.toggleWs();
            // 每30秒自动刷新事件列表（兜底WebSocket通知丢失的情况）
            this._eventPollTimer = setInterval(() => {
              if (this.isLoggedIn && this.userRole === "commander") {
                this.loadCommanderEvents();
              }
            }, 30000);
          }
          // 公众端：加载公示事件（WebSocket等Token获取后再连接）
          if (this.isLoggedIn && this.userRole === "guest") {
            this.loadPublicEvents();
            // 如果已有Token则自动连接（会话恢复场景）
            if (getToken()) { this.toggleWs(); }
          }
          // 警员登录后自动连接WebSocket + 初始化演示数据
          if (this.isLoggedIn && this.userRole === "officer") {
            this.toggleWs();
            this.initOfficerDemoData();
            // 自动请求定位 + 持续GPS追踪
            this.requestOfficerLocation();
            this.startContinuousTracking();
          }

          // 初始化Three.js动态科技背景
          this.initThreeBackground();
        });
      },

    watch: {
        dutyStatus(newStatus) {
          if (this.userRole === "officer" && this.canSendWs) {
            const env = {
              type: "STATUS_UPDATE",
              status: newStatus
            };
            const raw = JSON.stringify(env);
            this.ws.send(raw);
            this.pushWsLog('out', '状态更新为: ' + newStatus);
          }
        },
        transportMode(newMode) {
          if (this.userRole === "officer" && this.canSendWs) {
            this.updateTransportMode();
          }
        },
        // 警员任务变化时刷新地图路线
        officerOrders: {
          handler() {
            if (this.mapLoaded && this.mapContext === 'officer') {
              this.initMapForRole('officer');
            }
          },
          deep: true
        },
        eventFeedbacks(newFeedbacks) {
          localStorage.setItem('pcmp_event_feedbacks', JSON.stringify(newFeedbacks));
          // 重新计算服务评分
          this.calculateAverageRating();
        },
        commanderEvents(newEvents) {
          localStorage.setItem('pcmp_commander_events', JSON.stringify(newEvents));
        },
        completedEvents(newEvents) {
          localStorage.setItem('pcmp_completed_events_list', JSON.stringify(newEvents));
        },
        // 角色切换时切换3D背景场景
        userRole(newRole) {
          this.switchBgIfReady(newRole);
        },
        // 回到虚拟枢纽时显示hub场景
        authStage(stage) {
          if (stage === 'hub') this.switchBgIfReady('hub');
        }
      },

    methods: {
      // 检测服务器连通性
      async checkServerConnection() {
        const result = await checkConnectivity();
        this.serverOnline = result.ok;
        this.serverHint = result.ok ? '' : (result.error || '连接失败');
      },

      // 初始化Three.js 3D背景
      initThreeBackground() {
        const canvas = document.getElementById('bg-canvas');
        if (!canvas) return;
        import('./three-bg.js').then(mod => {
          const ok = mod.initBgRenderer(canvas);
          if (ok) {
            this.bgRendererReady = true;
            mod.startBgAnimation();
            if (!this.isLoggedIn) {
              mod.switchBgScene('hub');
            } else {
              mod.switchBgScene(this.userRole);
            }
          }
        }).catch(() => {
          document.body.classList.add('bg-fallback');
        });
      },

      // 切换3D背景场景
      switchBgIfReady(role) {
        if (!this.bgRendererReady) return;
        import('./three-bg.js').then(mod => mod.switchBgScene(role));
      },

      // Toast通知系统（替代alert）
      showToast(message, type, duration) {
        type = type || 'info';
        duration = duration || 3500;
        const id = 'toast-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
        this.toasts.push({ id, message, type });
        setTimeout(() => {
          this.toasts = this.toasts.filter(t => t.id !== id);
        }, duration);
      },

      // 确认弹窗
      confirmAction(title, message, onConfirm) {
        this.confirmDialog = { show: true, title, message, onConfirm };
      },
      dismissConfirm() {
        this.confirmDialog = { show: false, title: '', message: '', onConfirm: null };
      },
      executeConfirm() {
        if (this.confirmDialog.onConfirm) {
          this.confirmDialog.onConfirm();
        }
        this.dismissConfirm();
      },

      loadCommanderEvents() {
        this.eventsLoading = true;

        // 演示基线事件（始终显示，与警员端坐标系一致）
        const baseLng = DEFAULT_CENTER_LNG, baseLat = DEFAULT_CENTER_LAT;
        const demoEvents = [
          { id: "E-1001", type: "交通事故", priority: "高", status: "待处理", region: "城东大道与解放路交叉口", lng: baseLng + 0.008, lat: baseLat + 0.005 },
          { id: "E-1003", type: "求助", priority: "中", status: "待处理", region: "滨江小区3号楼", lng: baseLng + 0.004, lat: baseLat - 0.006 },
        ];

        // 保存安全隐患事件
        const safetyEvents = this.commanderEvents.filter(event => event.type === "安全隐患");

        authFetch("/api/commander/events")
          .then(response => {
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            return response.json();
          })
          .then(data => {
            if (data.code === 200 && data.data && data.data.length > 0) {
              // API有数据时：以API数据为主，补充演示数据中API没有的事件
              let apiEvents = data.data.map((event, index) => ({
                id: event.id ? "E-" + String(event.id).padStart(4, "0") : "E-0000",
                type: event.type || "未知类型",
                priority: this.getPriorityLevel(event.type),
                status: event.status || "待处理",
                region: event.address || "未知区域",
                lng: event.lng || (baseLng + (index * 0.003)),
                lat: event.lat || (baseLat + (index * 0.002))
              }));
              const apiIds = new Set(apiEvents.map(e => e.id));
              // 补充API中没有的演示事件
              const extraDemos = demoEvents.filter(e => !apiIds.has(e.id));
              let events = [...apiEvents, ...extraDemos];
              // 过滤已完成
              events = events.filter(event => !this.completedEventIds.includes(event.id));
              // 合并安全隐患
              const existingIds = new Set(events.map(e => e.id));
              events = [...events, ...safetyEvents.filter(e => !existingIds.has(e.id))];
              this.commanderEvents = events;
            } else {
              // API无数据：使用演示数据
              this.applyDemoEvents(demoEvents, safetyEvents);
            }
            if (this.mapLoaded && this.mapContext === "commander") {
              this.initMapForRole("commander");
            }
          })
          .catch(() => {
            this.applyDemoEvents(demoEvents, safetyEvents);
            if (this.mapLoaded && this.mapContext === "commander") {
              this.initMapForRole("commander");
            }
          })
          .finally(() => {
            this.eventsLoading = false;
          });
      },

      applyDemoEvents(demoEvents, safetyEvents) {
        let events = demoEvents.filter(e => !this.completedEventIds.includes(e.id));
        const existingIds = new Set(events.map(e => e.id));
        events = [...events, ...(safetyEvents || []).filter(e => !existingIds.has(e.id))];
        this.commanderEvents = events;
      },

      loadPublicEvents() {
        fetch("/api/guest/public/event")
          .then(response => {
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            return response.json();
          })
          .then(data => {
            if (data.code === 200 && data.data) {
              this.publicEvents = data.data.map(event => ({
                id: event.id,
                type: event.type,
                title: event.title,
                area: event.area,
                time: event.eventTime,
                tip: event.tip,
                lng: event.lng,
                lat: event.lat
              }));
            }
          })
          .catch(() => {
            this.showToast('公示事件加载失败，请刷新重试', 'error');
          });
      },

      getPriorityLevel(type) {
        const highPriority = ["交通事故", "增援请求", "紧急", "urgent"];
        const midPriority = ["群体活动", "求助", "治安"];
        if (highPriority.some(p => type.includes(p))) return "高";
        if (midPriority.some(p => type.includes(p))) return "中";
        return "低";
      },
      refreshCaptcha() {
        this.captchaA = Math.floor(Math.random() * 9) + 1;
        this.captchaB = Math.floor(Math.random() * 9) + 1;
        this.captchaUser = "";
      },

      enterPortal(role) {
        this.pendingRole = role;
        this.authError = "";
        this.identityLine = "";
        this.authStage = "transition";
        document.body.style.overflow = "hidden";
        this.transitionTimer = setTimeout(() => {
          this.identityLine = IDENTITY_TEXT[role] || "";
          this.speakIdentity(role);
        }, 120);
        setTimeout(() => {
          this.authStage = "modal";
          this.isLoginMode = true;
          if (role === "guest") {
            this.refreshCaptcha();
            const seen = localStorage.getItem(LS_GUEST_INTRO);
            this.showGuestIntro = !seen;
          } else {
            this.showGuestIntro = false;
          }
        }, 1100);
      },

      speakIdentity(role) {
        const text = IDENTITY_TEXT[role];
        if (!text || !window.speechSynthesis) return;
        try {
          window.speechSynthesis.cancel();
          const u = new SpeechSynthesisUtterance(text);
          u.lang = "zh-CN";
          u.rate = 1;
          window.speechSynthesis.speak(u);
        } catch {
          /* ignore */
        }
      },

      backToHub() {
        if (this.transitionTimer) clearTimeout(this.transitionTimer);
        this.authStage = "hub";
        this.identityLine = "";
        this.authError = "";
        this.username = "";
        this.password = "";
        this.confirmPassword = "";
        this.guestNickname = "";
        document.body.style.overflow = "";
        window.speechSynthesis && window.speechSynthesis.cancel();
      },

      dismissGuestIntro() {
        this.showGuestIntro = false;
        localStorage.setItem(LS_GUEST_INTRO, "1");
      },

      guestQuickEnter() {
        this.authError = "";
        const name = (this.guestNickname || "").trim() || "市民访客";
        this._guestEnter(name);
      },

      guestVerifiedEnter() {
        this.authError = "";
        const n = parseInt(String(this.captchaUser).trim(), 10);
        if (n !== this.captchaExpected) {
          this.authError = "验证码不正确";
          this.refreshCaptcha();
          return;
        }
        const name = (this.guestNickname || "").trim() || "市民访客";
        this._guestEnter(name);
      },

      // 访客登录：获取匿名JWT令牌
      _guestEnter(name) {
        // 先保存本地会话
        localStorage.setItem(
          LS_SESSION,
          JSON.stringify({ username: name, role: "guest", at: Date.now() })
        );
        this.userRole = "guest";
        this.isLoggedIn = true;
        this.authStage = "hub";
        document.body.style.overflow = "";

        // 异步获取访客JWT — 获取后再连接WebSocket
        fetch("/api/user/guest-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" }
        }).then(r => r.json()).then(data => {
          if (data.code === 200 && data.data && data.data.token) {
            setToken(data.data.token);
            // Token就绪后再连接WebSocket
            this.$nextTick(() => { this.toggleWs(); });
          }
        }).catch(() => {
          // 即使Token获取失败也尝试连接（无Token时WebSocket握手会失败但不阻塞UI）
        });

        const seen = localStorage.getItem(LS_GUEST_INTRO);
        this.showGuestIntro = !seen;
      },

      toggleAuthMode(login) {
        this.isLoginMode = login;
        this.authError = "";
        this.confirmPassword = "";
      },

      switchToRegister() {
        this.toggleAuthMode(false);
      },

      switchToLogin() {
        this.toggleAuthMode(true);
      },

      roleMatchesPortal(rec) {
        const portal = this.pendingRole;
        const r = rec.role;
        if (portal === "guest") return true;
        if (!r) return portal === "officer";
        return r === portal;
      },

      handleAuth() {
        this.authError = "";
        if (this.pendingRole === "guest") {
          this.guestVerifiedEnter();
          return;
        }

        const u = (this.username || "").trim();
        const p = this.password || "";
        if (!u || !p) {
          this.authError = "请输入用户名和密码";
          return;
        }
        if (!this.isLoginMode) {
          if (p !== (this.confirmPassword || "")) {
            this.authError = "两次输入的密码不一致";
            return;
          }
        }

        this.isProcessingAuth = true;
        
        const url = this.isLoginMode ? "/api/user/login" : "/api/user/register";
        const data = {
          username: u,
          password: p,
          role: this.pendingRole,
          nickname: u
        };

        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data)
        })
        .then(response => {
          if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          return response.json();
        })
        .then(data => {
          if (data.code === 200) {
            // 保存JWT令牌
            const respData = data.data;
            if (respData && respData.token) {
              setToken(respData.token);
            }
            // 保存会话信息
            localStorage.setItem(
              LS_SESSION,
              JSON.stringify({ username: u, role: this.pendingRole, at: Date.now() })
            );
            this.userRole = this.pendingRole;
            this.isLoggedIn = true;
            this.authStage = "hub";
            document.body.style.overflow = "";
            // 设置名称并初始化演示数据
            if (this.pendingRole === 'officer') {
              this.officerName = u;
              this.officerId = 'U-' + u.toUpperCase().substring(0, 3);
              this.$nextTick(() => { this.initOfficerDemoData(); this.toggleWs(); });
            } else if (this.pendingRole === 'commander') {
              this.$nextTick(() => { this.initCommanderDemoData(); this.toggleWs(); });
            }
          } else {
            this.authError = data.msg || "操作失败";
          }
        })
        .catch((err) => {
          if (err.message && err.message.includes("证书未受信任")) {
            this.authError = err.message;
          } else if (err.message && err.message.includes("Failed to fetch")) {
            this.authError = "无法连接服务器。请检查: 1)服务是否启动 2)是否使用 https:// 访问 3)CA证书是否已安装";
          } else {
            this.authError = "网络错误: " + (err.message || "未知错误");
          }
        })
        .finally(() => {
          this.isProcessingAuth = false;
        });
      },

      computeNearestDispatch(body) {
        const { incident, fence, units } = body;
        const ix = incident.lng;
        const iy = incident.lat;

        // 坐标未设置，返回提示
        if (ix == null || iy == null || isNaN(ix) || isNaN(iy)) {
          return {
            mode: "local-demo",
            message: "请先在左侧设置事发点坐标或点击地图选择位置",
            incidentInsideFence: false,
            selectedUnit: null,
            distanceApprox: null,
            estimatedTime: null,
            candidatesInFence: []
          };
        }

        function inPolygon(pt, poly) {
          const x = pt.lng;
          const y = pt.lat;
          let inside = false;
          for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const xi = poly[i].lng;
            const yi = poly[i].lat;
            const xj = poly[j].lng;
            const yj = poly[j].lat;
            const cross = (yi > y) !== (yj > y);
            const xinters = xj === xi ? xi : ((xj - xi) * (y - yi)) / (yj - yi + 1e-15) + xi;
            if (cross && x < xinters) inside = !inside;
          }
          return inside;
        }

        function haversineDistance(lat1, lon1, lat2, lon2) {
          const R = 6371; // 地球半径（公里）
          const dLat = (lat2 - lat1) * Math.PI / 180;
          const dLon = (lon2 - lon1) * Math.PI / 180;
          const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLon/2) * Math.sin(dLon/2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
          return R * c;
        }

        function estimateTime(distance, transportMode, originLng, originLat, destLng, destLat) {
          // 基础速度
          const baseSpeeds = {
            "步行": 7.5, // 5-10km/h 取平均值
            "骑行": 20, // 15-25km/h 取平均值
            "开车": 32.5 // 25-40km/h 取平均值
          };
          
          // 获取当前时段
          const hour = new Date().getHours();
          let timeFactor = 1.0;
          if (hour >= 7 && hour < 9) {
            timeFactor = 0.6; // 早高峰
          } else if (hour >= 17 && hour < 19) {
            timeFactor = 0.6; // 晚高峰
          }
          
          // 道路类型调整（简化版）
          let roadFactor = 1.0;
          if (transportMode === "开车") {
            // 这里可以根据实际情况调整道路类型因素
            // 例如：高速1.2, 城市道路0.8, 小路0.5
            roadFactor = 0.8; // 默认城市道路
          }
          
          const baseSpeed = baseSpeeds[transportMode] || 7.5;
          const actualSpeed = baseSpeed * timeFactor * roadFactor;
          return distance / actualSpeed * 60; // 转换为分钟
        }

        const avail = units.filter((u) => u.available);
        const insideFence = avail.filter((u) => inPolygon({ lng: u.lng, lat: u.lat }, fence));
        const pool = insideFence.length ? insideFence : avail;

        let best = null;
        let bestTime = Infinity;
        for (const u of pool) {
          const distance = haversineDistance(iy, ix, u.lat, u.lng);
          const time = estimateTime(distance, u.transportMode || "步行", u.lng, u.lat, ix, iy);
          if (time < bestTime) {
            bestTime = time;
            best = { ...u, distance, estimatedTime: time };
          }
        }

        return {
          mode: "local-demo",
          message: "后端不可用时使用浏览器内近似计算（射线法判围栏内 + 哈维正弦公式计算距离 + 交通方式时间估算）。",
          incidentInsideFence: inPolygon({ lng: ix, lat: iy }, fence),
          selectedUnit: best,
          distanceApprox: best ? best.distance : null,
          estimatedTime: best ? best.estimatedTime : null,
          candidatesInFence: insideFence.map((u) => u.unitId),
        };
      },

      logout() {
        this.stopContinuousTracking();
        if (this._eventPollTimer) { clearInterval(this._eventPollTimer); this._eventPollTimer = null; }
        clearToken();
        localStorage.removeItem(LS_SESSION);
        this.isLoggedIn = false;
        this.userRole = "";
        this.username = "";
        this.password = "";
        this.confirmPassword = "";
        this.toggleAuthMode(true);
        this.authStage = "hub";
        document.body.style.overflow = "";
      },

      markVolunteer(id) {
        this.showToast('已上报指挥端：警员请求援助事件 ' + id, 'info');
      },

      submitOfficerReport() {
        // BugFix: 提前捕获文本，避免在WebSocket payload构造前被清空
        const reportText = (this.reportDraft.text || "").trim();
        const reportType = this.reportDraft.type;
        const reportPriority = this.reportDraft.priority;
        if (!reportText) {
          this.showToast("请填写事件说明", "warning");
          return;
        }
        let loc = "";
        if (this.reportDraft.useLocation && this.officerLng != null && this.officerLat != null) {
          loc = "\n位置：" + this.officerLng + ", " + this.officerLat + (this.officerAddress ? "\n" + this.officerAddress : "");
        } else if (this.reportDraft.useLocation) {
          this.showToast("请先获取当前位置或取消勾选附加位置", "warning");
          return;
        }

        const data = {
          type: reportType,
          text: reportText,
          priority: reportPriority,
          useLocation: this.reportDraft.useLocation,
          lng: this.officerLng,
          lat: this.officerLat,
          address: this.officerAddress
        };

        authFetch("/api/officer/report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data)
        })
        .then(response => {
          if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          return response.json();
        })
        .then(data => {
          if (data.code === 200) {
            this.showToast("事件已上报至指挥端待审核", "success");
            this.reportDraft.text = "";
            // 刷新地图以显示新上报的事件
            if (this.mapLoaded && this.mapContext === "officer") {
              this.initMapForRole("officer");
            }
            // 通知指挥端有新事件上报（使用捕获的变量）
            if (this.canSendWs) {
              const env = {
                type: "EVENT_REPORTED",
                event: {
                  type: reportType,
                  priority: reportPriority,
                  text: reportText,
                  lng: this.officerLng,
                  lat: this.officerLat,
                  address: this.officerAddress
                }
              };
              const raw = JSON.stringify(env);
              this.ws.send(raw);
              this.pushWsLog('out', '已上报事件至指挥端');
            }
          } else {
            this.showToast("上报失败：" + (data.msg || "未知错误"), "error");
          }
        })
        .catch((err) => {
          // 区分网络错误和服务端错误，不清除用户输入
          if (err.message && err.message.includes('HTTP 5')) {
            this.showToast('服务器错误，请稍后重试', 'error');
          } else {
            this.showToast('网络错误，请检查连接（数据未丢失）', 'warning');
          }
        });
      },

      submitGuestFeedback() {
        if (!(this.guestFeedback.text || "").trim()) {
          this.showToast("请填写简要说明", "warning");
          return;
        }
        
        const feedback = {
          vague: this.guestFeedback.vague,
          text: this.guestFeedback.text
        };
        
        // 将隐患添加到安全隐患列表
        this.safetyReports.push(feedback);
        
        // 通过WebSocket发送到指挥端
        if (this.canSendWs) {
          const env = {
            type: "SAFETY_REPORT",
            report: feedback
          };
          const raw = JSON.stringify(env);
          this.ws.send(raw);
          this.pushWsLog('out', '已上报安全隐患');
          
          // 显示成功反馈
          this.feedbackStatus = 'success';
          setTimeout(() => {
            this.feedbackStatus = null;
          }, 3000);
        } else {
          // 显示失败反馈
          this.feedbackStatus = 'error';
          setTimeout(() => {
            this.feedbackStatus = null;
          }, 3000);
          this.showToast("WebSocket未连接，请先连接后再上报", "error");
          return;
        }
        
        // 清空表单
        this.guestFeedback.vague = "";
        this.guestFeedback.text = "";
      },
      
      // 获取评分文字描述
      getRatingText(rating) {
        switch(rating) {
          case 1: return "非常差";
          case 2: return "较差";
          case 3: return "一般";
          case 4: return "满意";
          case 5: return "非常满意";
          default: return "请选择评分";
        }
      },
      
      // 提交事件反馈
      submitEventFeedback() {
        if (!this.selectedEventForFeedback || this.feedbackRating === 0) {
          this.showToast("请选择事件并给出评分", "warning");
          return;
        }
        
        const event = this.completedEvents.find(e => e.id === this.selectedEventForFeedback);
        if (!event) return;
        
        const feedback = {
          id: "F-" + Date.now(),
          eventId: this.selectedEventForFeedback,
          eventType: event.type,
          eventRegion: event.region,
          officerName: event.officerName,
          officerId: event.officerId,
          rating: this.feedbackRating,
          comment: this.feedbackComment,
          time: new Date().toLocaleString()
        };
        
        // 添加到反馈列表
        this.eventFeedbacks.push(feedback);
        
        // 通过WebSocket发送到指挥端
        if (this.canSendWs) {
          const env = {
            type: "EVENT_FEEDBACK",
            feedback: feedback
          };
          const raw = JSON.stringify(env);
          this.ws.send(raw);
          this.pushWsLog('out', '已提交事件反馈');
        } else {
          // WebSocket未连接时，也保存反馈数据，确保数据持久化
          localStorage.setItem('pcmp_event_feedbacks', JSON.stringify(this.eventFeedbacks));
        }
        
        // 重新计算服务评分
        this.calculateAverageRating();
        
        this.showToast("感谢您的反馈！", "success");
        
        // 清空表单
        this.selectedEventForFeedback = "";
        this.feedbackRating = 0;
        this.feedbackComment = "";
      },

      // 审核通过安全隐患
      approveSafetyReport(index) {
        const report = this.safetyReports[index];
        if (report) {
          // 生成唯一的事件ID
          let eventId;
          do {
            eventId = "E-" + String(Math.floor(Math.random() * 10000)).padStart(4, "0");
          } while (this.commanderEvents.some(e => e.id === eventId) || this.completedEvents.some(e => e.id === eventId));
          
          // 使用地理编码将文本地址转换为经纬度坐标
          this.geocode(report.vague, (location) => {
            // 添加新事件到事件列表（低优先级）
            const newEvent = {
              id: eventId,
              type: "安全隐患",
              priority: "低",
              status: "pending",
              region: report.vague || "未知区域",
              lng: location ? location.lng : DEFAULT_CENTER_LNG + (Math.random() * 0.02 - 0.01),
              lat: location ? location.lat : DEFAULT_CENTER_LAT + (Math.random() * 0.02 - 0.01)
            };
            
            this.commanderEvents.unshift(newEvent);
            
            // 从安全隐患列表中移除
            this.safetyReports.splice(index, 1);
            
            this.showToast("安全隐患已审核通过，已转为低优先级事件", "success");
            
            // 刷新地图以显示新事件
            if (this.mapLoaded && this.mapContext === "commander") {
              this.initMapForRole("commander");
            }
          });
        }
      },

      // 审核拒绝安全隐患
      rejectSafetyReport(index) {
        this.safetyReports.splice(index, 1);
        this.showToast("安全隐患已审核拒绝", "warning");
      },

      getCurrentLocation() {
        // 方案一(最可靠)：服务端IP定位 — 不依赖HTTPS/GPS/权限
        fetch("/api/location/ip", { signal: AbortSignal.timeout(5000) })
          .then(r => r.json())
          .then(d => {
            if (d && d.success) {
              this._onLocationSuccess(+d.lng.toFixed(6), +d.lat.toFixed(6));
            } else {
              this._tryAmapLocation();
            }
          })
          .catch(() => this._tryAmapLocation());
      },

      _tryAmapLocation() {
        if (typeof AMap === "undefined") { this._setDefaultLocation(); return; }
        try {
          AMap.plugin("AMap.Geolocation", () => {
            const geolocation = new AMap.Geolocation({
              enableHighAccuracy: true, timeout: 6000,
              noIpLocate: 0, noGeoLocation: 0
            });
            geolocation.getCurrentPosition((status, result) => {
              if (status === "complete" && result && result.position) {
                this._onLocationSuccess(
                  +result.position.lng.toFixed(6),
                  +result.position.lat.toFixed(6)
                );
              } else {
                this._setDefaultLocation();
              }
            });
          });
        } catch(e) { this._setDefaultLocation(); }
      },

      _setDefaultLocation() {
        // 静默兜底，不弹窗
        const lng = DEFAULT_CENTER_LNG + (Math.random() * 0.008 - 0.004);
        const lat = DEFAULT_CENTER_LAT + (Math.random() * 0.008 - 0.004);
        this._onLocationSuccess(+lng.toFixed(6), +lat.toFixed(6));
      },

      useDefaultLocation() {
        this._setDefaultLocation();
      },

      _onLocationSuccess(lng, lat) {
        // 过滤无效坐标
        if (!this._validCoord(lng, lat)) return;
        if (this.userRole === "officer") {
          this.officerLng = lng;
          this.officerLat = lat;
          this.officerAddress = "正在解析地址…";
          this.reverseGeocode(lng, lat, (addr) => {
            this.officerAddress = addr || "已获取位置";
          });
          if (this.mapLoaded && this.mapContext === "officer") {
            this.initMapForRole("officer");
          }
          // 发送位置更新到指挥端
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
              type: "LOCATION_UPDATE",
              lng: lng,
              lat: lat
            }));
            this.pushWsLog('out', '发送位置更新: ' + lng + ', ' + lat);
          }
          return;
        }
        this.dispatch.incidentLng = lng;
        this.dispatch.incidentLat = lat;
        this.incidentAddress = "已获取坐标（可配合地图逆地理编码解析地址）";
        if (this.mapLoaded && this.mapContext === "commander") {
          this.initMapForRole("commander");
        }
      },

      _onLocationError(msg) {
        this.incidentAddress = "";
        this.officerAddress = "";
        this.showToast(msg, "error");
      },

      reverseGeocode(lng, lat, cb) {
        if (typeof AMap === "undefined" || !lng || !lat) {
          cb("");
          return;
        }
        AMap.plugin(["AMap.Geocoder"], () => {
          const geo = new AMap.Geocoder();
          geo.getAddress([lng, lat], (status, result) => {
            if (status === "complete" && result && result.regeocode) {
              cb(result.regeocode.formattedAddress || "");
            } else {
              cb("");
            }
          });
        });
      },
      
      // 警员端：持续GPS追踪 (watchPosition替代getCurrentPosition)
      startContinuousTracking() {
        if (!navigator.geolocation) return;
        if (this.gpsWatchId != null) { navigator.geolocation.clearWatch(this.gpsWatchId); }

        let lastLng = null, lastLat = null, lastSent = 0;
        const MIN_DISPLACEMENT_M = 10;
        const THROTTLE_MS = 3000;
        const self = this;

        this.gpsWatchId = navigator.geolocation.watchPosition(
          (pos) => {
            const lng = +pos.coords.longitude.toFixed(6);
            const lat = +pos.coords.latitude.toFixed(6);
            self.officerLng = lng;
            self.officerLat = lat;

            let shouldSend = false;
            if (lastLng == null) { shouldSend = true; }
            else {
              const dist = self.haversineKm(lastLat, lastLng, lat, lng) * 1000;
              if (dist >= MIN_DISPLACEMENT_M) shouldSend = true;
            }
            const now = Date.now();
            if (shouldSend && (now - lastSent >= THROTTLE_MS)) {
              lastLng = lng; lastLat = lat; lastSent = now;
              if (self.ws && self.ws.readyState === WebSocket.OPEN) {
                self.ws.send(JSON.stringify({ type: 'LOCATION_UPDATE', lng, lat }));
              }
            }
            // 每30秒更新一次地址
            if (now - (self._lastAddrUpdate || 0) > 30000) {
              self._lastAddrUpdate = now;
              self.reverseGeocode(lng, lat, (addr) => { self.officerAddress = addr || ''; });
            }
          },
          () => { /* GPS失败，使用默认位置 */ },
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 2000 }
        );
      },

      stopContinuousTracking() {
        if (this.gpsWatchId != null && navigator.geolocation) {
          navigator.geolocation.clearWatch(this.gpsWatchId);
          this.gpsWatchId = null;
        }
      },

      // 前端Haversine距离计算（GPS节流用）
      haversineKm(lat1, lng1, lat2, lng2) {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLng/2) * Math.sin(dLng/2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      },

      // 警员端：自动请求浏览器定位（首次定位用）
      requestOfficerLocation() {
        // 设置演示默认位置（武汉坐标），GPS成功后会覆盖
        if (this.officerLng == null || this.officerLat == null) {
          this.officerLng = DEFAULT_CENTER_LNG;
          this.officerLat = DEFAULT_CENTER_LAT;
        }
        if (!navigator.geolocation) return;
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            this.officerLng = +pos.coords.longitude.toFixed(6);
            this.officerLat = +pos.coords.latitude.toFixed(6);
            this.reverseGeocode(this.officerLng, this.officerLat, (addr) => {
              this.officerAddress = addr || '';
            });
            // 刷新地图以显示位置和路线
            if (this.mapLoaded && this.mapContext === 'officer') {
              this.initMapForRole('officer');
            }
          },
          () => { /* GPS失败，使用默认位置 */ },
          { enableHighAccuracy: true, timeout: 10000 }
        );
      },

      // 指挥端：初始化演示数据（在线警员和警力列表）
      initCommanderDemoData() {
        const baseLng = DEFAULT_CENTER_LNG, baseLat = DEFAULT_CENTER_LAT;
        // 演示在线警员（与dispatch.units同步）
        if (this.connectedOfficers.length === 0) {
          this.connectedOfficers = [
            { sessionId: 'demo-s1', unitId: 'U-PT1', name: '张警官', status: '执勤中', transportMode: '开车', lng: baseLng + 0.005, lat: baseLat + 0.003 },
            { sessionId: 'demo-s2', unitId: 'U-PT2', name: '李警官', status: '执勤中', transportMode: '骑行', lng: baseLng - 0.003, lat: baseLat + 0.006 },
            { sessionId: 'demo-s3', unitId: 'U-JJ1', name: '王交警', status: '办案中', transportMode: '开车', lng: baseLng + 0.007, lat: baseLat - 0.004 },
          ];
        }
        // 演示警力列表（调度用）
        if (this.dispatch.units.length === 0) {
          this.dispatch.units = this.connectedOfficers.map((o, i) => ({
            unitId: o.unitId, name: o.name, available: true,
            status: o.status, transportMode: o.transportMode || '步行',
            policeType: o.unitId.includes('JJ') ? '交警' : '巡逻警',
            lng: o.lng || (baseLng + (i * 0.001)),
            lat: o.lat || (baseLat + (i * 0.001))
          }));
        }
        // 默认围栏多边形：覆盖演示事件区域，确保调度算法能正确判定警员-事件位置关系
        if (!this.dispatch.fenceVertices || this.dispatch.fenceVertices.length === 0) {
          const dx = 0.015, dy = 0.012;
          this.dispatch.fenceVertices = [
            { lng: baseLng - dx, lat: baseLat - dy },
            { lng: baseLng + dx, lat: baseLat - dy },
            { lng: baseLng + dx, lat: baseLat + dy },
            { lng: baseLng - dx, lat: baseLat + dy },
          ];
        }
      },

      // 警员端：初始化演示数据（任务/周边警情/可援助事件）
      initOfficerDemoData() {
        const baseLng = DEFAULT_CENTER_LNG;
        const baseLat = DEFAULT_CENTER_LAT;

        // 演示指挥任务（只有当前officerOrders为空时才填充，避免覆盖真实WebSocket指令）
        if (this.officerOrders.length === 0) {
          this.officerOrders = [
            {
              id: 'T-1001', eventId: 'E-1001', eventType: '交通事故',
              title: '交通事故处置', place: '城东大道与解放路交叉口',
              address: '城东大道与解放路交叉口',
              priority: '高', deadline: '18:00',
              detail: '两车相撞，无人员伤亡，请前往疏导交通',
              lng: baseLng + 0.008, lat: baseLat + 0.005,
              officerName: this.officerName, officerId: this.officerId
            },
            {
              id: 'T-1003', eventId: 'E-1003', eventType: '求助',
              title: '群众求助响应', place: '滨江小区3号楼',
              address: '滨江小区3号楼',
              priority: '中', deadline: '20:00',
              detail: '老人走失求助，请协助寻找',
              lng: baseLng + 0.004, lat: baseLat - 0.006,
              officerName: this.officerName, officerId: this.officerId
            }
          ];
        }

        // 演示周边警情
        if (this.nearbyIncidents.length === 0) {
          this.nearbyIncidents = [
            { id: 'N-001', type: '交通拥堵', brief: '环城南路车流量大', lng: baseLng + 0.006, lat: baseLat + 0.003 },
            { id: 'N-002', type: '噪音投诉', brief: '商业街夜间施工噪音', lng: baseLng - 0.004, lat: baseLat + 0.007 },
            { id: 'N-003', type: '设施损坏', brief: '中山路路灯损坏', lng: baseLng + 0.005, lat: baseLat - 0.004 },
            { id: 'N-004', type: '人群聚集', brief: '市民广场大型活动', lng: baseLng - 0.007, lat: baseLat - 0.003 }
          ];
        }

        // 演示可援助事件
        if (this.volunteerIncidents.length === 0) {
          this.volunteerIncidents = [
            { id: 'V-001', type: '问路指引', brief: '游客询问火车站方向', lng: baseLng + 0.003, lat: baseLat - 0.005 },
            { id: 'V-002', type: '纠纷调解', brief: '邻里停车纠纷待调解', lng: baseLng - 0.005, lat: baseLat + 0.002 }
          ];
        }
      },

      // 地理编码：将文本地址转换为经纬度坐标
      geocode(address, cb) {
        if (typeof AMap === "undefined" || !address) {
          cb(null);
          return;
        }
        AMap.plugin(["AMap.Geocoder"], () => {
          const geo = new AMap.Geocoder();
          geo.getLocation(address, (status, result) => {
            if (status === "complete" && result && result.geocodes && result.geocodes[0]) {
              const location = result.geocodes[0].location;
              cb({ lng: location.getLng(), lat: location.getLat() });
            } else {
              cb(null);
            }
          });
        });
      },

      focusMapItem(kind, id) {
        this.mapFocusId = kind + "-" + id;
        let lng;
        let lat;
        let title = "";
        if (kind === "order") {
          const o = this.officerOrders.find((x) => x.id === id);
          if (!o) return;
          lng = o.lng;
          lat = o.lat;
          title = o.title;
        } else if (kind === "nearby") {
          const o = this.nearbyIncidents.find((x) => x.id === id);
          if (!o) return;
          lng = o.lng;
          lat = o.lat;
          title = o.type;
        } else if (kind === "volunteer") {
          const o = this.volunteerIncidents.find((x) => x.id === id);
          if (!o) return;
          lng = o.lng;
          lat = o.lat;
          title = o.type;
        } else if (kind === "public") {
          const o = this.publicEvents.find((x) => x.id === id);
          if (!o) return;
          lng = o.lng;
          lat = o.lat;
          title = o.title;
        }
        if (!this.mapLoaded || !this.mapInstance) return;
        if (lng != null && lat != null) {
          this.mapInstance.setZoomAndCenter(16, [lng, lat]);
        }
      },


      removeFence(i) {
        if (this.dispatch.fenceVertices.length <= 3) return;
        this.dispatch.fenceVertices.splice(i, 1);
      },
      addFenceVertex() {
        const last = this.dispatch.fenceVertices[this.dispatch.fenceVertices.length - 1];
        this.dispatch.fenceVertices.push({
          lng: last ? last.lng : this.dispatch.incidentLng || DEFAULT_CENTER_LNG,
          lat: last ? last.lat : this.dispatch.incidentLat || DEFAULT_CENTER_LAT,
        });
      },
      autoGenerateFence() {
        const c = this.dispatch.incidentLng;
        const d = this.dispatch.incidentLat;
        const dx = 0.008;
        const dy = 0.006;
        this.dispatch.fenceVertices = [
          { lng: c - dx, lat: d - dy },
          { lng: c + dx, lat: d - dy },
          { lng: c + dx, lat: d + dy },
          { lng: c - dx, lat: d + dy },
        ];
      },
      
      // 生成非矩形动态围栏（基于路网）
      generateDynamicFence() {
        const c = this.dispatch.incidentLng;
        const d = this.dispatch.incidentLat;
        
        // 1. 生成路网数据
        const roadNetwork = this.generateRealisticRoadNetwork(c, d);
        
        // 2. 离群点检测
        const filteredPoints = this.detectOutliers(roadNetwork, { lng: c, lat: d });
        
        // 3. 生成等时圈围栏（基于时间）
        const targetTime = 3; // 目标时间（分钟）
        const dynamicFence = this.generateIsochrones(filteredPoints, { lng: c, lat: d }, targetTime);
        
        // 4. 确保围栏是闭合的
        if (dynamicFence.length > 0) {
          const firstPoint = dynamicFence[0];
          const lastPoint = dynamicFence[dynamicFence.length - 1];
          if (firstPoint.lng !== lastPoint.lng || firstPoint.lat !== lastPoint.lat) {
            dynamicFence.push(firstPoint);
          }
        }
        
        this.dispatch.fenceVertices = dynamicFence;
        
        // 5. 重新加载地图以显示围栏
        if (this.mapLoaded && this.mapContext === "commander") {
          this.initMapForRole("commander");
          // 调整地图视图以包含围栏和事件点
          if (this.mapInstance && dynamicFence.length > 0) {
            // 创建一个包含所有围栏点和事件点的数组
            const allPoints = [...dynamicFence];
            if (this.dispatch.incidentLng && this.dispatch.incidentLat) {
              allPoints.push({ lng: this.dispatch.incidentLng, lat: this.dispatch.incidentLat });
            }
            // 计算边界
            let minLng = Infinity, maxLng = -Infinity;
            let minLat = Infinity, maxLat = -Infinity;
            allPoints.forEach(point => {
              minLng = Math.min(minLng, point.lng);
              maxLng = Math.max(maxLng, point.lng);
              minLat = Math.min(minLat, point.lat);
              maxLat = Math.max(maxLat, point.lat);
            });
            // 计算中心点
            const centerLng = (minLng + maxLng) / 2;
            const centerLat = (minLat + maxLat) / 2;
            // 计算缩放级别
            const lngDiff = maxLng - minLng;
            const latDiff = maxLat - minLat;
            const maxDiff = Math.max(lngDiff, latDiff);
            const zoom = Math.floor(11 - Math.log(maxDiff) / Math.LN2);
            // 设置地图中心和缩放级别
            this.mapInstance.setZoomAndCenter(Math.max(12, Math.min(16, zoom)), [centerLng, centerLat]);
          }
        }
        
        // 6. 自动触发警力调度
        this.runDispatch();
      },
      
      // 生成等时圈围栏
      generateIsochrones(points, center, targetTime) {
        if (points.length < 3) {
          // 如果点太少，返回一个默认的矩形围栏
          const dx = 0.008;
          const dy = 0.006;
          return [
            { lng: center.lng - dx, lat: center.lat - dy },
            { lng: center.lng + dx, lat: center.lat - dy },
            { lng: center.lng + dx, lat: center.lat + dy },
            { lng: center.lng - dx, lat: center.lat + dy }
          ];
        }
        
        // 计算每个点到中心点的预计时间
        const pointsWithTime = points.map(point => {
          const distance = Math.sqrt(Math.pow(point.lng - center.lng, 2) + Math.pow(point.lat - center.lat, 2));
          // 转换为公里（1度约等于111公里）
          const distanceKm = distance * 111;
          // 假设平均速度为20km/h
          const timeMinutes = (distanceKm / 20) * 60;
          return {
            point,
            time: timeMinutes
          };
        });
        
        // 筛选出时间接近目标时间的点
        const timeThreshold = 0.5; // 时间阈值（分钟）
        let isochronePoints = pointsWithTime
          .filter(item => Math.abs(item.time - targetTime) <= timeThreshold)
          .map(item => item.point);
        
        // 如果筛选后的点太少，使用所有点
        if (isochronePoints.length < 3) {
          // 按时间排序，取接近目标时间的点
          pointsWithTime.sort((a, b) => Math.abs(a.time - targetTime) - Math.abs(b.time - targetTime));
          const topPoints = pointsWithTime.slice(0, Math.min(8, pointsWithTime.length));
          isochronePoints = topPoints.map(item => item.point);
        }
        
        // 确保事件点在围栏内
        if (!isochronePoints.some(p => p.lng === center.lng && p.lat === center.lat)) {
          isochronePoints.push({ lng: center.lng, lat: center.lat });
        }
        
        // 使用Alpha形状算法生成围栏
        return this.generateAlphaShape(isochronePoints, 0.003);
      },
      
      // 基于坐标生成确定性的伪随机种子
      seededRandom(seed) {
        let s = seed | 0;
        s = (s ^ (s >>> 16)) * 0x45d9f3b;
        s = (s ^ (s >>> 16)) * 0x45d9f3b;
        s = s ^ (s >>> 16);
        return (s & 0x7fffffff) / 0x7fffffff;
      },
      
      // 基于坐标生成确定性的种子值
      coordSeed(lng, lat) {
        const a = Math.round(lng * 100000);
        const b = Math.round(lat * 100000);
        return a * 31 + b;
      },
      
      // 生成更真实的路网数据（确定性版本，基于坐标生成一致的结果）
      generateRealisticRoadNetwork(centerLng, centerLat) {
        const roadNetwork = [];
        const seed = this.coordSeed(centerLng, centerLat);
        const rng = (offset) => this.seededRandom(seed + offset);
        
        // 基于坐标确定性选择路网类型（0: 城市网格, 1: 放射状, 2: 混合）
        const roadNetworkType = Math.floor(rng(0) * 3);
        
        // 基础参数（基于坐标的确定性变化）
        const mainRoadDist = 0.008 + rng(1) * 0.004; // 主干道距离 0.008-0.012
        const ringRoadDist = mainRoadDist * 0.8; // 环形道路距离
        const gridSize = mainRoadDist * 0.4; // 网格大小
        
        if (roadNetworkType === 0) {
          // 城市网格类型
          for (let i = -2; i <= 2; i++) {
            for (let j = -2; j <= 2; j++) {
              if (Math.abs(i) === 2 || Math.abs(j) === 2) {
                roadNetwork.push({ 
                  lng: centerLng + i * mainRoadDist, 
                  lat: centerLat + j * mainRoadDist 
                });
              }
            }
          }
          
          // 次干道
          for (let i = -1; i <= 1; i++) {
            for (let j = -1; j <= 1; j++) {
              if (i !== 0 || j !== 0) {
                roadNetwork.push({ 
                  lng: centerLng + i * mainRoadDist * 0.5, 
                  lat: centerLat + j * mainRoadDist * 0.5 
                });
              }
            }
          }
        } else if (roadNetworkType === 1) {
          // 放射状类型
          roadNetwork.push({ lng: centerLng, lat: centerLat });
          
          const radii = [mainRoadDist * 0.5, mainRoadDist, mainRoadDist * 1.5];
          const angles = 8;
          
          for (const radius of radii) {
            for (let i = 0; i < angles; i++) {
              const angle = (Math.PI * 2 * i) / angles;
              const lng = centerLng + Math.cos(angle) * radius;
              const lat = centerLat + Math.sin(angle) * radius;
              roadNetwork.push({ lng, lat });
            }
          }
          
          // 环形道路
          for (let i = 1; i <= 2; i++) {
            const radius = mainRoadDist * i;
            for (let j = 0; j < 16; j++) {
              const angle = (Math.PI * 2 * j) / 16;
              const lng = centerLng + Math.cos(angle) * radius;
              const lat = centerLat + Math.sin(angle) * radius;
              roadNetwork.push({ lng, lat });
            }
          }
        } else {
          // 混合类型
          roadNetwork.push({ lng: centerLng, lat: centerLat - mainRoadDist });
          roadNetwork.push({ lng: centerLng + mainRoadDist, lat: centerLat });
          roadNetwork.push({ lng: centerLng, lat: centerLat + mainRoadDist });
          roadNetwork.push({ lng: centerLng - mainRoadDist, lat: centerLat });
          
          roadNetwork.push({ lng: centerLng, lat: centerLat - mainRoadDist * 0.5 });
          roadNetwork.push({ lng: centerLng + mainRoadDist * 0.5, lat: centerLat });
          roadNetwork.push({ lng: centerLng, lat: centerLat + mainRoadDist * 0.5 });
          roadNetwork.push({ lng: centerLng - mainRoadDist * 0.5, lat: centerLat });
          
          for (let i = 0; i < 8; i++) {
            const angle = (Math.PI * 2 * i) / 8;
            const lng = centerLng + Math.cos(angle) * ringRoadDist;
            const lat = centerLat + Math.sin(angle) * ringRoadDist;
            roadNetwork.push({ lng, lat });
          }
          
          // 支路和小巷
          const branchRoads = [
            { start: { lng: centerLng - mainRoadDist * 0.3, lat: centerLat - mainRoadDist * 0.3 }, end: { lng: centerLng - mainRoadDist * 0.7, lat: centerLat - mainRoadDist * 0.7 } },
            { start: { lng: centerLng + mainRoadDist * 0.3, lat: centerLat - mainRoadDist * 0.3 }, end: { lng: centerLng + mainRoadDist * 0.7, lat: centerLat - mainRoadDist * 0.7 } },
            { start: { lng: centerLng + mainRoadDist * 0.3, lat: centerLat + mainRoadDist * 0.3 }, end: { lng: centerLng + mainRoadDist * 0.7, lat: centerLat + mainRoadDist * 0.7 } },
            { start: { lng: centerLng - mainRoadDist * 0.3, lat: centerLat + mainRoadDist * 0.3 }, end: { lng: centerLng - mainRoadDist * 0.7, lat: centerLat + mainRoadDist * 0.7 } }
          ];
          
          branchRoads.forEach((road, ri) => {
            const steps = 3;
            for (let i = 0; i <= steps; i++) {
              const t = i / steps;
              // 使用确定性偏移替代随机
              const offset = (rng(10 + ri * 10 + i) - 0.5) * 0.001;
              const lng = road.start.lng + (road.end.lng - road.start.lng) * t + offset;
              const lat = road.start.lat + (road.end.lat - road.start.lat) * t + offset;
              roadNetwork.push({ lng, lat });
            }
          });
        }
        
        // 内部道路网格（所有类型通用）
        for (let i = -1; i <= 1; i++) {
          for (let j = -1; j <= 1; j++) {
            if (i === 0 && j === 0) continue;
            const idx = (i + 1) * 3 + (j + 1);
            const offset = (rng(100 + idx) - 0.5) * 0.0005;
            const lng = centerLng + i * gridSize + offset;
            const lat = centerLat + j * gridSize + offset;
            roadNetwork.push({ lng, lat });
          }
        }
        
        // 确定性生成额外路网点
        const extraPoints = 8 + Math.floor(rng(200) * 4); // 8-11个额外点
        for (let i = 0; i < extraPoints; i++) {
          const angle = rng(300 + i * 2) * Math.PI * 2;
          const distance = 0.002 + rng(300 + i * 2 + 1) * 0.008;
          const offsetLng = Math.cos(angle) * distance;
          const offsetLat = Math.sin(angle) * distance;
          roadNetwork.push({ 
            lng: centerLng + offsetLng, 
            lat: centerLat + offsetLat 
          });
        }
        
        // 确保事件点被包含在路网点中
        roadNetwork.push({ lng: centerLng, lat: centerLat });
        
        return roadNetwork;
      },
      
      // 离群点检测
      detectOutliers(points, center) {
        if (points.length <= 3) return points;
        
        // 计算所有点到中心点的距离
        const distances = points.map(point => ({
          point,
          distance: Math.sqrt(Math.pow(point.lng - center.lng, 2) + Math.pow(point.lat - center.lat, 2))
        }));
        
        // 计算距离的均值和标准差
        const mean = distances.reduce((sum, item) => sum + item.distance, 0) / distances.length;
        const variance = distances.reduce((sum, item) => sum + Math.pow(item.distance - mean, 2), 0) / distances.length;
        const stdDev = Math.sqrt(variance);
        
        // 过滤掉距离超过均值+2倍标准差的点
        const threshold = mean + 2 * stdDev;
        return distances.filter(item => item.distance <= threshold).map(item => item.point);
      },
      
      // 检查点集是否为凸形
      isConvexShape(points) {
        if (points.length <= 3) return true;
        
        // 使用Graham扫描算法生成凸包
        const convexHull = this.grahamScanConvexHull(points);
        
        // 如果凸包点数量等于原始点数量，则为凸形
        return convexHull.length === points.length;
      },
      
      // Graham扫描算法生成凸包
      grahamScanConvexHull(points) {
        if (points.length <= 1) return points;
        
        // 找到最左下的点
        let startPoint = points[0];
        for (let i = 1; i < points.length; i++) {
          const point = points[i];
          if (point.lat < startPoint.lat || (point.lat === startPoint.lat && point.lng < startPoint.lng)) {
            startPoint = point;
          }
        }
        
        // 按极角排序
        const sortedPoints = points.sort((a, b) => {
          const angleA = Math.atan2(a.lat - startPoint.lat, a.lng - startPoint.lng);
          const angleB = Math.atan2(b.lat - startPoint.lat, b.lng - startPoint.lng);
          if (angleA !== angleB) {
            return angleA - angleB;
          }
          // 如果角度相同，按距离排序
          const distA = Math.pow(a.lng - startPoint.lng, 2) + Math.pow(a.lat - startPoint.lat, 2);
          const distB = Math.pow(b.lng - startPoint.lng, 2) + Math.pow(b.lat - startPoint.lat, 2);
          return distA - distB;
        });
        
        // 构建凸包
        const stack = [];
        for (const point of sortedPoints) {
          while (stack.length >= 2) {
            const top = stack[stack.length - 1];
            const secondTop = stack[stack.length - 2];
            if (this.ccw(secondTop, top, point) <= 0) {
              stack.pop();
            } else {
              break;
            }
          }
          stack.push(point);
        }
        
        return stack;
      },
      
      // 计算三个点的转向（逆时针为正，顺时针为负，共线为0）
      ccw(p1, p2, p3) {
        return (p2.lng - p1.lng) * (p3.lat - p1.lat) - (p2.lat - p1.lat) * (p3.lng - p1.lng);
      },
      
      // Alpha形状算法，用于生成贴合路网的非矩形围栏
      generateAlphaShape(points, alpha) {
        if (points.length < 3) {
          // 如果点太少，返回一个默认的正八边形围栏
          const c = points[0]?.lng || this.dispatch.incidentLng;
          const d = points[0]?.lat || this.dispatch.incidentLat;
          const radius = 0.01;
          const sides = 8;
          const shape = [];
          for (let i = 0; i < sides; i++) {
            const angle = (Math.PI * 2 * i) / sides;
            const lng = c + Math.cos(angle) * radius;
            const lat = d + Math.sin(angle) * radius;
            shape.push({ lng, lat });
          }
          return this.sortPointsCounterClockwise(shape);
        }
        
        // 计算点之间的距离
        function distance(p1, p2) {
          return Math.sqrt(Math.pow(p1.lng - p2.lng, 2) + Math.pow(p1.lat - p2.lat, 2));
        }
        
        // 使用固定alpha值，保证围栏形状稳定
        const adjustedAlpha = alpha;
        
        // 1. 构建边的集合
        const edges = new Set();
        const alphaSquared = adjustedAlpha * adjustedAlpha;
        
        // 找出所有点对，筛选距离小于alpha的边
        for (let i = 0; i < points.length; i++) {
          for (let j = i + 1; j < points.length; j++) {
            const distSquared = Math.pow(points[i].lng - points[j].lng, 2) + Math.pow(points[i].lat - points[j].lat, 2);
            if (distSquared <= alphaSquared) {
              // 使用字符串表示边，确保无向性
              const edge = [i, j].sort((a, b) => a - b).join('-');
              edges.add(edge);
            }
          }
        }
        
        // 如果没有边，返回正八边形围栏
        if (edges.size === 0) {
          const c = points[0]?.lng || this.dispatch.incidentLng;
          const d = points[0]?.lat || this.dispatch.incidentLat;
          const radius = 0.01;
          const sides = 8;
          const shape = [];
          for (let i = 0; i < sides; i++) {
            const angle = (Math.PI * 2 * i) / sides;
            const lng = c + Math.cos(angle) * radius;
            const lat = d + Math.sin(angle) * radius;
            shape.push({ lng, lat });
          }
          return this.sortPointsCounterClockwise(shape);
        }
        
        // 2. 构建围栏点列表
        const fencePoints = [];
        const usedEdges = new Set();
        
        // 3. 找到边界边
        const edgeCounts = new Map();
        edges.forEach(edge => {
          edgeCounts.set(edge, (edgeCounts.get(edge) || 0) + 1);
        });
        
        const boundaryEdges = [];
        edgeCounts.forEach((count, edge) => {
          if (count === 1) {
            boundaryEdges.push(edge);
          }
        });
        
        // 4. 构建围栏路径（确定性选择：取第一条边界边开始）
        if (boundaryEdges.length > 0) {
          let currentEdge = boundaryEdges[0];
          usedEdges.add(currentEdge);
          
          const [startIdx, endIdx] = currentEdge.split('-').map(Number);
          fencePoints.push(points[startIdx]);
          fencePoints.push(points[endIdx]);
          
          let lastPointIdx = endIdx;
          
          while (true) {
            let nextEdge = null;
            
            // 确定性选择下一条边
            const possibleEdges = boundaryEdges.filter(edge => {
              if (usedEdges.has(edge)) return false;
              const [idx1, idx2] = edge.split('-').map(Number);
              return idx1 === lastPointIdx || idx2 === lastPointIdx;
            });
            
            if (possibleEdges.length > 0) {
              nextEdge = possibleEdges[0];
            }
            
            if (!nextEdge) break;
            
            usedEdges.add(nextEdge);
            const [idx1, idx2] = nextEdge.split('-').map(Number);
            const nextPointIdx = idx1 === lastPointIdx ? idx2 : idx1;
            fencePoints.push(points[nextPointIdx]);
            lastPointIdx = nextPointIdx;
            
            // 检查是否回到起点
            if (lastPointIdx === startIdx) break;
          }
        } else {
          // 如果没有边界边，使用凸包
          return this.grahamScanConvexHull(points);
        }
        
        // 5. 清理围栏点
        // 移除重复点
        const uniquePoints = [];
        const seen = new Set();
        fencePoints.forEach(point => {
          const key = `${point.lng.toFixed(6)},${point.lat.toFixed(6)}`;
          if (!seen.has(key)) {
            seen.add(key);
            uniquePoints.push(point);
          }
        });
        
        // 6. 如果生成的围栏点太少，返回凸包
        if (uniquePoints.length < 3) {
          return this.grahamScanConvexHull(points);
        }
        
        // 7. 确保围栏顶点按逆时针顺序排列
        return this.sortPointsCounterClockwise(uniquePoints);
      },
      
      // 按逆时针顺序排序点
      sortPointsCounterClockwise(points) {
        if (points.length <= 1) return points;
        
        // 计算中心点
        const center = points.reduce((acc, point) => {
          acc.lng += point.lng;
          acc.lat += point.lat;
          return acc;
        }, { lng: 0, lat: 0 });
        center.lng /= points.length;
        center.lat /= points.length;
        
        // 按极角排序
        return points.sort((a, b) => {
          return Math.atan2(a.lat - center.lat, a.lng - center.lng) - Math.atan2(b.lat - center.lat, b.lng - center.lng);
        });
      },
      
      // 检查点是否已经存在于点列表中
      pointExists(points, point) {
        for (const p of points) {
          if (Math.abs(p.lng - point.lng) < 0.00001 && Math.abs(p.lat - point.lat) < 0.00001) {
            return true;
          }
        }
        return false;
      },
      resetFence() {
        const cLng = this.dispatch.incidentLng || DEFAULT_CENTER_LNG;
        const cLat = this.dispatch.incidentLat || DEFAULT_CENTER_LAT;
        const dx = 0.015, dy = 0.012;
        this.dispatch.fenceVertices = [
          { lng: cLng - dx, lat: cLat - dy },
          { lng: cLng + dx, lat: cLat - dy },
          { lng: cLng + dx, lat: cLat + dy },
          { lng: cLng - dx, lat: cLat + dy },
        ];
      },

      // 从后端API获取三层围栏并渲染
      async renderThreeLayerFence(event, index) {
        // 捕获当前地图代数，防止异步回调使用已销毁的地图
        const gen = this.mapGeneration || 0;
        try {
          const url = `/api/fence/dynamic-polygon?lng=${event.lng}&lat=${event.lat}`;
          const res = await authFetch(url);
          if (!res.ok) throw new Error(`围栏接口请求失败: HTTP ${res.status}`);
          const data = await res.json();
          
          // 地图已刷新，丢弃过时的回调
          if (this.mapGeneration !== gen || !this.mapInstance) return;
          
          if (!data || !data.layers || data.layers.length === 0) {
            // API不可用时使用本地fallback
            this.renderFallbackFence(event, index);
            return;
          }
          
          // 三层颜色方案：核心圈（红/深）、缓冲圈（橙/中）、扩展圈（蓝/浅）
          const layerConfigs = [
            { name: 'CORE', fillColor: '#ef4444', strokeColor: '#dc2626', fillOpacity: 0.45, strokeWidth: 3 },
            { name: 'BUFFER', fillColor: '#f59e0b', strokeColor: '#d97706', fillOpacity: 0.35, strokeWidth: 2 },
            { name: 'EXTENDED', fillColor: '#3b82f6', strokeColor: '#2563eb', fillOpacity: 0.25, strokeWidth: 2 }
          ];
          
          // 按 CORE → BUFFER → EXTENDED 顺序渲染（内层在上）
          data.layers.forEach((layer, li) => {
            if (!layer.vertices || layer.vertices.length < 3) return;
            
            const config = layerConfigs.find(c => c.name === layer.level) || 
                          { fillColor: '#6b7280', strokeColor: '#4b5563', fillOpacity: 0.2, strokeWidth: 2 };
            
            // 构建路径并闭合
            const path = layer.vertices.map(v => [v.lng, v.lat]);
            const first = path[0];
            const last = path[path.length - 1];
            if (first[0] !== last[0] || first[1] !== last[1]) {
              path.push([...first]);
            }
            
            const polygon = new AMap.Polygon({
              path: path,
              strokeColor: config.strokeColor,
              strokeWeight: config.strokeWidth,
              strokeOpacity: 0.8,
              strokeStyle: 'dashed',
              fillColor: config.fillColor,
              fillOpacity: config.fillOpacity,
              zIndex: 100 - li * 10 // 内层在上
            });
            
            polygon.setMap(this.mapInstance);
            this.mapMarkers.push(polygon);
            
            // 为每层添加标签
            const centerVertex = layer.vertices[Math.floor(layer.vertices.length / 2)];
            if (centerVertex) {
              const label = new AMap.Text({
                position: [centerVertex.lng, centerVertex.lat],
                text: layer.name,
                style: {
                  'background-color': config.fillColor,
                  'color': '#fff',
                  'font-size': '11px',
                  'padding': '2px 6px',
                  'border-radius': '3px',
                  'opacity': 0.9
                },
                offset: new AMap.Pixel(-20, -10)
              });
              label.setMap(this.mapInstance);
              this.mapMarkers.push(label);
            }
          });
          
          if (DEBUG) console.log(`[三层围栏] 事件${index+1} ${event.type} ${data.layers.length}层`);
          
        } catch (e) {
          console.warn('[三层围栏] API调用失败，使用本地fallback', e);
          this.renderFallbackFence(event, index);
        }
      },
      
      // 本地fallback围栏（API不可用时使用，增强版地形感知算法）
      renderFallbackFence(event, index) {
        if (!this.mapInstance) return;

        // 各层基础半径（经纬度）
        const baseRadii = [0.025, 0.07, 0.13]; // 核心圈~3km, 缓冲圈~8km, 扩展圈~15km
        const layerConfigs = [
          { fillColor: '#ef4444', strokeColor: '#dc2626', fillOpacity: 0.45, strokeWidth: 3, name: '核心圈' },
          { fillColor: '#f59e0b', strokeColor: '#d97706', fillOpacity: 0.35, strokeWidth: 2, name: '缓冲圈' },
          { fillColor: '#3b82f6', strokeColor: '#2563eb', fillOpacity: 0.25, strokeWidth: 2, name: '扩展圈' }
        ];
        // 层间角度错开，避免同心圆
        const angleOffsets = [0, 5, 2.5];

        baseRadii.forEach((baseRadius, li) => {
          const vertices = [];
          const sampleCount = 24;  // 24方向（每15度），提速33%
          const config = layerConfigs[li];
          const angleOffset = angleOffsets[li];

          for (let i = 0; i < sampleCount; i++) {
            const angleDeg = (360 / sampleCount) * i + angleOffset;
            const angleRad = (angleDeg * Math.PI) / 180;

            const sampleLng = event.lng + Math.cos(angleRad) * baseRadius;
            const sampleLat = event.lat + Math.sin(angleRad) * baseRadius;

            // 简化地形扰动：单次 hashCoord 替代 multiOctaveNoise + waterFactor + buildingFactor
            const rawNoise = this.hashCoord(sampleLng * 11, sampleLat * 13);
            const adjustment = 0.7 + rawNoise * 0.6; // 范围 0.4~1.3
            const effectiveDist = baseRadius * adjustment;
            vertices.push({
              lng: event.lng + Math.cos(angleRad) * effectiveDist,
              lat: event.lat + Math.sin(angleRad) * effectiveDist
            });
          }

          // 闭合路径
          vertices.push({ ...vertices[0] });

          const path = vertices.map(v => [v.lng, v.lat]);
          const polygon = new AMap.Polygon({
            path: path,
            strokeColor: config.strokeColor,
            strokeWeight: config.strokeWidth,
            strokeOpacity: 0.7,
            strokeStyle: 'dashed',
            fillColor: config.fillColor,
            fillOpacity: config.fillOpacity,
            zIndex: 100 - li * 10
          });
          polygon.setMap(this.mapInstance);
          this.mapMarkers.push(polygon);
        });
      },

      // 确定性哈希
      hashCoord(lng, lat) {
        const a = Math.round(lng * 10000);
        const b = Math.round(lat * 10000);
        let h = (a * 31 + b) | 0;
        h = (h ^ (h >>> 16)) * 0x45d9f3b;
        h = (h ^ (h >>> 16));
        return (h & 0x7fffffff) / 0x7fffffff;
      },

      removeUnit(i) {
        if (this.dispatch.units.length <= 1) return;
        this.dispatch.units.splice(i, 1);
      },
      addUnit() {
        this.dispatch.units.push({
          unitId: "U-" + String(this.dispatch.units.length + 1).padStart(3, "0"),
          name: "",
          available: true,
          lng: this.dispatch.incidentLng,
          lat: this.dispatch.incidentLat,
          policeType: "巡逻警",
          transportMode: "步行"
        });
      },
      loadDemoDispatch() {
        this.dispatch.incidentLng = DEFAULT_CENTER_LNG;
        this.dispatch.incidentLat = DEFAULT_CENTER_LAT;
        this.incidentAddress = "";
        this.autoGenerateFence();
        this.dispatch.units = [
          { unitId: "U-001", name: "巡逻一组", available: true, lng: 114.308, lat: 30.590, policeType: "巡逻警", transportMode: "步行" },
          { unitId: "U-002", name: "巡逻二组", available: true, lng: 114.310, lat: 30.595, policeType: "巡逻警", transportMode: "骑行" },
          { unitId: "U-003", name: "交警一组", available: true, lng: 114.303, lat: 30.593, policeType: "交警", transportMode: "开车" },
          { unitId: "U-004", name: "刑警一组", available: true, lng: 114.306, lat: 30.588, policeType: "刑警", transportMode: "开车" },
        ];
      },

      async runDispatch() {
        this.dispatchError = "";
        this.dispatchResult = null;

        // 自动获取坐标（如果未设置）
        if (this.dispatch.incidentLng == null || this.dispatch.incidentLat == null) {
          try {
            const r = await fetch("/api/location/ip");
            const d = await r.json();
            if (d && d.success) {
              this.dispatch.incidentLng = d.lng;
              this.dispatch.incidentLat = d.lat;
              this.incidentAddress = (d.city || '') + ' ' + (d.method || '');
            }
          } catch(e) {
            this.dispatch.incidentLng = DEFAULT_CENTER_LNG;
            this.dispatch.incidentLat = DEFAULT_CENTER_LAT;
          }
        }

        this.dispatchLoading = true;
        const body = {
          incident: { lng: this.dispatch.incidentLng, lat: this.dispatch.incidentLat },
          fence: this.dispatch.fenceVertices.map((v) => ({ lng: v.lng, lat: v.lat })),
          units: this.dispatch.units.map((u) => ({
            unitId: u.unitId,
            name: u.name,
            available: u.available,
            lng: u.lng,
            lat: u.lat,
            policeType: u.policeType,
            transportMode: u.transportMode
          })),
        };
        try {
          const res = await authFetch("/api/dispatch/nearest", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          const text = await res.text();
          let data;
          try {
            data = JSON.parse(text);
          } catch {
            data = text;
          }
          if (!res.ok) {
            if (res.status === 404 || res.status === 405) {
              this.dispatchResult = this.computeNearestDispatch(body);
              return;
            }
            if (res.status === 400 && data && data.msg) {
              this.dispatchError = data.msg;
            } else {
              this.dispatchError = typeof data === "string" ? data : (data.msg || data.detail || JSON.stringify(data));
            }
            return;
          }
          this.dispatchResult = data;
        } catch (e) {
          this.dispatchResult = this.computeNearestDispatch(body);
        } finally {
          this.dispatchLoading = false;
        }
      },

      wsUrl() {
        // HTTPS→wss, 自动检测服务器地址（支持局域网多设备访问）
        const proto = location.protocol === "https:" ? "wss:" : "ws:";
        let url = proto + "//" + location.host + "/ws/command";
        const token = getToken();
        if (token) { url += "?token=" + encodeURIComponent(token); }
        return url;
      },

      // 获取服务器基础URL（支持局域网访问自动检测）
      serverBaseUrl() {
        return location.protocol + "//" + location.host;
      },

      // 检查是否HTTPS（定位功能需要）
      isSecureContext() {
        return location.protocol === "https:" || window.isSecureContext;
      },

      // WebSocket自动重连（指数退避）
      scheduleReconnect() {
        if (this.reconnectAttempts >= 10) {
          this.pushWsLog('in', '[reconnect] 已达最大重连次数(10)，停止重连');
          return;
        }
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
        this.pushWsLog('in', '[reconnect] ' + (delay/1000) + 's后重连 (第' + (this.reconnectAttempts + 1) + '次)');
        this.reconnectTimer = setTimeout(() => {
          this.reconnectAttempts++;
          this.toggleWs();
        }, delay);
      },
      resetReconnect() {
        this.reconnectAttempts = 0;
        if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
      },

      toggleWs() {
        if (this.ws && this.wsReadyState === 1) {
          this.ws.close();
          this.wsReadyState = 2;
          setTimeout(() => {
            this.ws = null;
            this.wsReadyState = 3;
          }, 100);
          return;
        }
        this.wsConnecting = true;
        this.wsReadyState = 0;
        const socket = new WebSocket(this.wsUrl());
        this.ws = socket;
        socket.onopen = () => {
          this.wsConnecting = false;
          this.wsReadyState = 1;
          this.resetReconnect();
          this.pushWsLog("in", "[open] " + this.wsUrl());
          // 警员端连接成功后自动发送连接请求 + 位置
          if (this.userRole === "officer") {
            setTimeout(() => {
              this.sendConnectionRequest();
              // 自动获取并上报位置
              this.getCurrentLocation();
              // 持续GPS追踪
              this.startContinuousTracking();
            }, 500);
          }
        };
        socket.onclose = (ev) => {
          this.wsConnecting = false;
          this.wsReadyState = 3;
          this.pushWsLog("in", "[close] code=" + ev.code);
          if (this.ws === socket) this.ws = null;
          // WebSocket异常关闭(1006)可能是Token过期
          if (ev.code === 1006 && getToken()) {
            this.pushWsLog("in", "[auth] Token可能已过期，请重新登录");
          }
          // 自动重连
          if (ev.code !== 1000) {
            if (this.userRole === "guest" && !getToken()) {
              // Guest没有Token→先获取Token再重连
              this.pushWsLog("in", "[reconnect] 获取访客Token...");
              fetch("/api/user/guest-token", { method: "POST", headers: { "Content-Type": "application/json" } })
                .then(r => r.json())
                .then(data => {
                  if (data.code === 200 && data.data && data.data.token) {
                    setToken(data.data.token);
                    this.scheduleReconnect();
                  }
                }).catch(() => {});
            } else if (this.userRole === "commander" || this.userRole === "officer" || this.userRole === "guest") {
              this.scheduleReconnect();
            }
          }
        };
        socket.onerror = () => {
          this.wsConnecting = false;
          this.wsReadyState = 3;
          this.pushWsLog("in", "[error]");
        };
        socket.onmessage = (ev) => {
          const data = typeof ev.data === "string" ? ev.data : "[binary]";
          this.pushWsLog("in", data);
          
          try {
            const json = JSON.parse(data);
            if (json.type === "CONNECTION_REQUEST") {
              // 指挥端接收到连接请求 → 自动接受
              if (this.userRole === "commander") {
                // 自动接受连接请求
                this.handleConnectionRequest(json.sessionId, true, '自动接受');
                // BugFix: 自动接受后立即从请求列表移除，避免残留手动按钮
                this.connectionRequests = this.connectionRequests.filter(
                  req => req.sessionId !== json.sessionId
                );
              }
            } else if (json.type === "CONNECT_RESPONSE") {
              // 警务端接收到连接响应
              if (this.userRole === "officer") {
                this.pendingConnection = {
                  accepted: json.accepted,
                  reason: json.reason
                };
              }
            } else if (json.type === "CONNECT_RESPONSE_BROADCAST") {
              // 指挥端接收到连接响应广播
              if (this.userRole === "commander") {
                // CONNECT_RESPONSE_BROADCAST received
                // 从连接请求列表中移除已处理的请求
                this.connectionRequests = this.connectionRequests.filter(req => {
                    // 从请求列表移除
                  return req.sessionId !== json.targetSessionId;
                });
                // 清空当前连接状态
                this.pendingConnection = null;
              }
            } else if (json.type === "CONNECTED_OFFICERS") {
              // 指挥端接收到已连接警员列表
              if (this.userRole === "commander") {
                const officers = json.officers || {};
                this.connectedOfficers = Object.values(officers);
                this.dispatch.units = this.connectedOfficers.map((officer, index) => ({
                  unitId: officer.unitId,
                  name: officer.name,
                  available: true,
                  sessionId: officer.sessionId,
                  status: officer.status || '执勤中',
                  transportMode: officer.transportMode || '步行',
                  lng: officer.lng || DEFAULT_CENTER_LNG + (index * 0.001),
                  lat: officer.lat || DEFAULT_CENTER_LAT + (index * 0.001)
                }));
                // 刷新地图（警员上线时重新标记位置）
                if (this.mapLoaded && this.mapContext === "commander") {
                  this.initMapForRole("commander");
                }
              }
            } else if (json.type === "CONNECTION_CLOSED") {
              // 连接关闭广播
              if (this.userRole === "commander") {
                this.connectionRequests = this.connectionRequests.filter(req => req.sessionId !== json.sessionId);
                this.connectedOfficers = this.connectedOfficers.filter(officer => officer.sessionId !== json.sessionId);
                // 从警力列表中删除
                this.dispatch.units = this.connectedOfficers.map((officer, index) => ({
                  unitId: officer.unitId,
                  name: officer.name,
                  available: true,
                  sessionId: officer.sessionId,
                  status: officer.status || '执勤中',
                  transportMode: officer.transportMode || '步行',
                  lng: officer.lng || DEFAULT_CENTER_LNG + (index * 0.001),
                  lat: officer.lat || DEFAULT_CENTER_LAT + (index * 0.001)
                }));
              }
            } else if (json.type === "STATUS_UPDATE") {
              // 指挥端接收到警员状态更新
              if (this.userRole === "commander") {
                const sessionId = json.sessionId;
                const status = json.status;
                this.handleStatusUpdate(sessionId, status);
                this.pushWsLog('in', '警员状态更新: ' + status);
              }
            } else if (json.type === "LOCATION_UPDATE") {
              // 指挥端接收到警员位置更新
              if (this.userRole === "commander") {
                const sessionId = json.sessionId;
                const lng = json.lng;
                const lat = json.lat;
                this.handleLocationUpdate(sessionId, lng, lat);
                this.pushWsLog('in', '警员位置更新: ' + lng + ', ' + lat);
              }
            } else if (json.type === "COMMAND_STATUS_UPDATE") {
              // 指令状态推进通知
              const orderId = json.orderId;
              const status = json.status;
              const officerName = json.officerName;
              if (this.userRole === "commander") {
                this.pushWsLog('in', officerName + ' 指令状态: ' + status);
                // 更新事件状态
                const event = this.commanderEvents.find(e => e.assignedOrderId === orderId);
                if (event) { event.orderStatus = status; }
              } else if (this.userRole === "officer") {
                const order = this.officerOrders.find(o => o.id === orderId);
                if (order) { order.status = status; }
              }
            } else if (json.type === "TRANSPORT_MODE_UPDATE") {
              // 指挥端接收到警员交通方式更新
              if (this.userRole === "commander") {
                const sessionId = json.sessionId;
                const transportMode = json.transportMode;
                this.handleTransportModeUpdate(sessionId, transportMode);
                this.pushWsLog('in', '警员交通方式更新: ' + transportMode);
              }
            } else if (json.type === "TASK_COMPLETED") {
              // 指挥端接收到任务完成通知
              if (this.userRole === "commander") {
                const officerName = json.officerName;
                const unitId = json.unitId;
                const orderId = json.orderId;
                const orderTitle = json.orderTitle;
                const eventId = json.eventId;
                const completedEvent = json.completedEvent;
                this.pushWsLog('in', `警员 ${officerName} (${unitId}) 已完成任务: ${orderTitle} (${orderId})`);
                
                // 根据事件ID移除对应的事件
                if (eventId) {
                  const beforeCount = this.commanderEvents.length;
                  this.commanderEvents = this.commanderEvents.filter(event => event.id !== eventId);
                  const afterCount = this.commanderEvents.length;
                  if (DEBUG) console.log('任务完成:', eventId, '移除:', beforeCount, '→', afterCount);
                  
                  // 保存到已完成事件列表
                  if (!this.completedEventIds.includes(eventId)) {
                    this.completedEventIds.push(eventId);
                    localStorage.setItem('pcmp_completed_events', JSON.stringify(this.completedEventIds));
                  }
                  
                  // 刷新地图以移除已完成的事件点
                  if (this.mapLoaded && this.mapContext === "commander") {
                    this.initMapForRole("commander");
                  }
                }
                
                // 添加到已完成事件列表
                if (completedEvent) {
                  this.completedEvents.push(completedEvent);
                  if (DEBUG) console.log('指挥端任务完成:', completedEvent.id);
                }
              } else if (this.userRole === "guest") {
                // 公众端接收到任务完成通知
                const completedEvent = json.completedEvent;
                if (completedEvent) {
                  // 添加到已完成事件列表
                  this.completedEvents.push(completedEvent);
                  if (DEBUG) console.log('公众端任务完成:', completedEvent.id);
                }
              }
            } else if (json.type === "EVENT_REPORTED") {
              // 指挥端接收到事件上报通知
              if (this.userRole === "commander") {
                const officerName = json.officerName;
                const unitId = json.unitId;
                const event = json.event;
                this.pushWsLog('in', `警员 ${officerName} (${unitId}) 上报事件: ${event.type} (${event.priority}优先级)`);
                
                // 生成唯一的事件ID
                let eventId;
                do {
                  eventId = "E-" + String(Math.floor(Math.random() * 10000)).padStart(4, "0");
                } while (this.commanderEvents.some(e => e.id === eventId) || this.completedEvents.some(e => e.id === eventId));
                
                // 添加新事件到事件列表
                const newEvent = {
                  id: eventId,
                  type: event.type,
                  priority: event.priority,
                  status: "pending",
                  region: event.address || "已获取位置",
                  lng: event.lng,
                  lat: event.lat
                };
                
                this.commanderEvents.unshift(newEvent);
                
                // 刷新地图以显示新事件
                if (this.mapLoaded && this.mapContext === "commander") {
                  this.initMapForRole("commander");
                }
              }
            } else if (json.type === "SAFETY_REPORT") {
              // 指挥端接收到安全隐患上报
              if (this.userRole === "commander") {
                const report = json.report;
                this.pushWsLog('in', `公众上报安全隐患: ${report.vague}`);
                
                // 添加到安全隐患列表
                this.safetyReports.push(report);
              }
            } else if (json.type === "EVENT_FEEDBACK") {
              // 指挥端接收到事件反馈
              if (this.userRole === "commander") {
                const feedback = json.feedback;
                this.pushWsLog('in', `公众提交事件反馈: ${feedback.eventType} - ${feedback.rating}★`);
                
                // 添加到事件反馈列表
                this.eventFeedbacks.push(feedback);
              } else if (this.userRole === "officer") {
                // 警员端接收到事件反馈
                const feedback = json.feedback;
                this.pushWsLog('in', `公众提交事件反馈: ${feedback.eventType} - ${feedback.rating}★`);
                
                // 添加到事件反馈列表
                this.eventFeedbacks.push(feedback);
                
                // 重新计算服务评分
                this.calculateAverageRating();
              }
            } else if (json.type === "COMMAND") {
              // 警员端接收到指挥中心下达的指令
              if (this.userRole === "officer") {
                const order = json.order;
                if (order) {
                  // 允许重复下发（每次生成新ID），旧的同事件指令自动替换
                  const existIdx = this.officerOrders.findIndex(o => o.eventId === order.eventId && o.id !== order.id);
                  if (existIdx >= 0) {
                    this.officerOrders[existIdx] = order; // 替换旧指令
                  } else if (!this.officerOrders.some(o => o.id === order.id)) {
                    this.officerOrders.push(order);
                  }
                  this.pushWsLog('in', '收到指挥中心指令: ' + order.title);
                  if (this.mapLoaded && this.mapContext === "officer") {
                    this.initMapForRole("officer");
                  }
                  // 每次都弹出路线规划弹窗
                  if (this.officerLng && this.officerLat) {
                    this.$nextTick(() => {
                      this.showRoutePlan(order.title, order.address || order.place, order.lng, order.lat);
                    });
                  } else {
                    this.getCurrentLocation();
                    setTimeout(() => {
                      if (this.officerLng && this.officerLat) {
                        this.showRoutePlan(order.title, order.address || order.place, order.lng, order.lat);
                      }
                    }, 3000);
                  }
                }
              }
            } else if (json.type === "COMMAND_ACK") {
              // 指挥端接收到指令发送确认
              if (this.userRole === "commander") {
                const eventId = json.eventId;
                const delivered = json.delivered;
                if (eventId) {
                  const ev = this.commanderEvents.find(e => e.id === eventId);
                  if (ev) {
                    ev.status = '已指派';
                    ev.assignedOrderId = json.orderId;
                    this.pushWsLog('in', '指令' + json.orderId + ' ' + (delivered ? '已送达' : '未送达：' + json.message));
                    // 刷新地图
                    if (this.mapLoaded && this.mapContext === 'commander') {
                      this.$nextTick(() => { this.initMapForRole('commander'); });
                    }
                  }
                }
              }
            } else if (json.type === "EVENT_STATUS_UPDATE") {
              // 指挥端接收到事件状态更新广播
              if (this.userRole === "commander") {
                const eventId = json.eventId;
                const newStatus = json.status;
                const officerName = json.officerName;
                if (eventId && newStatus) {
                  const ev = this.commanderEvents.find(e => e.id === eventId);
                  if (ev) {
                    ev.status = newStatus;
                    if (officerName) ev.assignedOfficer = officerName;
                    if (json.orderId) ev.assignedOrderId = json.orderId;
                    this.pushWsLog('in', '事件 ' + eventId + ' 状态更新为: ' + newStatus + (officerName ? ' (指派给: ' + officerName + ')' : ''));
                    // 刷新地图
                    if (this.mapLoaded && this.mapContext === 'commander') {
                      this.$nextTick(() => { this.initMapForRole('commander'); });
                    }
                  }
                }
              }
            }
          } catch (e) {
            console.warn('[ws.onmessage] 消息解析失败:', e.message, '原始数据:', ev.data.substring(0, 200));
          }
        };
      },

      pushWsLog(dir, text) {
        let displayText = "";
        let isCommander = false;
        try {
          const json = JSON.parse(text);
          if (json.type === "BROADCAST") {
            const sender = json.roleName || "未知";
            isCommander = sender === "指挥中心";
            displayText = `${sender}: ${json.payload}`;
          } else if (json.type === "OPEN") {
            displayText = "连接成功";
          } else if (json.type === "CONNECTION_REQUEST") {
            displayText = `警员 ${json.name} (${json.unitId}) 请求连接`;
          } else if (json.type === "CONNECT_RESPONSE") {
            displayText = `连接${json.accepted ? "已接受" : "已拒绝"} ${json.reason || ""}`;
          }
        } catch (e) {
          // 非JSON消息，不显示
        }
        if (displayText) {
          this.wsLogs.push({ dir, text: displayText, isCommander: isCommander });
          this.$nextTick(() => {
            const el = this.$refs.logEl;
            if (el) el.scrollTop = el.scrollHeight;
          });
        }
      },

      // 点击对话按钮时自动聚焦到文本输入框
      focusTextarea() {
        this.$nextTick(() => {
          const textareas = document.querySelectorAll('textarea[placeholder="输入消息内容..."]');
          if (textareas.length > 0) {
            textareas[0].focus();
            textareas[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        });
      },
      
      // 显示路线规划弹窗
      // 关闭路线弹窗
      _closeRouteModal() {
        const m = document.getElementById('route-modal');
        if (m && m.parentNode) m.parentNode.removeChild(m);
        const o = document.getElementById('route-overlay');
        if (o && o.parentNode) o.parentNode.removeChild(o);
      },

      showRoutePlan(taskTitle, taskAddress, taskLng, taskLat) {
        // 移除旧弹窗
        const old = document.getElementById('route-modal');
        if (old) old.parentNode && old.parentNode.removeChild(old);
        const oldOv = document.getElementById('route-overlay');
        if (oldOv) oldOv.parentNode && oldOv.parentNode.removeChild(oldOv);

        // 检查坐标有效性
        if (!taskLng || !taskLat) {
          this.showToast('任务坐标无效，无法规划路线', 'warning');
          return;
        }
        if (!this.officerLng || !this.officerLat) {
          this.showToast('请先获取当前位置', 'warning');
          this.getCurrentLocation();
          return;
        }

        const uid = Date.now();
        const safeTitle = escapeHtml(taskTitle || '');
        const safeAddr = escapeHtml(taskAddress || '未知');

        // 遮罩
        const overlay = document.createElement('div');
        overlay.id = 'route-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:9999;backdrop-filter:blur(4px);';
        overlay.onclick = () => this._closeRouteModal();
        document.body.appendChild(overlay);

        // 弹窗（响应式高度）
        const mh = window.innerHeight * 0.85;
        const mw = window.innerWidth < 500 ? '96vw' : '85%';
        const modal = document.createElement('div');
        modal.id = 'route-modal';
        modal.style.cssText = `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:${mw};max-width:900px;height:${mh}px;max-height:650px;background:#071026;border:1px solid rgba(0,238,255,0.2);border-radius:8px;box-shadow:0 4px 40px rgba(0,0,0,0.6);z-index:10000;padding:16px;display:flex;flex-direction:column;`;

        // 标题栏
        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid rgba(0,238,255,0.1);flex-shrink:0;';
        header.innerHTML = `<div><h3 style="margin:0;font-size:15px;color:#e0f0ff;">🗺 ${safeTitle}</h3><p style="margin:3px 0 0;font-size:12px;color:#8899bb;">📍 ${safeAddr}</p></div><button id="route-close-btn-${uid}" style="padding:8px 16px;background:#ef4444;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:14px;font-weight:600;">✕ 关闭</button>`;
        modal.appendChild(header);
        
        // 路线信息面板（预创建）
        const infoPanel = document.createElement('div');
        infoPanel.id = `route-info-${uid}`;
        infoPanel.style.cssText = 'padding:12px 16px;background:rgba(0,238,255,0.05);border:1px solid rgba(0,238,255,0.1);border-radius:4px;margin-bottom:12px;font-size:14px;color:#c8d8f0;min-height:48px;display:flex;align-items:center;';
        infoPanel.innerHTML = '<div style="display:flex;align-items:center;gap:8px;"><span style="display:inline-block;width:16px;height:16px;border:2px solid #0ef;border-top-color:transparent;border-radius:50%;animation:spin 1s linear infinite;"></span><span style="color:#8899bb;">正在基于实时路况计算最优路线...</span></div>';
        modal.appendChild(infoPanel);
        
        // 路线图容器
        const mapContainer = document.createElement('div');
        mapContainer.id = `route-map-${uid}`;
        mapContainer.style.cssText = 'flex:1;width:100%;border-radius:6px;overflow:hidden;min-height:0;';
        modal.appendChild(mapContainer);
        
        document.body.appendChild(modal);
        
        // 绑定关闭按钮
        setTimeout(() => {
          const closeBtn = document.getElementById(`route-close-btn-${uid}`);
          if (closeBtn) closeBtn.onclick = () => {
            document.body.removeChild(modal);
            document.body.removeChild(overlay);
          };
        }, 50);
        
        // 初始化路线图
        this.initRouteMap(taskLng, taskLat, uid);
      },
      
      // 初始化路线地图
      initRouteMap(taskLng, taskLat, uid) {
        if (!this.amapKey || !this.amapSec) {
          const infoPanel = document.getElementById(`route-info-${uid}`);
          if (infoPanel) infoPanel.innerHTML = '<p style="margin:0;color:#f55;">请先配置高德地图API密钥</p>';
          return;
        }
        
        // 等待DOM元素创建完成
        setTimeout(() => {
          const mapContainer = document.getElementById(`route-map-${uid}`);
          if (!mapContainer) return;
          
          const infoPanel = document.getElementById(`route-info-${uid}`);
          
          const myLng = this.officerLng;
          const myLat = this.officerLat;

          // 验证坐标有效性（null/undefined/NaN都拦截）
          if (!this._validCoord(myLng, myLat) || !this._validCoord(taskLng, taskLat)) {
            if (infoPanel) infoPanel.innerHTML = '<p style="margin:0;color:#f55;">坐标无效，请先获取当前位置</p>';
            return;
          }
          
          // 创建地图实例
          const map = new AMap.Map(`route-map-${uid}`, {
            center: [(myLng + taskLng) / 2, (myLat + taskLat) / 2],
            zoom: 13,
            resizeEnable: true,
            scrollWheel: true,
            doubleClickZoom: true,
            dragEnable: true,
            zoomEnable: true,
          });
          
          // 添加起点和终点标记（try-catch防止AMap内部NaN错误）
          try {
            new AMap.Marker({
              position: [myLng, myLat],
              map: map,
              title: '我的位置',
              label: { content: '起点', offset: new AMap.Pixel(0, -20) }
            });
          } catch(e) { /* ignore */ }

          try {
            new AMap.Marker({
              position: [taskLng, taskLat],
              map: map,
              title: '任务地点',
              icon: new AMap.Icon({
                size: new AMap.Size(25, 34),
                image: 'https://a.amap.com/jsapi_demos/static/demo-center/icons/poi-marker-red.png',
                imageSize: new AMap.Size(25, 34)
              }),
              label: { content: '终点', offset: new AMap.Pixel(0, -20) }
            });
          } catch(e) { /* ignore */ }
          
          // 添加路况图层
          const trafficLayer = new AMap.TileLayer.Traffic({ autoRefresh: true, interval: 180 });
          map.add(trafficLayer);
          
          // 用高德Driving插件（基于实时路况）
          AMap.plugin(['AMap.Driving'], () => {
            const driving = new AMap.Driving({
              map: map,
              policy: AMap.DrivingPolicy.LEAST_TIME,
              showTraffic: true
            });
            
            driving.search(
              new AMap.LngLat(myLng, myLat),
              new AMap.LngLat(taskLng, taskLat),
              { extensions: 'all' },
              (status, result) => {
                if (status === 'complete' && result.routes && result.routes.length > 0) {
                  const route = result.routes[0];
                  const rawDist = Number(route.distance ?? 0);
                  const distance = (isFinite(rawDist) ? rawDist / 1000 : 0).toFixed(2); // km
                  const rawDur = Number(route.duration ?? route.time ?? route.totalTime ?? route.cost?.duration ?? 0);
                  const durationMin = (isFinite(rawDur) && rawDur > 0) ? Math.round(rawDur / 60) : 0; // 分钟
                  
                  // 从steps中聚合路况信息
                  let congestionDistance = 0;
                  let smoothDistance = 0;
                  let slowDistance = 0;
                  let jamDistance = 0;
                  let trafficLightCount = 0;
                  
                  if (route.steps) {
                    route.steps.forEach(step => {
                      const stepDist = step.distance || 0;
                      // 统计红绿灯
                      if (step.actions) {
                        step.actions.forEach(action => {
                          if (action && (action.indexOf('红绿灯') >= 0 || action.indexOf('交通信号灯') >= 0)) {
                            trafficLightCount++;
                          }
                        });
                      }
                      // 统计路况分布
                      const stepTraffic = step.traffic_status || step.trafficStatus;
                      if (stepTraffic === '畅通' || stepTraffic === 0) smoothDistance += stepDist;
                      else if (stepTraffic === '缓行' || stepTraffic === 1) slowDistance += stepDist;
                      else if (stepTraffic === '拥堵' || stepTraffic === 2) jamDistance += stepDist;
                      else if (stepTraffic === '严重拥堵' || stepTraffic === 3) jamDistance += stepDist;
                      else smoothDistance += stepDist; // 默认畅通
                    });
                  }
                  
                  // 判断整体路况
                  const totalDist = route.distance || 1;
                  const jamRatio = jamDistance / totalDist;
                  let overallTraffic, trafficColor;
                  if (jamRatio > 0.3) { overallTraffic = '拥堵'; trafficColor = '#ef4444'; }
                  else if (jamRatio > 0.1 || slowDistance / totalDist > 0.3) { overallTraffic = '缓行'; trafficColor = '#f59e0b'; }
                  else { overallTraffic = '畅通'; trafficColor = '#22c55e'; }
                  
                  // 格式化ETA到达时间
                  const now = new Date();
                  const eta = new Date(now.getTime() + durationMin * 60000);
                  const etaStr = eta.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
                  
                  if (infoPanel) {
                    infoPanel.innerHTML = `
                      <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;width:100%;">
                        <div style="background:rgba(0,150,255,0.08);padding:8px 14px;border-radius:4px;border-left:3px solid #0af;flex-shrink:0;">
                          <span style="color:#7a8fa0;font-size:12px;">路线距离</span>
                          <strong style="font-size:20px;color:#6cf;margin-left:4px;">${distance}</strong>
                          <span style="color:#7a8fa0;font-size:12px;">km</span>
                        </div>
                        <div style="background:rgba(255,170,0,0.08);padding:8px 14px;border-radius:4px;border-left:3px solid #fa0;flex-shrink:0;">
                          <span style="color:#7a8fa0;font-size:12px;">预估时间</span>
                          <strong style="font-size:20px;color:#fc0;margin-left:4px;">${durationMin}</strong>
                          <span style="color:#7a8fa0;font-size:12px;">分钟</span>
                        </div>
                        <div style="background:rgba(255,80,80,0.08);padding:8px 14px;border-radius:4px;border-left:3px solid #f55;flex-shrink:0;">
                          <span style="color:#7a8fa0;font-size:12px;">预计到达</span>
                          <strong style="font-size:18px;color:#f77;margin-left:4px;">${etaStr}</strong>
                        </div>
                        <div style="padding:8px 14px;border-radius:4px;border-left:3px solid ${trafficColor};background:rgba(0,255,136,0.05);flex-shrink:0;">
                          <span style="color:#7a8fa0;font-size:12px;">实时路况</span>
                          <strong style="font-size:16px;color:${trafficColor};margin-left:4px;">${overallTraffic}</strong>
                        </div>
                        ${trafficLightCount > 0 ? `
                        <div style="background:rgba(160,100,255,0.08);padding:8px 14px;border-radius:4px;border-left:3px solid #a8f;flex-shrink:0;">
                          <span style="color:#7a8fa0;font-size:12px;">红绿灯</span>
                          <strong style="font-size:16px;color:#c8f;margin-left:4px;">${trafficLightCount}</strong>
                          <span style="color:#7a8fa0;font-size:12px;">个</span>
                        </div>` : ''}
                      </div>
                    `;
                  }
                  
                  if (DEBUG) console.log(`[路线] ${distance}km ${durationMin}min traffic:${overallTraffic}`);
                } else {
                  console.error('路线规划失败', result);
                  if (infoPanel) {
                    infoPanel.innerHTML = '<p style="margin:0;color:#f55;">路线规划失败，可能原因：API密钥未配置、网络异常或位置信息无效</p>';
                  }

                  // Fallback: 使用直线距离估算
                  const dx = (taskLng - myLng) * 111000 * Math.cos(myLat * Math.PI / 180);
                  const dy = (taskLat - myLat) * 111000;
                  const straightDist = Math.sqrt(dx * dx + dy * dy) / 1000;
                  const estTime = Math.round(straightDist / 30 * 60); // 假设30km/h

                  if (infoPanel && straightDist > 0) {
                    infoPanel.innerHTML += `
                      <div style="margin-top:8px;padding:8px;background:rgba(255,170,0,0.08);border:1px solid rgba(255,170,0,0.2);border-radius:4px;font-size:12px;">
                        <strong style="color:#fc0;">估算参考:</strong> <span style="color:#aab8c8;">直线距离约 ${straightDist.toFixed(1)}km，预估 ${estTime} 分钟（不含路况）</span>
                      </div>
                    `;
                  }
                }
              }
            );
          });
        }, 150);
      },

      sendWs() {
        if (!this.canSendWs) return;
        const msgType = this.currentChatTarget ? "PRIVATE_MESSAGE" : (this.wsForm.type || "MESSAGE");
        const env = {
          type: msgType,
          payloadPlain: this.wsForm.payloadPlain || "",
          role: this.userRole
        };
        if (this.currentChatTarget) {
          env.targetSessionId = this.currentChatTarget.sessionId;
        }
        const raw = JSON.stringify(env);
        this.ws.send(raw);
        this.pushWsLog("out", raw);
        // 发送后清空消息输入框
        this.wsForm.payloadPlain = "";
      },

      sendConnectionRequest() {
        if (!this.canSendWs) return;
        const session = localStorage.getItem(LS_SESSION);
        // 优先使用已登录警员的用户名和编号，不再统一叫"巡逻组"
        let unitId = this.officerId || "U-001";
        let name = this.officerName || "警员";
        if (session) {
          try {
            const o = JSON.parse(session);
            if (o && o.username) {
              name = o.username;
              unitId = this.officerId || ("U-" + o.username.toUpperCase().substring(0, 3));
            }
          } catch {
            /* ignore */
          }
        }
        const env = {
          type: "CONNECT_REQUEST",
          role: "officer",
          unitId: unitId,
          name: name
        };
        const raw = JSON.stringify(env);
        this.ws.send(raw);
        this.pushWsLog("out", raw);
      },

      handleConnectionRequest(sessionId, accepted, reason) {
        if (!this.canSendWs) return;
        const env = {
          type: "CONNECT_RESPONSE",
          targetSessionId: sessionId,
          accepted: accepted,
          reason: reason || ""
        };
        const raw = JSON.stringify(env);
        this.ws.send(raw);
        this.pushWsLog("out", raw);
      },

      clearWsLog() {
        this.wsLogs = [];
      },

      issueCommand(event) {
        if (!this.canSendWs) {
          this.showToast('WebSocket未连接，请先连接', 'error');
          return;
        }

        // 自动选择目标警员：优先使用当前对话目标，否则选第一个空闲警员
        let targetOfficer = this.currentChatTarget;
        if (!targetOfficer) {
          // 优先选执勤中的警员
          targetOfficer = this.connectedOfficers.find(o => o.status === '执勤中');
          if (!targetOfficer) {
            targetOfficer = this.connectedOfficers[0];
          }
          if (!targetOfficer) {
            this.showToast('没有可用的在线警员，请等待警员连接', 'warning');
            return;
          }
          // 自动设置为当前对话目标，方便后续沟通
          this.currentChatTarget = targetOfficer;
        }

        const orderId = 'T-' + Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        const order = {
          id: orderId,
          eventId: event.id,
          eventType: event.type,
          title: event.type + '处置',
          place: event.region || '未知地点',
          address: event.region || event.address || '未知地点',
          priority: event.priority,
          deadline: new Date(Date.now() + 3600000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
          detail: '请前往处理' + event.type + '事件',
          lng: event.lng,
          lat: event.lat,
          officerName: targetOfficer.name,
          officerId: targetOfficer.unitId
        };

        const env = {
          type: 'COMMAND',
          targetSessionId: targetOfficer.sessionId,
          order: order
        };

        const raw = JSON.stringify(env);
        this.ws.send(raw);
        this.pushWsLog('out', '已向' + targetOfficer.name + '下达指令：' + event.type + '处置');

        // 立即更新事件状态为"已指派"
        event.status = '已指派';
        event.assignedOfficer = targetOfficer.name;
        event.assignedOrderId = orderId;

        // 如果地图已加载，刷新地图标记
        if (this.mapLoaded && this.mapContext === 'commander') {
          this.$nextTick(() => { this.initMapForRole('commander'); });
        }
      },

      autoAssignEvents() {
        if (!this.canSendWs) {
          this.showToast('WebSocket未连接，请先连接', 'error');
          return;
        }

        // 筛选空闲警员（执勤中状态）
        const availableOfficers = this.connectedOfficers.filter(officer => officer.status === '执勤中');
        if (availableOfficers.length === 0) {
          this.showToast('没有可用的空闲警员，请等待警员连接并设为执勤中状态', 'warning');
          return;
        }

        // 将警员信息转换为警力单位格式，用于距离计算（使用真实位置）
        const units = availableOfficers.map(officer => ({
          unitId: officer.unitId,
          name: officer.name,
          available: true,
          status: officer.status,
          transportMode: officer.transportMode || '步行',
          lng: officer.lng || DEFAULT_CENTER_LNG,
          lat: officer.lat || DEFAULT_CENTER_LAT,
          sessionId: officer.sessionId
        }));

        // 为每个待处理的事件找到最近的警力
        // 若无有效围栏（<3个顶点），传递空数组让算法自动回退到全量警员匹配
        const effectiveFence = (this.dispatch.fenceVertices && this.dispatch.fenceVertices.length >= 3)
          ? this.dispatch.fenceVertices : [];

        let assignedCount = 0;
        let pendingCount = 0;
        for (const event of this.commanderEvents) {
          // 修复：兼容"pending"和"待处理"两种状态
          if (event.status === 'pending' || event.status === '待处理') {
            pendingCount++;
            // 使用事件真实坐标作为事发点
            const incident = {
              lng: event.lng,
              lat: event.lat
            };

            // 使用围栏算法计算最近警力
            const nearestDispatch = this.computeNearestDispatch({
              incident: incident,
              fence: effectiveFence,
              units: units
            });

            if (nearestDispatch && nearestDispatch.selectedUnit) {
              // 找到对应的警员
              const selectedUnit = nearestDispatch.selectedUnit;
              const officer = units.find(u => u.unitId === selectedUnit.unitId);

              if (officer) {
                const orderId = 'T-' + Math.floor(Math.random() * 10000).toString().padStart(4, '0');
                const order = {
                  id: orderId,
                  eventId: event.id,
                  eventType: event.type,
                  title: event.type + '处置',
                  place: event.region || '未知地点',
                  address: event.region || event.address || '未知地点',
                  priority: event.priority,
                  deadline: new Date(Date.now() + 3600000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
                  detail: '请前往处理' + event.type + '事件',
                  lng: incident.lng,
                  lat: incident.lat,
                  officerName: officer.name,
                  officerId: officer.unitId
                };

                const env = {
                  type: 'COMMAND',
                  targetSessionId: officer.sessionId,
                  order: order
                };

                const raw = JSON.stringify(env);
                if (this.canSendWs) {
                  this.ws.send(raw);
                } else {
                  if (DEBUG) console.warn('[autoAssign] WS断连');
                  break;
                }

                let dispatchInfo = `已自动向${officer.name}下达指令：${event.type}处置`;
                if (nearestDispatch.distanceApprox) {
                  dispatchInfo += ` (距离：${nearestDispatch.distanceApprox.toFixed(2)}公里`;
                  if (nearestDispatch.estimatedTime) {
                    dispatchInfo += `，预计${nearestDispatch.estimatedTime.toFixed(2)}分钟到达`;
                  }
                  dispatchInfo += `)`;
                }
                this.pushWsLog('out', dispatchInfo);

                // 立即更新事件状态为"已指派"
                event.status = '已指派';
                event.assignedOfficer = officer.name;
                event.assignedOrderId = orderId;

                assignedCount++;
              }
            }
          }
        }

        if (assignedCount > 0) {
          this.showToast(`已自动分配${assignedCount}个事件给空闲警员`, 'success');

          // 重新加载地图以显示最新状态
          if (this.mapLoaded && this.mapContext === "commander") {
            this.initMapForRole("commander");
          }
        } else {
          const total = this.commanderEvents.length;
          if (total === 0) {
            this.showToast('当前无任何事件，请先加载或创建事件', 'info');
          } else if (pendingCount === 0) {
            this.showToast(`当前${total}个事件均非待处理状态`, 'info');
          } else {
            this.showToast(`有${pendingCount}个待处理事件，但围栏内无可用警员`, 'warning');
          }
        }
      },

      // 处理状态更新消息
      handleStatusUpdate(sessionId, status) {
        const officer = this.connectedOfficers.find(officer => officer.sessionId === sessionId);
        if (officer) {
          officer.status = status;
          // 同步更新警力列表中的状态
          const unitIndex = this.dispatch.units.findIndex(unit => unit.unitId === officer.unitId);
          if (unitIndex !== -1) {
            this.dispatch.units[unitIndex].status = status;
          }
        }
      },
      
      // 处理交通方式更新消息
      handleTransportModeUpdate(sessionId, transportMode) {
        const officer = this.connectedOfficers.find(officer => officer.sessionId === sessionId);
        if (officer) {
          officer.transportMode = transportMode;
          // 同步更新警力列表中的交通方式
          const unitIndex = this.dispatch.units.findIndex(unit => unit.unitId === officer.unitId);
          if (unitIndex !== -1) {
            this.dispatch.units[unitIndex].transportMode = transportMode;
          }
        }
      },
      
      // 更新交通方式
      updateTransportMode() {
        if (this.userRole === "officer" && this.canSendWs) {
          const env = {
            type: "TRANSPORT_MODE_UPDATE",
            transportMode: this.transportMode
          };
          const raw = JSON.stringify(env);
          this.ws.send(raw);
          this.pushWsLog('out', '交通方式更新为: ' + this.transportMode);
        }
      },
      
      // 完成任务
      // 6步指令状态推进
      getStatusIndex(status) {
        const steps = ['已指派', '已接收', '前往中', '已到达', '处置中', '已完成'];
        return steps.indexOf(status || '已指派');
      },
      updateOrderStatus(orderId, newStatus) {
        const order = this.officerOrders.find(o => o.id === orderId);
        if (!order) return;
        order.status = newStatus;
        this.pushWsLog('out', '指令状态更新: ' + orderId + ' → ' + newStatus);

        if (this.canSendWs) {
          this.ws.send(JSON.stringify({
            type: 'COMMAND_STATUS_UPDATE',
            orderId: orderId,
            status: newStatus
          }));
        }

        if (newStatus === '已完成') {
          this.completeOrder(orderId);
        } else if (this.mapLoaded && this.mapContext === 'officer') {
          this.initMapForRole('officer');
        }
      },

      completeOrder(orderId) {
        const index = this.officerOrders.findIndex(order => order.id === orderId);
        if (index !== -1) {
          const order = this.officerOrders[index];
          this.officerOrders.splice(index, 1);
          this.pushWsLog('out', '任务已完成: ' + orderId);
          
          // 如果地图已加载，重新初始化地图以清除红点
          if (this.mapLoaded && this.mapContext === "officer") {
            this.initMapForRole("officer");
          }
          
          // 使用指令中包含的警员信息
          let officerName = order.officerName || '警员';
          let officerId = order.officerId || 'U-001';
          
          // 如果指令中没有警员信息，使用当前登录的警员信息作为后备
          if (!officerName) {
            const session = localStorage.getItem(LS_SESSION);
            if (session) {
              try {
                const o = JSON.parse(session);
                if (o && o.username) {
                  officerName = o.username;
                  officerId = 'U-' + o.username.toUpperCase().substring(0, 3);
                }
              } catch {
                /* ignore */
              }
            }
          }
          
          // BugFix: 使用原始eventId发送TASK_COMPLETED，确保指挥官能正确过滤事件
          const originalEventId = order.eventId;
          const completedEventId = originalEventId || ('E-COMP-' + orderId);

          const completedEvent = {
            id: completedEventId,
            type: order.eventType || order.title.replace('处置', ''),
            region: order.place,
            officerName: officerName,
            officerId: officerId,
            completedTime: new Date().toLocaleString()
          };
          this.completedEvents.push(completedEvent);
          
          // 向指挥端发送任务完成通知
          if (this.userRole === "officer" && this.canSendWs) {
            const env = {
              type: "TASK_COMPLETED",
              orderId: orderId,
              orderTitle: order.title,
              eventId: originalEventId,  // 使用原始eventId确保指挥官端正确过滤
              completedEvent: completedEvent
            };
            const raw = JSON.stringify(env);
            this.ws.send(raw);
          }
        }
      },
      
      // 删除事件反馈
      deleteEventFeedback(feedbackId) {
        const index = this.eventFeedbacks.findIndex(feedback => feedback.id === feedbackId);
        if (index !== -1) {
          this.eventFeedbacks.splice(index, 1);
          this.pushWsLog('out', '已删除事件反馈: ' + feedbackId);
          // 重新计算服务评分
          this.calculateAverageRating();
        }
      },
      
      // 计算服务评分平均分
      calculateAverageRating() {
        // 获取当前警员的所有反馈
        let officerFeedbacks;
        
        if (DEBUG) console.log('计算评分:', this.officerName);
        // 反馈调试信息
        
        // 优先根据officerName过滤，因为officerId可能是随机生成的
        officerFeedbacks = this.eventFeedbacks.filter(feedback => feedback.officerName === this.officerName);
        if (DEBUG) console.log('officerName过滤:', officerFeedbacks.length);
        
        // 如果没有匹配的officerName，根据officerId过滤
        if (officerFeedbacks.length === 0) {
          officerFeedbacks = this.eventFeedbacks.filter(feedback => feedback.officerId === this.officerId);
          if (DEBUG) console.log('officerId过滤后:', officerFeedbacks.length);
        }
        
        // 如果仍然没有匹配的，使用所有反馈计算平均分
        if (officerFeedbacks.length === 0) {
          officerFeedbacks = this.eventFeedbacks;
          if (DEBUG) console.log('使用所有反馈计算平均分');
        }
        
        if (officerFeedbacks.length === 0) {
          this.averageRating = 0;
          // 无反馈
          return;
        }
        
        // 计算平均分
        const totalRating = officerFeedbacks.reduce((sum, feedback) => sum + feedback.rating, 0);
        this.averageRating = totalRating / officerFeedbacks.length;
        if (DEBUG) console.log('平均分:', this.averageRating);
      },
      
      // 获取指定警员的服务评分
      getOfficerRating(officerName) {
        // 根据officerName过滤反馈
        const officerFeedbacks = this.eventFeedbacks.filter(feedback => feedback.officerName === officerName);
        
        if (officerFeedbacks.length === 0) {
          return 0;
        }
        
        // 计算平均分
        const totalRating = officerFeedbacks.reduce((sum, feedback) => sum + feedback.rating, 0);
        return totalRating / officerFeedbacks.length;
      },

      saveAmapAndLoad() {
        if (!this.persistAmapKeys()) return;
        this.loadAmapScriptForRole("commander");
      },

      saveAmapAndLoadOfficer() {
        if (!this.persistAmapKeys()) return;
        this.loadAmapScriptForRole("officer");
      },

      saveAmapAndLoadGuest() {
        if (!this.persistAmapKeys()) return;
        this.loadAmapScriptForRole("guest");
      },

      persistAmapKeys() {
        this.mapError = "";
        if (!this.amapKey || !this.amapSec) {
          this.mapError = "请填写 Key 与 securityJsCode";
          return false;
        }
        localStorage.setItem(LS_AMAP, JSON.stringify({ key: this.amapKey, sec: this.amapSec }));
        return true;
      },

      loadAmapScriptForRole(role) {
        if (!this.amapKey || !this.amapSec) {
          this.mapError = "请填写 Key 与 securityJsCode";
          return;
        }
        window._AMapSecurityConfig = { securityJsCode: this.amapSec };
        if (typeof AMap !== "undefined") {
          this.$nextTick(() => this.initMapForRole(role));
          return;
        }
        this.mapLoading = true;
        this.mapError = "";
        const s = document.createElement("script");
        s.src = "https://webapi.amap.com/maps?v=2.0&key=" + encodeURIComponent(this.amapKey);
        s.onload = () => {
          this.mapLoading = false;
          this.initMapForRole(role);
        };
        s.onerror = () => {
          this.mapLoading = false;
          this.mapError = "地图脚本加载失败";
        };
        document.head.appendChild(s);
      },

      clearMapOverlays() {
        if (this.mapMarkers && this.mapMarkers.length) {
          this.mapMarkers.forEach((m) => {
            try {
              m.setMap(null);
            } catch {
              /* ignore */
            }
          });
        }
        this.mapMarkers = [];
      },

      // 验证坐标有效性
      _validCoord(lng, lat) {
        return lng != null && lat != null && !isNaN(lng) && !isNaN(lat)
          && isFinite(lng) && isFinite(lat)
          && lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
      },

      makePinContent(color) {
        return (
          '<div style="width:28px;height:28px;border-radius:50%;background:' +
          color +
          ';border:3px solid #fff;box-shadow:0 2px 10px rgba(0,0,0,.35);"></div>'
        );
      },

      initMapForRole(role) {
        this.mapError = "";
        const ids = { commander: "mapRoot", officer: "mapRootOfficer", guest: "mapRootGuest" };
        const elId = ids[role];
        try {
          if (this.mapInstance) {
            try {
              this.mapInstance.destroy();
            } catch {
              /* ignore */
            }
            this.mapInstance = null;
          }
          // 递增地图代数，用于遗弃旧的异步回调
          this.mapGeneration = (this.mapGeneration || 0) + 1;
          this.clearMapOverlays();
          this.mapContext = role;
          this.mapLoaded = true;
          this.$nextTick(() => {
            const el = document.getElementById(elId);
            if (!el) {
              this.mapLoaded = false;
              this.mapError = "地图容器未找到";
              return;
            }
            // 使用默认坐标作为中心点，如果没有设置事发点坐标
            const center = this.dispatch.incidentLng && this.dispatch.incidentLat ? 
              [this.dispatch.incidentLng, this.dispatch.incidentLat] : 
              [DEFAULT_CENTER_LNG, DEFAULT_CENTER_LAT];
            this.mapInstance = new AMap.Map(elId, {
              zoom: role === "commander" ? 13 : 14,
              center,
              viewMode: "3D",
              resizeEnable: true,
              scrollWheel: true,
              doubleClickZoom: true,
              dragEnable: true,
              zoomEnable: true,
              touchZoom: true,
              features: ['bg', 'road', 'building', 'point'],
              layers: [
                new AMap.TileLayer.RoadNet({ opacity: 0.6 }),
                new AMap.TileLayer.Traffic({ autoRefresh: true, interval: 180, opacity: 0.5 })
              ]
            });
            
            // 注入自定义缩放、全屏和刷新按钮（延迟执行，等AMap DOM完全就绪）
            const gen = this.mapGeneration;
            setTimeout(() => {
              if (this.mapGeneration !== gen) return; // 地图已被重建，放弃
              this.injectMapControls(elId);
            }, 200);
            const iw = new AMap.InfoWindow({
              offset: new AMap.Pixel(0, -36),
              anchor: "bottom-center",
            });
            const openInfo = (lng, lat, title, extra, address) => {
              if (address) {
                const coord = lng && lat ? `${lng.toFixed(5)}, ${lat.toFixed(5)}` : "暂无坐标";
                const html = `<div class="amap-iw-inner"><strong>${title}</strong><p class="amap-iw-addr">${address}</p><p class="amap-iw-coord">${coord}</p>${extra || ""}</div>`;
                iw.setContent(html);
                iw.open(this.mapInstance, [lng, lat]);
              } else {
                this.reverseGeocode(lng, lat, (addr) => {
                  const coord = lng && lat ? `${lng.toFixed(5)}, ${lat.toFixed(5)}` : "暂无坐标";
                  const html = `<div class="amap-iw-inner"><strong>${title}</strong><p class="amap-iw-addr">${addr || "地址解析中或受限"}</p><p class="amap-iw-coord">${coord}</p>${extra || ""}</div>`;
                  iw.setContent(html);
                  iw.open(this.mapInstance, [lng, lat]);
                });
              }
            };

            const addM = (lng, lat, title, color, extra, address) => {
              const mk = new AMap.Marker({
                position: [lng, lat],
                title,
                content: this.makePinContent(color),
                offset: new AMap.Pixel(-14, -14),
                anchor: "center",
              });
              mk.on("click", () => openInfo(lng, lat, title, extra, address));
              this.mapInstance.add(mk);
              this.mapMarkers.push(mk);
              return mk;
            };

            if (role === "commander") {
              // 显示事件点
              this.commanderEvents.forEach((event, index) => {
                if (event.lng && event.lat) {
                  addM(
                    event.lng,
                    event.lat,
                    `事件 ${index + 1} · ${event.type}`,
                    "#ef4444",
                    `<p class="amap-iw-note">优先级：${event.priority} · ${event.status}</p>`,
                    event.region
                  );
                }
              });
              
              // 为每个事件从后端获取并显示三层动态围栏
              this.commanderEvents.forEach((event, index) => {
                if (event.lng && event.lat) {
                  this.renderThreeLayerFence(event, index);
                }
              });
              
              // 只在有事发点坐标时添加参考点标记（学习中，暂时注释）
              // if (this.dispatch.incidentLng && this.dispatch.incidentLat) {
              //   addM(
              //     this.dispatch.incidentLng,
              //     this.dispatch.incidentLat,
              //     "事发参考点",
              //     "#f97316",
              //     "<p class=\"amap-iw-note\">可拖动调度参数后重新加载地图</p>"
              //   );
              // }
              
              // 显示警力位置（带sessionId，支持位置实时更新）
              this.dispatch.units.forEach((unit, index) => {
                if (unit.lng && unit.lat && unit.available) {
                  const mk = addM(
                    unit.lng,
                    unit.lat,
                    `警力 ${index + 1} · ${unit.name || unit.unitId}`,
                    "#22c55e",
                    `<p class=\"amap-iw-note\">${unit.policeType || '警员'} · ${unit.transportMode || '步行'}</p>`
                  );
                  if (mk && unit.sessionId) {
                    mk._officerSessionId = unit.sessionId;
                  }
                }
              });
            } else if (role === "officer") {
              this.officerOrders.forEach((o) => {
                addM(o.lng, o.lat, "指挥任务 · " + o.title, "#ef4444", "<p class=\"amap-iw-note\">" + o.place + "</p>");
              });
              this.nearbyIncidents.forEach((n) => {
                addM(n.lng, n.lat, "附近 · " + n.type, "#f59e0b", "<p class=\"amap-iw-note\">" + n.brief + "</p>");
              });
              this.volunteerIncidents.forEach((v) => {
                addM(v.lng, v.lat, "可援助 · " + v.type, "#3b82f6", "<p class=\"amap-iw-note\">" + v.brief + "</p>");
              });
              if (this.officerLng != null && this.officerLat != null) {
                addM(this.officerLng, this.officerLat, "我的位置", "#22c55e", "<p class=\"amap-iw-note\">执勤定位</p>");
                // 为每个指挥任务规划并显示路线
                if (this.officerOrders.length > 0) {
                  this.renderOfficerRoutes();
                }
              }
            } else if (role === "guest") {
              this.publicEvents.forEach((p) => {
                const lng = p.lng;
                const lat = p.lat;
                const title = "公示 · " + p.title;
                const mk = new AMap.Marker({
                  position: [lng, lat],
                  title,
                  content: this.makePinContent("#14b8a6"),
                  offset: new AMap.Pixel(-14, -14),
                  anchor: "center",
                });
                mk.on("click", () => {
                  this.selectedPublicEvent = p;
                  openInfo(lng, lat, title, "<p class=\"amap-iw-note\">" + p.area + " · " + p.time + "</p>");
                });
                this.mapInstance.add(mk);
                this.mapMarkers.push(mk);
              });
            }

            if (this.mapMarkers.length) {
              try {
                this.mapInstance.setFitView(this.mapMarkers, false, [48, 48, 48, 48], 16);
              } catch {
                this.mapInstance.setZoomAndCenter(14, center);
              }
            }
          });
        } catch (e) {
          this.mapLoaded = false;
          this.mapError = e.message || String(e);
        }
      },

      // 警员端：在地图上渲染到各任务点的路线
      renderOfficerRoutes() {
        if (!this.mapInstance || !this.officerLng || !this.officerLat) return;
        if (this.officerOrders.length === 0) return;

        const myPos = [this.officerLng, this.officerLat];
        const colors = ['#ef4444', '#f59e0b', '#3b82f6', '#8b5cf6', '#10b981'];

        // 先用直线预估（fallback始终显示）
        this.officerOrders.forEach((order, i) => {
          if (!order.lng || !order.lat) return;
          const color = colors[i % colors.length];
          const distKm = this.haversineKm(this.officerLat, this.officerLng, order.lat, order.lng);
          const safeDist = (distKm != null && isFinite(distKm)) ? distKm : 0;
          const estMin = Math.round(safeDist / 30 * 60); // 假设30km/h城市道路

          // 绘制虚线预估路线（底层）
          const dashLine = new AMap.Polyline({
            path: [myPos, [order.lng, order.lat]],
            strokeColor: color,
            strokeWeight: 2,
            strokeOpacity: 0.35,
            strokeStyle: 'dashed',
            strokeDasharray: [8, 6],
            zIndex: 45
          });
          dashLine.setMap(this.mapInstance);
          this.mapMarkers.push(dashLine);

          // 中点标签
          const midLng = (this.officerLng + order.lng) / 2;
          const midLat = (this.officerLat + order.lat) / 2;
          const label = new AMap.Text({
            position: [midLng, midLat],
            text: `~${safeDist.toFixed(1)}km ${estMin}min`,
            style: {
              'background-color': color,
              'color': '#fff',
              'font-size': '11px',
              'padding': '3px 8px',
              'border-radius': '4px',
              'border': '1px solid rgba(255,255,255,0.3)',
              'box-shadow': '0 2px 6px rgba(0,0,0,0.3)'
            },
            offset: new AMap.Pixel(-30, -12),
            zIndex: 55
          });
          label.setMap(this.mapInstance);
          this.mapMarkers.push(label);
        });

        // 尝试用高德Driving API规划精确路线
        AMap.plugin(['AMap.Driving'], () => {
          this.officerOrders.forEach((order, i) => {
            if (!order.lng || !order.lat) return;
            const color = colors[i % colors.length];

            const driving = new AMap.Driving({
              map: null,
              policy: AMap.DrivingPolicy.LEAST_TIME
            });

            driving.search(
              new AMap.LngLat(this.officerLng, this.officerLat),
              new AMap.LngLat(order.lng, order.lat),
              { extensions: 'all' },
              (status, result) => {
                if (status === 'complete' && result.routes && result.routes[0]) {
                  const route = result.routes[0];
                  if (DEBUG) console.log('[Driving]', Object.keys(route).join(','));

                  // 安全获取距离（米→公里）
                  const rawDist = Number(route.distance ?? 0);
                  const distKm = (isFinite(rawDist) ? rawDist / 1000 : 0).toFixed(2);

                  // 安全获取时长：尝试所有可能的字段名，兼容不同API版本
                  const rawDur = Number(
                    route.duration ?? route.time ?? route.totalTime
                    ?? route.cost?.duration ?? route.summary?.duration
                    ?? route.cost?.time ?? 0
                  );
                  const durMin = (isFinite(rawDur) && rawDur > 0) ? Math.round(rawDur / 60) : null;

                  const steps = route.steps || [];
                  const routePath = [];
                  steps.forEach(step => {
                    if (step.path) step.path.forEach(p => routePath.push([p.lng, p.lat]));
                  });

                  if (routePath.length > 0) {
                    // 实线覆盖虚线预估
                    const polyline = new AMap.Polyline({
                      path: routePath,
                      strokeColor: color,
                      strokeWeight: 5,
                      strokeOpacity: 0.85,
                      strokeStyle: 'solid',
                      lineJoin: 'round',
                      lineCap: 'round',
                      zIndex: 50,
                      showDir: true
                    });
                    polyline.setMap(this.mapInstance);
                    this.mapMarkers.push(polyline);

                    // 构建安全标签文本
                    const distText = (isFinite(rawDist) && rawDist > 0) ? distKm + 'km' : '';
                    const durText = durMin != null ? durMin + '分钟' : '--';
                    const labelText = [distText, durText].filter(Boolean).join(' ');

                    // 更新中点的精确标签
                    const midIdx = Math.floor(routePath.length / 2);
                    if (routePath[midIdx]) {
                      const preciseLabel = new AMap.Text({
                        position: routePath[midIdx],
                        text: labelText,
                        style: {
                          'background-color': color,
                          'color': '#fff',
                          'font-size': '12px',
                          'font-weight': '600',
                          'padding': '4px 10px',
                          'border-radius': '4px',
                          'border': '2px solid rgba(255,255,255,0.5)',
                          'box-shadow': '0 2px 8px rgba(0,0,0,0.4)'
                        },
                        offset: new AMap.Pixel(-35, -20),
                        zIndex: 56
                      });
                      preciseLabel.setMap(this.mapInstance);
                      this.mapMarkers.push(preciseLabel);
                    }
                  }
                }
              }
            );
          });
        });
      },

      // Haversine 距离计算（公里）
      haversineKm(lat1, lng1, lat2, lng2) {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      },

      destroyMap() {
        this.clearMapOverlays();
        if (this.mapInstance) {
          try {
            this.mapInstance.destroy();
          } catch {
            /* ignore */
          }
          this.mapInstance = null;
        }
        this.mapLoaded = false;
        this.mapContext = "";
      },

      // 在地图容器上注入自定义缩放和全屏按钮
      injectMapControls(elId) {
        const mapEl = document.getElementById(elId);
        if (!mapEl || !this.mapInstance) return;

        // 注入到 .map-shell 父容器上（不在 .map-root-el 里，避免被高德 canvas 遮挡）
        const shell = mapEl.closest(".map-shell");
        if (!shell) return;

        // 移除旧控件（避免重复注入）
        const old = shell.querySelector(".map-custom-controls");
        if (old) old.remove();

        // 创建控件容器
        const ctrl = document.createElement("div");
        ctrl.className = "map-custom-controls";
        ctrl.innerHTML = `
          <button class="mc-btn" title="放大" data-action="zoomin">+</button>
          <button class="mc-btn" title="缩小" data-action="zoomout">−</button>
          <button class="mc-btn mc-btn--full" title="全屏" data-action="fullscreen">⛶</button>
          <button class="mc-btn mc-btn--refresh" title="刷新地图" data-action="refresh">↻</button>
        `;
        shell.appendChild(ctrl);

        // 事件委托
        ctrl.addEventListener("click", (e) => {
          const btn = e.target.closest("[data-action]");
          if (!btn) return;
          const action = btn.getAttribute("data-action");
          if (action === "zoomin") {
            const z = this.mapInstance.getZoom();
            this.mapInstance.setZoom(Math.min(z + 1, 19));
          } else if (action === "zoomout") {
            const z = this.mapInstance.getZoom();
            this.mapInstance.setZoom(Math.max(z - 1, 3));
          } else if (action === "fullscreen") {
            this.toggleMapFullscreen(elId);
          } else if (action === "refresh") {
            this.initMapForRole(this.mapContext);
          }
        });

        // 移除旧的全屏监听器（避免重复绑定）
        if (shell._fsHandler) {
          shell.removeEventListener("fullscreenchange", shell._fsHandler);
          shell.removeEventListener("webkitfullscreenchange", shell._fsHandler);
        }
        // 监听全屏变化来更新按钮图标 + 重绘地图
        const onFsChange = () => {
          const btn = ctrl.querySelector("[data-action='fullscreen']");
          if (btn) {
            btn.textContent = document.fullscreenElement ? "✕" : "⛶";
            btn.title = document.fullscreenElement ? "退出全屏" : "全屏";
          }
          [100, 300, 600].forEach(ms => {
            setTimeout(() => {
              if (this.mapInstance) {
                this.mapInstance.resize();
              }
            }, ms);
          });
        };
        shell._fsHandler = onFsChange;
        shell.addEventListener("fullscreenchange", onFsChange);
        shell.addEventListener("webkitfullscreenchange", onFsChange);
      },

      toggleMapFullscreen(elId) {
        const el = document.getElementById(elId).closest(".map-shell") || document.getElementById(elId);
        if (!el) return;
        if (!document.fullscreenElement) {
          if (el.requestFullscreen) {
            el.requestFullscreen();
          } else if (el.webkitRequestFullscreen) {
            el.webkitRequestFullscreen();
          }
        } else {
          if (document.exitFullscreen) {
            document.exitFullscreen();
          } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
          }
        }
      },
      
      // 处理位置更新消息
      handleLocationUpdate(sessionId, lng, lat) {
        const officer = this.connectedOfficers.find(officer => officer.sessionId === sessionId);
        if (officer) {
          officer.lng = lng;
          officer.lat = lat;

          // 同时更新dispatch.units数组中的警力位置
          const unitIndex = this.dispatch.units.findIndex(unit => unit.unitId === officer.unitId);
          if (unitIndex !== -1) {
            this.dispatch.units[unitIndex].lng = lng;
            this.dispatch.units[unitIndex].lat = lat;
          }

          // BugFix: 仅增量更新标记位置，不销毁重建整个地图
          if (this.mapLoaded && this.mapContext === "commander" && this.mapInstance) {
            this.updateOfficerMarker(sessionId, lng, lat, officer.name || officer.unitId);
          }
        }
      },

      // 增量更新警员地图标记，避免销毁重建地图
      updateOfficerMarker(sessionId, lng, lat, label) {
        if (!this.mapInstance) return;

        // 检查标记是否已存在
        const existingMarker = this.mapMarkers.find(m => m._officerSessionId === sessionId);
        if (existingMarker) {
          // 移动已有标记
          existingMarker.setPosition([lng, lat]);
        } else {
          // 创建新标记（首次出现）
          const marker = new AMap.Marker({
            position: [lng, lat],
            title: label,
            icon: new AMap.Icon({
              size: new AMap.Size(24, 24),
              image: 'https://webapi.amap.com/theme/v1.3/markers/n/mark_b' + (this.mapMarkers.filter(m => m._officerSessionId).length + 1) + '.png',
              imageSize: new AMap.Size(24, 24)
            }),
            offset: new AMap.Pixel(-12, -12)
          });
          marker._officerSessionId = sessionId;
          marker.setMap(this.mapInstance);
          this.mapMarkers.push(marker);
        }
      },
    },
  }).mount("#app");
})();
