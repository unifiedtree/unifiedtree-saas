import psycopg2
import sys

try:
    conn = psycopg2.connect("postgresql://postgres:THYqKkKaGSWTkIciCKnpTUkqpbpQdElx@junction.proxy.rlwy.net:22145/railway")
    conn.autocommit = True
    cursor = conn.cursor()
    cursor.execute("TRUNCATE TABLE attendance.face_enrollments CASCADE;")
    print("Successfully truncated face_enrollments and face_embedding_templates.")
    cursor.close()
    conn.close()
except Exception as e:
    print(f"Error: {e}")
    sys.exit(1)
