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

  // Get all listings (with pagination and all available filters including geolocation with radius)
  getAllListings: async ({ page = 1, limit = 10, filters = {} } = {}) => {
    try {
      const offset = (page - 1) * limit;
      let query = `SELECT * FROM listing WHERE is_active = true`;
      const params = [];
      const { conditions, params: filterParams, nextParamIndex } = ListingService.buildFilterConditions(filters, 1, true);

      params.push(...filterParams);
      if (conditions.length) {
        query += ` AND ${conditions.join(' AND ')}`;
      }

      query += ` ORDER BY created_at DESC LIMIT $${nextParamIndex} OFFSET $${nextParamIndex + 1}`;
      params.push(limit, offset);

      let countQuery = `SELECT COUNT(*) as total FROM listing WHERE is_active = true`;
      const countParams = [];

      if (conditions.length) {
        countQuery += ` AND ${conditions.join(' AND ')}`;
        countParams.push(...filterParams);
      }

      const [rows, countResult] = await Promise.all([
        db.any(query, params),
        db.one(countQuery, countParams)
      ]);

      const total = parseInt(countResult?.data?.total || 0);

      return ok({
        listings: rows?.data || [],
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      });
    } catch (e) {
      return fail(e);
    }
  },

  // Get listing by ID
  getListingById: async id => {
    try {
      const row = await db.oneOrNone(`SELECT * FROM listing WHERE id=$1 AND is_active = true`, [id]);
      if (!row) return fail(new Error("Listing not found"));
      return ok(row?.data || {});
    } catch (e) {
      return fail(e);
    }
  },

  // Helper function to build filter conditions (with optional geolocation support)
  buildFilterConditions: (filters, startParamIndex = 1, includeGeo = false) => {
    const conditions = [];
    const params = [];
    let paramIndex = startParamIndex;
    const handledKeys = new Set();

    // Handle geolocation filter if enabled
    if (includeGeo) {
      const { latitude, longitude, radius = 10 } = filters; // Default radius: 10km
      const isGeoLocation = latitude !== undefined && longitude !== undefined && latitude !== null && longitude !== null;

      if (isGeoLocation) {
        conditions.push(
          `(6371 * acos(cos(radians($${paramIndex})) * cos(radians(latitude)) * cos(radians(longitude) - radians($${paramIndex + 1})) + sin(radians($${paramIndex})) * sin(radians(latitude)))) <= $${paramIndex + 2}`
        );
        params.push(latitude, longitude, radius);
        paramIndex += 3;
        handledKeys.add('latitude');
        handledKeys.add('longitude');
        handledKeys.add('radius');
      }
    } else {
      handledKeys.add('radius');
    }

    // Process other filters
    for (const [key, value] of Object.entries(filters)) {
      if (value === null || value === undefined || handledKeys.has(key)) continue;
      if (key.endsWith('Min') || key.endsWith('Max')) continue;

      const minKey = `${key}Min`;
      const maxKey = `${key}Max`;
      const hasMin = minKey in filters && filters[minKey] !== null && filters[minKey] !== undefined;
      const hasMax = maxKey in filters && filters[maxKey] !== null && filters[maxKey] !== undefined;

      if (hasMin || hasMax) {
        if (hasMin) {
          conditions.push(`${key} >= $${paramIndex}`);
          params.push(filters[minKey]);
          paramIndex++;
        }
        if (hasMax) {
          conditions.push(`${key} <= $${paramIndex}`);
          params.push(filters[maxKey]);
          paramIndex++;
        }
        handledKeys.add(minKey);
        handledKeys.add(maxKey);
      } else {
        conditions.push(`${key} = $${paramIndex}`);
        params.push(value);
        paramIndex++;
      }
      handledKeys.add(key);
    }

    return { conditions, params, nextParamIndex: paramIndex };
  },

  // Get listings by owner with generic column filters (no radius-based geolocation)
  getListingsByOwner: async ({ userId, page = 1, limit = 10, filters = {} } = {}) => {
    try {
      if (!userId) return fail(new Error("User ID is required"));

      const offset = (page - 1) * limit;
      let query = `SELECT * FROM listing WHERE owner_user_id=$1`;
      const params = [userId];

      const { conditions, params: filterParams, nextParamIndex } = ListingService.buildFilterConditions(filters, 2, false);
      params.push(...filterParams);
      if (conditions.length) {
        query += ` AND ${conditions.join(' AND ')}`;
      }

      query += ` ORDER BY created_at DESC LIMIT $${nextParamIndex} OFFSET $${nextParamIndex + 1}`;
      params.push(limit, offset);

      let countQuery = `SELECT COUNT(*) as total FROM listing WHERE owner_user_id=$1`;
      const countParams = [userId];

      if (conditions.length) {
        countQuery += ` AND ${conditions.join(' AND ')}`;
        countParams.push(...filterParams);
      }

      const [rows, countResult] = await Promise.all([
        db.any(query, params),
        db.one(countQuery, countParams)
      ]);

      const total = parseInt(countResult?.data?.total || 0);

      return ok({
        listings: rows?.data || [],
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      });
    } catch (e) {
      return fail(e);
    }
  },

  // Update listing
  updateListing: async ({ id, owner, updateData }) => {
    try {
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
  updateListingByAdmin: async ({ id, updateData }) => {
    try {
      const existing = await db.oneOrNone(
        `SELECT id, owner_user_id, status FROM listing WHERE id=$1`,
        [id]
      );
      if (!existing) return fail(new Error("Listing not found"));
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
};

export default ListingService;
