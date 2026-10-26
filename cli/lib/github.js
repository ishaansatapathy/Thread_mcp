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

module.exports = { listRepos, listIssues, createIssue, listPullRequests, commentOnPR, searchCode };