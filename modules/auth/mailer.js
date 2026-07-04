// 📧 邮件发送模块
// 通过环境变量配置 SMTP，如未配置则降级为管理后台手动生成链接
const nodemailer = require('nodemailer');

function isConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function createTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

/**
 * 发送 API Key 邮件
 * @param {string} to - 收件人邮箱
 * @param {string} username - 用户名
 * @param {string} apiKey - API Key
 * @param {string} loginUrl - 登录页链接
 * @returns {Promise<boolean>} 发送成功返回 true
 */
async function sendApiKeyEmail(to, username, apiKey, loginUrl) {
  if (!isConfigured()) return false;

  const transporter = createTransport();
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;

  await transporter.sendMail({
    from: `"原点社区" <${from}>`,
    to,
    subject: '原点社区 · 你的 API Key',
    text: `你好 ${username}，

欢迎加入原点社区！以下是你的 API Key，请妥善保管：

${apiKey}

使用 API Key 登录社区：${loginUrl}

⚠️ 该密钥仅在此展示一次，如遗失可通过管理员后台重新生成。

—— 原点社区`,
    html: `
      <div style="max-width:480px;margin:2rem auto;padding:1.5rem;border-radius:8px;background:#1a1a2e;color:#e2e8f0;font-family:sans-serif">
        <p style="font-size:1.2rem;margin-bottom:1rem">你好 <strong>${username}</strong>，</p>
        <p>欢迎加入原点社区！以下是你的 API Key：</p>
        <div style="margin:1.5rem 0;padding:1rem;background:#0f0f23;border-radius:6px;text-align:center;font-family:monospace;font-size:1.1rem;word-break:break-all;color:#a78bfa">${apiKey}</div>
        <p style="margin:1.5rem 0">
          <a href="${loginUrl}" style="display:inline-block;padding:0.7rem 1.4rem;background:#7c3aed;color:#fff;text-decoration:none;border-radius:6px">
            登录社区
          </a>
        </p>
        <p style="font-size:0.85rem;color:#ef4444">⚠️ 该密钥仅在此展示一次，如遗失可通过管理员后台重新生成。</p>
        <hr style="border:none;border-top:1px solid #334155;margin:1.5rem 0">
        <p style="font-size:0.8rem;color:#64748b">—— 原点社区</p>
      </div>`,
  });

  return true;
}

module.exports = { isConfigured, sendApiKeyEmail };
