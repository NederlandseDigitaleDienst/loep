(function () {
  'use strict';
  var doc = document;
  function one(selector, root) { return (root || doc).querySelector(selector); }
  function all(selector, root) { return Array.prototype.slice.call((root || doc).querySelectorAll(selector)); }
  function param(name) { return new URLSearchParams(location.search).get(name) || ''; }

  // Cookie notice
  var notice = one('#cookiemelding');
  var pageRoot = one('.pagina');
  var backdrop = one('.melding-achtergrond');
  function storedChoice() {
    try { if (localStorage.getItem('cookiekeuze')) return true; } catch (error) { /* storage unavailable */ }
    return doc.cookie.indexOf('cookiekeuze=') !== -1;
  }
  function closeNotice(value) {
    try { localStorage.setItem('cookiekeuze', value); } catch (error) { /* storage unavailable */ }
    doc.cookie = 'cookiekeuze=' + value + '; path=/; max-age=31536000; SameSite=Lax';
    notice.hidden = true;
    /*@bad 2.4.11-melding*//*@good*/
    if (backdrop) backdrop.hidden = true;
    pageRoot.inert = false;
    var target = one('.skiplink');
    if (target) target.focus();
    /*@end*/
  }
  if (notice) {
    if (!storedChoice()) {
      notice.hidden = false;
      /*@bad 2.4.11-melding*//*@good*/
      if (backdrop) backdrop.hidden = false;
      pageRoot.inert = true;
      one('button', notice).focus();
      /*@end*/
    }
    all('[data-keuze]', notice).forEach(function (button) {
      button.addEventListener('click', function () {
        var value = button.getAttribute('data-keuze');
        if (value === 'aanpassen') {
          one('.melding-voorkeuren', notice).hidden = false;
          return;
        }
        closeNotice(value);
      });
    });
  }

  // Menu on narrow screens
  var menuButton = one('.menuknop');
  var menuPanel = one('.mobiel-menu');
  if (menuButton && menuPanel) {
    menuButton.addEventListener('click', function () {
      var open = menuPanel.hidden;
      menuPanel.hidden = !open;
      /*@bad 4.1.2-menuknop*//*@good*/menuButton.setAttribute('aria-expanded', String(open));/*@end*/
    });
  }

  /*@bad 2.1.1-naar-boven*/
  var toTop = one('.naar-boven');
  if (toTop) toTop.addEventListener('click', function () { window.scrollTo(0, 0); });
  /*@good*//*@end*/

  // Chat
  var chatButton = one('.chat-knop');
  var chatPanel = one('.chat-venster');
  var chatInput = one('#chat-invoer');
  var chatLog = one('.chat-berichten');
  var socket = null;
  function chatLine(who, text) {
    var line = doc.createElement('p');
    var name = doc.createElement('strong');
    name.textContent = who + ': ';
    line.appendChild(name);
    line.appendChild(doc.createTextNode(text));
    chatLog.appendChild(line);
    chatLog.scrollTop = chatLog.scrollHeight;
  }
  function openChat(moveFocus) {
    chatPanel.hidden = false;
    chatButton.setAttribute('aria-expanded', 'true');
    if (!socket) {
      // Every connection gets an address of its own.
      var token = '';
      for (var i = 0; i < 16; i++) token += 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'.charAt(Math.floor(Math.random() * 52));
      socket = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws/chat/' + token);
      socket.addEventListener('message', function (event) { chatLine('Gemeente', String(event.data)); });
    }
    if (moveFocus) chatInput.focus();
  }
  function closeChat() {
    chatPanel.hidden = true;
    chatButton.setAttribute('aria-expanded', 'false');
    chatButton.focus();
  }
  if (chatButton && chatPanel) {
    chatButton.addEventListener('click', function () {
      if (chatPanel.hidden) openChat(true); else closeChat();
    });
    one('.chat-sluit', chatPanel).addEventListener('click', closeChat);
    one('.chat-formulier', chatPanel).addEventListener('submit', function (event) {
      event.preventDefault();
      var text = chatInput.value.trim();
      if (!text) return;
      if (socket && socket.readyState === 1) socket.send(JSON.stringify({ bericht: text }));
      chatLine('U', text);
      chatInput.value = '';
    });
    /*@bad 2.1.2-chat*/
    chatInput.addEventListener('keydown', function (event) {
      if (event.key === 'Tab') event.preventDefault();
    });
    /*@good*/
    // While the chat is open, Escape closes it from anywhere and Tab stays inside it.
    var chatRoot = one('.chat');
    doc.addEventListener('keydown', function (event) {
      if (chatPanel.hidden) return;
      if (event.key === 'Escape') { closeChat(); return; }
      if (event.key !== 'Tab') return;
      var stops = all('button, input, [tabindex="0"]', chatRoot);
      var first = stops[0];
      var last = stops[stops.length - 1];
      var inside = chatRoot.contains(doc.activeElement);
      var target = null;
      if (event.shiftKey && (!inside || doc.activeElement === first)) target = last;
      if (!event.shiftKey && (!inside || doc.activeElement === last)) target = first;
      if (target) { event.preventDefault(); target.focus(); }
    });
    /*@end*/
  }

  /*@bad 2.1.4-sneltoets*/
  doc.addEventListener('keydown', function (event) {
    var target = event.target;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    if (event.key === 'z') {
      event.preventDefault();
      one('.zoekbalk input').focus();
    }
    if (event.key === 'c' && chatPanel && chatPanel.hidden) openChat(false);
  });
  /*@good*//*@end*/

  // Highlighted items on the start page
  var slides = all('.dia');
  if (slides.length > 1) {
    var current = 0;
    var show = function (index) {
      current = (index + slides.length) % slides.length;
      slides.forEach(function (slide, position) { slide.hidden = position !== current; });
      var counter = one('.dia-teller');
      if (counter) counter.textContent = (current + 1) + ' van ' + slides.length;
    };
    show(0);
    /*@bad 2.2.2-uitgelicht*/
    setInterval(function () { show(current + 1); }, 4000);
    /*@good*/
    one('.dia-vorige').addEventListener('click', function () { show(current - 1); });
    one('.dia-volgende').addEventListener('click', function () { show(current + 1); });
    /*@end*/
  }

  /*@bad 2.1.1-nieuwskaart*/
  var cardList = one('.kaartenlijst');
  if (cardList) {
    cardList.addEventListener('click', function (event) {
      var card = event.target.closest('[data-doel]');
      if (card) location.href = card.getAttribute('data-doel');
    });
  }
  /*@good*//*@end*/

  // Photo series in an article
  var gallery = one('.galerij');
  if (gallery) {
    var photos = all('.galerij-foto', gallery);
    var photoIndex = 0;
    var showPhoto = function (index) {
      photoIndex = (index + photos.length) % photos.length;
      photos.forEach(function (photo, position) { photo.hidden = position !== photoIndex; });
      one('.galerij-teller', gallery).textContent = 'Foto ' + (photoIndex + 1) + ' van ' + photos.length;
    };
    showPhoto(0);
    /*@bad 2.5.1-galerij*/
    var startX = null;
    gallery.addEventListener('pointerdown', function (event) { startX = event.clientX; });
    gallery.addEventListener('pointerup', function (event) {
      if (startX === null) return;
      var moved = event.clientX - startX;
      startX = null;
      if (moved < -40) showPhoto(photoIndex + 1);
      if (moved > 40) showPhoto(photoIndex - 1);
    });
    /*@good*/
    one('.galerij-vorige', gallery).addEventListener('click', function () { showPhoto(photoIndex - 1); });
    one('.galerij-volgende', gallery).addEventListener('click', function () { showPhoto(photoIndex + 1); });
    /*@end*/
  }

  // Questions and answers
  all('.vraag').forEach(function (button) {
    var panel = doc.getElementById(button.getAttribute('data-paneel'));
    button.addEventListener('click', function () {
      var open = panel.hidden;
      panel.hidden = !open;
      /*@bad 4.1.2-uitklapper*//*@good*/button.setAttribute('aria-expanded', String(open));/*@end*/
    });
  });
  var feedback = one('.feedback');
  if (feedback) {
    all('button', feedback).forEach(function (button) {
      /*@bad 2.5.2-feedback*/button.addEventListener('pointerdown', function () {/*@good*/button.addEventListener('click', function () {/*@end*/
        one('.feedback-dank', feedback).textContent = 'Bedankt voor uw reactie.';
        all('button', feedback).forEach(function (other) { other.disabled = true; });
      });
    });
  }

  // Tabs
  var tabs = all('.tab');
  if (tabs.length) {
    var selectTab = function (tab, moveFocus) {
      tabs.forEach(function (other) {
        var active = other === tab;
        other.classList.toggle('actief', active);
        doc.getElementById(other.getAttribute('data-paneel')).hidden = !active;
        /*@bad 4.1.2-tabs*//*@good*/
        other.setAttribute('aria-selected', String(active));
        other.tabIndex = active ? 0 : -1;
        /*@end*/
      });
      if (moveFocus) tab.focus();
    };
    tabs.forEach(function (tab, position) {
      tab.addEventListener('click', function () { selectTab(tab, false); });
      /*@bad 4.1.2-tabs*//*@good*/
      tab.addEventListener('keydown', function (event) {
        if (event.key === 'ArrowRight') selectTab(tabs[(position + 1) % tabs.length], true);
        if (event.key === 'ArrowLeft') selectTab(tabs[(position - 1 + tabs.length) % tabs.length], true);
      });
      /*@end*/
    });
  }
  var district = one('#wijk');
  if (district) {
    var days = { centrum: 'maandag', noord: 'dinsdag', zuid: 'donderdag' };
    var chosen = param('wijk');
    if (days[chosen]) {
      district.value = chosen;
      one('.ophaaldag').textContent = 'In uw wijk halen wij het restafval op ' + days[chosen] + ' op.';
    }
    /*@bad 3.2.2-wijk*/
    district.addEventListener('change', function () {
      if (district.value) location.href = '/afval.html?wijk=' + district.value;
    });
    /*@good*//*@end*/
  }

  // Products
  var grid = one('.kaartrooster');
  if (grid) {
    var products = all('.product', grid);
    var filterInput = one('#productfilter');
    var count = one('.aantal');
    var maxPrice = 150;
    var applyFilter = function () {
      var needle = filterInput.value.trim().toLowerCase();
      var visible = 0;
      products.forEach(function (product) {
        var matches = product.textContent.toLowerCase().indexOf(needle) !== -1 && Number(product.getAttribute('data-prijs')) <= maxPrice;
        product.hidden = !matches;
        if (matches) visible++;
      });
      count.textContent = visible + (visible === 1 ? ' product gevonden' : ' producten gevonden');
    };
    filterInput.addEventListener('input', applyFilter);
    /*@bad 2.5.7-schuif*/
    var track = one('.schuif-spoor');
    var thumb = one('.schuif-knop');
    var dragging = false;
    var setFromPointer = function (event) {
      var box = track.getBoundingClientRect();
      var share = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
      maxPrice = Math.round(share * 15) * 10;
      thumb.style.left = (maxPrice / 150 * 100) + '%';
      one('.schuif-waarde').textContent = maxPrice + ' euro';
      applyFilter();
    };
    thumb.addEventListener('pointerdown', function (event) { dragging = true; thumb.setPointerCapture(event.pointerId); });
    thumb.addEventListener('pointermove', function (event) { if (dragging) setFromPointer(event); });
    thumb.addEventListener('pointerup', function () { dragging = false; });
    /*@good*/
    var range = one('#maxprijs');
    range.addEventListener('input', function () {
      maxPrice = Number(range.value);
      one('.schuif-waarde').textContent = maxPrice + ' euro';
      applyFilter();
    });
    /*@end*/
    var detail = one('.venster');
    var fillDetail = function (product) {
      one('.venster-titel', detail).textContent = one('h2', product).textContent;
      one('.venster-tekst', detail).textContent = product.getAttribute('data-uitleg');
    };
    /*@bad 2.1.1-productkaart*/
    var veil = one('.sluier');
    grid.addEventListener('click', function (event) {
      var product = event.target.closest('[data-product]');
      if (!product) return;
      fillDetail(product);
      detail.hidden = false;
      veil.hidden = false;
    });
    var closeDetail = function () { detail.hidden = true; veil.hidden = true; };
    one('.venster-sluit', detail).addEventListener('click', closeDetail);
    veil.addEventListener('click', closeDetail);
    /*@good*/
    all('.kaart-knop', grid).forEach(function (button) {
      button.addEventListener('click', function () {
        fillDetail(button.closest('.product'));
        detail.showModal();
      });
    });
    one('.venster-sluit', detail).addEventListener('click', function () { detail.close(); });
    /*@end*/
  }

  // Opening hours
  /*@bad 1.4.13-uitleg*//*@good*/
  var infoButton = one('button.info');
  if (infoButton) {
    infoButton.addEventListener('click', function () {
      var note = doc.getElementById(infoButton.getAttribute('aria-controls'));
      note.hidden = !note.hidden;
      infoButton.setAttribute('aria-expanded', String(!note.hidden));
    });
  }
  /*@end*/

  // Search
  var results = one('.zoekresultaten');
  if (results) {
    var index = [
      { titel: 'Afval en grondstoffen', url: '/afval.html', tekst: 'afval restafval papier groente tuin ophaaldag wijk container' },
      { titel: 'Producten en diensten', url: '/producten.html', tekst: 'paspoort identiteitskaart rijbewijs uittreksel parkeren vergunning producten' },
      { titel: 'Parkeervergunning aanvragen', url: '/vergunning.html', tekst: 'parkeren parkeervergunning vergunning kenteken aanvragen' },
      { titel: 'Openingstijden', url: '/openingstijden.html', tekst: 'openingstijden gemeentehuis balie afval milieustraat paspoort' },
      { titel: 'Veelgestelde vragen', url: '/veelgestelde-vragen.html', tekst: 'vragen paspoort verhuizen afval tarieven parkeren' },
      { titel: 'Nieuwe fietsenstalling bij het station', url: '/nieuws/nieuwe-fietsenstalling.html', tekst: 'nieuws fietsenstalling station fiets parkeren' },
      { titel: 'Zomerfeest op het Marktplein', url: '/nieuws/zomerfeest.html', tekst: 'nieuws zomerfeest marktplein muziek' },
      { titel: 'Werkzaamheden aan de Dorpsstraat', url: '/nieuws/werkzaamheden-dorpsstraat.html', tekst: 'nieuws werkzaamheden dorpsstraat weg afval omleiding parkeren' },
      { titel: 'Raadsvergadering terugkijken', url: '/raadsvergadering.html', tekst: 'raad raadsvergadering video terugkijken gemeenteraad' },
      { titel: 'Contact', url: '/contact.html', tekst: 'contact bellen bericht formulier adres' }
    ];
    var query = param('q').trim();
    var info = one('.zoek-aantal');
    one('#zoekterm').value = query;
    if (query) {
      var resultsHeading = one('.zoek-kop');
      if (resultsHeading) resultsHeading.hidden = false;
      var needle = query.toLowerCase();
      var hits = index.filter(function (entry) { return (entry.titel + ' ' + entry.tekst).toLowerCase().indexOf(needle) !== -1; });
      hits.forEach(function (entry) {
        var item = doc.createElement('li');
        var heading = doc.createElement('h3');
        var link = doc.createElement('a');
        link.href = entry.url;
        link.textContent = entry.titel;
        heading.appendChild(link);
        item.appendChild(heading);
        results.appendChild(item);
      });
      info.textContent = hits.length + (hits.length === 1 ? ' resultaat' : ' resultaten') + ' voor "' + query + '"';
    } else {
      info.textContent = 'Typ een zoekwoord en kies Zoeken.';
    }
  }

  // Contact form
  var contact = one('#contactformulier');
  if (contact) {
    var clearMarks = function () {
      all('.ongeldig', contact).forEach(function (field) { field.classList.remove('ongeldig'); field.removeAttribute('aria-invalid'); field.removeAttribute('aria-describedby'); });
      all('.veldmelding', contact).forEach(function (note) { note.remove(); });
      var list = one('.meldingenlijst', contact);
      if (list) list.remove();
    };
    var problems;
    var mark = function (field, text) {
      field.classList.add('ongeldig');
      problems.push({ field: field, text: text });
    };
    contact.addEventListener('submit', function (event) {
      clearMarks();
      problems = [];
      var name = one('#naam', contact);
      var mail = one('#email', contact);
      var date = one('#datum', contact);
      var message = one('#bericht', contact);
      if (!name.value.trim()) mark(name, 'Vul uw naam in.');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail.value.trim())) mark(mail, 'Vul een e-mailadres in, bijvoorbeeld naam@voorbeeld.nl.');
      if (date.value.trim() && !/^\d{2}-\d{2}-\d{4}$/.test(date.value.trim())) mark(date, 'Vul de datum in als dag-maand-jaar, bijvoorbeeld 03-11-2026.');
      if (!message.value.trim()) mark(message, 'Vul uw bericht in.');
      if (problems.length === 0) return;
      event.preventDefault();
      /*@bad 3.3.3-datum*/
      if (date.classList.contains('ongeldig')) {
        var short = doc.createElement('p');
        short.className = 'veldmelding';
        short.textContent = 'Ongeldige invoer.';
        date.insertAdjacentElement('afterend', short);
      }
      /*@good*//*@end*/
      /*@bad 3.3.1-rode-rand*//*@good*/
      var list = doc.createElement('div');
      list.className = 'meldingenlijst';
      list.setAttribute('role', 'alert');
      var heading = doc.createElement('p');
      heading.textContent = 'Het formulier is nog niet verstuurd. Controleer deze velden:';
      list.appendChild(heading);
      var items = doc.createElement('ul');
      problems.forEach(function (problem) {
        var id = problem.field.id + '-melding';
        var note = doc.createElement('p');
        note.className = 'veldmelding';
        note.id = id;
        note.textContent = problem.text;
        problem.field.insertAdjacentElement('afterend', note);
        problem.field.setAttribute('aria-invalid', 'true');
        problem.field.setAttribute('aria-describedby', id);
        var item = doc.createElement('li');
        var link = doc.createElement('a');
        link.href = '#' + problem.field.id;
        link.textContent = problem.text;
        item.appendChild(link);
        items.appendChild(item);
      });
      list.appendChild(items);
      contact.insertBefore(list, contact.firstChild);
      problems[0].field.focus();
      /*@end*/
    });
    /*@bad 2.2.1-tijdslimiet*/
    var clock = one('.tijdslimiet-rest');
    var left = 600;
    setInterval(function () {
      left--;
      if (left <= 0) { location.href = '/'; return; }
      clock.textContent = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
    }, 1000);
    /*@good*//*@end*/
  }

  // Permit request in steps
  var permit = one('#vergunningformulier');
  if (permit) {
    var steps = all('.stap', permit);
    var goTo = function (number) {
      steps.forEach(function (step, position) { step.hidden = position !== number; });
      var heading = one('h2', steps[number]);
      heading.tabIndex = -1;
      heading.focus();
    };
    all('[data-stap]', permit).forEach(function (button) {
      button.addEventListener('click', function () {
        var number = Number(button.getAttribute('data-stap'));
        /*@bad 3.3.7-adres*//*@good*/
        if (number === 1) {
          var same = one('#zelfde-adres', permit);
          var copy = function () {
            if (!same.checked) return;
            one('#factuurstraat', permit).value = one('#straat', permit).value;
            one('#factuurpostcode', permit).value = one('#postcode', permit).value;
          };
          same.onchange = copy;
          copy();
        }
        /*@end*/
        /*@bad 3.3.4-controle*//*@good*/
        if (number === 2) {
          all('[data-toon]', permit).forEach(function (cell) {
            cell.textContent = one('#' + cell.getAttribute('data-toon'), permit).value || '(niet ingevuld)';
          });
        }
        /*@end*/
        goTo(number);
      });
    });
  }
})();
