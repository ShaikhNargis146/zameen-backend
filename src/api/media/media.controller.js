import MediaService from "./media.service.js";

const MediaController = {
  // Upload single file
  uploadSingle: async (req, res, next) => {
    try {
      // Validate file exists
      if (!req.file) {
        return res.status(400).json({ message: "No file provided" });
      }

    //   const { instrument_version_id, bucketName } = req.body;

      // Validate required fields
      if (!req.params.listingId) {
        return res.status(400).json({ message: "listingId is required" });
      }

      const r = await MediaService.uploadSingleFile({
        file: req.file,
        listingId: req.params.listingId,
        bucketName: process.env.GCS_BUCKET
      });

      if (!r.ok)
        return res.status(400).json({ message: r.error?.message || "Failed to upload file" });

      return res.status(200).json({ message: "File uploaded successfully", data: r.data });
    } catch (error) {
      next(error);
    }
  },

  // Upload multiple files
  uploadMultiple: async (req, res, next) => {
    try {
      // Validate files exist
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ message: "No files provided" });
      }

    //   const { instrument_version_id, bucketName } = req.body;

      // Validate required fields
      if (!req.params.listingId) {
        return res.status(400).json({ message: "listingId is required" });
      }

      const r = await MediaService.uploadMultipleFiles({
        files: req.files,
        listingId: req.params.listingId,
        bucketName: process.env.GCS_BUCKET
      });

      if (!r.ok)
        return res.status(400).json({ message: r.error?.message || "Failed to upload files" });

      return res.status(200).json({ message: `${r.data.length} file(s) uploaded successfully`, data: r.data });
    } catch (error) {
      next(error);
    }
  },

  // Get all media for a listing with AccessDenied error handling
  getListingMedia: async (req, res, next) => {
    try {
      if (!req.params.listingId) {
        return res.status(400).json({ message: "listingId is required" });
      }

      // Optional: query parameter for signed URL expiration (in minutes)
      const signedUrlExpiresInMinutes = parseInt(req.query.expiresIn) || 60;

      const r = await MediaService.getListingMedia({
        listingId: req.params.listingId,
        signedUrlExpiresInMinutes
      });

      if (!r.ok) {
        return res.status(400).json({
          message: r.error?.message || "Failed to retrieve media"
        });
      }

      return res.status(200).json({
        message: "Media retrieved successfully",
        data: r.data,
        count: r.data.length
      });
    } catch (error) {
      next(error);
    }
  },

  // Get specific media by ID with AccessDenied error handling
  getMediaById: async (req, res, next) => {
    try {
      if (!req.params.mediaId) {
        return res.status(400).json({ message: "mediaId is required" });
      }

      // Optional: query parameter for signed URL expiration (in minutes)
      const signedUrlExpiresInMinutes = parseInt(req.query.expiresIn) || 60;

      const r = await MediaService.getMediaById({
        mediaId: req.params.mediaId,
        signedUrlExpiresInMinutes
      });

      if (!r.ok) {
        return res.status(400).json({
          message: r.error?.message || "Failed to retrieve media"
        });
      }

      return res.status(200).json({
        message: "Media retrieved successfully",
        data: r.data
      });
    } catch (error) {
      next(error);
    }
}};

export default MediaController;
