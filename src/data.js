export const HOME = { lat: 40.7296, lng: -73.9817, label: "14th & Avenue A" };

export const venueSeeds = [
  {
    id: "lucindas",
    name: "Lucinda's",
    address: "169 Avenue A",
    lat: 40.7289,
    lng: -73.9817,
    vibe: "Honky-tonk, roots, two-step",
    sourceUrl: "https://www.lucindasnyc.com/calendar/",
    sourceName: "Venue calendar",
    color: "#b7442e"
  },
  {
    id: "ottos",
    name: "Otto's Shrunken Head",
    address: "538 E 14th St",
    lat: 40.7294,
    lng: -73.9789,
    vibe: "Tiki dive, punk, surf, DJs",
    sourceUrl: "https://www.ottosshrunkenhead.com/",
    sourceName: "Venue site",
    color: "#2f7f7b"
  },
  {
    id: "berlin",
    name: "Berlin",
    address: "25 Avenue A",
    lat: 40.7235,
    lng: -73.9861,
    vibe: "Downstairs shows at 2A",
    sourceUrl: "https://berlin.nyc/",
    sourceName: "Venue calendar",
    color: "#734f96"
  },
  {
    id: "mercury",
    name: "Mercury Lounge",
    address: "217 E Houston St",
    lat: 40.7221,
    lng: -73.9868,
    vibe: "Indie, touring bands",
    sourceUrl: "https://www.ticketmaster.com/mercury-lounge-tickets-new-york/venue/1101",
    sourceName: "Ticketmaster",
    color: "#3d66a2"
  },
  {
    id: "nightclub101",
    name: "Night Club 101",
    address: "101 Avenue A",
    lat: 40.7256,
    lng: -73.9842,
    vibe: "Indie, dance, experimental",
    sourceUrl: "https://www.nightclub101.com/",
    sourceName: "Venue site",
    color: "#1f6b4d"
  },
  {
    id: "drom",
    name: "Drom",
    address: "85 Avenue A",
    lat: 40.725,
    lng: -73.9846,
    vibe: "World music, jazz, soul, dance",
    sourceUrl: "https://dromnyc.com/events/",
    sourceName: "Venue calendar",
    color: "#c05a8a"
  },
  {
    id: "monas",
    name: "Mona's",
    address: "224 Avenue B",
    lat: 40.7292,
    lng: -73.9784,
    vibe: "Bluegrass and late-night jazz",
    sourceUrl: "https://www.facebook.com/monasbarnyc",
    sourceName: "Facebook",
    color: "#9f5b2e"
  },
  {
    id: "nublu",
    name: "Nublu",
    address: "151 Avenue C",
    lat: 40.7257,
    lng: -73.9771,
    vibe: "Jazz, global grooves, DJs",
    sourceUrl: "https://www.nublu.net/",
    sourceName: "Venue calendar",
    color: "#8f2f58"
  }
];

export const fallbackEventSeeds = [
  single("berlin", "E.R.O.S. | Clorine | Effy Marella", "2026-05-07T18:30:00", "Doors 6 PM", "Ticketed", "seed"),
  single("berlin", "Late show at Berlin", "2026-05-07T21:30:00", "Check venue for lineup", "Ticketed", "seed"),
  single("nightclub101", "Jake Sondy", "2026-05-14T22:00:00", "Late show", "Ticketed", "seed"),
  single("nightclub101", "Nappy Nina, Swarvy, H31R", "2026-05-15T19:00:00", "At 101 Avenue A", "Ticketed", "seed"),
  single("nightclub101", "Nara's Room, Wulfer, Raavo", "2026-05-16T19:00:00", "At 101 Avenue A", "Ticketed", "seed"),
  recurring(
    "monas",
    "Monday Bluegrass Jam",
    1,
    "21:00",
    "Appalachian fiddle, bluegrass, and old-school country jam session",
    "Free",
    "recurring",
    "https://www.groovehub.io/events/monas-monday-night-bluegrass-session/20260629",
    "Groovehub"
  ),
  recurring(
    "monas",
    "Tuesday Trad Jazz",
    2,
    "21:00",
    "Mona's Hot Five weekly Tuesday session",
    "Usually free",
    "recurring",
    "https://www.dennislichtman.com/monas",
    "Dennis Lichtman"
  ),
  recurring("ottos", "Dark Water Tuesday", 2, "21:00", "Every third Tuesday, goth/punk/new wave DJs", "Free", "recurring"),
  recurring("ottos", "Back room live bands", 5, "20:00", "Check venue socials for each lineup", "Varies", "recurring"),
  recurring("ottos", "Weekend tiki back room", 6, "20:00", "Punk, surf, rock, DJs", "Varies", "recurring")
];

function single(venueId, title, startsAt, note, price, dataSource, sourceUrl = "", sourceName = "") {
  return { venueId, title, startsAt, note, price, dataSource, sourceUrl, sourceName, recurring: false };
}

function recurring(venueId, title, dayOfWeek, time, note, price, dataSource, sourceUrl = "", sourceName = "") {
  return { venueId, title, dayOfWeek, time, note, price, dataSource, sourceUrl, sourceName, recurring: true };
}
