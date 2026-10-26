![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)
![tag:hackathon](https://img.shields.io/badge/hackathon-5F43F1)

# threadmcp

> One CLI, one MCP server, five services: Google Workspace, GitHub, Jira, Slack, and SigNoz. Built for the **Alan AI OpenFire Hackathon 2026**.

Self-contained — no backend to deploy, no database, zero npm dependencies. Every credential is your own (OAuth or API token), stored only in `~/.gwork.json` on your machine. `threadmcp` is a single Node.js process that talks directly to each service's REST/GraphQL API.

**53 tools** across 5 services, usable from your terminal or from any MCP-compatible AI agent (Alan AI, Claude Desktop, etc.).

---

## Contents

- [Quick start](#quick-start)
- [Install](#install)
- [Setup: Google Workspace](#setup-google-workspace)
- [Setup: GitHub](#setup-github)
- [Setup: Jira](#setup-jira)
- [Setup: Slack](#setup-slack)
- [Setup: SigNoz](#setup-signoz)
- [Alan AI integration](#alan-ai-integration)
- [CLI reference](#cli-reference)
- [MCP tools reference](#mcp-tools-reference)
- [Architecture](#architecture)
- [Credentials & security](#credentials--security)
- [Google OAuth scopes](#google-oauth-scopes)
- [License](#license)

---

## Quick start

```bash
npm install -g @ishaan_satapathy/threadmcp
threadmcp login                              # Google — opens a browser
threadmcp brief                              # today's calendar + inbox + classroom
```

Every other service (GitHub, Jira, Slack, SigNoz) is optional and independent — connect only the ones you use, whenever you first touch a command for that service.

---

## Install

```bash
# from npm
npm install -g @ishaan_satapathy/threadmcp

# or run from source
git clone https://github.com/ishaansatapathy/Thread_mcp.git
cd Thread_mcp/cli
npm link
```

Both give you the `threadmcp` command globally.

---

## Setup: Google Workspace

```bash
threadmcp login
```

The **first** run asks for a Google OAuth Client ID/Secret (one-time, cached after):

1. Go to [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials)
2. Create an OAuth 2.0 Client ID — type **Desktop app** or **Web application**
3. If Web application, add this **Authorized redirect URI**:
   ```
   http://localhost:9876/callback
   ```
4. Paste the Client ID and Client Secret when `threadmcp login` asks

A browser window opens for Google sign-in. Approve the scopes (Gmail, Calendar, Drive, Docs, Sheets, Slides, Forms, Classroom, Tasks, Contacts — see [full list](#google-oauth-scopes)), and the token is saved to `~/.gwork.json`.

> **Testing-mode tokens expire after 7 days.** If a command suddenly fails with an expired/revoked error, just run `threadmcp login` again. To avoid this, either add yourself as a verified test user on the OAuth consent screen, or publish the app.

> **New scopes require re-login.** If you pull an update that adds a new Google scope (e.g. Tasks, Contacts), run `threadmcp login` again to re-consent — the old token won't have the new permission.

---

## Setup: GitHub

```bash
threadmcp github login
```

1. Go to [github.com/settings/tokens](https://github.com/settings/tokens) → **Generate new token (classic)**
2. Scopes needed: `repo`, `read:user`
3. Paste the token when prompted

Credentials are saved under `github.token` in `~/.gwork.json`, or set `GITHUB_TOKEN` as an env var to skip the prompt entirely.

---

## Setup: Jira

```bash
threadmcp jira login
```

You'll need three values:

1. **Site** — your subdomain, e.g. `mycompany` for `mycompany.atlassian.net`
2. **Email** — the address you log into Jira with
3. **API token** — generate one at [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens)

Saved under `jira.{site,email,apiToken}`, or set `JIRA_SITE` / `JIRA_EMAIL` / `JIRA_API_TOKEN` as env vars.

---

## Setup: Slack

```bash
threadmcp slack login
```

1. Create a Slack app at [api.slack.com/apps](https://api.slack.com/apps) (or use an existing one)
2. Under **OAuth & Permissions**, add bot scopes: `chat:write`, `channels:read`, `channels:history`, `groups:read`, `groups:history`
3. Install the app to your workspace, copy the **Bot User OAuth Token** (`xoxb-...`)
4. Paste it when prompted

Saved under `slack.token`, or set `SLACK_BOT_TOKEN` as an env var.

> **Message search needs a different token.** `threadmcp slack search` calls `search.messages`, which only works with a **User token** (`xoxp-...`, scope `search:read`) — bot tokens can't search. Everything else (`send`, `channels`, `history`) works fine with a bot token.

---

## Setup: SigNoz

```bash
threadmcp signoz login
```

1. **Cloud URL** — your SigNoz instance, e.g. `https://myorg.signoz.cloud` or `http://localhost:8080` for self-hosted
2. **API Key** — SigNoz → Settings → API Keys → create an Editor key

Saved under `signoz.{cloudUrl,apiKey}`, or set `SIGNOZ_CLOUD_URL` / `SIGNOZ_API_KEY` as env vars.

---

## Alan AI integration

Add to Alan AI's MCP config:

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

Or run from source before an npm publish:

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

Run `threadmcp login` (and any other service's `login`) once in a terminal first, outside Alan AI — the MCP server reads the same `~/.gwork.json` but never prompts interactively itself (its stdin is the JSON-RPC channel, not a human). If a service isn't configured yet, its tools return a clear error telling you which `threadmcp <service> login` to run.

Then just ask Alan AI things like:

- *"What's urgent in my inbox?"*
- *"Schedule a call with Rahul tomorrow at 3pm"* — auto-detects calendar conflicts
- *"When am I free for a 30-minute call today?"*
- *"Find the Q3 deck in my Drive"* — searches inside file contents, not just names
- *"Brief me on today"*
- *"What are my open PRs on acme/webapp, and is anyone else touching the same files?"* — context graph + conflict flags
- *"What's the error rate on the api service in the last hour?"*
- *"Create a Jira ticket for this bug and assign it to the backend project"*

---

## CLI reference

```bash
# Auth
threadmcp login                             # Google — opens browser
threadmcp logout                            # sign out of Google
threadmcp mcp                               # start MCP server over stdio (for Alan AI)

# Mail
threadmcp mail inbox                        # recent emails
threadmcp mail search <query>               # Gmail search syntax
threadmcp mail read <threadId>              # read a thread (full body)
threadmcp mail send <to> <subject> <body>   # asks to confirm before sending
threadmcp mail markread <messageId>         # mark as read
threadmcp mail archive <messageId>          # archive — asks to confirm
threadmcp mail trash <messageId>            # trash — asks to confirm

# Calendar
threadmcp cal today                         # today's events
threadmcp cal week                          # this week's events
threadmcp cal create "<title>" <when>       # e.g. "Team sync" tomorrow 3pm — asks to confirm
threadmcp cal delete <eventId>              # delete — asks to confirm
threadmcp cal update <eventId> <field> <value>   # update summary/start/end

# Meet
threadmcp meet                              # create a Meet link

# Drive
threadmcp drive find <query>                # search by filename
threadmcp drive read <fileId>               # read text content (Docs/Sheets/Slides auto-exported)
threadmcp drive mkdir "<name>"              # create a folder — asks to confirm
threadmcp drive share <fileId> <email> [role]    # share — asks to confirm

# Docs / Sheets / Slides / Forms
threadmcp doc read <documentId>
threadmcp doc create "<title>" <content>            # asks to confirm
threadmcp sheet read <spreadsheetId> [range]        # default A1:Z100
threadmcp sheet create "<title>" <row,of,values>    # asks to confirm
threadmcp slides read <presentationId>
threadmcp slides create "<title>" <bodyText>        # asks to confirm
threadmcp forms read <formId>
threadmcp forms responses <formId>

# Classroom
threadmcp classroom                         # due assignments, active courses

# Tasks
threadmcp tasks list
threadmcp tasks create "<title>" [due]      # asks to confirm
threadmcp tasks done <taskId> <tasklistId>

# Contacts
threadmcp contact find <name>
threadmcp contact last <name>               # last email exchange with someone

# Brief
threadmcp brief                             # combined calendar + inbox + classroom summary

# GitHub
threadmcp github login
threadmcp github repos
threadmcp github issues <owner> <repo>
threadmcp github issue create <owner> <repo> "<title>" <body>    # asks to confirm
threadmcp github prs <owner> <repo>
threadmcp github comment <owner> <repo> <prNumber> <body>        # asks to confirm
threadmcp github search <query>             # code search
threadmcp github graph <owner> <repo>       # live PR/issue/file relationship graph + conflict flags

# Jira
threadmcp jira login
threadmcp jira issues [jql]                 # default: your unresolved issues
threadmcp jira issue <ISSUE-KEY>
threadmcp jira create "<projectKey>" "<summary>" <description>   # asks to confirm
threadmcp jira transition <ISSUE-KEY> <transitionName>           # asks to confirm

# Slack
threadmcp slack login
threadmcp slack send <channel> <text>       # asks to confirm
threadmcp slack channels
threadmcp slack history <channel>
threadmcp slack search <query>              # needs a user token, see Setup: Slack

# SigNoz
threadmcp signoz login
threadmcp signoz health <serviceName> [windowMinutes]   # span count, error rate, p50/avg latency
threadmcp signoz traces <serviceName> [--errors]        # raw spans, optionally error-only
threadmcp signoz alerts                     # alert rules
threadmcp signoz channels                   # notification channels
```

Every write action (send email, create event, archive, trash, create issue, comment, post a message, share a file) prints exactly what it's about to do and asks `(y/n)` before touching your account.

---

## MCP tools reference

### Google Workspace (33)

| Tool | What it does |
|---|---|
| `list_inbox` | Recent Gmail messages |
| `search_inbox` | Gmail search |
| `get_thread` | Read a full email thread (decoded body) |
| `get_priority_inbox` | Rank messages by urgency (unread, recency, keywords) |
| `mark_read` | Mark a message as read |
| `archive_email` | Archive a message |
| `trash_email` | Move a message to Trash |
| `list_calendar_events` | Upcoming events |
| `create_calendar_event` | Schedule an event — auto-detects conflicts, Meet link by default |
| `delete_event` | Delete an event |
| `update_event` | Update an event's title/time |
| `get_free_slots` | Find open time blocks for a given day |
| `create_meet_link` | Generate a standalone Meet link |
| `search_drive` | Search Drive by filename |
| `search_drive_content` | Deep-search inside file contents (Docs, PDFs, Sheets) |
| `read_drive_file` | Read a file's text content |
| `create_folder` | Create a Drive folder |
| `share_file` | Share a file/folder with someone |
| `read_doc` / `create_doc` | Read or create a Google Doc |
| `read_sheet` / `create_sheet` | Read or create a Google Sheet |
| `read_slides` / `create_slides` | Read or create a Slides deck |
| `read_form` / `get_form_responses` | Read a Form's questions / response count |
| `list_classroom_due_work` | Upcoming Classroom assignments |
| `list_tasks` / `create_task` / `complete_task` | Google Tasks |
| `find_contact` | Search Google Contacts by name |
| `last_interaction` | Most recent email exchange with someone |
| `get_daily_brief` | Combined calendar + inbox + classroom summary |

### GitHub (7)

| Tool | What it does |
|---|---|
| `list_github_repos` | Your repositories |
| `list_github_issues` | Open issues in a repo |
| `create_github_issue` | Create an issue |
| `list_github_prs` | Open pull requests |
| `comment_on_pr` | Comment on a PR |
| `search_github_code` | Search code across GitHub |
| `get_repo_context_graph` | One GraphQL call pulls every open PR, its changed files, and its linked issues — flags files touched by more than one open PR as a likely merge conflict. No database, computed fresh every call. |

### Jira (4)

| Tool | What it does |
|---|---|
| `list_jira_issues` | Issues matching a JQL query (default: your unresolved issues) |
| `get_jira_issue` | One issue by key |
| `create_jira_issue` | Create an issue |
| `transition_jira_issue` | Move an issue to another status by name |

### Slack (4)

| Tool | What it does |
|---|---|
| `send_slack_message` | Post a message to a channel |
| `list_slack_channels` | List channels |
| `get_slack_channel_history` | Recent messages from a channel |
| `search_slack_messages` | Search messages (needs a user token) |

### SigNoz Observability (5)

| Tool | What it does |
|---|---|
| `get_service_health` | Span count, error rate, p50/avg latency for a service over a time window |
| `query_traces` | Raw spans, optionally filtered to errors only |
| `list_alert_rules` | Configured alert rules |
| `list_notification_channels` | Configured notification channels |
| `get_alert_history` | Firing history for a specific alert rule |

---

## Architecture

```
Alan AI  ──stdio/MCP──┐
                       ├──→  threadmcp  ──→  Google (Gmail, Calendar, Drive, Docs, Sheets,
Terminal ──direct──────┘            │         Slides, Forms, Classroom, Tasks, Contacts)
                                     ├──→  GitHub (REST + GraphQL)
                              ~/.gwork.json  ├──→  Jira (REST)
                         (credentials,       ├──→  Slack (Web API)
                          local only)        └──→  SigNoz (Query Builder API)
```

No server, no database. `threadmcp` is a single Node.js process that holds your credentials locally and calls each service's own API directly — including `get_repo_context_graph`, which builds a live relationship graph via one GitHub GraphQL query instead of maintaining a separate graph database.

---

## Credentials & security

Every credential — Google OAuth tokens, GitHub PAT, Jira API token, Slack bot/user token, SigNoz API key — is stored **only** in `~/.gwork.json` on your own machine. Nothing is sent anywhere except directly to that service's own API. The file is never committed (see `.gitignore`), and nothing in this repo's source ever hardcodes a real credential.

| Service | Credential(s) | Auth mechanism |
|---|---|---|
| Google | OAuth 2.0 (Client ID/Secret you provide + token) | `Authorization: Bearer <token>` |
| GitHub | Personal Access Token | `Authorization: Bearer <token>` |
| Jira | Site + Email + API token | `Authorization: Basic base64(email:token)` |
| Slack | Bot (`xoxb-`) or User (`xoxp-`) token | `Authorization: Bearer <token>` |
| SigNoz | Cloud URL + API key | `SIGNOZ-API-KEY: <key>` |

Every credential can also be supplied via environment variable instead of the interactive prompt: `GITHUB_TOKEN`, `JIRA_SITE`/`JIRA_EMAIL`/`JIRA_API_TOKEN`, `SLACK_BOT_TOKEN`, `SIGNOZ_CLOUD_URL`/`SIGNOZ_API_KEY`, `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET`.

---

## Google OAuth scopes

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
