ALTER TABLE auth.otp_challenges
  ADD COLUMN IF NOT EXISTS ip_address inet;

CREATE INDEX IF NOT EXISTS idx_auth_otp_ip_created
  ON auth.otp_challenges (ip_address, created_at DESC)
  WHERE ip_address IS NOT NULL;
