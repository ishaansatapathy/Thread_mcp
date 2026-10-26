"use strict";

const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");
const { exec } = require("child_process");

const CONFIG_PATH = path.join(os.homedir(), ".gwork.json");
const REDIRECT_URI = "http://localhost:9876/callback";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.coursework.me.readonly",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/presentations",
  "https://www.googleapis.com/auth/forms.body.readonly",
  "https://www.googleapis.com/auth/forms.responses.readonly",
  "https://www.googleapis.com/auth/tasks",
  "https://www.googleapis.com/auth/contacts",
].join(" ");

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    }),
  );
}

function openBrowser(url) {
  const platform = process.platform;
  const cmd =
    platform === "win32" ? `start "" "${url}"` : platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

async function httpPostForm(url, form) {
  const body = new URLSearchParams(form).toString();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error_description || json.error || "Token request failed");
  return json;
}

/**
 * Credentials live only in ~/.gwork.json (or env vars) — never in the repo.
 * Create your own OAuth client at https://console.cloud.google.com/apis/credentials
 * (type "Desktop app" or "Web application" with the redirect URI below).
 */
async function ensureClientCredentials() {
  const cfg = loadConfig();
  let clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || cfg.clientId;
  let clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || cfg.clientSecret;

  if (!clientId || !clientSecret) {
    console.log("\nFirst-time setup — enter your Google OAuth credentials.");
    console.log("Create one at https://console.cloud.google.com/apis/credentials");
    console.log(`Authorized redirect URI must include: ${REDIRECT_URI}\n`);
    clientId = await ask("Google OAuth Client ID: ");
    clientSecret = await ask("Google OAuth Client Secret: ");
    saveConfig({ ...cfg, clientId, clientSecret });
  }
  return { clientId, clientSecret };
}

async function login() {
  const { clientId, clientSecret } = await ensureClientCredentials();

  const state = crypto.randomBytes(16).toString("hex");
  const authUrl =
    `${AUTH_URL}?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&response_type=code&access_type=offline&prompt=consent` +
    `&scope=${encodeURIComponent(SCOPES)}&state=${state}`;

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let url;
      try {
        url = new URL(req.url, REDIRECT_URI);
      } catch {
        res.end("Bad request");
        return;
      }
      if (url.pathname !== "/callback") {
        res.end("Not found");
        return;
      }

      const errorParam = url.searchParams.get("error");
      const returnedState = url.searchParams.get("state");

      if (errorParam) {
        res.end("<html><body>Login failed — you can close this tab.</body></html>");
        server.close();
        reject(new Error(`Google OAuth error: ${errorParam}`));
        return;
      }
      if (returnedState !== state) {
        res.end("<html><body>State mismatch — close this tab and try again.</body></html>");
        server.close();
        reject(new Error("OAuth state mismatch"));
        return;
      }

      const authCode = url.searchParams.get("code");
      res.end(
        "<html><body><h2>threadmcp — signed in. You can close this tab and return to the terminal.</h2></body></html>",
      );
      server.close();
      resolve(authCode);
    });

    server.listen(9876, () => {
      console.log("\nOpening your browser for Google sign-in...");
      console.log(`If it doesn't open automatically, visit:\n${authUrl}\n`);
      openBrowser(authUrl);
    });
    server.on("error", reject);
  });

  const tokens = await httpPostForm(TOKEN_URL, {
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: REDIRECT_URI,
    grant_type: "authorization_code",
  });

  const cfg = loadConfig();
  saveConfig({
    ...cfg,
    clientId,
    clientSecret,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || cfg.refreshToken,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  });

  console.log("\n\x1b[32m✓ Signed in. Token saved to ~/.gwork.json\x1b[0m");
}

async function refreshAccessToken() {
  const cfg = loadConfig();
  if (!cfg.refreshToken) throw new Error("Not logged in. Run: threadmcp login");
  try {
    const tokens = await httpPostForm(TOKEN_URL, {
      refresh_token: cfg.refreshToken,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: "refresh_token",
    });
    const updated = {
      ...cfg,
      accessToken: tokens.access_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    };
    saveConfig(updated);
    return updated.accessToken;
  } catch (err) {
    const msg = String(err.message || err);
    if (/invalid_grant|expired|revoked/i.test(msg)) {
      throw new Error("Google sign-in expired (Testing-mode tokens last 7 days). Run: threadmcp login");
    }
    throw err;
  }
}

async function getAccessToken() {
  const cfg = loadConfig();
  if (!cfg.accessToken) throw new Error("Not logged in. Run: threadmcp login");
  if (!cfg.expiresAt || Date.now() > cfg.expiresAt - 60_000) {
    return refreshAccessToken();
  }
  return cfg.accessToken;
}

function logout() {
  const cfg = loadConfig();
  delete cfg.accessToken;
  delete cfg.refreshToken;
  delete cfg.expiresAt;
  saveConfig(cfg);
  console.log("\x1b[32m✓ Signed out.\x1b[0m");
}

// ── Integration credential helpers ──────────────────────────────────────────
// Each integration stores its credentials in ~/.gwork.json, namespaced by service
// key, alongside the Google OAuth fields. Prompts once, caches forever.

async function ensureGithubToken() {
  const cfg = loadConfig();
  let token = process.env.GITHUB_TOKEN || cfg.github?.token;
  if (!token) {
    console.log("\nGitHub Personal Access Token required.");
    console.log("Create one at https://github.com/settings/tokens (scopes: repo, read:user)\n");
    token = await ask("GitHub Personal Access Token (create at github.com/settings/tokens): ");
    saveConfig({ ...cfg, github: { ...(cfg.github || {}), token } });
  }
  return token;
}

async function ensureJiraCreds() {
  const cfg = loadConfig();
  let site = process.env.JIRA_SITE || cfg.jira?.site;
  let email = process.env.JIRA_EMAIL || cfg.jira?.email;
  let apiToken = process.env.JIRA_API_TOKEN || cfg.jira?.apiToken;
  if (!site || !email || !apiToken) {
    console.log("\nJira credentials required.");
    console.log("Site is your subdomain (e.g. 'mycompany' for mycompany.atlassian.net)");
    console.log("API token: https://id.atlassian.com/manage-profile/security/api-tokens\n");
    if (!site) site = await ask("Jira Site subdomain (e.g. mycompany): ");
    if (!email) email = await ask("Jira Email: ");
    if (!apiToken) apiToken = await ask("Jira API Token: ");
    saveConfig({ ...cfg, jira: { site, email, apiToken } });
  }
  return { site, email, apiToken };
}

async function ensureSlackToken() {
  const cfg = loadConfig();
  let token = process.env.SLACK_BOT_TOKEN || cfg.slack?.token;
  if (!token) {
    console.log("\nSlack token required.");
    console.log("Bot token: https://api.slack.com/apps → OAuth & Permissions (starts with xoxb-)");
    console.log("User token: https://api.slack.com/apps → User OAuth Token (starts with xoxp-, needed for search)\n");
    token = await ask("Slack Bot Token (xoxb-...): ");
    saveConfig({ ...cfg, slack: { ...(cfg.slack || {}), token } });
  }
  return token;
}

async function ensureSignozCreds() {
  const cfg = loadConfig();
  let cloudUrl = process.env.SIGNOZ_CLOUD_URL || cfg.signoz?.cloudUrl;
  let apiKey = process.env.SIGNOZ_API_KEY || cfg.signoz?.apiKey;
  if (!cloudUrl || !apiKey) {
    console.log("\nSigNoz credentials required.");
    console.log("Cloud URL: your SigNoz instance (e.g. https://myorg.signoz.cloud or http://localhost:8080)");
    console.log("API Key: SigNoz → Settings → API Keys → create an Editor key\n");
    if (!cloudUrl) cloudUrl = await ask("SigNoz Cloud URL: ");
    if (!apiKey) apiKey = await ask("SigNoz API Key: ");
    saveConfig({ ...cfg, signoz: { cloudUrl, apiKey } });
  }
  return { cloudUrl, apiKey };
}

// ── Non-interactive getters ──────────────────────────────────────────────────
// For the MCP server (cli/mcp-server.js): stdin there is the JSON-RPC channel,
// not a human terminal, so these must never call ask() — only read what's
// already saved and throw a clear, actionable error otherwise.

function getGithubToken() {
  const cfg = loadConfig();
  const token = process.env.GITHUB_TOKEN || cfg.github?.token;
  if (!token) throw new Error("GitHub not configured. Run: threadmcp github login");
  return token;
}

function getJiraCreds() {
  const cfg = loadConfig();
  const site = process.env.JIRA_SITE || cfg.jira?.site;
  const email = process.env.JIRA_EMAIL || cfg.jira?.email;
  const apiToken = process.env.JIRA_API_TOKEN || cfg.jira?.apiToken;
  if (!site || !email || !apiToken) throw new Error("Jira not configured. Run: threadmcp jira login");
  return { site, email, apiToken };
}

function getSlackToken() {
  const cfg = loadConfig();
  const token = process.env.SLACK_BOT_TOKEN || cfg.slack?.token;
  if (!token) throw new Error("Slack not configured. Run: threadmcp slack login");
  return token;
}

function getSignozCreds() {
  const cfg = loadConfig();
  const cloudUrl = process.env.SIGNOZ_CLOUD_URL || cfg.signoz?.cloudUrl;
  const apiKey = process.env.SIGNOZ_API_KEY || cfg.signoz?.apiKey;
  if (!cloudUrl || !apiKey) throw new Error("SigNoz not configured. Run: threadmcp signoz login");
  return { cloudUrl, apiKey };
}

module.exports = {
  login,
  logout,
  getAccessToken,
  loadConfig,
  CONFIG_PATH,
  ensureGithubToken,
  ensureJiraCreds,
  ensureSlackToken,
  ensureSignozCreds,
  getGithubToken,
  getJiraCreds,
  getSlackToken,
  getSignozCreds,
};
