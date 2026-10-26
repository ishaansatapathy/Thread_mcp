"use strict";

/**
 * Minimal natural-language time parser for the demo flow:
 * "tomorrow 3pm", "today 17:00", "in 2h", "in 30m", or any ISO datetime.
 */
function parseWhen(text) {
  const now = new Date();
  const s = text.trim().toLowerCase();

  const relMatch = s.match(/^in\s+(\d+)\s*(h|hr|hour|hours|m|min|minutes)$/);
  if (relMatch) {
    const amount = parseInt(relMatch[1], 10);
    const ms = relMatch[2].startsWith("h") ? amount * 3_600_000 : amount * 60_000;
    return new Date(now.getTime() + ms);
  }

  let base = new Date(now);
  let rest = s;

  if (s.startsWith("tomorrow")) {
    base.setDate(base.getDate() + 1);
    rest = s.replace("tomorrow", "").trim();
  } else if (s.startsWith("today")) {
    rest = s.replace("today", "").trim();
  } else {
    const iso = new Date(text);
    if (!isNaN(iso.getTime())) return iso;
  }

  const timeMatch = rest.match(/(\d{1,2})(:(\d{2}))?\s*(am|pm)?/);
  if (timeMatch) {
    let hour = parseInt(timeMatch[1], 10);
    const min = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
    const ampm = timeMatch[4];
    if (ampm === "pm" && hour < 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;
    base.setHours(hour, min, 0, 0);
  }

  return base;
}

module.exports = { parseWhen };
