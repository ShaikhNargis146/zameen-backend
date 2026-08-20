ALTER TABLE commerce.service_requests
  ADD COLUMN IF NOT EXISTS contact_phone varchar(20),
  ADD COLUMN IF NOT EXISTS contact_email citext,
  ADD COLUMN IF NOT EXISTS report_summary text;

ALTER TABLE commerce.service_request_files
  ADD COLUMN IF NOT EXISTS mime_type varchar(100),
  ADD COLUMN IF NOT EXISTS file_size_bytes bigint;

UPDATE commerce.service_request_files
  SET mime_type = COALESCE(mime_type, 'application/octet-stream'),
      file_size_bytes = COALESCE(file_size_bytes, 1);

ALTER TABLE commerce.service_request_files
  ALTER COLUMN mime_type SET NOT NULL,
  ALTER COLUMN file_size_bytes SET NOT NULL,
  ADD CONSTRAINT chk_commerce_service_request_files_size CHECK (file_size_bytes > 0);
