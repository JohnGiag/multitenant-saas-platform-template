-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 0,
    "rotated_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auth_sessions_tenant_id_user_id_idx" ON "auth_sessions"("tenant_id", "user_id");

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Changing a password now ends every session, this one too
UPDATE "translations" SET "value" = 'Password changed. Sign in again with the new one.' WHERE "locale" = 'en' AND "key" = 'account.passwordChanged';
UPDATE "translations" SET "value" = 'Ο κωδικός πρόσβασης άλλαξε. Συνδεθείτε ξανά με τον νέο.' WHERE "locale" = 'el' AND "key" = 'account.passwordChanged';
