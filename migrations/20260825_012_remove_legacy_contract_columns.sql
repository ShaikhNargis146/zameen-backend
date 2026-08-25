-- Reconcile databases that received the earlier broad contract migration before
-- it was narrowed into dedicated migrations.
ALTER TABLE commerce.service_requests
  DROP COLUMN IF EXISTS completed_report_summary;

ALTER TABLE commerce.service_request_files
  DROP CONSTRAINT IF EXISTS service_request_files_file_size_bytes_check;

ALTER TABLE marketplace.site_visits
  DROP CONSTRAINT IF EXISTS site_visits_visitor_count_check,
  ALTER COLUMN preferred_time_slot TYPE varchar(20),
  ALTER COLUMN visitor_count TYPE integer;
