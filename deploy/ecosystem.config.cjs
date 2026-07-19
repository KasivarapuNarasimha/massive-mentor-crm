/**
 * PM2 process file — zero-downtime reloads, auto-restart on crash.
 * Usage:
 *   pm2 start deploy/ecosystem.config.cjs --env production
 *   pm2 reload massive-mentor-api
 *   pm2 save && pm2 startup
 */
module.exports = {
  apps: [
    {
      name: "massive-mentor-api",
      cwd: "./apps/api",
      script: "dist/index.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 20,
      min_uptime: "10s",
      max_memory_restart: "800M",
      kill_timeout: 10000,
      wait_ready: false,
      listen_timeout: 10000,
      env_production: {
        NODE_ENV: "production",
        PORT: 4000,
        TRUST_PROXY: "true",
      },
      error_file: "./logs/api-error.log",
      out_file: "./logs/api-out.log",
      merge_logs: true,
      time: true,
    },
    {
      name: "massive-mentor-web",
      cwd: "./apps/web",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 20,
      min_uptime: "10s",
      max_memory_restart: "900M",
      kill_timeout: 10000,
      env_production: {
        NODE_ENV: "production",
        PORT: 3000,
      },
      error_file: "./logs/web-error.log",
      out_file: "./logs/web-out.log",
      merge_logs: true,
      time: true,
    },
  ],
};
