const SOURCES = [
  { id: "wm", title: "monitor", user: "war_monitor", cat: "Тривога", initials: "MO" },
  { id: "kn", title: "Київське небо", user: "kyiv_nebo", cat: "Тривога", initials: "КН" },
  { id: "pp", title: "ППО Київ", user: "ppo_kiev", cat: "Тривога", initials: "ПП" },
  { id: "pt", title: "Повітряна тривога Київ", user: "airAlarm_Kyiv", cat: "Тривога", initials: "ПТ" },
  { id: "ki", title: "Київ ІНФО", user: "kievinform_ua1", cat: "Тривога", initials: "КІ" },
  { id: "mw", title: "monitorwar", user: "monitoringwar", cat: "Тривога", initials: "MW" },
  { id: "ka", title: "Київ Моніторинг", user: "KyivAlarm", cat: "Тривога", initials: "КА" },
  { id: "va", title: "КМВА", user: "VA_Kyiv", cat: "Офіційне", initials: "ВА" },
  { id: "od", title: "Київська ОВА", user: "kyivoda", cat: "Офіційне", initials: "ОД" },
];
const BY_USER = Object.fromEntries(SOURCES.map((s) => [s.user.toLowerCase(), s]));
const OFFICIAL_USERS = new Set(["va_kyiv", "kyivoda"]);
const NBSP = "\u0026nbsp;";
const AMP = "\u0026amp;";
const DISTRICTS = [
  ["голосіїв", "Голосіївський район"],
  ["дарницьк", "Дарницький район"],
  ["деснянськ", "Деснянський район"],
  ["дніпровськ", "Дніпровський район"],
  ["оболонськ", "Оболонський район"],
  ["печерськ", "Печерський район"],
  ["подільськ", "Подільський район"],
  ["святошинськ", "Святошинський район"],
  ["солом", "Солом'янський район"],
  ["шевченківськ", "Шевченківський район"],
];

function decodeEntities(v) {
  return v
    .split(NBSP)
    .join(" ")
    .split(AMP)
    .join("&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/<[^>]+>/g, "")
    .trim();
}

function parseTelegramHtml(html, source) {
  const blocks = html.split("tgme_widget_message_wrap");
  const posts = [];
  const postRe = new RegExp('data-post="([^"]+)"');
  const timeRe = new RegExp('datetime="([^"]+)"');
  const want = String(source.user || "").toLowerCase();
  for (const block of blocks) {
    const post = block.match(postRe);
    if (!post) continue;
    const parts = post[1].split("/");
    if (parts.length < 2) continue;
    const username = parts[0];
    if (username.toLowerCase() !== want) continue;
    const telegramId = parts[1];
    const marker = "tgme_widget_message_text";
    const i = block.indexOf(marker);
    let text = "";
    if (i >= 0) {
      const start = block.indexOf(">", i);
      const end = block.indexOf("<" + "/div>", start);
      if (start >= 0 && end > start) text = decodeEntities(block.slice(start + 1, end));
    }
    const timeMatch = block.match(timeRe);
    if (!text || !timeMatch) continue;
    posts.push({
      id: username + "-" + telegramId,
      s: source,
      text,
      t: new Date(timeMatch[1]).getTime(),
      url: "https://t.me/" + username + "/" + telegramId,
    });
  }
  return posts;
}

function extractTitle(html) {
  const m = String(html || "").match(/property="og:title" content="([^"]+)"/);
  if (!m) return "";
  return decodeEntities(m[1]).replace(/\s*[—–-]\s*Telegram\s*$/i, "").trim();
}

function normalizeUser(raw) {
  let v = String(raw || "").trim();
  v = v.replace(/^https?:\/\//i, "");
  v = v.replace(/^(t\.me|telegram\.me|www\.t\.me)\//i, "");
  v = v.replace(/^s\//i, "");
  v = v.replace(/^@/, "");
  v = (v.split(/[/?#\s]/)[0] || "");
  if (!/^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(v)) return "";
  if (/^(joinchat|addstickers|socks|proxy)$/i.test(v)) return "";
  return v;
}

function extraSource(user) {
  return {
    id: "x-" + user.toLowerCase(),
    title: user,
    user: user,
    cat: "Тривога",
    initials: user.slice(0, 2).toUpperCase(),
    custom: true,
  };
}

function parseExtras(req) {
  const q = req && req.query ? String(req.query.extra || "") : "";
  const seen = new Set();
  const out = [];
  for (const part of q.split(/[,]+/)) {
    const user = normalizeUser(part);
    if (!user) continue;
    const key = user.toLowerCase();
    if (seen.has(key) || BY_USER[key]) continue;
    seen.add(key);
    out.push(extraSource(user));
    if (out.length >= 15) break;
  }
  return out;
}

async function scrape(source) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch("https://t.me/s/" + source.user, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; KyivPulse/1.0)", Accept: "text/html" },
    });
    if (!res.ok) return [];
    const html = await res.text();
    const title = extractTitle(html);
    const src = title
      ? Object.assign({}, source, { title: title, initials: title.replace(/^@/, "").slice(0, 2).toUpperCase() })
      : source;
    return parseTelegramHtml(html, src);
  } catch (e) {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms || 6000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; KyivPulse/1.0)", Accept: "application/json" },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function findDistricts(text) {
  const lower = text.toLowerCase();
  const found = [];
  for (const [key, name] of DISTRICTS) {
    if (lower.indexOf(key) >= 0 && found.indexOf(name) < 0) found.push(name);
  }
  return found;
}

function wholeCity(text) {
  const t = text.toLowerCase();
  return /по всьому києву|по києву|м\.?\s*київ|столиц|весь київ|у києві/.test(t);
}

function isOfficialMsg(m) {
  const user = (m.s && m.s.user ? m.s.user : "").toLowerCase();
  return OFFICIAL_USERS.has(user) || (m.s && m.s.cat === "Офіційне");
}

function isRedText(text) {
  const t = String(text || "").toLowerCase();
  if (/відбій/.test(t)) return false;
  return /оголошен[оа].{0,20}тривог|повітряна тривога|тривога в києв|тривога по києв|сирена/.test(t) || /\bТРИВОГА\b/.test(String(text || ""));
}

function isClearText(text) {
  return /відбій/.test(String(text || "").toLowerCase());
}

function formatSince(ts) {
  if (!ts) return "";
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

function stamp(wrap) {
  if (!wrap) return 0;
  const raw = (wrap.state && wrap.state.changed) || wrap.last_update || wrap.changed || 0;
  const n = new Date(raw).getTime();
  if (!Number.isFinite(n)) return 0;
  if (Date.now() - n > 36 * 60 * 60 * 1000) return 0;
  return n;
}

function isFreshOn(wrap) {
  if (!wrap || !wrap.state || !wrap.state.alert) return false;
  const ts = Date.parse(wrap.last_update || wrap.state.changed || "");
  if (!Number.isFinite(ts)) return true;
  return Date.now() - ts < 36 * 60 * 60 * 1000;
}

function ajaxOnKyiv(ajax) {
  return Boolean(ajax && Array.isArray(ajax.alarms) && ajax.alarms.length > 0);
}

function ajaxLevel(ajax, ids) {
  if (!ajax || !Array.isArray(ajax.alarms)) return "";
  const want = new Set(ids);
  let yellow = false;
  for (const alarm of ajax.alarms) {
    if (!want.has(Number(alarm.regionId))) continue;
    const level = String(alarm.alertLevel || "RED").toUpperCase();
    if (level === "YELLOW") yellow = true;
    else return "red";
  }
  return yellow ? "yellow" : "";
}

const WATCH_AREAS = [
  { id: 31, name: "м. Київ", short: "Київ" },
  { id: 75, name: "Бучанський район", short: "Бучанський" },
  { id: 74, name: "Вишгородський район", short: "Вишгородський" },
  { id: 79, name: "Броварський район", short: "Броварський" },
  { id: 78, name: "Бориспільський район", short: "Бориспільський" },
  { id: 76, name: "Обухівський район", short: "Обухівський" },
  { id: 77, name: "Фастівський район", short: "Фастівський" },
  { id: 73, name: "Білоцерківський район", short: "Білоцерківський" },
];

function strongerLevel(a, b) {
  if (a === "red" || b === "red") return "red";
  if (a === "yellow" || b === "yellow") return "yellow";
  return "";
}

function parseAin(data) {
  const byId = {};
  for (const area of WATCH_AREAS) byId[area.id] = "";
  const alerts = data && Array.isArray(data.alerts) ? data.alerts : null;
  const out = { ok: Boolean(alerts), byId: byId, oblastWide: "" };
  if (!alerts) return out;
  for (const a of alerts) {
    if (a.f) continue;
    const at = a.at;
    if (at === 1 || at === 2 || at === 90) continue;
    const uid = Number(a.luid);
    const raion = Number(a.lruid);
    const level = Number(a.al) === 1 ? "yellow" : "red";
    if (uid === 14) out.oblastWide = strongerLevel(out.oblastWide, level);
    if (Object.prototype.hasOwnProperty.call(byId, uid)) {
      byId[uid] = strongerLevel(byId[uid], level);
    }
    if (Object.prototype.hasOwnProperty.call(byId, raion)) {
      byId[raion] = strongerLevel(byId[raion], level);
    }
  }
  if (out.oblastWide) {
    for (const area of WATCH_AREAS) {
      if (area.id === 31) continue;
      byId[area.id] = strongerLevel(byId[area.id], out.oblastWide);
    }
  }
  return out;
}

function buildZones(ainData, ajaxAll, cityWrap, oblastWrap) {
  const ain = parseAin(ainData);
  return WATCH_AREAS.map(function (area) {
    let level = "";
    if (ain.ok) {
      level = ain.byId[area.id] || "";
    } else if (area.id === 31) {
      level = isFreshOn(cityWrap) ? "red" : ajaxLevel(ajaxAll, [31]);
    } else {
      level = isFreshOn(oblastWrap) ? "red" : ajaxLevel(ajaxAll, [area.id, 14]);
    }
    return {
      id: area.id,
      name: area.name,
      short: area.short,
      level: level || "clear",
    };
  });
}

function mentionsBucha(text) {
  const t = String(text || "").toLowerCase();
  return /бучанськ|\bбуча\b|\bбучі\b|ірпін|гостом|бородян|макарів|ворзел|коцюбинськ|немшаїв|пісківк/.test(t);
}

function buchaFromOfficial(text) {
  const t = String(text || "").toLowerCase().replace(/\s+/g, " ");
  const stillOn = /досі триває[\s\S]*бучанськ/.test(t);
  const head = t.split(/досі триває|зверніть увагу/)[0];
  const about = /бучанськ/.test(head);
  if (about && /відбій/.test(head)) return "clear";
  if (stillOn) return "red";
  if (about && /(повітряна тривога|оголошен|жовтий|червон|сирена)/.test(head) && !/відбій/.test(head)) {
    return "red";
  }
  return "";
}

function isKyivRelevant(text) {
  const t = String(text || "").toLowerCase();
  if (/києв|київ|киев|област|буч|ірпін|гостом|київщин|киевщин/.test(t)) return true;
  if (/харків|одес|дніпр|львів|запоріж|микола|херсон|сум\b|полтав|черніг|житом|вінниц/.test(t)) return false;
  return true;
}

function findUrgent(messages) {
  const windowMs = 12 * 60 * 1000;
  let ballisticOn = 0;
  let ballisticOff = 0;
  let migOn = 0;
  let migOff = 0;
  const ballisticRe = /балістик|баллистик|ballistic|іскандер|искандер|iskander|кинжал|кинджал|kinzhal|\bкн-?23\b|\bkn-?23\b/;
  const ballisticOffRe = /відбій.{0,24}баліст|баліст.{0,24}відбій/;
  const migRe = /(виліт|зліт|піднят|поднял|takeoff).{0,28}(міг|миг|mig)[\s-]*31|(міг|миг|mig)[\s-]*31.{0,28}(виліт|зліт|піднят|в повітря)/;
  const migOffRe = /посадк.{0,20}(міг|миг|mig)|(міг|миг|mig).{0,16}(сів|посадк)/;
  for (const m of messages || []) {
    if (Date.now() - m.t > windowMs) continue;
    const text = String(m.text || "").toLowerCase();
    if (!isKyivRelevant(text)) continue;
    if (ballisticOffRe.test(text)) ballisticOff = Math.max(ballisticOff, m.t);
    else if (ballisticRe.test(text)) ballisticOn = Math.max(ballisticOn, m.t);
    if (migOffRe.test(text)) migOff = Math.max(migOff, m.t);
    else if (migRe.test(text)) migOn = Math.max(migOn, m.t);
  }
  if (ballisticOn > ballisticOff) return { kind: "ballistic", since: ballisticOn };
  if (migOn > migOff) return { kind: "mig31", since: migOn };
  return null;
}

function urgentAlert(urgent, buchaOn) {
  const ballistic = urgent.kind === "ballistic";
  return {
    level: "red",
    title: "Тривога",
    where: ballistic ? "Балістика" : "МіГ-31",
    detail: (ballistic ? "загроза балістики · з " : "виліт МіГ-31 · з ") + formatSince(urgent.since),
    since: urgent.since,
    source: "monitor",
    bucha: buchaOn,
    siren: true,
    kind: urgent.kind,
  };
}

function zoneOf(zones, id) {
  return zones.find(function (z) { return z.id === id; }) || { id: id, level: "clear" };
}

function buildAlert(messages, cityWrap, oblastWrap, ajaxAll, ainData) {
  const ain = parseAin(ainData);
  const zones = buildZones(ainData, ajaxAll, cityWrap, oblastWrap);
  const mapOk = Boolean(cityWrap && cityWrap.state);
  const ajaxOk = Boolean(ajaxAll && Array.isArray(ajaxAll.alarms));
  const bucha = zoneOf(zones, 75);
  const city = zoneOf(zones, 31);
  const buchaOn = bucha.level === "red";
  const buchaYellow = bucha.level === "yellow";
  const cityOn = city.level === "red";

  const official = (messages || []).filter(isOfficialMsg);
  let lastRed = 0;
  let lastClear = 0;
  let lastBuchaRed = 0;
  let lastBuchaClear = 0;
  for (const m of official) {
    if (Date.now() - m.t > 6 * 60 * 60 * 1000) continue;
    const st = buchaFromOfficial(m.text);
    if (st === "red" && m.t > lastBuchaRed) lastBuchaRed = m.t;
    if (st === "clear" && m.t > lastBuchaClear) lastBuchaClear = m.t;
    if (isRedText(m.text)) {
      if (m.t > lastRed) lastRed = m.t;
    } else if (isClearText(m.text)) {
      if (m.t > lastClear) lastClear = m.t;
    }
  }

  if (!ain.ok && lastBuchaRed > lastBuchaClear) bucha.level = "red";

  const packed = function (alert) {
    return { alert: alert, zones: zones };
  };

  const urgent = findUrgent(messages);
  if (urgent) return packed(urgentAlert(urgent, buchaOn));

  if (buchaOn) {
    const since = lastBuchaRed || stamp(oblastWrap) || Date.now();
    return packed({
      level: "red",
      title: "Тривога",
      where: cityOn ? "Київ і Бучанський район" : "Бучанський район",
      detail: "alerts.in.ua · Бучанський район · з " + formatSince(since),
      since: since || Date.now(),
      source: "official",
      bucha: true,
      siren: true,
      kind: "air",
    });
  }

  if (buchaYellow) {
    return packed({
      level: "yellow",
      title: "Загроза",
      where: "Бучанський район",
      detail: "alerts.in.ua · жовтий рівень · Бучанський район",
      since: Date.now(),
      source: "official",
      bucha: false,
      siren: false,
      kind: "air",
    });
  }

  if (cityOn) {
    const since = stamp(cityWrap) || lastRed || Date.now();
    return packed({
      level: "red",
      title: "Тривога",
      where: "Київ",
      detail: "alerts.in.ua · Київ · з " + formatSince(since),
      since: since || Date.now(),
      source: "official",
      bucha: false,
      siren: false,
      kind: "air",
    });
  }

  if (ain.ok || mapOk || ajaxOk || lastBuchaClear || lastClear) {
    const since = lastBuchaClear || stamp(cityWrap) || Date.now();
    return packed({
      level: "clear",
      title: "Немає тривоги",
      where: "Бучанський район",
      detail: "alerts.in.ua · відбій · " + formatSince(since),
      since: since,
      source: "official",
      bucha: false,
      siren: false,
      kind: "clear",
    });
  }

  return packed({
    level: "clear",
    title: "Немає тривоги",
    where: "Бучанський район",
    detail: "alerts.in.ua · сирени немає",
    since: Date.now(),
    source: "official",
    bucha: false,
    siren: false,
    kind: "clear",
  });
}

function kyivDayKey(ts) {
  return new Date(ts).toLocaleDateString("en-CA", { timeZone: "Europe/Kyiv" });
}

function formatDuration(ms) {
  const hours = ms / 3600000;
  if (hours < 0.05) return "0 год";
  if (hours < 1) return Math.round(hours * 60) + " хв";
  return hours.toLocaleString("uk-UA", { maximumFractionDigits: 1 }) + " год";
}

function computeKyivAlertStats(hist, cityOn) {
  const alarms = ((((hist || {}).history || [])[0] || {}).alarms) || [];
  const now = Date.now();
  const todayKey = kyivDayKey(now);
  const cutoff = now - 86400000;
  let todayAlerts = 0;
  let durationMs = 0;
  for (const alarm of alarms) {
    if (String(alarm.alertType || "AIR").toUpperCase() !== "AIR") continue;
    if (alarm.alertLevel === "Yellow") continue;
    const start = Date.parse(alarm.startDate || "");
    if (!Number.isFinite(start)) continue;
    if (kyivDayKey(start) === todayKey) todayAlerts += 1;
    let end = Date.parse(alarm.endDate || "");
    if (!Number.isFinite(end)) {
      if (cityOn && now - start < 8 * 3600000) end = now;
      else continue;
    }
    const ov0 = Math.max(start, cutoff);
    const ov1 = Math.min(end, now);
    if (ov1 > ov0) durationMs += ov1 - ov0;
  }
  return {
    todayAlerts,
    durationLabel: formatDuration(durationMs),
    durationHours: Math.round((durationMs / 3600000) * 10) / 10,
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=10, stale-while-revalidate=20");
  const extras = parseExtras(req);
  const sources = SOURCES.concat(extras);
  const [lists, cityWrap, oblastWrap, ajaxAll, kyivHist, ainData] = await Promise.all([
    Promise.all(sources.map(scrape)),
    fetchJson("https://alerts.com.ua/api/states/25", 5000),
    fetchJson("https://alerts.com.ua/api/states/9", 5000),
    fetchJson("https://air-save.ops.ajax.systems/api/mobile/status/regions/v2?regions=14,31,73,74,75,76,77,78,79", 5000),
    fetchJson("https://my-kiev.com/alerts/api/history/31", 5000),
    fetchJson("https://api.alerts.in.ua/v3/alerts/active.json", 5000),
  ]);
  const seen = new Set();
  const all = lists
    .flat()
    .filter((m) => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    })
    .sort((a, b) => b.t - a.t);
  const cityOn = isFreshOn(cityWrap) || ajaxLevel(ajaxAll, [31]) === "red";
  const kyivStats = computeKyivAlertStats(kyivHist, cityOn);
  const stats = {
    today: kyivStats.todayAlerts,
    last24h: kyivStats.durationHours,
    todayAlerts: kyivStats.todayAlerts,
    durationLabel: kyivStats.durationLabel,
    durationHours: kyivStats.durationHours,
    sourceCount: sources.length,
    scraperOk: all.length > 0,
  };
  const messages = all.slice(0, 80);
  if (extras.length) {
    const pinned = [];
    const seenPin = new Set();
    for (const src of extras) {
      const hit = all.find((m) => m.s && m.s.user && m.s.user.toLowerCase() === src.user.toLowerCase());
      if (hit && !seenPin.has(hit.id)) {
        seenPin.add(hit.id);
        pinned.push(hit);
      }
    }
    const rest = all.filter((m) => !seenPin.has(m.id));
    messages.splice(0, messages.length, ...pinned.concat(rest).slice(0, 80));
  }
  const packed = buildAlert(messages, cityWrap, oblastWrap, ajaxAll, ainData);
  res.status(200).json({ ok: true, at: Date.now(), count: messages.length, stats, alert: packed.alert, zones: packed.zones, messages });
}
