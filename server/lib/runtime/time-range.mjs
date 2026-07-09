const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TZ_OFFSET_MS = 9 * 60 * 60 * 1000;

export function resolveTimeRange(input, options = {}) {
  if (!input) return null;
  if (typeof input === "object") {
    const from = input.from ? new Date(input.from) : null;
    const to = input.to ? new Date(input.to) : null;
    return normalizeRange(from, to);
  }

  const value = String(input).trim();
  if (!value) return null;
  const now = options.now ? new Date(options.now) : new Date();
  const offsetMs = Number.isFinite(options.timezoneOffsetMs) ? options.timezoneOffsetMs : DEFAULT_TZ_OFFSET_MS;
  const todayStart = startOfLocalDay(now, offsetMs);
  const dayOfWeek = new Date(todayStart.getTime() + offsetMs).getUTCDay();
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  const thisMonday = new Date(todayStart.getTime() - daysSinceMonday * DAY_MS);

  if (value === "today") {
    return { from: todayStart, to: now };
  }
  if (value === "yesterday") {
    const from = new Date(todayStart.getTime() - DAY_MS);
    return { from, to: new Date(todayStart.getTime() - 1) };
  }
  if (value === "this_week") {
    return { from: thisMonday, to: now };
  }
  if (value === "last_week") {
    const from = new Date(thisMonday.getTime() - 7 * DAY_MS);
    return { from, to: new Date(thisMonday.getTime() - 1) };
  }
  if (value === "last_7_days") {
    return { from: new Date(now.getTime() - 7 * DAY_MS), to: now };
  }
  if (value === "last_month") {
    return { from: new Date(now.getTime() - 30 * DAY_MS), to: now };
  }

  const rangeMatch = value.match(/^(.+?)(?:\.\.|\/)(.+)$/);
  if (rangeMatch) {
    return normalizeRange(parseIsoBoundary(rangeMatch[1], false, offsetMs), parseIsoBoundary(rangeMatch[2], true, offsetMs));
  }
  const single = parseIsoBoundary(value, false, offsetMs);
  if (single) {
    return { from: single, to: new Date() };
  }
  return null;
}

function normalizeRange(from, to) {
  const normalizedFrom = from instanceof Date && Number.isFinite(from.getTime()) ? from : null;
  const normalizedTo = to instanceof Date && Number.isFinite(to.getTime()) ? to : null;
  if (!normalizedFrom && !normalizedTo) return null;
  return { from: normalizedFrom, to: normalizedTo };
}

function startOfLocalDay(date, offsetMs) {
  const local = new Date(date.getTime() + offsetMs);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - offsetMs);
}

function parseIsoBoundary(value, endOfDay, offsetMs) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [year, month, day] = text.split("-").map(Number);
    const start = Date.UTC(year, month - 1, day) - offsetMs;
    return new Date(start + (endOfDay ? DAY_MS - 1 : 0));
  }
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date : null;
}

