/**
 * Custom Jest reporter that collects results into a JSON file
 * for the report generator to consume.
 */
class JsonReporter {
  constructor(globalConfig, options) {
    this._globalConfig = globalConfig;
    this._options = options;
  }

  onRunComplete(contexts, results) {
    const fs = require('fs');
    const path = require('path');

    const report = {
      timestamp: new Date().toISOString(),
      totalTests: results.numTotalTests,
      passed: results.numPassedTests,
      failed: results.numFailedTests,
      skipped: results.numPendingTests,
      passRate: results.numTotalTests > 0
        ? parseFloat(((results.numPassedTests / results.numTotalTests) * 100).toFixed(1))
        : 0,
      duration: Date.now() - results.startTime,
      success: results.success,
      modules: [],
      errors: [],
      recommendations: [],
    };

    for (const suite of results.testResults) {
      const suiteName = path.basename(suite.testFilePath);
      const passed = suite.numPassingTests;
      const failed = suite.numFailingTests;
      const total = passed + failed + suite.numPendingTests;
      const passRate = total > 0 ? parseFloat(((passed / total) * 100).toFixed(1)) : 0;

      report.modules.push({
        name: suiteName,
        tests: total,
        passed,
        failed,
        skipped: suite.numPendingTests,
        passRate,
        duration: suite.perfStats ? suite.perfStats.end - suite.perfStats.start : 0,
      });

      // Collect errors
      for (const testResult of suite.testResults) {
        if (testResult.status === 'failed') {
          for (const msg of testResult.failureMessages) {
            const severity = msg.includes('CRITICAL') ? 'critical'
              : msg.includes('timeout') || msg.includes('performance') ? 'low'
              : failed > 2 ? 'high' : 'medium';

            report.errors.push({
              module: suiteName,
              test: testResult.fullName,
              error: msg.split('\n')[0].substring(0, 200),
              severity,
            });
          }
        }
      }
    }

    // Generate recommendations based on errors
    const errorModules = [...new Set(report.errors.map(e => e.module))];
    if (report.errors.some(e => e.severity === 'critical' || e.severity === 'high')) {
      report.recommendations.push('Fix critical/high severity test failures before deployment');
    }
    if (errorModules.includes('dataIntegrity.test.js')) {
      report.recommendations.push('Review data integrity issues – check FK constraints and NULL values');
    }
    if (errorModules.includes('performance.test.js')) {
      report.recommendations.push('Optimize slow queries – consider adding database indexes');
    }
    if (report.passRate >= 95) {
      report.recommendations.push('Pass rate is above 95% – system is ready for staging');
    } else if (report.passRate >= 80) {
      report.recommendations.push('Pass rate is between 80-95% – fix failures before staging');
    } else {
      report.recommendations.push('Pass rate is below 80% – significant issues need resolution');
    }

    // Write JSON
    const outDir = path.resolve(__dirname, '..');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(outDir, 'test-report.json'),
      JSON.stringify(report, null, 2)
    );
    console.log(`\n📊 JSON report written to tests/test-report.json`);
  }
}

module.exports = JsonReporter;
