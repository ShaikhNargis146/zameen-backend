ALTER TABLE content.investment_interests
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES account.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contact_phone varchar(20),
  ADD COLUMN IF NOT EXISTS contact_email citext;
