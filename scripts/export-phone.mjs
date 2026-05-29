import { mkdir, readFile, writeFile } from "node:fs/promises";
import { loadUnifiedEvents } from "../src/adapters.js";
import { HOME, venueSeeds } from "../src/data.js";

process.env.TZ = "America/New_York";

const outDir = "phone-export";
const css = await readFile("src/styles.css", "utf8");
const data = await loadUnifiedEvents();
const venues = venueSeeds.map((venue) => ({ ...venue, distance: milesFromHome(venue.lat, venue.lng) }));
const exportedAt = new Date().toISOString();

await mkdir(outDir, { recursive: true });
await writeFile(
  `${outDir}/index.html`,
  html({
    css,
    payload: {
      home: HOME,
      venues,
      events: data.events,
      adapterStatus: data.adapterStatus,
      fetchedAt: data.fetchedAt,
      exportedAt
    }
  })
);

console.log(`Phone export wrote ${outDir}/index.html with ${data.events.length} events.`);

function html({ css, payload }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#101820" />
    <title>East Village Live</title>
    <style>${css}</style>
  </head>
  <body>
    <div id="app"></div>
    <script id="snapshot" type="application/json">${escapeScript(JSON.stringify(payload))}</script>
    <script>
const snapshot = JSON.parse(document.querySelector("#snapshot").textContent);
const HOME = snapshot.home;
const venues = snapshot.venues;
let events = normalizeEvents(snapshot.events);
const state = {
  dateFilter: "week",
  venueFilter: "all",
  query: "",
  pendingQuery: "",
  favorites: new Set(JSON.parse(localStorage.getItem("favoriteVenues") || "[]"))
};

function normalizeEvents(seeds) {
  return seeds
    .map((item) => ({
      ...item,
      startsAt: new Date(item.startsAt),
      venue: venues.find((venue) => venue.id === item.venueId)
    }))
    .filter((item) => item.venue && !Number.isNaN(item.startsAt.valueOf()))
    .sort((a, b) => a.startsAt - b.startsAt);
}

function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function dateWindow(filter, now = new Date()) {
  const start = filter === "tonight" ? new Date(now) : startOfDay(now);
  const end = startOfDay(now);
  if (filter === "tonight") {
    end.setDate(end.getDate() + 1);
    end.setHours(4, 0, 0, 0);
  } else {
    const days = filter === "month" ? 31 : 7;
    end.setDate(end.getDate() + days);
    end.setHours(23, 59, 59, 999);
  }
  return { start, end };
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
    const matchesSearch = !query || \`\${item.title} \${item.venue.name} \${item.venue.vibe}\`.toLowerCase().includes(query);
    return matchesDate && matchesVenue && matchesSearch;
  });
}

function render() {
  const app = document.querySelector("#app");
  const filtered = filterEvents();
  const favoriteVenues = venues.filter((venue) => state.favorites.has(venue.id));
  const liveVenueNames = snapshot.adapterStatus
    .filter((status) => status.ok)
    .map((status) => venues.find((venue) => venue.id === status.venueId)?.name)
    .filter(Boolean);

  app.innerHTML = \`
    <main class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">\${HOME.label}</p>
          <h1>East Village Live</h1>
        </div>
        <div class="status-pill">\${filtered.length} shows</div>
      </header>

      <section class="sync-banner live">
        <strong>Phone snapshot</strong>
        <span>\${events.length} listings exported from \${liveVenueNames.join(", ")}. Updated \${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(snapshot.exportedAt))}.</span>
      </section>

      <section class="controls" aria-label="Schedule filters">
        <div class="segmented" role="group" aria-label="Date range">
          \${rangeButton("tonight", "Tonight")}
          \${rangeButton("week", "Week")}
          \${rangeButton("month", "Month")}
        </div>
        <label class="search">
          <span>Search</span>
          <input type="search" value="\${escapeHtml(state.pendingQuery)}" placeholder="artist, venue, genre" />
        </label>
        <select aria-label="Venue filter">
          <option value="all">All venues</option>
          \${venues.map((venue) => \`<option value="\${venue.id}" \${venue.id === state.venueFilter ? "selected" : ""}>\${escapeHtml(venue.name)}</option>\`).join("")}
        </select>
      </section>

      <section class="venue-strip" aria-label="Venues">
        \${venues.map(renderVenueChip).join("")}
      </section>

      \${favoriteVenues.length ? \`<section class="favorites">Favorites: \${favoriteVenues.map((venue) => escapeHtml(venue.name)).join(", ")}</section>\` : ""}

      <section class="feed" aria-label="Unified schedule">
        \${filtered.length ? filtered.map(renderEvent).join("") : \`<div class="empty">No matching shows in this range.</div>\`}
      </section>
    </main>
  \`;

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

  if (status) status.textContent = \`\${filtered.length} shows\`;
  if (feed) {
    feed.innerHTML = filtered.length ? filtered.map(renderEvent).join("") : \`<div class="empty">No matching shows in this range.</div>\`;
  }
}

function rangeButton(value, label) {
  return \`<button class="\${state.dateFilter === value ? "active" : ""}" data-range="\${value}" type="button">\${label}</button>\`;
}

function renderVenueChip(venue) {
  const selected = state.venueFilter === venue.id;
  const favorite = state.favorites.has(venue.id);
  return \`
    <button class="venue-chip \${selected ? "selected" : ""}" data-venue="\${venue.id}" type="button" style="--venue:\${venue.color}">
      <span class="swatch"></span>
      <span>
        <strong>\${escapeHtml(venue.name)}</strong>
        <small>\${venue.distance.toFixed(1)} mi</small>
      </span>
      <span class="star \${favorite ? "saved" : ""}" data-favorite="\${venue.id}" title="\${favorite ? "Remove favorite" : "Save favorite"}">★</span>
    </button>
  \`;
}

function renderEvent(item) {
  const sourceUrl = item.sourceUrl || item.venue.sourceUrl;
  return \`
    <article class="event-card live" style="--venue:\${item.venue.color}">
      <div class="date-block">
        <strong>\${formatDate(item.startsAt)}</strong>
        <span>\${formatTime(item.startsAt)}</span>
      </div>
      <div class="event-main">
        <div class="event-title-row">
          <h2>\${escapeHtml(item.title)}</h2>
          <span class="price">\${escapeHtml(item.price)}</span>
        </div>
        <p>\${escapeHtml(item.venue.name)} · \${escapeHtml(item.venue.address)} · \${item.venue.distance.toFixed(1)} mi</p>
        <p class="note">\${escapeHtml(item.note)}</p>
        <a href="\${sourceUrl}" target="_blank" rel="noreferrer">Open source</a>
      </div>
    </article>
  \`;
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

render();
    </script>
  </body>
</html>`;
}

function escapeScript(value) {
  return value.replace(/</g, "\\u003c");
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
