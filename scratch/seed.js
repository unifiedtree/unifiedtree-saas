const { Client } = require('pg');
const crypto = require('crypto');

async function main() {
  const client = new Client({
    connectionString: 'postgresql://postgres:THYqKkKaGSWTkIciCKnpTUkqpbpQdElx@junction.proxy.rlwy.net:22145/railway'
  });
  await client.connect();

  const tenantId = 'b8110ce6-1d29-492b-845e-3cb7ffb0a320';
  const companyId = 'cea4943b-8c6c-4050-8767-91bd526e7389';
  
  const employees = [
    '8a8075f1-e813-4727-b780-1df335760356', // Chakri (Admin)
    '762d3c8d-48e5-4661-94bc-ab4dc087c93b', // Sarah
    'b229a2ef-6312-4f43-bdec-b6aa5efccc68', // David
    'e79f3d17-0c95-4195-b2b3-3b394c9a80d6', // Aisha
    '6c83d656-0b38-48ae-82ea-3a64a47f173a', // James
    '7296fd46-831c-46fb-9ee6-fb792bf3b6b5'  // Elena
  ];

  const now = new Date();
  
  console.log("Seeding attendance records for the last 10 days...");
  
  for (let i = 0; i <= 10; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    // skip weekends
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    
    for (const empId of employees) {
      // Create a checkin around 9 AM and checkout around 6 PM
      const inMinutesDelta = Math.floor(Math.random() * 30) - 10; // -10 to +20 mins
      const outMinutesDelta = Math.floor(Math.random() * 60); // 0 to 60 mins
      
      const checkInTime = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9, inMinutesDelta, 0);
      const checkOutTime = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 18, outMinutesDelta, 0);
      
      const workHours = (checkOutTime - checkInTime) / (1000 * 60 * 60);
      const lateBy = inMinutesDelta > 0 ? inMinutesDelta : 0;
      
      const status = lateBy > 0 ? 'LATE' : 'PRESENT';
      
      const insertQuery = `
        INSERT INTO attendance.records (
          id, tenant_id, company_id, employee_id, attendance_date,
          check_in_at, check_out_at, attendance_type, attendance_status,
          check_in_method, check_out_method, work_hours, late_by_minutes,
          created_at, updated_at, version, manual_entry, is_regularized,
          check_in_location_name, check_out_location_name,
          check_in_latitude, check_in_longitude
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 0, false, false,
          'Headquarters', 'Headquarters', 17.4474, 78.3762
        )
      `;
      
      try {
        await client.query(insertQuery, [
          crypto.randomUUID(), tenantId, companyId, empId, dateStr,
          checkInTime.toISOString(), checkOutTime.toISOString(),
          'OFFICE', status, 'FACE_RECOGNITION', 'MOBILE_GPS',
          workHours, lateBy, new Date().toISOString(), new Date().toISOString()
        ]);
      } catch (err) {
        // If there's a unique constraint violation (already inserted), ignore it
        if (err.code !== '23505') {
          console.error(`Failed inserting for ${empId} on ${dateStr}`, err.message);
        }
      }
    }
  }

  console.log("Seeding complete.");
  await client.end();
}

main().catch(console.error);
