-- The landing page: cards for billing, webhooks and deployment, and the copy that lists the features

INSERT INTO "translations" ("id", "locale", "key", "value") VALUES
('01a1890d-7bf9-7b45-903b-43705f9f9afa', 'en', 'feature.billing.title', 'Subscription billing'),
('01a1890d-7bfa-7fb1-bae2-8727509039c7', 'en', 'feature.billing.text', 'Stripe Checkout and the Customer Portal set each tenant’s tier. A cancelled plan stays paid until its period ends.'),
('01a1890d-7bfb-7489-8987-aa8004959a92', 'en', 'feature.webhooks.title', 'Outbound webhooks'),
('01a1890d-7bfc-7ee1-a59b-ab406bc25623', 'en', 'feature.webhooks.text', 'Tenant events delivered to their own endpoints, signed with Standard Webhooks, retried for a day, never sent to private networks.'),
('01a1890d-7bfd-780e-8387-325f336427f6', 'en', 'feature.deploy.title', 'Ready to deploy'),
('01a1890d-7bfe-7415-9fda-40e2a988209b', 'en', 'feature.deploy.text', 'Docker images for the API, its migrations and the dashboard, with liveness and readiness probes.'),
('01a1890d-7bff-7e4b-95ba-45cce191b527', 'el', 'feature.billing.title', 'Χρέωση συνδρομών'),
('01a1890d-7c00-741f-ab71-c896dea7e9c3', 'el', 'feature.billing.text', 'Το Stripe Checkout και η Πύλη Πελατών ορίζουν το πακέτο κάθε οργανισμού. Ένα ακυρωμένο πακέτο ισχύει μέχρι το τέλος της περιόδου του.'),
('01a1890d-7c01-75c1-a9e4-456b46c46b68', 'el', 'feature.webhooks.title', 'Εξερχόμενα webhooks'),
('01a1890d-7c02-75e1-9c30-925ea4e26049', 'el', 'feature.webhooks.text', 'Τα συμβάντα κάθε οργανισμού φτάνουν στα δικά του endpoints, υπογεγραμμένα με Standard Webhooks, με επαναλήψεις για μία ημέρα, ποτέ σε ιδιωτικά δίκτυα.'),
('01a1890d-7c03-7059-8c0e-34f0cee14f80', 'el', 'feature.deploy.title', 'Έτοιμο για παραγωγή'),
('01a1890d-7c04-7cd0-892b-c5aaaeea941c', 'el', 'feature.deploy.text', 'Docker images για το API, τα migrations του και τον πίνακα ελέγχου, με ελέγχους liveness και readiness.');

UPDATE "translations" SET "value" = 'Tenancy, auth, roles, API keys, encrypted tenant secrets, rate limiting, jobs, notifications, billing and webhooks — already built, tested and documented. Start on your product on day one.' WHERE "locale" = 'en' AND "key" = 'welcome.text';
UPDATE "translations" SET "value" = 'Billing, webhooks, email, push and file storage are folders. Delete one and the app still compiles; the dashboard hides its pages.' WHERE "locale" = 'en' AND "key" = 'feature.modules.text';
UPDATE "translations" SET "value" = 'Οργανισμοί, αυθεντικοποίηση, ρόλοι, κλειδιά API, κρυπτογραφημένα μυστικά, όρια αιτημάτων, εργασίες, ειδοποιήσεις, χρέωση και webhooks — έτοιμα, ελεγμένα και τεκμηριωμένα. Ξεκινήστε το προϊόν σας από την πρώτη μέρα.' WHERE "locale" = 'el' AND "key" = 'welcome.text';
UPDATE "translations" SET "value" = 'Η χρέωση, τα webhooks, το email, το push και η αποθήκευση αρχείων είναι φάκελοι. Διαγράψτε έναν και η εφαρμογή συνεχίζει να μεταγλωττίζεται· ο πίνακας ελέγχου κρύβει τις σελίδες του.' WHERE "locale" = 'el' AND "key" = 'feature.modules.text';
