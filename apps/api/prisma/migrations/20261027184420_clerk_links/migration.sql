-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "clerk_org_id" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "clerk_user_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "tenants_clerk_org_id_key" ON "tenants"("clerk_org_id");

-- CreateIndex
CREATE INDEX "users_clerk_user_id_idx" ON "users"("clerk_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_clerk_user_id_key" ON "users"("tenant_id", "clerk_user_id");

