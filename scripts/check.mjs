import { access, readFile } from "node:fs/promises";

const required = [
  "index.html",
  "manifest.webmanifest",
  "sw.js",
  "src/app.js",
  "src/adapters.js",
  "src/data.js",
  "src/date-window.js",
  "src/styles.css",
  "data/events.json",
  "icons/icon.svg",
  "icons/apple-touch-icon.svg"
];

for (const file of required) {
  await access(file);
}

const app = await readFile("src/app.js", "utf8");
const data = await readFile("src/data.js", "utf8");
for (const venue of [
  "Lucinda's",
  "Otto's Shrunken Head",
  "Berlin",
  "Mercury Lounge",
  "Night Club 101",
  "Drom",
  "Mona's",
  "Nublu",
  "11th St. Bar",
  "Club Cumming",
  "Arlene's Grocery",
  "Pianos",
  "Bowery Palace",
  "Sour Mouse",
  "Sugar Mouse"
]) {
  if (!data.includes(venue)) throw new Error(`Missing venue: ${venue}`);
}

if (!app.includes("/api/events")) throw new Error("App is not wired to the events API");

const { dateWindow } = await import("../src/date-window.js");
const now = new Date("2026-05-07T18:00:00-04:00");
const tonight = dateWindow("tonight", now);
const tomorrowEvening = new Date("2026-05-08T20:00:00-04:00");
if (tomorrowEvening >= tonight.start && tomorrowEvening <= tonight.end) {
  throw new Error("Tonight window includes tomorrow evening");
}

console.log("Static app check passed.");
