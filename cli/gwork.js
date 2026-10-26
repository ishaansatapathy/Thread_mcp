#!/usr/bin/env node
"use strict";

/**
 * threadmcp — Google Workspace CLI, driven by your own Google OAuth login.
 * Also runs as an MCP server over stdio for Alan AI: `threadmcp mcp`.
 */

const readline = require("readline");
const auth = require("./lib/auth");
const google = require("./lib/google");
const { parseWhen } = require("./lib/when");

function printHeader(text) {
  console.log(`\n\x1b[1m\x1b[35m── ${text} ──\x1b[0m`);
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (a) => {
      rl.close();
      resolve(a.trim());
    }),
  );
}

function printEvents(events) {
  if (!events.length) return console.log("No events.");
  for (const e of events) {
    const time = e.start?.includes?.("T")
      ? new Date(e.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : e.start;
    console.log(`${time} — ${e.summary}${e.meetLink ? `  (${e.meetLink})` : ""}`);
  }
}

const commands = {
  async login() {
    await auth.login();
  },

  async logout() {
    auth.logout();
  },

  async mcp() {
    require("./mcp-server").start();
  },

  async mail(args) {
    const token = await auth.getAccessToken();
    const sub = args[0];

    if (sub === "inbox" || !sub) {
      printHeader("Inbox");
      const items = await google.gmailList(token, { maxResults: 10 });
      if (!items.length) return console.log("Inbox is empty.");
      for (const m of items) {
        console.log(`${m.unread ? "\x1b[33m[UNREAD]\x1b[0m " : ""}${m.from} — "${m.subject}"\n  ${m.snippet}`);
      }
    } else if (sub === "search") {
      const query = args.slice(1).join(" ");
      if (!query) return console.error("Usage: threadmcp mail search <query>");
      printHeader(`Search: ${query}`);
      const items = await google.gmailSearch(token, query, 10);
      if (!items.length) return console.log("No results.");
      for (const m of items) console.log(`${m.from} — "${m.subject}"\n  ${m.snippet}`);
    } else if (sub === "read") {
      const threadId = args[1];
      if (!threadId) return console.error("Usage: threadmcp mail read <threadId>");
      printHeader("Thread");
      const msgs = await google.gmailGetThread(token, threadId);
      for (const m of msgs) console.log(`From: ${m.from}\nSubject: ${m.subject}\nDate: ${m.date}\n${m.snippet}\n`);
    } else if (sub === "send") {
      const [to, subject, ...rest] = args.slice(1);
      const body = rest.join(" ");
      if (!to || !subject) return console.error("Usage: threadmcp mail send <to> <subject> <body>");
      printHeader(`Send to ${to}`);
      console.log(`Subject: ${subject}\n${body}\n`);
      const confirm = await ask("Send this email? (y/n): ");
      if (confirm.toLowerCase() !== "y") return console.log("Cancelled.");
      await google.gmailSend(token, { to, subject, body });
      console.log("\x1b[32m✓ Sent.\x1b[0m");
    } else {
      console.error("Usage: threadmcp mail [inbox|search|read|send]");
    }
  },

  async cal(args) {
    const token = await auth.getAccessToken();
    const sub = args[0];

    if (sub === "today" || !sub) {
      printHeader("Today's Calendar");
      const now = new Date();
      const end = new Date(now);
      end.setHours(23, 59, 59);
      const events = await google.calendarList(token, {
        timeMin: now.toISOString(),
        timeMax: end.toISOString(),
        maxResults: 10,
      });
      printEvents(events);
    } else if (sub === "week") {
      printHeader("This Week");
      const now = new Date();
      const end = new Date(now.getTime() + 7 * 86_400_000);
      const events = await google.calendarList(token, {
        timeMin: now.toISOString(),
        timeMax: end.toISOString(),
        maxResults: 20,
      });
      printEvents(events);
    } else if (sub === "create") {
      const rest = args.slice(1).join(" ");
      const match = rest.match(/^"([^"]+)"\s+(.+)$/);
      if (!match) return console.error('Usage: threadmcp cal create "<title>" <when>   e.g. "Team sync" tomorrow 3pm');
      const [, title, whenText] = match;
      const start = parseWhen(whenText);
      const end = new Date(start.getTime() + 30 * 60 * 1000);
      printHeader(`Create: ${title}`);
      console.log(`${start.toLocaleString()} → ${end.toLocaleString()}`);
      const confirm = await ask("Create this event? (y/n): ");
      if (confirm.toLowerCase() !== "y") return console.log("Cancelled.");
      const event = await google.calendarCreateEvent(token, {
        summary: title,
        start: start.toISOString(),
        end: end.toISOString(),
      });
      console.log(`\x1b[32m✓ Created.\x1b[0m ${event.htmlLink || ""}`);
    } else {
      console.error("Usage: threadmcp cal [today|week|create]");
    }
  },

  async meet() {
    const token = await auth.getAccessToken();
    printHeader("Creating Meet Link");
    const { link } = await google.createMeetLink(token);
    console.log(link || "Could not create a Meet link.");
  },

  async drive(args) {
    const token = await auth.getAccessToken();
    const sub = args[0];
    if (sub === "find" || sub === "search") {
      const query = args.slice(1).join(" ");
      if (!query) return console.error("Usage: threadmcp drive find <query>");
      printHeader(`Drive: ${query}`);
      const files = await google.driveSearch(token, query, 10);
      if (!files.length) return console.log("No files found.");
      for (const f of files) console.log(`${f.name}\n  ${f.webViewLink}`);
    } else if (sub === "read") {
      const fileId = args[1];
      if (!fileId) return console.error("Usage: threadmcp drive read <fileId>");
      printHeader("Drive File");
      const file = await google.driveReadFile(token, fileId);
      console.log(`${file.name} (${file.mimeType})\n\n${file.content}`);
    } else {
      console.error("Usage: threadmcp drive [find <query>|read <fileId>]");
    }
  },

  async doc(args) {
    const token = await auth.getAccessToken();
    const sub = args[0];
    if (sub === "read") {
      const documentId = args[1];
      if (!documentId) return console.error("Usage: threadmcp doc read <documentId>");
      printHeader("Doc");
      const doc = await google.docsRead(token, documentId);
      console.log(`${doc.title}\n\n${doc.text}`);
    } else if (sub === "create") {
      const rest = args.slice(1).join(" ");
      const match = rest.match(/^"([^"]+)"\s*(.*)$/);
      if (!match) return console.error('Usage: threadmcp doc create "<title>" <content>');
      const [, title, content] = match;
      printHeader(`Create Doc: ${title}`);
      const confirm = await ask("Create this doc? (y/n): ");
      if (confirm.toLowerCase() !== "y") return console.log("Cancelled.");
      const doc = await google.docsCreate(token, { title, content });
      console.log(`\x1b[32m✓ Created.\x1b[0m ${doc.url}`);
    } else {
      console.error("Usage: threadmcp doc [read <documentId>|create \"<title>\" <content>]");
    }
  },

  async sheet(args) {
    const token = await auth.getAccessToken();
    const sub = args[0];
    if (sub === "read") {
      const spreadsheetId = args[1];
      const range = args[2];
      if (!spreadsheetId) return console.error("Usage: threadmcp sheet read <spreadsheetId> [range]");
      printHeader("Sheet");
      const rows = await google.sheetsRead(token, spreadsheetId, range);
      if (!rows.length) return console.log("No data.");
      for (const row of rows) console.log(row.join("\t"));
    } else if (sub === "create") {
      const rest = args.slice(1).join(" ");
      const match = rest.match(/^"([^"]+)"\s*(.*)$/);
      if (!match) return console.error('Usage: threadmcp sheet create "<title>" <row,of,values>');
      const [, title, rowText] = match;
      const rows = rowText ? [rowText.split(",").map((v) => v.trim())] : [];
      printHeader(`Create Sheet: ${title}`);
      const confirm = await ask("Create this sheet? (y/n): ");
      if (confirm.toLowerCase() !== "y") return console.log("Cancelled.");
      const sheet = await google.sheetsCreate(token, { title, rows });
      console.log(`\x1b[32m✓ Created.\x1b[0m ${sheet.url}`);
    } else {
      console.error('Usage: threadmcp sheet [read <spreadsheetId> [range]|create "<title>" <row,of,values>]');
    }
  },

  async classroom() {
    const token = await auth.getAccessToken();
    printHeader("Classroom — Due Work");
    const work = await google.classroomDueWork(token);
    if (!work.length) return console.log("Nothing due.");
    for (const w of work) console.log(`${w.title} (${w.course}) — due ${new Date(w.due).toLocaleString()}`);
  },

  async brief() {
    const token = await auth.getAccessToken();
    printHeader("Daily Brief");
    const now = new Date();
    const end = new Date(now.getTime() + 86_400_000);
    const [events, inbox, due] = await Promise.all([
      google.calendarList(token, { timeMin: now.toISOString(), timeMax: end.toISOString(), maxResults: 10 }),
      google.gmailList(token, { query: "is:unread", maxResults: 5 }),
      google.classroomDueWork(token).catch(() => []),
    ]);
    console.log(`${events.length} meeting(s) today · ${inbox.length} unread email(s) · ${due.length} assignment(s) due\n`);
    if (events.length) {
      console.log("Today:");
      printEvents(events);
    }
    if (inbox.length) {
      console.log("\nUnread:");
      for (const m of inbox) console.log(`  ${m.from} — "${m.subject}"`);
    }
    if (due.length) {
      console.log("\nDue soon:");
      for (const w of due.slice(0, 5)) console.log(`  ${w.title} (${w.course}) — ${new Date(w.due).toLocaleDateString()}`);
    }
  },

  help() {
    console.log(`
\x1b[1mthreadmcp\x1b[0m — Google Workspace CLI, powered by your own Google OAuth login

\x1b[36mAuth:\x1b[0m
  threadmcp login                          Sign in with Google (opens browser)
  threadmcp logout                         Sign out

\x1b[36mMail:\x1b[0m
  threadmcp mail inbox
  threadmcp mail search <query>
  threadmcp mail read <threadId>
  threadmcp mail send <to> <subject> <body>

\x1b[36mCalendar:\x1b[0m
  threadmcp cal today
  threadmcp cal week
  threadmcp cal create "<title>" <when>      e.g. "Team sync" tomorrow 3pm

\x1b[36mMeet:\x1b[0m
  threadmcp meet

\x1b[36mDrive:\x1b[0m
  threadmcp drive find <query>

\x1b[36mClassroom:\x1b[0m
  threadmcp classroom

\x1b[36mBrief:\x1b[0m
  threadmcp brief

\x1b[36mAlan AI:\x1b[0m
  threadmcp mcp                            Start MCP server over stdio

\x1b[2mConfig stored at ~/.gwork.json (never committed, lives only on your machine)\x1b[0m
`);
  },
};

async function main() {
  const [, , cmd, ...args] = process.argv;

  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    return commands.help();
  }

  if (!commands[cmd]) {
    console.error(`Unknown command: ${cmd}. Run \x1b[36mthreadmcp help\x1b[0m for usage.`);
    process.exit(1);
  }

  try {
    await commands[cmd](args);
  } catch (err) {
    console.error(`\x1b[31m✗ ${err.message}\x1b[0m`);
    process.exit(1);
  }
}

main();
