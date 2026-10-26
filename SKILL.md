# Google Workspace for Alan AI

Gives Alan AI direct access to your Gmail, Calendar, Drive, Meet and Classroom — through a small local MCP server backed by your own Google OAuth login. No backend, no database.

## What this skill does

- **Gmail** — search inbox, read threads, mark read, archive, trash
- **Calendar** — list events, create/update/delete meetings, generate Meet links
- **Drive** — search files by name, read content, create folders, share files
- **Docs / Sheets / Slides** — read content, create new files
- **Forms** — read questions, check response counts
- **Classroom** — check due assignments across active courses
- **Tasks** — list, create, and complete Google Tasks
- **Contacts** — search your Google Contacts by name
- **Brief** — a combined daily summary (calendar + inbox + classroom)

Write actions (send, archive, trash, delete, share, create) are available from the CLI with a confirmation prompt, and as MCP tools for Alan AI.

## Setup

### 1. Install

```bash
# from npm
npm install -g @ishaan_satapathy/threadmcp

# or run from source
git clone <repo-url> && cd google-workspace-mcp/cli && npm link
```

### 2. Sign in (one time, outside Alan AI)

```bash
threadmcp login
```

This opens a browser for Google sign-in and saves a token to `~/.gwork.json`. The first run asks for a Google OAuth Client ID/Secret — create one at [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials) (type "Desktop app", redirect URI `http://localhost:9876/callback`).

> **Token expiry:** New Google Cloud projects start in "Testing" mode where refresh tokens expire after 7 days. Re-run `threadmcp login` if your token stops working.

### 3. Add to Alan AI's MCP config

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

## Available Tools

| Tool | Description |
|---|---|
| `list_inbox` | List recent Gmail threads |
| `search_inbox` | Search Gmail |
| `get_thread` | Read a full email thread |
| `list_calendar_events` | List upcoming events |
| `create_meet_link` | Generate a Meet link |
| `create_calendar_event` | Schedule a Calendar event (with conflict detection) |
| `get_free_slots` | Find available time slots in your calendar |
| `search_drive` | Search Google Drive by name |
| `search_drive_content` | Deep-search inside file contents |
| `read_drive_file` | Read a Drive file's content |
| `get_priority_inbox` | Smart inbox — scored & ranked by urgency |
| `read_doc` / `create_doc` | Read or create a Google Doc |
| `read_sheet` / `create_sheet` | Read or create a Google Sheet |
| `read_slides` / `create_slides` | Read or create a Slides deck |
| `read_form` / `get_form_responses` | Read a Form's questions / response count |
| `list_classroom_due_work` | Check Classroom assignments |
| `get_daily_brief` | Combined daily summary |
| `mark_read` / `archive_email` / `trash_email` | Manage inbox message state |
| `delete_event` / `update_event` | Delete or update a Calendar event |
| `create_folder` / `share_file` | Create a Drive folder / share with someone |
| `list_tasks` / `create_task` / `complete_task` | Manage Google Tasks |
| `find_contact` | Search your Google Contacts |
| `last_interaction` | Most recent email exchange with a person |

## Example prompts

> "When did I last hear from Rahul?"

> "Create a task to call the investor tomorrow"

> "Share the Q3 report with priya@company.com"

> "Add a folder called Hackathon to my Drive"

> "When am I free for a 30-minute call tomorrow?"

> "What's urgent in my inbox?"

> "Schedule a call with Rahul tomorrow at 3pm"

> "What's on my calendar today?"

> "Create a Meet link for a quick call"

> "Search my Drive for the Q3 report"

> "What assignments are due this week?"

> "Brief me on today"
