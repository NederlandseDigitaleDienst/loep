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
    
    if (backdrop) backdrop.hidden = true;
    pageRoot.inert = false;
    var target = one('.skiplink');
    if (target) target.focus();
    
  }
  if (notice) {
    if (!storedChoice()) {
      notice.hidden = false;
      
      if (backdrop) backdrop.hidden = false;
      pageRoot.inert = true;
      one('button', notice).focus();
      
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
      menuButton.setAttribute('aria-expanded', String(open));
    });
  }

  

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
      socket = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/chat');
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
    
  }

  

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
    
    one('.dia-vorige').addEventListener('click', function () { show(current - 1); });
    one('.dia-volgende').addEventListener('click', function () { show(current + 1); });
    
  }

  

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
    
    one('.galerij-vorige', gallery).addEventListener('click', function () { showPhoto(photoIndex - 1); });
    one('.galerij-volgende', gallery).addEventListener('click', function () { showPhoto(photoIndex + 1); });
    
  }

  // Questions and answers
  all('.vraag').forEach(function (button) {
    var panel = doc.getElementById(button.getAttribute('data-paneel'));
    button.addEventListener('click', function () {
      var open = panel.hidden;
      panel.hidden = !open;
      button.setAttribute('aria-expanded', String(open));
    });
  });
  var feedback = one('.feedback');
  if (feedback) {
    all('button', feedback).forEach(function (button) {
      button.addEventListener('click', function () {
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
        
        other.setAttribute('aria-selected', String(active));
        other.tabIndex = active ? 0 : -1;
        
      });
      if (moveFocus) tab.focus();
    };
    tabs.forEach(function (tab, position) {
      tab.addEventListener('click', function () { selectTab(tab, false); });
      
      tab.addEventListener('keydown', function (event) {
        if (event.key === 'ArrowRight') selectTab(tabs[(position + 1) % tabs.length], true);
        if (event.key === 'ArrowLeft') selectTab(tabs[(position - 1 + tabs.length) % tabs.length], true);
      });
      
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
    
    var range = one('#maxprijs');
    range.addEventListener('input', function () {
      maxPrice = Number(range.value);
      one('.schuif-waarde').textContent = maxPrice + ' euro';
      applyFilter();
    });
    
    var detail = one('.venster');
    var fillDetail = function (product) {
      one('.venster-titel', detail).textContent = one('h2', product).textContent;
      one('.venster-tekst', detail).textContent = product.getAttribute('data-uitleg');
    };
    
    all('.kaart-knop', grid).forEach(function (button) {
      button.addEventListener('click', function () {
        fillDetail(button.closest('.product'));
        detail.showModal();
      });
    });
    one('.venster-sluit', detail).addEventListener('click', function () { detail.close(); });
    
  }

  // Opening hours
  
  var infoButton = one('button.info');
  if (infoButton) {
    infoButton.addEventListener('click', function () {
      var note = doc.getElementById(infoButton.getAttribute('aria-controls'));
      note.hidden = !note.hidden;
      infoButton.setAttribute('aria-expanded', String(!note.hidden));
    });
  }
  

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
      
    });
    
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
        
        
        if (number === 2) {
          all('[data-toon]', permit).forEach(function (cell) {
            cell.textContent = one('#' + cell.getAttribute('data-toon'), permit).value || '(niet ingevuld)';
          });
        }
        
        goTo(number);
      });
    });
  }
})();
