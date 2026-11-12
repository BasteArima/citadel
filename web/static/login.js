(function () {
    var form = document.getElementById('form'), err = document.getElementById('err'), go = document.getElementById('go');
    var name = document.getElementById('name');
    try { name.value = localStorage.getItem('citadel-name') || ''; } catch (e) {}
    (name.value ? document.getElementById('code') : name).focus();
    // куда вернуться после входа: только свой адрес
    var next = new URLSearchParams(location.search).get('next') || '/';
    if (next.charAt(0) !== '/' || next.charAt(1) === '/') next = '/';
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      err.hidden = true; go.disabled = true;
      fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.value, code: document.getElementById('code').value, remember: document.getElementById('remember').checked })
      }).then(function (r) {
        return r.json().then(function (body) {
          if (!r.ok) throw new Error(body.error || ('сервер ответил ' + r.status));
          try { localStorage.setItem('citadel-name', body.name); } catch (e) {}
          location.replace(next);
        });
      }).catch(function (e) {
        err.textContent = e.message; err.hidden = false; go.disabled = false;
      });
    });
  })();
