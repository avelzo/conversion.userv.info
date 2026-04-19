module.exports = {
  apps: [
    {
      name: 'conversion.userv.info',
      script: 'npm',
      args: 'start',
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 3009,
      },
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      merge_logs: true,
      autorestart: true,
      max_restarts: 10,
    },
  ],
};
module.exports = {
  apps: [
    {
      name: 'conversion.userv.info',
      script: 'npm',
      args: 'start',
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 3009,
      },
    },
  ],
};
