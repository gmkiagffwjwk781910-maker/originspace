// ⚪ 原点社区 · 入口
// 内核初始化 → 自动加载 modules/ 下的所有模块
require('dotenv').config({ path: __dirname + '/.env' });
const path = require('path');
const { Kernel } = require('./kernel/core');

const kernel = new Kernel(__dirname);
kernel.configure({
  port: process.env.PORT || 3456,
  secret: process.env.SECRET || 'origin-default-secret'
});

process.on('SIGTERM', async () => {
  console.log('⏳ SIGTERM received, shutting down gracefully...');
  await kernel.stop();
  process.exit(0);
});
process.on('SIGINT', async () => {
  console.log('⏳ SIGINT received, shutting down gracefully...');
  await kernel.stop();
  process.exit(0);
});
process.on('SIGHUP', async () => {
  console.log('⏳ SIGHUP received, shutting down gracefully...');
  await kernel.stop();
  process.exit(0);
});

kernel.boot().catch(err => {
  console.error('❌ Kernel boot failed:', err);
  process.exit(1);
});
