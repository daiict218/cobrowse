'use strict';

const pino = require('pino');
const config = require('../config');

// Structured logger with PII scrubbing.
// In production, pipe output to your log aggregator (Datadog, CloudWatch, etc.)
const logger = pino({
  level: config.logging.level,
  ...(config.isDev && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
    },
  }),
  // Scrub fields that must never appear in logs
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["x-api-key"]',
      'req.headers["x-cb-public-key"]',
      'body.customerToken',
      'body.apiKey',
    ],
    censor: '[REDACTED]',
  },
  // Standard fields added to every log line
  base: {
    service: 'cobrowse-server',
    env: config.env,
  },
});

module.exports = logger;
