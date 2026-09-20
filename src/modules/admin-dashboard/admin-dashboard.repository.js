import { run } from "../../shared/db.js";

export const pendingListings = () =>
  run(
    "one",
    `SELECT count(*)::int AS count FROM marketplace.listings WHERE deleted_at IS NULL AND review_status = 'PENDING'`
  );

export const pendingVerifications = () =>
  run(
    "one",
    `SELECT count(*)::int AS count FROM land.property_verification_checks WHERE status = 'PENDING'`
  );

export const activeUsers = () =>
  run("one", `SELECT count(*)::int AS count FROM auth.users WHERE status = 'ACTIVE'`);

export const requestedServices = () =>
  run(
    "one",
    `SELECT count(*)::int AS count FROM commerce.service_requests WHERE status = 'REQUESTED'`
  );

export const pendingChannelPartners = () =>
  run(
    "one",
    `SELECT count(*)::int AS count FROM account.channel_partner_profiles WHERE status = 'PENDING'`
  );
