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
  return v.split(NBSP).join(" ").split(AMP).join("&").replace(/<[^>]+>/g, "").trim();
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

function isRedText(text) {
  const t = text.toLowerCase();
  if (/відбій/.test(t) && /тривог/.test(t)) return false;
  return /оголошен[оа].{0,12}тривог|повітряна тривога|тривога в києв|тривога по києв|сирена/.test(t) || /\bТРИВОГА\b/.test(text);
}

function isClearText(text) {
  const t = text.toLowerCase();
  return /відбій/.test(t);
}

function isYellowText(text) {
  const t = text.toLowerCase();
  if (isClearText(text)) return false;
  return /шахед|бпла|безпілот|ракет|балістик|кінжал|калібр|іскандер|курс на київ|напрямок києв|загроза|увага/.test(t);
}

function formatSince(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return hh + ":" + mm;
}

function buildAlert(messages, city, oblast) {
  const recent = messages.filter((m) => Date.now() - m.t < 40 * 60 * 1000);
  let districts = [];
  let lastRed = 0;
  let lastClear = 0;
  let lastYellow = 0;
  let yellowHint = "";
  for (const m of recent) {
    const ds = findDistricts(m.text);
    if (isRedText(m.text)) {
      if (m.t > lastRed) lastRed = m.t;
      districts = districts.concat(ds);
    } else if (isClearText(m.text)) {
      if (m.t > lastClear) lastClear = m.t;
    } else if (isYellowText(m.text)) {
      if (m.t > lastYellow) {
        lastYellow = m.t;
        yellowHint = ds[0] || (wholeCity(m.text) ? "Київ" : "напрямок Києва");
      }
      districts = districts.concat(ds);
    }
  }
  districts = districts.filter((v, i, a) => a.indexOf(v) === i);

  const cityOn = Boolean(city && city.alert);
  const oblastOn = Boolean(oblast && oblast.alert);

  if (cityOn || oblastOn) {
    let where = "Київ";
    if (cityOn && oblastOn) where = "Київ і область";
    else if (oblastOn && !cityOn) where = "Київська область";
    else if (districts.length && !wholeCity(recent.map((m) => m.text).join(" "))) {
      where = districts.slice(0, 3).join(", ");
    } else where = "Київ";
    const since = cityOn ? city.changed : oblast.changed;
    return {
      level: "red",
      title: "Тривога",
      where,
      detail: "сирена · з " + formatSince(since),
      since: since ? new Date(since).getTime() : Date.now(),
    };
  }

  if (lastRed > lastClear) {
    const where = districts.length ? districts.slice(0, 3).join(", ") : "Київ";
    return {
      level: "red",
      title: "Тривога",
      where,
      detail: "зі стрічки · з " + formatSince(lastRed),
      since: lastRed,
    };
  }

  if (lastYellow > lastClear) {
    return {
      level: "yellow",
      title: "Загроза",
      where: yellowHint || (districts[0] || "напрямок Києва"),
      detail: "без сирени · стежте за укриттям",
      since: lastYellow,
    };
  }

  return {
    level: "clear",
    title: "Немає тривоги",
    where: "Київ",
    detail: lastClear ? "відбій · " + formatSince(lastClear) : "сирени немає",
    since: lastClear || (city && city.changed ? new Date(city.changed).getTime() : Date.now()),
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=20, stale-while-revalidate=40");
  const [lists, cityWrap, oblastWrap] = await Promise.all([
    Promise.all(SOURCES.map((s) => scrape(s.user))),
    fetchJson("https://alerts.com.ua/api/states/25", 5000),
    fetchJson("https://alerts.com.ua/api/states/9", 5000),
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
  const alert = buildAlert(messages, cityWrap && cityWrap.state, oblastWrap && oblastWrap.state);
  res.status(200).json({ ok: true, at: Date.now(), count: messages.length, stats, alert, messages });
}
