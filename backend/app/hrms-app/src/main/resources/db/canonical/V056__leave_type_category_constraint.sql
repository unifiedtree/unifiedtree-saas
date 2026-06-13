-- Guard the leave_mgmt.leave_types.category column against invalid values.
--
-- ROOT CAUSE of the empty "Apply for Leave" screen ("No allocations yet", no
-- leave-type tiles): the signup seeder wrote category='PAID', which is NOT a
-- com.hrms.leave.enums.LeaveCategory constant. The column is a plain VARCHAR
-- with no constraint, so the bad value was stored; then Hibernate failed to
-- hydrate the LeaveType entity on read, 500-ing GET /v1/leave/types and
-- /v1/leave/my/balances. The seeder is fixed to use valid categories
-- (EARNED/SICK/CASUAL); this CHECK makes any future bad insert fail fast.
--
-- NOTE: Flyway is DISABLED on Railway production (SPRING_FLYWAY_ENABLED=false);
-- production rows were backfilled manually via psycopg and the same constraint
-- applied there. This migration keeps fresh / local / Testcontainers DBs aligned.

UPDATE leave_mgmt.leave_types SET category = 'EARNED' WHERE category = 'PAID' AND code = 'ANNUAL';
UPDATE leave_mgmt.leave_types SET category = 'SICK'   WHERE category = 'PAID' AND code = 'SICK';
UPDATE leave_mgmt.leave_types SET category = 'CASUAL' WHERE category = 'PAID' AND code = 'CASUAL';
UPDATE leave_mgmt.leave_types SET category = 'EARNED'
 WHERE category IS NOT NULL
   AND category <> ALL (ARRAY['CASUAL','SICK','EARNED','MATERNITY','PATERNITY',
                              'BEREAVEMENT','COMPENSATORY','UNPAID','STUDY','SABBATICAL']::varchar[]);

ALTER TABLE leave_mgmt.leave_types DROP CONSTRAINT IF EXISTS ck_leave_types_category;
ALTER TABLE leave_mgmt.leave_types ADD CONSTRAINT ck_leave_types_category
    CHECK (category IS NULL OR category = ANY (ARRAY['CASUAL','SICK','EARNED','MATERNITY','PATERNITY',
                                                     'BEREAVEMENT','COMPENSATORY','UNPAID','STUDY','SABBATICAL']::varchar[]));
