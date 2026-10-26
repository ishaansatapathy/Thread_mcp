#!/usr/bin/env node
"use strict";

/**
 * threadmcp — Google Workspace CLI, driven by your own Google OAuth login.
 * Also runs as an MCP server over stdio for Alan AI: `threadmcp mcp`.
 */

const readline = require("readline");
const auth = require("./lib/auth");
const google = require("./lib/google");
const github = require("./lib/github");
const jira = require("./lib/jira");
const slack = require("./lib/slack");
const signoz = require("./lib/signoz");
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
      const items = await google.gmailList(token, { maxResults: 10, labels: "INBOX" });
      if (!items.length) return console.log("Inbox is empty.");
      for (const m of items) {
        console.log(
          `${m.unread ? "\x1b[33m[UNREAD]\x1b[0m " : ""}${m.from} — "${m.subject}"\n  ${m.snippet}\n  \x1b[2mthread: ${m.threadId}\x1b[0m`,
        );
      }
    } else if (sub === "search") {
      const query = args.slice(1).join(" ");
      if (!query) return console.error("Usage: threadmcp mail search <query>");
      printHeader(`Search: ${query}`);
      const items = await google.gmailSearch(token, query, 10);
      if (!items.length) return console.log("No results.");
      for (const m of items)
        console.log(`${m.from} — "${m.subject}"\n  ${m.snippet}\n  \x1b[2mthread: ${m.threadId}\x1b[0m`);
    } else if (sub === "read") {
      const threadId = args[1];
      if (!threadId) return console.error("Usage: threadmcp mail read <threadId>");
      printHeader("Thread");
      const msgs = await google.gmailGetThread(token, threadId);
      for (const m of msgs) console.log(`From: ${m.from}\nSubject: ${m.subject}\nDate: ${m.date}\n${m.body || m.snippet}\n`);
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
    } else if (sub === "markread") {
      const messageId = args[1];
      if (!messageId) return console.error("Usage: threadmcp mail markread <messageId>");
      await google.markRead(token, messageId);
      console.log("\x1b[32m✓ Marked as read.\x1b[0m");
    } else if (sub === "archive") {
      const messageId = args[1];
      if (!messageId) return console.error("Usage: threadmcp mail archive <messageId>");
      printHeader("Archive");
      const confirm = await ask("Archive this message? (y/n): ");
      if (confirm.toLowerCase() !== "y") return console.log("Cancelled.");
      await google.archiveEmail(token, messageId);
      console.log("\x1b[32m✓ Archived.\x1b[0m");
    } else if (sub === "trash") {
      const messageId = args[1];
      if (!messageId) return console.error("Usage: threadmcp mail trash <messageId>");
      printHeader("Trash");
      const confirm = await ask("Move this message to Trash? (y/n): ");
      if (confirm.toLowerCase() !== "y") return console.log("Cancelled.");
      await google.trashEmail(token, messageId);
      console.log("\x1b[32m✓ Moved to Trash.\x1b[0m");
    } else {
      console.error("Usage: threadmcp mail [inbox|search|read|send|markread|archive|trash]");
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
      const title = args[1];
      const whenText = args.slice(2).join(" ");
      if (!title || !whenText)
        return console.error('Usage: threadmcp cal create "<title>" <when>   e.g. "Team sync" tomorrow 3pm');
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
    } else if (sub === "delete") {
      const eventId = args[1];
      if (!eventId) return console.error("Usage: threadmcp cal delete <eventId>");
      printHeader("Delete Event");
      const confirm = await ask("Permanently delete this event? (y/n): ");
      if (confirm.toLowerCase() !== "y") return console.log("Cancelled.");
      await google.deleteEvent(token, eventId);
      console.log("\x1b[32m✓ Deleted.\x1b[0m");
    } else if (sub === "update") {
      const [eventId, field, ...rest] = args.slice(1);
      const value = rest.join(" ");
      if (!eventId || !field) return console.error("Usage: threadmcp cal update <eventId> <summary|start|end> <value>");
      const updates = {};
      if (field === "start" || field === "end") updates[field] = parseWhen(value).toISOString();
      else updates[field] = value;
      printHeader("Update Event");
      const confirm = await ask("Update this event? (y/n): ");
      if (confirm.toLowerCase() !== "y") return console.log("Cancelled.");
      const updated = await google.updateEvent(token, eventId, updates);
      console.log(`\x1b[32m✓ Updated.\x1b[0m ${updated.htmlLink || ""}`);
    } else {
      console.error("Usage: threadmcp cal [today|week|create|delete|update]");
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
      for (const f of files) console.log(`${f.name}\n  ${f.webViewLink}\n  \x1b[2mid: ${f.id}\x1b[0m`);
    } else if (sub === "read") {
      const fileId = args[1];
      if (!fileId) return console.error("Usage: threadmcp drive read <fileId>");
      printHeader("Drive File");
      const file = await google.driveReadFile(token, fileId);
      console.log(`${file.name} (${file.mimeType})\n\n${file.content}`);
    } else if (sub === "mkdir") {
      const name = args.slice(1).join(" ");
      if (!name) return console.error('Usage: threadmcp drive mkdir "<name>"');
      printHeader(`Create Folder: ${name}`);
      const confirm = await ask("Create this folder? (y/n): ");
      if (confirm.toLowerCase() !== "y") return console.log("Cancelled.");
      const folder = await google.createFolder(token, name);
      console.log(`\x1b[32m✓ Created.\x1b[0m https://drive.google.com/drive/folders/${folder.id}`);
    } else if (sub === "share") {
      const [fileId, email, role] = args.slice(1);
      if (!fileId || !email) return console.error("Usage: threadmcp drive share <fileId> <email> [role]");
      printHeader(`Share with ${email}`);
      const confirm = await ask(`Share as ${role || "reader"}? (y/n): `);
      if (confirm.toLowerCase() !== "y") return console.log("Cancelled.");
      await google.shareFile(token, fileId, email, role || "reader");
      console.log("\x1b[32m✓ Shared.\x1b[0m");
    } else {
      console.error("Usage: threadmcp drive [find <query>|read <fileId>|mkdir|share]");
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
      const title = args[1];
      const content = args.slice(2).join(" ");
      if (!title) return console.error('Usage: threadmcp doc create "<title>" <content>');
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
      const title = args[1];
      const rowText = args.slice(2).join(" ");
      if (!title) return console.error('Usage: threadmcp sheet create "<title>" <row,of,values>');
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

  async slides(args) {
    const token = await auth.getAccessToken();
    const sub = args[0];
    if (sub === "read") {
      const presentationId = args[1];
      if (!presentationId) return console.error("Usage: threadmcp slides read <presentationId>");
      printHeader("Slides");
      const deck = await google.slidesRead(token, presentationId);
      console.log(`${deck.title}\n\n${deck.slides.join("\n")}`);
    } else if (sub === "create") {
      const title = args[1];
      const bodyText = args.slice(2).join(" ");
      if (!title) return console.error('Usage: threadmcp slides create "<title>" <bodyText>');
      printHeader(`Create Slides: ${title}`);
      const confirm = await ask("Create this presentation? (y/n): ");
      if (confirm.toLowerCase() !== "y") return console.log("Cancelled.");
      const deck = await google.slidesCreate(token, { title, bodyText });
      console.log(`\x1b[32m✓ Created.\x1b[0m ${deck.url}`);
    } else {
      console.error('Usage: threadmcp slides [read <presentationId>|create "<title>" <bodyText>]');
    }
  },

  async forms(args) {
    const token = await auth.getAccessToken();
    const sub = args[0];
    if (sub === "read") {
      const formId = args[1];
      if (!formId) return console.error("Usage: threadmcp forms read <formId>");
      printHeader("Form");
      const form = await google.formsRead(token, formId);
      console.log(`${form.title}\n\n${form.questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}`);
    } else if (sub === "responses") {
      const formId = args[1];
      if (!formId) return console.error("Usage: threadmcp forms responses <formId>");
      printHeader("Form Responses");
      const responses = await google.formsResponses(token, formId);
      console.log(`${responses.length} response(s) received.`);
    } else {
      console.error("Usage: threadmcp forms [read <formId>|responses <formId>]");
    }
  },

  async classroom() {
    const token = await auth.getAccessToken();
    printHeader("Classroom — Due Work");
    const work = await google.classroomDueWork(token);
    if (!work.length) return console.log("Nothing due.");
    for (const w of work) console.log(`${w.title} (${w.course}) — due ${new Date(w.due).toLocaleString()}`);
  },

  async tasks(args) {
    const token = await auth.getAccessToken();
    const sub = args[0];
    if (sub === "list" || !sub) {
      printHeader("Tasks");
      const tasks = await google.listTasks(token, 20);
      if (!tasks.length) return console.log("No active tasks.");
      for (const t of tasks) {
        console.log(`  ${t.title}${t.due ? ` — due ${new Date(t.due).toLocaleDateString()}` : ""}`);
        if (t.notes) console.log(`    \x1b[2m${t.notes}\x1b[0m`);
        console.log(`    \x1b[2mid: ${t.id}  list: ${t.tasklistId}\x1b[0m`);
      }
    } else if (sub === "create") {
      const title = args[1];
      const dueText = args.slice(2).join(" ");
      if (!title) return console.error('Usage: threadmcp tasks create "<title>" [due]');
      const due = dueText ? (dueText.match(/^\d{4}-\d{2}-\d{2}/) ? dueText : parseWhen(dueText).toISOString()) : undefined;
      printHeader(`Create Task: ${title}`);
      const confirm = await ask("Create this task? (y/n): ");
      if (confirm.toLowerCase() !== "y") return console.log("Cancelled.");
      const task = await google.createTask(token, { title, due });
      console.log(`\x1b[32m✓ Created.\x1b[0m "${task.title}"${task.due ? ` due ${new Date(task.due).toLocaleString()}` : ""}`);
    } else if (sub === "done") {
      const [taskId, tasklistId] = args.slice(1);
      if (!taskId || !tasklistId) return console.error("Usage: threadmcp tasks done <taskId> <tasklistId>");
      printHeader("Complete Task");
      const confirm = await ask("Mark this task as completed? (y/n): ");
      if (confirm.toLowerCase() !== "y") return console.log("Cancelled.");
      await google.completeTask(token, taskId, tasklistId);
      console.log("\x1b[32m✓ Task completed.\x1b[0m");
    } else {
      console.error("Usage: threadmcp tasks [list|create|done]");
    }
  },

  async contact(args) {
    const token = await auth.getAccessToken();
    const sub = args[0];
    if (sub === "find") {
      const name = args.slice(1).join(" ");
      if (!name) return console.error("Usage: threadmcp contact find <name>");
      printHeader(`Contact: ${name}`);
      const contacts = await google.findContact(token, name);
      if (!contacts.length) return console.log(`No contacts matching "${name}".`);
      for (const c of contacts) console.log(`  ${c.name}: ${c.email || "(no email)"}`);
    } else if (sub === "last") {
      const name = args.slice(1).join(" ");
      if (!name) return console.error("Usage: threadmcp contact last <name>");
      printHeader(`Last Interaction: ${name}`);
      const interaction = await google.lastInteraction(token, name);
      if (!interaction) return console.log(`No recent emails with "${name}".`);
      console.log(`From: ${interaction.from}\nSubject: "${interaction.subject}"\n${interaction.snippet}\n\x1b[2mthread: ${interaction.threadId}\x1b[0m`);
    } else {
      console.error("Usage: threadmcp contact [find <name>|last <name>]");
    }
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

  async github(args) {
    if (args[0] === "login") {
      await auth.ensureGithubToken();
      return console.log("\x1b[32m✓ GitHub configured.\x1b[0m");
    }
    const token = await auth.ensureGithubToken();
    const sub = args[0];

    if (sub === "repos" || !sub) {
      printHeader("GitHub Repos");
      const repos = await github.listRepos(token, 20);
      if (!repos.length) return console.log("No repositories.");
      for (const r of repos) console.log(`${r.fullName}${r.private ? " [private]" : ""}\n  ${r.description || "(no description)"}\n  ${r.url}`);
    } else if (sub === "issues") {
      const [owner, repo] = args.slice(1);
      if (!owner || !repo) return console.error("Usage: threadmcp github issues <owner> <repo>");
      printHeader(`Issues: ${owner}/${repo}`);
      const issues = await github.listIssues(token, owner, repo);
      if (!issues.length) return console.log("No open issues.");
      for (const i of issues) console.log(`#${i.number} [${i.state}] ${i.title} — by ${i.author}\n  ${i.url}`);
    } else if (sub === "issue") {
      const action = args[1];
      if (action !== "create") return console.error('Usage: threadmcp github issue create <owner> <repo> "<title>" <body>');
      const rest = args.slice(2).join(" ");
      const match = rest.match(/^(\S+)\s+(\S+)\s+"([^"]+)"(?:\s+(.*))?$/);
      if (!match) return console.error('Usage: threadmcp github issue create <owner> <repo> "<title>" <body>');
      const [, owner, repo, title, body] = match;
      printHeader(`Create Issue: ${owner}/${repo}`);
      console.log(`${title}\n${body || ""}`);
      const confirm = await ask("Create this issue? (y/n): ");
      if (confirm.toLowerCase() !== "y") return console.log("Cancelled.");
      const issue = await github.createIssue(token, owner, repo, { title, body });
      console.log(`\x1b[32m✓ Created.\x1b[0m #${issue.number} — ${issue.url}`);
    } else if (sub === "prs") {
      const [owner, repo] = args.slice(1);
      if (!owner || !repo) return console.error("Usage: threadmcp github prs <owner> <repo>");
      printHeader(`Pull Requests: ${owner}/${repo}`);
      const prs = await github.listPullRequests(token, owner, repo);
      if (!prs.length) return console.log("No open PRs.");
      for (const p of prs) console.log(`#${p.number} ${p.title} — by ${p.author}\n  ${p.headBranch} → ${p.baseBranch}\n  ${p.url}`);
    } else if (sub === "comment") {
      const [owner, repo, prNum, ...bodyParts] = args.slice(1);
      const body = bodyParts.join(" ");
      if (!owner || !repo || !prNum || !body) return console.error("Usage: threadmcp github comment <owner> <repo> <prNumber> <body>");
      printHeader(`Comment on ${owner}/${repo}#${prNum}`);
      console.log(body);
      const confirm = await ask("Post this comment? (y/n): ");
      if (confirm.toLowerCase() !== "y") return console.log("Cancelled.");
      const comment = await github.commentOnPR(token, owner, repo, parseInt(prNum), body);
      console.log(`\x1b[32m✓ Commented.\x1b[0m ${comment.url}`);
    } else if (sub === "search") {
      const query = args.slice(1).join(" ");
      if (!query) return console.error("Usage: threadmcp github search <query>");
      printHeader(`Code Search: ${query}`);
      const results = await github.searchCode(token, query);
      if (!results.length) return console.log("No results.");
      for (const r of results) console.log(`${r.repo}: ${r.path}\n  ${r.url}`);
    } else {
      console.error("Usage: threadmcp github [repos|issues|issue create|prs|comment|search]");
    }
  },

  async jira(args) {
    if (args[0] === "login") {
      await auth.ensureJiraCreds();
      return console.log("\x1b[32m✓ Jira configured.\x1b[0m");
    }
    const creds = await auth.ensureJiraCreds();
    const sub = args[0];

    if (sub === "issues" || !sub) {
      const jql = args.slice(1).join(" ") || undefined;
      printHeader("Jira Issues");
      const issues = await jira.listIssues(creds, jql);
      if (!issues.length) return console.log("No issues found.");
      for (const i of issues) console.log(`[${i.priority}] ${i.key}: ${i.summary} (${i.status})\n  ${i.url}`);
    } else if (sub === "issue") {
      const issueKey = args[1];
      if (!issueKey) return console.error("Usage: threadmcp jira issue <ISSUE-KEY>");
      printHeader(`Jira: ${issueKey}`);
      const issue = await jira.getIssue(creds, issueKey);
      console.log(`${issue.key}: ${issue.summary}\nStatus: ${issue.status} | Priority: ${issue.priority} | Assignee: ${issue.assignee}`);
    } else if (sub === "create") {
      const rest = args.slice(1).join(" ");
      const match = rest.match(/^"([^"]+)"\s+"([^"]+)"(?:\s+(.*))?$/);
      if (!match) return console.error('Usage: threadmcp jira create "<projectKey>" "<summary>" <description>');
      const [, projectKey, summary, description] = match;
      printHeader(`Create Jira Issue: ${projectKey}`);
      console.log(`${summary}\n${description || ""}`);
      const confirm = await ask("Create this issue? (y/n): ");
      if (confirm.toLowerCase() !== "y") return console.log("Cancelled.");
      const issue = await jira.createIssue(creds, { projectKey, summary, description });
      console.log(`\x1b[32m✓ Created.\x1b[0m ${issue.key} — ${issue.url}`);
    } else if (sub === "transition") {
      const [issueKey, ...restArr] = args.slice(1);
      const transitionName = restArr.join(" ");
      if (!issueKey || !transitionName) return console.error("Usage: threadmcp jira transition <ISSUE-KEY> <transitionName>");
      printHeader(`Transition: ${issueKey}`);
      const confirm = await ask(`Transition to "${transitionName}"? (y/n): `);
      if (confirm.toLowerCase() !== "y") return console.log("Cancelled.");
      const result = await jira.transitionIssue(creds, issueKey, transitionName);
      console.log(`\x1b[32m✓ ${result.issueKey} → ${result.transition} (now: ${result.to})\x1b[0m`);
    } else {
      console.error("Usage: threadmcp jira [issues|issue|create|transition]");
    }
  },

  async slack(args) {
    if (args[0] === "login") {
      await auth.ensureSlackToken();
      return console.log("\x1b[32m✓ Slack configured.\x1b[0m");
    }
    const token = await auth.ensureSlackToken();
    const sub = args[0];

    if (sub === "send") {
      const [channel, ...textParts] = args.slice(1);
      const text = textParts.join(" ");
      if (!channel || !text) return console.error("Usage: threadmcp slack send <channel> <text>");
      printHeader(`Send to ${channel}`);
      console.log(text);
      const confirm = await ask("Send this message? (y/n): ");
      if (confirm.toLowerCase() !== "y") return console.log("Cancelled.");
      const msg = await slack.sendMessage(token, channel, text);
      console.log(`\x1b[32m✓ Sent.\x1b[0m (ts: ${msg.ts})`);
    } else if (sub === "channels") {
      printHeader("Slack Channels");
      const channels = await slack.listChannels(token);
      if (!channels.length) return console.log("No channels.");
      for (const c of channels) console.log(`#${c.name} (${c.isPrivate ? "private" : "public"}, ${c.numMembers} members) — ${c.id}`);
    } else if (sub === "history") {
      const channel = args[1];
      if (!channel) return console.error("Usage: threadmcp slack history <channel>");
      printHeader(`Channel: ${channel}`);
      const msgs = await slack.getChannelHistory(token, channel);
      if (!msgs.length) return console.log("No messages.");
      for (const m of msgs) console.log(`${m.user}: ${m.text.slice(0, 300)}`);
    } else if (sub === "search") {
      const query = args.slice(1).join(" ");
      if (!query) return console.error("Usage: threadmcp slack search <query>");
      printHeader(`Search: ${query}`);
      const msgs = await slack.searchMessages(token, query);
      if (!msgs.length) return console.log("No results.");
      for (const m of msgs) console.log(`[#${m.channel}] ${m.user}: ${m.text.slice(0, 300)}\n  ${m.permalink}`);
    } else {
      console.error("Usage: threadmcp slack [send|channels|history|search]");
    }
  },

  async signoz(args) {
    if (args[0] === "login") {
      await auth.ensureSignozCreds();
      return console.log("\x1b[32m✓ SigNoz configured.\x1b[0m");
    }
    const creds = await auth.ensureSignozCreds();
    const sub = args[0];

    if (sub === "health" || !sub) {
      const serviceName = args[1];
      if (!serviceName) return console.error("Usage: threadmcp signoz health <serviceName> [windowMinutes]");
      const windowMinutes = parseInt(args[2]) || 60;
      printHeader(`Service Health: ${serviceName}`);
      const health = await signoz.getServiceHealth(creds, serviceName, windowMinutes);
      console.log(`Window: ${health.windowMinutes}min`);
      console.log(`Total spans: ${health.totalSpans}`);
      console.log(`Errors: ${health.errorCount} (${health.errorRatePct}%)`);
      console.log(`Avg duration: ${health.avgDurationMs != null ? `${health.avgDurationMs}ms` : "N/A"}`);
      console.log(`p50 duration: ${health.p50DurationMs != null ? `${health.p50DurationMs}ms` : "N/A"}`);
    } else if (sub === "traces") {
      const serviceName = args[1];
      if (!serviceName) return console.error("Usage: threadmcp signoz traces <serviceName> [--errors]");
      const hasError = args.includes("--errors");
      printHeader(`Traces: ${serviceName}${hasError ? " (errors)" : ""}`);
      const traces = await signoz.queryTraces(creds, { serviceName, hasError, limit: 20 });
      if (!traces.length) return console.log("No traces in window.");
      for (const t of traces) console.log(`${t.hasError ? "[ERROR] " : ""}${t.name} — ${t.durationMs != null ? `${t.durationMs}ms` : "?"} (trace: ${t.traceId})`);
    } else if (sub === "alerts") {
      printHeader("SigNoz Alert Rules");
      const rules = await signoz.listAlertRules(creds);
      const arr = Array.isArray(rules) ? rules : [];
      if (!arr.length) return console.log("No alert rules.");
      for (const r of arr) {
        const name = r.alertName ?? r.alert ?? r.name ?? "Untitled";
        const id = r.id ?? r.uuid ?? "";
        console.log(`${name}${id ? ` (id: ${id})` : ""}`);
      }
    } else if (sub === "channels") {
      printHeader("SigNoz Notification Channels");
      const channels = await signoz.listNotificationChannels(creds);
      if (!channels.length) return console.log("No channels.");
      for (const c of channels) console.log(`${c.name} [${c.type}] (id: ${c.id})`);
    } else {
      console.error("Usage: threadmcp signoz [health|traces|alerts|channels]");
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
  threadmcp mail markread <messageId>
  threadmcp mail archive <messageId>
  threadmcp mail trash <messageId>

\x1b[36mCalendar:\x1b[0m
  threadmcp cal today
  threadmcp cal week
  threadmcp cal create "<title>" <when>      e.g. "Team sync" tomorrow 3pm
  threadmcp cal delete <eventId>
  threadmcp cal update <eventId> <summary|start|end> <value>

\x1b[36mMeet:\x1b[0m
  threadmcp meet

\x1b[36mDrive:\x1b[0m
  threadmcp drive find <query>
  threadmcp drive read <fileId>
  threadmcp drive mkdir "<name>"
  threadmcp drive share <fileId> <email> [role]

\x1b[36mDocs:\x1b[0m
  threadmcp doc read <documentId>
  threadmcp doc create "<title>" <content>

\x1b[36mSheets:\x1b[0m
  threadmcp sheet read <spreadsheetId> [range]
  threadmcp sheet create "<title>" <row,of,values>

\x1b[36mSlides:\x1b[0m
  threadmcp slides read <presentationId>
  threadmcp slides create "<title>" <bodyText>

\x1b[36mForms:\x1b[0m
  threadmcp forms read <formId>
  threadmcp forms responses <formId>

\x1b[36mClassroom:\x1b[0m
  threadmcp classroom

\x1b[36mTasks:\x1b[0m
  threadmcp tasks list
  threadmcp tasks create "<title>" [due]
  threadmcp tasks done <taskId> <tasklistId>

\x1b[36mContacts:\x1b[0m
  threadmcp contact find <name>
  threadmcp contact last <name>

\x1b[36mBrief:\x1b[0m
  threadmcp brief

\x1b[36mGitHub:\x1b[0m
  threadmcp github repos
  threadmcp github issues <owner> <repo>
  threadmcp github issue create <owner> <repo> "<title>" <body>
  threadmcp github prs <owner> <repo>
  threadmcp github comment <owner> <repo> <prNumber> <body>
  threadmcp github search <query>

\x1b[36mJira:\x1b[0m
  threadmcp jira issues [jql]
  threadmcp jira issue <ISSUE-KEY>
  threadmcp jira create "<projectKey>" "<summary>" <description>
  threadmcp jira transition <ISSUE-KEY> <transitionName>

\x1b[36mSlack:\x1b[0m
  threadmcp slack send <channel> <text>
  threadmcp slack channels
  threadmcp slack history <channel>
  threadmcp slack search <query>

\x1b[36mSigNoz:\x1b[0m
  threadmcp signoz health <serviceName> [windowMinutes]
  threadmcp signoz traces <serviceName> [--errors]
  threadmcp signoz alerts
  threadmcp signoz channels

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
