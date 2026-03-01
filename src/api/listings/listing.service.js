import db from "../../utils/postgres_store.js";
const ok = data => ({ ok: true, data, error: null });
const fail = error => ({ ok: false, data: null, error });

const ListingService = {
  // Create a new listing
  createListing: async ({ owner, listingData }) => {
    try {
      if (!owner?.id) return fail(new Error("Unauthorized"));

      const columns = Object.keys(listingData).map((k) => k);
      const params = {
        table: 'listing',
        columns: columns,
        values: listingData,
      };
      const response = await db.insertOne(params);
      if (response && response.data)
        return ok(response.data);
      else
        return fail(new Error('Incorrect Data !'));
    } catch (e) {
      return fail(e);
    }
  },

  // Get all listings (with pagination and filters)
  getAllListings: async ({ page = 1, limit = 10, status, land_type }) => {
    try {
      const offset = (page - 1) * limit;

      let query = `SELECT * FROM listing WHERE 1=1`;
      const params = [];
      let paramIndex = 1;

      if (status) {
        query += ` AND status = $${paramIndex}`;
        params.push(status);
        paramIndex++;
      }

      if (land_type) {
        query += ` AND land_type = $${paramIndex}`;
        params.push(land_type);
        paramIndex++;
      }

      query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      params.push(limit, offset);

      const rows = await db.any(query, params);

      const countQuery = `SELECT COUNT(*) as total FROM listing WHERE 1=1${status ? ` AND status = '${status}'` : ""
        }${land_type ? ` AND land_type = '${land_type}'` : ""}`;
      const countResult = (await db.one(countQuery)).data;

      return ok({
        listings: rows?.data || [],
        pagination: {
          page,
          limit,
          total: parseInt(countResult?.total || 0),
          pages: Math.ceil(parseInt(countResult?.total || 0) / limit)
        }
      });
    } catch (e) {
      return fail(e);
    }
  },

  // Get listing by ID
  getListingById: async id => {
    try {
      const row = await db.oneOrNone(`SELECT * FROM listing WHERE id=$1`, [id]);
      if (!row) return fail(new Error("Listing not found"));
      return ok(row?.data || {});
    } catch (e) {
      return fail(e);
    }
  },

  // Get listings by owner
  getListingsByOwner: async ({ userId, page = 1, limit = 10 }) => {
    try {
      const offset = (page - 1) * limit;

      const rows = await db.any(
        `SELECT * FROM listing WHERE owner_user_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
      );

      const countResult = await db.one(
        `SELECT COUNT(*) as total FROM listing WHERE owner_user_id=$1`,
        [userId]
      );

      return ok({
        listings: rows?.data || [],
        pagination: {
          page,
          limit,
          total: parseInt(countResult?.total || 0),
          pages: Math.ceil(parseInt(countResult?.total || 0) / limit)
        }
      });
    } catch (e) {
      return fail(e);
    }
  },

  // Update listing
  updateListing: async ({ id, owner, updateData }) => {
    try {
      
      // Check if listing exists and belongs to owner
      const existing = await db.oneOrNone(
        `SELECT id, owner_user_id, status FROM listing WHERE id=$1`,
        [id]
      );

      if (!existing) return fail(new Error("Listing not found"));
      if (existing.data.owner_user_id !== owner.id) {
        return fail(new Error("Forbidden"));
      }

      const response = await db.updateWhere({
        table: 'listing',
        set: updateData,
        where: 'id = ${id}',
        params: { id },
        returning: '*'
      });
      if (response && response.ok)
        return ok(response.data);
      else
        return fail(new Error('Incorrect Data !'));
    } catch (e) {
      return fail(e);
    }
  },

  // Update listing status
  updateStatus: async ({ id, status, owner }) => {
    try {
      const existing = await db.oneOrNone(
        `SELECT * FROM listing WHERE id=$1`,
        [id]
      );

      if (!existing) return fail(new Error("Listing not found"));

      if (existing.owner_user_id !== owner.id && owner.role !== "admin") {
        return fail(new Error("Forbidden"));
      }
      const published_at =
        status === "live" && !existing.published_at ? new Date() : existing.published_at;

      const updated = await db.one(
        `UPDATE listing SET status=$1, published_at=$2 WHERE id=$3 RETURNING *`,
        [status, published_at, id]
      );

      // Create audit log
      await db.none(
        `INSERT INTO listing_audit (listing_id, actor_user_id, action, before_state, after_state)
         VALUES ($1, $2, 'STATUS_CHANGE', $3, $4)`,
        [
          id,
          owner.id,
          JSON.stringify({ status: existing.status }),
          JSON.stringify({ status })
        ]
      );

      return ok(updated);
    } catch (e) {
      return fail(e);
    }
  }
};

export default ListingService;
