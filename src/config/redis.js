import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: 2,
  enableReadyCheck: true
});

export default redis;
