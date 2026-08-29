# Database migrations

`src/database/schema.sql` is the clean-install database baseline.
`001_canonical_development_upgrade.sql` is the single idempotent upgrade for
an already-created development database. It also replaces the three earlier
development migration ledger entries when it runs.

Once the team freezes a shared staging or production schema, add one reviewed,
forward-only SQL migration per change. Never rewrite or consolidate a migration
that has reached that environment.
