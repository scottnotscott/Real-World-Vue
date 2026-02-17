// ==UserScript==
// @name         Torn PDA - Faction Intel Panel
// @namespace    local.torn.pda.factionintel
// @version      0.1.0
// @description  Mobile-friendly faction intel panel with cumulative member stats for Torn PDA.
// @match        https://www.torn.com/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  if (window.__tpdaFactionIntelLoaded) return;
  window.__tpdaFactionIntelLoaded = true;

  const SCRIPT_ID = "tpda-faction-intel-panel";
  const STYLE_ID = "tpda-faction-intel-style";
  const COLLAPSED_STORAGE_KEY = "tpda_faction_intel_collapsed_v1";
  const API_BASE_URL = "https://api.torn.com/v2";
  const API_KEY = "###PDA-APIKEY###";
  const API_KEY_PLACEHOLDER = `${"#".repeat(3)}PDA-APIKEY${"#".repeat(3)}`;
  const WINDOW_DAYS = 30;
  const WINDOW_SECONDS = WINDOW_DAYS * 86400;
  const POLL_INTERVAL_MS = 1200;
  const FACTION_CACHE_TTL_MS = 30 * 1000;
  const MEMBER_CACHE_TTL_MS = 20 * 60 * 1000;
  const FORCE_REFRESH_CACHE_TTL_MS = 6 * 60 * 1000;
  const MEMBER_SCAN_INTERVAL_MS = 1500;
  const MEMBER_REQUEST_GAP_MS = 220;
  const RATE_LIMIT_COOLDOWN_MS = 18000;
  const MAX_RATE_LIMIT_RETRIES = 2;
  const MAX_FACTION_CACHE_ENTRIES = 12;
  const MAX_MEMBER_CACHE_ENTRIES = 650;
  const LEADERBOARD_LIMIT = 3;
  const CANCELLED_ERROR_TOKEN = "__tpda_cancelled__";

  const MONTHLY_STAT_NAMES = [
    "timeplayed",
    "xantaken",
    "overdosed",
    "cantaken",
    "refills",
    "nerverefills",
    "boostersused",
    "statenhancersused",
    "networth",
    "rankedwarhits",
    "attackswon",
    "respectforfaction"
  ];

  const CURRENT_STAT_NAMES = Array.from(new Set([...MONTHLY_STAT_NAMES]));

  const state = {
    context: null,
    requestId: 0,
    root: null,
    collapsed: true,
    activeModel: null,
    activeProgress: null,
    activeContext: null,
    expandedTables: new Set(),
    invalidStatNames: new Set(),
    factionCache: new Map(),
    memberCache: new Map()
  };

  function readCollapsedPreference() {
    try {
      const raw = localStorage.getItem(COLLAPSED_STORAGE_KEY);
      if (raw == null) return true;
      return raw !== "0";
    } catch (err) {
      return true;
    }
  }

  function persistCollapsedPreference(value) {
    try {
      localStorage.setItem(COLLAPSED_STORAGE_KEY, value ? "1" : "0");
    } catch (err) {
      // Ignore localStorage failures; UI still works for current session.
    }
  }

  function applyCollapsedUiState() {
    if (!state.root) return;
    state.root.classList.toggle("tpda-collapsed", !!state.collapsed);
    const toggleButton = state.root.querySelector("button[data-action='toggle']");
    if (toggleButton) {
      toggleButton.textContent = state.collapsed ? "Expand" : "Collapse";
    }
  }

  function ensureStyle() {
    const existingStyles = Array.from(document.querySelectorAll(`#${STYLE_ID}`));
    let style = existingStyles[0] || null;
    if (existingStyles.length > 1) {
      for (let i = 1; i < existingStyles.length; i += 1) {
        existingStyles[i].parentNode && existingStyles[i].parentNode.removeChild(existingStyles[i]);
      }
    }
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
    }
    style.textContent = `
      #${SCRIPT_ID} {
        box-sizing: border-box;
        width: min(100%, calc(100vw - 6px));
        max-width: 100%;
        margin: 3px 0;
        padding: 5px;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(15, 15, 20, 0.96);
        color: #e5e5e5;
        font-family: Arial, sans-serif;
        line-height: 1.2;
        max-height: calc(100vh - 78px);
        overflow-y: auto;
        overflow-x: hidden;
      }
      #${SCRIPT_ID} * {
        box-sizing: border-box;
      }
      #${SCRIPT_ID} .tpda-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 6px;
        margin-bottom: 6px;
      }
      #${SCRIPT_ID} .tpda-head > div:first-child {
        flex: 1 1 auto;
        min-width: 0;
      }
      #${SCRIPT_ID} .tpda-title {
        font-size: 14px;
        font-weight: 700;
      }
      #${SCRIPT_ID} .tpda-subtitle {
        margin-top: 1px;
        font-size: 11px;
        color: #bdbdbd;
      }
      #${SCRIPT_ID} .tpda-actions {
        display: flex;
        align-items: center;
        gap: 4px;
        flex: 0 0 auto;
        margin-left: auto;
      }
      #${SCRIPT_ID} .tpda-btn {
        border: 1px solid #4b4b4b;
        background: #2a2a2a;
        color: #f0f0f0;
        border-radius: 5px;
        padding: 2px 6px;
        font-size: 10px;
        line-height: 1.1;
        min-height: 21px;
      }
      #${SCRIPT_ID} .tpda-btn.tpda-mini {
        padding: 1px 6px;
        font-size: 10px;
        min-height: 18px;
      }
      #${SCRIPT_ID} .tpda-btn:active {
        transform: translateY(1px);
      }
      #${SCRIPT_ID} .tpda-status {
        padding: 5px 7px;
        border-radius: 6px;
        margin-bottom: 6px;
        font-size: 11px;
      }
      #${SCRIPT_ID} .tpda-status.is-error {
        background: rgba(155, 48, 48, 0.2);
        border: 1px solid rgba(195, 78, 78, 0.5);
        color: #ffcfcf;
      }
      #${SCRIPT_ID} .tpda-status.is-info {
        background: rgba(62, 90, 141, 0.2);
        border: 1px solid rgba(99, 145, 225, 0.45);
        color: #d7e7ff;
      }
      #${SCRIPT_ID} .tpda-section {
        margin-top: 7px;
      }
      #${SCRIPT_ID} .tpda-section-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        margin: 0 0 4px;
      }
      #${SCRIPT_ID} .tpda-section-title {
        margin: 0;
        font-size: 11px;
        font-weight: 700;
        color: #d7d7d7;
        text-transform: uppercase;
        letter-spacing: 0.03em;
      }
      #${SCRIPT_ID} .tpda-table {
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.06);
        overflow: hidden;
      }
      #${SCRIPT_ID} .tpda-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
        padding: 5px 7px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      }
      #${SCRIPT_ID} .tpda-row:last-child {
        border-bottom: none;
      }
      #${SCRIPT_ID} .tpda-row-left {
        flex: 1 1 auto;
        min-width: 0;
      }
      #${SCRIPT_ID} .tpda-row-label {
        color: #cdcdcd;
        font-size: 10px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #${SCRIPT_ID} .tpda-row-meta {
        margin-top: 1px;
        font-size: 10px;
        color: #9f9f9f;
      }
      #${SCRIPT_ID} .tpda-row-value {
        font-size: 12px;
        font-weight: 700;
        color: #f2f2f2;
        text-align: right;
        flex: 0 0 auto;
        max-width: 55%;
        white-space: normal;
        overflow-wrap: anywhere;
        word-break: break-word;
        line-height: 1.15;
      }
      #${SCRIPT_ID} .tpda-row-value.tpda-gold {
        color: #d7a544;
      }
      #${SCRIPT_ID} .tpda-progress-wrap {
        width: 100%;
        height: 6px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        overflow: hidden;
        margin-top: 4px;
      }
      #${SCRIPT_ID} .tpda-progress-fill {
        height: 100%;
        width: 0;
        border-radius: 999px;
        background: linear-gradient(90deg, #4f8be0, #79a7f2);
      }
      #${SCRIPT_ID} .tpda-row-label.is-leader {
        max-width: 250px;
      }
      #${SCRIPT_ID} .tpda-footnote {
        margin-top: 7px;
        font-size: 10px;
        color: #adadad;
      }
      #${SCRIPT_ID}.tpda-collapsed .tpda-expanded {
        display: none;
      }
      #${SCRIPT_ID}:not(.tpda-collapsed) .tpda-compact {
        display: none;
      }
      #${SCRIPT_ID} .tpda-expand-hint {
        margin-top: 6px;
        font-size: 10px;
        color: #a9a9a9;
      }
      @media (max-width: 420px) {
        #${SCRIPT_ID} {
          width: min(100%, calc(100vw - 4px));
          margin: 2px 0;
          padding: 4px;
          max-height: calc(100vh - 70px);
        }
        #${SCRIPT_ID} .tpda-row-label.is-leader {
          max-width: 160px;
        }
      }
      @media (max-width: 360px) {
        #${SCRIPT_ID} .tpda-actions {
          width: 100%;
          justify-content: flex-end;
        }
        #${SCRIPT_ID} .tpda-row-label.is-leader {
          max-width: 130px;
        }
      }
    `;
    if (!style.parentNode) {
      document.head.appendChild(style);
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function isFactionPage(urlText) {
    return /factions\.php/i.test(urlText) || /(?:\?|&)sid=factions(?:&|$)/i.test(urlText);
  }

  function getFactionIdFromUrl(urlText) {
    if (!isFactionPage(urlText)) return null;

    const extract = (text) => {
      const match = String(text || "").match(
        /(?:ID|id|factionID|factionId|faction|faction_id)=([0-9]{1,12})/
      );
      return match ? match[1] : null;
    };

    try {
      const url = new URL(urlText);
      const keys = ["ID", "id", "factionID", "factionId", "faction", "faction_id", "XID", "xid"];
      for (const key of keys) {
        const raw = url.searchParams.get(key);
        if (raw && /^[0-9]{1,12}$/.test(raw)) return raw;
      }
      const hashId = extract(url.hash || "");
      if (hashId) return hashId;
    } catch (err) {
      const fallback = extract(urlText);
      if (fallback) return fallback;
    }

    const selectors = [
      'a[href*="factions.php?step=profile&ID="]',
      'a[href*="factions.php?ID="]',
      'a[href*="sid=factions"][href*="ID="]'
    ];
    for (const selector of selectors) {
      const anchor = document.querySelector(selector);
      if (!anchor || !anchor.href) continue;
      const anchorId = extract(anchor.href);
      if (anchorId) return anchorId;
    }
    return null;
  }

  function getFactionContext(urlText) {
    if (!isFactionPage(urlText)) return null;
    const factionId = getFactionIdFromUrl(urlText);
    if (factionId) {
      return {
        cacheKey: factionId,
        factionId,
        isSelf: false
      };
    }

    // Fallback for screens that show the key owner's faction without explicit faction id in URL.
    return {
      cacheKey: "self",
      factionId: null,
      isSelf: true
    };
  }

  function findMountTarget() {
    const selectors = [
      "#mainContainer .content-wrapper",
      "#mainContainer .content",
      "#mainContainer",
      ".content-wrapper",
      "main",
      "#skip-to-content",
      "body"
    ];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) return el;
    }
    return document.body || null;
  }

  function ensureRoot() {
    ensureStyle();
    const existingRoots = Array.from(document.querySelectorAll(`#${SCRIPT_ID}`));
    for (const node of existingRoots) {
      if (state.root && node === state.root) continue;
      node.parentNode && node.parentNode.removeChild(node);
    }

    if (!state.root) {
      const root = document.createElement("section");
      root.id = SCRIPT_ID;
      root.addEventListener("click", handleRootClick);
      state.root = root;
    }
    const target = findMountTarget();
    if (!target) return null;
    if (state.root.parentNode !== target) {
      target.prepend(state.root);
    }
    applyCollapsedUiState();
    return state.root;
  }

  function removeRoot() {
    if (state.root && state.root.parentNode) {
      state.root.parentNode.removeChild(state.root);
    }
  }

  function isApiKeyReady() {
    const key = String(API_KEY || "").trim();
    if (!key) return false;
    if (key === API_KEY_PLACEHOLDER) return false;
    if (/PDA-APIKEY/i.test(key)) return false;
    return true;
  }

  function chunkList(list, size) {
    const chunks = [];
    for (let i = 0; i < list.length; i += size) {
      chunks.push(list.slice(i, i + size));
    }
    return chunks;
  }

  function toNumber(value) {
    if (value == null) return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms || 0)));
  }

  function isRateLimitError(message) {
    const text = String(message || "").toLowerCase();
    return (
      text.includes("too many requests") ||
      text.includes("rate limit") ||
      text.includes("[5]") ||
      text.includes("[16]")
    );
  }

  async function apiGet(path, params) {
    const url = new URL(`${API_BASE_URL}${path}`);
    if (isApiKeyReady()) {
      url.searchParams.set("key", API_KEY);
    }
    url.searchParams.set("comment", "tpda-faction-intel");

    if (params && typeof params === "object") {
      for (const [key, rawValue] of Object.entries(params)) {
        if (rawValue == null) continue;
        if (Array.isArray(rawValue)) {
          if (!rawValue.length) continue;
          url.searchParams.set(key, rawValue.join(","));
        } else {
          url.searchParams.set(key, String(rawValue));
        }
      }
    }

    const response = await fetch(url.toString(), { method: "GET", credentials: "omit" });
    let payload = null;
    try {
      payload = await response.json();
    } catch (err) {
      throw new Error(`Torn API returned an unreadable response (HTTP ${response.status}).`);
    }
    if (!response.ok) {
      const code = payload && payload.error && payload.error.code != null ? ` [${payload.error.code}]` : "";
      const message = payload && payload.error && payload.error.error
        ? payload.error.error
        : `HTTP ${response.status}`;
      throw new Error(`${message}${code}`);
    }
    if (payload && payload.error) {
      const code = payload.error.code != null ? ` [${payload.error.code}]` : "";
      throw new Error(`${payload.error.error || "Unknown Torn API error."}${code}`);
    }
    return payload;
  }

  function normalizeStatBlock(personalstats) {
    const stats = {};
    if (Array.isArray(personalstats)) {
      for (const row of personalstats) {
        if (!row || typeof row.name !== "string") continue;
        const value = toNumber(row.value);
        if (value == null) continue;
        stats[row.name.toLowerCase()] = value;
      }
      return stats;
    }
    if (personalstats && typeof personalstats === "object") {
      for (const [name, value] of Object.entries(personalstats)) {
        const parsed = toNumber(value);
        if (parsed == null) continue;
        stats[name.toLowerCase()] = parsed;
      }
    }
    return stats;
  }

  function isInvalidStatError(message) {
    return /invalid stat requested/i.test(String(message || ""));
  }

  async function fetchStatsSnapshot(profileId, statNames, timestamp, requestLabel) {
    const requested = (Array.isArray(statNames) ? statNames : [])
      .map((name) => String(name || "").toLowerCase())
      .filter((name) => !!name && !state.invalidStatNames.has(name));
    if (!requested.length) {
      return { stats: {}, invalidStats: [] };
    }

    const chunks = chunkList(requested, 10);
    const merged = {};
    const invalidStats = [];

    for (const chunk of chunks) {
      const params = timestamp == null ? { stat: chunk } : { stat: chunk, timestamp };

      try {
        const payload = await apiGet(`/user/${profileId}/personalstats`, params);
        Object.assign(merged, normalizeStatBlock(payload ? payload.personalstats : null));
        continue;
      } catch (err) {
        const message = err && err.message ? err.message : "Unknown API failure.";
        if (!isInvalidStatError(message)) {
          throw new Error(`${requestLabel} stats request failed: ${message}`);
        }
      }

      // If one stat in a chunk is unsupported, retry each stat individually.
      for (const statName of chunk) {
        const singleParams = timestamp == null ? { stat: [statName] } : { stat: [statName], timestamp };
        try {
          const payload = await apiGet(`/user/${profileId}/personalstats`, singleParams);
          Object.assign(merged, normalizeStatBlock(payload ? payload.personalstats : null));
        } catch (innerErr) {
          const innerMessage = innerErr && innerErr.message ? innerErr.message : "Unknown API failure.";
          if (isInvalidStatError(innerMessage)) {
            invalidStats.push(statName);
            state.invalidStatNames.add(String(statName || "").toLowerCase());
          } else {
            throw new Error(`${requestLabel} stat '${statName}' failed: ${innerMessage}`);
          }
        }
      }
    }
    return {
      stats: merged,
      invalidStats: Array.from(new Set(invalidStats))
    };
  }

  function delta(currentValue, oldValue, allowNegative) {
    const current = toNumber(currentValue);
    const previous = toNumber(oldValue);
    if (current == null || previous == null) return null;
    const value = current - previous;
    if (allowNegative) return value;
    return Math.max(0, value);
  }

  function decimal(value, digits) {
    if (!Number.isFinite(value)) return "--";
    const output = value.toFixed(digits == null ? 2 : digits);
    return output.replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
  }

  function formatInteger(value) {
    if (!Number.isFinite(value)) return "--";
    return new Intl.NumberFormat("en-US").format(Math.round(value));
  }

  function formatDuration(seconds) {
    if (!Number.isFinite(seconds)) return "--";
    let remaining = Math.max(0, Math.floor(seconds));
    const days = Math.floor(remaining / 86400);
    remaining -= days * 86400;
    const hours = Math.floor(remaining / 3600);
    remaining -= hours * 3600;
    const minutes = Math.floor(remaining / 60);
    remaining -= minutes * 60;
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (days > 0 || hours > 0) parts.push(`${hours}h`);
    if (days > 0 || hours > 0 || minutes > 0) parts.push(`${minutes}m`);
    parts.push(`${remaining}s`);
    return parts.join(" ");
  }

  function formatCurrencyCompact(value) {
    if (!Number.isFinite(value)) return "--";
    const sign = value < 0 ? "-" : "";
    const absolute = Math.abs(value);
    const units = [
      { amount: 1e12, suffix: "t" },
      { amount: 1e9, suffix: "b" },
      { amount: 1e6, suffix: "m" },
      { amount: 1e3, suffix: "k" }
    ];
    for (const unit of units) {
      if (absolute >= unit.amount) {
        return `${sign}$${decimal(absolute / unit.amount, 2)}${unit.suffix}`;
      }
    }
    return `${sign}$${formatInteger(absolute)}`;
  }

  function formatMemberName(member) {
    const id = member && member.id != null ? `[${member.id}]` : "";
    const name = member && member.name ? member.name : "Unknown";
    return `${name} ${id}`.trim();
  }

  function sumAccumulator() {
    return { sum: 0, count: 0 };
  }

  function includeAccumulator(acc, value) {
    const numeric = toNumber(value);
    if (numeric == null) return;
    acc.sum += numeric;
    acc.count += 1;
  }

  function byHighest(records, getter, limit) {
    const sorted = records
      .map((record) => ({ record, value: toNumber(getter(record)) }))
      .filter((row) => row.value != null)
      .sort((a, b) => b.value - a.value);
    if (limit == null) return sorted;
    return sorted.slice(0, limit);
  }

  function byLowest(records, getter, limit) {
    const sorted = records
      .map((record) => ({ record, value: toNumber(getter(record)) }))
      .filter((row) => row.value != null)
      .sort((a, b) => a.value - b.value);
    if (limit == null) return sorted;
    return sorted.slice(0, limit);
  }

  function buildMemberModel(current, historic, member) {
    const timePlayed = delta(current.timeplayed, historic.timeplayed, false);
    const xanaxTaken = delta(current.xantaken, historic.xantaken, false);
    const overdoses = delta(current.overdosed, historic.overdosed, false);
    const cansUsed = delta(current.cantaken, historic.cantaken, false);
    const refillEnergy = delta(current.refills, historic.refills, false);
    const refillNerve = delta(current.nerverefills, historic.nerverefills, false);
    const boostersUsed = delta(current.boostersused, historic.boostersused, false);
    const statEnhancers30d = delta(current.statenhancersused, historic.statenhancersused, false);
    const networthGain = delta(current.networth, historic.networth, true);
    const rankedWarHits30d = delta(current.rankedwarhits, historic.rankedwarhits, false);
    const attacksWon30d = delta(current.attackswon, historic.attackswon, false);
    const respectGained30d = delta(current.respectforfaction, historic.respectforfaction, false);

    let miscBoosters = null;
    if (boostersUsed != null && cansUsed != null && statEnhancers30d != null) {
      miscBoosters = Math.max(0, boostersUsed - cansUsed - statEnhancers30d);
    }

    return {
      monthly: {
        timePlayed,
        xanaxTaken,
        overdoses,
        cansUsed,
        refillEnergy,
        refillNerve,
        miscBoosters,
        networthGain,
        statEnhancers30d,
        rankedWarHits30d,
        attacksWon30d,
        respectGained30d
      },
      lifetime: {
        rankedWarHits: toNumber(current.rankedwarhits),
        attacksWon: toNumber(current.attackswon),
        totalRespect: toNumber(current.respectforfaction),
        totalNetworth: toNumber(current.networth),
        totalOverdoses: toNumber(current.overdosed),
        daysInFaction: toNumber(member ? member.days_in_faction : null)
      }
    };
  }

  function aggregateFactionIntel(basic, members, records) {
    const valid = records.filter((row) => row && row.model);
    const failed = records.filter((row) => row && row.error);
    const invalidStats = Array.from(new Set(
      records.flatMap((row) => (row && Array.isArray(row.invalidStats)) ? row.invalidStats : [])
    ));

    const statusBreakdown = {
      online: 0,
      idle: 0,
      offline: 0,
      hospital: 0,
      jail: 0,
      traveling: 0
    };

    for (const member of members) {
      const lastAction = String(member && member.last_action && member.last_action.status || "").toLowerCase();
      if (lastAction === "online") statusBreakdown.online += 1;
      else if (lastAction === "idle") statusBreakdown.idle += 1;
      else if (lastAction === "offline") statusBreakdown.offline += 1;

      const stateValue = String(member && member.status && member.status.state || "").toLowerCase();
      if (stateValue === "hospital") statusBreakdown.hospital += 1;
      else if (stateValue === "jail") statusBreakdown.jail += 1;
      else if (stateValue === "traveling") statusBreakdown.traveling += 1;
    }

    const aTime = sumAccumulator();
    const aXanax = sumAccumulator();
    const aOverdoses = sumAccumulator();
    const aCans = sumAccumulator();
    const aRefillEnergy = sumAccumulator();
    const aRefillNerve = sumAccumulator();
    const aMiscBoosters = sumAccumulator();
    const aNetworthGain = sumAccumulator();
    const aStatEnhancers30d = sumAccumulator();
    const aWarHits30d = sumAccumulator();
    const aAttacksWon30d = sumAccumulator();
    const aRespectGained30d = sumAccumulator();
    const aWarHits = sumAccumulator();
    const aAttacksWon = sumAccumulator();
    const aRespect = sumAccumulator();
    const aOverdosesAllTime = sumAccumulator();
    const aTotalNetworth = sumAccumulator();
    const aDaysInFaction = sumAccumulator();

    for (const row of valid) {
      includeAccumulator(aTime, row.model.monthly.timePlayed);
      includeAccumulator(aXanax, row.model.monthly.xanaxTaken);
      includeAccumulator(aOverdoses, row.model.monthly.overdoses);
      includeAccumulator(aCans, row.model.monthly.cansUsed);
      includeAccumulator(aRefillEnergy, row.model.monthly.refillEnergy);
      includeAccumulator(aRefillNerve, row.model.monthly.refillNerve);
      includeAccumulator(aMiscBoosters, row.model.monthly.miscBoosters);
      includeAccumulator(aNetworthGain, row.model.monthly.networthGain);
      includeAccumulator(aStatEnhancers30d, row.model.monthly.statEnhancers30d);
      includeAccumulator(aWarHits30d, row.model.monthly.rankedWarHits30d);
      includeAccumulator(aAttacksWon30d, row.model.monthly.attacksWon30d);
      includeAccumulator(aRespectGained30d, row.model.monthly.respectGained30d);
      includeAccumulator(aWarHits, row.model.lifetime.rankedWarHits);
      includeAccumulator(aAttacksWon, row.model.lifetime.attacksWon);
      includeAccumulator(aRespect, row.model.lifetime.totalRespect);
      includeAccumulator(aOverdosesAllTime, row.model.lifetime.totalOverdoses);
      includeAccumulator(aTotalNetworth, row.model.lifetime.totalNetworth);
      includeAccumulator(aDaysInFaction, row.model.lifetime.daysInFaction);
    }

    const topXanax = byHighest(valid, (row) => row.model.monthly.xanaxTaken);
    const topNetworthGain = byHighest(valid, (row) => row.model.monthly.networthGain);
    const lowestNetworthGain = byLowest(valid, (row) => row.model.monthly.networthGain);
    const networthLosers = lowestNetworthGain.filter((row) => row.value < 0);
    const topWarHits = byHighest(valid, (row) => row.model.lifetime.rankedWarHits);
    const topRespect = byHighest(valid, (row) => row.model.lifetime.totalRespect);
    const topOverdoses30d = byHighest(valid, (row) => row.model.monthly.overdoses);
    const topOverdosesAllTime = byHighest(valid, (row) => row.model.lifetime.totalOverdoses);
    const topWarHits30d = byHighest(valid, (row) => row.model.monthly.rankedWarHits30d);
    const topAttacksWon30d = byHighest(valid, (row) => row.model.monthly.attacksWon30d);
    const topRespectGained30d = byHighest(valid, (row) => row.model.monthly.respectGained30d);

    return {
      faction: {
        id: basic && basic.id != null ? String(basic.id) : (members[0] && members[0].faction_id != null ? String(members[0].faction_id) : null),
        name: basic && basic.name ? basic.name : "Faction",
        respect: basic ? toNumber(basic.respect) : null
      },
      coverage: {
        totalMembers: members.length,
        scannedMembers: valid.length,
        failedMembers: failed.length
      },
      statusBreakdown,
      totals: {
        timePlayed: aTime.sum,
        xanaxTaken: aXanax.sum,
        overdoses: aOverdoses.sum,
        cansUsed: aCans.sum,
        refillEnergy: aRefillEnergy.sum,
        refillNerve: aRefillNerve.sum,
        miscBoosters: aMiscBoosters.sum,
        networthGain: aNetworthGain.sum,
        statEnhancers30d: aStatEnhancers30d.sum,
        rankedWarHits30d: aWarHits30d.sum,
        attacksWon30d: aAttacksWon30d.sum,
        respectGained30d: aRespectGained30d.sum,
        rankedWarHits: aWarHits.sum,
        attacksWon: aAttacksWon.sum,
        totalRespect: aRespect.sum,
        totalOverdoses: aOverdosesAllTime.sum,
        totalNetworth: aTotalNetworth.sum,
        daysInFaction: aDaysInFaction.sum
      },
      averages: {
        timePlayedHoursPerMemberPerDay: aTime.count ? (aTime.sum / aTime.count) / 3600 / WINDOW_DAYS : null,
        xanaxPerMemberPerDay: aXanax.count ? aXanax.sum / aXanax.count / WINDOW_DAYS : null,
        cansPerMemberPerDay: aCans.count ? aCans.sum / aCans.count / WINDOW_DAYS : null,
        networthGainPerMember: aNetworthGain.count ? aNetworthGain.sum / aNetworthGain.count : null,
        avgDaysInFaction: aDaysInFaction.count ? aDaysInFaction.sum / aDaysInFaction.count : null
      },
      leaders: {
        topXanax,
        topNetworthGain,
        networthLosers: networthLosers.length ? networthLosers : lowestNetworthGain,
        topWarHits,
        topRespect,
        topOverdoses30d,
        topOverdosesAllTime,
        topWarHits30d,
        topAttacksWon30d,
        topRespectGained30d
      },
      failedMembers: failed.map((row) => ({
        id: row.member && row.member.id != null ? String(row.member.id) : "",
        name: row.member && row.member.name ? row.member.name : "Unknown",
        error: row.error
      })),
      invalidStats
    };
  }

  function statRow(label, value, meta, highlight, isLeader) {
    return `
      <div class="tpda-row">
        <div class="tpda-row-left">
          <div class="tpda-row-label${isLeader ? " is-leader" : ""}">${escapeHtml(label)}</div>
          ${meta ? `<div class="tpda-row-meta">${escapeHtml(meta)}</div>` : ""}
        </div>
        <div class="tpda-row-value${highlight ? " tpda-gold" : ""}">${escapeHtml(value)}</div>
      </div>
    `;
  }

  function sectionTable(title, rowsHtml, actionHtml) {
    return `
      <div class="tpda-section">
        <div class="tpda-section-head">
          <div class="tpda-section-title">${escapeHtml(title)}</div>
          ${actionHtml || ""}
        </div>
        <div class="tpda-table">${rowsHtml}</div>
      </div>
    `;
  }

  function leaderboardRows(rows, formatter) {
    if (!rows.length) {
      return statRow("No data available", "--", null, false, true);
    }
    return rows.map((row, index) => {
      const name = `${index + 1}. ${formatMemberName(row.record.member)}`;
      return statRow(name, formatter(row.value), null, false, true);
    }).join("");
  }

  function buildLeaderboardSection(title, tableKey, rows, formatter) {
    const expanded = state.expandedTables.has(tableKey);
    const visible = expanded ? rows : rows.slice(0, LEADERBOARD_LIMIT);
    const rowsHtml = leaderboardRows(visible, formatter);
    const actionHtml = rows.length > LEADERBOARD_LIMIT
      ? `<button class="tpda-btn tpda-mini" data-action="toggle-table" data-table="${escapeHtml(tableKey)}">${expanded ? "Less" : `All (${rows.length})`}</button>`
      : "";
    return sectionTable(title, rowsHtml, actionHtml);
  }

  function renderLoading(context, progress) {
    const root = ensureRoot();
    if (!root) return;
    const titleName = context && context.name ? context.name : "Faction";
    const idLabel = context && context.factionId ? `ID ${context.factionId}` : "Your faction";
    const done = progress && Number.isFinite(progress.done) ? progress.done : 0;
    const total = progress && Number.isFinite(progress.total) ? progress.total : 0;
    const failed = progress && Number.isFinite(progress.failed) ? progress.failed : 0;
    const pct = total > 0 ? Math.max(0, Math.min(100, Math.round((done / total) * 100))) : 0;
    const current = progress && progress.current ? `Now scanning: ${progress.current}` : "Preparing member scan...";

    root.innerHTML = `
      <div class="tpda-head">
        <div>
          <div class="tpda-title">Faction Intel</div>
          <div class="tpda-subtitle">${escapeHtml(titleName)} (${escapeHtml(idLabel)})</div>
        </div>
        <div class="tpda-actions">
          <button class="tpda-btn" data-action="refresh">Refresh</button>
          <button class="tpda-btn" data-action="toggle">Expand</button>
        </div>
      </div>
      <div class="tpda-status is-info">
        ${escapeHtml(`Loading member stats: ${done}/${total}${failed ? `, failed: ${failed}` : ""}`)}
        <div class="tpda-progress-wrap"><div class="tpda-progress-fill" style="width:${pct}%"></div></div>
        <div class="tpda-row-meta">${escapeHtml(current)}</div>
      </div>
    `;
    applyCollapsedUiState();
  }

  function renderError(context, message) {
    const root = ensureRoot();
    if (!root) return;
    const idLabel = context && context.factionId ? `ID ${context.factionId}` : "Unknown faction";
    root.innerHTML = `
      <div class="tpda-head">
        <div>
          <div class="tpda-title">Faction Intel</div>
          <div class="tpda-subtitle">${escapeHtml(idLabel)}</div>
        </div>
        <div class="tpda-actions">
          <button class="tpda-btn" data-action="refresh">Retry</button>
          <button class="tpda-btn" data-action="toggle">Expand</button>
        </div>
      </div>
      <div class="tpda-status is-error">${escapeHtml(message)}</div>
    `;
    applyCollapsedUiState();
  }

  function renderStats(context, model, progress) {
    const root = ensureRoot();
    if (!root) return;
    state.activeContext = context ? Object.assign({}, context) : null;
    state.activeModel = model || null;
    state.activeProgress = progress || null;

    const coverage = model.coverage;
    const totals = model.totals;
    const averages = model.averages;
    const status = model.statusBreakdown;
    const factionName = model.faction.name || (context && context.name) || "Faction";
    const factionId = model.faction.id || (context && context.factionId) || "--";
    const factionRespect = model.faction.respect;

    const invalidStats = (model.invalidStats || []).filter((name) => String(name).toLowerCase() !== "totalworkingstats");
    const warningParts = [];
    if (invalidStats.length) {
      warningParts.push(`Skipped unsupported stat keys: ${invalidStats.join(", ")}`);
    }
    if (coverage.failedMembers > 0) {
      warningParts.push(`Failed member scans: ${coverage.failedMembers}`);
    }
    const warning = warningParts.length
      ? `<div class="tpda-status is-error">${escapeHtml(warningParts.join(" | "))}</div>`
      : "";

    const scanInfo = progress && progress.isScanning
      ? `
        <div class="tpda-status is-info">
          ${escapeHtml(`Background scan: ${progress.done} / ${progress.total} members processed (${progress.queueRemaining} queued). Coverage: ${coverage.scannedMembers} / ${coverage.totalMembers}.`)}
          ${progress.current ? `<div class="tpda-row-meta">${escapeHtml(`Now scanning: ${progress.current}`)}</div>` : ""}
          ${progress.cooldownMs ? `<div class="tpda-row-meta">${escapeHtml(`Rate limit cooldown: ${Math.ceil(progress.cooldownMs / 1000)}s`)}</div>` : ""}
          <div class="tpda-progress-wrap"><div class="tpda-progress-fill" style="width:${Math.max(0, Math.min(100, Math.round((progress.done / Math.max(1, progress.total)) * 100)))}%"></div></div>
        </div>
      `
      : "";

    const quickRows = [
      statRow("Members Scanned", `${formatInteger(coverage.scannedMembers)} / ${formatInteger(coverage.totalMembers)}`, `${formatInteger(coverage.failedMembers)} failed`, false, false),
      statRow(`30-Day Time Played`, formatDuration(totals.timePlayed), null, true, false),
      statRow(`30-Day Xanax Taken`, formatInteger(totals.xanaxTaken), null, true, false),
      statRow(`30-Day Networth Gain`, formatCurrencyCompact(totals.networthGain), null, true, false),
      statRow("Ranked War Hits", formatInteger(totals.rankedWarHits), null, false, false),
      statRow("Total Respect", formatInteger(totals.totalRespect), null, false, false),
      statRow("Faction Respect", formatInteger(factionRespect), null, false, false)
    ].join("");

    const coverageRows = [
      statRow("Members Scanned", `${formatInteger(coverage.scannedMembers)} / ${formatInteger(coverage.totalMembers)}`, `${formatInteger(coverage.failedMembers)} failed`, false, false),
      statRow("Online / Idle / Offline", `${formatInteger(status.online)} / ${formatInteger(status.idle)} / ${formatInteger(status.offline)}`, null, false, false),
      statRow("Hospital / Jail / Travel", `${formatInteger(status.hospital)} / ${formatInteger(status.jail)} / ${formatInteger(status.traveling)}`, null, false, false),
      statRow("Faction Respect", formatInteger(factionRespect), "From faction basic endpoint", false, false)
    ].join("");

    const monthlyRows = [
      statRow("Time Played", formatDuration(totals.timePlayed), `Avg ${decimal(averages.timePlayedHoursPerMemberPerDay, 2)} h / member / day`, true, false),
      statRow("Xanax Taken", formatInteger(totals.xanaxTaken), `Avg ${decimal(averages.xanaxPerMemberPerDay, 2)} / member / day`, true, false),
      statRow("Overdoses", formatInteger(totals.overdoses), null, true, false),
      statRow("Cans Used", formatInteger(totals.cansUsed), `Avg ${decimal(averages.cansPerMemberPerDay, 2)} / member / day`, true, false),
      statRow("Refills", `${formatInteger(totals.refillEnergy)} E + ${formatInteger(totals.refillNerve)} N`, null, true, false),
      statRow("Misc Boosters", formatInteger(totals.miscBoosters), null, true, false),
      statRow("Networth Gain", formatCurrencyCompact(totals.networthGain), `Avg/member ${formatCurrencyCompact(averages.networthGainPerMember)}`, true, false),
      statRow("Stat Enhancers", formatInteger(totals.statEnhancers30d), null, true, false),
      statRow("RW Hits Gained", formatInteger(totals.rankedWarHits30d), null, true, false),
      statRow("Attacks Won Gained", formatInteger(totals.attacksWon30d), null, true, false),
      statRow("Respect Gained", formatInteger(totals.respectGained30d), null, true, false)
    ].join("");

    const lifetimeRows = [
      statRow("Ranked War Hits", formatInteger(totals.rankedWarHits), null, false, false),
      statRow("Attacks Won", formatInteger(totals.attacksWon), null, false, false),
      statRow("Total Respect", formatInteger(totals.totalRespect), null, false, false),
      statRow("All-time Overdoses", formatInteger(totals.totalOverdoses), null, false, false),
      statRow("Total Networth", formatCurrencyCompact(totals.totalNetworth), null, false, false),
      statRow("Avg Days in Faction", decimal(averages.avgDaysInFaction, 1), null, false, false)
    ].join("");

    root.innerHTML = `
      <div class="tpda-head">
        <div>
          <div class="tpda-title">Faction Intel</div>
          <div class="tpda-subtitle">${escapeHtml(factionName)} [${escapeHtml(factionId)}]</div>
        </div>
        <div class="tpda-actions">
          <button class="tpda-btn" data-action="refresh">Refresh</button>
          <button class="tpda-btn" data-action="toggle">Expand</button>
        </div>
      </div>
      ${warning}
      ${scanInfo}
      <div class="tpda-compact">
        ${sectionTable("Quick View", quickRows)}
        <div class="tpda-expand-hint">Tap Expand for full faction intel.</div>
      </div>
      <div class="tpda-expanded">
        ${sectionTable("Coverage", coverageRows)}
        ${sectionTable(`Last ${WINDOW_DAYS} Days`, monthlyRows)}
        ${sectionTable("Current / Lifetime", lifetimeRows)}
        ${buildLeaderboardSection(`Top Xanax (${WINDOW_DAYS}d)`, "xanax30d", model.leaders.topXanax || [], formatInteger)}
        ${buildLeaderboardSection(`Top Networth Gain (${WINDOW_DAYS}d)`, "networthGain30d", model.leaders.topNetworthGain || [], formatCurrencyCompact)}
        ${buildLeaderboardSection(`Networth Losers (${WINDOW_DAYS}d)`, "networthLosers30d", model.leaders.networthLosers || [], formatCurrencyCompact)}
        ${buildLeaderboardSection(`Top Overdoses (${WINDOW_DAYS}d)`, "overdoses30d", model.leaders.topOverdoses30d || [], formatInteger)}
        ${buildLeaderboardSection("Top Overdoses (all-time)", "overdosesAlltime", model.leaders.topOverdosesAllTime || [], formatInteger)}
        ${buildLeaderboardSection(`Top RW Hits Gained (${WINDOW_DAYS}d)`, "warHits30d", model.leaders.topWarHits30d || [], formatInteger)}
        ${buildLeaderboardSection(`Top Attacks Won Gained (${WINDOW_DAYS}d)`, "attacksWon30d", model.leaders.topAttacksWon30d || [], formatInteger)}
        ${buildLeaderboardSection(`Top Respect Gained (${WINDOW_DAYS}d)`, "respect30d", model.leaders.topRespectGained30d || [], formatInteger)}
        ${buildLeaderboardSection("Top Ranked War Hits (all-time)", "warHitsAllTime", model.leaders.topWarHits || [], formatInteger)}
        ${buildLeaderboardSection("Top Respect for Faction (all-time)", "respectAllTime", model.leaders.topRespect || [], formatInteger)}
      </div>
      <div class="tpda-footnote">This panel scans faction members, fetches their public personal stats, and aggregates totals for faction intel. Gold values are ${WINDOW_DAYS}-day activity deltas.</div>
    `;
    applyCollapsedUiState();
  }

  function pruneTimedCache(cache, maxEntries) {
    if (cache.size <= maxEntries) return;
    const entries = Array.from(cache.entries()).sort((a, b) => a[1].time - b[1].time);
    while (entries.length > maxEntries) {
      const [key] = entries.shift();
      cache.delete(key);
    }
  }

  function getFactionApiPath(context, endpoint) {
    if (context && context.factionId) {
      return `/faction/${context.factionId}/${endpoint}`;
    }
    return `/faction/${endpoint}`;
  }

  async function fetchFactionBasics(context) {
    return apiGet(getFactionApiPath(context, "basic"));
  }

  async function fetchFactionMembers(context) {
    return apiGet(getFactionApiPath(context, "members"));
  }

  async function fetchMemberIntel(member, monthAgo, force) {
    const memberId = member && member.id != null ? String(member.id) : "";
    if (!memberId) {
      throw new Error("Member has no valid ID.");
    }

    const cached = state.memberCache.get(memberId);
    if (!force && cached && (Date.now() - cached.time) < MEMBER_CACHE_TTL_MS) {
      return {
        member,
        model: cached.model,
        invalidStats: cached.invalidStats || []
      };
    }

    const currentResult = await fetchStatsSnapshot(memberId, CURRENT_STAT_NAMES, null, "Current");
    await sleep(MEMBER_REQUEST_GAP_MS);
    const historicResult = await fetchStatsSnapshot(memberId, MONTHLY_STAT_NAMES, monthAgo, "Historical");

    const model = buildMemberModel(currentResult.stats || {}, historicResult.stats || {}, member);
    const invalidStats = Array.from(new Set([
      ...(currentResult.invalidStats || []),
      ...(historicResult.invalidStats || [])
    ]));
    const cacheRecord = {
      time: Date.now(),
      model,
      invalidStats
    };
    state.memberCache.set(memberId, cacheRecord);
    pruneTimedCache(state.memberCache, MAX_MEMBER_CACHE_ENTRIES);

    return {
      member,
      model,
      invalidStats
    };
  }

  async function fetchFactionOverview(context, force) {
    const cacheKey = context.cacheKey;
    const cached = state.factionCache.get(cacheKey);
    if (!force && cached && (Date.now() - cached.time) < FACTION_CACHE_TTL_MS) {
      return cached;
    }
    const [basicPayload, membersPayload] = await Promise.all([
      fetchFactionBasics(context),
      fetchFactionMembers(context)
    ]);
    const overview = {
      time: Date.now(),
      basic: basicPayload && basicPayload.basic ? basicPayload.basic : null,
      members: Array.isArray(membersPayload && membersPayload.members) ? membersPayload.members : []
    };
    state.factionCache.set(cacheKey, overview);
    pruneTimedCache(state.factionCache, MAX_FACTION_CACHE_ENTRIES);
    return overview;
  }

  async function fetchFactionData(context, force, onProgress, shouldContinue) {
    const overview = await fetchFactionOverview(context, !!force);
    if (shouldContinue && !shouldContinue()) {
      throw new Error(CANCELLED_ERROR_TOKEN);
    }

    const basic = overview.basic;
    const members = overview.members;
    const now = Date.now();
    const monthAgo = Math.floor(now / 1000) - WINDOW_SECONDS;
    const refreshTtl = force ? FORCE_REFRESH_CACHE_TTL_MS : MEMBER_CACHE_TTL_MS;

    const records = new Array(members.length);
    const queue = [];

    for (let i = 0; i < members.length; i += 1) {
      const member = members[i];
      const memberId = member && member.id != null ? String(member.id) : "";
      const cached = memberId ? state.memberCache.get(memberId) : null;
      const age = cached ? (now - cached.time) : Number.POSITIVE_INFINITY;

      if (cached && cached.model) {
        records[i] = {
          member,
          model: cached.model,
          invalidStats: cached.invalidStats || []
        };
      } else {
        records[i] = { member };
      }

      if (!cached || age >= refreshTtl) {
        queue.push({ member, index: i, retries: 0 });
      }
    }

    let done = 0;
    let failed = records.filter((row) => row && row.error).length;
    let cooldownMs = 0;

    const emitProgress = (currentMemberName) => {
      if (typeof onProgress !== "function") return;
      const model = aggregateFactionIntel(basic, members, records);
      onProgress({
        done,
        total: queue.length,
        queueRemaining: Math.max(0, queue.length - done),
        failed,
        current: currentMemberName || "",
        cooldownMs,
        isScanning: done < queue.length,
        model
      });
    };

    emitProgress("");
    if (!queue.length) {
      const model = aggregateFactionIntel(basic, members, records);
      return { time: Date.now(), model };
    }

    for (let idx = 0; idx < queue.length; idx += 1) {
      if (shouldContinue && !shouldContinue()) {
        throw new Error(CANCELLED_ERROR_TOKEN);
      }

      const item = queue[idx];
      const currentName = formatMemberName(item.member);
      cooldownMs = 0;

      try {
        const row = await fetchMemberIntel(item.member, monthAgo, true);
        records[item.index] = row;
      } catch (err) {
        const message = err && err.message ? err.message : "Failed to fetch member data.";
        if (isRateLimitError(message) && item.retries < MAX_RATE_LIMIT_RETRIES) {
          item.retries += 1;
          cooldownMs = RATE_LIMIT_COOLDOWN_MS * item.retries;
          emitProgress(currentName);
          await sleep(cooldownMs);
          idx -= 1;
          continue;
        }

        records[item.index] = {
          member: item.member,
          error: message,
          invalidStats: []
        };
        failed += 1;
      }

      done += 1;
      emitProgress(currentName);

      if (idx < queue.length - 1) {
        await sleep(MEMBER_SCAN_INTERVAL_MS);
      }
    }

    const model = aggregateFactionIntel(basic, members, records);
    return { time: Date.now(), model };
  }

  async function loadFaction(context, force) {
    const thisRequestId = ++state.requestId;
    const contextCopy = Object.assign({}, context);
    state.activeContext = contextCopy;

    if (!isApiKeyReady()) {
      renderError(contextCopy, "PDA API key is missing. Keep API_KEY as the PDA placeholder token and install this script through Torn PDA UserScripts.");
      return;
    }

    renderLoading(contextCopy, { done: 0, total: 0, failed: 0 });

    try {
      const record = await fetchFactionData(
        contextCopy,
        !!force,
        (progress) => {
          if (thisRequestId !== state.requestId) return;
          if (progress && progress.model) {
            renderStats(contextCopy, progress.model, progress);
          } else {
            renderLoading(contextCopy, progress);
          }
        },
        () => thisRequestId === state.requestId
      );
      if (thisRequestId !== state.requestId) return;
      contextCopy.name = record.model && record.model.faction && record.model.faction.name
        ? record.model.faction.name
        : contextCopy.name;
      renderStats(contextCopy, record.model, {
        isScanning: false,
        done: 0,
        total: 0,
        queueRemaining: 0,
        failed: record.model && record.model.coverage ? record.model.coverage.failedMembers : 0,
        current: "",
        cooldownMs: 0
      });
    } catch (err) {
      if (thisRequestId !== state.requestId) return;
      const message = err && err.message ? err.message : "Failed to load faction intel.";
      if (message === CANCELLED_ERROR_TOKEN) return;
      renderError(contextCopy, message);
    }
  }

  function handleRootClick(event) {
    const refreshButton = event.target.closest("button[data-action='refresh']");
    if (refreshButton) {
      if (!state.context) return;
      loadFaction(state.context, true);
      return;
    }

    const tableToggleButton = event.target.closest("button[data-action='toggle-table']");
    if (tableToggleButton) {
      const tableKey = tableToggleButton.getAttribute("data-table");
      if (!tableKey) return;
      if (state.expandedTables.has(tableKey)) {
        state.expandedTables.delete(tableKey);
      } else {
        state.expandedTables.add(tableKey);
      }
      if (state.activeContext && state.activeModel) {
        renderStats(state.activeContext, state.activeModel, state.activeProgress);
      }
      return;
    }

    const toggleButton = event.target.closest("button[data-action='toggle']");
    if (!toggleButton) return;
    state.collapsed = !state.collapsed;
    persistCollapsedPreference(state.collapsed);
    applyCollapsedUiState();
  }

  function tick() {
    const context = getFactionContext(window.location.href);
    if (!context) {
      state.requestId += 1;
      state.context = null;
      removeRoot();
      return;
    }

    ensureRoot();
    const prev = state.context;
    const changed = !prev || prev.cacheKey !== context.cacheKey;
    state.context = context;

    if (changed) {
      loadFaction(context, false);
      return;
    }

    if (state.root && !document.contains(state.root)) {
      ensureRoot();
    }
  }

  function boot() {
    state.collapsed = readCollapsedPreference();
    tick();
    setInterval(tick, POLL_INTERVAL_MS);
  }

  boot();
})();
