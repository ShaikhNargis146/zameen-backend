# Database migrations

`src/database/schema.sql` is the clean-install database baseline. The numbered
migrations bring an already-created canonical database forward safely.

Add one reviewed, forward-only SQL migration per schema change. Never rewrite
or consolidate a migration that has reached a shared environment.
