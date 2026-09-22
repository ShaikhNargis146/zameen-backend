import assert from "node:assert/strict";
import test from "node:test";

import { pg } from "../../src/shared/db.js";
import { transition } from "../../src/modules/channel-partners/channel-partners.service.js";

const withPgStubs = async (stubs, callback) => {
  const originals = {};
  for (const key of Object.keys(stubs)) {
    originals[key] = pg[key];
    pg[key] = stubs[key];
  }
  try {
    await callback();
  } finally {
    for (const key of Object.keys(originals)) pg[key] = originals[key];
  }
};

// transition({ action: "approve" }) is the going-forward half of a broader
// membership-model fix (see migrations/017_channel_partner_membership_backfill.sql
// for the one-time catch-up): every newly-approved channel partner with an
// organizationId must also land as a real ACTIVE account.organization_members
// row, not just a channel_partner_profiles link -- that's what every
// membership-gated check in this codebase actually reads (property/listing
// ownership, org-scoped purchases, an explicit organizationId on an AI
// request). AI quota itself is never auto-pooled from mere membership (see
// ai.service.js#resolveOrganizationContext) -- this membership grant is
// still what makes explicit/resource-based org resolution work correctly
// for a channel partner, same as any other org member.

const buildProfileState = ({ organizationId = "org-1" } = {}) => ({
  userId: "partner-1",
  organizationId,
  reraNumber: "RERA123",
  experienceYears: 5,
  status: "PENDING",
  approvedAt: null
});

// Stubs the whole pg surface transition()+toProfile() touches, tracking
// mutable profile state so the second findByUserId (for `after`) reflects
// setStatus's effect, the way a real UPDATE...SELECT sequence would.
const withChannelPartnerStubs = ({ organizationId, calls }, callback) => {
  const state = buildProfileState({ organizationId });
  return withPgStubs(
    {
      oneOrNone: async (query, params) => {
        if (/FROM account\.channel_partner_profiles cp WHERE cp\.user_id = \$1/.test(query))
          return { ok: true, data: { ...state } };
        if (/UPDATE account\.channel_partner_profiles/.test(query)) {
          calls.setStatus.push(params);
          state.status = params[1];
          return { ok: true, data: { user_id: "partner-1" } };
        }
        throw new Error(`unexpected oneOrNone query: ${query}`);
      },
      none: async (query, params) => {
        if (/INSERT INTO auth\.user_roles/.test(query)) {
          calls.grantRole.push(params);
          return { ok: true, data: null };
        }
        if (/INSERT INTO account\.organization_members/.test(query)) {
          calls.ensureMembership.push(params);
          return { ok: true, data: null };
        }
        if (/DELETE FROM auth\.user_roles/.test(query)) {
          calls.revokeRole.push(params);
          return { ok: true, data: null };
        }
        if (/INSERT INTO ops\.audit_logs/.test(query)) {
          calls.audit.push(params);
          return { ok: true, data: null };
        }
        throw new Error(`unexpected none query: ${query}`);
      },
      any: async () => ({ ok: true, data: [] }) // userSummariesByIds/organizationsByIds/locationsForPartners
    },
    callback
  );
};

const emptyCalls = () => ({ setStatus: [], grantRole: [], ensureMembership: [], revokeRole: [], audit: [] });

test("approving a channel partner with an organizationId also grants real ACTIVE organization membership (role MEMBER)", async () => {
  const calls = emptyCalls();
  await withChannelPartnerStubs({ organizationId: "org-1", calls }, async () => {
    await transition({ partnerId: "partner-1", action: "approve", actorId: "admin-1" });
  });
  assert.equal(calls.ensureMembership.length, 1);
  assert.deepEqual(calls.ensureMembership[0], ["org-1", "partner-1"]);
  assert.equal(calls.grantRole.length, 1);
});

test("approving a channel partner with no organizationId grants the role but never touches organization_members", async () => {
  const calls = emptyCalls();
  await withChannelPartnerStubs({ organizationId: null, calls }, async () => {
    await transition({ partnerId: "partner-1", action: "approve", actorId: "admin-1" });
  });
  assert.equal(calls.ensureMembership.length, 0);
  assert.equal(calls.grantRole.length, 1);
});

test("suspending a channel partner revokes the CHANNEL_PARTNER role but never touches organization_members (org access stays the org admin's own call)", async () => {
  const calls = emptyCalls();
  await withChannelPartnerStubs({ organizationId: "org-1", calls }, async () => {
    // Approve first so the profile is in a suspendable APPROVED state.
    await transition({ partnerId: "partner-1", action: "approve", actorId: "admin-1" });
    calls.ensureMembership.length = 0; // reset -- only care about what suspend itself triggers
    await transition({ partnerId: "partner-1", action: "suspend", actorId: "admin-1" });
  });
  assert.equal(calls.ensureMembership.length, 0);
  assert.equal(calls.revokeRole.length, 1);
});
