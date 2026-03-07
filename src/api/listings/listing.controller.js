import ListingService from "./listing.service.js";
import MediaService from "../media/media.service.js";

const ListingController = {
  createListing: async (req, res) => {
    const owner = req.user;
    const listingData = req.body;
    listingData.owner_user_id = owner.id;
    const r = await ListingService.createListing({ owner, listingData });
    if (!r.ok)
      return res.status(400).json({ message: r.error?.message || "Failed" });
    return res.status(200).json({ message: "Listing created", data: r.data });
  },
  getAllListings: async (req, res) => {
    const { page = 1, limit = 10, ...filters } = req.query;
    const r = await ListingService.getAllListings({
      page: parseInt(page),
      limit: parseInt(limit),
      filters
    });
    if (!r.ok)
      return res.status(400).json({ message: r.error?.message || "Failed" });
    return res.json({ message: "Listings fetched", data: r.data });
  },
  getAllListingsByOwner: async (req, res) => {
    const { page = 1, limit = 10, ...filters } = req.query;
    const result = await ListingService.getListingsByOwner({
      userId: req.user.id,
      page: parseInt(page),
      limit: parseInt(limit),
      filters
    });
    if (!result.ok || !result.data || result.data?.listings.length === 0)
      return res.status(400).json({ message: result.error?.message || "Failed" });
    // Get media for all listings
    const listingsWithMedia = await Promise.all(
      result.data.listings.map(async (listing) => {
        const media = await MediaService.getListingMedia({ listingId: listing.id });
        return {
          ...listing,
          uploads: media.ok ? media.data : []
        };
      })
    );

    return res.json({ message: "Listings fetched", data: listingsWithMedia });
  },
  getListingById: async (req, res) => {
    const { id } = req.params;

    const r = await ListingService.getListingById(id);
    if (!r.ok || !r.data)
      return res.status(404).json({ message: r.error?.message || "Not found" });
    const media = await MediaService.getListingMedia({ listingId: r.data.id });
    return res.json({ message: "Listing fetched", data: { ...r.data, uploads: media.ok ? media.data : [] } });
  },
  updateByAdmin: async (req, res) => {
    const { id } = req.params;
    const owner = req.user;
    console.log("Updating listing", { id, owner: owner.id, body: req.body });
    const updateData = req.body;
    if (owner && owner.role !== 'admin') {
      return res.status(403).json({ 
        message: "Only admin can update user's properties"
      });
    }
    const r = await ListingService.updateListingByAdmin({
      id,
      updateData
    });
    if (!r.ok)
      return res.status(400).json({ message: r.error?.message || "Failed" });
    return res.json({ message: "Listing updated", data: r.data });
  },
  deleteListing: async (req, res) => {
    const { id } = req.params;
    const owner = req.user;

    const r = await ListingService.updateListing({ id, owner, updateData: { is_active: false } });
    if (!r.ok)
      return res.status(400).json({ message: r.error?.message || "Failed" });
    return res.json({ message: "Listing deleted" });
  },
  deleteByAdmin: async (req, res) => {
    const { id } = req.params;
    const owner = req.user;
    if (owner && owner.role !== 'admin') {
      return res.status(403).json({ 
        message: "Only admin can update user's properties"
      });
    }

    const r = await ListingService.updateListingByAdmin({ id, updateData: { is_active: false } });
    if (!r.ok)
      return res.status(400).json({ message: r.error?.message || "Failed" });
    return res.json({ message: "Listing deleted" });
  },
  createAndUpdateListing: async (req, res) => {
    const owner = req.user;
    const listingData = req.body;
    const { id } = listingData;
    listingData.price_total = req.body.price_total || 1;
    listingData.area_unit = req.body.area_unit || 'sqft';

    if (id) {
      // Update existing listing
      const r = await ListingService.updateListing({
        id,
        owner,
        updateData: listingData
      });
      if (!r.ok)
        return res.status(400).json({ message: r.error?.message || "Failed" });
      return res.json({ message: "Listing updated", data: r.data });
    } else {
      // Create new listing
      listingData.owner_user_id = owner.id;
      const r = await ListingService.createListing({ owner, listingData });
      if (!r.ok)
        return res.status(400).json({ message: r.error?.message || "Failed" });
      return res.status(200).json({ message: "Listing created", data: r.data });
    }
  }
};

export default ListingController;
