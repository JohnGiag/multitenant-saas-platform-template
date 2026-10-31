-- A push token is unique per tenant, so registering one can never move another tenant's row.
DROP INDEX "push_devices_token_key";
CREATE UNIQUE INDEX "push_devices_tenant_id_token_key" ON "push_devices"("tenant_id", "token");

-- When Clerk created the event a name or email came from, so a late older event changes nothing.
ALTER TABLE "tenants" ADD COLUMN "clerk_event_at" TIMESTAMPTZ(3);
ALTER TABLE "users" ADD COLUMN "clerk_event_at" TIMESTAMPTZ(3);
