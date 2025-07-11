import express from 'express';
import fs from 'fs-extra';
import multer from 'multer';
import morgan from 'morgan';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { fromEnv } from '@aws-sdk/credential-providers';
import path from 'path';

const app = express();
const port = process.env.PORT || 3000;

// 🛠️ Initialize S3 client with logs
console.log("🧭 Initializing S3 client...");
console.log("🔑 AWS_REGION:", process.env.AWS_REGION);
console.log("🔑 AWS_ACCESS_KEY_ID exists:", !!process.env.AWS_ACCESS_KEY_ID);
console.log("🔑 AWS_SECRET_ACCESS_KEY exists:", !!process.env.AWS_SECRET_ACCESS_KEY);

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: fromEnv()
});

// Setup chunk storage
const CHUNK_DIR = path.join(__dirname, 'chunks');
fs.ensureDirSync(CHUNK_DIR);
console.log(`📁 Chunk storage directory: ${CHUNK_DIR}`);

// CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', 'https://app.weareazura.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Middleware
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const storage = multer.memoryStorage();
const upload = multer({ storage });

app.post('/upload-chunk', upload.single('chunk'), async (req, res) => {
  console.log("📥 Received POST /upload-chunk request");

  const { fileId, chunkNumber, totalChunks, fileName, contentType } = req.body;
  const chunk = req.file;

  if (!fileId || !chunkNumber || !chunk || !fileName) {
    console.error("❌ Missing required fields:", {
      fileId,
      chunkNumber,
      fileName,
      chunkExists: !!chunk
    });
    return res.status(400).json({ error: 'Missing fields' });
  }

  console.log(`📦 Chunk details: fileId=${fileId}, chunkNumber=${chunkNumber}, totalChunks=${totalChunks}, fileName=${fileName}`);

  const chunkPath = path.join(CHUNK_DIR, `${fileId}.${chunkNumber}`);
  console.log(`💾 Saving chunk to: ${chunkPath}`);
  await fs.writeFile(chunkPath, chunk.buffer);
  console.log(`✅ Chunk ${chunkNumber} saved successfully`);

  const uploadedChunks = (await fs.readdir(CHUNK_DIR)).filter(f => f.startsWith(fileId));
  console.log(`📂 Uploaded chunks so far: ${uploadedChunks.length}/${totalChunks}`);

  if (uploadedChunks.length > totalChunks) {
    console.warn(`⚠️ Received more chunks than expected for fileId ${fileId}`);
  }

  if (uploadedChunks.length === parseInt(totalChunks)) {
    console.log(`🔗 All chunks received for ${fileId}. Beginning reassembly...`);

    const assembledPath = path.join(CHUNK_DIR, fileName);
    const writeStream = fs.createWriteStream(assembledPath);

    try {
      for (let i = 1; i <= totalChunks; i++) {
        const chunkFile = path.join(CHUNK_DIR, `${fileId}.${i}`);
        console.log(`📥 Appending chunk: ${chunkFile}`);
        const data = await fs.readFile(chunkFile);
        writeStream.write(data);
        await fs.remove(chunkFile);
        console.log(`🗑️ Removed chunk file: ${chunkFile}`);
      }
      writeStream.end();

      console.log(`🧩 File reassembled at: ${assembledPath}`);
    } catch (err) {
      console.error("❌ Error during reassembly:", err);
      return res.status(500).json({ error: 'Failed to reassemble chunks', details: err.message });
    }

    // Upload to S3
    try {
      const fileBuffer = await fs.readFile(assembledPath);
      const s3Key = `uploads/${fileName}`;

      console.log(`📤 Uploading to S3...`);
      console.log(`🪣 Bucket: ${process.env.S3_BUCKET}`);
      console.log(`📁 S3 Key: ${s3Key}`);
      console.log(`📨 Content-Type: ${contentType || 'application/octet-stream'}`);

      const command = new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: s3Key,
        Body: fileBuffer,
        ContentType: contentType || 'application/octet-stream'
      });

      await s3.send(command);
      console.log(`✅ Successfully uploaded ${fileName} to S3`);

      await fs.remove(assembledPath);
      console.log(`🧹 Deleted local reassembled file: ${assembledPath}`);

      res.status(200).json({ message: 'Upload complete', s3Key });
      console.log(`🎉 Upload process completed for ${fileName}, S3 Key: ${s3Key}`);
    } catch (err) {
      console.error("❌ Failed to upload to S3:", err);
      res.status(500).json({ error: 'S3 upload failed', details: err.message });
    }
  } else {
    console.log(`📨 Awaiting more chunks for fileId ${fileId}`);
    res.status(200).json({ message: 'Chunk received' });
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`🚀 Chunked upload server running on port ${port}`);
});