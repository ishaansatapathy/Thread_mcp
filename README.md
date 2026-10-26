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
npm install -g threadmcp
threadmcp login
```

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
      "args": ["-y", "threadmcp", "mcp"]
    }
  }
}
```

Run `threadmcp login` once first (outside Alan AI) so the token exists. Then ask Alan AI:

- *"What's urgent in my inbox?"*
- *"Schedule a call with Rahul tomorrow at 3pm"*
- *"Find the Q3 deck in my Drive"*
- *"What assignments are due this week?"*
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

threadmcp cal today                         # today's events
threadmcp cal week                          # this week's events
threadmcp cal create "<title>" <when>       # e.g. "Team sync" tomorrow 3pm — asks to confirm

threadmcp meet                              # create a Meet link

threadmcp drive find <query>                # search Drive by filename
threadmcp drive read <fileId>               # read a file's text content

threadmcp doc read <documentId>             # read a Google Doc
threadmcp doc create "<title>" <content>    # create a Doc — asks to confirm

threadmcp sheet read <spreadsheetId> [range]        # read cell values (default A1:Z100)
threadmcp sheet create "<title>" <row,of,values>    # create a Sheet — asks to confirm

threadmcp slides read <presentationId>              # read slide titles + text
threadmcp slides create "<title>" <bodyText>         # create a deck — asks to confirm

threadmcp forms read <formId>               # read form questions
threadmcp forms responses <formId>          # response count

threadmcp classroom                         # due assignments, active courses

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
| `gmail.send` | Send a drafted email (always asks to confirm) |
| `calendar` | Read and create events / Meet links |
| `drive.readonly` | Search and surface files by name |
| `classroom.courses.readonly` | List active courses |
| `classroom.coursework.me.readonly` | List due assignments |

---

## License

MIT
