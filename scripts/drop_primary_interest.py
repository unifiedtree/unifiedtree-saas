"""
Drop the primary_interest column from platform.pending_signups.

Client feedback: the field added no signal and made the signup form
longer than it needed to be. Removed from backend DTO, frontend form,
and now the DB column.

Only pending_signups had it. platform.tenants never got a
primary_interest column, so nothing else to touch.

Idempotent — safe to re-run (IF EXISTS).
"""
import subprocess, psycopg2

pw = subprocess.check_output(
    "gcloud secrets versions access latest --secret=POSTGRES_ROOT_PASSWORD --project=unifiedtree-445cd",
    shell=True).decode().strip()

conn = psycopg2.connect(host="127.0.0.1", port=15432, dbname="railway",
                        user="postgres", password=pw, connect_timeout=10)
conn.autocommit = False
cur = conn.cursor()

cur.execute("ALTER TABLE platform.pending_signups DROP COLUMN IF EXISTS primary_interest;")
conn.commit()

print("dropped platform.pending_signups.primary_interest")

# Verify
cur.execute("""
    SELECT column_name FROM information_schema.columns
     WHERE table_schema='platform' AND table_name='pending_signups'
       AND column_name = 'primary_interest';
""")
present = cur.fetchall()
if present:
    print(f"WARN: column still present: {present}")
else:
    print("verified: column absent.")

conn.close()
