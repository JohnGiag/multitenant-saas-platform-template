-- DropIndex
DROP INDEX "api_keys_tenant_id_id_idx";

-- CreateIndex
CREATE INDEX "api_keys_tenant_id_created_at_id_idx" ON "api_keys"("tenant_id", "created_at", "id");
