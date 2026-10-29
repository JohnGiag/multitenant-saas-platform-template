-- Seed: the Billing page's message once a returning checkout is confirmed, in English and Greek

INSERT INTO "translations" ("id", "locale", "key", "value") VALUES
('01a188e6-71ae-7846-9060-09de0f245bc8', 'en', 'billing.checkoutActive', 'Thank you: your new plan is active.'),
('01a188e6-71af-7f09-9615-583b7cc5ccf9', 'el', 'billing.checkoutActive', 'Ευχαριστούμε: το νέο σας πακέτο είναι ενεργό.');
