# Database migrations

Initial development uses `src/database/schema.sql` as its single database baseline.
There are intentionally no migrations yet.

After the first shared/staging database is established, add one reviewed,
forward-only SQL migration per schema change. Never rewrite or consolidate a
migration that has reached a shared environment.
