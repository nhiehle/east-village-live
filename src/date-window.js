export function dateWindow(filter, now = new Date()) {
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

function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}
