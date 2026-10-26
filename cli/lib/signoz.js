"use strict";

// SigNoz observability client. Auth: SIGNOZ-API-KEY header.
// Query normalization mirrors evolvex's client.ts `extractQueryRangeRows` exactly —
// the v5 query_range response is non-obvious: legacy `data.result[0].table.rows` OR
// modern `data.data.results[0].rows`, each row possibly nested under `.data`.

async function g(url, apiKey, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), "SIGNOZ-API-KEY": apiKey, "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`SigNoz API error (${res.status}): ${text.slice(0, 300)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function normalizeUrl(url) {
  return url.trim().replace(/\/+$/, "");
}

function extractQueryRangeRows(json) {
  const legacyRows = json.data?.result?.[0]?.table?.rows;
  if (legacyRows?.length) return legacyRows;

  const modernRows = json.data?.data?.results?.[0]?.rows;
  if (!modernRows?.length) return [];

  return modernRows.map((row) => {
    if (row && typeof row === "object" && "data" in row && row.data && typeof row.data === "object") {
      const nested = row.data;
      const timestamp = row.timestamp;
      return timestamp && !nested.timestamp ? { ...nested, timestamp } : nested;
    }
    return row;
  });
}

function rowValue(row, key) {
  if (key in row) return row[key];
  const alt = key.replace(/\./g, "_");
  if (alt in row) return row[alt];
  return undefined;
}

function parseTraceRow(row) {
  const durationRaw = rowValue(row, "durationNano") ?? rowValue(row, "duration_nano");
  const durationMs = typeof durationRaw === "number" ? Math.round(durationRaw / 1_000_000) : undefined;
  return {
    traceId: String(rowValue(row, "traceID") ?? rowValue(row, "trace_id") ?? ""),
    spanId: String(rowValue(row, "spanID") ?? rowValue(row, "span_id") ?? ""),
    serviceName: String(rowValue(row, "service.name") ?? rowValue(row, "service_name") ?? ""),
    name: String(rowValue(row, "name") ?? rowValue(row, "span_name") ?? "span"),
    durationMs,
    hasError: Boolean(rowValue(row, "hasError") ?? rowValue(row, "has_error")),
    timestamp: String(rowValue(row, "timestamp") ?? ""),
  };
}

// ── Traces ──────────────────────────────────────────────────────────────────

async function queryTraces(creds, { serviceName, hasError, windowMinutes = 60, limit = 20 }) {
  const now = Date.now();
  const start = now - windowMinutes * 60_000;
  const end = now;

  const filterParts = ["parent_span_id = ''"];
  if (serviceName) filterParts.push(`service.name = '${serviceName.replace(/'/g, "''")}'`);
  if (hasError) filterParts.push("has_error = true");

  const body = {
    start,
    end,
    requestType: "raw",
    compositeQuery: {
      queries: [
        {
          type: "builder_query",
          spec: {
            name: "A",
            signal: "traces",
            filter: { expression: filterParts.join(" AND ") },
            selectFields: [
              { name: "service.name", fieldContext: "resource" },
              { name: "name" },
              { name: "durationNano" },
              { name: "hasError" },
              { name: "traceID" },
              { name: "spanID" },
              { name: "timestamp" },
            ],
            limit: limit ?? 20,
            offset: 0,
            order: [{ key: { name: "timestamp" }, direction: "desc" }],
          },
        },
      ],
    },
  };

  const url = `${normalizeUrl(creds.cloudUrl)}/api/v5/query_range`;
  const json = await g(url, creds.apiKey, { method: "POST", body: JSON.stringify(body) });
  const rows = extractQueryRangeRows(json);
  return rows.map((row) => parseTraceRow(row));
}

// ── Service Health ──────────────────────────────────────────────────────────

async function getServiceHealth(creds, serviceName, windowMinutes = 60) {
  const traces = await queryTraces(creds, { serviceName, windowMinutes, limit: 100 });

  const totalSpans = traces.length;
  const errorCount = traces.filter((t) => t.hasError).length;
  const errorRatePct = totalSpans > 0 ? Math.round((errorCount / totalSpans) * 1000) / 10 : 0;

  const durations = traces
    .map((t) => t.durationMs)
    .filter((d) => typeof d === "number")
    .sort((a, b) => a - b);

  const avgMs = durations.length ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length) : null;
  const p50Ms = durations.length ? durations[Math.floor(durations.length * 0.5)] : null;

  return {
    serviceName,
    windowMinutes,
    totalSpans,
    errorCount,
    errorRatePct,
    avgDurationMs: avgMs,
    p50DurationMs: p50Ms,
  };
}

// ── Alert Rules ─────────────────────────────────────────────────────────────

async function listAlertRules(creds) {
  const result = await g(`${normalizeUrl(creds.cloudUrl)}/api/v2/rules`, creds.apiKey);
  return Array.isArray(result) ? result : result?.rules || result?.data || [];
}

// ── Notification Channels ───────────────────────────────────────────────────

async function listNotificationChannels(creds) {
  const result = await g(`${normalizeUrl(creds.cloudUrl)}/api/v1/channels`, creds.apiKey);
  const list = Array.isArray(result) ? result : result?.data || [];
  return list.map((c) => ({ id: c.id, name: c.name, type: c.channelType || c.type }));
}

// ── Alert History ───────────────────────────────────────────────────────────

async function getAlertHistory(creds, ruleId, windowMinutes = 1440) {
  const url = `${normalizeUrl(creds.cloudUrl)}/api/v2/rules/${ruleId}/history/timeline`;
  return g(url, creds.apiKey);
}

module.exports = { queryTraces, getServiceHealth, listAlertRules, listNotificationChannels, getAlertHistory };