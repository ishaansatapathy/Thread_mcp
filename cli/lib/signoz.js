"use strict";

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

function lookUp(row, key) {
  for (const kv of row.data?.result || []) {
    if (kv.metric?.[key]) return Number(kv.metric[key]) || 0;
  }
  return 0;
}

// ── Service Health ──────────────────────────────────────────────────────────

async function getServiceHealth(creds, serviceName, windowMinutes = 60) {
  const now = Math.floor(Date.now() / 1000);
  const start = now - windowMinutes * 60;
  const segments = 12;

  // Request rate
  const reqBody = {
    start,
    end: now,
    step: Math.ceil((windowMinutes * 60) / segments),
    compositeMetricQuery: {
      builderQueries: {
        A: {
          queryName: "A",
          step: Math.ceil((windowMinutes * 60) / segments),
          dataSource: "metrics",
          aggregateOperator: "RATE",
          aggregateAttribute: { key: "signoz_calls_total", dataType: "float64", type: "" },
          tagFilters: {
            items: [{ id: "svc", key: { key: "service_name", dataType: "string", type: "tag", isColumn: false }, op: "=", value: serviceName }],
            op: "AND",
          },
          expression: "A",
          disabled: false,
          having: [],
          limit: null,
          orderBy: [],
          reduceTo: "sum",
          timeAggregation: "RATE",
          spaceAggregation: "sum",
          groupBy: [],
          legend: "Request rate",
        },
      },
      queryType: "builder",
      panelType: "graph",
    },
  };

  const reqRes = await g(`${normalizeUrl(creds.cloudUrl)}/api/v5/query_range`, creds.apiKey, {
    method: "POST",
    body: JSON.stringify(reqBody),
  });

  // Error rate
  const errBody = JSON.parse(JSON.stringify(reqBody));
  errBody.compositeMetricQuery.builderQueries.A.aggregateAttribute.key = "signoz_calls_total";
  errBody.compositeMetricQuery.builderQueries.A.tagFilters.items.push({
    id: "sc",
    key: { key: "status_code", dataType: "int64", type: "tag", isColumn: false },
    op: ">=",
    value: "500",
  });
  errBody.compositeMetricQuery.builderQueries.A.legend = "Error rate";

  const errRes = await g(`${normalizeUrl(creds.cloudUrl)}/api/v5/query_range`, creds.apiKey, {
    method: "POST",
    body: JSON.stringify(errBody),
  });

  // P99 latency — single query
  const p99Body = JSON.parse(JSON.stringify(reqBody));
  p99Body.compositeMetricQuery.builderQueries.A.aggregateAttribute.key = "signoz_latency";
  p99Body.compositeMetricQuery.builderQueries.A.aggregateAttribute.dataType = "float64";
  p99Body.compositeMetricQuery.builderQueries.A.spaceAggregation = "p99";
  p99Body.compositeMetricQuery.builderQueries.A.legend = "p99 latency";

  const p99Res = await g(`${normalizeUrl(creds.cloudUrl)}/api/v5/query_range`, creds.apiKey, {
    method: "POST",
    body: JSON.stringify(p99Body),
  });

  const requestRate = reqRes.data?.result?.[0]?.table?.rows?.length || 0;
  const errorRate = errRes.data?.result?.[0]?.table?.rows?.length || 0;
  const p99L = p99Res.data?.result?.[0]?.table?.rows;

  return {
    service: serviceName,
    windowMinutes,
    requestRate: requestRate > 0 ? `${requestRate} data points` : "No data",
    errorRate: errorRate > 0 ? `${errorRate} data points (≥500 status)` : "No errors",
    p99LatencyMs: p99L ? lookUp(p99Res, "signoz_latency") : null,
  };
}

// ── Alert Rules ─────────────────────────────────────────────────────────────

async function listAlertRules(creds) {
  const result = await g(`${normalizeUrl(creds.cloudUrl)}/api/v2/rules`, creds.apiKey);
  return (result || []).map((r) => ({
    id: r.id,
    name: r.alertName || r.alert,
    state: r.state || r.disabled ? "disabled" : "active",
    labels: r.labels || {},
  }));
}

// ── Dashboards ──────────────────────────────────────────────────────────────

async function listDashboards(creds) {
  const result = await g(`${normalizeUrl(creds.cloudUrl)}/api/v1/dashboards`, creds.apiKey);
  return (result || []).map((d) => ({
    id: d.uuid || d.id,
    title: d.data?.title || d.title || "Untitled",
    description: d.data?.description || "",
  }));
}

module.exports = { getServiceHealth, listAlertRules, listDashboards };