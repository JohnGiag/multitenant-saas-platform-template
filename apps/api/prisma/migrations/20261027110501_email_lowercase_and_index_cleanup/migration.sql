-- DropIndex
DROP INDEX "tenant_integrations_tenant_id_id_idx";

-- Emails are stored lowercase; the unique (tenant_id, email) index is case-sensitive.
ALTER TABLE "users" ADD CONSTRAINT "users_email_lowercase" CHECK ("email" = lower("email"));
