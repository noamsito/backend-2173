'use strict';
exports.config = {
  app_name: [process.env.NEW_RELIC_APP_NAME || 'backend-2173'],
  license_key: process.env.NEW_RELIC_LICENSE_KEY,
  distributed_tracing: { enabled: true },
  logging: { level: 'info' },          // usa 'debug' si necesitas más detalle
  allow_all_headers: true,
  attributes: { enabled: true }
};
