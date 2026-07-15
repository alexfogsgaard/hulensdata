export function createReport(scope) {
  const issues = [];

  function add(severity, code, message, context = '') {
    issues.push({ severity, code, message, context });
  }

  function blocker(code, message, context = '') {
    add('BLOCKER', code, message, context);
  }

  function warning(code, message, context = '') {
    add('WARNING', code, message, context);
  }

  function info(code, message, context = '') {
    add('INFO', code, message, context);
  }

  function finish() {
    const order = { BLOCKER: 0, WARNING: 1, INFO: 2 };
    issues.sort((a, b) => order[a.severity] - order[b.severity] || a.code.localeCompare(b.code, 'en'));

    for (const issue of issues) {
      const suffix = issue.context ? ` (${issue.context})` : '';
      console.log(`[${issue.severity}] ${issue.code}: ${issue.message}${suffix}`);
    }

    const blockers = issues.filter(issue => issue.severity === 'BLOCKER').length;
    const warnings = issues.filter(issue => issue.severity === 'WARNING').length;
    console.log(`${scope}: ${blockers} blockers · ${warnings} warnings · ${issues.length} fund i alt`);
    if (blockers) process.exitCode = 1;
    return { blockers, warnings, issues };
  }

  return { blocker, warning, info, finish, issues };
}
