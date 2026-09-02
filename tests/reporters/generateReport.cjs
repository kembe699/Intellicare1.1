#!/usr/bin/env node
/**
 * IntelliCare Test Report Generator
 * Reads test-report.json and produces HTML + CSV reports.
 *
 * Usage: node tests/reporters/generateReport.js
 */
const fs = require('fs');
const path = require('path');

const JSON_PATH = path.resolve(__dirname, '..', 'test-report.json');
const HTML_PATH = path.resolve(__dirname, '..', 'test-report.html');
const CSV_PATH  = path.resolve(__dirname, '..', 'test-report.csv');

if (!fs.existsSync(JSON_PATH)) {
  console.error('❌ test-report.json not found. Run tests first: npm run test:all');
  process.exit(1);
}

const report = JSON.parse(fs.readFileSync(JSON_PATH, 'utf-8'));
const ts = new Date(report.timestamp).toLocaleString();

// ─── CSV ────────────────────────────────────────────────────
const csvRows = [
  ['Module', 'Tests', 'Passed', 'Failed', 'Skipped', 'PassRate', 'Duration(ms)'],
  ...report.modules.map(m => [m.name, m.tests, m.passed, m.failed, m.skipped || 0, `${m.passRate}%`, m.duration]),
  ['TOTAL', report.totalTests, report.passed, report.failed, report.skipped, `${report.passRate}%`, report.duration],
];
fs.writeFileSync(CSV_PATH, csvRows.map(r => r.join(',')).join('\n'));
console.log(`✅ CSV report: ${CSV_PATH}`);

// ─── HTML ───────────────────────────────────────────────────
const statusEmoji = report.passRate >= 95 ? '✅' : report.passRate >= 80 ? '⚠️' : '❌';
const statusText  = report.passRate >= 95 ? 'READY FOR STAGING' : report.passRate >= 80 ? 'NEEDS FIXES' : 'CRITICAL ISSUES';
const statusColor = report.passRate >= 95 ? '#10b981' : report.passRate >= 80 ? '#f59e0b' : '#ef4444';

const moduleRows = report.modules.map(m => {
  const icon = m.failed === 0 ? '✅' : '❌';
  const barWidth = m.passRate;
  const barColor = m.passRate >= 95 ? '#10b981' : m.passRate >= 80 ? '#f59e0b' : '#ef4444';
  return `<tr>
    <td>${icon} ${m.name}</td>
    <td class="num">${m.tests}</td>
    <td class="num" style="color:#10b981">${m.passed}</td>
    <td class="num" style="color:${m.failed > 0 ? '#ef4444' : '#888'}">${m.failed}</td>
    <td class="num">${m.passRate}%</td>
    <td>
      <div class="bar-bg"><div class="bar" style="width:${barWidth}%;background:${barColor}"></div></div>
    </td>
    <td class="num">${m.duration}ms</td>
  </tr>`;
}).join('\n');

const errorRows = report.errors.length === 0
  ? '<tr><td colspan="4" style="text-align:center;color:#888;padding:24px">No errors detected 🎉</td></tr>'
  : report.errors.map(e => {
    const sevColor = e.severity === 'critical' ? '#ef4444' : e.severity === 'high' ? '#f97316' : e.severity === 'medium' ? '#f59e0b' : '#6b7280';
    return `<tr>
      <td><span class="badge" style="background:${sevColor}">${e.severity.toUpperCase()}</span></td>
      <td>${e.module}</td>
      <td>${e.test}</td>
      <td class="err-msg">${e.error}</td>
    </tr>`;
  }).join('\n');

const recItems = report.recommendations.map(r => `<li>${r}</li>`).join('\n');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>IntelliCare Test Report</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; color: #1e293b; padding: 24px; }
  .container { max-width: 1100px; margin: 0 auto; }
  h1 { font-size: 28px; margin-bottom: 4px; }
  .subtitle { color: #64748b; font-size: 14px; margin-bottom: 24px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 28px; }
  .card { background: #fff; border-radius: 12px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .card .label { font-size: 11px; text-transform: uppercase; letter-spacing: .5px; color: #94a3b8; margin-bottom: 6px; }
  .card .value { font-size: 32px; font-weight: 700; }
  .card .sub { font-size: 12px; color: #94a3b8; margin-top: 2px; }
  .section { background: #fff; border-radius: 12px; padding: 20px 24px; box-shadow: 0 1px 3px rgba(0,0,0,.08); margin-bottom: 24px; }
  .section h2 { font-size: 16px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; font-weight: 600; color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; padding: 10px 12px; border-bottom: 2px solid #e2e8f0; }
  td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .bar-bg { background: #f1f5f9; border-radius: 4px; height: 8px; width: 100%; min-width: 80px; }
  .bar { height: 8px; border-radius: 4px; transition: width .3s; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; color: #fff; font-size: 10px; font-weight: 700; letter-spacing: .5px; }
  .err-msg { font-size: 11px; color: #64748b; max-width: 400px; word-break: break-word; }
  .status-banner { text-align: center; padding: 16px; border-radius: 12px; margin-bottom: 24px; font-weight: 700; font-size: 18px; }
  .rec-list { padding-left: 20px; }
  .rec-list li { margin-bottom: 8px; font-size: 14px; }
  .footer { text-align: center; color: #94a3b8; font-size: 12px; margin-top: 32px; }
</style>
</head>
<body>
<div class="container">
  <h1>🏥 IntelliCare Test Report</h1>
  <p class="subtitle">Generated: ${ts} &bull; Duration: ${(report.duration / 1000).toFixed(1)}s</p>

  <div class="status-banner" style="background:${statusColor}20;color:${statusColor};border:2px solid ${statusColor}">
    ${statusEmoji} OVERALL: ${statusText} &mdash; Pass Rate: ${report.passRate}%
  </div>

  <div class="cards">
    <div class="card">
      <div class="label">Total Tests</div>
      <div class="value">${report.totalTests}</div>
    </div>
    <div class="card">
      <div class="label">Passed</div>
      <div class="value" style="color:#10b981">${report.passed}</div>
    </div>
    <div class="card">
      <div class="label">Failed</div>
      <div class="value" style="color:${report.failed > 0 ? '#ef4444' : '#888'}">${report.failed}</div>
    </div>
    <div class="card">
      <div class="label">Pass Rate</div>
      <div class="value">${report.passRate}%</div>
      <div class="sub">${report.passRate >= 95 ? 'Above 95% threshold' : 'Below 95% threshold'}</div>
    </div>
  </div>

  <div class="section">
    <h2>📋 Module Results</h2>
    <table>
      <thead>
        <tr><th>Module</th><th class="num">Tests</th><th class="num">Passed</th><th class="num">Failed</th><th class="num">Rate</th><th>Progress</th><th class="num">Time</th></tr>
      </thead>
      <tbody>
        ${moduleRows}
      </tbody>
    </table>
  </div>

  <div class="section">
    <h2>⚠️ Errors Detected (${report.errors.length})</h2>
    <table>
      <thead>
        <tr><th>Severity</th><th>Module</th><th>Test</th><th>Error</th></tr>
      </thead>
      <tbody>
        ${errorRows}
      </tbody>
    </table>
  </div>

  <div class="section">
    <h2>💡 Recommendations</h2>
    <ul class="rec-list">
      ${recItems}
    </ul>
  </div>

  <div class="footer">
    IntelliCare &mdash; Intelligent Care for Every Patient &bull; Test Suite v1.0
  </div>
</div>
</body>
</html>`;

fs.writeFileSync(HTML_PATH, html);
console.log(`✅ HTML report: ${HTML_PATH}`);
console.log(`\n📊 Report Summary: ${report.passed}/${report.totalTests} passed (${report.passRate}%) in ${(report.duration/1000).toFixed(1)}s`);
