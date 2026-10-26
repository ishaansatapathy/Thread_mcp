"use strict";

const SLACK = "https://slack.com/api";

async function slackFetch(url, token, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Slack HTTP error (${res.status}): ${text.slice(0, 300)}`);
  }
  const json = await res.json();
  if (!json.ok) {
    throw new Error(`Slack API error: ${json.error || "unknown"}`);
  }
  return json;
}

// ── Messages ────────────────────────────────────────────────────────────────

async function sendMessage(token, channel, text) {
  const json = await slackFetch(`${SLACK}/chat.postMessage`, token, {
    method: "POST",
    body: JSON.stringify({ channel, text }),
  });
  return { channel: json.channel, ts: json.ts };
}

// ── Channels ────────────────────────────────────────────────────────────────

async function listChannels(token, maxResults = 50) {
  const json = await slackFetch(
    `${SLACK}/conversations.list?limit=${maxResults}&types=public_channel,private_channel`,
    token,
  );
  return (json.channels || []).map((ch) => ({
    id: ch.id,
    name: ch.name,
    isPrivate: ch.is_private || false,
    numMembers: ch.num_members || 0,
  }));
}

// ── Channel History ─────────────────────────────────────────────────────────

async function getChannelHistory(token, channel, maxResults = 20) {
  const json = await slackFetch(
    `${SLACK}/conversations.history?channel=${channel}&limit=${maxResults}`,
    token,
  );
  return (json.messages || []).map((m) => ({
    user: m.user || m.bot_id || "unknown",
    text: m.text || "",
    ts: m.ts,
  }));
}

// ── Search ──────────────────────────────────────────────────────────────────
// Requires a User token (xoxp-) with search:read scope, not a Bot token.

async function searchMessages(token, query, maxResults = 20) {
  const json = await slackFetch(
    `${SLACK}/search.messages?query=${encodeURIComponent(query)}&count=${maxResults}`,
    token,
  );
  return ((json.messages?.matches) || []).map((m) => ({
    user: m.username || m.user || "unknown",
    text: (m.text || "").slice(0, 500),
    channel: m.channel?.name || m.channel?.id || "",
    ts: m.ts,
    permalink: m.permalink || "",
  }));
}

module.exports = { sendMessage, listChannels, getChannelHistory, searchMessages };