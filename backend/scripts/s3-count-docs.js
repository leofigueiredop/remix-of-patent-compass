require('dotenv').config({ path: '../.env' });
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');

async function run() {
  const endpoint = process.env.S3_ENDPOINT || '';
  const bucket = process.env.S3_BUCKET || 'patents';
  if (!endpoint || !process.env.S3_ACCESS_KEY || !process.env.S3_SECRET_KEY) {
    console.log(JSON.stringify({ ok: false, reason: 'missing_s3_env' }));
    return;
  }

  const client = new S3Client({
    endpoint,
    region: process.env.S3_REGION || 'garage',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY,
      secretAccessKey: process.env.S3_SECRET_KEY
    },
    forcePathStyle: true
  });

  let token = undefined;
  let total = 0;
  const sample = [];

  do {
    const out = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: 'patent-docs/',
      ContinuationToken: token,
      MaxKeys: 1000
    }));
    const entries = out.Contents || [];
    total += entries.length;
    for (const item of entries) {
      if (sample.length < 10) sample.push(item.Key);
    }
    token = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (token);

  console.log(JSON.stringify({ ok: true, bucket, prefix: 'patent-docs/', total, sample }, null, 2));
}

run().catch((error) => {
  console.log(JSON.stringify({ ok: false, error: error?.message || String(error) }));
  process.exit(1);
});
