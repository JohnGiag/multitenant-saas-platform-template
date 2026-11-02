-- AlterTable
ALTER TABLE "api_keys" ADD COLUMN "scopes" TEXT[];

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN "sandbox_of" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "tenants_sandbox_of_key" ON "tenants"("sandbox_of");

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_sandbox_of_fkey" FOREIGN KEY ("sandbox_of") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
