"use strict";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const CALENDAR = "https://www.googleapis.com/calendar/v3";
const DRIVE = "https://www.googleapis.com/drive/v3";
const CLASSROOM = "https://classroom.googleapis.com/v1";
const DOCS = "https://docs.googleapis.com/v1/documents";
const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
const SLIDES = "https://slides.googleapis.com/v1/presentations";
const FORMS = "https://forms.googleapis.com/v1/forms";

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

const DRIVE_EXPORT_MIME = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
};

async function driveReadFile(token, fileId) {
  const meta = await g(`${DRIVE}/files/${fileId}?fields=id,name,mimeType`, token);
  const exportMime = DRIVE_EXPORT_MIME[meta.mimeType];

  const url = exportMime
    ? `${DRIVE}/files/${fileId}/export?mimeType=${encodeURIComponent(exportMime)}`
    : `${DRIVE}/files/${fileId}?alt=media`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google API error (${res.status}): ${text.slice(0, 300)}`);
  }
  return { name: meta.name, mimeType: meta.mimeType, content: await res.text() };
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

// ── Docs ───────────────────────────────────────────────────────────────────

function extractDocText(doc) {
  const lines = [];
  for (const el of doc.body?.content || []) {
    if (!el.paragraph) continue;
    const text = (el.paragraph.elements || []).map((e) => e.textRun?.content || "").join("");
    if (text.trim()) lines.push(text.trimEnd());
  }
  return lines.join("\n");
}

async function docsRead(token, documentId) {
  const doc = await g(`${DOCS}/${documentId}`, token);
  return { title: doc.title, text: extractDocText(doc) };
}

async function docsCreate(token, { title, content }) {
  const doc = await g(DOCS, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (content) {
    await g(`${DOCS}/${doc.documentId}:batchUpdate`, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requests: [{ insertText: { location: { index: 1 }, text: content } }] }),
    });
  }
  return { documentId: doc.documentId, url: `https://docs.google.com/document/d/${doc.documentId}/edit` };
}

// ── Sheets ─────────────────────────────────────────────────────────────────

async function sheetsRead(token, spreadsheetId, range = "A1:Z100") {
  const result = await g(`${SHEETS}/${spreadsheetId}/values/${encodeURIComponent(range)}`, token);
  return result.values || [];
}

async function sheetsCreate(token, { title, rows }) {
  const sheet = await g(SHEETS, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ properties: { title } }),
  });
  if (rows && rows.length) {
    await g(`${SHEETS}/${sheet.spreadsheetId}/values/A1:append?valueInputOption=RAW`, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values: rows }),
    });
  }
  return {
    spreadsheetId: sheet.spreadsheetId,
    url: `https://docs.google.com/spreadsheets/d/${sheet.spreadsheetId}/edit`,
  };
}

// ── Slides ─────────────────────────────────────────────────────────────────

function extractSlidesText(presentation) {
  return (presentation.slides || []).map((slide, i) => {
    const texts = [];
    for (const el of slide.pageElements || []) {
      const textElements = el.shape?.text?.textElements || [];
      const t = textElements.map((te) => te.textRun?.content || "").join("");
      if (t.trim()) texts.push(t.trim());
    }
    return `Slide ${i + 1}: ${texts.join(" / ") || "(no text)"}`;
  });
}

async function slidesRead(token, presentationId) {
  const presentation = await g(`${SLIDES}/${presentationId}`, token);
  return { title: presentation.title, slides: extractSlidesText(presentation) };
}

async function slidesCreate(token, { title, bodyText }) {
  const presentation = await g(SLIDES, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });

  if (bodyText && presentation.slides?.[0]) {
    const slideId = presentation.slides[0].objectId;
    const boxId = "box_" + Math.random().toString(36).slice(2);
    await g(`${SLIDES}/${presentation.presentationId}:batchUpdate`, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [
          {
            createShape: {
              objectId: boxId,
              shapeType: "TEXT_BOX",
              elementProperties: {
                pageObjectId: slideId,
                size: { height: { magnitude: 3_000_000, unit: "EMU" }, width: { magnitude: 6_000_000, unit: "EMU" } },
                transform: { scaleX: 1, scaleY: 1, translateX: 1_000_000, translateY: 1_000_000, unit: "EMU" },
              },
            },
          },
          { insertText: { objectId: boxId, text: bodyText } },
        ],
      }),
    });
  }

  return {
    presentationId: presentation.presentationId,
    url: `https://docs.google.com/presentation/d/${presentation.presentationId}/edit`,
  };
}

// ── Forms ──────────────────────────────────────────────────────────────────

async function formsRead(token, formId) {
  const form = await g(`${FORMS}/${formId}`, token);
  const questions = (form.items || []).map((item) => item.title).filter(Boolean);
  return { title: form.info?.title, questions };
}

async function formsResponses(token, formId) {
  const result = await g(`${FORMS}/${formId}/responses`, token);
  return result.responses || [];
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
  driveReadFile,
  classroomDueWork,
  docsRead,
  docsCreate,
  sheetsRead,
  sheetsCreate,
  slidesRead,
  slidesCreate,
  formsRead,
  formsResponses,
};
