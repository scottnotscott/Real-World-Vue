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

  const SCRIPT_ID = "tpda-faction-intel-panel";
  const STYLE_ID = "tpda-faction-intel-style";
  const API_BASE_URL = "https://api.torn.com/v2";
  const API_KEY = "###PDA-APIKEY###";
  const API_KEY_PLACEHOLDER = `${"#".repeat(3)}PDA-APIKEY${"#".repeat(3)}`;
  const WINDOW_DAYS = 30;
  const WINDOW_SECONDS = WINDOW_DAYS * 86400;
  const POLL_INTERVAL_MS = 1200;
  const FACTION_CACHE_TTL_MS = 5 * 60 * 1000;
  const MEMBER_CACHE_TTL_MS = 20 * 60 * 1000;
  const MAX_FACTION_CACHE_ENTRIES = 12;
  const MAX_MEMBER_CACHE_ENTRIES = 650;
  const MEMBER_CONCURRENCY = 2;
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
    "networth"
  ];

  const CURRENT_STAT_NAMES = [
    ...MONTHLY_STAT_NAMES,
    "rankedwarhits",
    "attackswon",
    "respectforfaction",
    "totalworkingstats"
  ];

  const state = {
    context: null,
    requestId: 0,
    root: null,
    factionCache: new Map(),
    memberCache: new Map()
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
        line-height: 1.24;
      }
      #${SCRIPT_ID} * {
        box-sizing: border-box;
      }
      #${SCRIPT_ID} .tpda-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 8px;
      }
      #${SCRIPT_ID} .tpda-title {
        font-size: 16px;
        font-weight: 700;
      }
      #${SCRIPT_ID} .tpda-subtitle {
        font-size: 11px;
        color: #bdbdbd;
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
        font-size: 17px;
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
      #${SCRIPT_ID} .tpda-progress-wrap {
        width: 100%;
        height: 8px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        overflow: hidden;
        margin-top: 6px;
      }
      #${SCRIPT_ID} .tpda-progress-fill {
        height: 100%;
        width: 0;
        border-radius: 999px;
        background: linear-gradient(90deg, #4f8be0, #79a7f2);
      }
      #${SCRIPT_ID} .tpda-list {
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.06);
        overflow: hidden;
      }
      #${SCRIPT_ID} .tpda-list-row {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        padding: 6px 8px;
        font-size: 12px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      }
      #${SCRIPT_ID} .tpda-list-row:last-child {
        border-bottom: none;
      }
      #${SCRIPT_ID} .tpda-list-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: #dfdfdf;
      }
      #${SCRIPT_ID} .tpda-list-value {
        color: #f2f2f2;
        font-weight: 700;
        flex: 0 0 auto;
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
    return records
      .map((record) => ({ record, value: toNumber(getter(record)) }))
      .filter((row) => row.value != null)
      .sort((a, b) => b.value - a.value)
      .slice(0, limit == null ? 5 : limit);
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
        statEnhancers30d
      },
      lifetime: {
        rankedWarHits: toNumber(current.rankedwarhits),
        attacksWon: toNumber(current.attackswon),
        totalRespect: toNumber(current.respectforfaction),
        totalNetworth: toNumber(current.networth),
        totalWorkStats: toNumber(current.totalworkingstats),
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
    const aWarHits = sumAccumulator();
    const aAttacksWon = sumAccumulator();
    const aRespect = sumAccumulator();
    const aTotalNetworth = sumAccumulator();
    const aWorkStats = sumAccumulator();
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
      includeAccumulator(aWarHits, row.model.lifetime.rankedWarHits);
      includeAccumulator(aAttacksWon, row.model.lifetime.attacksWon);
      includeAccumulator(aRespect, row.model.lifetime.totalRespect);
      includeAccumulator(aTotalNetworth, row.model.lifetime.totalNetworth);
      includeAccumulator(aWorkStats, row.model.lifetime.totalWorkStats);
      includeAccumulator(aDaysInFaction, row.model.lifetime.daysInFaction);
    }

    const topXanax = byHighest(valid, (row) => row.model.monthly.xanaxTaken, 5);
    const topNetworthGain = byHighest(valid, (row) => row.model.monthly.networthGain, 5);
    const topWarHits = byHighest(valid, (row) => row.model.lifetime.rankedWarHits, 5);
    const topRespect = byHighest(valid, (row) => row.model.lifetime.totalRespect, 5);

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
        rankedWarHits: aWarHits.sum,
        attacksWon: aAttacksWon.sum,
        totalRespect: aRespect.sum,
        totalNetworth: aTotalNetworth.sum,
        totalWorkStats: aWorkStats.sum,
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
        topWarHits,
        topRespect
      },
      failedMembers: failed.map((row) => ({
        id: row.member && row.member.id != null ? String(row.member.id) : "",
        name: row.member && row.member.name ? row.member.name : "Unknown",
        error: row.error
      })),
      invalidStats
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

  function leaderboard(title, rows, formatter) {
    const listRows = rows.length
      ? rows.map((row, index) => {
        const name = `${index + 1}. ${formatMemberName(row.record.member)}`;
        const value = formatter(row.value);
        return `
          <div class="tpda-list-row">
            <span class="tpda-list-name">${escapeHtml(name)}</span>
            <span class="tpda-list-value">${escapeHtml(value)}</span>
          </div>
        `;
      }).join("")
      : `<div class="tpda-list-row"><span class="tpda-list-name">No data available.</span><span class="tpda-list-value">--</span></div>`;
    return `
      <div class="tpda-card">
        <div class="tpda-label">${escapeHtml(title)}</div>
        <div class="tpda-list">${listRows}</div>
      </div>
    `;
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
        <button class="tpda-btn" data-action="refresh">Refresh</button>
      </div>
      <div class="tpda-status is-info">
        ${escapeHtml(`Loading member stats: ${done}/${total}${failed ? `, failed: ${failed}` : ""}`)}
        <div class="tpda-progress-wrap"><div class="tpda-progress-fill" style="width:${pct}%"></div></div>
        <div class="tpda-meta">${escapeHtml(current)}</div>
      </div>
    `;
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
        <button class="tpda-btn" data-action="refresh">Retry</button>
      </div>
      <div class="tpda-status is-error">${escapeHtml(message)}</div>
    `;
  }

  function renderStats(context, model) {
    const root = ensureRoot();
    if (!root) return;

    const coverage = model.coverage;
    const totals = model.totals;
    const averages = model.averages;
    const status = model.statusBreakdown;
    const factionName = model.faction.name || (context && context.name) || "Faction";
    const factionId = model.faction.id || (context && context.factionId) || "--";
    const factionRespect = model.faction.respect;

    const warningParts = [];
    if (model.invalidStats.length) {
      warningParts.push(`Skipped unsupported stat keys: ${model.invalidStats.join(", ")}`);
    }
    if (coverage.failedMembers > 0) {
      warningParts.push(`Failed member scans: ${coverage.failedMembers}`);
    }
    const warning = warningParts.length
      ? `<div class="tpda-status is-error">${escapeHtml(warningParts.join(" | "))}</div>`
      : "";

    const coverageCards = [
      metricCard(
        "Members Scanned",
        `${formatInteger(coverage.scannedMembers)} / ${formatInteger(coverage.totalMembers)}`,
        `${formatInteger(coverage.failedMembers)} failed`,
        false
      ),
      metricCard(
        "Faction Respect",
        formatInteger(factionRespect),
        "From faction basic endpoint",
        false
      ),
      metricCard(
        "Online / Idle",
        `${formatInteger(status.online)} / ${formatInteger(status.idle)}`,
        `Offline: ${formatInteger(status.offline)}`,
        false
      ),
      metricCard(
        "Hospital / Jail / Travel",
        `${formatInteger(status.hospital)} / ${formatInteger(status.jail)} / ${formatInteger(status.traveling)}`,
        null,
        false
      )
    ].join("");

    const monthlyCards = [
      metricCard(
        "Time Played",
        formatDuration(totals.timePlayed),
        `Avg: ${decimal(averages.timePlayedHoursPerMemberPerDay, 2)} hours/member/day`,
        true
      ),
      metricCard(
        "Xanax Taken",
        formatInteger(totals.xanaxTaken),
        `Avg: ${decimal(averages.xanaxPerMemberPerDay, 2)} / member / day`,
        true
      ),
      metricCard(
        "Overdoses",
        formatInteger(totals.overdoses),
        null,
        true
      ),
      metricCard(
        "Cans Used",
        formatInteger(totals.cansUsed),
        `Avg: ${decimal(averages.cansPerMemberPerDay, 2)} / member / day`,
        true
      ),
      metricCard(
        "Refills",
        `${formatInteger(totals.refillEnergy)} E + ${formatInteger(totals.refillNerve)} N`,
        null,
        true
      ),
      metricCard(
        "Misc Boosters",
        formatInteger(totals.miscBoosters),
        null,
        true
      ),
      metricCard(
        "Networth Gain",
        formatCurrencyCompact(totals.networthGain),
        `Avg/member: ${formatCurrencyCompact(averages.networthGainPerMember)}`,
        true
      ),
      metricCard(
        "Stat Enhancers",
        formatInteger(totals.statEnhancers30d),
        null,
        true
      )
    ].join("");

    const lifetimeCards = [
      metricCard("Ranked War Hits", formatInteger(totals.rankedWarHits), null, false),
      metricCard("Attacks Won", formatInteger(totals.attacksWon), null, false),
      metricCard("Total Respect", formatInteger(totals.totalRespect), null, false),
      metricCard("Total Networth", formatCurrencyCompact(totals.totalNetworth), null, false),
      metricCard("Total Work Stats", formatInteger(totals.totalWorkStats), null, false),
      metricCard("Avg Days in Faction", decimal(averages.avgDaysInFaction, 1), null, false)
    ].join("");

    const leaderCards = [
      leaderboard("Top Xanax (30d)", model.leaders.topXanax, formatInteger),
      leaderboard("Top Networth Gain (30d)", model.leaders.topNetworthGain, formatCurrencyCompact),
      leaderboard("Top Ranked War Hits", model.leaders.topWarHits, formatInteger),
      leaderboard("Top Respect for Faction", model.leaders.topRespect, formatInteger)
    ].join("");

    root.innerHTML = `
      <div class="tpda-head">
        <div>
          <div class="tpda-title">Faction Intel</div>
          <div class="tpda-subtitle">${escapeHtml(factionName)} [${escapeHtml(factionId)}]</div>
        </div>
        <button class="tpda-btn" data-action="refresh">Refresh</button>
      </div>
      ${warning}
      <div class="tpda-section-title">Coverage</div>
      <div class="tpda-grid">${coverageCards}</div>
      <div class="tpda-section-title">Last ${WINDOW_DAYS} days (cumulative)</div>
      <div class="tpda-grid">${monthlyCards}</div>
      <div class="tpda-section-title">Current / lifetime (cumulative)</div>
      <div class="tpda-grid">${lifetimeCards}</div>
      <div class="tpda-section-title">Top contributors</div>
      <div class="tpda-grid">${leaderCards}</div>
      <div class="tpda-footnote">This panel scans faction members, fetches their public personal stats, and aggregates totals for faction intel. Gold values are ${WINDOW_DAYS}-day activity deltas.</div>
    `;
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

    const [currentResult, historicResult] = await Promise.all([
      fetchStatsSnapshot(memberId, CURRENT_STAT_NAMES, null, "Current"),
      fetchStatsSnapshot(memberId, MONTHLY_STAT_NAMES, monthAgo, "Historical")
    ]);

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

  async function mapWithConcurrency(items, concurrency, mapper, shouldContinue) {
    const results = new Array(items.length);
    let cursor = 0;
    let cancelled = false;

    const worker = async () => {
      while (true) {
        if (cancelled) return;
        if (shouldContinue && !shouldContinue()) {
          cancelled = true;
          return;
        }
        const index = cursor++;
        if (index >= items.length) return;
        results[index] = await mapper(items[index], index);
      }
    };

    const workerCount = Math.max(1, Math.min(concurrency, items.length || 1));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return { results, cancelled };
  }

  async function fetchFactionData(context, force, onProgress, shouldContinue) {
    const cacheKey = context.cacheKey;
    const cached = state.factionCache.get(cacheKey);
    if (!force && cached && (Date.now() - cached.time) < FACTION_CACHE_TTL_MS) {
      return cached;
    }

    const [basicPayload, membersPayload] = await Promise.all([
      fetchFactionBasics(context),
      fetchFactionMembers(context)
    ]);
    const basic = basicPayload && basicPayload.basic ? basicPayload.basic : null;
    const members = Array.isArray(membersPayload && membersPayload.members) ? membersPayload.members : [];
    const monthAgo = Math.floor(Date.now() / 1000) - WINDOW_SECONDS;

    let done = 0;
    let failed = 0;

    const mapped = await mapWithConcurrency(
      members,
      MEMBER_CONCURRENCY,
      async (member) => {
        if (shouldContinue && !shouldContinue()) {
          return { cancelled: true };
        }
        let row;
        try {
          row = await fetchMemberIntel(member, monthAgo, force);
        } catch (err) {
          const message = err && err.message ? err.message : "Failed to fetch member data.";
          row = {
            member,
            error: message,
            invalidStats: []
          };
          failed += 1;
        }
        done += 1;
        if (typeof onProgress === "function") {
          onProgress({
            done,
            total: members.length,
            failed,
            current: formatMemberName(member)
          });
        }
        return row;
      },
      shouldContinue
    );

    if (mapped.cancelled || (shouldContinue && !shouldContinue())) {
      throw new Error(CANCELLED_ERROR_TOKEN);
    }

    const records = mapped.results.map((row, index) => {
      if (row && row.cancelled) {
        return {
          member: members[index],
          error: "Cancelled"
        };
      }
      return row;
    });

    const model = aggregateFactionIntel(basic, members, records);
    const record = {
      time: Date.now(),
      model
    };
    state.factionCache.set(cacheKey, record);
    pruneTimedCache(state.factionCache, MAX_FACTION_CACHE_ENTRIES);
    return record;
  }

  async function loadFaction(context, force) {
    const thisRequestId = ++state.requestId;
    const contextCopy = Object.assign({}, context);

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
          renderLoading(contextCopy, progress);
        },
        () => thisRequestId === state.requestId
      );
      if (thisRequestId !== state.requestId) return;
      contextCopy.name = record.model && record.model.faction && record.model.faction.name
        ? record.model.faction.name
        : contextCopy.name;
      renderStats(contextCopy, record.model);
    } catch (err) {
      if (thisRequestId !== state.requestId) return;
      const message = err && err.message ? err.message : "Failed to load faction intel.";
      if (message === CANCELLED_ERROR_TOKEN) return;
      renderError(contextCopy, message);
    }
  }

  function handleRootClick(event) {
    const button = event.target.closest("button[data-action='refresh']");
    if (!button) return;
    if (!state.context) return;
    loadFaction(state.context, true);
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
    tick();
    setInterval(tick, POLL_INTERVAL_MS);
  }

  boot();
})();
