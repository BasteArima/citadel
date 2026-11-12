try {
    var th = JSON.parse(localStorage.getItem('citadel-ui') || '{}').theme;
    if (th === 'light' || th === 'dark') document.documentElement.setAttribute('data-theme', th);
  } catch (e) {}
