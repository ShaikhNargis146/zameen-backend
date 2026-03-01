import ListingService from "./listing.service.js";

const ListingController = {
  createListing: async (req, res) => {
    const owner = req.user;
    const listingData = req.body;

    const r = await ListingService.createListing({ owner, listingData });
    if (!r.ok)
      return res.status(400).json({ message: r.error?.message || "Failed" });
    return res.status(201).json({ message: "Listing created", data: r.data });
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

    const r = await ListingService.updateListing({ id, owner, updateData: { isActive: false } });
    if (!r.ok)
      return res.status(400).json({ message: r.error?.message || "Failed" });
    return res.json({ message: "Listing deleted" });
  },
  updateStatus: async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    const owner = req.user;

    const r = await ListingService.updateStatus({ id, status, owner });
    if (!r.ok)
      return res.status(400).json({ message: r.error?.message || "Failed" });
    return res.json({ message: "Status updated", data: r.data });
  }
};

export default ListingController;
