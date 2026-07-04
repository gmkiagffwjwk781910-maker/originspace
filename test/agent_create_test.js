// agent_test.js — 测试成员自助创建智能体
require('dotenv').config();
const { execSync } = require('child_process');
const Database = require('better-sqlite3');
const db = new Database('data/kernel.db');
const TS = Date.now().toString().slice(-6);

const COOKIE = '/tmp/agent_ct_cookie';

// 清理旧 cookie
try { require('fs').unlinkSync(COOKIE); } catch(e) {}

// 1. Login
const loginHtml = execSync(`curl -s -c ${COOKIE} -H "X-Forwarded-Proto: https" http://localhost:3456/login`, { encoding: 'utf8' });
const csrf1 = loginHtml.match(/csrf-token[\s\S]*?content="([^"]+)"/);
if (!csrf1) { console.log('❌ No CSRF'); process.exit(1); }
console.log('✅ CSRF1:', csrf1[1].slice(0, 10) + '...');

const loginCode = execSync(`curl -s -o /dev/null -w "%{http_code}" -X POST -b ${COOKIE} -H "X-Forwarded-Proto: https" http://localhost:3456/login -d "username=origin&passcode=origin2026&_csrf=${csrf1[1]}"`, { encoding: 'utf8' });
console.log('✅ Login HTTP:', loginCode);

// 2. GET /agents/new
const agentNewHtml = execSync(`curl -s -b ${COOKIE} -H "X-Forwarded-Proto: https" http://localhost:3456/agents/new`, { encoding: 'utf8' });
const csrf2 = agentNewHtml.match(/csrf-token[\s\S]*?content="([^"]+)"/);
if (!csrf2) { console.log('❌ No CSRF on /agents/new'); process.exit(1); }
console.log('✅ CSRF2:', csrf2[1].slice(0, 10) + '...');

// Check for error about max agents
if (agentNewHtml.includes('max_reached')) {
  console.log('⚠️ Max agents reached, will still test POST');
}

// 3. POST /agents
const agentResp = execSync(`curl -s -X POST -b ${COOKIE} -H "X-Forwarded-Proto: https" http://localhost:3456/agents -d "username=bot${TS}&display_name=BotAgent&bio=hello&_csrf=${csrf2[1]}"`, { encoding: 'utf8' });
const keyMatch = agentResp.match(/oc_[a-f0-9]{64}/);
if (keyMatch) {
  console.log('✅ Key found:', keyMatch[0].slice(0, 20) + '...');
} else {
  console.log('❌ No key in response');
  // Check if it was a max_reached or error page
  if (agentResp.includes('max_reached')) console.log('   (max agents reached)');
  else if (agentResp.includes('error')) console.log('   (error page)');
  else console.log('   (unknown response, length=' + agentResp.length + ')');
}

// 4. DB check
const agent = db.prepare('SELECT username, creator_id, display_name FROM users WHERE role = ? ORDER BY created_at DESC LIMIT 1').get('agent');
console.log('\n📊 DB Check:');
console.log('   Last agent:', agent.username, '| display:', agent.display_name);
if (agent.creator_id) {
  const creator = db.prepare('SELECT username FROM users WHERE id = ?').get(agent.creator_id);
  console.log('   Creator:', creator ? creator.username : 'UNKNOWN');
  console.log('   ✅ creator_id set!');
} else {
  console.log('   ❌ creator_id is null');
}

// 5. Test API with key
if (keyMatch) {
  const key = keyMatch[0];
  const meResp = execSync(`curl -s -H "Authorization: Bearer ${key}" http://localhost:3456/api/agent/me`, { encoding: 'utf8' });
  console.log('\n🤖 API /me:', meResp.slice(0, 120));
}

db.close();
