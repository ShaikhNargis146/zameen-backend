import { uploadBufferToGCS, getSignedReadUrl } from "../../utils/gcs.js";
import db from "../../utils/postgres_store.js";
import pgPromise from "pg-promise";

const pgp = pgPromise({
  capSQL: true
});

const ok = data => ({ ok: true, data, error: null });
const fail = error => ({ ok: false, data: null, error });

// Helper function to determine media_type from mimetype
const getMediaType = (mimetype) => {
  if (!mimetype) return "image";
  if (mimetype.startsWith("video/")) return "video";
  if (mimetype.startsWith("image/")) return "image";
  return "document";
};

// Helper function to get next sort_order for a listing
const getNextSortOrder = async (listing_id) => {
  try {
    const query = `
      SELECT COALESCE(MAX(sort_order), -1) + 1 as next_sort_order
      FROM listing_media
      WHERE listing_id = $1
    `;
    const result = await db.one(query, [listing_id]);
    return result?.next_sort_order || 0;
  } catch (e) {
    console.error("[MediaService] getNextSortOrder error:", e);
    return 0;
  }
};

// Helper function to save media record to database
const saveMediaToDatabase = async ({ listing_id, bucket, objectPath, filename, mimetype, sort_order = 0, meta = {} }) => {
  try {
    const url = `https://storage.googleapis.com/${bucket}/${objectPath}`;
    const mediaData = {
      listing_id,
      media_type:getMediaType(mimetype),
      url,
      caption: null,
      sort_order,
      meta: JSON.stringify({
        original_name: filename,
        mimetype,
        gcs_path: objectPath,
        ...meta
      })
    };

    const result = await db.insertOne({
      table: "listing_media",
      values: mediaData,
      columns: Object.keys(mediaData),
      returning: "*",
      jsonbCols: ["meta"]
    });

    return result;
  } catch (e) {
    console.error("[MediaService] saveMediaToDatabase error:", e);
    throw e;
  }
};

const MediaService = {
  // Upload single file to GCS and save metadata
  uploadSingleFile: async ({ file, listingId, bucketName }) => {
    try {
      if (!file) {
        return fail(new Error("FILE_REQUIRED"));
      }

      if (!listingId) {
        return fail(new Error("LISTING_ID_REQUIRED"));
      }

      // Upload to GCS
      const gcsResult = await uploadBufferToGCS({
        bucketName,
        buffer: file.buffer,
        contentType: file.mimetype,
        originalName: file.originalname,
        instrument_version_id: listingId+"_"+file.originalname
      });
      if (!gcsResult || !gcsResult.objectPath) {
        return fail(new Error("GCS_UPLOAD_FAILED"));
      }

      // Get next sort_order for this listing
      const sortOrder = await getNextSortOrder(listingId);

      // Save metadata to database
      const dbResult = await saveMediaToDatabase({
        listing_id: listingId,
        bucket: gcsResult.bucket,
        objectPath: gcsResult.objectPath,
        filename: file.originalname,
        mimetype: file.mimetype,
        sort_order: sortOrder,
        meta: {
          size: file.size,
          sha256: gcsResult.sha256
        }
      });

      if (!dbResult.ok) {
        return fail(dbResult.error);
      }

      return ok(dbResult.data);
    } catch (e) {
      console.error("[MediaService] uploadSingleFile error:", e);
      return fail(e);
    }
  },

  // Upload multiple files to GCS and save metadata
  uploadMultipleFiles: async ({ files, listingId, bucketName }) => {
    try {
      if (!files || files.length === 0) {
        return fail(new Error("FILES_REQUIRED"));
      }

      if (!listingId) {
        return fail(new Error("LISTING_ID_REQUIRED"));
      }

      // Upload all files to GCS
      const uploadPromises = files.map(file =>
        uploadBufferToGCS({
          bucketName,
          buffer: file.buffer,
          contentType: file.mimetype,
          originalName: file.originalname,
          instrument_version_id: listingId+"_"+file.originalname
        }).then(gcsResult => ({
          file,
          gcsResult
        }))
      );

      const uploadResults = await Promise.all(uploadPromises);

      if(!uploadResults || uploadResults.some(r => !r.gcsResult || !r.gcsResult.objectPath)) {
        return fail(new Error("GCS_UPLOAD_FAILED"));
      }
      let nextSortOrder = await getNextSortOrder(listingId);
      const dbPromises = uploadResults.map(({ file, gcsResult }) => {
        const sortOrder = nextSortOrder++;
        return saveMediaToDatabase({
          listing_id: listingId,
          bucket: gcsResult.bucket,
          objectPath: gcsResult.objectPath,
          filename: file.originalname,
          mimetype: file.mimetype,
          sort_order: sortOrder,
          meta: {
            size: file.size,
            sha256: gcsResult.sha256
          }
        });
      });

      const dbResults = await Promise.all(dbPromises);

      // Check for any database errors
      const errors = dbResults.filter(r => !r.ok);
      if (errors.length > 0) {
        return fail(new Error(`Failed to save ${errors.length} file(s) to database`));
      }

      // Return all saved records
      const savedRecords = dbResults.map(r => r.data);
      return ok(savedRecords);
    } catch (e) {
      console.error("[MediaService] uploadMultipleFiles error:", e);
      return fail(e);
    }
  },

  // Retrieve all media for a listing
  getListingMedia: async ({ listingId }) => {
    try {
      if (!listingId) {
        return fail(new Error("LISTING_ID_REQUIRED"));
      }

      // Fetch all media for this listing ordered by sort_order
      const query = `
        SELECT id, listing_id, media_type, url, thumb_url, caption, sort_order, meta, created_at
        FROM listing_media
        WHERE listing_id = $1
        ORDER BY sort_order ASC
      `;
      const mediaRecords = await db.any(query, [listingId]);
      console.log("[MediaService] getListingMedia fetched records:", mediaRecords,);

      if (!mediaRecords || mediaRecords?.data?.length === 0) {
        return fail(new Error("NO_MEDIA_FOUND"));
      }
    
      // Generate signed URLs for all media records
      const mediaWithSignedUrls = await Promise.all(
        mediaRecords.data.map(async (media) => {
          try {
            const meta = typeof media.meta === 'string' ? JSON.parse(media.meta) : media.meta;
            const objectPath = meta?.gcs_path;

            if (objectPath) {
              const media_type = getMediaType(meta?.mimetype);
              const url = await getSignedReadUrl({
                bucket: process.env.GCS_BUCKET,
                objectPath,
                expiresInMinutes: 60 * 24 * 7,
                mediaType: media_type
              });
              return { ...media, url };
            }
            return media;
          } catch (e) {
            console.error("[MediaService] Error generating signed URL for media", media.id, e);
            return media;
          }
        })
      );

      return ok(mediaWithSignedUrls);
    } catch (e) {
      console.error("[MediaService] getListingMedia error:", e);
      return fail(e);
    }
  },

  // Retrieve single media by ID
  getMediaById: async ({ mediaId }) => {
    try {
      if (!mediaId) {
        return fail(new Error("MEDIA_ID_REQUIRED"));
      }

      const query = `
        SELECT id, listing_id, media_type, url, thumb_url, caption, sort_order, meta, created_at
        FROM listing_media
        WHERE id = $1
      `;
      const media = await db.one(query, [mediaId]);

      if (!media || !media.data) {
        return fail(new Error("MEDIA_NOT_FOUND"));
      }

      // Generate signed URL for the media
      try {
        const meta = typeof media.data.meta === 'string' ? JSON.parse(media.data.meta) : media.data.meta;
        const objectPath = meta?.gcs_path;

        if (objectPath) {
          const media_type = getMediaType(meta?.mimetype);
          const url = await getSignedReadUrl({
            bucket: process.env.GCS_BUCKET,
            objectPath,
            expiresInMinutes: 60 * 24 * 7,
            mediaType: media_type
          });
          media.data.url = url;
        }
      } catch (e) {
        console.error("[MediaService] Error generating signed URL for media", mediaId, e);
      }

      return ok(media.data);
    } catch (e) {
      console.error("[MediaService] getMediaById error:", e);
      return fail(e);
    }
  }
};

export default MediaService;
