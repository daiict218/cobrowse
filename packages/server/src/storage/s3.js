import logger from '../utils/logger.js';

/**
 * S3 storage driver for session recordings.
 *
 * Uses @aws-sdk/client-s3 for production deployments.
 * Falls back gracefully if the package is not installed.
 *
 * Interface: { put, get, del, exists }
 */

export async function createS3Storage(config) {
  const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } =
    await import('@aws-sdk/client-s3');

  const client = new S3Client({ region: config.recording.s3Region });
  const bucket = config.recording.s3Bucket;
  const prefix = config.recording.s3Prefix;

  function fullKey(key) {
    return `${prefix}${key}`;
  }

  async function put(key, buffer) {
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: fullKey(key),
      Body: buffer,
      ContentType: 'application/gzip',
    }));
    logger.debug({ key, size: buffer.length }, 'storage.s3: put');
  }

  async function get(key) {
    try {
      const response = await client.send(new GetObjectCommand({
        Bucket: bucket,
        Key: fullKey(key),
      }));
      // Convert readable stream to Buffer
      const chunks = [];
      for await (const chunk of response.Body) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } catch (err) {
      if (err.name === 'NoSuchKey') return null;
      throw err;
    }
  }

  async function del(key) {
    try {
      await client.send(new DeleteObjectCommand({
        Bucket: bucket,
        Key: fullKey(key),
      }));
    } catch (err) {
      if (err.name !== 'NoSuchKey') throw err;
    }
  }

  async function exists(key) {
    try {
      await client.send(new HeadObjectCommand({
        Bucket: bucket,
        Key: fullKey(key),
      }));
      return true;
    } catch {
      return false;
    }
  }

  return { put, get, del, exists };
}
