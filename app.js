import express from 'express';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import credentialProviders from '@aws-sdk/credential-providers';
const { fromEnv } = credentialProviders;
import morgan from 'morgan';
console.log("🧪 credentialProviders keys:", Object.keys(credentialProviders));

const app = express();
const port = process.env.PORT || 3000;

// 🛠️ Initialize S3 client with logs
console.log("🧭 Initializing S3 client...");
console.log("🔑 AWS_REGION:", process.env.AWS_REGION);
console.log("🔑 AWS_ACCESS_KEY_ID exists:", !!process.env.AWS_ACCESS_KEY_ID);
console.log("🔑 AWS_SECRET_ACCESS_KEY exists:", !!process.env.AWS_SECRET_ACCESS_KEY);

const s3Credentials = fromEnv();
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials:s3Credentials
});

// CORS middleware
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', 'https://app.weareazura.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Middleware
app.use(morgan('combined'));
app.use(express.raw({
  type: '*/*',
  limit: '100mb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

app.post('/upload', async (req, res) => {
  console.log("📥 Received POST /upload request");

  try {
    const contentType = req.headers['content-type'] || 'application/octet-stream';
    const contentLength = req.headers['content-length'] || 'unknown';
    const ext = contentType.includes('webm') ? 'webm'
              : contentType.includes('mp4') ? 'mp4'
              : 'bin';

    const key = req.headers['x-upload-key'];

    const bucket = ext === 'webm'
      ? process.env.S3_BUCKET_WEBM
      : ext === 'mp4'
      ? process.env.S3_BUCKET_MP4
      : process.env.S3_BUCKET_WEBM;

    console.log("🧾 Content-Type:", contentType);
    console.log("📏 Content-Length:", contentLength);
    console.log("🧩 File extension:", ext);
    console.log("📦 S3 bucket:", bucket);
    console.log("🗂️ S3 key:", key);

    if (!bucket) {
      console.error("❌ No bucket specified for this file type!");
      return res.status(500).json({ error: 'No bucket configured for file type' });
    }

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: req.rawBody || req.body,
      ContentType: contentType,
    });

    const result = await s3.send(command);

    console.log("✅ Upload to S3 succeeded");
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).json({ message: 'Upload successful', key, s3Result: result });
  } catch (err) {
    console.error("❌ Upload failed:", err);
    res.status(500).json({ error: 'Upload failed', details: err.message });
  }
});

app.listen(port, () => {
  console.log(`🚀 Upload proxy running on port ${port}`);
});