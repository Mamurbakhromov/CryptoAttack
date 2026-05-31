const path = require('node:path');

module.exports = {
  apps: [
    {
      name: 'cryptoattack-dashboard',
      cwd: path.join(__dirname, 'apps/server'),
      script: 'dist/src/index.js',
      interpreter: 'node',
      exec_mode: 'fork',
      instances: 1,
      watch: false,
      time: true,
      max_memory_restart: '768M',
      kill_timeout: 15000,
      env_production: {
        NODE_ENV: 'production'
      }
    }
  ]
};
