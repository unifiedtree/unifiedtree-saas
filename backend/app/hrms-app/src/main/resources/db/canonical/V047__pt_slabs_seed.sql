-- ============================================================================
-- V047 - Professional Tax slabs (FY 2024-25), state-wise reference data.
-- Delhi/UP/Haryana/Punjab do NOT levy PT — intentionally absent.
-- ============================================================================
INSERT INTO payroll.pt_slabs (state_code, state_name, min_salary, max_salary, monthly_tax, effective_from) VALUES
    ('KA', 'Karnataka',      0,      25000,  0,    '2024-04-01'),
    ('KA', 'Karnataka',      25001,  NULL,   200,  '2024-04-01'),

    ('MH', 'Maharashtra',    0,      7500,   0,    '2024-04-01'),
    ('MH', 'Maharashtra',    7501,   10000,  175,  '2024-04-01'),
    ('MH', 'Maharashtra',    10001,  NULL,   200,  '2024-04-01'),

    ('TN', 'Tamil Nadu',     0,      21000,  0,    '2024-04-01'),
    ('TN', 'Tamil Nadu',     21001,  30000,  135,  '2024-04-01'),
    ('TN', 'Tamil Nadu',     30001,  45000,  315,  '2024-04-01'),
    ('TN', 'Tamil Nadu',     45001,  60000,  690,  '2024-04-01'),
    ('TN', 'Tamil Nadu',     60001,  75000,  1025, '2024-04-01'),
    ('TN', 'Tamil Nadu',     75001,  NULL,   1250, '2024-04-01'),

    ('TS', 'Telangana',      0,      15000,  0,    '2024-04-01'),
    ('TS', 'Telangana',      15001,  20000,  150,  '2024-04-01'),
    ('TS', 'Telangana',      20001,  NULL,   200,  '2024-04-01'),

    ('AP', 'Andhra Pradesh', 0,      15000,  0,    '2024-04-01'),
    ('AP', 'Andhra Pradesh', 15001,  20000,  150,  '2024-04-01'),
    ('AP', 'Andhra Pradesh', 20001,  NULL,   200,  '2024-04-01'),

    ('WB', 'West Bengal',    0,      10000,  0,    '2024-04-01'),
    ('WB', 'West Bengal',    10001,  15000,  110,  '2024-04-01'),
    ('WB', 'West Bengal',    15001,  25000,  130,  '2024-04-01'),
    ('WB', 'West Bengal',    25001,  40000,  150,  '2024-04-01'),
    ('WB', 'West Bengal',    40001,  NULL,   200,  '2024-04-01'),

    ('GJ', 'Gujarat',        0,      12000,  0,    '2024-04-01'),
    ('GJ', 'Gujarat',        12001,  NULL,   200,  '2024-04-01'),

    ('KL', 'Kerala',         0,      1999,   0,    '2024-04-01'),
    ('KL', 'Kerala',         2000,   2999,   20,   '2024-04-01'),
    ('KL', 'Kerala',         3000,   4999,   30,   '2024-04-01'),
    ('KL', 'Kerala',         5000,   7499,   50,   '2024-04-01'),
    ('KL', 'Kerala',         7500,   9999,   75,   '2024-04-01'),
    ('KL', 'Kerala',         10000,  12499,  100,  '2024-04-01'),
    ('KL', 'Kerala',         12500,  16666,  125,  '2024-04-01'),
    ('KL', 'Kerala',         16667,  20833,  166,  '2024-04-01'),
    ('KL', 'Kerala',         20834,  NULL,   208,  '2024-04-01')
ON CONFLICT (state_code, min_salary, effective_from) DO NOTHING;

DO $$ DECLARE c INT;
BEGIN
    SELECT count(*) INTO c FROM payroll.pt_slabs WHERE state_code='KA';
    RAISE NOTICE 'PT slabs for KA: % (expect 2)', c;
END $$;
