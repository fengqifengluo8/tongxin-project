(function () {
  const { createApp } = Vue;

  const LS_USERS = "pcmp_users_v2";
  const LS_USERS_LEGACY = "pcmp_users_v1";
  const LS_SESSION = "pcmp_session_v2";
  const LS_AMAP = "pcmp_amap_keys";
  const LS_GUEST_INTRO = "pcmp_guest_intro_seen";

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
    localStorage.setItem(LS_USERS, JSON.stringify(map));
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
          } else if (this.dispatchResult.selectedUnit) {
            // Old format fallback
            const unit = this.dispatchResult.selectedUnit;
            let result = `调度结果：\n`;
            result += `选中警力：${unit.name} (${unit.unitId})\n`;
            result += `消息：${this.dispatchResult.message || ''}`;
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
            // 只有在localStorage中没有数据时才加载默认事件
            if (this.commanderEvents.length === 0) {
              this.loadCommanderEvents();
            }
          }
          // 公众端登录后加载公示事件
          if (this.isLoggedIn && this.userRole === "guest") {
            this.loadPublicEvents();
          }
          // 警员登录后自动连接WebSocket
          if (this.isLoggedIn && this.userRole === "officer") {
            this.toggleWs();
          }
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
        }
      },

    methods: {
      loadCommanderEvents() {
        this.eventsLoading = true;
        
        // 保存当前的安全隐患事件
        const safetyEvents = this.commanderEvents.filter(event => event.type === "安全隐患");
        
        fetch("/api/commander/events")
          .then(response => response.json())
          .then(data => {
            if (data.code === 200 && data.data) {
              let events = data.data.map((event, index) => ({
                id: event.id ? "E-" + String(event.id).padStart(4, "0") : "E-0000",
                type: event.type || "未知类型",
                priority: this.getPriorityLevel(event.type),
                status: event.status || "待处理",
                region: event.address || "未知区域",
                // 如果事件有坐标就用真实坐标，否则用确定性偏移（基于索引而非随机）
                lng: event.lng || (114.305558 + (index * 0.003 - 0.003)),
                lat: event.lat || (30.592759 + (index * 0.002 - 0.002))
              }));
              // 过滤掉已完成的事件
              events = events.filter(event => !this.completedEventIds.includes(event.id));
              // 合并安全隐患事件，确保不重复
              const existingEventIds = new Set(events.map(event => event.id));
              const newSafetyEvents = safetyEvents.filter(event => !existingEventIds.has(event.id));
              events = [...events, ...newSafetyEvents];
              this.commanderEvents = events;
              
              // 刷新地图以显示新事件
              if (this.mapLoaded && this.mapContext === "commander") {
                this.initMapForRole("commander");
              }
            }
          })
          .catch(() => {
            // 使用默认数据
            let events = [
              { id: "E-1042", type: "交通事故", priority: "高", status: "处置中", region: "城东片区", lng: 116.404, lat: 39.915 },
              { id: "E-1043", type: "群体活动", priority: "中", status: "监控中", region: "文化广场", lng: 116.398, lat: 39.910 },
              { id: "E-1044", type: "设施报修", priority: "低", status: "待分派", region: "地铁沿线", lng: 116.390, lat: 39.905 },
            ];
            // 过滤掉已完成的事件
            events = events.filter(event => !this.completedEventIds.includes(event.id));
            // 合并安全隐患事件，确保不重复
            const existingEventIds = new Set(events.map(event => event.id));
            const newSafetyEvents = safetyEvents.filter(event => !existingEventIds.has(event.id));
            events = [...events, ...newSafetyEvents];
            this.commanderEvents = events;
            
            // 刷新地图以显示新事件
            if (this.mapLoaded && this.mapContext === "commander") {
              this.initMapForRole("commander");
            }
          })
          .finally(() => {
            this.eventsLoading = false;
          });
      },

      loadPublicEvents() {
        fetch("/api/guest/public/event")
          .then(response => response.json())
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
            // 保持localStorage中的事件数据
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
        localStorage.setItem(
          LS_SESSION,
          JSON.stringify({ username: name, role: "guest", at: Date.now() })
        );
        this.userRole = "guest";
        this.isLoggedIn = true;
        this.authStage = "hub";
        document.body.style.overflow = "";
        const seen = localStorage.getItem(LS_GUEST_INTRO);
        this.showGuestIntro = !seen;
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
        localStorage.setItem(
          LS_SESSION,
          JSON.stringify({ username: name, role: "guest", at: Date.now() })
        );
        this.userRole = "guest";
        this.isLoggedIn = true;
        this.authStage = "hub";
        document.body.style.overflow = "";
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
        .then(response => response.json())
        .then(data => {
          if (data.code === 200) {
            localStorage.setItem(
              LS_SESSION,
              JSON.stringify({ username: u, role: this.pendingRole, at: Date.now() })
            );
            this.userRole = this.pendingRole;
            this.isLoggedIn = true;
            this.authStage = "hub";
            document.body.style.overflow = "";
          } else {
            this.authError = data.msg || "操作失败";
          }
        })
        .catch(() => {
          this.authError = "网络错误，请稍后重试";
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
            best = u;
            best.distance = distance;
            best.estimatedTime = time;
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
        alert("已上报指挥端：警员请求援助事件 " + id + "（演示）");
      },

      submitOfficerReport() {
        if (!(this.reportDraft.text || "").trim()) {
          alert("请填写事件说明");
          return;
        }
        let loc = "";
        if (this.reportDraft.useLocation && this.officerLng != null && this.officerLat != null) {
          loc = "\n位置：" + this.officerLng + ", " + this.officerLat + (this.officerAddress ? "\n" + this.officerAddress : "");
        } else if (this.reportDraft.useLocation) {
          alert("请先点击「先获取当前位置」授权定位，或取消勾选附加位置。");
          return;
        }

        const data = {
          type: this.reportDraft.type,
          text: this.reportDraft.text,
          priority: this.reportDraft.priority,
          useLocation: this.reportDraft.useLocation,
          lng: this.officerLng,
          lat: this.officerLat,
          address: this.officerAddress
        };

        fetch("/api/officer/report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data)
        })
        .then(response => response.json())
        .then(data => {
          if (data.code === 200) {
            alert("事件已上报至指挥端待审核。\n类型：" + this.reportDraft.type + "\n优先级：" + this.reportDraft.priority + loc);
            this.reportDraft.text = "";
            // 刷新地图以显示新上报的事件
            if (this.mapLoaded && this.mapContext === "officer") {
              this.initMapForRole("officer");
            }
            // 通知指挥端有新事件上报
            if (this.canSendWs) {
              const env = {
                type: "EVENT_REPORTED",
                event: {
                  type: this.reportDraft.type,
                  priority: this.reportDraft.priority,
                  text: this.reportDraft.text,
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
            alert("上报失败：" + (data.msg || "未知错误"));
          }
        })
        .catch(() => {
          alert("事件已上报至指挥端待审核（演示）。\n类型：" + this.reportDraft.type + "\n优先级：" + this.reportDraft.priority + loc);
          this.reportDraft.text = "";
          // 刷新地图以显示新上报的事件
          if (this.mapLoaded && this.mapContext === "officer") {
            this.initMapForRole("officer");
          }
        });
      },

      submitGuestFeedback() {
        if (!(this.guestFeedback.text || "").trim()) {
          alert("请填写简要说明");
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
          alert("WebSocket未连接，请先连接后再上报");
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
          alert("请选择事件并给出评分");
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
        
        alert("感谢您的反馈！");
        
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
              lng: location ? location.lng : 114.305558 + (Math.random() * 0.02 - 0.01),
              lat: location ? location.lat : 30.592759 + (Math.random() * 0.02 - 0.01)
            };
            
            this.commanderEvents.unshift(newEvent);
            
            // 从安全隐患列表中移除
            this.safetyReports.splice(index, 1);
            
            alert("安全隐患已审核通过，已转为低优先级事件");
            
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
        alert("安全隐患已审核拒绝");
      },

      getCurrentLocation() {
        if (!navigator.geolocation) {
          alert("当前浏览器不支持定位");
          return;
        }
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const lng = +pos.coords.longitude.toFixed(6);
            const lat = +pos.coords.latitude.toFixed(6);
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
                const locationData = {
                  type: "LOCATION_UPDATE",
                  lng: lng,
                  lat: lat
                };
                this.ws.send(JSON.stringify(locationData));
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
          () => {
            this.incidentAddress = "";
            this.officerAddress = "";
            alert("定位失败，请检查权限或 HTTPS 环境");
          },
          { enableHighAccuracy: true, timeout: 15000 }
        );
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
          lng: last ? last.lng : 116.4,
          lat: last ? last.lat : 39.91,
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
        this.dispatch.fenceVertices = [
          { lng: 116.39, lat: 39.905 },
          { lng: 116.405, lat: 39.905 },
          { lng: 116.405, lat: 39.915 },
          { lng: 116.39, lat: 39.915 },
        ];
      },

      // 从后端API获取三层围栏并渲染
      async renderThreeLayerFence(event, index) {
        // 捕获当前地图代数，防止异步回调使用已销毁的地图
        const gen = this.mapGeneration || 0;
        try {
          const url = `/api/fence/dynamic-polygon?lng=${event.lng}&lat=${event.lat}`;
          const res = await fetch(url);
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
          
          console.log(`[三层围栏] 事件${index+1} "${event.type}" 已渲染 ${data.layers.length} 层围栏`, 
            data.factorDetails || {});
          
        } catch (e) {
          console.warn('[三层围栏] API调用失败，使用本地fallback', e);
          this.renderFallbackFence(event, index);
        }
      },
      
      // 本地fallback围栏（API不可用时使用，同样生成三层）
      renderFallbackFence(event, index) {
        // 地图已销毁，不渲染
        if (!this.mapInstance) return;
        // 生成路网数据并构建三层围栏
        const roadNetwork = this.generateRealisticRoadNetwork(event.lng, event.lat);
        const filteredPoints = this.detectOutliers(roadNetwork, { lng: event.lng, lat: event.lat });
        
        // 三层时间阈值（分钟）
        const layerTimes = [
          { time: 5,  fillColor: '#ef4444', strokeColor: '#dc2626', fillOpacity: 0.45, strokeWidth: 3, name: '核心圈' },
          { time: 12, fillColor: '#f59e0b', strokeColor: '#d97706', fillOpacity: 0.35, strokeWidth: 2, name: '缓冲圈' },
          { time: 25, fillColor: '#3b82f6', strokeColor: '#2563eb', fillOpacity: 0.25, strokeWidth: 2, name: '扩展圈' }
        ];
        
        layerTimes.forEach((config, li) => {
          let fence = this.generateIsochrones(filteredPoints, { lng: event.lng, lat: event.lat }, config.time);
          
          if (!fence || fence.length < 3) {
            // 默认正十二边形
            const radius = 0.01 + li * 0.015;
            fence = [];
            for (let i = 0; i < 12; i++) {
              const angle = (Math.PI * 2 * i) / 12;
              fence.push({
                lng: event.lng + Math.cos(angle) * radius,
                lat: event.lat + Math.sin(angle) * radius
              });
            }
          }
          
          // 闭合
          const first = fence[0];
          const last = fence[fence.length - 1];
          if (first.lng !== last.lng || first.lat !== last.lat) {
            fence.push({ ...first });
          }
          
          const fencePath = fence.map(v => [v.lng, v.lat]);
          const polygon = new AMap.Polygon({
            path: fencePath,
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
        this.dispatch.incidentLng = 114.305558;
        this.dispatch.incidentLat = 30.592759;
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
          const res = await fetch("/api/dispatch/nearest", {
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
            this.dispatchError = typeof data === "string" ? data : data.detail || JSON.stringify(data);
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
        const proto = location.protocol === "https:" ? "wss:" : "ws:";
        return proto + "//" + location.host + "/ws/command";
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
          this.pushWsLog("in", "[open] " + this.wsUrl());
          // 警员端连接成功后自动发送连接请求
          if (this.userRole === "officer") {
            setTimeout(() => {
              this.sendConnectionRequest();
            }, 500);
          }
        };
        socket.onclose = (ev) => {
          this.wsConnecting = false;
          this.wsReadyState = 3;
          this.pushWsLog("in", "[close] code=" + ev.code);
          if (this.ws === socket) this.ws = null;
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
              // 指挥端接收到连接请求
              if (this.userRole === "commander") {
                console.log('Received CONNECTION_REQUEST:', json);
                this.connectionRequests.push({
                  sessionId: json.sessionId,
                  role: json.role,
                  unitId: json.unitId,
                  name: json.name
                });
                console.log('Updated connectionRequests:', this.connectionRequests);
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
                console.log('Received CONNECT_RESPONSE_BROADCAST:', json);
                console.log('Current connectionRequests:', this.connectionRequests);
                // 从连接请求列表中移除已处理的请求
                this.connectionRequests = this.connectionRequests.filter(req => {
                  console.log('Comparing req.sessionId:', req.sessionId, 'with json.targetSessionId:', json.targetSessionId);
                  return req.sessionId !== json.targetSessionId;
                });
                console.log('Updated connectionRequests:', this.connectionRequests);
                // 清空当前连接状态
                this.pendingConnection = null;
              }
            } else if (json.type === "CONNECTED_OFFICERS") {
              // 指挥端接收到已连接警员列表
              if (this.userRole === "commander") {
                // 确保officers是一个对象
                const officers = json.officers || {};
                // 将对象转换为数组
                this.connectedOfficers = Object.values(officers);
                // 更新警力列表
                this.dispatch.units = this.connectedOfficers.map((officer, index) => ({
                  unitId: officer.unitId,
                  name: officer.name,
                  available: true,
                  status: officer.status || '执勤中',
                  transportMode: officer.transportMode || '步行',
                  lng: officer.lng || 114.305558 + (index * 0.001),
                  lat: officer.lat || 30.592759 + (index * 0.001)
                }));
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
                  status: officer.status || '执勤中',
                  transportMode: officer.transportMode || '步行',
                  lng: officer.lng || 114.305558 + (index * 0.001),
                  lat: officer.lat || 30.592759 + (index * 0.001)
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
                  console.log('任务完成 - 事件ID:', eventId, '移除前数量:', beforeCount, '移除后数量:', afterCount);
                  console.log('当前事件列表:', this.commanderEvents.map(e => e.id));
                  
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
                  console.log('指挥端接收到任务完成通知，已添加到已完成事件列表:', completedEvent);
                }
              } else if (this.userRole === "guest") {
                // 公众端接收到任务完成通知
                const completedEvent = json.completedEvent;
                if (completedEvent) {
                  // 添加到已完成事件列表
                  this.completedEvents.push(completedEvent);
                  console.log('公众端接收到任务完成通知，已添加到已完成事件列表:', completedEvent);
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
                  this.officerOrders.push(order);
                  this.pushWsLog('in', '收到指挥中心指令: ' + order.title);
                  // 如果地图已加载，重新初始化地图以显示新的红点
                  if (this.mapLoaded && this.mapContext === "officer") {
                    this.initMapForRole("officer");
                  }
                  
                  // 显示路线规划弹窗
                  if (this.officerLng && this.officerLat) {
                    this.showRoutePlan(order.title, order.address || order.place, order.lng, order.lat);
                  } else {
                    alert("请先获取当前位置，以便规划路线");
                  }
                }
              }
            }
          } catch (e) {
            // 忽略解析错误
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
      showRoutePlan(taskTitle, taskAddress, taskLng, taskLat) {
        // 移除之前的弹窗（如果有）
        const existingModal = document.getElementById('route-modal');
        if (existingModal) document.body.removeChild(existingModal);
        const existingOverlay = document.getElementById('route-overlay');
        if (existingOverlay) document.body.removeChild(existingOverlay);
        
        const uid = Date.now();
        
        // 创建遮罩
        const overlay = document.createElement('div');
        overlay.id = 'route-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9999;';
        overlay.onclick = () => {
          document.body.removeChild(document.getElementById('route-modal'));
          document.body.removeChild(overlay);
        };
        document.body.appendChild(overlay);
        
        // 创建弹窗
        const modal = document.createElement('div');
        modal.id = 'route-modal';
        modal.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:85%;max-width:900px;height:650px;background:white;border-radius:10px;box-shadow:0 4px 30px rgba(0,0,0,0.3);z-index:10000;padding:20px;display:flex;flex-direction:column;';
        
        // 标题栏
        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;';
        header.innerHTML = `
          <div>
            <h3 style="margin:0;font-size:16px;color:#1e293b;">任务路线规划: ${taskTitle}</h3>
            <p style="margin:4px 0 0;font-size:13px;color:#64748b;">任务地点: ${taskAddress || '未知'}</p>
          </div>
          <button id="route-close-btn-${uid}" style="padding:6px 14px;background:#3b82f6;color:white;border:none;border-radius:6px;cursor:pointer;font-size:13px;">关闭</button>
        `;
        modal.appendChild(header);
        
        // 路线信息面板（预创建）
        const infoPanel = document.createElement('div');
        infoPanel.id = `route-info-${uid}`;
        infoPanel.style.cssText = 'padding:12px;background:#f8fafc;border-radius:6px;margin-bottom:12px;font-size:14px;color:#333;min-height:48px;display:flex;align-items:center;';
        infoPanel.innerHTML = '<div style="display:flex;align-items:center;gap:8px;"><span style="display:inline-block;width:16px;height:16px;border:2px solid #3b82f6;border-top-color:transparent;border-radius:50%;animation:spin 1s linear infinite;"></span><span style="color:#64748b;">正在基于实时路况计算最优路线...</span></div>';
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
          if (infoPanel) infoPanel.innerHTML = '<p style="margin:0;color:#ef4444;">请先配置高德地图API密钥</p>';
          return;
        }
        
        // 等待DOM元素创建完成
        setTimeout(() => {
          const mapContainer = document.getElementById(`route-map-${uid}`);
          if (!mapContainer) return;
          
          const infoPanel = document.getElementById(`route-info-${uid}`);
          
          const myLng = this.officerLng;
          const myLat = this.officerLat;
          
          // 如果没有警员位置，无法规划路线
          if (myLng == null || myLat == null) {
            if (infoPanel) infoPanel.innerHTML = '<p style="margin:0;color:#ef4444;">请先获取当前位置（点击"获取位置"按钮）</p>';
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
          
          // 添加起点和终点标记
          new AMap.Marker({
            position: [myLng, myLat],
            map: map,
            title: '我的位置',
            label: { content: '起点', offset: new AMap.Pixel(0, -20) }
          });
          
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
                  const distance = (route.distance / 1000).toFixed(2); // km
                  const durationMin = Math.round(route.duration / 60); // 分钟
                  
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
                        <div style="background:#eff6ff;padding:8px 14px;border-radius:6px;border-left:3px solid #3b82f6;flex-shrink:0;">
                          <span style="color:#64748b;font-size:12px;">路线距离</span>
                          <strong style="font-size:20px;color:#1e40af;margin-left:4px;">${distance}</strong>
                          <span style="color:#64748b;font-size:12px;">km</span>
                        </div>
                        <div style="background:#fef3c7;padding:8px 14px;border-radius:6px;border-left:3px solid #f59e0b;flex-shrink:0;">
                          <span style="color:#64748b;font-size:12px;">预估时间</span>
                          <strong style="font-size:20px;color:#b45309;margin-left:4px;">${durationMin}</strong>
                          <span style="color:#64748b;font-size:12px;">分钟</span>
                        </div>
                        <div style="background:#fef2f2;padding:8px 14px;border-radius:6px;border-left:3px solid #ef4444;flex-shrink:0;">
                          <span style="color:#64748b;font-size:12px;">预计到达</span>
                          <strong style="font-size:18px;color:#dc2626;margin-left:4px;">${etaStr}</strong>
                        </div>
                        <div style="padding:8px 14px;border-radius:6px;border-left:3px solid ${trafficColor};background:#f0fdf4;flex-shrink:0;">
                          <span style="color:#64748b;font-size:12px;">实时路况</span>
                          <strong style="font-size:16px;color:${trafficColor};margin-left:4px;">${overallTraffic}</strong>
                        </div>
                        ${trafficLightCount > 0 ? `
                        <div style="background:#faf5ff;padding:8px 14px;border-radius:6px;border-left:3px solid #a855f7;flex-shrink:0;">
                          <span style="color:#64748b;font-size:12px;">红绿灯</span>
                          <strong style="font-size:16px;color:#7c3aed;margin-left:4px;">${trafficLightCount}</strong>
                          <span style="color:#64748b;font-size:12px;">个</span>
                        </div>` : ''}
                      </div>
                    `;
                  }
                  
                  console.log(`[路线规划] 距离:${distance}km 时间:${durationMin}分钟 路况:${overallTraffic} 红绿灯:${trafficLightCount} 拥堵:${(jamDistance/1000).toFixed(1)}km`);
                } else {
                  console.error('路线规划失败', result);
                  if (infoPanel) {
                    infoPanel.innerHTML = '<p style="margin:0;color:#ef4444;">路线规划失败，可能原因：API密钥未配置、网络异常或位置信息无效</p>';
                  }
                  
                  // Fallback: 使用直线距离估算
                  const dx = (taskLng - myLng) * 111000 * Math.cos(myLat * Math.PI / 180);
                  const dy = (taskLat - myLat) * 111000;
                  const straightDist = Math.sqrt(dx * dx + dy * dy) / 1000;
                  const estTime = Math.round(straightDist / 30 * 60); // 假设30km/h
                  
                  if (infoPanel && straightDist > 0) {
                    infoPanel.innerHTML += `
                      <div style="margin-top:8px;padding:8px;background:#fff3cd;border-radius:4px;font-size:12px;">
                        <strong>估算参考:</strong> 直线距离约 ${straightDist.toFixed(1)}km，预估 ${estTime} 分钟（不含路况）
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
        const env = {
          type: this.wsForm.type || "MESSAGE",
          payloadPlain: this.wsForm.payloadPlain || "",
          role: this.userRole
        };
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
          alert('WebSocket未连接，请先连接');
          return;
        }
        if (!this.currentChatTarget) {
          alert('请先选择要下达指令的警员');
          return;
        }
        
        const order = {
          id: 'T-' + Math.floor(Math.random() * 10000).toString().padStart(4, '0'),
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
          officerName: this.currentChatTarget.name,
          officerId: this.currentChatTarget.unitId
        };
        
        const env = {
          type: 'COMMAND',
          targetSessionId: this.currentChatTarget.sessionId,
          order: order
        };
        
        const raw = JSON.stringify(env);
        this.ws.send(raw);
        this.pushWsLog('out', '已向' + this.currentChatTarget.name + '下达指令');
        alert('指令已下达');
      },

      autoAssignEvents() {
        if (!this.canSendWs) {
          alert('WebSocket未连接，请先连接');
          return;
        }
        
        // 先执行计算调度，更新调度结果
        this.runDispatch();
        
        // 筛选空闲警员（执勤中状态）
        const availableOfficers = this.connectedOfficers.filter(officer => officer.status === '执勤中');
        if (availableOfficers.length === 0) {
          alert('没有可用的空闲警员');
          return;
        }
        
        // 将警员信息转换为警力单位格式，用于距离计算
        const units = availableOfficers.map((officer, index) => ({
          unitId: officer.unitId,
          name: officer.name,
          available: true,
          status: officer.status,
          transportMode: officer.transportMode || '步行',
          lng: 114.305558 + (index * 0.001),
          lat: 30.592759 + (index * 0.001),
          sessionId: officer.sessionId
        }));
        
        // 为每个未分配的事件找到最近的警力
        let assignedCount = 0;
        const assignedEventIds = [];
        this.commanderEvents.forEach(event => {
          if (event.status === 'pending') {
            // 使用事件真实坐标作为事发点
            const incident = {
              lng: event.lng,
              lat: event.lat
            };
            
            // 使用围栏算法计算最近警力
            const nearestDispatch = this.computeNearestDispatch({
              incident: incident,
              fence: this.dispatch.fenceVertices,
              units: units
            });
            
            if (nearestDispatch && nearestDispatch.selectedUnit) {
              // 找到对应的警员
              const selectedUnit = nearestDispatch.selectedUnit;
              const officer = units.find(u => u.unitId === selectedUnit.unitId);
              
              if (officer) {
                const order = {
                  id: 'T-' + Math.floor(Math.random() * 10000).toString().padStart(4, '0'),
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
                this.ws.send(raw);
                
                let dispatchInfo = `已自动向${officer.name}下达指令：${event.type}处置`;
                if (nearestDispatch.distanceApprox) {
                  dispatchInfo += ` (距离：${nearestDispatch.distanceApprox.toFixed(2)}公里`;
                  if (nearestDispatch.estimatedTime) {
                    dispatchInfo += `，预计${nearestDispatch.estimatedTime.toFixed(2)}分钟到达`;
                  }
                  dispatchInfo += `)`;
                }
                this.pushWsLog('out', dispatchInfo);
                assignedCount++;
                assignedEventIds.push(event.id);
              }
            }
          }
        });
        
        if (assignedCount > 0) {
          alert(`已自动分配${assignedCount}个事件给空闲警员`);
          
          // 重新加载地图以显示最新状态
          if (this.mapLoaded && this.mapContext === "commander") {
            this.initMapForRole("commander");
          }
        } else {
          alert('没有待分配的事件');
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
          
          // 确保事件ID的唯一性
          let eventId = order.eventId;
          if (!eventId) {
            // 生成新的唯一事件ID
            let newId;
            do {
              newId = 'E-' + String(Math.floor(Math.random() * 10000)).padStart(4, '0');
            } while (this.completedEvents.some(e => e.id === newId));
            eventId = newId;
          } else {
            // 检查事件ID是否已存在，如果存在则生成新的唯一ID
            while (this.completedEvents.some(e => e.id === eventId)) {
              eventId = 'E-' + String(Math.floor(Math.random() * 10000)).padStart(4, '0');
            }
          }
          
          // 将任务添加到已完成事件列表
          const completedEvent = {
            id: eventId,
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
              eventId: eventId,
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
        
        console.log('计算评分 - 当前警员:', this.officerName, this.officerId);
        console.log('所有反馈:', this.eventFeedbacks);
        
        // 优先根据officerName过滤，因为officerId可能是随机生成的
        officerFeedbacks = this.eventFeedbacks.filter(feedback => feedback.officerName === this.officerName);
        console.log('根据officerName过滤后的反馈:', officerFeedbacks);
        
        // 如果没有匹配的officerName，根据officerId过滤
        if (officerFeedbacks.length === 0) {
          officerFeedbacks = this.eventFeedbacks.filter(feedback => feedback.officerId === this.officerId);
          console.log('根据officerId过滤后的反馈:', officerFeedbacks);
        }
        
        // 如果仍然没有匹配的，使用所有反馈计算平均分
        if (officerFeedbacks.length === 0) {
          officerFeedbacks = this.eventFeedbacks;
          console.log('使用所有反馈计算平均分:', officerFeedbacks);
        }
        
        if (officerFeedbacks.length === 0) {
          this.averageRating = 0;
          console.log('没有反馈，评分为0');
          return;
        }
        
        // 计算平均分
        const totalRating = officerFeedbacks.reduce((sum, feedback) => sum + feedback.rating, 0);
        this.averageRating = totalRating / officerFeedbacks.length;
        console.log('计算出的平均分:', this.averageRating);
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
              [114.305558, 30.592759];
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
            });
            
            // 注入自定义缩放和全屏按钮（延迟执行，等AMap DOM完全就绪）
            const gen = this.mapGeneration;
            setTimeout(() => {
              if (this.mapGeneration !== gen) return; // 地图已被重建，放弃
              this.injectMapControls(elId);
            }, 200);

            // 添加地图点击事件，点击地图时自动填充事发点坐标
            if (role === "commander") {
              this.mapInstance.on('click', (e) => {
                const lng = e.lnglat.getLng();
                const lat = e.lnglat.getLat();
                this.dispatch.incidentLng = lng;
                this.dispatch.incidentLat = lat;
                // 刷新地图以显示新的事发参考点
                this.initMapForRole("commander");
              });
            }
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
              
              // 只在有事发点坐标时添加参考点标记
              if (this.dispatch.incidentLng && this.dispatch.incidentLat) {
                addM(
                  this.dispatch.incidentLng,
                  this.dispatch.incidentLat,
                  "事发参考点",
                  "#f97316",
                  "<p class=\"amap-iw-note\">可拖动调度参数后重新加载地图</p>"
                );
              }
              
              // 显示动态围栏
              if (this.dispatch.fenceVertices && this.dispatch.fenceVertices.length >= 3) {
                const fencePath = this.dispatch.fenceVertices.map(v => [v.lng, v.lat]);
                const polygon = new AMap.Polygon({
                  path: fencePath,
                  strokeColor: "#3b82f6",
                  strokeWeight: 2,
                  strokeOpacity: 0.8,
                  fillColor: "#3b82f6",
                  fillOpacity: 0.2
                });
                polygon.setMap(this.mapInstance);
                this.mapMarkers.push(polygon);
              }
              
              // 显示警力位置
              this.dispatch.units.forEach((unit, index) => {
                if (unit.lng && unit.lat && unit.available) {
                  addM(
                    unit.lng,
                    unit.lat,
                    `警力 ${index + 1} · ${unit.name || unit.unitId}`,
                    "#22c55e",
                    `<p class=\"amap-iw-note\">${unit.policeType} · ${unit.transportMode}</p>`
                  );
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
          }
        });

        // 监听全屏变化来更新按钮图标 + 重绘地图
        const onFsChange = () => {
          const btn = ctrl.querySelector("[data-action='fullscreen']");
          if (btn) {
            btn.textContent = document.fullscreenElement ? "✕" : "⛶";
            btn.title = document.fullscreenElement ? "退出全屏" : "全屏";
          }
          // 延迟调 resize，等 CSS 过渡/DOM 更新完成
          setTimeout(() => {
            if (this.mapInstance) {
              this.mapInstance.resize();
            }
          }, 200);
        };
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
          
          // 刷新地图以显示更新后的警员位置
          if (this.mapLoaded && this.mapContext === "commander") {
            this.initMapForRole("commander");
          }
        }
      },
    },
  }).mount("#app");
})();
