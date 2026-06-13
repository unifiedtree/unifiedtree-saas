import psycopg2
import sys

CONN = "postgresql://postgres:THYqKkKaGSWTkIciCKnpTUkqpbpQdElx@junction.proxy.rlwy.net:22145/railway"

try:
    conn = psycopg2.connect(CONN)
    conn.autocommit = False
    cur = conn.cursor()

    # 1. Inspect: does the column already exist?
    cur.execute("""
        SELECT column_name, data_type
          FROM information_schema.columns
         WHERE table_schema = 'hrms' AND table_name = 'employees'
           AND column_name = 'geo_fence_zone_id'
    """)
    existing = cur.fetchone()
    print("geo_fence_zone_id existing:", existing)

    # 2. Confirm the geo_fence_zones columns we will join on.
    cur.execute("""
        SELECT column_name, data_type
          FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'geo_fence_zones'
           AND column_name IN ('id','latitude','longitude','radius_meters','name','is_active','tenant_id')
         ORDER BY column_name
    """)
    print("geo_fence_zones cols:", cur.fetchall())

    # 3. Additive, safe: nullable column, no default, no rewrite.
    if existing is None:
        cur.execute("ALTER TABLE hrms.employees ADD COLUMN geo_fence_zone_id UUID;")
        print("ADDED hrms.employees.geo_fence_zone_id")
    else:
        print("Column already present — no change.")

    conn.commit()

    # 4. Verify post-state.
    cur.execute("""
        SELECT column_name, data_type, is_nullable
          FROM information_schema.columns
         WHERE table_schema = 'hrms' AND table_name = 'employees'
           AND column_name = 'geo_fence_zone_id'
    """)
    print("post-state:", cur.fetchone())

    cur.close()
    conn.close()
    print("OK")
except Exception as e:
    print(f"Error: {e}")
    sys.exit(1)
