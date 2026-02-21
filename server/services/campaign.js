const crypto = require('crypto');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { CFG } = require('../config');
const { createLogger } = require('../lib/logger');
const log = createLogger('campaign');

// S3 client (campaign audit trail)
const s3 = CFG.AWS_ACCESS_KEY_ID && CFG.S3_BUCKET
  ? new S3Client({
      region: CFG.AWS_REGION,
      credentials: { accessKeyId: CFG.AWS_ACCESS_KEY_ID, secretAccessKey: CFG.AWS_SECRET_ACCESS_KEY },
    })
  : null;

async function writeToS3(key, data, { reqId } = {}) {
  const rlog = reqId ? createLogger('campaign', { req_id: reqId }) : log;
  if (!s3) {
    rlog.info('S3 not configured', { key });
    return { mock: true, key };
  }
  try {
    await s3.send(new PutObjectCommand({
      Bucket: CFG.S3_BUCKET,
      Key: key,
      Body: JSON.stringify(data, null, 2),
      ContentType: 'application/json',
    }));
    rlog.info('S3 write success', { key, bucket: CFG.S3_BUCKET });
    return { success: true, key, bucket: CFG.S3_BUCKET };
  } catch (e) {
    rlog.error('S3 write failed', { key, error: e.message });
    return { success: false, key, error: e.message };
  }
}

function moengageAuth() {
  return 'Basic ' + Buffer.from(`${CFG.MOENGAGE_APP_ID}:${CFG.MOENGAGE_DATA_API_KEY}`).toString('base64');
}

module.exports = { s3, writeToS3, moengageAuth };
