"use strict";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const CALENDAR = "https://www.googleapis.com/calendar/v3";
const DRIVE = "https://www.googleapis.com/drive/v3";
const CLASSROOM = "https://classroom.googleapis.com/v1";

async function g(url, token, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google API error (${res.status}): ${text.slice(0, 300)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function header(headers, name) {
  const h = (headers || []).find((h) => h.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : "";
}

// ── Gmail ──────────────────────────────────────────────────────────────────

async function gmailList(token, { query = "", maxResults = 10 } = {}) {
  const q = query ? `&q=${encodeURIComponent(query)}` : "";
  const list = await g(`${GMAIL}/messages?maxResults=${maxResults}${q}`, token);
  const ids = (list.messages || []).map((m) => m.id);
  const messages = await Promise.all(
    ids.map((id) =>
      g(`${GMAIL}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`, token),
    ),
  );
  return messages.map((m) => ({
    id: m.id,
    threadId: m.threadId,
    from: header(m.payload.headers, "From"),
    subject: header(m.payload.headers, "Subject"),
    snippet: m.snippet,
    unread: (m.labelIds || []).includes("UNREAD"),
  }));
}

function gmailSearch(token, query, maxResults = 10) {
  return gmailList(token, { query, maxResults });
}

async function gmailGetThread(token, threadId) {
  const thread = await g(
    `${GMAIL}/threads/${threadId}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
    token,
  );
  return thread.messages.map((m) => ({
    from: header(m.payload.headers, "From"),
    subject: header(m.payload.headers, "Subject"),
    date: header(m.payload.headers, "Date"),
    snippet: m.snippet,
  }));
}

function buildRawEmail({ to, subject, body }) {
  const message = [`To: ${to}`, `Subject: ${subject}`, "Content-Type: text/plain; charset=utf-8", "", body].join(
    "\n",
  );
  return Buffer.from(message).toString("base64url");
}

function gmailSend(token, { to, subject, body }) {
  const raw = buildRawEmail({ to, subject, body });
  return g(`${GMAIL}/messages/send`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
}

// ── Calendar ───────────────────────────────────────────────────────────────

async function calendarList(token, { timeMin, timeMax, maxResults = 10 } = {}) {
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    maxResults: String(maxResults),
    singleEvents: "true",
    orderBy: "startTime",
  });
  const result = await g(`${CALENDAR}/calendars/primary/events?${params}`, token);
  return (result.items || []).map((e) => ({
    id: e.id,
    summary: e.summary || "(no title)",
    start: e.start?.dateTime || e.start?.date,
    end: e.end?.dateTime || e.end?.date,
    attendees: (e.attendees || []).map((a) => a.email),
    meetLink: e.hangoutLink,
    htmlLink: e.htmlLink,
  }));
}

function calendarCreateEvent(token, { summary, start, end, attendees = [], withMeet = false }) {
  const body = {
    summary,
    start: { dateTime: start },
    end: { dateTime: end },
    attendees: attendees.map((email) => ({ email })),
  };
  if (withMeet) {
    body.conferenceData = { createRequest: { requestId: Math.random().toString(36).slice(2) } };
  }
  const params = withMeet ? "?conferenceDataVersion=1" : "";
  return g(`${CALENDAR}/calendars/primary/events${params}`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createMeetLink(token) {
  const now = new Date();
  const end = new Date(now.getTime() + 30 * 60 * 1000);
  const event = await calendarCreateEvent(token, {
    summary: "Meet — created via threadmcp",
    start: now.toISOString(),
    end: end.toISOString(),
    withMeet: true,
  });
  return { link: event.hangoutLink, eventId: event.id };
}

// ── Drive ──────────────────────────────────────────────────────────────────

async function driveSearch(token, query, maxResults = 10) {
  const params = new URLSearchParams({
    q: `name contains '${query.replace(/'/g, "\\'")}' and trashed=false`,
    pageSize: String(maxResults),
    fields: "files(id,name,mimeType,webViewLink,modifiedTime)",
  });
  const result = await g(`${DRIVE}/files?${params}`, token);
  return result.files || [];
}

// ── Classroom ──────────────────────────────────────────────────────────────

async function classroomDueWork(token) {
  const courses = await g(`${CLASSROOM}/courses?courseStates=ACTIVE`, token);
  const activeCourses = courses.courses || [];
  const all = [];

  for (const course of activeCourses) {
    try {
      const work = await g(`${CLASSROOM}/courses/${course.id}/courseWork`, token);
      for (const item of work.courseWork || []) {
        if (!item.dueDate) continue;
        const due = new Date(
          item.dueDate.year,
          item.dueDate.month - 1,
          item.dueDate.day,
          item.dueTime?.hours ?? 23,
          item.dueTime?.minutes ?? 59,
        );
        if (due > new Date()) {
          all.push({ course: course.name, title: item.title, due: due.toISOString() });
        }
      }
    } catch {
      // Course may not permit coursework listing for this user — skip it.
    }
  }

  return all.sort((a, b) => new Date(a.due) - new Date(b.due));
}

module.exports = {
  gmailList,
  gmailSearch,
  gmailGetThread,
  gmailSend,
  calendarList,
  calendarCreateEvent,
  createMeetLink,
  driveSearch,
  classroomDueWork,
};
