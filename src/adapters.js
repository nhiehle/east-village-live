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
  },
  {
    venueId: "clubcumming",
    url: "https://clubcummingnyc.com/schedule",
    parse: parseClubCumming
  },
  {
    venueId: "bowerypalace",
    url: "https://www.bowerypalace.com/",
    parse: parseBoweryPalace
  },
  {
    venueId: "transpecos",
    url: "https://linktr.ee/trans.pecos",
    parse: parseTransPecos
  },
  {
    venueId: "hartbar",
    url: "https://calendar.google.com/calendar/ical/qhsrkjv5s7mb4vidjem575jvt4%40group.calendar.google.com/public/basic.ics",
    parse: parseHartBarIcs
  },
  {
    venueId: "tveye",
    url: "https://tveyenyc.com/calendar/",
    parse: parseTvEye
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
  const individual = parseOttoIndividualEvents(html);
  const recurring = parseOttoRecurringEvents(html).filter((event) => !overlapsOttoIndividual(event, individual));
  return [...individual, ...recurring];
}

function parseOttoRecurringEvents(html) {
  const events = [];
  const rowPattern =
    /<tr[^>]*>\s*<td[^>]*class=["']day["'][^>]*>(?<day>[\s\S]*?)<\/td>\s*<td[^>]*>[\s\S]*?<div class=["']title["']>(?<title>[\s\S]*?)<\/div>\s*<div class=["']desc["']>(?<desc>[\s\S]*?)<\/div>/gi;

  for (const row of html.matchAll(rowPattern)) {
    const rule = recurringRule(decodeHtml(stripTags(row.groups.day)));
    if (!rule) continue;

    const title = decodeHtml(stripTags(row.groups.title)).replace(/\s+/g, " ").trim();
    const desc = decodeHtml(stripTags(row.groups.desc)).replace(/\s+/g, " ").trim();
    if (!isOttoMusicEvent(title, desc)) continue;

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

function parseOttoIndividualEvents(html) {
  const events = [];
  const oneOffStart = html.indexOf('id="EVTS"');
  const section = oneOffStart === -1 ? html : html.slice(oneOffStart);
  const rowPattern =
    /<tr[^>]*>\s*<td[^>]*class=["']date["'][^>]*>(?<date>[\s\S]*?)<br>\s*<span class=["']time["']>(?<time>[\s\S]*?)<\/span><\/td>\s*<td[^>]*>[\s\S]*?<div class=["']title["']>(?<title>[\s\S]*?)<\/div>\s*<div class=["']desc["']>(?<desc>[\s\S]*?)<\/div>/gi;

  for (const row of section.matchAll(rowPattern)) {
    const rawTitle = decodeHtml(stripTags(row.groups.title)).replace(/\s+/g, " ").trim();
    const desc = decodeHtml(stripTags(row.groups.desc)).replace(/\s+/g, " ").trim();
    if (!isOttoMusicEvent(rawTitle, desc)) continue;

    const startsAt = ottoDate(row.groups.date, row.groups.time);
    if (!startsAt) continue;
    const title = ottoDisplayTitle(rawTitle, desc);

    events.push({
      id: `ottos-${startsAt.toISOString().slice(0, 10)}-${slug(title)}-${startsAt.getHours()}-${startsAt.getMinutes()}`,
      title,
      startsAt: startsAt.toISOString(),
      note: desc || "Otto's event",
      price: /free|no cover/i.test(desc) ? "Free" : "Varies",
      sourceUrl: "https://www.ottosshrunkenhead.com/pages/events.php#EVTS"
    });
  }

  return events;
}

function overlapsOttoIndividual(event, individualEvents) {
  return individualEvents.some((individual) => {
    if (!sameLocalDay(new Date(event.startsAt), new Date(individual.startsAt))) return false;
    const recurringText = `${event.title} ${event.note}`.toLowerCase();
    const individualText = `${individual.title} ${individual.note}`.toLowerCase();
    return (
      normalizedTitle(event.title) === normalizedTitle(individual.title) ||
      recurringText.includes("open mic") && individualText.includes("open mic") ||
      recurringText.includes("get weird") && individualText.includes("get weird") ||
      recurringText.includes("alice's house") && individualText.includes("alice's house")
    );
  });
}

function ottoDisplayTitle(title, desc) {
  if (!/^live music$/i.test(title)) return title;
  const acts = desc
    .split(/\s*(?:\d{1,2}(?::\d{2})?\s*(?:am|pm))\s*/i)
    .map((part) => part.replace(/^\d{1,2}:\d{2}\s+/, "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 3);
  return acts.length ? `Live Music: ${acts.join(" / ")}` : title;
}

function normalizedTitle(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function sameLocalDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isOttoMusicEvent(title, desc) {
  const text = `${title} ${desc}`.toLowerCase();
  const include = [
    "band",
    "dj",
    "music",
    "rock",
    "ska",
    "soul",
    "surf",
    "punk",
    "garage",
    "goth",
    "dance",
    "reggae",
    "dub",
    "electro",
    "synth",
    "new wave",
    "rockabilly",
    "shindig",
    "shakin",
    "open mic",
    "musician",
    "singer songwriter",
    "acoustic",
    "blues"
  ];
  const exclude = ["comedy", "poetry", "reading series", "writers", "performers age", "experimental works"];
  return include.some((word) => text.includes(word)) && !exclude.some((word) => text.includes(word));
}

function ottoDate(dateValue, timeValue) {
  const dateText = decodeHtml(stripTags(dateValue)).replace(/\s+/g, " ").trim();
  const timeText = decodeHtml(stripTags(timeValue)).replace(/\s+/g, " ").trim();
  const dateMatch = dateText.match(/\b(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+([A-Z][a-z]+)\s+(\d{1,2})/);
  const timeMatch = timeText.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (!dateMatch || !timeMatch) return null;

  const [, monthName, day] = dateMatch;
  const year = eventYear(monthName);
  const month = monthIndex(monthName);
  if (month === -1) return null;

  const [hours, minutes] = toTwentyFourHour(`${timeMatch[1]}:${timeMatch[2] || "00"}`, timeMatch[3]).split(":").map(Number);
  return new Date(year, month, Number(day), hours, minutes, 0, 0);
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

function parseClubCumming(html) {
  const events = [];
  const blockPattern = /<article class="eventlist-event[\s\S]*?<\/article>/gi;

  for (const block of html.matchAll(blockPattern)) {
    const rawBlock = block[0];
    const title = textFromMatch(rawBlock, /<h1 class="eventlist-title">\s*<a[^>]+href="(?<url>[^"]+)"[^>]*>(?<text>[\s\S]*?)<\/a>\s*<\/h1>/i);
    if (!title) continue;

    const dateLine = textFromMatch(rawBlock, /<time class="event-date"[^>]*>(?<text>[\s\S]*?)<\/time>/i);
    const timeLine = textFromMatch(rawBlock, /<time class="event-time-12hr-start"[^>]*>(?<text>[\s\S]*?)<\/time>/i);
    const startsAt = clubCummingDate(dateLine, timeLine);
    if (!startsAt || startsAt < new Date()) continue;

    const price = priceFromText(rawBlock) || (/no cover/i.test(rawBlock) ? "No cover" : "Check source");
    const url = rawBlock.match(/<h1 class="eventlist-title">\s*<a[^>]+href="(?<url>[^"]+)"/i)?.groups?.url || "/schedule";

    events.push({
      id: `clubcumming-${startsAt.toISOString().slice(0, 10)}-${slug(title)}`,
      title,
      startsAt: startsAt.toISOString(),
      note: clubCummingNote(rawBlock, title),
      price,
      sourceUrl: absoluteUrl(url, "https://clubcummingnyc.com")
    });
  }

  return events;
}

function clubCummingDate(dateLine, timeLine) {
  const dateMatch = dateLine.match(/\b([A-Z][a-z]+),\s+([A-Z][a-z]+)\s+(\d{1,2}),\s+(\d{4})/);
  const timeMatch = timeLine.match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);
  if (!dateMatch || !timeMatch) return null;

  const [, , monthName, day, year] = dateMatch;
  const month = monthIndex(monthName);
  if (month === -1) return null;

  const [hours, minutes] = toTwentyFourHour(`${timeMatch[1]}:${timeMatch[2]}`, timeMatch[3]).split(":").map(Number);
  return new Date(Number(year), month, Number(day), hours, minutes, 0, 0);
}

function parseBoweryPalace(html) {
  const events = [];
  const sectionPattern = /<div class="tw-section">[\s\S]*?(?=<div class="tw-section">|<div class="tw-pagination">|<\/div>\s*<\/div>\s*<\/div>\s*<div id="tw-event-list-pagination"|$)/gi;

  for (const match of html.matchAll(sectionPattern)) {
    const section = match[0];
    const nameMatch = section.match(/<div class="tw-name">\s*<a[^>]+href="(?<eventUrl>[^"]+)"[^>]*>(?<title>[\s\S]*?)<\/a>/i);
    if (!nameMatch) continue;

    const title = decodeHtml(stripTags(nameMatch.groups.title)).replace(/\s+/g, " ").trim();
    if (!title || /skip to content|calendar|party reservations|read full article/i.test(title)) continue;

    const dateText = [
      textFromMatch(section, /<span class="tw-day-of-week">(?<text>[\s\S]*?)<\/span>/i),
      textFromMatch(section, /<span class="tw-event-date">(?<text>[\s\S]*?)<\/span>/i),
      textFromMatch(section, /<span class="tw-event-time">(?<text>[\s\S]*?)<\/span>/i)
    ].join(" ");

    const startsAt = boweryPalaceDate(dateText);
    if (!startsAt || startsAt < new Date()) continue;
    const price = cleanPrice(textFromMatch(section, /<span class="tw-price">\s*(?<text>[\s\S]*?)<\/span>/i));
    const ticketUrl = section.match(/href="(?<url>https?:\/\/www\.ticketweb\.com[^"]+)"/i)?.groups?.url;

    events.push({
      id: `bowerypalace-${startsAt.toISOString().slice(0, 10)}-${slug(title)}-${startsAt.getHours()}-${startsAt.getMinutes()}`,
      title,
      startsAt: startsAt.toISOString(),
      note: "Bowery Palace listing",
      price: price || "Ticketed",
      sourceUrl: ticketUrl || absoluteUrl(nameMatch.groups.eventUrl, "https://www.bowerypalace.com")
    });
  }

  return events;
}

function parseTransPecos(html) {
  const events = [];
  const anchorPattern = /<a\s+[^>]*href="(?<url>[^"]+)"[^>]*>(?<body>[\s\S]*?)<\/a>/gi;

  for (const anchor of html.matchAll(anchorPattern)) {
    const label = decodeHtml(stripTags(anchor.groups.body)).replace(/\s+/g, " ").trim();
    const match = label.match(/^(\d{2})\/(\d{2})\/(\d{2})\s*@\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM))\s*:?\s*(.+)$/i);
    if (!match) continue;

    const [, month, day, year, time, rawTitle] = match;
    const title = rawTitle.replace(/^[\s;:]+/, "").trim();
    const startsAt = shortDateTime(year, month, day, time);
    if (!title || !startsAt || startsAt < startOfDay(new Date())) continue;

    events.push({
      id: `transpecos-${startsAt.toISOString().slice(0, 10)}-${slug(title)}-${startsAt.getHours()}-${startsAt.getMinutes()}`,
      title: title.trim(),
      startsAt: startsAt.toISOString(),
      note: "Trans-Pecos listing",
      price: "Ticketed",
      sourceUrl: decodeHtml(anchor.groups.url)
    });
  }

  return events;
}

function parseHartBarIcs(ics) {
  return parseIcsEvents(ics, "hartbar", "https://www.hartbarnyc.com/shows");
}

function parseTvEye(html) {
  const events = [];
  const cardPattern = /<div[^>]+seetickets-list-event-container[\s\S]*?(?=<div[^>]+seetickets-list-event-container|<\/article>|$)/gi;

  for (const match of html.matchAll(cardPattern)) {
    const card = match[0];
    const link = card.match(/<p class="fs-18 bold mb-12 title">\s*<a[^>]+href="(?<url>[^"]+)"[^>]*>(?<title>[\s\S]*?)<\/a>/i);
    if (!link) continue;

    const title = decodeHtml(stripTags(link.groups.title)).replace(/\s+/g, " ").trim();
    const dateText = textFromMatch(card, /<p class="fs-18 bold mt-1r date">(?<text>[\s\S]*?)<\/p>/i);
    const timeText = textFromMatch(card, /<span[^>]+class="see-showtime[^"]*"[^>]*>(?<text>[\s\S]*?)<\/span>/i);
    const startsAt = monthDayTimeDate(dateText, timeText);
    if (!title || !startsAt || startsAt < startOfDay(new Date())) continue;

    const genre = textFromMatch(card, /<p class="fs-12 genre">(?<text>[\s\S]*?)<\/p>/i);
    const price = cleanPrice(textFromMatch(card, /<span class="price">(?<text>[\s\S]*?)<\/span>/i));

    events.push({
      id: `tveye-${startsAt.toISOString().slice(0, 10)}-${slug(title)}-${startsAt.getHours()}-${startsAt.getMinutes()}`,
      title,
      startsAt: startsAt.toISOString(),
      note: genre || "TV Eye listing",
      price: price || "Ticketed",
      sourceUrl: decodeHtml(link.groups.url)
    });
  }

  return events;
}

function boweryPalaceDate(value) {
  const match = value.match(/\b(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+([A-Z][a-z]+)\s+(\d{1,2})\s+@\s+(\d{1,2}):(\d{2})\s*([AP]M)/);
  if (!match) return null;

  const [, monthName, day, hour, minute, meridiem] = match;
  const month = monthIndex(monthName);
  if (month === -1) return null;

  const year = eventYear(monthName);
  const [hours, minutes] = toTwentyFourHour(`${hour}:${minute}`, meridiem).split(":").map(Number);
  return new Date(year, month, Number(day), hours, minutes, 0, 0);
}

function textFromMatch(html, pattern) {
  const match = html.match(pattern);
  return match?.groups?.text ? decodeHtml(stripTags(match.groups.text)).replace(/\s+/g, " ").trim() : "";
}

function clubCummingNote(html, title) {
  const description = textFromMatch(html, /<div class="sqs-html-content"[^>]*>(?<text>[\s\S]*?)<\/div>/i)
    .replace(title, "")
    .replace(/\bFeaturing:\b[\s\S]*$/i, "")
    .trim();
  return description ? description.slice(0, 180) : "Club Cumming event";
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

function shortDateTime(year, month, day, time) {
  const fullYear = 2000 + Number(year);
  const monthIndexValue = Number(month) - 1;
  const timeMatch = time.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (!timeMatch || monthIndexValue < 0 || monthIndexValue > 11) return null;

  const [hours, minutes] = toTwentyFourHour(`${timeMatch[1]}:${timeMatch[2] || "00"}`, timeMatch[3]).split(":").map(Number);
  return new Date(fullYear, monthIndexValue, Number(day), hours, minutes, 0, 0);
}

function monthDayTimeDate(dateText, timeText) {
  const dateMatch = dateText.match(/\b(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+([A-Z][a-z]+)\s+(\d{1,2})/i);
  const timeMatch = timeText.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (!dateMatch || !timeMatch) return null;

  const [, monthName, day] = dateMatch;
  const month = monthIndex(monthName);
  if (month === -1) return null;

  const year = eventYear(monthName);
  const [hours, minutes] = toTwentyFourHour(`${timeMatch[1]}:${timeMatch[2] || "00"}`, timeMatch[3]).split(":").map(Number);
  return new Date(year, month, Number(day), hours, minutes, 0, 0);
}

function parseIcsEvents(ics, venueId, sourceUrl) {
  const unfolded = ics.replace(/\r?\n[ \t]/g, "");
  const events = [];
  const now = startOfDay(new Date());

  for (const block of unfolded.matchAll(/BEGIN:VEVENT\r?\n([\s\S]*?)\r?\nEND:VEVENT/g)) {
    const fields = icsFields(block[1]);
    const startsAt = icsDate(fields.DTSTART?.value || "");
    const title = icsText(fields.SUMMARY?.value || "");
    if (!startsAt || !title || startsAt < now) continue;

    const description = icsText(fields.DESCRIPTION?.value || "").replace(/\s+/g, " ").trim();

    events.push({
      id: `${venueId}-${startsAt.toISOString().slice(0, 10)}-${slug(title)}-${startsAt.getHours()}-${startsAt.getMinutes()}`,
      title,
      startsAt: startsAt.toISOString(),
      note: description || "Venue calendar event",
      price: priceFromText(description) || "Check source",
      sourceUrl
    });
  }

  return events;
}

function icsFields(value) {
  const fields = {};
  for (const line of value.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const keyPart = line.slice(0, separator);
    const key = keyPart.split(";")[0];
    fields[key] = {
      params: keyPart,
      value: line.slice(separator + 1)
    };
  }
  return fields;
}

function icsDate(value) {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!match) return null;

  const [, year, month, day, hour = "00", minute = "00", second = "00", utc] = match;
  if (utc) {
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)));
  }

  return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second), 0);
}

function icsText(value) {
  return decodeHtml(value)
    .replace(/\\n/g, " ")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

function eventYear(monthName) {
  const now = new Date();
  const eventMonth = monthIndex(monthName);
  const currentMonth = now.getMonth();
  return eventMonth < currentMonth - 6 ? now.getFullYear() + 1 : now.getFullYear();
}

function priceFromText(value) {
  const text = decodeHtml(stripTags(value)).replace(/\s+/g, " ");
  const match = text.match(/\$\d+(?:\.\d{2})?(?:\s*(?:-|to)\s*\$\d+(?:\.\d{2})?)?(?:\s*GA)?/i);
  return match ? match[0] : "";
}

function cleanPrice(value = "") {
  if (!value) return "";
  if (/^\$0(?:\.00)?$/.test(value.trim())) return "Free";
  return decodeHtml(stripTags(value)).replace(/\s+/g, " ").trim();
}

function absoluteUrl(value, base) {
  try {
    return new URL(decodeHtml(value), base).toString();
  } catch {
    return base;
  }
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
