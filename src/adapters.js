import { fallbackEventSeeds } from "./data.js";

const adapterDefinitions = [
  {
    venueId: "lucindas",
    url: "https://www.lucindasnyc.com/calendar/",
    parse: parseLucindas
  },
  {
    venueId: "nublu",
    url: "https://www.nublu.net/",
    parse: parseNublu
  },
  {
    venueId: "nightclub101",
    url: "https://www.ticketweb.com/venue/night-club-101-new-york-ny/686683",
    parse: (html) => parseJsonLdMusicEvents(html, "nightclub101")
  },
  {
    venueId: "berlin",
    url: "https://www.ticketmaster.com/berlin-tickets-new-york/venue/341249",
    parse: (html) => parseJsonLdMusicEvents(html, "berlin")
  },
  {
    venueId: "mercury",
    url: "https://www.ticketmaster.com/mercury-lounge-tickets-new-york/venue/1101",
    parse: (html) => parseJsonLdMusicEvents(html, "mercury")
  },
  {
    venueId: "ottos",
    url: "https://www.ottosshrunkenhead.com/pages/events.php",
    parse: parseOttos
  },
  {
    venueId: "drom",
    url: "https://dromnyc.com/events/",
    parse: parseDrom
  }
];

export async function loadUnifiedEvents() {
  const liveResults = await Promise.allSettled(adapterDefinitions.map(loadAdapter));
  const liveEvents = [];
  const adapterStatus = [];

  for (const result of liveResults) {
    if (result.status === "fulfilled") {
      liveEvents.push(...result.value.events);
      adapterStatus.push(result.value.status);
    } else {
      adapterStatus.push({
        venueId: result.reason?.venueId || "unknown",
        ok: false,
        count: 0,
        message: result.reason?.message || "Adapter failed"
      });
    }
  }

  return {
    fetchedAt: new Date().toISOString(),
    adapterStatus,
    events: dedupeEvents([...liveEvents, ...fallbackEventSeeds])
  };
}

async function loadAdapter(adapter) {
  const response = await fetch(adapter.url, {
    headers: {
      "user-agent": "EastVillageLive/0.1 (+local personal schedule app)"
    },
    signal: AbortSignal.timeout(10000)
  });

  if (!response.ok) {
    const error = new Error(`${adapter.venueId} returned ${response.status}`);
    error.venueId = adapter.venueId;
    throw error;
  }

  const html = await response.text();
  const events = adapter.parse(html).map((event) => ({
    ...event,
    venueId: adapter.venueId,
    dataSource: "live"
  }));

  return {
    events,
    status: {
      venueId: adapter.venueId,
      ok: events.length > 0,
      count: events.length,
      message: events.length ? "Loaded from venue page" : "No events found on venue page"
    }
  };
}

function parseJsonLdMusicEvents(html, venueId) {
  const nodes = [];
  const scriptPattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  for (const match of html.matchAll(scriptPattern)) {
    try {
      const parsed = JSON.parse(decodeHtml(match[1]).trim());
      nodes.push(...(Array.isArray(parsed) ? parsed : [parsed]));
    } catch {
      continue;
    }
  }

  return nodes
    .filter((item) => item && item["@type"] === "MusicEvent" && item.startDate && item.name)
    .map((item) => ({
      id: `${venueId}-${slug(item.url || `${item.name}-${item.startDate}`)}`,
      title: decodeHtml(stripTags(item.name)),
      startsAt: localIsoToDate(item.startDate).toISOString(),
      note: eventNote(item),
      price: offerPrice(item.offers),
      sourceUrl: offerUrl(item.offers) || item.url || ""
    }));
}

function localIsoToDate(value) {
  return new Date(value.length === 10 ? `${value}T20:00:00` : value);
}

function eventNote(item) {
  const description = decodeHtml(stripTags(item.description || "")).replace(/\s+/g, " ").trim();
  const location = item.location?.name || "";
  if (description && location && description.includes(location)) return location;
  return description || location || "Venue listing";
}

function offerPrice(offers) {
  const offer = Array.isArray(offers) ? offers[0] : offers;
  if (!offer) return "Ticketed";
  if (offer.price) return offer.priceCurrency ? `${offer.priceCurrency} ${offer.price}` : String(offer.price);
  if (offer.description && /\$\d/.test(offer.description)) {
    const price = offer.description.match(/\$\d+(?:\.\d{2})?/);
    if (price) return price[0];
  }
  if (/soldout/i.test(offer.availability || "")) return "Sold out";
  return "Ticketed";
}

function offerUrl(offers) {
  const offer = Array.isArray(offers) ? offers[0] : offers;
  return offer?.url || "";
}

function parseLucindas(html) {
  const events = [];
  const eventPattern = /\{\s*id:\s*'(?<id>\d+)'[\s\S]*?start:\s*'(?<date>[^']+)'[\s\S]*?title:\s*'(?<title>[^']+)'[\s\S]*?displayTime:\s*'(?<displayTime>[^']*)'[\s\S]*?\},/g;

  for (const match of html.matchAll(eventPattern)) {
    const { id, date, title, displayTime } = match.groups;
    const detail = detailBlock(html, id);
    const time = displayTime.match(/(\d{1,2}:\d{2})\s*([AP]M)/i);
    const startsAt = new Date(`${date}T${time ? toTwentyFourHour(time[1], time[2]) : "20:00"}:00`);
    const cleanTitle = decodeHtml(stripTags(title)).replace(/\s*,\s*FREE EVENT.*$/i, "");
    const priceText = textFromClass(detail, "tw-price");
    const free = /free event|no tickets required/i.test(`${title} ${priceText}`);

    events.push({
      id: `lucindas-${id}`,
      title: cleanTitle,
      startsAt: startsAt.toISOString(),
      note: displayTime ? decodeHtml(displayTime) : "Time from venue calendar",
      price: free ? "Free" : priceText || "Ticketed",
      sourceUrl: firstHref(detail) || `https://www.lucindasnyc.com/calendar/#tw-event-dialog-${id}`
    });
  }

  return events;
}

function detailBlock(html, id) {
  const start = html.indexOf(`<div id="tw-event-dialog-${id}"`);
  if (start === -1) return "";
  const end = html.indexOf(`<div id="tw-event-dialog-`, start + 1);
  return html.slice(start, end === -1 ? undefined : end);
}

function textFromClass(html, className) {
  const match = html.match(new RegExp(`<[^>]+class=["'][^"']*${className}[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, "i"));
  return match ? decodeHtml(stripTags(match[1])).replace(/\s+/g, " ").trim() : "";
}

function parseNublu(html) {
  const events = [];
  const rowPattern = /<div id="(?<timestamp>0?\d{10})" class="scheduler151">[\s\S]*?<div class="sch-body151">\s*(?<body>[\s\S]*?)<\/div>\s*<div class="sch-image151">/g;

  for (const row of html.matchAll(rowPattern)) {
    const baseDate = dateFromUnixId(row.groups.timestamp);
    const segments = splitNubluBody(row.groups.body);

    for (const segment of segments) {
      const parsed = parseNubluSegment(segment, baseDate);
      if (parsed) events.push(parsed);
    }
  }

  return events;
}

function parseOttos(html) {
  const events = [];
  const rowPattern =
    /<tr[^>]*>\s*<td[^>]*class=["']day["'][^>]*>(?<day>[\s\S]*?)<\/td>\s*<td[^>]*>[\s\S]*?<div class=["']title["']>(?<title>[\s\S]*?)<\/div>\s*<div class=["']desc["']>(?<desc>[\s\S]*?)<\/div>/gi;

  for (const row of html.matchAll(rowPattern)) {
    const rule = recurringRule(decodeHtml(stripTags(row.groups.day)));
    if (!rule) continue;

    const title = decodeHtml(stripTags(row.groups.title)).replace(/\s+/g, " ").trim();
    const desc = decodeHtml(stripTags(row.groups.desc)).replace(/\s+/g, " ").trim();
    const time = desc.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
    const hour = time ? toTwentyFourHour(`${time[1]}:${time[2] || "00"}`, time[3]) : "20:00";

    for (const startsAt of expandRecurringRule(rule, hour)) {
      events.push({
        id: `ottos-${startsAt.toISOString().slice(0, 10)}-${slug(title)}`,
        title,
        startsAt: startsAt.toISOString(),
        note: desc || "Recurring Otto's event",
        price: /free|no cover/i.test(desc) ? "Free" : "Varies",
        sourceUrl: "https://www.ottosshrunkenhead.com/pages/events.php"
      });
    }
  }

  return events;
}

function parseDrom(html) {
  const events = [];
  const cardPattern =
    /<div class="featured-box"[\s\S]*?<p class="event-date[^"]*">(?<date>[\s\S]*?)<\/p>\s*<h5 class="featured-title[^"]*"[^>]*>\s*<a href="(?<url>[^"]+)"[^>]*>(?<title>[\s\S]*?)<\/a><\/h5>\s*<p class="event-text[^"]*"[^>]*>(?<note>[\s\S]*?)<\/p>/gi;

  for (const card of html.matchAll(cardPattern)) {
    const startsAt = dromDate(card.groups.date);
    if (!startsAt) continue;

    const title = decodeHtml(stripTags(card.groups.title)).replace(/\s+/g, " ").trim();
    const note = decodeHtml(stripTags(card.groups.note)).replace(/\s+/g, " ").trim();

    events.push({
      id: `drom-${startsAt.toISOString().slice(0, 10)}-${slug(title)}`,
      title,
      startsAt: startsAt.toISOString(),
      note: note || "Drom event",
      price: "Ticketed",
      sourceUrl: card.groups.url
    });
  }

  return events;
}

function dromDate(value) {
  const text = decodeHtml(stripTags(value)).replace(/\s+/g, " ").trim();
  const match = text.match(/\b([A-Z][a-z]{2}),\s+([A-Z][a-z]+)\s+(\d{1,2})(?:\s+-\s+Doors:\s+(\d{1,2})(?::(\d{2}))?\s*([AP]M))?/);
  if (!match) return null;

  const [, , monthName, day, hourText = "8", minuteText = "00", meridiem = "PM"] = match;
  const year = eventYear(monthName);
  const month = monthIndex(monthName);
  if (month === -1) return null;

  const [hours, minutes] = toTwentyFourHour(`${hourText}:${minuteText || "00"}`, meridiem).split(":").map(Number);
  return new Date(year, month, Number(day), hours, minutes, 0, 0);
}

function eventYear(monthName) {
  const now = new Date();
  const eventMonth = monthIndex(monthName);
  const currentMonth = now.getMonth();
  return eventMonth < currentMonth - 6 ? now.getFullYear() + 1 : now.getFullYear();
}

function monthIndex(monthName) {
  return [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december"
  ].indexOf(monthName.toLowerCase());
}

function recurringRule(value) {
  const text = value.toLowerCase();
  const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const dayOfWeek = dayNames.findIndex((day) => text.includes(day));
  if (dayOfWeek === -1) return null;

  const ordinals = [
    ["first", 1],
    ["second", 2],
    ["third", 3],
    ["fourth", 4],
    ["last", -1]
  ];
  const ordinal = ordinals.find(([word]) => text.includes(word))?.[1] || null;

  return { dayOfWeek, ordinal };
}

function expandRecurringRule(rule, hour) {
  const now = startOfDay(new Date());
  const startsAt = [];
  const [hours, minutes] = hour.split(":").map(Number);

  for (let offset = 0; offset < 45; offset += 1) {
    const date = new Date(now);
    date.setDate(now.getDate() + offset);
    if (date.getDay() !== rule.dayOfWeek) continue;
    if (rule.ordinal && monthOrdinal(date) !== rule.ordinal) continue;

    date.setHours(hours, minutes, 0, 0);
    startsAt.push(date);
  }

  return startsAt;
}

function monthOrdinal(date) {
  const ordinal = Math.ceil(date.getDate() / 7);
  if (date.getDate() + 7 > daysInMonth(date)) return -1;
  return ordinal;
}

function daysInMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function splitNubluBody(html) {
  const lines = htmlToLines(html);
  const segments = [];
  let current = [];

  for (const line of lines) {
    if (isTimeLine(line) && current.length) {
      segments.push(current);
      current = [];
    }
    current.push(line);
  }

  if (current.length) segments.push(current);
  return segments;
}

function parseNubluSegment(lines, baseDate) {
  const timeLine = lines.find(isTimeLine);
  if (!timeLine) return null;

  const time = timeLine.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (!time) return null;

  const timeRemainder = timeLine.replace(/^\d{1,2}(?::\d{2})?\s*(?:am|pm)\s*-?\s*/i, "").trim();
  const title = [timeRemainder, ...lines.filter((line) => line !== timeLine)]
    .map((line) => line.replace(/\s*\[https?:\/\/[^\]]+\]/g, "").trim())
    .filter((line) => line && !isTimeLine(line))
    .filter((line) => !/^tickets?\s*$/i.test(line))
    .join(" ")
    .replace(/\s+\bTickets?\b\s*$/i, "")
    .trim();

  if (!title) return null;

  const ticketUrl = firstHref(lines.join(" "));
  const date = new Date(baseDate);
  const hour = toTwentyFourHour(`${time[1]}:${time[2] || "00"}`, time[3]);
  const [hours, minutes] = hour.split(":").map(Number);
  date.setHours(hours, minutes, 0, 0);

  return {
    id: `nublu-${baseDate.toISOString().slice(0, 10)}-${slug(title)}-${hour}`,
    title,
    startsAt: date.toISOString(),
    note: "Nublu 151",
    price: "Ticketed",
    sourceUrl: ticketUrl || "https://www.nublu.net/"
  };
}

function htmlToLines(html) {
  return html
    .replace(/<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, " $2 [$1] ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .split("\n")
    .map((line) => decodeHtml(line).replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function isTimeLine(line) {
  return /^\d{1,2}(?::\d{2})?\s*(am|pm)\b/i.test(line);
}

function firstHref(text) {
  const match = text.match(/\[(https?:\/\/[^\]]+)\]/) || text.match(/href="(https?:\/\/[^"]+)"/);
  return match ? match[1] : "";
}

function dateFromUnixId(id) {
  return new Date(Number(id) * 1000);
}

function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function toTwentyFourHour(time, meridiem) {
  const [hourText, minuteText] = time.split(":");
  let hour = Number(hourText);
  const minute = Number(minuteText || "00");
  const lower = meridiem.toLowerCase();
  if (lower === "pm" && hour !== 12) hour += 12;
  if (lower === "am" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function dedupeEvents(events) {
  const seen = new Set();
  const deduped = [];

  for (const event of events) {
    const key = `${event.venueId}-${event.title}-${event.startsAt || event.dayOfWeek}-${event.time || ""}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(event);
  }

  return deduped;
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 72);
}

function stripTags(value) {
  return value.replace(/<[^>]+>/g, " ");
}

function decodeHtml(value) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&ndash;/g, "-")
    .replace(/&mdash;/g, "-");
}
