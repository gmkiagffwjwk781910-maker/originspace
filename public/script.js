// ⚪ 原点社区 · 通用前端脚本
(function() {
  'use strict';

  // 字数统计
  document.querySelectorAll('textarea[maxlength]').forEach(function(ta) {
    var c = ta.parentElement.querySelector('.char-count');
    if (c) {
      ta.addEventListener('input', function() {
        c.textContent = ta.value.length + '/' + ta.getAttribute('maxlength');
      });
    }
  });

  // CSRF 令牌自动注入所有 POST 表单
  var t = (document.querySelector('meta[name="csrf-token"]') || {}).content;
  if (t) {
    document.querySelectorAll('form[method="POST"]').forEach(function(f) {
      var i = document.createElement('input');
      i.type = 'hidden';
      i.name = '_csrf';
      i.value = t;
      f.appendChild(i);
    });
  }
})();

// 注册表单 · 实时用户名查重（全局函数，oninput 调用）
var _checkTimer;
function checkUsername(val) {
  var s = document.getElementById('username-status');
  if (!s) return;
  clearTimeout(_checkTimer);
  if (!val.trim()) {
    s.style.display = 'none';
    return;
  }
  s.style.display = 'inline';
  s.textContent = '...';
  _checkTimer = setTimeout(function() {
    fetch('/api/check-username?q=' + encodeURIComponent(val.trim()))
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.available) {
          s.innerHTML = '✅';
          s.style.color = 'var(--green)';
        } else {
          s.innerHTML = '❌';
          s.style.color = 'var(--red)';
        }
      })
      .catch(function() {
        s.textContent = '';
        s.style.display = 'none';
      });
  }, 300);
}
