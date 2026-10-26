"use strict";

const GITHUB = "https://api.github.com";

async function g(url, token, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}`, Accept: opts.headers?.Accept || "application/vnd.github.v3+json" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitHub API error (${res.status}): ${text.slice(0, 300)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ── Repos ───────────────────────────────────────────────────────────────────

async function listRepos(token, maxResults = 20) {
  const repos = await g(`${GITHUB}/user/repos?sort=updated&per_page=${maxResults}`, token);
  return (repos || []).map((r) => ({
    fullName: r.full_name,
    private: r.private,
    description: r.description || "",
    url: r.html_url,
    updatedAt: r.updated_at,
  }));
}

// ── Issues ──────────────────────────────────────────────────────────────────

async function listIssues(token, owner, repo, state = "open") {
  const items = await g(`${GITHUB}/repos/${owner}/${repo}/issues?state=${state}&per_page=50`, token);
  return (items || []).filter((i) => !i.pull_request).map((i) => ({
    number: i.number,
    title: i.title,
    state: i.state,
    url: i.html_url,
    author: i.user?.login || "",
    createdAt: i.created_at,
  }));
}

async function createIssue(token, owner, repo, { title, body }) {
  const issue = await g(`${GITHUB}/repos/${owner}/${repo}/issues`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, body: body || "" }),
  });
  return { number: issue.number, title: issue.title, url: issue.html_url };
}

// ── Pull Requests ───────────────────────────────────────────────────────────

async function listPullRequests(token, owner, repo, state = "open") {
  const prs = await g(`${GITHUB}/repos/${owner}/${repo}/pulls?state=${state}&per_page=30`, token);
  return (prs || []).map((p) => ({
    number: p.number,
    title: p.title,
    url: p.html_url,
    author: p.user?.login || "",
    headBranch: p.head?.ref || "",
    baseBranch: p.base?.ref || "",
  }));
}

async function commentOnPR(token, owner, repo, prNumber, body) {
  const comment = await g(`${GITHUB}/repos/${owner}/${repo}/issues/${prNumber}/comments`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
  return { id: comment.id, url: comment.html_url };
}

// ── Code Search ─────────────────────────────────────────────────────────────

async function searchCode(token, query, maxResults = 10) {
  const data = await g(`${GITHUB}/search/code?q=${encodeURIComponent(query)}&per_page=${maxResults}`, token, {
    headers: { Accept: "application/vnd.github.v3.text-match+json" },
  });
  return (data.items || []).map((item) => ({
    repo: item.repository?.full_name || "",
    path: item.path,
    url: item.html_url,
  }));
}

// ── Context Graph (GraphQL) ──────────────────────────────────────────────────
// One GraphQL call pulls open PRs, the files each touches, and each PR's
// linked issues — a lightweight relationship graph with no database behind
// it. Every call recomputes it fresh from the live repo state.

const CONTEXT_GRAPH_QUERY = `
query($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
    pullRequests(states: OPEN, first: 20, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes {
        number
        title
        url
        author { login }
        headRefName
        baseRefName
        updatedAt
        files(first: 50) {
          nodes { path }
        }
        closingIssuesReferences(first: 5) {
          nodes { number title url }
        }
      }
    }
  }
}`;

async function graphql(token, query, variables) {
  const res = await fetch(`${GITHUB}/graphql`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) {
    const msg = json.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`;
    throw new Error(`GitHub GraphQL error: ${msg}`);
  }
  return json.data;
}

async function getRepoContextGraph(token, owner, repo) {
  const data = await graphql(token, CONTEXT_GRAPH_QUERY, { owner, repo });
  const prNodes = data.repository?.pullRequests?.nodes || [];

  const prs = prNodes.map((p) => ({
    number: p.number,
    title: p.title,
    url: p.url,
    author: p.author?.login || "",
    headRef: p.headRefName,
    baseRef: p.baseRefName,
    updatedAt: p.updatedAt,
    files: (p.files?.nodes || []).map((f) => f.path),
    linkedIssues: (p.closingIssuesReferences?.nodes || []).map((i) => ({
      number: i.number,
      title: i.title,
      url: i.url,
    })),
  }));

  // Build file -> PRs map; any file touched by 2+ open PRs is a potential conflict.
  const fileToPRs = new Map();
  for (const pr of prs) {
    for (const file of pr.files) {
      if (!fileToPRs.has(file)) fileToPRs.set(file, []);
      fileToPRs.get(file).push({ number: pr.number, title: pr.title, author: pr.author });
    }
  }

  const conflicts = [...fileToPRs.entries()]
    .filter(([, touchedBy]) => touchedBy.length > 1)
    .map(([file, touchedBy]) => ({ file, prs: touchedBy }));

  return { prs, conflicts };
}

module.exports = {
  listRepos,
  listIssues,
  createIssue,
  listPullRequests,
  commentOnPR,
  searchCode,
  getRepoContextGraph,
};