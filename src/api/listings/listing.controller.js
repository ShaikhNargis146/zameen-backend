import ListingService from "./listing.service.js";

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
    const { page = 1, limit = 10, status, land_type } = req.query;
    const r = await ListingService.getAllListings({
      page: parseInt(page),
      limit: parseInt(limit),
      status,
      land_type
    });
    if (!r.ok)
      return res.status(400).json({ message: r.error?.message || "Failed" });
    return res.json({ message: "Listings fetched", data: r.data });
  },
  getAllListingsByOwner: async (req, res) => {
    const { page = 1, limit = 10, status, land_type } = req.query;
    const r = await ListingService.getListingsByOwner({
      userId: req.user.id,
      page: parseInt(page),
      limit: parseInt(limit),
      status,
      land_type
    });
    if (!r.ok)
      return res.status(400).json({ message: r.error?.message || "Failed" });
    return res.json({ message: "Listings fetched", data: r.data });
  },
  getListingById: async (req, res) => {
    const { id } = req.params;

    const r = await ListingService.getListingById(id);
    if (!r.ok)
      return res.status(404).json({ message: r.error?.message || "Not found" });
    return res.json({ message: "Listing fetched", data: r.data });
  },
  updateListing: async (req, res) => {
    const { id } = req.params;
    const owner = req.user;
    console.log("Updating listing", { id, owner: owner.id, body: req.body });
    const updateData = req.body;

    const r = await ListingService.updateListing({
      id,
      owner,
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
  updateByAdmin: async (req, res) => {
    const { id } = req.params;
    const { status} = req.body;
    const owner = req.user;

    const r = await ListingService.updateStatus({ id, status, owner });
    if (!r.ok)
      return res.status(400).json({ message: r.error?.message || "Failed" });
    return res.json({ message: "Status updated", data: r.data });
  },
  createAndUpdateListing: async (req, res) => {
    const owner = req.user;
    const listingData = req.body;
    const { id } = listingData;

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
