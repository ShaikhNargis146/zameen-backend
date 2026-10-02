-- Adds a short grace window to refresh-token rotation. Previously ANY reuse
-- of an already-rotated token — including a client retrying because it
-- never received the (successful) first response to a lost/timed-out
-- connection — revoked the whole session family, forcing a full re-login.
-- replaced_by_session_id links a consumed session to the one that replaced
-- it, so auth.service.js refresh() can tell a same-token retry (the
-- successor is still unused, within the grace window) apart from genuine
-- theft (an older token, outside the window, or whose successor was
-- already used elsewhere) and recover the former by rotating the
-- still-unused successor instead of destroying the family.
ALTER TABLE auth.refresh_sessions
  ADD COLUMN IF NOT EXISTS replaced_by_session_id uuid REFERENCES auth.refresh_sessions(id) ON DELETE SET NULL;
