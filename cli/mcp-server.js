"use strict";

/**
 * Minimal MCP server over stdio — JSON-RPC 2.0, newline-delimited.
 * Reuses the same Google OAuth token saved by `threadmcp login`.
 * Point Alan AI's MCP config at:
 *   { "command": "npx", "args": ["-y", "@ishaan_satapathy/threadmcp", "mcp"] }
 * 50 tools: Gmail, Calendar, Drive, Docs, Sheets, Slides, Forms, Classroom, Tasks, Contacts,
 *   GitHub, Jira, Slack, SigNoz — smart inbox, conflict detection, free slots, analytics.
 */

const readline = require("readline");
const auth = require("./lib/auth");
const google = require("./lib/google");
const github = require("./lib/github");
const jira = require("./lib/jira");
const slack = require("./lib/slack");
const signoz = require("./lib/signoz");
const { parseWhen } = require("./lib/when");

const SUPPORTED_VERSIONS = ["2024-11-05", "2025-06-18"];

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
  {
    name: "create_calendar_event",
    description: "Schedule a Google Calendar event. Creates a Meet link by default — perfect for scheduling calls.",
    inputSchema: {
      type: "object",
      required: ["summary", "whenText"],
      properties: {
        summary: { type: "string", description: "Event title" },
        whenText: { type: "string", description: "When, e.g. 'tomorrow 3pm', 'in 2h', 'today 17:00'" },
        durationMinutes: { type: "number", description: "Duration in minutes (default 30)" },
        attendees: { type: "array", items: { type: "string" }, description: "Attendee email addresses" },
        withMeet: { type: "boolean", description: "Include Google Meet link (default true)" },
      },
    },
  },
  {
    name: "get_free_slots",
    description: "Find available time slots in your calendar for a given day (default today). Know when you're free to schedule.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Optional date (default today), e.g. '2026-10-27' or 'tomorrow'" },
        minSlotMin: { type: "number", description: "Minimum free slot in minutes (default 15)" },
      },
    },
  },
  {
    name: "search_drive_content",
    description: "Deep-search Google Drive — scans inside files (Docs, PDFs, Sheets) for your keywords, not just filenames.",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: { query: { type: "string" }, maxResults: { type: "number" } },
    },
  },
  {
    name: "get_priority_inbox",
    description: "Smart inbox — scores and ranks recent messages by urgency (unread, recency, keywords). Returns only what matters.",
    inputSchema: {
      type: "object",
      properties: { maxResults: { type: "number", description: "How many to return (default 10)" } },
    },
  },
  {
    name: "mark_read",
    description: "Mark a Gmail message as read by removing the UNREAD label.",
    inputSchema: { type: "object", required: ["messageId"], properties: { messageId: { type: "string" } } },
  },
  {
    name: "archive_email",
    description: "Archive a Gmail message by removing it from the INBOX label.",
    inputSchema: { type: "object", required: ["messageId"], properties: { messageId: { type: "string" } } },
  },
  {
    name: "trash_email",
    description: "Move a Gmail message to the Trash (soft-delete, recoverable for 30 days).",
    inputSchema: { type: "object", required: ["messageId"], properties: { messageId: { type: "string" } } },
  },
  {
    name: "delete_event",
    description: "Permanently delete a Google Calendar event by ID.",
    inputSchema: { type: "object", required: ["eventId"], properties: { eventId: { type: "string" } } },
  },
  {
    name: "update_event",
    description: "Update a Calendar event's summary, start time, or end time — pass only what changed.",
    inputSchema: {
      type: "object",
      required: ["eventId"],
      properties: {
        eventId: { type: "string" },
        summary: { type: "string" },
        start: { type: "string", description: "ISO datetime string" },
        end: { type: "string", description: "ISO datetime string" },
      },
    },
  },
  {
    name: "create_folder",
    description: "Create a new folder in Google Drive, optionally inside a parent folder.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: { name: { type: "string" }, parentId: { type: "string", description: "Optional parent folder ID" } },
    },
  },
  {
    name: "share_file",
    description: "Share a Drive file/folder with a specific person by email address.",
    inputSchema: {
      type: "object",
      required: ["fileId", "email"],
      properties: {
        fileId: { type: "string" },
        email: { type: "string" },
        role: { type: "string", description: "reader, writer, or commenter (default: reader)" },
      },
    },
  },
  {
    name: "list_tasks",
    description: "List active (uncompleted) tasks from your Google Tasks default list.",
    inputSchema: {
      type: "object",
      properties: { maxResults: { type: "number", description: "How many tasks to return (default 20)" } },
    },
  },
  {
    name: "create_task",
    description: "Add a new task to your Google Tasks default list.",
    inputSchema: {
      type: "object",
      required: ["title"],
      properties: {
        title: { type: "string" },
        notes: { type: "string" },
        due: { type: "string", description: "Due date/time (ISO string or natural like 'tomorrow 5pm')" },
      },
    },
  },
  {
    name: "complete_task",
    description: "Mark a Google Task as completed (done).",
    inputSchema: {
      type: "object",
      required: ["taskId", "tasklistId"],
      properties: { taskId: { type: "string" }, tasklistId: { type: "string" } },
    },
  },
  {
    name: "find_contact",
    description: "Search your Google Contacts by name. Returns matching names and email addresses.",
    inputSchema: { type: "object", required: ["name"], properties: { name: { type: "string" } } },
  },
  {
    name: "last_interaction",
    description: "Find the most recent email exchange with a specific person — useful for checking when you last heard from someone.",
    inputSchema: { type: "object", required: ["personName"], properties: { personName: { type: "string" } } },
  },
  // ── GitHub ──
  {
    name: "list_github_repos",
    description: "List your GitHub repositories (most recently updated first).",
    inputSchema: { type: "object", properties: { maxResults: { type: "number" } } },
  },
  {
    name: "list_github_issues",
    description: "List open issues for a GitHub repository (filters out pull requests).",
    inputSchema: {
      type: "object",
      required: ["owner", "repo"],
      properties: { owner: { type: "string" }, repo: { type: "string" }, state: { type: "string", description: "open, closed, or all" } },
    },
  },
  {
    name: "create_github_issue",
    description: "Create a new issue in a GitHub repository.",
    inputSchema: {
      type: "object",
      required: ["owner", "repo", "title"],
      properties: { owner: { type: "string" }, repo: { type: "string" }, title: { type: "string" }, body: { type: "string" } },
    },
  },
  {
    name: "list_github_pull_requests",
    description: "List pull requests for a GitHub repository.",
    inputSchema: {
      type: "object",
      required: ["owner", "repo"],
      properties: { owner: { type: "string" }, repo: { type: "string" }, state: { type: "string", description: "open, closed, or all" } },
    },
  },
  {
    name: "comment_on_pr",
    description: "Add a comment to a GitHub pull request.",
    inputSchema: {
      type: "object",
      required: ["owner", "repo", "prNumber", "body"],
      properties: { owner: { type: "string" }, repo: { type: "string" }, prNumber: { type: "number" }, body: { type: "string" } },
    },
  },
  {
    name: "search_github_code",
    description: "Search for code across GitHub repositories (file contents and paths).",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: { query: { type: "string" }, maxResults: { type: "number" } },
    },
  },
  // ── Jira ──
  {
    name: "list_jira_issues",
    description: "List Jira issues (defaults to your unresolved issues). Use jql for custom queries.",
    inputSchema: {
      type: "object",
      properties: { jql: { type: "string", description: "JQL query (default: assignee = currentUser() AND resolution = Unresolved)" } },
    },
  },
  {
    name: "get_jira_issue",
    description: "Get full details of a single Jira issue by key (e.g. PROJ-123).",
    inputSchema: { type: "object", required: ["issueKey"], properties: { issueKey: { type: "string" } } },
  },
  {
    name: "create_jira_issue",
    description: "Create a new Jira issue in a project.",
    inputSchema: {
      type: "object",
      required: ["projectKey", "summary"],
      properties: {
        projectKey: { type: "string", description: "Jira project key (e.g. PROJ)" },
        summary: { type: "string", description: "Issue title/summary" },
        description: { type: "string" },
        issueType: { type: "string", description: "e.g. Task, Bug, Story (default: Task)" },
      },
    },
  },
  {
    name: "transition_jira_issue",
    description: "Move a Jira issue to a different status (e.g. 'In Progress', 'Done'). Lists available transitions if name doesn't match.",
    inputSchema: {
      type: "object",
      required: ["issueKey", "transitionName"],
      properties: { issueKey: { type: "string" }, transitionName: { type: "string", description: "e.g. 'In Progress', 'Done', 'Close'" } },
    },
  },
  // ── Slack ──
  {
    name: "send_slack_message",
    description: "Send a message to a Slack channel (public or private). Requires a Bot token (xoxb-).",
    inputSchema: {
      type: "object",
      required: ["channel", "text"],
      properties: { channel: { type: "string", description: "Channel ID or #channel-name" }, text: { type: "string" } },
    },
  },
  {
    name: "list_slack_channels",
    description: "List public and private Slack channels the bot is a member of.",
    inputSchema: { type: "object", properties: { maxResults: { type: "number" } } },
  },
  {
    name: "get_slack_channel_history",
    description: "Get recent messages from a Slack channel.",
    inputSchema: {
      type: "object",
      required: ["channel"],
      properties: { channel: { type: "string" }, maxResults: { type: "number" } },
    },
  },
  {
    name: "search_slack_messages",
    description: "Search Slack messages across all channels. Requires a User token (xoxp-) with search:read scope.",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: { query: { type: "string" }, maxResults: { type: "number" } },
    },
  },
  // ── SigNoz ──
  {
    name: "get_signoz_service_health",
    description: "Get health metrics for a service from SigNoz — request rate, error rate, and p99 latency over a time window.",
    inputSchema: {
      type: "object",
      required: ["serviceName"],
      properties: { serviceName: { type: "string" }, windowMinutes: { type: "number", description: "Minutes to query (default: 60)" } },
    },
  },
  {
    name: "list_signoz_alert_rules",
    description: "List all alert rules configured in your SigNoz instance.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_signoz_dashboards",
    description: "List all dashboards in your SigNoz instance.",
    inputSchema: { type: "object", properties: {} },
  },
];

function textResult(text) {
  return { content: [{ type: "text", text: text || "(no results)" }] };
}

async function callTool(name, args = {}) {
  const token = await auth.getAccessToken();

  switch (name) {
    case "list_inbox": {
      const items = await google.gmailList(token, { query: args.query, maxResults: args.maxResults || 10, labels: "INBOX" });
      return textResult(
        items
          .map((m) => `${m.unread ? "[UNREAD] " : ""}${m.from}: "${m.subject}" — ${m.snippet} (threadId: ${m.threadId})`)
          .join("\n"),
      );
    }
    case "search_inbox": {
      const items = await google.gmailSearch(token, args.query, args.maxResults || 10);
      return textResult(
        items.map((m) => `${m.from}: "${m.subject}" — ${m.snippet} (threadId: ${m.threadId})`).join("\n"),
      );
    }
    case "get_thread": {
      const msgs = await google.gmailGetThread(token, args.threadId);
      return textResult(msgs.map((m) => `From: ${m.from}\nSubject: ${m.subject}\nDate: ${m.date}\n${m.body || m.snippet}`).join("\n\n"));
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
    case "create_calendar_event": {
      const start = parseWhen(args.whenText);
      const mins = args.durationMinutes || 30;
      const end = new Date(start.getTime() + mins * 60_000);
      const withMeet = args.withMeet !== false;

      // Conflict detection
      const conflicts = await google.checkConflicts(token, {
        start: start.toISOString(),
        end: end.toISOString(),
      });

      const event = await google.calendarCreateEvent(token, {
        summary: args.summary,
        start: start.toISOString(),
        end: end.toISOString(),
        attendees: args.attendees || [],
        withMeet,
      });

      let msg = event.htmlLink || `Event created. ID: ${event.id}`;
      if (conflicts.length) {
        const conflictList = conflicts.map((c) => `  ⚠  ${c.start} — ${c.summary}`).join("\n");
        msg = `⚠  CONFLICT DETECTED — these overlap:\n${conflictList}\n\nEvent still created:\n${msg}`;
      }
      return textResult(msg);
    }
    case "get_free_slots": {
      const date = args.date ? parseWhen(args.date).toISOString() : new Date().toISOString();
      const minSlotMin = args.minSlotMin || 15;
      const result = await google.getFreeSlots(token, date, { minSlotMin });
      const lines = [`${result.date} (${result.workingHours})`];
      if (!result.slots.length) lines.push("No free slots available.");
      else
        for (const s of result.slots)
          lines.push(`  ${new Date(s.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} → ${new Date(s.end).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} (${s.durationMin}min)`);
      return textResult(lines.join("\n"));
    }
    case "search_drive_content": {
      const files = await google.driveContentSearch(token, args.query, args.maxResults || 10);
      if (!files.length) return textResult("No files found (tried both filenames and content).");
      return textResult(
        files.map((f) => `${f.name} (${f.mimeType}${f.matchedBy === "content" ? ", matched in content" : ""}) — ${f.webViewLink}`).join("\n"),
      );
    }
    case "get_priority_inbox": {
      const items = await google.getPriorityInbox(token, args.maxResults || 10);
      if (!items.length) return textResult("Inbox is clear — nothing urgent.");
      return textResult(
        items.map(
          (m) =>
            `[${m.priority.label}] ${m.from}: "${m.subject}"${m.priority.reasons.length ? ` — ${m.priority.reasons.join(", ")}` : ""}`,
        ).join("\n"),
      );
    }
    case "search_drive": {
      const files = await google.driveSearch(token, args.query, args.maxResults || 10);
      return textResult(files.map((f) => `${f.name} (${f.mimeType}, id: ${f.id}) — ${f.webViewLink}`).join("\n"));
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
    case "read_drive_file": {
      const file = await google.driveReadFile(token, args.fileId);
      return textResult(`${file.name} (${file.mimeType})\n\n${file.content}`);
    }
    case "read_doc": {
      const doc = await google.docsRead(token, args.documentId);
      return textResult(`${doc.title}\n\n${doc.text}`);
    }
    case "create_doc": {
      const doc = await google.docsCreate(token, { title: args.title, content: args.content });
      return textResult(doc.url);
    }
    case "read_sheet": {
      const rows = await google.sheetsRead(token, args.spreadsheetId, args.range);
      return textResult(rows.map((r) => r.join("\t")).join("\n"));
    }
    case "create_sheet": {
      const sheet = await google.sheetsCreate(token, { title: args.title, rows: args.rows });
      return textResult(sheet.url);
    }
    case "read_slides": {
      const deck = await google.slidesRead(token, args.presentationId);
      return textResult(`${deck.title}\n\n${deck.slides.join("\n")}`);
    }
    case "create_slides": {
      const deck = await google.slidesCreate(token, { title: args.title, bodyText: args.bodyText });
      return textResult(deck.url);
    }
    case "read_form": {
      const form = await google.formsRead(token, args.formId);
      return textResult(`${form.title}\n\n${form.questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}`);
    }
    case "get_form_responses": {
      const responses = await google.formsResponses(token, args.formId);
      return textResult(`${responses.length} response(s) received.`);
    }
    case "mark_read": {
      await google.markRead(token, args.messageId);
      return textResult("Marked as read.");
    }
    case "archive_email": {
      await google.archiveEmail(token, args.messageId);
      return textResult("Archived.");
    }
    case "trash_email": {
      await google.trashEmail(token, args.messageId);
      return textResult("Moved to Trash.");
    }
    case "delete_event": {
      await google.deleteEvent(token, args.eventId);
      return textResult("Event deleted.");
    }
    case "update_event": {
      const updated = await google.updateEvent(token, args.eventId, {
        summary: args.summary,
        start: args.start,
        end: args.end,
      });
      return textResult(updated.htmlLink || "Event updated.");
    }
    case "create_folder": {
      const folder = await google.createFolder(token, args.name, args.parentId);
      return textResult(`Folder created. ID: ${folder.id} — https://drive.google.com/drive/folders/${folder.id}`);
    }
    case "share_file": {
      await google.shareFile(token, args.fileId, args.email, args.role || "reader");
      return textResult(`Shared with ${args.email} (${args.role || "reader"}).`);
    }
    case "list_tasks": {
      const tasks = await google.listTasks(token, args.maxResults || 20);
      if (!tasks.length) return textResult("No active tasks.");
      return textResult(
        tasks.map((t) => `${t.title}${t.due ? ` — due ${new Date(t.due).toLocaleDateString()}` : ""} (taskId: ${t.id}, list: ${t.tasklistId})`).join("\n"),
      );
    }
    case "create_task": {
      const due = args.due ? (args.due.match(/^\d{4}-\d{2}-\d{2}/) ? args.due : parseWhen(args.due).toISOString()) : undefined;
      const task = await google.createTask(token, { title: args.title, notes: args.notes, due });
      return textResult(`Task created: "${task.title}"${task.due ? ` due ${new Date(task.due).toLocaleString()}` : ""} (id: ${task.id})`);
    }
    case "complete_task": {
      await google.completeTask(token, args.taskId, args.tasklistId);
      return textResult("Task marked as completed.");
    }
    case "find_contact": {
      const contacts = await google.findContact(token, args.name);
      if (!contacts.length) return textResult(`No contacts matching "${args.name}".`);
      return textResult(contacts.map((c) => `${c.name}: ${c.email || "(no email)"}`).join("\n"));
    }
    case "last_interaction": {
      const interaction = await google.lastInteraction(token, args.personName);
      if (!interaction) return textResult(`No recent emails with "${args.personName}".`);
      return textResult(`Last interaction with ${interaction.from}:\nSubject: "${interaction.subject}"\n${interaction.snippet}\n(threadId: ${interaction.threadId})`);
    }
    // ── GitHub ──
    case "list_github_repos": {
      const ghToken = await auth.ensureGithubCreds();
      const repos = await github.listRepos(ghToken, args.maxResults || 20);
      if (!repos.length) return textResult("No repositories found.");
      return textResult(repos.map((r) => `${r.fullName}${r.private ? " [private]" : ""} — ${r.description || "(no description)"}\n  ${r.url}`).join("\n"));
    }
    case "list_github_issues": {
      const ghToken = await auth.ensureGithubCreds();
      const issues = await github.listIssues(ghToken, args.owner, args.repo, args.state || "open");
      if (!issues.length) return textResult(`No ${args.state || "open"} issues in ${args.owner}/${args.repo}.`);
      return textResult(issues.map((i) => `#${i.number} [${i.state}] ${i.title} — by ${i.author}\n  ${i.url}`).join("\n"));
    }
    case "create_github_issue": {
      const ghToken = await auth.ensureGithubCreds();
      const issue = await github.createIssue(ghToken, args.owner, args.repo, { title: args.title, body: args.body });
      return textResult(`Issue created: #${issue.number} — ${issue.title}\n${issue.url}`);
    }
    case "list_github_pull_requests": {
      const ghToken = await auth.ensureGithubCreds();
      const prs = await github.listPullRequests(ghToken, args.owner, args.repo, args.state || "open");
      if (!prs.length) return textResult(`No ${args.state || "open"} PRs in ${args.owner}/${args.repo}.`);
      return textResult(prs.map((p) => `#${p.number} ${p.title} — by ${p.author}\n  ${p.headBranch} → ${p.baseBranch}\n  ${p.url}`).join("\n"));
    }
    case "comment_on_pr": {
      const ghToken = await auth.ensureGithubCreds();
      const comment = await github.commentOnPR(ghToken, args.owner, args.repo, args.prNumber, args.body);
      return textResult(`Comment added to ${args.owner}/${args.repo}#${args.prNumber}\n${comment.url}`);
    }
    case "search_github_code": {
      const ghToken = await auth.ensureGithubCreds();
      const results = await github.searchCode(ghToken, args.query, args.maxResults || 10);
      if (!results.length) return textResult(`No code matching "${args.query}".`);
      return textResult(results.map((r) => `${r.repo}: ${r.path}\n  ${r.url}`).join("\n"));
    }
    // ── Jira ──
    case "list_jira_issues": {
      const jiraCreds = await auth.ensureJiraCreds();
      const issues = await jira.listIssues(jiraCreds, args.jql);
      if (!issues.length) return textResult("No issues found.");
      return textResult(issues.map((i) => `[${i.priority}] ${i.key}: ${i.summary} (${i.status})\n  ${i.url}`).join("\n"));
    }
    case "get_jira_issue": {
      const jiraCreds = await auth.ensureJiraCreds();
      const issue = await jira.getIssue(jiraCreds, args.issueKey);
      return textResult(`${issue.key}: ${issue.summary}\nStatus: ${issue.status} | Priority: ${issue.priority} | Assignee: ${issue.assignee}`);
    }
    case "create_jira_issue": {
      const jiraCreds = await auth.ensureJiraCreds();
      const issue = await jira.createIssue(jiraCreds, {
        projectKey: args.projectKey, summary: args.summary, description: args.description, issueType: args.issueType || "Task",
      });
      return textResult(`Issue created: ${issue.key}\n${issue.url}`);
    }
    case "transition_jira_issue": {
      const jiraCreds = await auth.ensureJiraCreds();
      const result = await jira.transitionIssue(jiraCreds, args.issueKey, args.transitionName);
      return textResult(`${result.issueKey} → ${result.transition} (now: ${result.to})`);
    }
    // ── Slack ──
    case "send_slack_message": {
      const sToken = await auth.ensureSlackCreds();
      const msg = await slack.sendMessage(sToken, args.channel, args.text);
      return textResult(`Message sent to ${msg.channel} (ts: ${msg.ts})`);
    }
    case "list_slack_channels": {
      const sToken = await auth.ensureSlackCreds();
      const channels = await slack.listChannels(sToken, args.maxResults || 50);
      if (!channels.length) return textResult("No channels found.");
      return textResult(channels.map((c) => `#${c.name} (${c.isPrivate ? "private" : "public"}, ${c.numMembers} members) — id: ${c.id}`).join("\n"));
    }
    case "get_slack_channel_history": {
      const sToken = await auth.ensureSlackCreds();
      const msgs = await slack.getChannelHistory(sToken, args.channel, args.maxResults || 20);
      if (!msgs.length) return textResult("No messages in this channel.");
      return textResult(msgs.map((m) => `${m.user}: ${m.text.slice(0, 200)}`).join("\n"));
    }
    case "search_slack_messages": {
      const sToken = await auth.ensureSlackCreds();
      const msgs = await slack.searchMessages(sToken, args.query, args.maxResults || 20);
      if (!msgs.length) return textResult(`No messages matching "${args.query}".`);
      return textResult(msgs.map((m) => `[#${m.channel}] ${m.user}: ${m.text.slice(0, 300)}\n  ${m.permalink}`).join("\n"));
    }
    // ── SigNoz ──
    case "get_signoz_service_health": {
      const sCreds = await auth.ensureSignozCreds();
      const health = await signoz.getServiceHealth(sCreds, args.serviceName, args.windowMinutes || 60);
      return textResult(`${health.service} (last ${health.windowMinutes}min):\n  Requests: ${health.requestRate}\n  Errors (≥500): ${health.errorRate}\n  p99 latency: ${health.p99LatencyMs != null ? `${health.p99LatencyMs}ms` : "N/A"}`);
    }
    case "list_signoz_alert_rules": {
      const sCreds = await auth.ensureSignozCreds();
      const rules = await signoz.listAlertRules(sCreds);
      if (!rules.length) return textResult("No alert rules configured.");
      return textResult(rules.map((r) => `${r.name} [${r.state}] (id: ${r.id})`).join("\n"));
    }
    case "list_signoz_dashboards": {
      const sCreds = await auth.ensureSignozCreds();
      const boards = await signoz.listDashboards(sCreds);
      if (!boards.length) return textResult("No dashboards.");
      return textResult(boards.map((d) => `${d.title}${d.description ? ` — ${d.description}` : ""} (id: ${d.id})`).join("\n"));
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
        const clientVer = req.params?.protocolVersion || "2024-11-05";
        const version = SUPPORTED_VERSIONS.includes(clientVer) ? clientVer : "2024-11-05";
        respond({
          protocolVersion: version,
          capabilities: { tools: {} },
          serverInfo: { name: "threadmcp", version: require("./package.json").version },
        });
      } else if (req.method === "tools/list") {
        respond({ tools: TOOLS });
      } else if (req.method === "tools/call") {
        const { name, arguments: args } = req.params || {};
        respond(await callTool(name, args));
      } else if (req.method === "ping") {
        respond({});
      } else if (req.method === "notifications/initialized") {
        // No response required for notifications.
      } else {
        respond(null, new Error(`Unknown method: ${req.method}`));
      }
    } catch (err) {
      if (req.method === "tools/call") {
        respond({ content: [{ type: "text", text: err.message || String(err) }], isError: true });
      } else {
        respond(null, err);
      }
    }
  });
}

module.exports = { start, callTool, TOOLS };
