![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)
![tag:hackathon](https://img.shields.io/badge/hackathon-5F43F1)

# threadmcp — Google Workspace CLI + MCP server

> Control Gmail, Calendar, Drive, Meet and Classroom from your terminal — and from Alan AI.

Built for the **Alan AI OpenFire Hackathon 2026**. Self-contained: signs in with your own Google account via OAuth, stores a token locally, and talks directly to Google's APIs. No backend to deploy, no database, zero npm dependencies.

---

## Demo

```bash
$ threadmcp login
Opening your browser for Google sign-in...
✓ Signed in. Token saved to ~/.gwork.json

$ threadmcp brief
── Daily Brief ──
2 meeting(s) today · 3 unread email(s) · 1 assignment(s) due

Today:
10:00 AM — Team standup
03:00 PM — Investor call

Unread:
  Rahul <rahul@...> — "Re: Q3 report"
  Priya <priya@...> — "Meeting tomorrow?"

$ threadmcp cal create "Team sync" tomorrow 3pm
── Create: Team sync ──
10/27/2026, 3:00:00 PM → 10/27/2026, 3:30:00 PM
Create this event? (y/n): y
✓ Created. https://calendar.google.com/event?eid=...

$ threadmcp meet
── Creating Meet Link ──
https://meet.google.com/abc-defg-hij
```

---

## Install

```bash
# from npm
npm install -g @ishaan_satapathy/threadmcp

# or run from source
git clone <repo-url>
cd google-workspace-mcp/cli
npm link
```

Then run:

```bash
threadmcp login
```

> **Token expiry:** New Google Cloud projects start in "Testing" mode where refresh tokens expire after 7 days. Re-run `threadmcp login` if your token stops working. For permanent access, publish the OAuth consent screen or add test users.

The first login asks for a Google OAuth Client ID/Secret (one-time) — create your own at [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials), type "Desktop app" or "Web application", and add this redirect URI:

```
http://localhost:9876/callback
```

Credentials and tokens are saved only to `~/.gwork.json` on your machine — never committed, never sent anywhere but Google.

---

## Alan AI Integration

Add to your Alan AI MCP config:

```json
{
  "mcpServers": {
    "google-workspace": {
      "command": "npx",
      "args": ["-y", "@ishaan_satapathy/threadmcp", "mcp"]
    }
  }
}
```

Or from source before npm publish:

```json
{
  "mcpServers": {
    "google-workspace": {
      "command": "node",
      "args": ["<path-to-repo>/cli/gwork.js", "mcp"]
    }
  }
}
```

Run `threadmcp login` once first (outside Alan AI) so the token exists. Then ask Alan AI:

- *"What's urgent in my inbox?"*
- *"Schedule a call with Rahul tomorrow at 3pm"* — auto-detects conflicts!
- *"When am I free for a 30-minute call today?"*
- *"Find the Q3 deck in my Drive"* — searches inside files, not just names
- *"Brief me on today"*

---

## CLI Reference

```bash
threadmcp login                             # sign in with Google
threadmcp logout                            # sign out

threadmcp mail inbox                        # recent emails
threadmcp mail search <query>               # Gmail search syntax
threadmcp mail read <threadId>              # read a thread
threadmcp mail send <to> <subject> <body>   # asks to confirm before sending
threadmcp mail markread <messageId>         # mark as read
threadmcp mail archive <messageId>          # archive (asks to confirm)
threadmcp mail trash <messageId>            # trash (asks to confirm)

threadmcp cal today                         # today's events
threadmcp cal week                          # this week's events
threadmcp cal create "<title>" <when>       # e.g. "Team sync" tomorrow 3pm — asks to confirm
threadmcp cal delete <eventId>              # delete event (asks to confirm)
threadmcp cal update <eventId> <field> <value>  # update title/time

threadmcp meet                              # create a Meet link

threadmcp drive find <query>                # search Drive by filename
threadmcp drive read <fileId>               # read a file's text content
threadmcp drive mkdir "<name>"              # create a folder
threadmcp drive share <fileId> <email> [role]  # share with someone

threadmcp doc read <documentId>             # read a Google Doc
threadmcp doc create "<title>" <content>    # create a Doc — asks to confirm

threadmcp sheet read <spreadsheetId> [range]        # read cell values (default A1:Z100)
threadmcp sheet create "<title>" <row,of,values>    # create a Sheet — asks to confirm

threadmcp slides read <presentationId>              # read slide titles + text
threadmcp slides create "<title>" <bodyText>         # create a deck — asks to confirm

threadmcp forms read <formId>               # read form questions
threadmcp forms responses <formId>          # response count

threadmcp classroom                         # due assignments, active courses

threadmcp tasks list                        # active tasks
threadmcp tasks create "<title>" [due]      # add a task — asks to confirm
threadmcp tasks done <taskId> <tasklistId>  # complete a task

threadmcp contact find <name>               # search contacts
threadmcp contact last <name>               # last email with a person

threadmcp brief                             # combined daily summary

threadmcp mcp                               # start MCP server over stdio (for Alan AI)
```

Every write action (send email, create event) prints what it's about to do and asks `(y/n)` before touching your account.

---

## Available MCP Tools

| Tool | What it does |
|---|---|
| `list_inbox` | Recent Gmail messages |
| `search_inbox` | Gmail search |
| `get_thread` | Read a full email thread |
| `list_calendar_events` | Upcoming events |
| `create_meet_link` | Generate a Meet link |
| `create_calendar_event` | Schedule a Calendar event (with Meet, by default) |
| `search_drive` | Search Google Drive by filename |
| `read_drive_file` | Read a Drive file's text content |
| `read_doc` | Read a Google Doc |
| `create_doc` | Create a Google Doc |
| `read_sheet` | Read cell values from a Sheet |
| `create_sheet` | Create a Google Sheet |
| `read_slides` | Read slide titles + text |
| `create_slides` | Create a Slides deck |
| `read_form` | Read a Form's questions |
| `get_form_responses` | Get a Form's response count |
| `list_classroom_due_work` | Due assignments |
| `get_daily_brief` | Combined calendar + inbox + classroom summary |
| `get_free_slots` | Find open time slots in your calendar (e.g. "when am I free today?") |
| `search_drive_content` | Deep-search inside file contents (Docs, PDFs, Sheets), not just filenames |
| `get_priority_inbox` | Smart inbox — ranks messages by urgency (unread, recency, keywords) |
| `mark_read` | Mark a message as read |
| `archive_email` | Archive a message (remove from Inbox) |
| `trash_email` | Move a message to Trash |
| `delete_event` | Delete a Calendar event |
| `update_event` | Update a Calendar event's title/time |
| `create_folder` | Create a Drive folder |
| `share_file` | Share a Drive file/folder with someone |
| `list_tasks` | List active Google Tasks |
| `create_task` | Add a Google Task |
| `complete_task` | Mark a Google Task as done |
| `find_contact` | Search Google Contacts by name |
| `last_interaction` | Find your most recent email exchange with someone |

---

## Architecture

```
Alan AI  ──stdio/MCP──┐
                       ├──→  threadmcp  ──→  Google APIs (Gmail, Calendar, Drive, Classroom)
Terminal ──direct──────┘            │
                              ~/.gwork.json
                         (OAuth token, local only)
```

No server, no database — `threadmcp` is a single Node.js process that holds your Google token and calls Google's REST APIs directly.

---

## Scopes requested

| Scope | Why |
|---|---|
| `gmail.readonly` | List and search inbox |
| `gmail.modify` | Mark read, archive, trash messages |
| `gmail.send` | Send a drafted email (always asks to confirm) |
| `calendar` | Read and create events / Meet links |
| `drive` | Search, read, create folders, share files |
| `documents` | Read and create Google Docs |
| `spreadsheets` | Read and create Google Sheets |
| `presentations` | Read and create Google Slides |
| `forms.body.readonly` | Read Form questions |
| `forms.responses.readonly` | Read Form response counts |
| `classroom.courses.readonly` | List active courses |
| `classroom.coursework.me.readonly` | List due assignments |
| `tasks` | Read and create Google Tasks |
| `contacts` | Search Google Contacts |

---

## License

MIT
