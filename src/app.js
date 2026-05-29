import { HOME, fallbackEventSeeds, venueSeeds } from "./data.js";
import { dateWindow } from "./date-window.js";

const venues = venueSeeds.map((venue) => ({ ...venue, distance: milesFromHome(venue.lat, venue.lng) }));
let events = normalizeEvents(fallbackEventSeeds);

const state = {
  dateFilter: "week",
  venueFilter: "all",
  query: "",
  pendingQuery: "",
  favorites: new Set(JSON.parse(localStorage.getItem("favoriteVenues") || "[]")),
  sync: {
    loading: true,
    mode: "offline",
    message: "Loading venue pages...",
    fetchedAt: ""
  }
};

const pullRefresh = {
  startY: 0,
  startX: 0,
  distance: 0,
  active: false,
  tracking: false,
  threshold: 72
};

const mapBounds = venues.reduce(
  (bounds, venue) => ({
    minLat: Math.min(bounds.minLat, venue.lat),
    maxLat: Math.max(bounds.maxLat, venue.lat),
    minLng: Math.min(bounds.minLng, venue.lng),
    maxLng: Math.max(bounds.maxLng, venue.lng)
  }),
  {
    minLat: HOME.lat,
    maxLat: HOME.lat,
    minLng: HOME.lng,
    maxLng: HOME.lng
  }
);

const MAP = { width: 1080, height: 760, pad: 74 };

function normalizeEvents(seeds) {
  return expandRecurring(seeds)
    .map((item) => ({
      ...item,
      id: item.id || `${item.venueId}-${item.title}-${item.startsAt}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      startsAt: item.startsAt instanceof Date ? item.startsAt : new Date(item.startsAt),
      venue: venues.find((venue) => venue.id === item.venueId)
    }))
    .filter((item) => item.venue && !Number.isNaN(item.startsAt.valueOf()))
    .sort((a, b) => a.startsAt - b.startsAt);
}

function expandRecurring(items) {
  const now = startOfDay(new Date());
  const generated = [];

  for (const item of items) {
    if (!item.recurring) {
      generated.push(item);
      continue;
    }

    for (let offset = 0; offset < 35; offset += 1) {
      const date = new Date(now);
      date.setDate(now.getDate() + offset);
      if (date.getDay() !== item.dayOfWeek) continue;
      if (item.title.includes("third") || item.title.includes("Dark Water")) {
        const weekOfMonth = Math.ceil(date.getDate() / 7);
        if (weekOfMonth !== 3) continue;
      }
      const [hours, minutes] = item.time.split(":").map(Number);
      date.setHours(hours, minutes, 0, 0);
      generated.push({ ...item, id: `${item.id}-${date.toISOString().slice(0, 10)}`, startsAt: date });
    }
  }

  return generated;
}

function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function milesFromHome(lat, lng) {
  const earthMiles = 3958.8;
  const dLat = toRad(lat - HOME.lat);
  const dLng = toRad(lng - HOME.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(HOME.lat)) * Math.cos(toRad(lat)) * Math.sin(dLng / 2) ** 2;
  return earthMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(value) {
  return (value * Math.PI) / 180;
}

function formatDate(date) {
  const today = startOfDay(new Date());
  const target = startOfDay(date);
  const days = Math.round((target - today) / 86400000);
  if (days === 0) return "Tonight";
  if (days === 1) return "Tomorrow";
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(date);
}

function formatTime(date) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
}

function filterEvents() {
  const { start, end } = dateWindow(state.dateFilter);
  const query = state.query.trim().toLowerCase();

  return events.filter((item) => {
    const matchesDate = item.startsAt >= start && item.startsAt <= end;
    const matchesVenue = state.venueFilter === "all" || item.venueId === state.venueFilter;
    const matchesSearch = !query || `${item.title} ${item.venue.name} ${item.venue.vibe}`.toLowerCase().includes(query);
    return matchesDate && matchesVenue && matchesSearch;
  });
}

function render() {
  const app = document.querySelector("#app");
  const filtered = filterEvents();
  const favoriteVenues = venues.filter((venue) => state.favorites.has(venue.id));
  app.innerHTML = `
    <div class="pull-refresh" aria-hidden="true">
      <span>Pull to refresh</span>
    </div>
    <main class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">${HOME.label}</p>
          <h1>East Village Live</h1>
        </div>
        <div class="status-pill">${state.sync.loading ? "Syncing" : `${filtered.length} shows`}</div>
      </header>

      <section class="sync-banner ${state.sync.mode}">
        <strong>${state.sync.mode === "live" ? "Live data" : "Fallback data"}</strong>
        <span>${state.sync.message}</span>
      </section>

      <section class="controls" aria-label="Schedule filters">
        <div class="segmented" role="group" aria-label="Date range">
          ${rangeButton("tonight", "Tonight")}
          ${rangeButton("week", "Week")}
          ${rangeButton("month", "Month")}
        </div>
        <label class="search">
          <span>Search</span>
          <input type="search" value="${escapeHtml(state.pendingQuery)}" placeholder="artist, venue, genre" />
        </label>
        <select aria-label="Venue filter">
          <option value="all">All venues</option>
          ${venues.map((venue) => `<option value="${venue.id}" ${venue.id === state.venueFilter ? "selected" : ""}>${venue.name}</option>`).join("")}
        </select>
      </section>

      <section class="venue-strip" aria-label="Venues">
        ${venues.map(renderVenueChip).join("")}
      </section>

      ${favoriteVenues.length ? `<section class="favorites">Favorites: ${favoriteVenues.map((venue) => escapeHtml(venue.name)).join(", ")}</section>` : ""}

      ${renderMap(filtered)}

      <section class="feed" aria-label="Unified schedule">
        ${filtered.length ? filtered.map(renderEvent).join("") : `<div class="empty">No matching shows in this range.</div>`}
      </section>

      <section class="adapter-note">
        <h2>Adapters</h2>
        <p>Live listings come from per-venue adapters when public pages expose usable event data. Recurring neighborhood nights fill in places that publish stable weekly programming instead of dated calendars.</p>
      </section>
    </main>
  `;

  app.querySelectorAll("[data-range]").forEach((button) => {
    button.addEventListener("click", () => {
      state.dateFilter = button.dataset.range;
      render();
    });
  });

  app.querySelector("input[type='search']").addEventListener("input", (event) => {
    state.pendingQuery = event.target.value;
  });

  app.querySelector("input[type='search']").addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    applySearch(event.target.value);
  });

  app.querySelector("input[type='search']").addEventListener("search", (event) => {
    applySearch(event.target.value);
  });

  app.querySelector("select").addEventListener("change", (event) => {
    state.venueFilter = event.target.value;
    render();
  });

  app.querySelectorAll("[data-venue]").forEach((button) => {
    button.addEventListener("click", () => {
      state.venueFilter = state.venueFilter === button.dataset.venue ? "all" : button.dataset.venue;
      render();
    });
  });

  app.querySelectorAll("[data-favorite]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const id = button.dataset.favorite;
      if (state.favorites.has(id)) state.favorites.delete(id);
      else state.favorites.add(id);
      localStorage.setItem("favoriteVenues", JSON.stringify([...state.favorites]));
      render();
    });
  });

  centerMap();
}

function applySearch(value) {
  state.pendingQuery = value;
  state.query = value;
  render();
}

function renderSchedule() {
  const filtered = filterEvents();
  const status = document.querySelector(".status-pill");
  const feed = document.querySelector(".feed");

  if (status) status.textContent = state.sync.loading ? "Syncing" : `${filtered.length} shows`;
  if (feed) {
    feed.innerHTML = filtered.length ? filtered.map(renderEvent).join("") : `<div class="empty">No matching shows in this range.</div>`;
  }
}

function rangeButton(value, label) {
  return `<button class="${state.dateFilter === value ? "active" : ""}" data-range="${value}" type="button">${label}</button>`;
}

function renderVenueChip(venue) {
  const selected = state.venueFilter === venue.id;
  const favorite = state.favorites.has(venue.id);
  return `
    <button class="venue-chip ${selected ? "selected" : ""}" data-venue="${venue.id}" type="button" style="--venue:${venue.color}">
      <span class="swatch"></span>
      <span>
        <strong>${venue.name}</strong>
        <small>${venue.distance.toFixed(1)} mi</small>
      </span>
      <span class="star ${favorite ? "saved" : ""}" data-favorite="${venue.id}" title="${favorite ? "Remove favorite" : "Save favorite"}">★</span>
    </button>
  `;
}

function renderMap(filtered) {
  const counts = filtered.reduce((acc, event) => {
    acc[event.venueId] = (acc[event.venueId] || 0) + 1;
    return acc;
  }, {});

  return `
    <section class="map-panel" aria-label="Venue map">
      <div class="map-meta">
        <strong>${state.venueFilter === "all" ? "Map" : escapeHtml(venues.find((venue) => venue.id === state.venueFilter)?.name || "Map")}</strong>
        <span>${state.venueFilter === "all" ? "Drag the map, tap a pin" : "Tap the pin again to show all venues"}</span>
      </div>
      <div class="venue-map-scroll">
        <div class="venue-map" style="width:${MAP.width}px;height:${MAP.height}px">
          <div class="map-region east-village">East Village</div>
          <div class="map-region les">Lower East Side</div>
          <div class="map-region ridgewood">Ridgewood / Bushwick</div>
          ${renderHomePin()}
          ${venues.map((venue) => renderMapPin(venue, counts[venue.id] || 0)).join("")}
        </div>
      </div>
    </section>
  `;
}

function renderHomePin() {
  const point = mapPoint(HOME);
  return `
    <div class="home-pin" style="left:${point.x}px;top:${point.y}px">
      <span></span>
      <strong>14th & A</strong>
    </div>
  `;
}

function renderMapPin(venue, count) {
  const point = mapPoint(venue);
  const selected = state.venueFilter === venue.id;
  return `
    <button
      class="map-pin ${selected ? "selected" : ""} ${count ? "" : "quiet"}"
      data-venue="${venue.id}"
      style="left:${point.x}px;top:${point.y}px;--venue:${venue.color}"
      type="button"
      title="${escapeHtml(venue.name)}"
    >
      <span class="map-dot">${count || ""}</span>
      <span class="map-label">${escapeHtml(venue.name)}</span>
    </button>
  `;
}

function centerMap() {
  const scroller = document.querySelector(".venue-map-scroll");
  if (!scroller) return;

  const focusVenue = venues.find((venue) => venue.id === state.venueFilter);
  const point = mapPoint(focusVenue || HOME);
  scroller.scrollLeft = Math.max(0, point.x - scroller.clientWidth / 2);
  scroller.scrollTop = Math.max(0, point.y - scroller.clientHeight / 2);
}

function mapPoint({ lat, lng }) {
  const latSpan = Math.max(0.001, mapBounds.maxLat - mapBounds.minLat);
  const lngSpan = Math.max(0.001, mapBounds.maxLng - mapBounds.minLng);
  return {
    x: MAP.pad + ((lng - mapBounds.minLng) / lngSpan) * (MAP.width - MAP.pad * 2),
    y: MAP.pad + ((mapBounds.maxLat - lat) / latSpan) * (MAP.height - MAP.pad * 2)
  };
}

function renderEvent(item) {
  const sourceUrl = item.sourceUrl || item.venue.sourceUrl;
  const sourceName = item.sourceName || (item.dataSource === "live" ? "Live source" : item.venue.sourceName);
  return `
    <article class="event-card ${item.dataSource === "live" ? "live" : ""}" style="--venue:${item.venue.color}">
      <div class="date-block">
        <strong>${formatDate(item.startsAt)}</strong>
        <span>${formatTime(item.startsAt)}</span>
      </div>
      <div class="event-main">
        <div class="event-title-row">
          <h2>${escapeHtml(item.title)}</h2>
          <span class="price">${escapeHtml(item.price)}</span>
        </div>
        <p>${item.venue.name} · ${item.venue.address} · ${item.venue.distance.toFixed(1)} mi</p>
        <p class="note">${escapeHtml(item.note)}</p>
        <a href="${sourceUrl}" target="_blank" rel="noreferrer">Open ${sourceName}</a>
      </div>
    </article>
  `;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

async function syncEvents({ manual = false } = {}) {
  if (manual) {
    state.sync = {
      ...state.sync,
      loading: true,
      message: "Refreshing listings..."
    };
    render();
  }

  try {
    const payload = await fetchEventPayload();
    events = normalizeEvents(payload.events);
    const liveCount = events.filter((item) => item.dataSource === "live").length;
    const liveVenueNames = (payload.adapterStatus || [])
      .filter((status) => status.ok)
      .map((status) => venues.find((venue) => venue.id === status.venueId)?.name)
      .filter(Boolean);
    state.sync = {
      loading: false,
      mode: liveCount ? "live" : "offline",
      fetchedAt: payload.fetchedAt,
      message: liveCount
        ? `${liveCount} listings loaded from ${liveVenueNames.join(", ")}.`
        : "Using saved fallback listings until venue pages respond."
    };
  } catch (error) {
    state.sync = {
      loading: false,
      mode: "offline",
      message: "Using saved fallback listings because live sync failed.",
      fetchedAt: ""
    };
  }
  render();
}

async function fetchEventPayload() {
  if (["localhost", "127.0.0.1"].includes(window.location.hostname)) {
    const apiResponse = await fetch("/api/events").catch(() => null);
    if (apiResponse?.ok) return apiResponse.json();
  }

  const staticResponse = await fetch("./data/events.json", { cache: "no-store" }).catch(() => null);
  if (staticResponse?.ok) return staticResponse.json();

  const apiResponse = await fetch("/api/events");
  if (!apiResponse.ok) throw new Error(`API returned ${apiResponse.status}`);
  return apiResponse.json();
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

installPullToRefresh();
render();
syncEvents();

function installPullToRefresh() {
  window.addEventListener(
    "touchstart",
    (event) => {
      if (event.touches.length !== 1 || window.scrollY > 0 || state.sync.loading) return;
      const touch = event.touches[0];
      pullRefresh.startY = touch.clientY;
      pullRefresh.startX = touch.clientX;
      pullRefresh.distance = 0;
      pullRefresh.tracking = true;
      pullRefresh.active = false;
    },
    { passive: true }
  );

  window.addEventListener(
    "touchmove",
    (event) => {
      if (!pullRefresh.tracking || event.touches.length !== 1) return;

      const touch = event.touches[0];
      const deltaY = touch.clientY - pullRefresh.startY;
      const deltaX = Math.abs(touch.clientX - pullRefresh.startX);
      if (deltaY <= 0 || deltaX > deltaY) return;

      event.preventDefault();
      pullRefresh.distance = Math.min(110, deltaY * 0.55);
      pullRefresh.active = pullRefresh.distance >= pullRefresh.threshold;
      updatePullRefreshIndicator();
    },
    { passive: false }
  );

  window.addEventListener(
    "touchend",
    () => {
      if (!pullRefresh.tracking) return;
      const shouldRefresh = pullRefresh.active;
      resetPullRefreshIndicator();
      pullRefresh.tracking = false;
      pullRefresh.active = false;
      pullRefresh.distance = 0;
      if (shouldRefresh) syncEvents({ manual: true });
    },
    { passive: true }
  );

  window.addEventListener(
    "touchcancel",
    () => {
      resetPullRefreshIndicator();
      pullRefresh.tracking = false;
      pullRefresh.active = false;
      pullRefresh.distance = 0;
    },
    { passive: true }
  );
}

function updatePullRefreshIndicator() {
  const indicator = document.querySelector(".pull-refresh");
  const shell = document.querySelector(".shell");
  if (!indicator || !shell) return;

  indicator.classList.toggle("ready", pullRefresh.active);
  indicator.querySelector("span").textContent = pullRefresh.active ? "Release to refresh" : "Pull to refresh";
  indicator.style.transform = `translate(-50%, ${Math.max(0, pullRefresh.distance - 50)}px)`;
  indicator.style.opacity = String(Math.min(1, pullRefresh.distance / pullRefresh.threshold));
  shell.style.transform = `translateY(${Math.min(36, pullRefresh.distance / 2.5)}px)`;
}

function resetPullRefreshIndicator() {
  const indicator = document.querySelector(".pull-refresh");
  const shell = document.querySelector(".shell");
  if (indicator) {
    indicator.classList.remove("ready");
    indicator.style.transform = "";
    indicator.style.opacity = "";
    const label = indicator.querySelector("span");
    if (label) label.textContent = "Pull to refresh";
  }
  if (shell) shell.style.transform = "";
}
