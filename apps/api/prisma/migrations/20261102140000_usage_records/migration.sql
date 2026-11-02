-- CreateTable
CREATE TABLE "usage_records" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "meter" TEXT NOT NULL,
    "period_start" TIMESTAMPTZ(3) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reported_quantity" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "usage_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usage_records_tenant_id_meter_period_start_key" ON "usage_records"("tenant_id", "meter", "period_start");

-- AddForeignKey
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed: the Usage page and its limit banner, in English and Greek

INSERT INTO "translations" ("id", "locale", "key", "value") VALUES
('01a1a003-0000-7c15-8e2a-4d6f1b3a9e00', 'en', 'nav.usage', 'Usage'),
('01a1a003-0001-7c15-8e2a-4d6f1b3a9e01', 'en', 'usage.text', 'What this tenant has used this month, against the quota of its plan.'),
('01a1a003-0002-7c15-8e2a-4d6f1b3a9e02', 'en', 'usage.none', 'Nothing is metered yet.'),
('01a1a003-0003-7c15-8e2a-4d6f1b3a9e03', 'en', 'usage.caption', 'Use of each meter this month'),
('01a1a003-0004-7c15-8e2a-4d6f1b3a9e04', 'en', 'usage.meter', 'Meter'),
('01a1a003-0005-7c15-8e2a-4d6f1b3a9e05', 'en', 'usage.used', 'Used'),
('01a1a003-0006-7c15-8e2a-4d6f1b3a9e06', 'en', 'usage.limit', 'Limit'),
('01a1a003-0007-7c15-8e2a-4d6f1b3a9e07', 'en', 'usage.unlimited', 'No limit'),
('01a1a003-0008-7c15-8e2a-4d6f1b3a9e08', 'en', 'usage.withinLimit', 'Within limit'),
('01a1a003-0009-7c15-8e2a-4d6f1b3a9e09', 'en', 'usage.nearLimit', 'Near the limit'),
('01a1a003-000a-7c15-8e2a-4d6f1b3a9e0a', 'en', 'usage.overLimit', 'Over the limit'),
('01a1a003-000b-7c15-8e2a-4d6f1b3a9e0b', 'en', 'usage.refused', 'Limit reached: requests are refused'),
('01a1a003-000c-7c15-8e2a-4d6f1b3a9e0c', 'en', 'usage.banner', 'You are close to a usage limit, or over one. See the Usage page.'),
('01a1a003-000d-7c15-8e2a-4d6f1b3a9e0d', 'el', 'nav.usage', 'Χρήση'),
('01a1a003-000e-7c15-8e2a-4d6f1b3a9e0e', 'el', 'usage.text', 'Τι έχει χρησιμοποιήσει αυτός ο οργανισμός αυτόν τον μήνα, σε σχέση με το όριο του πλάνου του.'),
('01a1a003-000f-7c15-8e2a-4d6f1b3a9e0f', 'el', 'usage.none', 'Δεν μετριέται τίποτα ακόμη.'),
('01a1a003-0010-7c15-8e2a-4d6f1b3a9e10', 'el', 'usage.caption', 'Χρήση κάθε μετρητή αυτόν τον μήνα'),
('01a1a003-0011-7c15-8e2a-4d6f1b3a9e11', 'el', 'usage.meter', 'Μετρητής'),
('01a1a003-0012-7c15-8e2a-4d6f1b3a9e12', 'el', 'usage.used', 'Χρήση'),
('01a1a003-0013-7c15-8e2a-4d6f1b3a9e13', 'el', 'usage.limit', 'Όριο'),
('01a1a003-0014-7c15-8e2a-4d6f1b3a9e14', 'el', 'usage.unlimited', 'Χωρίς όριο'),
('01a1a003-0015-7c15-8e2a-4d6f1b3a9e15', 'el', 'usage.withinLimit', 'Εντός ορίου'),
('01a1a003-0016-7c15-8e2a-4d6f1b3a9e16', 'el', 'usage.nearLimit', 'Κοντά στο όριο'),
('01a1a003-0017-7c15-8e2a-4d6f1b3a9e17', 'el', 'usage.overLimit', 'Πάνω από το όριο'),
('01a1a003-0018-7c15-8e2a-4d6f1b3a9e18', 'el', 'usage.refused', 'Το όριο εξαντλήθηκε: τα αιτήματα απορρίπτονται'),
('01a1a003-0019-7c15-8e2a-4d6f1b3a9e19', 'el', 'usage.banner', 'Πλησιάζετε ένα όριο χρήσης ή το έχετε ξεπεράσει. Δείτε τη σελίδα Χρήση.');
