"use strict";

function authHeader(email, apiToken) {
  return `Basic ${Buffer.from(`${email}:${apiToken}`).toString("base64")}`;
}

async function g(url, header, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: header, Accept: "application/json" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Jira API error (${res.status}): ${text.slice(0, 300)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function baseUrl(creds) {
  return `https://${creds.site}.atlassian.net/rest/api/3`;
}

// ── Issues ──────────────────────────────────────────────────────────────────

async function listIssues(creds, jql, maxResults = 20) {
  const q = jql || "assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC";
  const url = `${baseUrl(creds)}/search?jql=${encodeURIComponent(q)}&maxResults=${maxResults}`;
  const result = await g(url, authHeader(creds.email, creds.apiToken));
  const site = creds.site;
  return (result.issues || []).map((i) => ({
    key: i.key,
    summary: i.fields?.summary || "",
    status: i.fields?.status?.name || "",
    priority: i.fields?.priority?.name || "",
    url: `https://${site}.atlassian.net/browse/${i.key}`,
  }));
}

async function getIssue(creds, issueKey) {
  const url = `${baseUrl(creds)}/issue/${issueKey}`;
  const i = await g(url, authHeader(creds.email, creds.apiToken));
  return {
    key: i.key,
    summary: i.fields?.summary || "",
    description: i.fields?.description ? "[ADF content]" : "",
    status: i.fields?.status?.name || "",
    assignee: i.fields?.assignee?.displayName || "Unassigned",
    priority: i.fields?.priority?.name || "",
  };
}

// ── Create ──────────────────────────────────────────────────────────────────

async function createIssue(creds, { projectKey, summary, description, issueType = "Task" }) {
  const body = {
    fields: {
      project: { key: projectKey },
      summary,
      issuetype: { name: issueType },
      description: {
        type: "doc",
        version: 1,
        content: [{ type: "paragraph", content: [{ type: "text", text: description || "" }] }],
      },
    },
  };
  const url = `${baseUrl(creds)}/issue`;
  const issue = await g(url, authHeader(creds.email, creds.apiToken), {
    method: "POST",
    headers: { ...({}), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { key: issue.key, url: `https://${creds.site}.atlassian.net/browse/${issue.key}` };
}

// ── Transition ──────────────────────────────────────────────────────────────

async function transitionIssue(creds, issueKey, transitionName) {
  const header = authHeader(creds.email, creds.apiToken);

  // Fetch available transitions
  const transUrl = `${baseUrl(creds)}/issue/${issueKey}/transitions`;
  const transRes = await g(transUrl, header);
  const transitions = transRes.transitions || [];

  const nameLower = transitionName.toLowerCase();
  const match = transitions.find((t) =>
    t.name?.toLowerCase() === nameLower || String(t.id) === nameLower,
  );

  if (!match) {
    const names = transitions.map((t) => t.name || `id:${t.id}`).join(", ");
    throw new Error(`No transition matching "${transitionName}". Available: ${names || "none"}`);
  }

  // Apply the transition
  const applyUrl = `${baseUrl(creds)}/issue/${issueKey}/transitions`;
  await g(applyUrl, header, {
    method: "POST",
    body: JSON.stringify({ transition: { id: match.id } }),
  });

  return { issueKey, transition: match.name, to: match.to?.name || match.name };
}

module.exports = { listIssues, getIssue, createIssue, transitionIssue };