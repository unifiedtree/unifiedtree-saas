const { Client } = require('pg');

const roleNames = {
  '00000000-0000-0000-0000-000000000001': 'SUPER_ADMIN',
  '00000000-0000-0000-0000-000000000002': 'HR_MANAGER',
  '00000000-0000-0000-0000-000000000003': 'FINANCE_LEAD',
  '00000000-0000-0000-0000-000000000004': 'EMPLOYEE',
  '00000000-0000-0000-0000-000000000005': 'DEPT_MANAGER',
  '00000000-0000-0000-0000-000000000010': 'OWNER',
  '00000000-0000-0000-0000-000000000011': 'ADMIN',
  '00000000-0000-0000-0000-000000000012': 'UNKNOWN_012',
};

// Permissions explicitly revoked by later migrations (DELETE FROM rbac.role_permissions).
// These must be subtracted from migrationDefined to get the correct final intended state.
// Add new entries here whenever a V0xx__*.sql does a DELETE from role_permissions.
const migrationRevoked = new Set([
  '4:hrms.employee.read',  // V051 — PII fix: employees must not enumerate the whole tenant
]);

// All migration-defined (role, permission) pairs extracted from V017, V018, V019, V020,
// V023, V026, V030, V035, V038, V043, V048, V049, V058 migration files
const migrationDefined = new Set([
  // V017 base seeds for all system roles
  '1:hrms.employee.read','1:hrms.department.read','1:hrms.designation.read','1:leave.balance.read','1:leave.request.self','1:attendance.checkin.self',
  '4:hrms.employee.read','4:hrms.department.read','4:hrms.designation.read','4:leave.balance.read','4:leave.request.self','4:attendance.checkin.self',
  '2:hrms.employee.read','2:hrms.department.read','2:hrms.department.write','2:hrms.designation.write','2:org.company.read','2:org.company.write',
  // V018 sensitivity perms
  '1:hrms.employee.profile.read','1:hrms.employee.profile.write','1:hrms.employee.identity.read','1:hrms.employee.identity.write','1:hrms.employee.bank.read','1:hrms.employee.bank.write',
  '2:hrms.employee.profile.read','2:hrms.employee.profile.write','2:hrms.employee.identity.read','2:hrms.employee.identity.write','2:hrms.employee.bank.read','2:hrms.employee.bank.write',
  '5:hrms.employee.profile.read',
  // V019 leave approve
  '1:hrms.leave.approve.l1','1:hrms.leave.approve.l2','2:hrms.leave.approve.l1','2:hrms.leave.approve.l2','5:hrms.leave.approve.l1',
  // V020 onboarding
  '1:hrms.onboarding.template.read','1:hrms.onboarding.template.write','1:hrms.onboarding.instance.read','1:hrms.onboarding.instance.write','1:hrms.onboarding.task.complete',
  '2:hrms.onboarding.template.read','2:hrms.onboarding.template.write','2:hrms.onboarding.instance.read','2:hrms.onboarding.instance.write','2:hrms.onboarding.task.complete',
  '5:hrms.onboarding.instance.read','5:hrms.onboarding.task.complete',
  '4:hrms.letters.read.self','4:hrms.onboarding.task.complete','4:hrms.onboarding.instance.read',
  // V023 reports
  '1:hrms.report.headcount','1:hrms.report.attrition','1:hrms.report.attendance','1:hrms.report.leave','1:hrms.report.diversity',
  '2:hrms.report.headcount','2:hrms.report.attrition','2:hrms.report.attendance','2:hrms.report.leave','2:hrms.report.diversity',
  '3:hrms.report.headcount','3:hrms.report.attrition','3:hrms.report.attendance','3:hrms.report.leave','3:hrms.report.diversity',
  '5:hrms.report.headcount','5:hrms.report.attendance','5:hrms.report.leave',
  // V026 import
  '1:hrms.employee.import','2:hrms.employee.import','3:hrms.employee.import',
  // V030 attendance gap
  '2:attendance.checkin.self','2:attendance.team.read','2:attendance.regularization.approve',
  '3:attendance.checkin.self','3:attendance.team.read','3:attendance.regularization.approve',
  '5:attendance.checkin.self','5:attendance.team.read','5:attendance.regularization.approve',
  '2:leave.request.self','2:leave.balance.read','2:hrms.leave.approve.l1','2:hrms.leave.approve.l2','2:hrms.leave.read','2:hrms.leave.write',
  '3:leave.request.self','3:leave.balance.read','3:hrms.leave.approve.l1','3:hrms.leave.approve.l2','3:hrms.leave.read','3:hrms.leave.write',
  '5:leave.request.self','5:leave.balance.read','5:hrms.leave.read',
  '4:hrms.leave.read',
  // V035 letters
  '1:hrms.letters.template.read','1:hrms.letters.template.create','1:hrms.letters.template.update','1:hrms.letters.template.delete','1:hrms.letters.generate','1:hrms.letters.read','1:hrms.letters.send','1:hrms.letters.void',
  '2:hrms.letters.template.read','2:hrms.letters.template.create','2:hrms.letters.template.update','2:hrms.letters.template.delete','2:hrms.letters.generate','2:hrms.letters.read','2:hrms.letters.send','2:hrms.letters.void',
  '3:hrms.letters.template.read','3:hrms.letters.template.create','3:hrms.letters.template.update','3:hrms.letters.template.delete','3:hrms.letters.generate','3:hrms.letters.read','3:hrms.letters.send','3:hrms.letters.void',
  '5:hrms.letters.template.read','5:hrms.letters.generate','5:hrms.letters.read','5:hrms.letters.send',
  '4:hrms.letters.read.self',
  // V038 invite
  '1:hrms.employee.invite','2:hrms.employee.invite',
  // V043 probation
  '1:hrms.probation.config.read','1:hrms.probation.config.update','1:hrms.probation.reminders.read',
  '2:hrms.probation.config.read','2:hrms.probation.config.update','2:hrms.probation.reminders.read',
  // V048 payroll
  '1:payroll.settings.read','1:payroll.settings.update','1:payroll.components.read','1:payroll.components.manage','1:payroll.structure.read','1:payroll.structure.manage','1:payroll.runs.read','1:payroll.pt_slabs.read',
  '3:payroll.settings.read','3:payroll.settings.update','3:payroll.components.read','3:payroll.components.manage','3:payroll.structure.read','3:payroll.structure.manage','3:payroll.runs.read','3:payroll.pt_slabs.read',
  '2:payroll.settings.read','2:payroll.components.read','2:payroll.structure.read','2:payroll.runs.read','2:payroll.pt_slabs.read',
  '4:payroll.structure.read.self','4:payroll.pt_slabs.read',
  '1:payroll.runs.manage','1:payroll.runs.lock','3:payroll.runs.manage','3:payroll.runs.lock',
  '4:payroll.payslip.read.self',
  // V049 workspace
  '1:workspace.users.read','1:workspace.users.manage',
  '10:workspace.users.read','10:workspace.users.manage',
  '11:workspace.users.read','11:workspace.users.manage',
  // V058 letter distribute
  '1:hrms.letters.distribute','2:hrms.letters.distribute',
]);

async function main() {
  const client = new Client({
    connectionString: 'postgresql://postgres:PDCfIAyzVhxfrEkhYvfpBGzdgqasJnav@thomas.proxy.rlwy.net:29991/railway'
  });
  await client.connect();

  const r = await client.query('SELECT role_id::text, permission_code FROM rbac.role_permissions ORDER BY role_id, permission_code');
  await client.end();

  const dbState = new Set(r.rows.map(row => {
    // parse last UUID segment as decimal (not hex) to match keys in migrationDefined
    const suffix = parseInt(row.role_id.split('-').pop(), 10).toString();
    return suffix + ':' + row.permission_code;
  }));

  // Find what migrations define (net of revokes) but DB is missing
  const missing = [];
  for (const key of migrationDefined) {
    if (migrationRevoked.has(key)) continue; // V0xx explicitly revoked this — not a gap
    if (!dbState.has(key)) {
      const [role, ...parts] = key.split(':');
      const perm = parts.join(':');
      const fullRoleId = '00000000-0000-0000-0000-' + role.padStart(12, '0');
      missing.push({ role: roleNames[fullRoleId] || `role_${role}`, perm });
    }
  }

  console.log('\n=== MISSING from Railway DB (migrations say should exist) ===');
  if (missing.length === 0) {
    console.log('NONE - all migration-defined permissions are present in Railway DB');
  } else {
    missing.forEach(m => console.log(`  MISSING: ${m.role} -> ${m.perm}`));
  }

  // Summary counts by role
  console.log('\n=== Railway DB permission counts by role ===');
  const counts = {};
  for (const row of r.rows) {
    const suffix = parseInt(row.role_id.split('-').pop(), 16).toString();
    const fullId = '00000000-0000-0000-0000-' + suffix.padStart(12, '0');
    const name = roleNames[fullId] || `role_${suffix}`;
    counts[name] = (counts[name] || 0) + 1;
  }
  Object.entries(counts).sort((a,b) => b[1]-a[1]).forEach(([n,c]) => console.log(`  ${n}: ${c}`));
  console.log(`\n  TOTAL in DB: ${r.rows.length}`);
  console.log(`  TOTAL migration-defined: ${migrationDefined.size}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
