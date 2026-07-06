// ⚪ 原点社区 · PM2 生态配置
module.exports = {
  apps: [{
    name: 'origin-community',
    script: 'server.js',
    cwd: __dirname,
    env: {
      NODE_ENV: 'production',
      PORT: 3456,
    },
    env_file: '.env',
    error_file: 'logs/err.log',
    out_file: 'logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    // 自动重启（防无限循环）
    max_restarts: 5,
    restart_delay: 5000,
    min_uptime: 10000,
    // 资源限制
    max_memory_restart: '200M',
    // 优雅退出 — 给足时间释放端口
    kill_timeout: 5000,
    listen_timeout: 3000,
    // 单实例 fork
    instances: 1,
    exec_mode: 'fork'
  }]
};
