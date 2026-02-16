// ==UserScript==
// @name         Torn Profile Data Panel - Desktop
// @namespace    local.torn.profiledata.desktop
// @version      1.0.0
// @description  Desktop profile stats panel for Torn (Chrome/Tampermonkey).
// @match        https://www.torn.com/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const SCRIPT_ID = "tpdp-desktop-panel";
  const STYLE_ID = "tpdp-desktop-style";
  const API_BASE_URL = "https://api.torn.com/v2";

  // Optional fallback key. Prefer the Set API Key button in the panel.
  const CONFIG_API_KEY = "";

  const WINDOW_DAYS = 30;
  const WINDOW_SECONDS = WINDOW_DAYS * 86400;
  const POLL_INTERVAL_MS = 1200;
  const CACHE_TTL_MS = 5 * 60 * 1000;
  const MAX_CACHE_ENTRIES = 30;

  const LS_API_KEY = "tpdp_desktop_api_key_v1";
  const LS_EXPANDED = "tpdp_desktop_expanded_v1";

  const MONTHLY_STAT_NAMES = [
    "timeplayed",
    "xantaken",
    "overdosed",
    "cantaken",
    "energydrinkused",
    "refills",
    "nerverefills",
    "boostersused",
    "statenhancersused",
    "networth"
  ];

  const CURRENT_STAT_NAMES = [
    "timeplayed",
    "xantaken",
    "overdosed",
    "cantaken",
    "energydrinkused",
    "refills",
    "nerverefills",
    "boostersused",
    "statenhancersused",
    "networth",
    "activestreak",
    "bestactivestreak",
    "rankedwarhits",
    "attackswon",
    "reviveskill",
    "racingskill",
    "respectforfaction",
    "rehabcost"
  ];

  const state = {
    profileId: null,
    requestId: 0,
    root: null,
    cache: new Map(),
    expanded: loadExpandedPreference()
  };

  function loadExpandedPreference() {
    try {
      return localStorage.getItem(LS_EXPANDED) !== "0";
    } catch (err) {
      return true;
    }
  }

  function saveExpandedPreference(isExpanded) {
    try {
      localStorage.setItem(LS_EXPANDED, isExpanded ? "1" : "0");
    } catch (err) {
      // Ignore persistence issues.
    }
  }

  function getStoredApiKey() {
    try {
      return String(localStorage.getItem(LS_API_KEY) || "").trim();
    } catch (err) {
      return "";
    }
  }

  function getApiKey() {
    const stored = getStoredApiKey();
    if (stored) return stored;
    const configured = String(CONFIG_API_KEY || "").trim();
    if (!configured) return "";
    if (/^(put|paste|your).*(key)/i.test(configured)) return "";
    return configured;
  }

  function isApiKeyReady() {
    return getApiKey().length > 0;
  }

  function setStoredApiKey(rawKey) {
    const key = String(rawKey || "").trim();
    try {
      if (key) {
        localStorage.setItem(LS_API_KEY, key);
      } else {
        localStorage.removeItem(LS_API_KEY);
      }
    } catch (err) {
      // Ignore storage failures.
    }
  }

  function promptForApiKey() {
    const current = getStoredApiKey() || getApiKey();
    const input = window.prompt(
      "Enter your Torn API key.\nLeave blank and press OK to clear stored key.",
      current || ""
    );
    if (input === null) return false;
    setStoredApiKey(input);
    state.cache.clear();
    return true;
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${SCRIPT_ID} {
        box-sizing: border-box;
        width: min(100%, 980px);
        margin: 10px auto;
        padding: 12px 14px;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.10);
        background: rgba(14, 14, 18, 0.96);
        color: #ffffff;
        font-family: Inter, Arial, sans-serif;
        line-height: 1.2;
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
        overflow: hidden;
      }
      #${SCRIPT_ID} * {
        box-sizing: border-box;
      }
      #${SCRIPT_ID} .tpdp-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        flex-wrap: wrap;
      }
      #${SCRIPT_ID} .tpdp-heading {
        min-width: 0;
      }
      #${SCRIPT_ID} .tpdp-title {
        font-size: 18px;
        font-weight: 700;
        color: #ffffff;
      }
      #${SCRIPT_ID} .tpdp-subtitle {
        margin-top: 2px;
        font-size: 12px;
        color: #ffffff;
      }
      #${SCRIPT_ID} .tpdp-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
      }
      #${SCRIPT_ID} .tpdp-btn {
        border: 1px solid #505050;
        background: #2a2a2a;
        color: #ffffff;
        border-radius: 6px;
        padding: 4px 10px;
        font-size: 12px;
        cursor: pointer;
      }
      #${SCRIPT_ID} .tpdp-btn:hover {
        background: #343434;
      }
      #${SCRIPT_ID} .tpdp-status {
        margin-top: 10px;
        padding: 8px 10px;
        border-radius: 6px;
        font-size: 12px;
      }
      #${SCRIPT_ID} .tpdp-status.error {
        border: 1px solid rgba(222, 98, 98, 0.5);
        background: rgba(140, 50, 50, 0.22);
        color: #ffffff;
      }
      #${SCRIPT_ID} .tpdp-status.info {
        border: 1px solid rgba(110, 156, 219, 0.45);
        background: rgba(56, 82, 128, 0.24);
        color: #ffffff;
      }
      #${SCRIPT_ID} .tpdp-highlights {
        margin-top: 10px;
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 8px;
      }
      #${SCRIPT_ID} .tpdp-highlight {
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.03);
        padding: 8px;
      }
      #${SCRIPT_ID} .tpdp-highlight-label {
        font-size: 11px;
        color: #ffffff;
      }
      #${SCRIPT_ID} .tpdp-highlight-value {
        margin-top: 3px;
        font-size: 20px;
        font-weight: 700;
        color: #ffffff;
      }
      #${SCRIPT_ID} .tpdp-highlight-value.gold {
        color: #d7a544;
      }
      #${SCRIPT_ID} .tpdp-highlight-sub {
        margin-top: 3px;
        font-size: 11px;
        color: #ffffff;
      }
      #${SCRIPT_ID} .tpdp-sections {
        margin-top: 10px;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }
      #${SCRIPT_ID} .tpdp-section {
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.02);
        padding: 8px 10px;
        min-width: 0;
      }
      #${SCRIPT_ID} .tpdp-section-title {
        margin-bottom: 6px;
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        color: #ffffff;
        font-weight: 700;
      }
      #${SCRIPT_ID} .tpdp-table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
      }
      #${SCRIPT_ID} .tpdp-table tbody tr + tr td {
        border-top: 1px dotted rgba(255, 255, 255, 0.14);
      }
      #${SCRIPT_ID} .tpdp-table td {
        padding: 4px 2px;
        font-size: 12px;
        color: #ffffff;
        vertical-align: middle;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #${SCRIPT_ID} .tpdp-table.has-meta .tpdp-key {
        width: 44%;
      }
      #${SCRIPT_ID} .tpdp-table.has-meta .tpdp-value {
        width: 28%;
      }
      #${SCRIPT_ID} .tpdp-table.has-meta .tpdp-meta {
        width: 28%;
      }
      #${SCRIPT_ID} .tpdp-table.no-meta .tpdp-key {
        width: 64%;
      }
      #${SCRIPT_ID} .tpdp-table.no-meta .tpdp-value {
        width: 36%;
      }
      #${SCRIPT_ID} .tpdp-key {
        color: #ffffff;
      }
      #${SCRIPT_ID} .tpdp-value {
        text-align: right;
        font-size: 13px;
        font-weight: 700;
        color: #ffffff;
      }
      #${SCRIPT_ID} .tpdp-value.gold {
        color: #d7a544;
      }
      #${SCRIPT_ID} .tpdp-meta {
        text-align: right;
        color: #ffffff;
      }
      #${SCRIPT_ID} .tpdp-foot {
        margin-top: 10px;
        font-size: 12px;
        color: #ffffff;
      }

      @media (max-width: 1100px) {
        #${SCRIPT_ID} .tpdp-highlights {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        #${SCRIPT_ID} .tpdp-sections {
          grid-template-columns: 1fr;
        }
      }

      @media (max-width: 700px) {
        #${SCRIPT_ID} {
          width: min(100%, calc(100vw - 10px));
          margin: 6px auto;
          padding: 8px;
        }
        #${SCRIPT_ID} .tpdp-title {
          font-size: 15px;
        }
        #${SCRIPT_ID} .tpdp-highlight-value {
          font-size: 17px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function isProfilePage(urlText) {
    return /profiles\.php/i.test(urlText) || /(?:\?|&)sid=profiles(?:&|$)/i.test(urlText) || /(?:\?|&)step=profile(?:&|$)/i.test(urlText);
  }

  function getIdFromUrl(urlText) {
    if (!isProfilePage(urlText)) return null;

    const tryMatch = (text) => {
      const match = String(text || "").match(/(?:XID|xid|user2ID|user2id|userid|userId|ID|id)=([0-9]{1,12})/);
      return match ? match[1] : null;
    };

    try {
      const url = new URL(urlText);
      const keys = ["XID", "xid", "user2ID", "user2id", "userid", "userId", "ID", "id"];
      for (const key of keys) {
        const raw = url.searchParams.get(key);
        if (raw && /^[0-9]{1,12}$/.test(raw)) return raw;
      }
      const hashId = tryMatch(url.hash || "");
      if (hashId) return hashId;
    } catch (err) {
      const fallbackId = tryMatch(urlText);
      if (fallbackId) return fallbackId;
    }

    const domCandidates = [
      'a[href*="profiles.php?XID="]',
      'a[href*="user2ID="]',
      'a[href*="XID="]'
    ];
    for (const selector of domCandidates) {
      const anchor = document.querySelector(selector);
      if (!anchor || !anchor.href) continue;
      const anchorId = tryMatch(anchor.href);
      if (anchorId) return anchorId;
    }

    return null;
  }

  function findMountTarget() {
    const selectors = [
      "#mainContainer .content-wrapper",
      "#mainContainer .content",
      "#mainContainer",
      ".content-wrapper",
      "main",
      "body"
    ];
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (node) return node;
    }
    return document.body || null;
  }

  function ensureRoot() {
    ensureStyle();
    if (!state.root) {
      const root = document.createElement("section");
      root.id = SCRIPT_ID;
      root.addEventListener("click", handleRootClick);
      state.root = root;
    }
    const mount = findMountTarget();
    if (!mount) return null;
    if (state.root.parentNode !== mount) {
      mount.prepend(state.root);
    }
    return state.root;
  }

  function removeRoot() {
    if (state.root && state.root.parentNode) {
      state.root.parentNode.removeChild(state.root);
    }
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
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m`;
    return `${remaining}s`;
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

  async function apiGet(path, params) {
    const key = getApiKey();
    if (!key) throw new Error("No API key configured.");

    const url = new URL(`${API_BASE_URL}${path}`);
    url.searchParams.set("key", key);
    url.searchParams.set("comment", "profile-data-desktop");

    if (params && typeof params === "object") {
      for (const [name, rawValue] of Object.entries(params)) {
        if (rawValue == null) continue;
        if (Array.isArray(rawValue)) {
          if (!rawValue.length) continue;
          url.searchParams.set(name, rawValue.join(","));
        } else {
          url.searchParams.set(name, String(rawValue));
        }
      }
    }

    const response = await fetch(url.toString(), { method: "GET", credentials: "omit" });
    let payload = null;
    try {
      payload = await response.json();
    } catch (err) {
      throw new Error(`Torn API returned invalid JSON (HTTP ${response.status}).`);
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
    const out = {};
    if (Array.isArray(personalstats)) {
      for (const row of personalstats) {
        if (!row || typeof row.name !== "string") continue;
        const value = toNumber(row.value);
        if (value == null) continue;
        out[row.name.toLowerCase()] = value;
      }
      return out;
    }
    if (personalstats && typeof personalstats === "object") {
      for (const [name, value] of Object.entries(personalstats)) {
        const parsed = toNumber(value);
        if (parsed == null) continue;
        out[name.toLowerCase()] = parsed;
      }
    }
    return out;
  }

  function isInvalidStatError(message) {
    return /invalid stat requested/i.test(String(message || ""));
  }

  async function fetchStatsSnapshot(profileId, statNames, timestamp, label) {
    const chunks = chunkList(statNames, 10);
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
          throw new Error(`${label} stats request failed: ${message}`);
        }
      }

      for (const statName of chunk) {
        const singleParams = timestamp == null ? { stat: [statName] } : { stat: [statName], timestamp };
        try {
          const payload = await apiGet(`/user/${profileId}/personalstats`, singleParams);
          Object.assign(merged, normalizeStatBlock(payload ? payload.personalstats : null));
        } catch (innerErr) {
          const message = innerErr && innerErr.message ? innerErr.message : "Unknown API failure.";
          if (isInvalidStatError(message)) {
            invalidStats.push(statName);
          } else {
            throw new Error(`${label} stat '${statName}' failed: ${message}`);
          }
        }
      }
    }

    return {
      stats: merged,
      invalidStats: Array.from(new Set(invalidStats))
    };
  }

  function readNested(source, path) {
    if (!source || typeof source !== "object") return null;
    let current = source;
    for (const part of path) {
      if (!current || typeof current !== "object" || !(part in current)) return null;
      current = current[part];
    }
    return toNumber(current);
  }

  function flattenPopularStats(personalstats) {
    const out = {};
    if (!personalstats || typeof personalstats !== "object") return out;

    const map = [
      ["timeplayed", ["other", "activity", "time"]],
      ["activestreak", ["other", "activity", "streak", "current"]],
      ["bestactivestreak", ["other", "activity", "streak", "best"]],
      ["refills", ["other", "refills", "energy"]],
      ["nerverefills", ["other", "refills", "nerve"]],
      ["xantaken", ["drugs", "xanax"]],
      ["overdosed", ["drugs", "overdoses"]],
      ["rehabcost", ["drugs", "rehabilitations", "fees"]],
      ["attackswon", ["attacking", "attacks", "won"]],
      ["rankedwarhits", ["attacking", "faction", "ranked_war_hits"]],
      ["respectforfaction", ["attacking", "faction", "respect"]],
      ["reviveskill", ["hospital", "reviving", "skill"]],
      ["boostersused", ["items", "used", "boosters"]],
      ["cantaken", ["items", "used", "energy_drinks"]],
      ["energydrinkused", ["items", "used", "energy_drinks"]],
      ["statenhancersused", ["items", "used", "stat_enhancers"]]
    ];

    for (const [key, path] of map) {
      const value = readNested(personalstats, path);
      if (value != null) out[key] = value;
    }
    return out;
  }

  async function fetchPopularStatsSnapshot(profileId, timestamp) {
    try {
      const params = timestamp == null ? { cat: "popular" } : { cat: "popular", timestamp };
      const payload = await apiGet(`/user/${profileId}/personalstats`, params);
      return flattenPopularStats(payload ? payload.personalstats : null);
    } catch (err) {
      return {};
    }
  }

  async function fetchJobsStatsSnapshot(profileId) {
    try {
      const payload = await apiGet(`/user/${profileId}/personalstats`, { cat: "jobs" });
      const personal = payload ? payload.personalstats : null;
      const out = {};
      const total = readNested(personal, ["jobs", "stats", "total"]);
      const manual = readNested(personal, ["jobs", "stats", "manual"]);
      const intelligence = readNested(personal, ["jobs", "stats", "intelligence"]);
      const endurance = readNested(personal, ["jobs", "stats", "endurance"]);

      if (total != null) out.totalworkstats = total;
      if (manual != null) out.manuallabor = manual;
      if (intelligence != null) out.intelligence = intelligence;
      if (endurance != null) out.endurance = endurance;
      return out;
    } catch (err) {
      return {};
    }
  }

  async function fetchDaysInFaction(profileId) {
    try {
      const payload = await apiGet(`/user/${profileId}/faction`);
      const days = payload && payload.faction ? toNumber(payload.faction.days_in_faction) : null;
      return days == null ? null : Math.max(0, Math.floor(days));
    } catch (err) {
      return null;
    }
  }

  function pickStatValue(source, keys) {
    if (!source || typeof source !== "object") return null;
    for (const key of keys) {
      const value = toNumber(source[key]);
      if (value != null) return value;
    }
    return null;
  }

  function pickDeltaByKeys(current, historic, keys, options) {
    const config = options || {};
    const currentValue = pickStatValue(current, keys);
    const historicValue = pickStatValue(historic, keys);

    if (currentValue == null && historicValue == null) {
      return config.whenMissing == null ? null : config.whenMissing;
    }
    if (currentValue == null || historicValue == null) {
      if (!config.missingAsZero) return null;
    }

    const c = currentValue == null ? 0 : currentValue;
    const h = historicValue == null ? 0 : historicValue;
    const raw = c - h;
    if (config.allowNegative) return raw;
    return Math.max(0, raw);
  }

  function buildModel(current, historic, daysInFaction) {
    const timePlayed = pickDeltaByKeys(current, historic, ["timeplayed"], { missingAsZero: false });
    const xanaxTaken = pickDeltaByKeys(current, historic, ["xantaken"], { missingAsZero: false });
    const overdoses = pickDeltaByKeys(current, historic, ["overdosed"], { missingAsZero: false });
    const cansUsed = pickDeltaByKeys(current, historic, ["cantaken", "energydrinkused"], { missingAsZero: false });
    const refillEnergy = pickDeltaByKeys(current, historic, ["refills"], { missingAsZero: false });
    const refillNerve = pickDeltaByKeys(current, historic, ["nerverefills"], { missingAsZero: false });
    const boostersUsed = pickDeltaByKeys(current, historic, ["boostersused"], { missingAsZero: false });
    const statEnhancers30d = pickDeltaByKeys(current, historic, ["statenhancersused"], { missingAsZero: false });
    const networthGain = pickDeltaByKeys(current, historic, ["networth"], { allowNegative: true, missingAsZero: false });

    let miscBoosters = null;
    if (boostersUsed != null && cansUsed != null && statEnhancers30d != null) {
      miscBoosters = Math.max(0, boostersUsed - cansUsed - statEnhancers30d);
    }

    const xanaxWithoutOdDaily = (xanaxTaken != null && overdoses != null)
      ? xanaxTaken / Math.max(1, WINDOW_DAYS - overdoses)
      : null;

    const manualLabor = pickStatValue(current, ["manuallabor", "manual_labor", "manual"]);
    const intelligence = pickStatValue(current, ["intelligence"]);
    const endurance = pickStatValue(current, ["endurance"]);
    const totalWorkStatsFromApi = pickStatValue(current, ["totalworkstats"]);
    const totalWorkStats = totalWorkStatsFromApi != null
      ? totalWorkStatsFromApi
      : (manualLabor != null || intelligence != null || endurance != null)
          ? (manualLabor || 0) + (intelligence || 0) + (endurance || 0)
          : null;

    return {
      monthly: {
        timePlayed,
        timePlayedDailyHours: timePlayed == null ? null : (timePlayed / 3600) / WINDOW_DAYS,
        xanaxTaken,
        xanaxDaily: xanaxTaken == null ? null : xanaxTaken / WINDOW_DAYS,
        overdoses,
        xanaxWithoutOdDaily,
        cansUsed,
        cansDaily: cansUsed == null ? null : cansUsed / WINDOW_DAYS,
        refillEnergy,
        refillNerve,
        miscBoosters,
        networthGain,
        statEnhancers30d
      },
      lifetime: {
        activeStreak: pickStatValue(current, ["activestreak"]),
        bestActiveStreak: pickStatValue(current, ["bestactivestreak"]),
        rankedWarHits: pickStatValue(current, ["rankedwarhits"]),
        attacksWon: pickStatValue(current, ["attackswon"]),
        reviveSkill: pickStatValue(current, ["reviveskill"]),
        racingSkill: pickStatValue(current, ["racingskill"]),
        totalNetworth: pickStatValue(current, ["networth"]),
        statEnhancersLifetime: pickStatValue(current, ["statenhancersused"]),
        totalRespect: pickStatValue(current, ["respectforfaction"]),
        daysInFaction,
        spentOnRehab: pickStatValue(current, ["rehabcost"]),
        totalWorkStats
      }
    };
  }

  function formatRefills(energy, nerve) {
    const e = toNumber(energy);
    const n = toNumber(nerve);
    if (e == null && n == null) return "--";
    if (e == null) return `${formatInteger(n)}N`;
    if (n == null) return `${formatInteger(e)}E`;
    return `${formatInteger(e)}E + ${formatInteger(n)}N`;
  }

  function tableRowsHtml(rows, includeMeta) {
    return rows
      .filter(row => !(row.hideWhenMissing && row.raw == null))
      .map(row => {
        const metaCell = includeMeta
          ? `<td class="tpdp-meta">${escapeHtml(row.meta || "-")}</td>`
          : "";
        return `
          <tr>
            <td class="tpdp-key">${escapeHtml(row.label)}</td>
            <td class="tpdp-value${row.highlight ? " gold" : ""}">${escapeHtml(row.value)}</td>
            ${metaCell}
          </tr>
        `;
      })
      .join("");
  }

  function sectionTableHtml(title, rows, includeMeta) {
    return `
      <section class="tpdp-section">
        <div class="tpdp-section-title">${escapeHtml(title)}</div>
        <table class="tpdp-table ${includeMeta ? "has-meta" : "no-meta"}">
          <tbody>${tableRowsHtml(rows, includeMeta)}</tbody>
        </table>
      </section>
    `;
  }

  function highlightHtml(label, value, sub, isGold) {
    return `
      <div class="tpdp-highlight">
        <div class="tpdp-highlight-label">${escapeHtml(label)}</div>
        <div class="tpdp-highlight-value${isGold ? " gold" : ""}">${escapeHtml(value)}</div>
        <div class="tpdp-highlight-sub">${escapeHtml(sub || "-")}</div>
      </div>
    `;
  }

  function renderHeader(profileId) {
    const toggleText = state.expanded ? "Collapse" : "Expand";
    const keyText = isApiKeyReady() ? "Change Key" : "Set API Key";

    return `
      <div class="tpdp-head">
        <div class="tpdp-heading">
          <div class="tpdp-title">Profile Data (Desktop)</div>
          <div class="tpdp-subtitle">User ID ${escapeHtml(profileId)}</div>
        </div>
        <div class="tpdp-actions">
          <button class="tpdp-btn" data-action="refresh">Refresh</button>
          <button class="tpdp-btn" data-action="toggle">${toggleText}</button>
          <button class="tpdp-btn" data-action="set-key">${keyText}</button>
        </div>
      </div>
    `;
  }

  function renderLoading(profileId) {
    const root = ensureRoot();
    if (!root) return;
    root.innerHTML = `
      ${renderHeader(profileId)}
      <div class="tpdp-status info">Loading profile stats from Torn API...</div>
    `;
  }

  function renderError(profileId, message) {
    const root = ensureRoot();
    if (!root) return;
    root.innerHTML = `
      ${renderHeader(profileId)}
      <div class="tpdp-status error">${escapeHtml(message)}</div>
    `;
  }

  function renderNoKey(profileId) {
    const root = ensureRoot();
    if (!root) return;
    root.innerHTML = `
      ${renderHeader(profileId)}
      <div class="tpdp-status error">
        No API key configured for desktop script. Click <b>Set API Key</b> and paste your Torn API key.
      </div>
    `;
  }

  function renderStats(profileId, model, invalidStats) {
    const monthly = model.monthly;
    const lifetime = model.lifetime;

    const monthlyRows = [
      {
        raw: monthly.timePlayed,
        label: "Time Played",
        value: formatDuration(monthly.timePlayed),
        meta: `${decimal(monthly.timePlayedDailyHours, 2)}h/day`,
        highlight: true
      },
      {
        raw: monthly.xanaxTaken,
        label: "Xanax Taken",
        value: formatInteger(monthly.xanaxTaken),
        meta: `${decimal(monthly.xanaxDaily, 2)}/day`,
        highlight: true
      },
      {
        raw: monthly.overdoses,
        label: "Overdoses",
        value: formatInteger(monthly.overdoses),
        meta: `Without ODs ${decimal(monthly.xanaxWithoutOdDaily, 2)}/day`,
        highlight: true
      },
      {
        raw: monthly.cansUsed,
        label: "Cans Used",
        value: formatInteger(monthly.cansUsed),
        meta: `${decimal(monthly.cansDaily, 2)}/day`,
        highlight: true
      },
      {
        raw: monthly.refillEnergy != null || monthly.refillNerve != null ? 1 : null,
        label: "Refills",
        value: formatRefills(monthly.refillEnergy, monthly.refillNerve),
        meta: null,
        highlight: true
      },
      {
        raw: monthly.miscBoosters,
        label: "Misc Boosters",
        value: formatInteger(monthly.miscBoosters),
        meta: null,
        highlight: true
      },
      {
        raw: monthly.networthGain,
        label: "Networth Gain",
        value: formatCurrencyCompact(monthly.networthGain),
        meta: null,
        highlight: true
      },
      {
        raw: monthly.statEnhancers30d,
        label: "Stat Enhancers",
        value: formatInteger(monthly.statEnhancers30d),
        meta: null,
        highlight: true
      }
    ];

    const lifetimeRows = [
      {
        raw: lifetime.activeStreak,
        label: "Activity Streak",
        value: `${formatInteger(lifetime.activeStreak)} (Best ${formatInteger(lifetime.bestActiveStreak)})`,
        meta: null
      },
      {
        raw: lifetime.rankedWarHits,
        label: "Ranked War Hits",
        value: formatInteger(lifetime.rankedWarHits),
        meta: null
      },
      {
        raw: lifetime.attacksWon,
        label: "Attacks Won",
        value: formatInteger(lifetime.attacksWon),
        meta: null
      },
      {
        raw: lifetime.reviveSkill,
        label: "Revive Skill",
        value: decimal(lifetime.reviveSkill, 2),
        meta: null
      },
      {
        raw: lifetime.racingSkill,
        label: "Racing Skill",
        value: decimal(lifetime.racingSkill, 2),
        meta: null
      },
      {
        raw: lifetime.totalNetworth,
        label: "Total Networth",
        value: formatCurrencyCompact(lifetime.totalNetworth),
        meta: null
      },
      {
        raw: lifetime.statEnhancersLifetime,
        label: "Lifetime SE Usage",
        value: formatInteger(lifetime.statEnhancersLifetime),
        meta: null
      },
      {
        raw: lifetime.totalRespect,
        label: "Total Respect",
        value: formatInteger(lifetime.totalRespect),
        meta: null
      },
      {
        raw: lifetime.daysInFaction,
        label: "Days in Faction",
        value: formatInteger(lifetime.daysInFaction),
        meta: null
      },
      {
        raw: lifetime.spentOnRehab,
        label: "Spent on Rehab",
        value: formatCurrencyCompact(lifetime.spentOnRehab),
        meta: null
      },
      {
        raw: lifetime.totalWorkStats,
        label: "Total Work Stats",
        value: formatInteger(lifetime.totalWorkStats),
        meta: null,
        hideWhenMissing: true
      }
    ];

    const highlights = [
      highlightHtml("Time Played", formatDuration(monthly.timePlayed), `${decimal(monthly.timePlayedDailyHours, 2)} hours/day`, true),
      highlightHtml("Xanax Taken", formatInteger(monthly.xanaxTaken), `${decimal(monthly.xanaxDaily, 2)} per day`, true),
      highlightHtml("Overdoses", formatInteger(monthly.overdoses), `Without ODs ${decimal(monthly.xanaxWithoutOdDaily, 2)}/day`, true),
      highlightHtml("Networth Gain", formatCurrencyCompact(monthly.networthGain), `Last ${WINDOW_DAYS} days`, true)
    ].join("");

    const invalidBanner = Array.isArray(invalidStats) && invalidStats.length
      ? `<div class="tpdp-status info">Skipped unsupported stat keys: ${escapeHtml(invalidStats.join(", "))}</div>`
      : "";

    const root = ensureRoot();
    if (!root) return;

    if (!state.expanded) {
      const quickRows = [
        { raw: monthly.timePlayed, label: "30-Day Time Played", value: formatDuration(monthly.timePlayed) },
        { raw: monthly.xanaxTaken, label: "30-Day Xanax Taken", value: formatInteger(monthly.xanaxTaken) },
        { raw: monthly.overdoses, label: "30-Day Overdoses", value: formatInteger(monthly.overdoses) },
        { raw: monthly.networthGain, label: "30-Day Networth Gain", value: formatCurrencyCompact(monthly.networthGain), highlight: true },
        { raw: lifetime.totalNetworth, label: "Total Networth", value: formatCurrencyCompact(lifetime.totalNetworth) },
        { raw: lifetime.attacksWon, label: "Attacks Won", value: formatInteger(lifetime.attacksWon) },
        { raw: lifetime.totalRespect, label: "Total Respect", value: formatInteger(lifetime.totalRespect) },
        { raw: lifetime.daysInFaction, label: "Days in Faction", value: formatInteger(lifetime.daysInFaction) }
      ];

      root.innerHTML = `
        ${renderHeader(profileId)}
        ${invalidBanner}
        ${sectionTableHtml("Quick View", quickRows, false)}
        <div class="tpdp-foot">Click Expand for full desktop table.</div>
      `;
      return;
    }

    root.innerHTML = `
      ${renderHeader(profileId)}
      ${invalidBanner}
      <div class="tpdp-highlights">${highlights}</div>
      <div class="tpdp-sections">
        ${sectionTableHtml(`Last ${WINDOW_DAYS} Days`, monthlyRows, true)}
        ${sectionTableHtml("Current / Lifetime", lifetimeRows, false)}
      </div>
      <div class="tpdp-foot">Gold values represent activity in the last ${WINDOW_DAYS} days.</div>
    `;
  }

  function pruneCache() {
    if (state.cache.size <= MAX_CACHE_ENTRIES) return;
    const entries = Array.from(state.cache.entries()).sort((a, b) => a[1].time - b[1].time);
    while (entries.length > MAX_CACHE_ENTRIES) {
      const [key] = entries.shift();
      state.cache.delete(key);
    }
  }

  async function fetchProfileData(profileId, force) {
    const cached = state.cache.get(profileId);
    if (!force && cached && (Date.now() - cached.time) < CACHE_TTL_MS) {
      return cached;
    }

    const monthAgo = Math.floor(Date.now() / 1000) - WINDOW_SECONDS;

    const [currentResult, historicResult, currentPopular, historicPopular, currentJobs, daysInFaction] = await Promise.all([
      fetchStatsSnapshot(profileId, CURRENT_STAT_NAMES, null, "Current"),
      fetchStatsSnapshot(profileId, MONTHLY_STAT_NAMES, monthAgo, "Historical"),
      fetchPopularStatsSnapshot(profileId, null),
      fetchPopularStatsSnapshot(profileId, monthAgo),
      fetchJobsStatsSnapshot(profileId),
      fetchDaysInFaction(profileId)
    ]);

    const invalidStats = Array.from(new Set([
      ...(currentResult.invalidStats || []),
      ...(historicResult.invalidStats || [])
    ]));
    if (invalidStats.length) {
      console.warn("[TPDP Desktop] Skipped unsupported stats:", invalidStats.join(", "));
    }

    const currentStats = {
      ...(currentPopular || {}),
      ...(currentJobs || {}),
      ...(currentResult.stats || {})
    };
    const historicStats = {
      ...(historicPopular || {}),
      ...(historicResult.stats || {})
    };

    const model = buildModel(currentStats, historicStats, daysInFaction);
    const record = { time: Date.now(), model, invalidStats };
    state.cache.set(profileId, record);
    pruneCache();
    return record;
  }

  async function loadProfile(profileId, force) {
    const thisRequestId = ++state.requestId;
    if (!isApiKeyReady()) {
      renderNoKey(profileId);
      return;
    }

    renderLoading(profileId);
    try {
      const record = await fetchProfileData(profileId, !!force);
      if (thisRequestId !== state.requestId) return;
      renderStats(profileId, record.model, record.invalidStats);
    } catch (err) {
      if (thisRequestId !== state.requestId) return;
      const message = err && err.message ? err.message : "Failed to load profile data.";
      renderError(profileId, message);
    }
  }

  function handleRootClick(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const action = button.getAttribute("data-action");

    if (action === "toggle") {
      state.expanded = !state.expanded;
      saveExpandedPreference(state.expanded);
      if (state.profileId) {
        const cached = state.cache.get(state.profileId);
        if (cached && cached.model) {
          renderStats(state.profileId, cached.model, cached.invalidStats || []);
        } else {
          loadProfile(state.profileId, false);
        }
      }
      return;
    }

    if (action === "set-key") {
      const changed = promptForApiKey();
      if (!changed) return;
      if (state.profileId) {
        loadProfile(state.profileId, true);
      }
      return;
    }

    if (action === "refresh") {
      if (!state.profileId) return;
      loadProfile(state.profileId, true);
    }
  }

  function tick() {
    const href = window.location.href;
    const profileId = getIdFromUrl(href);

    if (!profileId) {
      state.requestId += 1;
      state.profileId = null;
      removeRoot();
      return;
    }

    ensureRoot();
    if (profileId !== state.profileId) {
      state.profileId = profileId;
      loadProfile(profileId, false);
    } else if (state.root && !document.contains(state.root)) {
      ensureRoot();
    }
  }

  function boot() {
    tick();
    setInterval(tick, POLL_INTERVAL_MS);
  }

  boot();
})();
