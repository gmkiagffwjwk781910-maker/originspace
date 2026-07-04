// 🗳️ 投票模块
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const mailer = require('../auth/mailer');

module.exports = {
  id: 'vote',
  version: '1.0.0',

  routes(app, { db, render, auth, limiters, checkAgentScope, notifications, t: ft }) {
    // ── 投票 ──
    app.post('/submissions/:id/vote', limiters.vote, auth.member, (req, res) => {
      const t = req.t || ft;
      const { decision, vote_code } = req.body;
      if (!['approve', 'reject'].includes(decision)) {
        return res.send(render(t('submission.vote_title'), req.session.user, '<div class="error">' + t('vote.invalid_decision') + '</div>'));
      }
      if (!vote_code || vote_code.length < 4) {
        return res.send(render(t('submission.vote_title'), req.session.user, '<div class="error">' + t('vote.required') + '</div>'));
      }

      const user = db.prepare('SELECT vote_code_hash, created_at FROM users WHERE id = ?').get(req.session.user.id);
      if (!user || !bcrypt.compareSync(vote_code, user.vote_code_hash)) {
        return res.send(render(t('submission.vote_title'), req.session.user, '<div class="error">' + t('vote.mismatch') + '</div>'));
      }
      const waitMs = 24 * 60 * 60 * 1000;
      if (Date.now() - new Date(user.created_at).getTime() < waitMs) {
        return res.send(render(t('submission.vote_title'), req.session.user, '<div class="error">' + t('vote.underage') + '</div>'));
      }

      const submission = db.prepare('SELECT * FROM submissions WHERE id = ?').get(req.params.id);
      if (!submission) return res.status(404).send(t('vote.not_found'));
      if (submission.user_id === req.session.user.id) {
        return res.send(render(t('submission.vote_title'), req.session.user, '<div class="error">' + t('vote.self_vote') + '</div>'));
      }
      if (submission.status !== 'pending') {
        return res.send(render(t('submission.vote_title'), req.session.user, '<div class="error">' + t('vote.already_decided') + '</div>'));
      }

      const existingVote = db.prepare('SELECT id FROM votes WHERE submission_id = ? AND voter_id = ?').get(submission.id, req.session.user.id);
      if (existingVote) {
        return res.send(render(t('submission.vote_title'), req.session.user, '<div class="error">' + t('vote.already_voted') + '</div>'));
      }

      db.prepare(`INSERT INTO votes (id, submission_id, voter_id, decision)
        VALUES (?, ?, ?, ?)`).run(uuidv4(), submission.id, req.session.user.id, decision);
      req.audit('vote.cast', 'submission', submission.id, { decision });

      // 检查投票阈值 — 自动决策
      const approve = db.prepare(`SELECT COUNT(*) as c FROM votes WHERE submission_id = ? AND decision = 'approve'`).get(submission.id).c;
      const reject = db.prepare(`SELECT COUNT(*) as c FROM votes WHERE submission_id = ? AND decision = 'reject'`).get(submission.id).c;
      const totalMembers = db.prepare(`SELECT COUNT(*) as c FROM users WHERE role IN ('member','admin')`).get().c;
      const threshold = Math.max(1, Math.ceil(totalMembers / 2));

      if ((approve + reject) >= threshold) {
        const approved = approve > reject;
        if (approved) {
          db.prepare('UPDATE submissions SET status = ? WHERE id = ?').run('approved', submission.id);
          db.prepare('UPDATE users SET role = ? WHERE id = ?').run('member', submission.user_id);
        } else {
          db.prepare('UPDATE submissions SET status = ? WHERE id = ?').run('rejected', submission.id);
        }

        // 创建站内通知
        const _t = req.t || ((s) => s);
        const subUrl = '/submissions/' + submission.id;
        const challenge = db.prepare('SELECT title FROM challenges WHERE id = ?').get(submission.challenge_id);
        const challengeTitle = challenge ? challenge.title : '';
        if (approved) {
          notifications.create(submission.user_id, 'submission_status',
            _t('notifications.submission_approved'),
            _t('notifications.submission_approved_msg').replace('{title}', challengeTitle),
            subUrl);
        } else {
          notifications.create(submission.user_id, 'submission_status',
            _t('notifications.submission_rejected'),
            _t('notifications.submission_rejected_msg').replace('{title}', challengeTitle),
            subUrl);
        }

        // B: 异步发送审核结果邮件
        setImmediate(async () => {
          try {
            const submitter = db.prepare('SELECT email, display_name FROM users WHERE id = ?').get(submission.user_id);
            if (submitter && submitter.email && mailer.isConfigured()) {
              const baseUrl = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
              const subUrl = `${baseUrl}/submissions/${submission.id}`;
              const emailApproved = approve > reject;
              const subject = emailApproved ? '✅ ' + _t('vote.email_approved_subject') : '❌ ' + _t('vote.email_rejected_subject');
              const greeting = _t('vote.email_greeting').replace('{name}', submitter.display_name || '') + '，';
              const body = emailApproved ? _t('vote.email_approved_body') : _t('vote.email_rejected_body');
              const btnText = _t('vote.email_view_btn');
              const titleColor = emailApproved ? '#7c3aed' : '#f87171';
              const siteName = '原点社区';
              const text = greeting + '\n' + body + '\n\n' + subUrl;
              const html = '<div style="max-width:480px;margin:2rem auto;padding:1.5rem;border-radius:8px;background:#1a1a2e;color:#e2e8f0;font-family:sans-serif">' +
                '<h1 style="color:' + titleColor + '">' + subject + '</h1>' +
                '<p>' + greeting + '</p>' +
                '<p>' + body + '</p>' +
                '<p style="margin:1.5rem 0"><a href="' + subUrl + '" style="display:inline-block;padding:0.7rem 1.4rem;background:#7c3aed;color:#fff;text-decoration:none;border-radius:6px">' + btnText + '</a></p>' +
                '<hr style="border:none;border-top:1px solid #334155;margin:1.5rem 0"><p style="font-size:0.8rem;color:#64748b">' + siteName + '</p></div>';
              const transporter = require('nodemailer').createTransport({
                host: process.env.SMTP_HOST,
                port: parseInt(process.env.SMTP_PORT || '587'),
                secure: process.env.SMTP_SECURE === 'true',
                auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
              });
              await transporter.sendMail({
                from: '"' + siteName + '" <' + (process.env.SMTP_FROM || process.env.SMTP_USER) + '>',
                to: submitter.email,
                subject,
                text,
                html
              });
            }
          } catch (e) {
            console.error('❌ 审核结果邮件发送失败:', e.message);
          }
        });
      }

      res.redirect('/submissions/' + submission.id);
    });

    // ── AI-First API ──
    app.get('/api/votes/:submissionId', auth.member, (req, res) => {
      const votes = db.prepare(`
        SELECT v.decision, v.created_at, u.display_name as voter
        FROM votes v JOIN users u ON v.voter_id = u.id
        WHERE v.submission_id = ?`).all(req.params.submissionId);
      res.json(votes);
    });

    app.post('/api/votes/:submissionId', limiters.vote, auth.api, (req, res) => {
      const { decision, vote_code } = req.body;
      if (!['approve', 'reject'].includes(decision)) {
        return res.status(400).json({ success: false, error: 'invalid_decision' });
      }

      // 确定投票人
      let voterId;
      let isAgent = false;
      if (req.bearerUser) {
        if (!req.bearerUser.permissions || !req.bearerUser.permissions.vote) {
          return res.status(403).json({ success: false, error: 'permission_denied' });
        }
        voterId = req.bearerUser.id;
        isAgent = true;
      } else if (req.session.user) {
        if (!vote_code || vote_code.length < 4) {
          return res.status(400).json({ success: false, error: 'vote_code_required' });
        }
        const u = db.prepare('SELECT vote_code_hash, created_at FROM users WHERE id = ?').get(req.session.user.id);
        if (!u || !bcrypt.compareSync(vote_code, u.vote_code_hash)) {
          return res.status(403).json({ success: false, error: 'vote_code_mismatch' });
        }
        const waitMs = 24 * 60 * 60 * 1000;
        if (Date.now() - new Date(u.created_at).getTime() < waitMs) {
          return res.status(403).json({ success: false, error: 'account_too_young' });
        }
        voterId = req.session.user.id;
      } else {
        return res.status(401).json({ success: false, error: 'unauthorized' });
      }

      const submission = db.prepare('SELECT * FROM submissions WHERE id = ?').get(req.params.submissionId);
      if (!submission) return res.status(404).json({ success: false, error: 'not_found' });
      if (req.bearerUser && !checkAgentScope(req.bearerUser.permissions, 'vote_scope', submission.challenge_id)) {
        return res.status(403).json({ success: false, error: 'challenge_out_of_scope' });
      }
      if (submission.user_id === voterId) return res.status(403).json({ success: false, error: 'cannot_vote_self' });
      if (submission.status !== 'pending') return res.status(400).json({ success: false, error: 'already_decided' });

      const existingVote = db.prepare('SELECT id FROM votes WHERE submission_id = ? AND voter_id = ?').get(req.params.submissionId, voterId);
      if (existingVote) return res.status(409).json({ success: false, error: 'already_voted' });

      db.prepare(`INSERT INTO votes (id, submission_id, voter_id, decision)
        VALUES (?, ?, ?, ?)`).run(uuidv4(), submission.id, voterId, decision);
      req.audit('vote.cast', 'submission', submission.id, { decision, is_agent: isAgent });
      res.json({ success: true, voter: { agent: isAgent } });
    });
  }
};
