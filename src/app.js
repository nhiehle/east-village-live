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

      <section class="feed" aria-label="Unified schedule">
        ${filtered.length ? filtered.map(renderEvent).join("") : `<div class="empty">No matching shows in this range.</div>`}
      </section>

      <section class="adapter-note">
        <h2>Adapters</h2>
        <p>Live listings come from per-venue adapters when public pages expose usable event data. Otto's and Mona's still use recurring/fallback listings while we look for reliable public feeds.</p>
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
}

function applySearch(value) {
  state.pendingQuery = value;
  state.query = value;
  renderSchedule();
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

function renderEvent(item) {
  const sourceUrl = item.sourceUrl || item.venue.sourceUrl;
  const sourceName = item.dataSource === "live" ? "Live source" : item.venue.sourceName;
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

async function syncEvents() {
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

render();
syncEvents();
