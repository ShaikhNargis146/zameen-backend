const common = {
  env: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 3000),

  AKey: process.env.AKey,
  SAKey: process.env.SAKey,

  APPLICATION_ARN: "arn:aws:sns:ap-south-1::app/GCM/",
  region: "ap-south-1",
  aws_basepath: "https://ap.amazonaws.com",
  Bucket: "app",

  Payment_url: process.env.PAYMENT_URL,
  bitly_token: process.env.BITLY_ATOKEN,
  patym_mid: process.env.Test_Merchant_ID,
  paytm_mKey: process.env.Test_Merchant_Key,
  paytm_web: process.env.Website,

  database: {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
  }
};

export default common;
