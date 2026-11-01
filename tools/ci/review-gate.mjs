// Pure review-policy validation. The caller must fetch both current review
// reports and verify GitHub Issues / labels via the GitHub API before using
// this result to authorize any merge. No network access is performed here.
export const FINDING_LABELS = Object.freeze({
  Voka: 'voka-finding',
  Judge: 'judge-finding',
});

const SEVERITY_RANK = Object.freeze({
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
});

function assertString(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function normalizeFinding(finding) {
  if (!finding || typeof finding !== 'object' || Array.isArray(finding)) {
    throw new TypeError('finding must be an object');
  }
  const key = assertString(finding.key, 'finding.key');
  const severity = assertString(finding.severity, 'finding.severity').toUpperCase();
  if (!(severity in SEVERITY_RANK)) {
    throw new TypeError(`unknown severity for ${key}: ${severity}`);
  }
  return { ...finding, key, severity };
}

function countsFor(findings) {
  const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}

function severityGate(counts) {
  return counts.CRITICAL >= 1 || counts.HIGH >= 1 || counts.MEDIUM >= 3
    ? 'FAIL'
    : 'PASS';
}

function distinctFindings(findings) {
  const keyed = new Map();
  for (const raw of findings) {
    const finding = normalizeFinding(raw);
    if (finding.resolved === true) continue;
    const previous = keyed.get(finding.key);
    if (!previous || SEVERITY_RANK[finding.severity] > SEVERITY_RANK[previous.severity]) {
      keyed.set(finding.key, finding);
    }
  }
  return [...keyed.values()];
}

export function evaluateAgentReview(findings) {
  if (!Array.isArray(findings)) throw new TypeError('findings must be an array');
  const deduplicated = distinctFindings(findings);
  const counts = countsFor(deduplicated);
  return { verdict: severityGate(counts), counts };
}

/**
 * @param {{
 *   repo: string,
 *   prNumber: number,
 *   headSha: string,
 *   reviews: Array<{
 *     agent: 'Voka'|'Judge',
 *     headSha: string,
 *     findings: Array<{
 *       key: string,
 *       severity: 'CRITICAL'|'HIGH'|'MEDIUM'|'LOW',
 *       resolved?: boolean,
 *       issue?: {url: string, sourcePr: string, labels: string[]}
 *     }>
 *   }>
 * }} input
 */
export function evaluatePrReviewGate(input) {
  if (!input || typeof input !== 'object') throw new TypeError('input is required');
  const repo = assertString(input.repo, 'repo');
  const headSha = assertString(input.headSha, 'headSha');
  if (!Number.isSafeInteger(input.prNumber) || input.prNumber <= 0) {
    throw new TypeError('prNumber must be a positive integer');
  }
  if (!Array.isArray(input.reviews)) throw new TypeError('reviews must be an array');
  const sourcePr = `https://github.com/${repo}/pull/${input.prNumber}`;

  const reports = new Map();
  for (const report of input.reviews) {
    if (!report || !(report.agent in FINDING_LABELS) || reports.has(report.agent)) {
      throw new TypeError('expected at most one report from each of Voka and Judge');
    }
    if (!Array.isArray(report.findings)) {
      throw new TypeError(`${report.agent}.findings must be an array`);
    }
    reports.set(report.agent, report);
  }

  const missingReports = Object.keys(FINDING_LABELS).filter((name) => !reports.has(name));
  const staleReports = [...reports.values()]
    .filter((report) => report.headSha !== headSha)
    .map((report) => report.agent);
  if (missingReports.length || staleReports.length) {
    return {
      verdict: 'PENDING',
      tracking: 'INCOMPLETE',
      reviewWorkflowReady: false,
      missingReports,
      staleReports,
    };
  }

  const byKey = new Map();
  const agentVerdicts = {};
  for (const [agent, report] of reports) {
    agentVerdicts[agent] = evaluateAgentReview(report.findings).verdict;
    for (const raw of report.findings) {
      const finding = normalizeFinding(raw);
      if (finding.resolved === true) continue;
      let record = byKey.get(finding.key);
      if (!record) {
        record = { ...finding, reporters: new Set(), issues: [] };
        byKey.set(finding.key, record);
      }
      record.reporters.add(agent);
      if (SEVERITY_RANK[finding.severity] > SEVERITY_RANK[record.severity]) {
        record.severity = finding.severity;
      }
      if (finding.issue) record.issues.push(finding.issue);
    }
  }

  const findings = [...byKey.values()];
  const counts = countsFor(findings);
  const verdict = severityGate(counts);
  const missingIssueKeys = [];
  if (verdict === 'PASS') {
    for (const finding of findings) {
      const requiredLabels = [...finding.reporters].map((name) => FINDING_LABELS[name]);
      const tracked = finding.issues.some((issue) =>
        issue
        && typeof issue.url === 'string'
        && /^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/[1-9]\d*$/.test(issue.url)
        && issue.url.startsWith(`https://github.com/${repo}/issues/`)
        && issue.sourcePr === sourcePr
        && Array.isArray(issue.labels)
        && requiredLabels.every((label) => issue.labels.includes(label)),
      );
      if (!tracked) missingIssueKeys.push(finding.key);
    }
  }

  const tracking = verdict === 'FAIL'
    ? 'NOT_REQUIRED_WHILE_BLOCKED'
    : missingIssueKeys.length ? 'INCOMPLETE' : 'COMPLETE';
  return {
    verdict,
    counts,
    agentVerdicts,
    tracking,
    missingIssueKeys,
    reviewWorkflowReady: verdict === 'PASS' && tracking === 'COMPLETE',
  };
}
