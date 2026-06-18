const { Client } = require('pg');
const crypto = require('crypto');

const TENANT_ID = 'b8110ce6-1d29-492b-845e-3cb7ffb0a320';
const COMPANY_ID = 'cea4943b-8c6c-4050-8767-91bd526e7389';
const ADMIN_ID = '8a8075f1-e813-4727-b780-1df335760356';
const ROLE_MANAGER = '00000000-0000-0000-0000-000000000005';
const ROLE_EMPLOYEE = '00000000-0000-0000-0000-000000000004';
const DEFAULT_HASH = '$2a$10$YbyvZ8ua0T/9tw9fmuujn.Fq4qmc7.tvdzxQvxq89jgyhyC97oM';

const dummyUsers = [
  { id: crypto.randomUUID(), role: ROLE_MANAGER, first: 'Sarah', last: 'Chen', email: 'sarah.chen@src2.com', code: 'EMP-100' },
  { id: crypto.randomUUID(), role: ROLE_MANAGER, first: 'David', last: 'Miller', email: 'david.miller@src2.com', code: 'EMP-101' },
  { id: crypto.randomUUID(), role: ROLE_EMPLOYEE, first: 'Aisha', last: 'Patel', email: 'aisha.patel@src2.com', code: 'EMP-102' },
  { id: crypto.randomUUID(), role: ROLE_EMPLOYEE, first: 'James', last: 'Wilson', email: 'james.wilson@src2.com', code: 'EMP-103' },
  { id: crypto.randomUUID(), role: ROLE_EMPLOYEE, first: 'Elena', last: 'Rodriguez', email: 'elena.rodriguez@src2.com', code: 'EMP-104' },
];

async function main() {
  const client = new Client({
    connectionString: 'postgresql://postgres:PDCfIAyzVhxfrEkhYvfpBGzdgqasJnav@thomas.proxy.rlwy.net:29991/railway'
  });
  await client.connect();
  console.log("Connected to database.");

  try {
    await client.query('BEGIN');
    
    // Insert Users
    for (const u of dummyUsers) {
      // Employees
      await client.query(`
        INSERT INTO hrms.employees (id, tenant_id, company_id, employee_code, first_name, last_name, email, employment_type, employment_status, is_active, created_by, updated_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'FULL_TIME', 'ACTIVE', true, 'seed', 'seed')
        ON CONFLICT (id) DO NOTHING
      `, [u.id, TENANT_ID, COMPANY_ID, u.code, u.first, u.last, u.email]);

      // Credentials
      const credId = crypto.randomUUID();
      await client.query(`
        INSERT INTO auth.user_credentials (id, tenant_id, email, password_hash, employee_id, is_active, failed_login_count, created_by, updated_by)
        VALUES ($1, $2, $3, $4, $5, true, 0, 'seed', 'seed')
      `, [credId, TENANT_ID, u.email, DEFAULT_HASH, u.id]);

      // User roles
      await client.query(`
        INSERT INTO rbac.user_roles (tenant_id, user_id, role_id, granted_by)
        VALUES ($1, $2, $3, $4)
      `, [TENANT_ID, credId, u.role, credId]);
      
      // Wait, is user_id in user_roles the employee_id or the credentials id?
      // Let's look at existing user_roles.
    }

    // Insert attendance for last 10 days for these 5 + admin
    const userIds = [ADMIN_ID, ...dummyUsers.map(u => u.id)];
    const today = new Date('2026-05-26T00:00:00Z');
    
    for (const uid of userIds) {
      for (let i = 0; i < 10; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        
        // Skip Sundays usually, but let's just make it a random attendance.
        const isWeekend = d.getDay() === 0 || d.getDay() === 6;
        if (isWeekend) continue; // no attendance on weekends

        const statusRnd = Math.random();
        let status = 'PRESENT';
        let late = 0;
        let hours = 8.5;
        let cIn = new Date(d);
        cIn.setHours(9, Math.floor(Math.random() * 30), 0);
        
        let cOut = new Date(d);
        cOut.setHours(17, 30 + Math.floor(Math.random() * 60), 0);
        
        if (statusRnd > 0.8) {
          status = 'ON_LEAVE';
          cIn = null;
          cOut = null;
          hours = 0;
        } else if (statusRnd > 0.7) {
          status = 'ABSENT';
          cIn = null;
          cOut = null;
          hours = 0;
        } else if (statusRnd > 0.6) {
          status = 'HALF_DAY';
          cOut.setHours(13, 0, 0);
          hours = 4;
        } else if (statusRnd > 0.4) {
          late = 15 + Math.floor(Math.random() * 45); // 15-60 mins late
          cIn.setMinutes(cIn.getMinutes() + late);
        }

        const recordId = crypto.randomUUID();
        const dateStr = d.toISOString().split('T')[0];

        await client.query(`
          INSERT INTO attendance.records (id, tenant_id, employee_id, attendance_date, check_in_at, check_out_at, attendance_status, manual_entry, late_by_minutes, work_hours, created_by, updated_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8, $9, 'seed', 'seed')
        `, [recordId, TENANT_ID, uid, dateStr, cIn, cOut, status, late > 0 ? late : null, hours]);

        if (cIn) {
          await client.query(`
            INSERT INTO attendance.event_logs (id, tenant_id, employee_id, record_id, event_at, event_date, event_type, created_by, updated_by)
            VALUES ($1, $2, $3, $4, $5, $6, 'CHECK_IN', 'seed', 'seed')
          `, [crypto.randomUUID(), TENANT_ID, uid, recordId, cIn, dateStr]);
        }
        if (cOut) {
          await client.query(`
            INSERT INTO attendance.event_logs (id, tenant_id, employee_id, record_id, event_at, event_date, event_type, created_by, updated_by)
            VALUES ($1, $2, $3, $4, $5, $6, 'CHECK_OUT', 'seed', 'seed')
          `, [crypto.randomUUID(), TENANT_ID, uid, recordId, cOut, dateStr]);
        }
      }
    }

    await client.query('COMMIT');
    console.log("Data seeded successfully!");
  } catch (err) {
    await client.query('ROLLBACK');
    console.error("Error during seeding:", err);
  } finally {
    await client.end();
  }
}

main().catch(console.error);
