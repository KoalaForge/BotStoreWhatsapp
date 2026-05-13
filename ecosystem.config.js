const path = require('path');

module.exports = {
  apps: [{
    name: process.env.PM2_APP_NAME || path.basename(__dirname),
    cwd: __dirname,
    script: 'index.js',
    node_args: '--dns-result-order=ipv4first',
    instances: 1,
    exec_mode: 'fork',
    wait_ready: true,
    listen_timeout: 30000,
    kill_timeout: 10000,
    autorestart: true,
    max_restarts: 10,
    max_memory_restart: process.env.PM2_MAX_MEMORY || '512M',
    exp_backoff_restart_delay: 100,
  }]
};
