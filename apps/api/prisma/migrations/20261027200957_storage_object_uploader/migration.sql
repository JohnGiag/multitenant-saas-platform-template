/*
  Warnings:

  - Added the required column `uploader_id` to the `storage_objects` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "storage_objects" ADD COLUMN     "uploader_id" UUID NOT NULL;
