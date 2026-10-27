/*
  Warnings:

  - Added the required column `masked_config` to the `tenant_integrations` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "tenant_integrations" ADD COLUMN     "masked_config" JSONB NOT NULL;
