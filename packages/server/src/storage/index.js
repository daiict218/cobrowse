import config from '../config.js';
import logger from '../utils/logger.js';
import { createFsStorage } from './fs.js';

/**
 * Storage factory — same pattern as cache/index.js.
 *
 * RECORDING_DRIVER=fs  → local filesystem (default, zero dependencies)
 * RECORDING_DRIVER=s3  → AWS S3 (requires @aws-sdk/client-s3)
 *
 * Both drivers expose: put(key, buffer), get(key), del(key), exists(key)
 */

let storage;

if (config.recording.driver === 's3') {
  logger.info('Recording storage driver: S3');
  const { createS3Storage } = await import('./s3.js');
  storage = await createS3Storage(config);
} else {
  logger.info('Recording storage driver: filesystem');
  storage = createFsStorage(config);
}

export default storage;
