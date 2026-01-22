// ==UserScript==
// @name         Torn PDA - Data Observer
// @namespace    local.torn.pda.dataobserver
// @version      0.1.2
// @description  Capture DOM, WebSocket, and AJAX data on Torn pages.
// @match        https://www.torn.com/*
// @match        https://torn.com/*
// @match        https://*.torn.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==
/* eslint-disable no-console */
(function () {
  "use strict";

  if (window.__tpdaDataObserver) return;
  window.__tpdaDataObserver = { version: "0.1.2" };

  const STORAGE_KEYS = {
    dom: "tpda_data_observer_dom_v1",
    ws: "tpda_data_observer_ws_v1",
    ajax: "tpda_data_observer_ajax_v1"
  };

  const MAX_ENTRIES = { dom: 250, ws: 400, ajax: 400 };
  const MAX_TEXT = { html: 4000, text: 1200, body: 3000 };
  const AUTO_CAPTURE_LIMIT = 120;
  const AUTO_CAPTURE_MIN_TEXT = 6;
  const SUPPORTS_POINTER = "PointerEvent" in window;
  const IS_TOUCH_DEVICE = (() => {
    if (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) return true;
    if (typeof window.matchMedia === "function") {
      return window.matchMedia("(pointer: coarse)").matches;
    }
    return false;
  })();
  const PICK_EVENT_OPTIONS = { capture: true, passive: false };
  const AUTO_CAPTURE_SKIP_TAGS = new Set(["SCRIPT", "STYLE", "META", "LINK", "HEAD", "NOSCRIPT"]);

  const state = {
    pickActive: false,
    watchActive: false,
    pickedElement: null,
    pickedSelector: "",
    hoverOverlay: null,
    overlayTimer: null,
    hoverTarget: null,
    mutationObserver: null,
    watchTimer: null,
    lastSnapshotHtml: "",
    statusTimer: null,
    counts: { dom: null, ws: null, ajax: null },
    ui: {}
  };

  function nowIso() {
    return new Date().toISOString();
  }

  function truncate(value, maxLen) {
    const text = value == null ? "" : String(value);
    if (text.length <= maxLen) return text;
    return `${text.slice(0, maxLen)}...[truncated ${text.length - maxLen} chars]`;
  }

  function safeJsonParse(raw) {
    try {
      return JSON.parse(raw);
    } catch (err) {
      return null;
    }
  }

  function loadLog(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return [];
      const parsed = safeJsonParse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  }

  function saveLog(key, items) {
    try {
      localStorage.setItem(key, JSON.stringify(items));
      return true;
    } catch (err) {
      return false;
    }
  }

  function updateCount(key, count) {
    state.counts[key] = count;
    if (state.ui.counts && state.ui.counts[key]) {
      state.ui.counts[key].textContent = String(count);
    }
  }

  function appendLog(key, entry, maxEntries) {
    const items = loadLog(key);
    items.push(entry);
    if (items.length > maxEntries) {
      items.splice(0, items.length - maxEntries);
    }
    if (!saveLog(key, items)) {
      const trimmed = items.slice(-Math.max(10, Math.floor(maxEntries * 0.7)));
      if (!saveLog(key, trimmed)) {
        console.warn("[TPDA Data Observer] Failed to store log entry.");
        return trimmed;
      }
      updateCount(key, trimmed.length);
      return trimmed;
    }
    updateCount(key, items.length);
    return items;
  }

  function clearLog(key) {
    try {
      localStorage.removeItem(key);
    } catch (err) {
      console.warn("[TPDA Data Observer] Failed to clear log.", err);
    }
    updateCount(key, 0);
  }

  function initCounts() {
    updateCount("dom", loadLog(STORAGE_KEYS.dom).length);
    updateCount("ws", loadLog(STORAGE_KEYS.ws).length);
    updateCount("ajax", loadLog(STORAGE_KEYS.ajax).length);
  }

  function cssEscape(value) {
    if (window.CSS && window.CSS.escape) return window.CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function getCssPath(el) {
    if (!(el instanceof Element)) return "";
    const parts = [];
    let current = el;
    while (current && current.nodeType === 1 && parts.length < 6) {
      let part = current.nodeName.toLowerCase();
      if (current.id) {
        part += `#${cssEscape(current.id)}`;
        parts.unshift(part);
        break;
      }
      const classes = Array.from(current.classList || []).slice(0, 2);
      if (classes.length) {
        part += classes.map(cls => `.${cssEscape(cls)}`).join("");
      }
      if (current.parentElement) {
        const siblings = Array.from(current.parentElement.children);
        const index = siblings.indexOf(current) + 1;
        part += `:nth-child(${index})`;
      }
      parts.unshift(part);
      current = current.parentElement;
    }
    return parts.join(" > ");
  }

  function readAttributes(el) {
    const attrs = {};
    if (!el || !el.attributes) return attrs;
    Array.from(el.attributes).forEach(attr => {
      attrs[attr.name] = attr.value;
    });
    return attrs;
  }

  function snapshotElement(el) {
    return {
      tag: el && el.tagName ? el.tagName.toLowerCase() : "",
      id: el && el.id ? el.id : "",
      className: el && el.className ? el.className : "",
      html: truncate(el && el.outerHTML ? el.outerHTML : "", MAX_TEXT.html),
      text: truncate(el && el.textContent ? el.textContent : "", MAX_TEXT.text),
      attributes: readAttributes(el)
    };
  }

  function logDomSnapshot(el, reason, updateSelected) {
    if (!el || !(el instanceof Element)) return;
    const selector = getCssPath(el);
    const snapshot = snapshotElement(el);
    const entry = {
      kind: "dom",
      reason,
      time: nowIso(),
      url: window.location.href,
      title: document.title || "",
      selector,
      ...snapshot
    };
    appendLog(STORAGE_KEYS.dom, entry, MAX_ENTRIES.dom);
    if (updateSelected) {
      state.pickedElement = el;
      state.pickedSelector = selector;
      state.lastSnapshotHtml = snapshot.html;
      updateSelectedLabel();
    }
  }

  function formatBody(body) {
    if (body == null) return "";
    if (typeof body === "string") return truncate(body, MAX_TEXT.body);
    if (body instanceof URLSearchParams) return truncate(body.toString(), MAX_TEXT.body);
    if (body instanceof FormData) {
      const pairs = [];
      body.forEach((value, key) => {
        const text = value && value.name ? value.name : String(value);
        pairs.push(`${key}=${text}`);
      });
      return truncate(pairs.join("&"), MAX_TEXT.body);
    }
    if (body instanceof Blob) {
      return `[blob ${body.type || "unknown"} ${body.size} bytes]`;
    }
    if (body instanceof ArrayBuffer) {
      return `[arraybuffer ${body.byteLength} bytes]`;
    }
    if (typeof body === "object") {
      try {
        return truncate(JSON.stringify(body), MAX_TEXT.body);
      } catch (err) {
        return truncate(String(body), MAX_TEXT.body);
      }
    }
    return truncate(String(body), MAX_TEXT.body);
  }

  function logAjaxEntry(entry) {
    appendLog(STORAGE_KEYS.ajax, entry, MAX_ENTRIES.ajax);
  }

  function logWsEntry(entry) {
    appendLog(STORAGE_KEYS.ws, entry, MAX_ENTRIES.ws);
  }

  function formatWsData(data) {
    if (typeof data === "string") return truncate(data, MAX_TEXT.body);
    if (data instanceof ArrayBuffer) return `[arraybuffer ${data.byteLength} bytes]`;
    if (data instanceof Blob) return `[blob ${data.type || "unknown"} ${data.size} bytes]`;
    try {
      return truncate(JSON.stringify(data), MAX_TEXT.body);
    } catch (err) {
      return truncate(String(data), MAX_TEXT.body);
    }
  }

  function setupWebSocketLogging() {
    const OriginalWebSocket = window.WebSocket;
    if (!OriginalWebSocket || OriginalWebSocket.__tpdaWrapped) return;

    const originalSend = OriginalWebSocket.prototype.send;
    if (!OriginalWebSocket.prototype.send.__tpdaWrapped) {
      OriginalWebSocket.prototype.send = function (data) {
        logWsEntry({
          kind: "ws",
          direction: "out",
          time: nowIso(),
          url: this.url || "",
          data: formatWsData(data)
        });
        return originalSend.apply(this, arguments);
      };
      OriginalWebSocket.prototype.send.__tpdaWrapped = true;
    }

    const WebSocketProxy = function (url, protocols) {
      const ws = protocols ? new OriginalWebSocket(url, protocols) : new OriginalWebSocket(url);
      ws.addEventListener("message", event => {
        logWsEntry({
          kind: "ws",
          direction: "in",
          time: nowIso(),
          url: ws.url || "",
          data: formatWsData(event.data)
        });
      });
      return ws;
    };

    WebSocketProxy.prototype = OriginalWebSocket.prototype;
    Object.setPrototypeOf(WebSocketProxy, OriginalWebSocket);
    WebSocketProxy.CONNECTING = OriginalWebSocket.CONNECTING;
    WebSocketProxy.OPEN = OriginalWebSocket.OPEN;
    WebSocketProxy.CLOSING = OriginalWebSocket.CLOSING;
    WebSocketProxy.CLOSED = OriginalWebSocket.CLOSED;
    WebSocketProxy.__tpdaWrapped = true;

    window.WebSocket = WebSocketProxy;
    OriginalWebSocket.__tpdaWrapped = true;
  }

  function setupFetchLogging() {
    if (!window.fetch || window.fetch.__tpdaWrapped) return;
    const originalFetch = window.fetch.bind(window);

    window.fetch = function () {
      const args = Array.from(arguments);
      const start = Date.now();

      const input = args[0];
      const init = args[1] || {};
      const url = input instanceof Request ? input.url : String(input);
      const method = (init.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
      const requestBody = formatBody(init.body);

      return originalFetch.apply(this, args)
        .then(response => {
          const duration = Date.now() - start;
          const contentType = response.headers.get("content-type") || "";
          const entryBase = {
            kind: "ajax",
            transport: "fetch",
            time: nowIso(),
            url,
            method,
            status: response.status,
            ok: response.ok,
            durationMs: duration,
            requestBody
          };

          if (contentType.includes("application/json") || contentType.startsWith("text/")) {
            response.clone().text().then(text => {
              logAjaxEntry({
                ...entryBase,
                responseBody: truncate(text, MAX_TEXT.body)
              });
            }).catch(() => {
              logAjaxEntry({
                ...entryBase,
                responseBody: "[response unavailable]"
              });
            });
          } else {
            logAjaxEntry({
              ...entryBase,
              responseBody: `[binary ${contentType || "unknown"}]`
            });
          }
          return response;
        })
        .catch(error => {
          logAjaxEntry({
            kind: "ajax",
            transport: "fetch",
            time: nowIso(),
            url,
            method,
            status: 0,
            ok: false,
            durationMs: Date.now() - start,
            requestBody,
            error: error ? error.message : "fetch error"
          });
          throw error;
        });
    };

    window.fetch.__tpdaWrapped = true;
  }

  function setupXhrLogging() {
    if (!window.XMLHttpRequest || XMLHttpRequest.prototype.__tpdaWrapped) return;
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url) {
      this.__tpdaMeta = {
        method: (method || "GET").toUpperCase(),
        url: String(url || "")
      };
      return originalOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function (body) {
      const meta = this.__tpdaMeta || {};
      meta.requestBody = formatBody(body);
      meta.start = Date.now();

      const onLoadEnd = () => {
        const duration = Date.now() - (meta.start || Date.now());
        let responseBody = "";
        if (this.responseType && this.responseType !== "text" && this.responseType !== "") {
          responseBody = `[${this.responseType} response]`;
        } else {
          responseBody = truncate(this.responseText || "", MAX_TEXT.body);
        }
        logAjaxEntry({
          kind: "ajax",
          transport: "xhr",
          time: nowIso(),
          url: meta.url || "",
          method: meta.method || "GET",
          status: this.status,
          ok: this.status >= 200 && this.status < 300,
          durationMs: duration,
          requestBody: meta.requestBody || "",
          responseBody
        });
      };

      this.addEventListener("loadend", onLoadEnd, { once: true });
      return originalSend.apply(this, arguments);
    };

    XMLHttpRequest.prototype.__tpdaWrapped = true;
  }

  function appendStyleOnce() {
    if (document.getElementById("tpda-data-observer-style")) return;
    const style = document.createElement("style");
    style.id = "tpda-data-observer-style";
    style.textContent = `
      #tpda-data-observer {
        position: fixed;
        right: 14px;
        bottom: 14px;
        z-index: 999999;
        font-family: Arial, sans-serif;
        font-size: 12px;
        color: #e8e8e8;
        background: rgba(20, 20, 20, 0.94);
        border: 1px solid #3b3b3b;
        border-radius: 6px;
        width: 330px;
        box-shadow: 0 8px 18px rgba(0, 0, 0, 0.45);
      }
      #tpda-data-observer.tpda-collapsed .tpda-body {
        display: none;
      }
      #tpda-data-observer .tpda-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 10px;
        border-bottom: 1px solid #2a2a2a;
        font-weight: bold;
      }
      #tpda-data-observer .tpda-body {
        padding: 8px 10px 10px;
      }
      #tpda-data-observer .tpda-section {
        margin-bottom: 10px;
      }
      #tpda-data-observer .tpda-section-title {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 6px;
        font-weight: bold;
      }
      #tpda-data-observer .tpda-count {
        background: #222;
        border: 1px solid #3b3b3b;
        border-radius: 4px;
        padding: 1px 6px;
        font-size: 11px;
      }
      #tpda-data-observer .tpda-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      #tpda-data-observer .tpda-btn {
        background: #2b2b2b;
        color: #e8e8e8;
        border: 1px solid #444;
        border-radius: 4px;
        padding: 4px 7px;
        cursor: pointer;
        font-size: 11px;
      }
      #tpda-data-observer .tpda-btn:hover {
        background: #3a3a3a;
      }
      #tpda-data-observer .tpda-btn.is-on {
        background: #1f5f8f;
        border-color: #2a7db8;
      }
      #tpda-data-observer .tpda-btn.tpda-wide {
        flex: 1 1 150px;
      }
      #tpda-data-observer .tpda-note {
        margin-top: 6px;
        color: #b7b7b7;
        font-size: 10px;
      }
      #tpda-data-observer .tpda-selected {
        margin-top: 6px;
        font-size: 10px;
        color: #c7c7c7;
        word-break: break-word;
      }
      #tpda-data-observer .tpda-status {
        margin-top: 8px;
        min-height: 14px;
        font-size: 11px;
        color: #9fd0ff;
      }
      #tpda-data-observer-highlight {
        position: fixed;
        pointer-events: none;
        border: 2px solid #6dc7ff;
        box-sizing: border-box;
        z-index: 999998;
        display: none;
      }
    `;
    const head = document.head || document.getElementsByTagName("head")[0];
    if (head) {
      head.appendChild(style);
    } else if (document.documentElement) {
      document.documentElement.appendChild(style);
    }
  }

  function createUi() {
    if (document.getElementById("tpda-data-observer")) return;
    appendStyleOnce();

    const root = document.createElement("div");
    root.id = "tpda-data-observer";
    root.innerHTML = `
      <div class="tpda-header">
        <span class="tpda-title">TPDA Data Observer</span>
        <button class="tpda-btn" data-action="toggle">Hide</button>
      </div>
      <div class="tpda-body">
        <div class="tpda-section">
          <div class="tpda-section-title">
            <span>DOM</span>
            <span class="tpda-count" data-count="dom">0</span>
          </div>
          <div class="tpda-actions">
            <button class="tpda-btn" data-action="pick">Pick/tap element</button>
            <button class="tpda-btn" data-action="watch">Watch selected</button>
            <button class="tpda-btn" data-action="auto-capture">Auto capture visible</button>
            <button class="tpda-btn" data-action="copy-last">Copy last</button>
            <button class="tpda-btn" data-action="copy-dom">Copy log</button>
            <button class="tpda-btn" data-action="clear-dom">Clear</button>
          </div>
          <div class="tpda-note">Pick mode blocks page taps on mobile. Shift+click blocks page actions on desktop.</div>
          <div class="tpda-selected" data-role="selected">Selected: none</div>
        </div>
        <div class="tpda-section">
          <div class="tpda-section-title">
            <span>WebSocket</span>
            <span class="tpda-count" data-count="ws">0</span>
          </div>
          <div class="tpda-actions">
            <button class="tpda-btn" data-action="copy-ws">Copy log</button>
            <button class="tpda-btn" data-action="clear-ws">Clear</button>
          </div>
        </div>
        <div class="tpda-section">
          <div class="tpda-section-title">
            <span>AJAX</span>
            <span class="tpda-count" data-count="ajax">0</span>
          </div>
          <div class="tpda-actions">
            <button class="tpda-btn" data-action="copy-ajax">Copy log</button>
            <button class="tpda-btn" data-action="clear-ajax">Clear</button>
          </div>
        </div>
        <div class="tpda-section">
          <div class="tpda-actions">
            <button class="tpda-btn tpda-wide" data-action="copy-all">Copy all logs</button>
            <button class="tpda-btn tpda-wide" data-action="clear-all">Clear all</button>
          </div>
          <div class="tpda-status" data-role="status"></div>
        </div>
      </div>
    `;

    if (document.body) {
      document.body.appendChild(root);
    } else if (document.documentElement) {
      document.documentElement.appendChild(root);
    } else {
      return;
    }

    state.ui.root = root;
    state.ui.counts = {
      dom: root.querySelector('[data-count="dom"]'),
      ws: root.querySelector('[data-count="ws"]'),
      ajax: root.querySelector('[data-count="ajax"]')
    };
    state.ui.status = root.querySelector('[data-role="status"]');
    state.ui.selected = root.querySelector('[data-role="selected"]');
    state.ui.pickButton = root.querySelector('[data-action="pick"]');
    state.ui.watchButton = root.querySelector('[data-action="watch"]');
    state.ui.toggleButton = root.querySelector('[data-action="toggle"]');

    root.addEventListener("click", handleUiClick);
    initCounts();
    updateSelectedLabel();
  }

  function setStatus(message) {
    if (!state.ui.status) return;
    state.ui.status.textContent = message || "";
    if (state.statusTimer) clearTimeout(state.statusTimer);
    if (message) {
      state.statusTimer = setTimeout(() => {
        if (state.ui.status) state.ui.status.textContent = "";
      }, 3500);
    }
  }

  function updateSelectedLabel() {
    if (!state.ui.selected) return;
    state.ui.selected.textContent = state.pickedSelector
      ? `Selected: ${state.pickedSelector}`
      : "Selected: none";
  }

  function setButtonState(button, isOn, onLabel, offLabel) {
    if (!button) return;
    button.classList.toggle("is-on", isOn);
    if (onLabel && offLabel) {
      button.textContent = isOn ? onLabel : offLabel;
    }
  }

  function ensureHoverOverlay() {
    if (state.hoverOverlay) return;
    const overlay = document.createElement("div");
    overlay.id = "tpda-data-observer-highlight";
    document.body.appendChild(overlay);
    state.hoverOverlay = overlay;
  }

  function showOverlayForElement(el) {
    if (!state.hoverOverlay || !el || !el.getBoundingClientRect) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      state.hoverOverlay.style.display = "none";
      return;
    }
    state.hoverOverlay.style.display = "block";
    state.hoverOverlay.style.top = `${rect.top}px`;
    state.hoverOverlay.style.left = `${rect.left}px`;
    state.hoverOverlay.style.width = `${rect.width}px`;
    state.hoverOverlay.style.height = `${rect.height}px`;
  }

  function hideOverlay() {
    if (state.hoverOverlay) {
      state.hoverOverlay.style.display = "none";
    }
  }

  function isPickerUiElement(el) {
    return !!(el && state.ui.root && (el === state.ui.root || state.ui.root.contains(el)));
  }

  function getEventPoint(event) {
    if (event && event.touches && event.touches.length) {
      return { x: event.touches[0].clientX, y: event.touches[0].clientY };
    }
    if (event && typeof event.clientX === "number") {
      return { x: event.clientX, y: event.clientY };
    }
    return null;
  }

  function getElementFromEvent(event) {
    if (event && event.target && event.target.nodeType === 1) return event.target;
    const point = getEventPoint(event);
    if (point) return document.elementFromPoint(point.x, point.y);
    return null;
  }

  function shouldBlockPickEvent(event) {
    return IS_TOUCH_DEVICE || (event && event.shiftKey);
  }

  function flashOverlay(el) {
    if (!state.hoverOverlay) return;
    showOverlayForElement(el);
    if (state.overlayTimer) clearTimeout(state.overlayTimer);
    state.overlayTimer = setTimeout(() => {
      hideOverlay();
      state.overlayTimer = null;
    }, 900);
  }

  function startPicking() {
    if (state.pickActive) return;
    state.pickActive = true;
    ensureHoverOverlay();
    if (SUPPORTS_POINTER) {
      document.addEventListener("pointermove", handlePickMove, PICK_EVENT_OPTIONS);
      document.addEventListener("pointerdown", handlePickSelect, PICK_EVENT_OPTIONS);
    } else {
      document.addEventListener("mousemove", handlePickMove, true);
      document.addEventListener("click", handlePickSelect, true);
      document.addEventListener("touchstart", handlePickSelect, PICK_EVENT_OPTIONS);
    }
    document.addEventListener("keydown", handlePickKey, true);
    setButtonState(state.ui.pickButton, true, "Picking...", "Pick/tap element");
    setStatus(IS_TOUCH_DEVICE ? "Pick mode on. Tap an element to log it." : "Pick mode on. Click an element to log it.");
  }

  function stopPicking() {
    if (!state.pickActive) return;
    state.pickActive = false;
    if (SUPPORTS_POINTER) {
      document.removeEventListener("pointermove", handlePickMove, PICK_EVENT_OPTIONS);
      document.removeEventListener("pointerdown", handlePickSelect, PICK_EVENT_OPTIONS);
    } else {
      document.removeEventListener("mousemove", handlePickMove, true);
      document.removeEventListener("click", handlePickSelect, true);
      document.removeEventListener("touchstart", handlePickSelect, PICK_EVENT_OPTIONS);
    }
    document.removeEventListener("keydown", handlePickKey, true);
    hideOverlay();
    if (state.overlayTimer) {
      clearTimeout(state.overlayTimer);
      state.overlayTimer = null;
    }
    setButtonState(state.ui.pickButton, false, "Picking...", "Pick/tap element");
    setStatus("Pick mode off.");
  }

  function handlePickMove(event) {
    if (!state.pickActive) return;
    const target = getElementFromEvent(event);
    if (!target || isPickerUiElement(target)) {
      hideOverlay();
      return;
    }
    state.hoverTarget = target;
    showOverlayForElement(target);
  }

  function handlePickSelect(event) {
    if (!state.pickActive) return;
    const target = getElementFromEvent(event);
    if (!target || isPickerUiElement(target)) return;
    logDomSnapshot(target, "pick", true);
    flashOverlay(target);
    if (shouldBlockPickEvent(event)) {
      event.preventDefault();
      event.stopPropagation();
    }
    setStatus(IS_TOUCH_DEVICE ? "Captured element. Tap UI to exit pick mode." : "Captured element.");
  }

  function handlePickKey(event) {
    if (event.key === "Escape") {
      stopPicking();
    }
  }

  function isElementVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 && rect.height < 2) return false;
    if (rect.bottom < 0 || rect.right < 0) return false;
    if (rect.top > window.innerHeight || rect.left > window.innerWidth) return false;
    if (typeof window.getComputedStyle === "function") {
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
        return false;
      }
    }
    return true;
  }

  function isInterestingElement(el) {
    if (!el || !el.matches) return false;
    if (el.matches("a,button,input,select,textarea,[role='button'],[onclick]")) return true;
    const text = (el.textContent || "").trim();
    if (text.length >= AUTO_CAPTURE_MIN_TEXT) return true;
    if (el.attributes) {
      for (const attr of Array.from(el.attributes)) {
        if (attr.name.startsWith("data-") && attr.value) return true;
      }
    }
    return false;
  }

  function autoCaptureVisibleElements() {
    if (!document.body) {
      setStatus("Page not ready yet.");
      return;
    }
    const elements = Array.from(document.body.querySelectorAll("*"));
    const seen = new Set();
    let count = 0;
    for (const el of elements) {
      if (count >= AUTO_CAPTURE_LIMIT) break;
      if (!(el instanceof Element)) continue;
      if (AUTO_CAPTURE_SKIP_TAGS.has(el.tagName)) continue;
      if (isPickerUiElement(el) || el.id === "tpda-data-observer-highlight") continue;
      if (!isElementVisible(el)) continue;
      if (!isInterestingElement(el)) continue;
      const selector = getCssPath(el);
      if (!selector || seen.has(selector)) continue;
      logDomSnapshot(el, "auto-visible", false);
      seen.add(selector);
      count += 1;
    }
    const suffix = count >= AUTO_CAPTURE_LIMIT ? " (limit reached)" : "";
    setStatus(count ? `Auto-captured ${count} elements${suffix}.` : "No visible elements matched.");
  }

  function startWatching() {
    if (!state.pickedElement) {
      setStatus("Pick an element first.");
      return;
    }
    if (state.watchActive) return;
    state.watchActive = true;
    state.lastSnapshotHtml = snapshotElement(state.pickedElement).html;
    state.mutationObserver = new MutationObserver(() => scheduleWatchLog());
    state.mutationObserver.observe(state.pickedElement, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true
    });
    logDomSnapshot(state.pickedElement, "watch-start", false);
    setButtonState(state.ui.watchButton, true, "Watching...", "Watch selected");
    setStatus("Watching selected element for changes.");
  }

  function stopWatching() {
    if (!state.watchActive) return;
    state.watchActive = false;
    if (state.mutationObserver) {
      state.mutationObserver.disconnect();
      state.mutationObserver = null;
    }
    if (state.watchTimer) {
      clearTimeout(state.watchTimer);
      state.watchTimer = null;
    }
    setButtonState(state.ui.watchButton, false, "Watching...", "Watch selected");
    setStatus("Stopped watching element.");
  }

  function scheduleWatchLog() {
    if (state.watchTimer) return;
    state.watchTimer = setTimeout(() => {
      state.watchTimer = null;
      if (!state.pickedElement || !document.contains(state.pickedElement)) {
        setStatus("Watched element removed.");
        stopWatching();
        return;
      }
      const snapshot = snapshotElement(state.pickedElement);
      if (snapshot.html !== state.lastSnapshotHtml) {
        state.lastSnapshotHtml = snapshot.html;
        logDomSnapshot(state.pickedElement, "watch-change", false);
        setStatus("Element updated.");
      }
    }, 250);
  }

  function copyText(text, successMessage) {
    if (!text) {
      setStatus("Nothing to copy.");
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        setStatus(successMessage || "Copied.");
      }).catch(() => {
        fallbackCopyText(text, successMessage);
      });
    } else {
      fallbackCopyText(text, successMessage);
    }
  }

  function fallbackCopyText(text, successMessage) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      document.execCommand("copy");
      setStatus(successMessage || "Copied.");
    } catch (err) {
      setStatus("Copy failed.");
    }
    document.body.removeChild(textarea);
  }

  function copyLog(key, label) {
    const items = loadLog(key);
    if (!items.length) {
      setStatus(`${label} log empty.`);
      return;
    }
    copyText(JSON.stringify(items, null, 2), `${label} log copied.`);
  }

  function copyLastDom() {
    const items = loadLog(STORAGE_KEYS.dom);
    if (!items.length) {
      setStatus("DOM log empty.");
      return;
    }
    const last = items[items.length - 1];
    const text = last && last.html ? last.html : "";
    copyText(text, "Last DOM snapshot copied.");
  }

  function copyAllLogs() {
    const all = {
      dom: loadLog(STORAGE_KEYS.dom),
      ws: loadLog(STORAGE_KEYS.ws),
      ajax: loadLog(STORAGE_KEYS.ajax)
    };
    copyText(JSON.stringify(all, null, 2), "All logs copied.");
  }

  function handleUiClick(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const action = button.getAttribute("data-action");
    switch (action) {
      case "toggle":
        state.ui.root.classList.toggle("tpda-collapsed");
        state.ui.toggleButton.textContent = state.ui.root.classList.contains("tpda-collapsed") ? "Show" : "Hide";
        break;
      case "pick":
        if (state.pickActive) stopPicking(); else startPicking();
        break;
      case "watch":
        if (state.watchActive) stopWatching(); else startWatching();
        break;
      case "auto-capture":
        autoCaptureVisibleElements();
        break;
      case "copy-last":
        copyLastDom();
        break;
      case "copy-dom":
        copyLog(STORAGE_KEYS.dom, "DOM");
        break;
      case "clear-dom":
        clearLog(STORAGE_KEYS.dom);
        break;
      case "copy-ws":
        copyLog(STORAGE_KEYS.ws, "WebSocket");
        break;
      case "clear-ws":
        clearLog(STORAGE_KEYS.ws);
        break;
      case "copy-ajax":
        copyLog(STORAGE_KEYS.ajax, "AJAX");
        break;
      case "clear-ajax":
        clearLog(STORAGE_KEYS.ajax);
        break;
      case "copy-all":
        copyAllLogs();
        break;
      case "clear-all":
        clearLog(STORAGE_KEYS.dom);
        clearLog(STORAGE_KEYS.ws);
        clearLog(STORAGE_KEYS.ajax);
        break;
      default:
        break;
    }
  }

  function ensureUiMounted() {
    if (!document.body && !document.documentElement) return;
    const existing = document.getElementById("tpda-data-observer");
    if (existing && existing.isConnected) return;
    createUi();
  }

  function setupUiPersistence() {
    if (!window.MutationObserver) return;
    const target = document.documentElement || document.body;
    if (!target) return;
    const observer = new MutationObserver(() => {
      ensureUiMounted();
    });
    observer.observe(target, { childList: true, subtree: true });
    window.__tpdaDataObserver.uiObserver = observer;
  }

  function bootUiWhenReady() {
    const ready = () => {
      if (!document.body) {
        requestAnimationFrame(ready);
        return;
      }
      createUi();
      setupUiPersistence();
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", ready, { once: true });
    } else {
      ready();
    }
  }

  setupWebSocketLogging();
  setupFetchLogging();
  setupXhrLogging();
  bootUiWhenReady();
})();
