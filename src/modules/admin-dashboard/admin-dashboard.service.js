import * as repository from "./admin-dashboard.repository.js";

export const summary = async () => {
  const [listings, verifications, users, services, channelPartners] = await Promise.all([
    repository.pendingListings(),
    repository.pendingVerifications(),
    repository.activeUsers(),
    repository.requestedServices(),
    repository.pendingChannelPartners()
  ]);
  return {
    pendingListings: listings.count,
    pendingVerifications: verifications.count,
    activeUsers: users.count,
    requestedServices: services.count,
    pendingChannelPartners: channelPartners.count,
    generatedAt: new Date().toISOString()
  };
};
