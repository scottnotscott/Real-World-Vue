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

  const MONTHLY_STAT_NAMES = [
    "timeplayed",
    "xantaken",
    "overdosed",
    "cantaken",
    "refills",
    "nerverefills",
    "boostersused",
    "statenhancersused",
    "networth"
  ];

  const CURRENT_STAT_NAMES = [
    "timeplayed",
    "xantaken",
    "exttaken",
    "overdosed",
    "cantaken",
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
    "rehabcost",
    "traveltimes",
    "timespenttraveling",
    "itemsboughtabroad",
    "manuallabor",
    "intelligence",
    "endurance"
  ];

  const state = {
    profileId: null,
    requestId: 0,
    root: null,
    cache: new Map(),
    ownXanax: null,
    lastRecord: null
  };

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${SCRIPT_ID} {
        box-sizing: border-box;
        width: min(980px, calc(100vw - 16px));
        margin: 8px auto;
        padding: 10px;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(20, 20, 24, 0.92);
        color: #e5e5e5;
        font-family: Arial, sans-serif;
        line-height: 1.25;
      }
      #${SCRIPT_ID} * {
        box-sizing: border-box;
      }
      #${SCRIPT_ID} .tpda-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        flex-wrap: wrap;
        margin-bottom: 8px;
      }
      #${SCRIPT_ID} .tpda-head-left {
        min-width: 0;
      }
      #${SCRIPT_ID} .tpda-title {
        font-size: 16px;
        font-weight: 700;
      }
      #${SCRIPT_ID} .tpda-subtitle {
        font-size: 11px;
        color: #bdbdbd;
      }
      #${SCRIPT_ID} .tpda-head-actions {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      #${SCRIPT_ID} .tpda-xan-compare {
        flex: 1 1 280px;
        text-align: center;
        font-size: 12px;
        line-height: 1.25;
        padding: 6px 8px;
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.14);
      }
      #${SCRIPT_ID} .tpda-xan-compare.tpda-compare-muted {
        color: #e5e5e5;
        background: rgba(255, 255, 255, 0.06);
      }
      #${SCRIPT_ID} .tpda-xan-compare.tpda-compare-green {
        color: #99ffb2;
        background: rgba(17, 92, 42, 0.30);
        border-color: rgba(89, 235, 141, 0.65);
        text-shadow: 0 0 6px rgba(117, 255, 165, 0.5);
      }
      #${SCRIPT_ID} .tpda-xan-compare.tpda-compare-red {
        color: #ff7b7b;
        background: rgba(90, 15, 15, 0.36);
        border-color: rgba(154, 0, 0, 0.75);
        text-shadow: 0 0 6px rgba(255, 80, 80, 0.45);
      }
      #${SCRIPT_ID} .tpda-btn {
        border: 1px solid #4b4b4b;
        background: #2a2a2a;
        color: #f0f0f0;
        border-radius: 5px;
        padding: 4px 8px;
        font-size: 12px;
      }
      #${SCRIPT_ID} .tpda-btn:active {
        transform: translateY(1px);
      }
      #${SCRIPT_ID} .tpda-status {
        padding: 6px 8px;
        border-radius: 6px;
        margin-bottom: 8px;
        font-size: 12px;
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
      #${SCRIPT_ID} .tpda-section-title {
        margin: 10px 0 6px;
        font-size: 12px;
        font-weight: 700;
        color: #d9d9d9;
        text-transform: uppercase;
        letter-spacing: 0.03em;
      }
      #${SCRIPT_ID} .tpda-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
      }
      #${SCRIPT_ID} .tpda-card {
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.06);
        padding: 7px 8px;
        min-height: 62px;
      }
      #${SCRIPT_ID} .tpda-label {
        color: #bfbfbf;
        font-size: 11px;
      }
      #${SCRIPT_ID} .tpda-value {
        margin-top: 2px;
        font-size: 18px;
        font-weight: 700;
      }
      #${SCRIPT_ID} .tpda-value.tpda-gold {
        color: #d7a544;
      }
      #${SCRIPT_ID} .tpda-meta {
        margin-top: 2px;
        font-size: 11px;
        color: #bfbfbf;
      }
      #${SCRIPT_ID} .tpda-footnote {
        margin-top: 10px;
        font-size: 11px;
        color: #adadad;
      }
      @media (max-width: 520px) {
        #${SCRIPT_ID} {
          width: calc(100vw - 10px);
          margin: 6px auto;
          padding: 8px;
        }
        #${SCRIPT_ID} .tpda-head {
          align-items: stretch;
        }
        #${SCRIPT_ID} .tpda-head-actions {
          justify-content: flex-end;
        }
        #${SCRIPT_ID} .tpda-grid {
          grid-template-columns: 1fr;
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

  async function fetchOwnXanax(force) {
    const cached = state.ownXanax;
    if (!force && cached && (Date.now() - cached.time) < CACHE_TTL_MS) {
      return cached.value;
    }

    let value = null;
    try {
      const payload = await apiGet("/user/personalstats", { stat: ["xantaken"] });
      const stats = normalizeStatBlock(payload ? payload.personalstats : null);
      value = toNumber(stats.xantaken);
    } catch (err) {
      value = null;
    }

    if (value == null) {
      try {
        const payload = await apiGet("/user/personalstats", { cat: "drugs" });
        value = toNumber(payload?.personalstats?.drugs?.xanax);
      } catch (err) {
        value = null;
      }
    }

    state.ownXanax = { time: Date.now(), value };
    return value;
  }

  function buildXanaxComparison(ownXanax, targetXanax) {
    const mine = toNumber(ownXanax);
    const theirs = toNumber(targetXanax);
    if (mine == null || theirs == null) {
      return {
        tone: "muted",
        text: "Xanax comparison unavailable."
      };
    }

    if (mine > theirs) {
      return {
        tone: "green",
        text: `This player has taken ${formatInteger(mine - theirs)} less Xanax than you.`
      };
    }

    if (theirs > mine) {
      return {
        tone: "red",
        text: `☠️This person has taken ${formatInteger(theirs - mine)} more Xanax than you.☠️`
      };
    }

    return {
      tone: "muted",
      text: "This player has taken the same amount of Xanax as you."
    };
  }

  async function fetchDaysInFaction(profileId) {
    const payload = await apiGet(`/user/${profileId}/faction`);
    const days = payload && payload.faction ? toNumber(payload.faction.days_in_faction) : null;
    return days == null ? null : Math.max(0, Math.floor(days));
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

  function formatRefills(energy, nerve) {
    const e = toNumber(energy);
    const n = toNumber(nerve);
    if (e == null && n == null) return "--";
    if (e == null) return `${formatInteger(n)}N`;
    if (n == null) return `${formatInteger(e)}E`;
    return `${formatInteger(e)}E ${formatInteger(n)}N`;
  }

  function buildModel(current, historic, daysInFaction) {
    const timePlayed = delta(current.timeplayed, historic.timeplayed, false);
    const xanaxTaken = delta(current.xantaken, historic.xantaken, false);
    const overdoses = delta(current.overdosed, historic.overdosed, false);
    const cansUsed = delta(current.cantaken, historic.cantaken, false);
    const refillEnergy = delta(current.refills, historic.refills, false);
    const refillNerve = delta(current.nerverefills, historic.nerverefills, false);
    const boostersUsed = delta(current.boostersused, historic.boostersused, false);
    const statEnhancers30d = delta(current.statenhancersused, historic.statenhancersused, false);
    const networthGain = delta(current.networth, historic.networth, true);

    let miscBoosters = null;
    if (boostersUsed != null && cansUsed != null && statEnhancers30d != null) {
      miscBoosters = Math.max(0, boostersUsed - cansUsed - statEnhancers30d);
    }

    const xanaxWithoutOdDaily = (xanaxTaken != null && overdoses != null)
      ? xanaxTaken / Math.max(1, WINDOW_DAYS - overdoses)
      : null;

    const manualLabor = toNumber(current.manuallabor);
    const intelligence = toNumber(current.intelligence);
    const endurance = toNumber(current.endurance);
    const totalWorkStats = (manualLabor != null || intelligence != null || endurance != null)
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
        activeStreak: toNumber(current.activestreak),
        bestActiveStreak: toNumber(current.bestactivestreak),
        rankedWarHits: toNumber(current.rankedwarhits),
        attacksWon: toNumber(current.attackswon),
        totalXanaxTaken: toNumber(current.xantaken),
        totalEcstasyTaken: toNumber(current.exttaken),
        totalTimesTravelled: toNumber(current.traveltimes),
        timeSpentTravelling: toNumber(current.timespenttraveling),
        totalItemsAbroad: toNumber(current.itemsboughtabroad),
        reviveSkill: toNumber(current.reviveskill),
        racingSkill: toNumber(current.racingskill),
        totalNetworth: toNumber(current.networth),
        statEnhancersLifetime: toNumber(current.statenhancersused),
        totalRespect: toNumber(current.respectforfaction),
        daysInFaction,
        spentOnRehab: toNumber(current.rehabcost),
        totalWorkStats
      }
    };
  }

  function metricCard(label, value, meta, highlight) {
    return `
      <div class="tpda-card">
        <div class="tpda-label">${escapeHtml(label)}</div>
        <div class="tpda-value${highlight ? " tpda-gold" : ""}">${escapeHtml(value)}</div>
        ${meta ? `<div class="tpda-meta">${escapeHtml(meta)}</div>` : ""}
      </div>
    `;
  }

  function buildMonthlyRows(monthly) {
    return [
      {
        label: "Time Played",
        value: formatDuration(monthly.timePlayed),
        meta: `${decimal(monthly.timePlayedDailyHours, 2)}h/d`,
        highlight: true
      },
      {
        label: "Xanax Taken",
        value: formatInteger(monthly.xanaxTaken),
        meta: `${decimal(monthly.xanaxDaily, 2)}/d`,
        highlight: true
      },
      {
        label: "Overdoses",
        value: formatInteger(monthly.overdoses),
        meta: `Without ODs ${decimal(monthly.xanaxWithoutOdDaily, 2)}/d`,
        highlight: true
      },
      {
        label: "Cans Used",
        value: formatInteger(monthly.cansUsed),
        meta: `${decimal(monthly.cansDaily, 2)}/d`,
        highlight: true
      },
      {
        label: "Refills",
        value: formatRefills(monthly.refillEnergy, monthly.refillNerve),
        meta: null,
        highlight: true
      },
      {
        label: "Misc Boosters",
        value: formatInteger(monthly.miscBoosters),
        meta: null,
        highlight: true
      },
      {
        label: "Networth Gain",
        value: formatCurrencyCompact(monthly.networthGain),
        meta: null,
        highlight: true
      },
      {
        label: "Stat Enhancers",
        value: formatInteger(monthly.statEnhancers30d),
        meta: null,
        highlight: true
      }
    ];
  }

  function buildLifetimeRows(lifetime) {
    return [
      {
        label: "Activity Streak",
        value: `${formatInteger(lifetime.activeStreak)} (Best ${formatInteger(lifetime.bestActiveStreak)})`,
        highlight: false
      },
      { label: "Ranked War Hits", value: formatInteger(lifetime.rankedWarHits), highlight: false },
      { label: "Attacks Won", value: formatInteger(lifetime.attacksWon), highlight: false },
      { label: "Revive Skill", value: decimal(lifetime.reviveSkill, 2), highlight: false },
      { label: "Racing Skill", value: decimal(lifetime.racingSkill, 2), highlight: false },
      { label: "Total Networth", value: formatCurrencyCompact(lifetime.totalNetworth), highlight: false },
      { label: "Lifetime SE Usage", value: formatInteger(lifetime.statEnhancersLifetime), highlight: false },
      { label: "Total Respect", value: formatInteger(lifetime.totalRespect), highlight: false },
      { label: "Days in Faction", value: formatInteger(lifetime.daysInFaction), highlight: false },
      { label: "Spent on Rehab", value: formatCurrencyCompact(lifetime.spentOnRehab), highlight: false },
      { label: "Total Work Stats", value: formatInteger(lifetime.totalWorkStats), highlight: false },
      { label: "Total Xanax Taken", value: formatInteger(lifetime.totalXanaxTaken), highlight: false },
      { label: "Total Ecstasy Taken", value: formatInteger(lifetime.totalEcstasyTaken), highlight: false },
      { label: "Total Times Travelled", value: formatInteger(lifetime.totalTimesTravelled), highlight: false },
      { label: "Time Spent Travelling", value: formatDuration(lifetime.timeSpentTravelling), highlight: false },
      { label: "Total Items Abroad", value: formatInteger(lifetime.totalItemsAbroad), highlight: false }
    ];
  }

  function comparisonClass(tone) {
    if (tone === "green") return "tpda-compare-green";
    if (tone === "red") return "tpda-compare-red";
    return "tpda-compare-muted";
  }

  function headerHtml(profileId, comparison, refreshLabel) {
    const compare = comparison || {
      tone: "muted",
      text: "Comparing Xanax totals..."
    };

    return `
      <div class="tpda-head">
        <div class="tpda-head-left">
          <div class="tpda-title">Profile Data</div>
          <div class="tpda-subtitle">User ID ${escapeHtml(profileId)}</div>
        </div>
        <div class="tpda-xan-compare ${comparisonClass(compare.tone)}">${escapeHtml(compare.text)}</div>
        <div class="tpda-head-actions">
          <button class="tpda-btn" data-action="refresh">${escapeHtml(refreshLabel || "Refresh")}</button>
          <button class="tpda-btn" data-action="copy">Copy</button>
        </div>
      </div>
    `;
  }

  function buildCopyReport(model) {
    const monthlyRows = buildMonthlyRows(model.monthly);
    const lifetimeRows = buildLifetimeRows(model.lifetime);

    const lines = ["Last 30 Days"];
    monthlyRows.forEach(row => {
      lines.push(`${row.label}\t${row.value}\t${row.meta || "-"}`);
    });
    lines.push("Current / Lifetime");
    lifetimeRows.forEach(row => {
      lines.push(`${row.label}\t${row.value}`);
    });

    return `\`\`\`\n${lines.join("\n")}\n\`\`\``;
  }

  function fallbackCopy(text) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      document.execCommand("copy");
      return true;
    } catch (err) {
      return false;
    } finally {
      document.body.removeChild(textarea);
    }
  }

  async function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (err) {
        return fallbackCopy(text);
      }
    }
    return fallbackCopy(text);
  }

  function renderLoading(profileId, comparison) {
    const root = ensureRoot();
    if (!root) return;
    root.innerHTML = `
      ${headerHtml(profileId, comparison, "Refresh")}
      <div class="tpda-status is-info">Loading profile stats from Torn API...</div>
    `;
  }

  function renderError(profileId, message, comparison) {
    const root = ensureRoot();
    if (!root) return;
    root.innerHTML = `
      ${headerHtml(profileId, comparison, "Retry")}
      <div class="tpda-status is-error">${escapeHtml(message)}</div>
    `;
  }

  function renderStats(profileId, model, invalidStats, comparison) {
    const monthly = model.monthly;
    const lifetime = model.lifetime;

    const monthlyRows = buildMonthlyRows(monthly);
    const lifetimeRows = buildLifetimeRows(lifetime);
    const monthlyCards = monthlyRows.map(row => metricCard(row.label, row.value, row.meta, row.highlight)).join("");
    const lifetimeCards = lifetimeRows.map(row => metricCard(row.label, row.value, null, row.highlight)).join("");

    const warning = Array.isArray(invalidStats) && invalidStats.length
      ? `<div class="tpda-status is-error">Skipped unsupported stat keys: ${escapeHtml(invalidStats.join(", "))}</div>`
      : "";

    const root = ensureRoot();
    if (!root) return;
    root.innerHTML = `
      ${headerHtml(profileId, comparison, "Refresh")}
      ${warning}
      <div class="tpda-section-title">Last ${WINDOW_DAYS} days</div>
      <div class="tpda-grid">${monthlyCards}</div>
      <div class="tpda-section-title">Current / lifetime</div>
      <div class="tpda-grid">${lifetimeCards}</div>
      <div class="tpda-footnote">Values in gold show activity over the past ${WINDOW_DAYS} days. Other values are current or lifetime totals.</div>
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

    const [currentResult, historicResult, daysInFaction, ownXanax] = await Promise.all([
      fetchStatsSnapshot(profileId, CURRENT_STAT_NAMES, null, "Current"),
      fetchStatsSnapshot(profileId, MONTHLY_STAT_NAMES, monthAgo, "Historical"),
      fetchDaysInFaction(profileId).catch(() => null),
      fetchOwnXanax(force).catch(() => null)
    ]);

    const invalidStats = Array.from(new Set([
      ...(currentResult.invalidStats || []),
      ...(historicResult.invalidStats || [])
    ]));

    const model = buildModel(currentResult.stats || {}, historicResult.stats || {}, daysInFaction);
    const comparison = buildXanaxComparison(ownXanax, model.lifetime.totalXanaxTaken);
    const record = { time: Date.now(), model, invalidStats, comparison };
    state.cache.set(profileId, record);
    pruneCache();
    return record;
  }

  async function loadProfile(profileId, force) {
    const thisRequestId = ++state.requestId;
    const previousComparison = state.lastRecord?.comparison || null;

    if (!isApiKeyReady()) {
      renderError(profileId, "PDA API key is missing. Keep API_KEY as the PDA placeholder token and install the script through Torn PDA UserScripts.", previousComparison);
      return;
    }

    renderLoading(profileId, previousComparison);

    try {
      const record = await fetchProfileData(profileId, !!force);
      if (thisRequestId !== state.requestId) return;
      state.lastRecord = record;
      renderStats(profileId, record.model, record.invalidStats, record.comparison);
    } catch (err) {
      if (thisRequestId !== state.requestId) return;
      const message = err && err.message ? err.message : "Failed to load profile data.";
      renderError(profileId, message, previousComparison);
    }
  }

  async function handleRootClick(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const action = button.getAttribute("data-action");

    if (action === "refresh") {
      if (!state.profileId) return;
      loadProfile(state.profileId, true);
      return;
    }

    if (action === "copy") {
      const record = state.lastRecord || (state.profileId ? state.cache.get(state.profileId) : null);
      if (!record?.model) {
        const oldLabel = button.textContent;
        button.textContent = "No data";
        setTimeout(() => { button.textContent = oldLabel; }, 1200);
        return;
      }

      const copied = await copyText(buildCopyReport(record.model));
      const oldLabel = button.textContent;
      button.textContent = copied ? "Copied" : "Copy failed";
      setTimeout(() => { button.textContent = oldLabel; }, 1300);
    }
  }

  function tick() {
    const href = window.location.href;
    const profileId = getIdFromUrl(href);

    if (!profileId) {
      state.requestId += 1;
      state.profileId = null;
      state.lastRecord = null;
      removeRoot();
      return;
    }

    ensureRoot();
    if (profileId !== state.profileId) {
      state.profileId = profileId;
      state.lastRecord = null;
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
