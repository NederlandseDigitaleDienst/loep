(function () {
  'use strict';
  // The survey of Kijkpunt: the site names the survey on an element, the service gives its questions.
  var base = new URL(document.currentScript.src).origin;
  var page = location.origin + location.pathname;
  Array.prototype.slice.call(document.querySelectorAll('[data-vragenlijst]')).forEach(function (box) {
    var id = box.getAttribute('data-vragenlijst');
    fetch(base + '/vragenlijst/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ vragenlijst: id, pagina: page }) })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (answer) {
        if (!answer) return;
        box.innerHTML = answer.html;
        var send = box.querySelector('.vl-verstuur');
        var form = box.querySelector('form');
        form.addEventListener('submit', function (event) { event.preventDefault(); });
        send.addEventListener('click', function () {
          var chosen = form.querySelector('input:checked');
          fetch(base + '/vragenlijst/antwoord', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ vragenlijst: id, pagina: page, cijfer: chosen ? chosen.value : null }) })
            .then(function () { box.querySelector('.vl-dank').textContent = 'Bedankt, uw antwoord is ontvangen.'; })
            .catch(function () { /* nothing to show */ });
        });
      })
      .catch(function () { /* the survey stays away */ });
    // Every visit is counted at the service.
    fetch(base + '/vragenlijst/bezoek', { method: 'POST', body: JSON.stringify({ vragenlijst: id, pagina: page }), keepalive: true }).catch(function () { /* not counted */ });
  });
})();
