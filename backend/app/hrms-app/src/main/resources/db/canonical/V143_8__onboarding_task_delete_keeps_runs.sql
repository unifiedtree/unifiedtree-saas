-- V143.8: removing a task from an onboarding template must not break runs
-- that already started.
--
-- Each onboarding_instance_tasks row copies the template task's title, owner
-- role and required flag when the run starts, so it is self-contained. But
-- task_id was NOT NULL with a plain FK, so deleting a template task that any
-- run had used failed with a foreign-key error (HTTP 500). The link is now
-- cleared instead; the run keeps its copy of the task. Idempotent.

ALTER TABLE hrms.onboarding_instance_tasks ALTER COLUMN task_id DROP NOT NULL;

ALTER TABLE hrms.onboarding_instance_tasks DROP CONSTRAINT IF EXISTS onboarding_instance_tasks_task_id_fkey;
ALTER TABLE hrms.onboarding_instance_tasks
    ADD CONSTRAINT onboarding_instance_tasks_task_id_fkey
    FOREIGN KEY (task_id) REFERENCES hrms.onboarding_tasks(id) ON DELETE SET NULL;
