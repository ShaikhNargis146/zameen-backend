-- Adds a real consent step to joining an organization. Previously
-- organizations.service.js addMember always inserted a membership row with
-- status = 'ACTIVE' immediately — any OWNER/ADMIN could make any existing
-- user a visible, active member with no opt-in, even though this table's
-- own status enum already included 'INVITED'. A brand-new invite now
-- starts 'INVITED'; the target accepts it themselves via
-- POST /organizations/:id/members/me/accept (organizations.service.js
-- acceptMembership), which is what actually sets joined_at.
--
-- joined_at must therefore be nullable while a row sits INVITED — it no
-- longer means "row created at", it means "actually joined".
ALTER TABLE account.organization_members ALTER COLUMN joined_at DROP NOT NULL;
ALTER TABLE account.organization_members ALTER COLUMN joined_at DROP DEFAULT;
