"use strict";

/**
 * Minimal MCP server over stdio — JSON-RPC 2.0, newline-delimited.
 * Reuses the same Google OAuth token saved by `threadmcp login`.
 * Point Alan AI's MCP config at: { "command": "npx", "args": ["-y", "threadmcp", "mcp"] }
 */

const readline = require("readline");
const auth = require("./lib/auth");
const google = require("./lib/google");

const TOOLS = [
  {
    name: "list_inbox",
    description: "List recent Gmail inbox messages.",
    inputSchema: {
      type: "object",
      properties: { maxResults: { type: "number" }, query: { type: "string" } },
    },
  },
  {
    name: "search_inbox",
    description: "Search Gmail using Gmail query syntax (e.g. 'from:alice is:unread').",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: { query: { type: "string" }, maxResults: { type: "number" } },
    },
  },
  {
    name: "get_thread",
    description: "Read a full Gmail thread by id.",
    inputSchema: { type: "object", required: ["threadId"], properties: { threadId: { type: "string" } } },
  },
  {
    name: "list_calendar_events",
    description: "List upcoming Google Calendar events.",
    inputSchema: {
      type: "object",
      properties: { rangeDays: { type: "number", description: "Days ahead to look (default 1)" } },
    },
  },
  {
    name: "create_meet_link",
    description: "Create a Google Meet link via a new 30-minute Calendar event.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "search_drive",
    description: "Search Google Drive files by name.",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: { query: { type: "string" }, maxResults: { type: "number" } },
    },
  },
  {
    name: "list_classroom_due_work",
    description: "List upcoming Google Classroom assignments across active courses.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_daily_brief",
    description: "A combined summary of today's calendar, unread inbox and classroom due work.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "read_drive_file",
    description: "Read the text content of a Drive file (Docs/Sheets/Slides are auto-exported as text).",
    inputSchema: { type: "object", required: ["fileId"], properties: { fileId: { type: "string" } } },
  },
  {
    name: "read_doc",
    description: "Read a Google Doc's full text content.",
    inputSchema: { type: "object", required: ["documentId"], properties: { documentId: { type: "string" } } },
  },
  {
    name: "create_doc",
    description: "Create a new Google Doc with the given title and text content.",
    inputSchema: {
      type: "object",
      required: ["title"],
      properties: { title: { type: "string" }, content: { type: "string" } },
    },
  },
  {
    name: "read_sheet",
    description: "Read a range of cell values from a Google Sheet (default A1:Z100).",
    inputSchema: {
      type: "object",
      required: ["spreadsheetId"],
      properties: { spreadsheetId: { type: "string" }, range: { type: "string" } },
    },
  },
  {
    name: "create_sheet",
    description: "Create a new Google Sheet with the given title and optional first row of values.",
    inputSchema: {
      type: "object",
      required: ["title"],
      properties: { title: { type: "string" }, rows: { type: "array", items: { type: "array" } } },
    },
  },
  {
    name: "read_slides",
    description: "Read a Google Slides presentation's title and per-slide text content.",
    inputSchema: {
      type: "object",
      required: ["presentationId"],
      properties: { presentationId: { type: "string" } },
    },
  },
  {
    name: "create_slides",
    description: "Create a new Google Slides presentation with an optional text box on the first slide.",
    inputSchema: {
      type: "object",
      required: ["title"],
      properties: { title: { type: "string" }, bodyText: { type: "string" } },
    },
  },
  {
    name: "read_form",
    description: "Read a Google Form's title and question list.",
    inputSchema: { type: "object", required: ["formId"], properties: { formId: { type: "string" } } },
  },
  {
    name: "get_form_responses",
    description: "Get the response count for a Google Form.",
    inputSchema: { type: "object", required: ["formId"], properties: { formId: { type: "string" } } },
  },
];

function textResult(text) {
  return { content: [{ type: "text", text: text || "(no results)" }] };
}

async function callTool(name, args = {}) {
  const token = await auth.getAccessToken();

  switch (name) {
    case "list_inbox": {
      const items = await google.gmailList(token, { query: args.query, maxResults: args.maxResults || 10 });
      return textResult(
        items.map((m) => `${m.unread ? "[UNREAD] " : ""}${m.from}: "${m.subject}" — ${m.snippet}`).join("\n"),
      );
    }
    case "search_inbox": {
      const items = await google.gmailSearch(token, args.query, args.maxResults || 10);
      return textResult(items.map((m) => `${m.from}: "${m.subject}" — ${m.snippet}`).join("\n"));
    }
    case "get_thread": {
      const msgs = await google.gmailGetThread(token, args.threadId);
      return textResult(msgs.map((m) => `From: ${m.from}\nSubject: ${m.subject}\nDate: ${m.date}\n${m.snippet}`).join("\n\n"));
    }
    case "list_calendar_events": {
      const now = new Date();
      const end = new Date(now.getTime() + (args.rangeDays || 1) * 86_400_000);
      const events = await google.calendarList(token, {
        timeMin: now.toISOString(),
        timeMax: end.toISOString(),
        maxResults: 20,
      });
      return textResult(
        events.map((e) => `${e.start} — ${e.summary}${e.meetLink ? ` (${e.meetLink})` : ""}`).join("\n"),
      );
    }
    case "create_meet_link": {
      const { link } = await google.createMeetLink(token);
      return textResult(link);
    }
    case "search_drive": {
      const files = await google.driveSearch(token, args.query, args.maxResults || 10);
      return textResult(files.map((f) => `${f.name} — ${f.webViewLink}`).join("\n"));
    }
    case "list_classroom_due_work": {
      const work = await google.classroomDueWork(token);
      return textResult(work.map((w) => `${w.course}: "${w.title}" due ${new Date(w.due).toLocaleString()}`).join("\n"));
    }
    case "get_daily_brief": {
      const now = new Date();
      const end = new Date(now.getTime() + 86_400_000);
      const [events, inbox, due] = await Promise.all([
        google.calendarList(token, { timeMin: now.toISOString(), timeMax: end.toISOString(), maxResults: 10 }),
        google.gmailList(token, { query: "is:unread", maxResults: 5 }),
        google.classroomDueWork(token).catch(() => []),
      ]);
      const lines = [`${events.length} meeting(s) today, ${inbox.length} unread email(s), ${due.length} assignment(s) due.`];
      if (events.length) lines.push("\nToday:\n" + events.map((e) => `  ${e.start} — ${e.summary}`).join("\n"));
      if (inbox.length) lines.push("\nUnread:\n" + inbox.map((m) => `  ${m.from}: "${m.subject}"`).join("\n"));
      if (due.length)
        lines.push(
          "\nDue soon:\n" +
            due.slice(0, 5).map((w) => `  ${w.title} (${w.course}) — ${new Date(w.due).toLocaleDateString()}`).join("\n"),
        );
      return textResult(lines.join("\n"));
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function start() {
  const rl = readline.createInterface({ input: process.stdin });

  rl.on("line", async (line) => {
    if (!line.trim()) return;

    let req;
    try {
      req = JSON.parse(line);
    } catch {
      return;
    }

    const respond = (result, error) => {
      const msg = { jsonrpc: "2.0", id: req.id ?? null };
      if (error) msg.error = { code: -32000, message: error.message || String(error) };
      else msg.result = result;
      process.stdout.write(JSON.stringify(msg) + "\n");
    };

    try {
      if (req.method === "initialize") {
        respond({
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "threadmcp", version: "1.0.0" },
        });
      } else if (req.method === "tools/list") {
        respond({ tools: TOOLS });
      } else if (req.method === "tools/call") {
        const { name, arguments: args } = req.params || {};
        respond(await callTool(name, args));
      } else if (req.method === "notifications/initialized") {
        // No response required for notifications.
      } else {
        respond(null, new Error(`Unknown method: ${req.method}`));
      }
    } catch (err) {
      respond(null, err);
    }
  });
}

module.exports = { start, callTool, TOOLS };
