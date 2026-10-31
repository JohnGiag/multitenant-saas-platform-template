-- The landing page: cards for feature flags and observability, and the copy that lists the features

INSERT INTO "translations" ("id", "locale", "key", "value") VALUES
('01a1a001-0000-7a31-8c02-5d1e7f3b9a10', 'en', 'feature.flags.title', 'Per-tenant feature flags'),
('01a1a001-0001-7b42-9d13-6e2f803caa21', 'en', 'feature.flags.text', 'Each module sets which plans get a feature, and the platform can override it per tenant. One decorator checks it, and changes apply at once.'),
('01a1a001-0002-7c53-ae24-7f30914dbb32', 'en', 'feature.observability.title', 'Observability'),
('01a1a001-0003-7d64-bf35-804aa25ecc43', 'en', 'feature.observability.text', 'Optional OpenTelemetry traces, metrics and logs, for any OTLP backend. An allowlist keeps secrets and personal data out, and a local Grafana stack starts with one command.'),
('01a1a001-0004-7e75-8046-915bb36fdd54', 'el', 'feature.flags.title', 'Feature flags ανά οργανισμό'),
('01a1a001-0005-7f86-9157-a26cc470ee65', 'el', 'feature.flags.text', 'Κάθε module ορίζει ποια πακέτα έχουν μια λειτουργία, και η πλατφόρμα μπορεί να το αλλάξει ανά οργανισμό. Ελέγχεται με έναν decorator, και οι αλλαγές ισχύουν αμέσως.'),
('01a1a001-0006-7097-a268-b37dd581ff76', 'el', 'feature.observability.title', 'Παρατηρησιμότητα'),
('01a1a001-0007-71a8-b379-c48ee6920087', 'el', 'feature.observability.text', 'Προαιρετικά traces, μετρικές και logs με OpenTelemetry, για οποιοδήποτε OTLP backend. Μια λίστα επιτρεπόμενων κρατά έξω τα μυστικά και τα προσωπικά δεδομένα, και μια τοπική στοίβα Grafana ξεκινά με μία εντολή.');

UPDATE "translations" SET "value" = 'Tenancy, auth, roles, API keys, encrypted tenant secrets, rate limiting, jobs, notifications, billing, webhooks, feature flags and observability — already built, tested and documented. Start on your product on day one.' WHERE "locale" = 'en' AND "key" = 'welcome.text';
UPDATE "translations" SET "value" = 'Οργανισμοί, αυθεντικοποίηση, ρόλοι, κλειδιά API, κρυπτογραφημένα μυστικά, όρια αιτημάτων, εργασίες, ειδοποιήσεις, χρέωση, webhooks, feature flags και παρατηρησιμότητα — έτοιμα, ελεγμένα και τεκμηριωμένα. Ξεκινήστε το προϊόν σας από την πρώτη μέρα.' WHERE "locale" = 'el' AND "key" = 'welcome.text';
