-- CreateTable
CREATE TABLE "clerk_deletions" (
    "id" UUID NOT NULL,
    "clerk_id" TEXT NOT NULL,
    "deleted_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "clerk_deletions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clerk_deletions_clerk_id_key" ON "clerk_deletions"("clerk_id");
