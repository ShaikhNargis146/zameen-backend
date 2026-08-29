-- Organization membership status: REMOVED (plus INVITED for pending invites)
-- replaces the earlier INACTIVE value application code used for a removed
-- member, matching src/database/schema.sql.
--
-- This is a separate forward migration (not folded into 001) so that
-- databases which already applied 001 before this change still pick it up:
-- db:migrate records applied migrations by filename and skips files it has
-- already run, so editing 001 after it has been applied anywhere would
-- silently strand those databases on the old constraint.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organization_members_status_check'
      AND conrelid = 'account.organization_members'::regclass
      AND pg_get_constraintdef(oid) NOT LIKE '%REMOVED%'
  ) THEN
    ALTER TABLE account.organization_members
      DROP CONSTRAINT organization_members_status_check;
    UPDATE account.organization_members SET status = 'REMOVED' WHERE status = 'INACTIVE';
    ALTER TABLE account.organization_members
      ADD CONSTRAINT organization_members_status_check
        CHECK (status IN ('ACTIVE','INVITED','REMOVED'));
  END IF;
END $$;
