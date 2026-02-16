// ==UserScript==
// @name         Torn PDA - Profile Data Panel
// @namespace    local.torn.pda.profiledata
// @version      0.2.0
// @description  Mobile-friendly profile stats panel for Torn PDA.
// @match        https://www.torn.com/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const SCRIPT_ID = "tpda-profile-data-panel";
  const STYLE_ID = "tpda-profile-data-style";
  const API_BASE_URL = "https://api.torn.com/v2";
  const API_KEY = "###PDA-APIKEY###";
  const API_KEY_PLACEHOLDER = `${"#".repeat(3)}PDA-APIKEY${"#".repeat(3)}`;
  const WINDOW_DAYS = 30;
  const WINDOW_SECONDS = WINDOW_DAYS * 86400;
  const POLL_INTERVAL_MS = 1200;
  const CACHE_TTL_MS = 5 * 60 * 1000;
  const MAX_CACHE_ENTRIES = 30;
  const LS_EXPANDED_KEY = "tpda_profile_data_expanded_v1";

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
      return localStorage.getItem(LS_EXPANDED_KEY) === "1";
    } catch (err) {
      return false;
    }
  }

  function saveExpandedPreference(isExpanded) {
    try {
      localStorage.setItem(LS_EXPANDED_KEY, isExpanded ? "1" : "0");
    } catch (err) {
      // Ignore storage failures.
    }
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${SCRIPT_ID} {
        box-sizing: border-box;
        width: calc(100vw - 2px);
        max-width: 860px;
        margin: 1px auto;
        padding: 3px 4px;
        border-radius: 5px;
        border: 1px solid rgba(255, 255, 255, 0.07);
        background: rgba(14, 14, 18, 0.95);
        color: #e5e5e5;
        font-family: Arial, sans-serif;
        line-height: 1.1;
      }
      #${SCRIPT_ID} * {
        box-sizing: border-box;
      }
      #${SCRIPT_ID} .tpda-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 4px;
        margin-bottom: 2px;
      }
      #${SCRIPT_ID} .tpda-title {
        font-size: 12px;
        font-weight: 700;
      }
      #${SCRIPT_ID} .tpda-subtitle {
        font-size: 9px;
        color: #bdbdbd;
      }
      #${SCRIPT_ID} .tpda-actions {
        display: flex;
        align-items: center;
        gap: 2px;
      }
      #${SCRIPT_ID} .tpda-btn {
        border: 1px solid #4b4b4b;
        background: #2a2a2a;
        color: #f0f0f0;
        border-radius: 4px;
        padding: 1px 5px;
        font-size: 9px;
        line-height: 1.1;
        min-height: 20px;
      }
      #${SCRIPT_ID} .tpda-btn:active {
        transform: translateY(1px);
      }
      #${SCRIPT_ID} .tpda-status {
        padding: 3px 5px;
        border-radius: 4px;
        margin-bottom: 3px;
        font-size: 9px;
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
      #${SCRIPT_ID} .tpda-columns {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 3px;
      }
      #${SCRIPT_ID} .tpda-block {
        border-radius: 4px;
        background: rgba(255, 255, 255, 0.025);
        border: 1px solid rgba(255, 255, 255, 0.05);
        padding: 3px 4px;
      }
      #${SCRIPT_ID} .tpda-block-title {
        font-size: 8px;
        color: #bbbbbb;
        margin-bottom: 2px;
        letter-spacing: 0.02em;
      }
      #${SCRIPT_ID} .tpda-table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
      }
      #${SCRIPT_ID} .tpda-table tbody tr + tr td {
        border-top: 1px dotted rgba(255, 255, 255, 0.07);
      }
      #${SCRIPT_ID} .tpda-table td {
        font-size: 9px;
        padding: 1px 1px;
        vertical-align: middle;
      }
      #${SCRIPT_ID} .tpda-key-cell {
        width: 34%;
        color: #bfbfbf;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #${SCRIPT_ID} .tpda-value-cell {
        width: 35%;
        font-size: 10px;
        font-weight: 700;
        text-align: right;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #${SCRIPT_ID} .tpda-value-cell.tpda-gold {
        color: #d7a544;
      }
      #${SCRIPT_ID} .tpda-meta-cell {
        width: 31%;
        font-size: 9px;
        color: #bfbfbf;
        text-align: right;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #${SCRIPT_ID} .tpda-summary-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 3px;
      }
      #${SCRIPT_ID} .tpda-summary-block {
        border-radius: 4px;
        background: rgba(255, 255, 255, 0.02);
        border: 1px solid rgba(255, 255, 255, 0.05);
        padding: 3px 4px;
      }
      #${SCRIPT_ID} .tpda-summary-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 4px;
        font-size: 9px;
        line-height: 1.15;
      }
      #${SCRIPT_ID} .tpda-summary-row + .tpda-summary-row {
        margin-top: 1px;
      }
      #${SCRIPT_ID} .tpda-summary-key {
        color: #bfbfbf;
        white-space: nowrap;
      }
      #${SCRIPT_ID} .tpda-summary-value {
        font-weight: 700;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #${SCRIPT_ID} .tpda-summary-value.tpda-gold {
        color: #d7a544;
      }
      #${SCRIPT_ID} .tpda-footnote {
        margin-top: 2px;
        font-size: 8px;
        color: #adadad;
      }
      @media (max-width: 510px) {
        #${SCRIPT_ID} .tpda-table td {
          font-size: 8px;
        }
        #${SCRIPT_ID} .tpda-value-cell {
          font-size: 9px;
        }
      }
      @media (max-width: 360px) {
        #${SCRIPT_ID} .tpda-columns,
        #${SCRIPT_ID} .tpda-summary-grid {
          grid-template-columns: 1fr;
        }
        #${SCRIPT_ID} .tpda-value-cell {
          font-size: 8px;
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
      const match = text.match(/(?:XID|xid|user2ID|user2id|userid|userId|ID|id)=([0-9]{1,12})/);
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

  async function apiGet(path, params) {
    const url = new URL(`${API_BASE_URL}${path}`);
    if (isApiKeyReady()) {
      url.searchParams.set("key", API_KEY);
    }
    url.searchParams.set("comment", "tpda-profile-data");

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
          throw new Error(`${requestLabel} stats request failed: ${message}`);
        }
      }

      // If a chunk is rejected due to one bad stat, probe each stat separately.
      for (const statName of chunk) {
        const singleParams = timestamp == null ? { stat: [statName] } : { stat: [statName], timestamp };
        try {
          const payload = await apiGet(`/user/${profileId}/personalstats`, singleParams);
          Object.assign(merged, normalizeStatBlock(payload ? payload.personalstats : null));
        } catch (innerErr) {
          const innerMessage = innerErr && innerErr.message ? innerErr.message : "Unknown API failure.";
          if (isInvalidStatError(innerMessage)) {
            invalidStats.push(statName);
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

  function readNested(source, path) {
    if (!source || typeof source !== "object") return null;
    let node = source;
    for (const part of path) {
      if (!node || typeof node !== "object" || !(part in node)) {
        return null;
      }
      node = node[part];
    }
    return toNumber(node);
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
    const payload = await apiGet(`/user/${profileId}/faction`);
    const days = payload && payload.faction ? toNumber(payload.faction.days_in_faction) : null;
    return days == null ? null : Math.max(0, Math.floor(days));
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
    return `${formatInteger(e)}E ${formatInteger(n)}N`;
  }

  function tableRowsHtml(rows, includeMeta) {
    return rows
      .filter(row => !(row.hideWhenMissing && row.raw == null))
      .map(row => {
        const metaCell = includeMeta
          ? `<td class="tpda-meta-cell">${escapeHtml(row.meta || "-")}</td>`
          : "";
        return `
          <tr>
            <td class="tpda-key-cell">${escapeHtml(row.label)}</td>
            <td class="tpda-value-cell${row.highlight ? " tpda-gold" : ""}">${escapeHtml(row.value)}</td>
            ${metaCell}
          </tr>
        `;
      })
      .join("");
  }

  function summaryRowsHtml(rows) {
    return rows
      .filter(row => !(row.hideWhenMissing && row.raw == null))
      .map(row => `
        <div class="tpda-summary-row">
          <span class="tpda-summary-key">${escapeHtml(row.label)}</span>
          <span class="tpda-summary-value${row.highlight ? " tpda-gold" : ""}">${escapeHtml(row.value)}</span>
        </div>
      `)
      .join("");
  }

  function sectionTableHtml(title, rows, includeMeta) {
    return `
      <section class="tpda-block">
        <div class="tpda-block-title">${escapeHtml(title)}</div>
        <table class="tpda-table">
          <tbody>${tableRowsHtml(rows, includeMeta)}</tbody>
        </table>
      </section>
    `;
  }

  function renderLoading(profileId) {
    const root = ensureRoot();
    if (!root) return;
    const toggleLabel = state.expanded ? "Min" : "Expand";
    root.innerHTML = `
      <div class="tpda-head">
        <div>
          <div class="tpda-title">Profile Data</div>
          <div class="tpda-subtitle">User ID ${escapeHtml(profileId)}</div>
        </div>
        <div class="tpda-actions">
          <button class="tpda-btn" data-action="refresh">Refresh</button>
          <button class="tpda-btn" data-action="toggle">${toggleLabel}</button>
        </div>
      </div>
      <div class="tpda-status is-info">Loading profile stats from Torn API...</div>
    `;
  }

  function renderError(profileId, message) {
    const root = ensureRoot();
    if (!root) return;
    const toggleLabel = state.expanded ? "Min" : "Expand";
    root.innerHTML = `
      <div class="tpda-head">
        <div>
          <div class="tpda-title">Profile Data</div>
          <div class="tpda-subtitle">User ID ${escapeHtml(profileId)}</div>
        </div>
        <div class="tpda-actions">
          <button class="tpda-btn" data-action="refresh">Retry</button>
          <button class="tpda-btn" data-action="toggle">${toggleLabel}</button>
        </div>
      </div>
      <div class="tpda-status is-error">${escapeHtml(message)}</div>
    `;
  }

  function renderStats(profileId, model) {
    const monthly = model.monthly;
    const lifetime = model.lifetime;

    const monthlyRows = [
      {
        raw: monthly.timePlayed,
        label: "Time",
        value: formatDuration(monthly.timePlayed),
        meta: `${decimal(monthly.timePlayedDailyHours, 2)}h/d`,
        highlight: true
      },
      {
        raw: monthly.xanaxTaken,
        label: "Xanax",
        value: formatInteger(monthly.xanaxTaken),
        meta: `${decimal(monthly.xanaxDaily, 2)}/d`,
        highlight: true
      },
      {
        raw: monthly.overdoses,
        label: "ODs",
        value: formatInteger(monthly.overdoses),
        meta: `NoOD ${decimal(monthly.xanaxWithoutOdDaily, 2)}/d`,
        highlight: true
      },
      {
        raw: monthly.cansUsed,
        label: "Cans",
        value: formatInteger(monthly.cansUsed),
        meta: `${decimal(monthly.cansDaily, 2)}/d`,
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
        label: "MiscB",
        value: formatInteger(monthly.miscBoosters),
        meta: null,
        highlight: true
      },
      {
        raw: monthly.networthGain,
        label: "NW Δ",
        value: formatCurrencyCompact(monthly.networthGain),
        meta: null,
        highlight: true
      },
      {
        raw: monthly.statEnhancers30d,
        label: "SE",
        value: formatInteger(monthly.statEnhancers30d),
        meta: null,
        highlight: true
      }
    ];

    const lifetimeRows = [
      {
        raw: lifetime.activeStreak,
        label: "Streak",
        value: `${formatInteger(lifetime.activeStreak)} (B${formatInteger(lifetime.bestActiveStreak)})`,
        meta: null
      },
      {
        raw: lifetime.rankedWarHits,
        label: "RW Hits",
        value: formatInteger(lifetime.rankedWarHits),
        meta: null
      },
      {
        raw: lifetime.attacksWon,
        label: "Attacks",
        value: formatInteger(lifetime.attacksWon),
        meta: null
      },
      {
        raw: lifetime.reviveSkill,
        label: "Revive",
        value: decimal(lifetime.reviveSkill, 2),
        meta: null
      },
      {
        raw: lifetime.racingSkill,
        label: "Racing",
        value: decimal(lifetime.racingSkill, 2),
        meta: null
      },
      {
        raw: lifetime.totalNetworth,
        label: "Networth",
        value: formatCurrencyCompact(lifetime.totalNetworth),
        meta: null
      },
      {
        raw: lifetime.statEnhancersLifetime,
        label: "SE Life",
        value: formatInteger(lifetime.statEnhancersLifetime),
        meta: null
      },
      {
        raw: lifetime.totalRespect,
        label: "Respect",
        value: formatInteger(lifetime.totalRespect),
        meta: null
      },
      {
        raw: lifetime.daysInFaction,
        label: "Fac Days",
        value: formatInteger(lifetime.daysInFaction),
        meta: null
      },
      {
        raw: lifetime.spentOnRehab,
        label: "Rehab",
        value: formatCurrencyCompact(lifetime.spentOnRehab),
        meta: null
      },
      {
        raw: lifetime.totalWorkStats,
        label: "Work",
        value: formatInteger(lifetime.totalWorkStats),
        meta: null,
        hideWhenMissing: true
      }
    ];

    const compactMonthlyRows = [
      { raw: monthly.timePlayed, label: "T", value: formatDuration(monthly.timePlayed), highlight: true },
      { raw: monthly.xanaxTaken, label: "X", value: formatInteger(monthly.xanaxTaken), highlight: true },
      { raw: monthly.overdoses, label: "OD", value: formatInteger(monthly.overdoses), highlight: true },
      { raw: monthly.networthGain, label: "NWΔ", value: formatCurrencyCompact(monthly.networthGain), highlight: true }
    ];
    const compactLifeRows = [
      { raw: lifetime.totalNetworth, label: "NW", value: formatCurrencyCompact(lifetime.totalNetworth) },
      { raw: lifetime.attacksWon, label: "ATK", value: formatInteger(lifetime.attacksWon) },
      { raw: lifetime.totalRespect, label: "RSP", value: formatInteger(lifetime.totalRespect) },
      { raw: lifetime.daysInFaction, label: "FAC", value: formatInteger(lifetime.daysInFaction) }
    ];

    const toggleLabel = state.expanded ? "Min" : "Expand";
    const header = `
      <div class="tpda-head">
        <div>
          <div class="tpda-title">Profile Data</div>
          <div class="tpda-subtitle">User ID ${escapeHtml(profileId)}</div>
        </div>
        <div class="tpda-actions">
          <button class="tpda-btn" data-action="refresh">Refresh</button>
          <button class="tpda-btn" data-action="toggle">${toggleLabel}</button>
        </div>
      </div>
    `;

    const root = ensureRoot();
    if (!root) return;

    if (!state.expanded) {
      root.innerHTML = `
        ${header}
        <div class="tpda-summary-grid">
          <section class="tpda-summary-block">
            <div class="tpda-block-title">30D</div>
            ${summaryRowsHtml(compactMonthlyRows)}
          </section>
          <section class="tpda-summary-block">
            <div class="tpda-block-title">LIFE</div>
            ${summaryRowsHtml(compactLifeRows)}
          </section>
        </div>
        <div class="tpda-footnote">Tap Expand for full table.</div>
      `;
      return;
    }

    root.innerHTML = `
      ${header}
      <div class="tpda-columns">
        ${sectionTableHtml(`30D (${WINDOW_DAYS})`, monthlyRows, true)}
        ${sectionTableHtml("CURRENT / LIFE", lifetimeRows, false)}
      </div>
      <div class="tpda-footnote">Gold = ${WINDOW_DAYS} day activity.</div>
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
      fetchDaysInFaction(profileId).catch(() => null)
    ]);

    const invalidStats = Array.from(new Set([
      ...(currentResult.invalidStats || []),
      ...(historicResult.invalidStats || [])
    ]));
    if (invalidStats.length) {
      console.warn("[TPDA Profile Data] Skipped unsupported stats:", invalidStats.join(", "));
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
      renderError(profileId, "PDA API key is missing. Keep API_KEY as the PDA placeholder token and install the script through Torn PDA UserScripts.");
      return;
    }

    renderLoading(profileId);

    try {
      const record = await fetchProfileData(profileId, !!force);
      if (thisRequestId !== state.requestId) return;
      renderStats(profileId, record.model);
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
        if (cached?.model) {
          renderStats(state.profileId, cached.model);
        } else {
          loadProfile(state.profileId, false);
        }
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
