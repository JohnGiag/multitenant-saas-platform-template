-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_actor_id_created_at_id_idx" ON "audit_logs"("tenant_id", "actor_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_target_id_created_at_id_idx" ON "audit_logs"("tenant_id", "target_id", "created_at", "id");
