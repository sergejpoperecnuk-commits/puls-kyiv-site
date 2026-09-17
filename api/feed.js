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

function parseTelegramHtml(html) {
  const blocks = html.split("tgme_widget_message_wrap");
  const posts = [];
  const postRe = new RegExp('data-post="([^"]+)"');
  const timeRe = new RegExp('datetime="([^"]+)"');
  for (const block of blocks) {
    const post = block.match(postRe);
    if (!post) continue;
    const parts = post[1].split("/");
    if (parts.length < 2) continue;
    const username = parts[0];
    const telegramId = parts[1];
    const source = BY_USER[username.toLowerCase()];
    if (!source) continue;
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

async function scrape(user) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch("https://t.me/s/" + user, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; KyivPulse/1.0)", Accept: "text/html" },
    });
    if (!res.ok) return [];
    return parseTelegramHtml(await res.text());
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

function mentionsBucha(text) {
  const t = String(text || "").toLowerCase();
  return /бучанськ|\bбуча\b|\bбучі\b|ірпін|гостом|бородян|макарів|ворзел|коцюбинськ|немшаїв|пісківк/.test(t);
}

function buildAlert(messages, cityWrap, oblastWrap, ajaxOblast, ajaxCity) {
  const cityOn = isFreshOn(cityWrap) || ajaxOnKyiv(ajaxCity);
  const oblastOn = isFreshOn(oblastWrap) || ajaxOnKyiv(ajaxOblast);
  const mapOk = Boolean(cityWrap && cityWrap.state);
  const ajaxOk = Boolean(
    (ajaxOblast && Array.isArray(ajaxOblast.alarms)) ||
      (ajaxCity && Array.isArray(ajaxCity.alarms)),
  );

  const official = (messages || []).filter(isOfficialMsg);
  let lastRed = 0;
  let lastClear = 0;
  let lastBuchaRed = 0;
  let lastBuchaClear = 0;
  for (const m of official) {
    if (Date.now() - m.t > 6 * 60 * 60 * 1000) continue;
    const bucha = mentionsBucha(m.text);
    if (isRedText(m.text)) {
      if (m.t > lastRed) lastRed = m.t;
      if (bucha && m.t > lastBuchaRed) lastBuchaRed = m.t;
    } else if (isClearText(m.text)) {
      if (m.t > lastClear) lastClear = m.t;
      if (bucha && m.t > lastBuchaClear) lastBuchaClear = m.t;
    }
  }

  const buchaOn = oblastOn || lastBuchaRed > lastBuchaClear;
  const anyOn = cityOn || buchaOn;

  if (anyOn) {
    let where = "Київ";
    if (buchaOn && cityOn) where = "Київ і Бучанський район";
    else if (buchaOn) where = "Бучанський район";
    const since = buchaOn
      ? stamp(oblastWrap) || lastBuchaRed || Date.now()
      : stamp(cityWrap) || lastRed || Date.now();
    return {
      level: "red",
      title: "Тривога",
      where,
      detail: buchaOn
        ? "офіційно · Бучанський район · з " + formatSince(since)
        : "офіційно · Київ · без сирени в Бучі · з " + formatSince(since),
      since: since || Date.now(),
      source: "official",
      bucha: buchaOn,
    };
  }

  if (mapOk || ajaxOk || lastBuchaClear || lastClear) {
    const since = stamp(oblastWrap) || lastBuchaClear || stamp(cityWrap) || lastClear || Date.now();
    return {
      level: "clear",
      title: "Немає тривоги",
      where: "Бучанський район",
      detail: "офіційно · Бучанський район · відбій · " + formatSince(since),
      since,
      source: "official",
      bucha: false,
    };
  }

  return {
    level: "clear",
    title: "Немає тривоги",
    where: "Бучанський район",
    detail: "офіційні джерела · сирени в Бучанському районі немає",
    since: Date.now(),
    source: "official",
    bucha: false,
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=20, stale-while-revalidate=40");
  const [lists, cityWrap, oblastWrap, ajaxOblast, ajaxCity] = await Promise.all([
    Promise.all(SOURCES.map((s) => scrape(s.user))),
    fetchJson("https://alerts.com.ua/api/states/25", 5000),
    fetchJson("https://alerts.com.ua/api/states/9", 5000),
    fetchJson("https://air-save.ops.ajax.systems/api/mobile/status/regions/v2?regions=14", 5000),
    fetchJson("https://air-save.ops.ajax.systems/api/mobile/status/regions/v2?regions=31", 5000),
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
  const now = Date.now();
  const todayKey = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Kyiv" });
  const isToday = (t) => new Date(t).toLocaleDateString("en-CA", { timeZone: "Europe/Kyiv" }) === todayKey;
  const stats = {
    today: all.filter((m) => isToday(m.t)).length,
    last24h: all.filter((m) => now - m.t < 86400000).length,
    sourceCount: SOURCES.length,
    scraperOk: all.length > 0,
  };
  const messages = all.slice(0, 60);
  const alert = buildAlert(messages, cityWrap, oblastWrap, ajaxOblast, ajaxCity);
  res.status(200).json({ ok: true, at: Date.now(), count: messages.length, stats, alert, messages });
}
