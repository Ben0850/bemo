// ===== Configuration =====
let STATIONS = ['Alsdorf', 'Baesweiler', 'Merkstein', 'Aussendienst'];
// CAL_STATIONS removed - calendar is now staff-based
let ALL_STATIONS = [];
const VEHICLE_TYPES = ['PKW', 'LKW', 'Krad', 'Anhänger', 'LOF', 'Wohnmobil', 'Bus'];
const CUSTOMER_TYPES = ['Privatkunde', 'Firmenkunde', 'Werkstatt'];

// Helper: Display name based on customer type
function customerDisplayName(c) {
  if (c.customer_type === 'Firmenkunde' || c.customer_type === 'Werkstatt') {
    return escapeHtml(c.company_name || '');
  }
  return escapeHtml(c.last_name) + ', ' + escapeHtml(c.first_name);
}

// ===== State =====
let currentPage = 'dashboard';
let currentCustomerId = null;
let currentAkteId = null;
let loggedInUser = null;
let autoRefreshTimer = null;

function isAdmin() {
  return loggedInUser && loggedInUser.permission_level === 'Admin';
}
function isVerwaltung() {
  return loggedInUser && (loggedInUser.permission_level === 'Verwaltung' || loggedInUser.permission_level === 'Admin');
}
function isBuchhaltung() {
  return loggedInUser && (loggedInUser.permission_level === 'Buchhaltung' || loggedInUser.permission_level === 'Admin');
}
function canEditInvoice() {
  return loggedInUser && (
    loggedInUser.permission_level === 'Verwaltung' ||
    loggedInUser.permission_level === 'Buchhaltung' ||
    loggedInUser.permission_level === 'Admin'
  );
}

async function loadStations() {
  try {
    ALL_STATIONS = await api('/api/stations');
    STATIONS = ALL_STATIONS.map(s => s.name);
    // CAL_STATIONS removed - calendar is now staff-based
  } catch (e) {
    // Fallback to hardcoded
    ALL_STATIONS = [
      { name: 'Alsdorf', color: 'blue', sort_order: 1, show_on_dashboard: 1, is_calendar_station: 1 },
      { name: 'Baesweiler', color: 'green', sort_order: 2, show_on_dashboard: 1, is_calendar_station: 1 },
      { name: 'Merkstein', color: 'yellow', sort_order: 3, show_on_dashboard: 1, is_calendar_station: 1 },
      { name: 'Aussendienst', color: 'gray', sort_order: 4, show_on_dashboard: 0, is_calendar_station: 1 }
    ];
    STATIONS = ['Alsdorf', 'Baesweiler', 'Merkstein', 'Aussendienst'];
    // CAL_STATIONS removed - calendar is now staff-based
  }
}

// ===== API Helper =====
async function api(url, options = {}) {
  const config = {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  };
  if (loggedInUser) {
    config.headers['X-User-Permission'] = loggedInUser.permission_level || 'Benutzer';
    config.headers['X-User-Id'] = String(loggedInUser.id || '');
  }
  if (config.body && typeof config.body === 'object') {
    config.body = JSON.stringify(config.body);
  }
  const res = await fetch(url, config);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Fehler bei der Anfrage');
  return data;
}

// ===== Toast Notifications =====
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ===== Modal =====
function openModal(title, bodyHtml, extraClass) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHtml;
  const modal = document.getElementById('modal');
  modal.className = 'modal' + (extraClass ? ' ' + extraClass : '');
  document.getElementById('modal-overlay').classList.add('active');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('active');
  document.getElementById('modal').className = 'modal';
  // Sofort aktualisieren wenn auf Zeiterfassungsseite
  if (currentPage === 'time-tracking') renderTimeTracking();
}

// ===== Navigation =====
function startAutoRefresh() {
  stopAutoRefresh();
  autoRefreshTimer = setInterval(() => {
    // Don't refresh while a modal is open
    if (document.getElementById('modal-overlay')?.classList.contains('active')) return;
    if (currentPage === 'dashboard') silentRefreshDashboard();
    else if (currentPage === 'calendar') silentRefreshCalendar();
    else if (currentPage === 'time-tracking') silentRefreshTimeTracking();
  }, 10000);
}

function stopAutoRefresh() {
  if (autoRefreshTimer) { clearInterval(autoRefreshTimer); autoRefreshTimer = null; }
}

// ===== Mobile Menu =====
const MOBILE_PAGES = ['dashboard', 'time-tracking', 'calendar'];

function isMobileView() {
  return window.innerWidth <= 768;
}

function updateMobileNav() {
  const mobile = isMobileView();
  // Mark submenus that have no mobile-visible children
  document.querySelectorAll('.nav-item-has-submenu').forEach(item => {
    if (item.id) return; // items with IDs are handled by CSS
    if (!mobile) { item.classList.remove('mobile-hidden'); return; }
    const hasVisibleChild = Array.from(item.querySelectorAll('.nav-submenu .nav-link')).some(link => {
      return MOBILE_PAGES.includes(link.dataset.page);
    });
    item.classList.toggle('mobile-hidden', !hasVisibleChild);
  });
}

window.addEventListener('resize', updateMobileNav);
document.addEventListener('DOMContentLoaded', updateMobileNav);

function toggleMobileMenu() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('mobile-overlay');
  const btn = document.getElementById('hamburger-btn');
  const isOpen = sidebar.classList.toggle('mobile-open');
  overlay.classList.toggle('active', isOpen);
  btn.classList.toggle('open', isOpen);
}

function closeMobileMenu() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('mobile-overlay');
  const btn = document.getElementById('hamburger-btn');
  sidebar.classList.remove('mobile-open');
  overlay.classList.remove('active');
  btn.classList.remove('open');
}

function navigate(page, data) {
  // On mobile, redirect non-mobile pages to dashboard
  if (isMobileView() && !MOBILE_PAGES.includes(page)) {
    page = 'dashboard';
  }
  closeMobileMenu();

  currentPage = page;
  document.querySelectorAll('.nav-link').forEach(link => {
    link.classList.toggle('active', link.dataset.page === page);
  });

  // Auto-open/close submenu based on active page
  document.querySelectorAll('.nav-item-has-submenu').forEach(item => {
    const hasActivePage = item.querySelector(`.nav-link[data-page="${page}"]`);
    item.classList.toggle('open', !!hasActivePage);
  });

  // Auto-refresh for dashboard, calendar and time-tracking
  if (page === 'dashboard' || page === 'calendar' || page === 'time-tracking') startAutoRefresh();
  else stopAutoRefresh();

  const main = document.getElementById('main-content');
  main.innerHTML = '<div class="loading">Laden...</div>';

  switch (page) {
    case 'dashboard': renderDashboard(); break;
    case 'customers': renderCustomers(); break;
    case 'customer-detail': renderCustomerDetail(data); break;
    case 'insurances': renderInsurances(); break;
    case 'lawyers': renderLawyers(); break;
    case 'vermittler': renderVermittler(); break;
    case 'akten': renderAkten(); break;
    case 'akte-detail': renderAkteDetail(data); break;
    case 'calendar': renderCalendar(); break;
    case 'vacation': renderVacation(); break;
    case 'vacation-requests': renderVacationRequests(); break;
    case 'invoices': renderInvoices(); break;
    case 'invoice-detail': renderInvoiceDetail(data); break;
    case 'gutschriften': renderCreditNotes(); break;
    case 'credit-detail': renderCreditNoteDetail(data); break;
    case 'changelog': renderChangelog(); break;
    case 'tickets': renderTickets(); break;
    case 'suggestions': renderSuggestions(); break;
    case 'vermietung': renderVermietung(); break;
    case 'fuhrpark': renderFuhrpark(); break;
    case 'fuhrpark-detail': renderFuhrparkDetail(data); break;
    case 'time-tracking': renderTimeTracking(); break;
    case 'testseite': renderTestseite(); break;
    case 'staff': renderStaff(); break;
    case 'settings-company': renderSettingsCompany(); break;
    case 'settings-program': renderSettingsProgram(); break;
    case 'settings': renderSettingsCompany(); break;
    default: renderDashboard();
  }
}

// ===== Utility =====
function formatDate(dateStr) {
  if (!dateStr) return '-';
  const dateOnly = dateStr.split('T')[0].split(' ')[0];
  const d = new Date(dateOnly + 'T00:00:00');
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatMonthOnly(dateStr) {
  if (!dateStr) return '-';
  // Handle both "YYYY-MM" and "YYYY-MM-DD" formats
  const parts = dateStr.split('-');
  if (parts.length < 2) return '-';
  const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, 1);
  return d.toLocaleDateString('de-DE', { month: '2-digit', year: 'numeric' });
}

function formatMonthYear(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function sanitizeHtml(html) {
  if (!html) return '';
  const allowed = ['B', 'STRONG', 'I', 'EM', 'U', 'UL', 'OL', 'LI', 'P', 'BR', 'DIV', 'SPAN', 'H1', 'H2', 'H3', 'A', 'STRIKE', 'S'];
  const doc = new DOMParser().parseFromString(html, 'text/html');
  function clean(node) {
    const children = Array.from(node.childNodes);
    children.forEach(child => {
      if (child.nodeType === 3) return; // text node
      if (child.nodeType === 1) {
        if (!allowed.includes(child.tagName)) {
          // Replace disallowed element with its children
          while (child.firstChild) child.parentNode.insertBefore(child.firstChild, child);
          child.parentNode.removeChild(child);
        } else {
          // Remove all attributes except href on links
          Array.from(child.attributes).forEach(attr => {
            if (child.tagName === 'A' && attr.name === 'href') return;
            child.removeAttribute(attr.name);
          });
          if (child.tagName === 'A') {
            child.setAttribute('target', '_blank');
            child.setAttribute('rel', 'noopener');
          }
          clean(child);
        }
      } else {
        child.parentNode.removeChild(child);
      }
    });
  }
  clean(doc.body);
  return doc.body.innerHTML;
}

function getStationBadgeClass(station) {
  const found = ALL_STATIONS.find(s => s.name === station);
  if (found) return found.color || 'gray';
  const fallback = { 'Alsdorf': 'blue', 'Baesweiler': 'green', 'Merkstein': 'yellow', 'Aussendienst': 'gray', 'Allgemeine Termine': 'purple' };
  return fallback[station] || 'gray';
}

// ===== PAGE: Dashboard =====
let dashStationDayOffset = 0;

async function renderDashboard() {
  const main = document.getElementById('main-content');
  try {
    const timeStatus = await api('/api/time/status').catch(() => ({ stamped_in: false, on_pause: false, current_entry: null }));

    const firstName = (loggedInUser.name || '').split(' ')[0];
    const hour = new Date().getHours();
    const greetWord = hour < 12 ? 'Guten Morgen' : hour < 18 ? 'Guten Tag' : 'Guten Abend';
    const todayStr = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    const timeClass = timeStatus.stamped_in ? 'active' : timeStatus.on_pause ? 'paused' : 'idle';
    const timeIcon = timeStatus.stamped_in ? '&#9201;' : timeStatus.on_pause ? '&#9646;&#9646;' : '&#9711;';
    const timeLabel = timeStatus.stamped_in ? 'Eingestempelt seit' : timeStatus.on_pause ? 'Pause aktiv' : 'Zeiterfassung';
    const timeValue = timeStatus.stamped_in ? timeStatus.current_entry.start_time + ' Uhr' : timeStatus.on_pause ? 'In Pause' : 'Nicht aktiv';
    const timePulse = timeStatus.stamped_in ? '<span class="dash-pulse green"></span>' : timeStatus.on_pause ? '<span class="dash-pulse orange"></span>' : '';

    main.innerHTML = `
      <div class="dash">
        <div class="dash-hero">
          <div class="dash-hero-top">
            <div>
              <div class="dash-greeting"><span>${greetWord}, ${escapeHtml(firstName)}</span></div>
              <div class="dash-date">${todayStr}</div>
            </div>
            <div style="display:flex;gap:8px;align-items:center;">
              <span class="dash-role-chip">&#9823; ${escapeHtml(loggedInUser.permission_level || 'Benutzer')}</span>
              <button class="dash-pw-btn" onclick="openChangePasswordModal()">&#9881; Passwort</button>
            </div>
          </div>
          <div class="dash-time-strip">
            <div class="dash-time-card ${timeClass}" onclick="navigate('time-tracking')">
              <div class="dash-time-icon">${timePulse || timeIcon}</div>
              <div>
                <div class="dash-time-label">${timeLabel}</div>
                <div class="dash-time-value">${timeValue}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    main.innerHTML = `<div class="empty-state"><p>Fehler beim Laden: ${escapeHtml(err.message)}</p></div>`;
  }
}

async function silentRefreshDashboard() {
  if (currentPage !== 'dashboard') return;
  try {
    const main = document.getElementById('main-content');
    const scrollTop = main.scrollTop;
    const tmp = document.createElement('div');
    const oldMain = main;
    // Build new content in detached element to avoid flicker
    const savedMain = main.innerHTML;
    await renderDashboard();
    // renderDashboard already set main.innerHTML, restore scroll
    main.scrollTop = scrollTop;
    updateUnreadBadges();
  } catch (e) { /* silent */ }
}

async function silentRefreshCalendar() {
  if (currentPage !== 'calendar') return;
  // Don't refresh while calendar dropdown or search results are open
  const dd = document.getElementById('cal-col-dropdown');
  if (dd && dd.style.display !== 'none') return;
  const searchPanel = document.getElementById('cal-search-results');
  if (searchPanel && searchPanel.style.display !== 'none') return;
  const searchInput = document.getElementById('cal-search-input');
  if (searchInput && searchInput === document.activeElement) return;
  try {
    const main = document.getElementById('main-content');
    const scrollContainer = main.querySelector('div[style*="overflow-y"]');
    const scrollTop = scrollContainer ? scrollContainer.scrollTop : 0;
    const mainScrollTop = main.scrollTop;
    await renderCalendar();
    main.scrollTop = mainScrollTop;
    const newScrollContainer = main.querySelector('div[style*="overflow-y"]');
    if (newScrollContainer) newScrollContainer.scrollTop = scrollTop;
  } catch (e) { /* silent */ }
}

// ===== PAGE: Customers =====
async function renderCustomers() {
  const main = document.getElementById('main-content');

  main.innerHTML = `
    <div class="page-header">
      <h2>Kunden</h2>
      <div>
        <button class="btn btn-success" onclick="_scanReturnTo='customers'; openScanModal()">Fahrzeugschein scannen</button>
        <button class="btn btn-primary" onclick="openCustomerForm()">+ Neuer Kunde</button>
      </div>
    </div>

    <div class="card" style="margin-bottom:20px;">
      <div class="card-header"><h3>Suche</h3></div>
      <div class="filter-bar">
        <div class="form-group">
          <label>Kunde (Name, Telefon, E-Mail)</label>
          <input type="text" id="customer-search" placeholder="z.B. Mustermann">
        </div>
        <div class="form-group">
          <label>Kennzeichen</label>
          <input type="text" id="vehicle-search-plate" placeholder="z.B. AC-MM 123">
        </div>
        <div class="form-group">
          <label>Fahrgestellnummer</label>
          <input type="text" id="vehicle-search-vin" placeholder="z.B. WVWZZZ...">
        </div>
        <button class="btn btn-primary" onclick="executeSearch()">Suchen</button>
        <button class="btn btn-secondary" onclick="clearCustomerSearch()">Zurücksetzen</button>
      </div>
    </div>

    <div id="vehicle-search-results"></div>

    <div class="card">
      <div id="customer-table-content">
        <div class="loading">Laden...</div>
      </div>
    </div>
  `;

  document.querySelectorAll('#customer-search, #vehicle-search-plate, #vehicle-search-vin').forEach(el => {
    el.addEventListener('keydown', e => { if (e.key === 'Enter') executeSearch(); });
  });

  // Initial: alle Kunden laden
  loadCustomerTable('');
}

let _customerData = [];
let _customerSort = { field: 'id', dir: 'asc' };

async function loadCustomerTable(searchTerm) {
  const container = document.getElementById('customer-table-content');
  try {
    let url = searchTerm ? `/api/customers?search=${encodeURIComponent(searchTerm)}` : '/api/customers';
    _customerData = await api(url);
    renderCustomerTable();
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>Fehler: ${escapeHtml(err.message)}</p></div>`;
  }
}

function sortCustomers(field) {
  if (_customerSort.field === field) {
    _customerSort.dir = _customerSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    _customerSort.field = field;
    _customerSort.dir = 'asc';
  }
  renderCustomerTable();
}

function customerSortValue(c, field) {
  switch(field) {
    case 'id': return c.id;
    case 'name': return customerDisplayName(c).toLowerCase();
    case 'type': return (c.customer_type || '').toLowerCase();
    case 'city': return (c.city || '').toLowerCase();
    case 'zip': return c.zip || '';
    case 'phone': return c.phone || '';
    case 'email': return (c.email || '').toLowerCase();
    default: return '';
  }
}

function customerSortIcon(field) {
  if (_customerSort.field !== field) return '<span style="opacity:0.3;">&#9650;</span>';
  return _customerSort.dir === 'asc' ? '<span>&#9650;</span>' : '<span>&#9660;</span>';
}

function renderCustomerTable() {
  const container = document.getElementById('customer-table-content');
  if (!container) return;
  const customers = [..._customerData];

  customers.sort((a, b) => {
    let va = customerSortValue(a, _customerSort.field);
    let vb = customerSortValue(b, _customerSort.field);
    if (typeof va === 'number') return _customerSort.dir === 'asc' ? va - vb : vb - va;
    va = String(va); vb = String(vb);
    return _customerSort.dir === 'asc' ? va.localeCompare(vb, 'de') : vb.localeCompare(va, 'de');
  });

  if (customers.length > 0) {
    const thStyle = 'cursor:pointer;user-select:none;white-space:nowrap;';
    container.innerHTML = `
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th style="${thStyle}" onclick="sortCustomers('id')">Nr. ${customerSortIcon('id')}</th>
              <th style="${thStyle}" onclick="sortCustomers('name')">Name ${customerSortIcon('name')}</th>
              <th style="${thStyle}" onclick="sortCustomers('type')">Typ ${customerSortIcon('type')}</th>
              <th style="${thStyle}" onclick="sortCustomers('zip')">PLZ ${customerSortIcon('zip')}</th>
              <th style="${thStyle}" onclick="sortCustomers('city')">Ort ${customerSortIcon('city')}</th>
              <th style="${thStyle}" onclick="sortCustomers('phone')">Telefon ${customerSortIcon('phone')}</th>
              <th style="${thStyle}" onclick="sortCustomers('email')">E-Mail ${customerSortIcon('email')}</th>
              <th>Aktionen</th>
            </tr>
          </thead>
          <tbody>
            ${customers.map(c => `
              <tr class="clickable" onclick="navigate('customer-detail', ${c.id})">
                <td>${c.id}</td>
                <td><strong>${customerDisplayName(c)}</strong></td>
                <td>${c.customer_type !== 'Privatkunde' ? `<span class="badge badge-blue">${escapeHtml(c.customer_type)}</span>` : 'Privat'}</td>
                <td>${escapeHtml(c.zip)}</td>
                <td>${escapeHtml(c.city)}</td>
                <td>${escapeHtml(c.phone)}</td>
                <td>${escapeHtml(c.email)}</td>
                <td>
                  <div style="display:flex;gap:6px;white-space:nowrap;">
                    <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation(); openCustomerForm(${c.id})">Bearbeiten</button>
                    ${isAdmin() ? `<button class="btn btn-sm btn-danger" onclick="event.stopPropagation(); deleteCustomer(${c.id}, '${escapeHtml(c.last_name)}')">Löschen</button>` : ''}
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`;
  } else {
    container.innerHTML = `
      <div class="empty-state">
        <p>Keine Kunden gefunden.</p>
        <button class="btn btn-primary" onclick="openCustomerForm()">Ersten Kunden anlegen</button>
      </div>`;
  }
}

async function loadVehicleResults(plate, vin) {
  const container = document.getElementById('vehicle-search-results');
  if (!plate && !vin) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = '<div class="card"><div class="loading">Fahrzeuge suchen...</div></div>';

  const params = new URLSearchParams();
  if (plate) params.set('license_plate', plate);
  if (vin) params.set('vin', vin);

  try {
    const results = await api(`/api/vehicles/search?${params}`);
    if (results.length === 0) {
      container.innerHTML = `<div class="card" style="margin-bottom:20px;"><div class="empty-state"><p>Kein Fahrzeug gefunden.</p></div></div>`;
      return;
    }
    container.innerHTML = `
      <div class="card" style="margin-bottom:20px;">
        <div class="card-header"><h3>Fahrzeug-Treffer (${results.length})</h3></div>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Kennzeichen</th>
                <th>Hersteller</th>
                <th>Typ</th>
                <th>FIN</th>
                <th>Kunde</th>
                <th>Telefon</th>
              </tr>
            </thead>
            <tbody>
              ${results.map(v => `
                <tr class="clickable" onclick="navigate('customer-detail', ${v.customer_id})">
                  <td><strong>${escapeHtml(v.license_plate) || '-'}</strong></td>
                  <td>${escapeHtml(v.manufacturer)}</td>
                  <td>${escapeHtml(v.model)}</td>
                  <td style="font-family:monospace;font-size:12px;">${escapeHtml(v.vin) || '-'}</td>
                  <td>${customerDisplayName(v)}</td>
                  <td>${v.phone ? `<a href="tel:${escapeHtml(v.phone)}" onclick="event.stopPropagation()">${escapeHtml(v.phone)}</a>` : '-'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="card" style="margin-bottom:20px;"><div class="empty-state"><p>Fehler: ${escapeHtml(err.message)}</p></div></div>`;
  }
}

function executeSearch() {
  const term = document.getElementById('customer-search').value.trim();
  const plate = document.getElementById('vehicle-search-plate').value.trim();
  const vin = document.getElementById('vehicle-search-vin').value.trim();

  loadCustomerTable(term);
  loadVehicleResults(plate, vin);
}

function clearCustomerSearch() {
  document.getElementById('customer-search').value = '';
  document.getElementById('vehicle-search-plate').value = '';
  document.getElementById('vehicle-search-vin').value = '';
  document.getElementById('vehicle-search-results').innerHTML = '';
  loadCustomerTable('');
}

async function openCustomerForm(id) {
  let customer = { first_name: '', last_name: '', street: '', zip: '', city: '', phone: '', email: '', notes: '', customer_type: 'Privatkunde', company_name: '', contact_person: '', contact_phone: '' };

  if (id) {
    try {
      const data = await api(`/api/customers/${id}`);
      customer = data;
    } catch (err) {
      showToast('Fehler beim Laden des Kunden', 'error');
      return;
    }
  }

  const title = id ? 'Kunde bearbeiten' : 'Neuer Kunde';
  const isCompany = customer.customer_type === 'Firmenkunde' || customer.customer_type === 'Werkstatt';
  const html = `
    <form id="customer-form" onsubmit="saveCustomer(event, ${id || 'null'})">
      <div style="background:var(--bg);border-radius:var(--radius);padding:14px 16px;margin-bottom:12px;">
        <div style="font-size:12px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px;">Kundendaten</div>
        <div style="display:grid;grid-template-columns:${id ? '100px ' : ''}1fr 1fr;gap:10px 16px;">
          ${id ? `<div class="form-group"><label>Kd.-Nr.</label><input type="text" value="${id}" disabled style="background:#f0f0f0;font-weight:bold;"></div>` : ''}
          <div class="form-group"><label>Kundentyp *</label>
            <select name="customer_type" onchange="toggleCustomerTypeFields(this.value)">
              ${CUSTOMER_TYPES.map(t => `<option value="${t}" ${customer.customer_type === t ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
          </div>
        </div>
        <div id="company-name-group" style="display:${isCompany ? '' : 'none'};">
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px 16px;">
            <div class="form-group"><label>Firmenname *</label><input type="text" name="company_name" value="${escapeHtml(customer.company_name || '')}"></div>
            <div class="form-group"><label>Ansprechpartner</label><input type="text" name="contact_person" value="${escapeHtml(customer.contact_person || '')}"></div>
            <div class="form-group"><label>Tel. Ansprechpartner</label><input type="text" name="contact_phone" value="${escapeHtml(customer.contact_phone || '')}"></div>
          </div>
        </div>
        <div id="private-name-group" style="display:${isCompany ? 'none' : ''};">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 16px;">
            <div class="form-group"><label>Vorname *</label><input type="text" name="first_name" value="${escapeHtml(customer.first_name)}"></div>
            <div class="form-group"><label>Nachname *</label><input type="text" name="last_name" value="${escapeHtml(customer.last_name)}"></div>
          </div>
        </div>
      </div>
      <div style="background:var(--bg);border-radius:var(--radius);padding:14px 16px;">
        <div style="font-size:12px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px;">Kontaktdaten</div>
        <div style="display:grid;grid-template-columns:1fr 90px 1fr;gap:10px 16px;">
          <div class="form-group"><label>Straße</label><input type="text" name="street" value="${escapeHtml(customer.street)}"></div>
          <div class="form-group"><label>PLZ</label><input type="text" name="zip" value="${escapeHtml(customer.zip)}"></div>
          <div class="form-group"><label>Ort</label><input type="text" name="city" value="${escapeHtml(customer.city)}"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 16px;">
          <div class="form-group"><label>Telefon/Handy</label><input type="text" name="phone" value="${escapeHtml(customer.phone)}"></div>
          <div class="form-group"><label>E-Mail</label><input type="email" name="email" value="${escapeHtml(customer.email)}"></div>
        </div>
        <div class="form-group"><label>Notizen</label><textarea name="notes" rows="2">${escapeHtml(customer.notes)}</textarea></div>
      </div>
      <div style="display:flex;gap:10px;margin-top:16px;">
        <button type="submit" class="btn btn-primary">${id ? 'Speichern' : 'Anlegen'}</button>
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Abbrechen</button>
      </div>
    </form>
  `;
  openModal(title, html);
}

function toggleCustomerTypeFields(type) {
  const isCompany = type === 'Firmenkunde' || type === 'Werkstatt';
  const form = document.getElementById('customer-form');
  if (isCompany && !form.company_name.value.trim()) {
    const parts = [form.first_name.value.trim(), form.last_name.value.trim()].filter(Boolean);
    if (parts.length) form.company_name.value = parts.join(' ');
  } else if (!isCompany && !form.first_name.value.trim() && !form.last_name.value.trim()) {
    const company = form.company_name.value.trim();
    if (company) form.last_name.value = company;
  }
  document.getElementById('company-name-group').style.display = isCompany ? '' : 'none';
  document.getElementById('private-name-group').style.display = isCompany ? 'none' : '';
}

async function saveCustomer(e, id) {
  e.preventDefault();
  const form = e.target;
  const customerType = form.customer_type.value;
  const isCompany = customerType === 'Firmenkunde' || customerType === 'Werkstatt';

  if (isCompany && !form.company_name.value.trim()) {
    showToast('Bitte Firmennamen eingeben', 'error');
    return;
  }
  if (!isCompany && (!form.first_name.value.trim() || !form.last_name.value.trim())) {
    showToast('Bitte Vor- und Nachname eingeben', 'error');
    return;
  }

  const data = {
    customer_type: customerType,
    company_name: form.company_name.value.trim(),
    first_name: isCompany ? '' : form.first_name.value.trim(),
    last_name: isCompany ? '' : form.last_name.value.trim(),
    street: form.street.value.trim(),
    zip: form.zip.value.trim(),
    city: form.city.value.trim(),
    phone: form.phone.value.trim(),
    email: form.email.value.trim(),
    notes: form.notes.value.trim(),
    contact_person: form.contact_person.value.trim(),
    contact_phone: form.contact_phone.value.trim(),
  };

  try {
    if (id) {
      await api(`/api/customers/${id}`, { method: 'PUT', body: data });
      showToast('Kunde aktualisiert');
    } else {
      await api('/api/customers', { method: 'POST', body: data });
      showToast('Kunde angelegt');
    }
    closeModal();
    if (currentPage === 'customer-detail') {
      renderCustomerDetail(id);
    } else {
      loadCustomerTable('');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}


async function deleteCustomer(id, name) {
  if (!confirm(`Kunde "${name}" wirklich löschen? Alle zugehörigen Fahrzeuge und Prüfungen werden ebenfalls gelöscht.`)) return;
  try {
    await api(`/api/customers/${id}`, { method: 'DELETE' });
    showToast('Kunde gelöscht');
    loadCustomerTable('');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function calcGrossFromNet(netId, grossId) {
  const net = parseFloat(document.getElementById(netId).value);
  if (!isNaN(net)) document.getElementById(grossId).value = (net * 1.19).toFixed(2);
}

function calcNetFromGross(netId, grossId) {
  const gross = parseFloat(document.getElementById(grossId).value);
  if (!isNaN(gross)) document.getElementById(netId).value = (gross / 1.19).toFixed(2);
}

// ===== Customer Management (Firmenkunde/Werkstatt) =====
async function openCustomerManagement(customerId) {
  try {
    const [customer, credits, rebates, staffList] = await Promise.all([
      api(`/api/customers/${customerId}`),
      api(`/api/customers/${customerId}/credits`),
      api(`/api/customers/${customerId}/rebates`),
      api('/api/staff')
    ]);

    const html = `
      <div>
        <h4 style="margin-bottom:8px;">Besondere Vereinbarungen</h4>
        <textarea id="mgmt-agreements" rows="6" style="width:100%;font-size:13px;">${escapeHtml(customer.special_agreements || '')}</textarea>
        <div style="display:flex;justify-content:flex-end;margin-top:6px;">
          <button class="btn btn-sm btn-primary" onclick="saveSpecialAgreements(${customerId})">Vereinbarungen speichern</button>
        </div>

        <h4 style="margin-top:20px;margin-bottom:8px;">Rückvergütungsvereinbarungen</h4>
        <div id="rebates-list">
          ${renderRebatesTable(rebates, customerId)}
        </div>
        ${(isAdmin() || isVerwaltung() || isBuchhaltung()) ? `<button class="btn btn-sm btn-primary" style="margin-top:8px;" onclick="openRebateForm(${customerId})">+ Neue Rückvergütung</button>` : ''}

        <h4 style="margin-top:20px;margin-bottom:8px;">Rückvergütungen / Gutschriften</h4>
        <div id="credits-list">
          ${renderCreditsTable(credits, customerId)}
        </div>
        <button class="btn btn-sm btn-primary" style="margin-top:8px;" onclick="addCreditRow(${customerId})">+ Neue Rückvergütung eintragen</button>
      </div>
    `;
    openModal('Kundenverwaltung — ' + customerDisplayName(customer), html, 'modal-wide');
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
}

function renderCreditsTable(credits, customerId) {
  if (credits.length === 0) {
    return '<p style="color:var(--text-muted);font-size:13px;">Noch keine Gutschriften vorhanden.</p>';
  }
  let html = `<table class="credits-table">
    <thead><tr>
      <th>Nr.</th><th>Datum</th><th>Bezeichnung</th><th>Netto</th><th>Brutto</th><th>Aktionen</th>
    </tr></thead><tbody>`;
  credits.forEach(c => {
    html += `<tr id="credit-row-${c.id}">
      <td>${escapeHtml(c.credit_number)}</td>
      <td>${formatDate(c.credit_date)}</td>
      <td>${escapeHtml(c.description)}</td>
      <td>${Number(c.amount_net).toFixed(2)} &euro;</td>
      <td>${Number(c.amount_gross).toFixed(2)} &euro;</td>
      <td style="white-space:nowrap;">
        <button class="btn btn-sm btn-secondary" onclick="editCreditRow(${c.id}, ${customerId})">Bearbeiten</button>
        ${isAdmin() ? `<button class="btn btn-sm btn-danger" onclick="deleteCredit(${c.id}, ${customerId})">Löschen</button>` : ''}
      </td>
    </tr>`;
  });
  html += '</tbody></table>';
  return html;
}

function renderRebatesTable(rebates, customerId) {
  if (rebates.length === 0) {
    return '<p style="color:var(--text-muted);font-size:13px;">Noch keine Rückvergütungsvereinbarungen vorhanden.</p>';
  }
  let html = `<table class="data-table" style="font-size:13px;">
    <thead><tr>
      <th>Datum</th><th>Vereinbarte Rückvergütung</th><th>Art</th><th>Zeitraum</th><th>Vereinbart mit</th><th>Eingetragen von</th><th>Aktionen</th>
    </tr></thead><tbody>`;
  rebates.forEach(r => {
    html += `<tr>
      <td>${formatDate(r.rebate_date)}</td>
      <td>${escapeHtml(r.rebate_text)}</td>
      <td>${escapeHtml(r.rebate_type || '-')}</td>
      <td>${escapeHtml(r.rebate_period || '-')}</td>
      <td>${escapeHtml(r.agreed_with_name || '-')}</td>
      <td>${escapeHtml(r.created_by_name || '-')}</td>
      <td style="white-space:nowrap;">
        ${(isAdmin() || isVerwaltung()) ? `<button class="btn btn-sm btn-secondary" onclick="openRebateForm(${customerId}, ${r.id})">Bearbeiten</button>` : ''}
        ${isAdmin() ? `<button class="btn btn-sm btn-danger" onclick="deleteRebate(${r.id}, ${customerId})">Löschen</button>` : ''}
      </td>
    </tr>`;
  });
  html += '</tbody></table>';
  return html;
}

async function openRebateForm(customerId, editId) {
  const staffList = await api('/api/staff');
  let rebate = { rebate_text: '', rebate_type: '', rebate_period: '', agreed_with_staff_id: '' };
  const today = localDateStr(new Date());

  if (editId) {
    try {
      const all = await api(`/api/customers/${customerId}/rebates`);
      const found = all.find(r => r.id === editId);
      if (found) rebate = found;
    } catch (e) {}
  }

  const existing = document.getElementById('rebate-form-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'rebate-form-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:12px;padding:28px 32px;max-width:500px;width:90%;box-shadow:0 12px 40px rgba(0,0,0,0.25);">
      <h3 style="margin:0 0 16px;font-size:17px;">${editId ? 'Rückvergütung bearbeiten' : 'Neue Rückvergütung'}</h3>
      <form id="rebate-form">
        <div class="form-group">
          <label>Datum</label>
          <input type="date" value="${editId ? rebate.rebate_date : today}" disabled style="background:#f3f4f6;">
          <input type="hidden" id="rebate-date" value="${editId ? rebate.rebate_date : today}">
        </div>
        <div class="form-group">
          <label>Vereinbarte Rückvergütung *</label>
          <textarea id="rebate-text" rows="3" required style="width:100%;">${escapeHtml(rebate.rebate_text)}</textarea>
        </div>
        <div class="form-group">
          <label>Art der Rückvergütung</label>
          <input type="text" id="rebate-type" value="${escapeHtml(rebate.rebate_type || '')}" placeholder="z.B. Rabatt, Bonus, Provision">
        </div>
        <div class="form-group">
          <label>Zeitraum</label>
          <select id="rebate-period">
            <option value="">-- Auswählen --</option>
            ${['Monatlich', 'Vierteljährlich', 'Halbjährlich', 'Jährlich'].map(p => `<option value="${p}" ${rebate.rebate_period === p ? 'selected' : ''}>${p}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Vereinbart mit</label>
          <select id="rebate-agreed-with">
            <option value="">-- Auswählen --</option>
            ${staffList.filter(s => s.active).map(s => `<option value="${s.id}" ${rebate.agreed_with_staff_id == s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">${editId ? 'Speichern' : 'Eintragen'}</button>
          <button type="button" class="btn btn-secondary" onclick="document.getElementById('rebate-form-overlay').remove();">Abbrechen</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('rebate-form').onsubmit = async (e) => {
    e.preventDefault();
    const data = {
      rebate_date: document.getElementById('rebate-date').value,
      rebate_text: document.getElementById('rebate-text').value.trim(),
      rebate_type: document.getElementById('rebate-type').value.trim(),
      rebate_period: document.getElementById('rebate-period').value,
      agreed_with_staff_id: document.getElementById('rebate-agreed-with').value || null
    };
    if (!data.rebate_text) { showToast('Bitte Rückvergütung eingeben', 'error'); return; }
    try {
      if (editId) {
        await api(`/api/rebates/${editId}`, { method: 'PUT', body: data });
        showToast('Rückvergütung aktualisiert');
      } else {
        await api(`/api/customers/${customerId}/rebates`, { method: 'POST', body: data });
        showToast('Rückvergütung eingetragen');
      }
      overlay.remove();
      const rebates = await api(`/api/customers/${customerId}/rebates`);
      document.getElementById('rebates-list').innerHTML = renderRebatesTable(rebates, customerId);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };
}

async function deleteRebate(id, customerId) {
  if (!confirm('Rückvergütung wirklich löschen?')) return;
  try {
    await api(`/api/rebates/${id}`, { method: 'DELETE' });
    showToast('Rückvergütung gelöscht');
    const rebates = await api(`/api/customers/${customerId}/rebates`);
    document.getElementById('rebates-list').innerHTML = renderRebatesTable(rebates, customerId);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function saveSpecialAgreements(customerId) {
  const text = document.getElementById('mgmt-agreements').value.trim();
  try {
    await api(`/api/customers/${customerId}/special-agreements`, { method: 'PUT', body: { special_agreements: text } });
    showToast('Vereinbarungen gespeichert');
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
}

function addCreditRow(customerId) {
  const container = document.getElementById('credits-list');
  // Remove "no credits" message if present
  const noMsg = container.querySelector('p');
  if (noMsg) noMsg.remove();

  // Ensure table exists
  let table = container.querySelector('table');
  if (!table) {
    container.innerHTML = `<table class="credits-table">
      <thead><tr>
        <th>Nr.</th><th>Datum</th><th>Bezeichnung</th><th>Netto</th><th>Brutto</th><th>Aktionen</th>
      </tr></thead><tbody></tbody></table>`;
    table = container.querySelector('table');
  }
  const tbody = table.querySelector('tbody');
  const tr = document.createElement('tr');
  tr.id = 'credit-row-new';
  tr.innerHTML = `
    <td><input type="text" id="new-credit-number" placeholder="Nr."></td>
    <td><input type="date" id="new-credit-date"></td>
    <td><input type="text" id="new-credit-desc" placeholder="Bezeichnung"></td>
    <td><input type="number" id="new-credit-net" step="0.01" placeholder="0.00" oninput="calcGrossFromNet('new-credit-net','new-credit-gross')"></td>
    <td><input type="number" id="new-credit-gross" step="0.01" placeholder="0.00" readonly style="background:#f0f0f0;"></td>
    <td style="white-space:nowrap;">
      <button class="btn btn-sm btn-primary" onclick="saveCreditNew(${customerId})">Speichern</button>
      <button class="btn btn-sm btn-secondary" onclick="this.closest('tr').remove()">Abbrechen</button>
    </td>
  `;
  tbody.appendChild(tr);
  tr.querySelector('#new-credit-number').focus();
}

async function saveCreditNew(customerId) {
  const data = {
    credit_number: document.getElementById('new-credit-number').value.trim(),
    credit_date: document.getElementById('new-credit-date').value,
    description: document.getElementById('new-credit-desc').value.trim(),
    amount_net: parseFloat(document.getElementById('new-credit-net').value) || 0,
    amount_gross: parseFloat(document.getElementById('new-credit-gross').value) || 0,
  };
  if (!data.description) { showToast('Bezeichnung ist Pflichtfeld', 'error'); return; }
  try {
    await api(`/api/customers/${customerId}/credits`, { method: 'POST', body: data });
    showToast('Gutschrift erstellt');
    refreshCredits(customerId);
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
}

function editCreditRow(creditId, customerId) {
  const row = document.getElementById(`credit-row-${creditId}`);
  if (!row) return;
  const cells = row.querySelectorAll('td');
  const nr = cells[0].textContent.trim();
  const dateText = cells[1].textContent.trim();
  const desc = cells[2].textContent.trim();
  const net = cells[3].textContent.replace('€', '').trim();
  const gross = cells[4].textContent.replace('€', '').trim();

  // Parse German date back to ISO
  let isoDate = '';
  if (dateText && dateText.includes('.')) {
    const parts = dateText.split('.');
    if (parts.length === 3) isoDate = parts[2] + '-' + parts[1] + '-' + parts[0];
  }

  row.innerHTML = `
    <td><input type="text" id="edit-credit-number-${creditId}" value="${escapeHtml(nr)}"></td>
    <td><input type="date" id="edit-credit-date-${creditId}" value="${isoDate}"></td>
    <td><input type="text" id="edit-credit-desc-${creditId}" value="${escapeHtml(desc)}"></td>
    <td><input type="number" id="edit-credit-net-${creditId}" step="0.01" value="${net}" oninput="calcGrossFromNet('edit-credit-net-${creditId}','edit-credit-gross-${creditId}')"></td>
    <td><input type="number" id="edit-credit-gross-${creditId}" step="0.01" value="${gross}" readonly style="background:#f0f0f0;"></td>
    <td style="white-space:nowrap;">
      <button class="btn btn-sm btn-primary" onclick="saveCreditEdit(${creditId}, ${customerId})">Speichern</button>
      <button class="btn btn-sm btn-secondary" onclick="refreshCredits(${customerId})">Abbrechen</button>
    </td>
  `;
}

async function saveCreditEdit(creditId, customerId) {
  const data = {
    credit_number: document.getElementById(`edit-credit-number-${creditId}`).value.trim(),
    credit_date: document.getElementById(`edit-credit-date-${creditId}`).value,
    description: document.getElementById(`edit-credit-desc-${creditId}`).value.trim(),
    amount_net: parseFloat(document.getElementById(`edit-credit-net-${creditId}`).value) || 0,
    amount_gross: parseFloat(document.getElementById(`edit-credit-gross-${creditId}`).value) || 0,
  };
  if (!data.description) { showToast('Bezeichnung ist Pflichtfeld', 'error'); return; }
  try {
    await api(`/api/credits/${creditId}`, { method: 'PUT', body: data });
    showToast('Gutschrift aktualisiert');
    refreshCredits(customerId);
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
}

async function deleteCredit(creditId, customerId) {
  if (!confirm('Gutschrift wirklich löschen?')) return;
  try {
    await api(`/api/credits/${creditId}`, { method: 'DELETE' });
    showToast('Gutschrift gelöscht');
    refreshCredits(customerId);
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
}

async function refreshCredits(customerId) {
  try {
    const credits = await api(`/api/customers/${customerId}/credits`);
    document.getElementById('credits-list').innerHTML = renderCreditsTable(credits, customerId);
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
}

// ===== PAGE: Customer Detail =====
async function renderCustomerDetail(id) {
  const main = document.getElementById('main-content');
  currentCustomerId = id;

  try {
    const customer = await api(`/api/customers/${id}`);

    main.innerHTML = `
      <a class="back-link" onclick="navigate('customers')">&larr; Zurück zur Kundenliste</a>

      <div class="page-header">
        <h2>${customerDisplayName(customer)}${customer.customer_type !== 'Privatkunde' ? ` <span class="badge badge-blue">${escapeHtml(customer.customer_type)}</span>` : ''}</h2>
        <div>
          ${(customer.customer_type === 'Firmenkunde' || customer.customer_type === 'Werkstatt') && (isAdmin() || isVerwaltung() || isBuchhaltung())
            ? `<button class="btn btn-secondary" onclick="openCustomerManagement(${id})">Verwaltung</button>` : ''}
          <button class="btn btn-secondary" onclick="openCustomerForm(${id})">Bearbeiten</button>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>Kundendaten</h3>
        </div>
        <div class="customer-info-grid">
          <div class="info-item">
            <div class="info-label">Kundennummer</div>
            <div class="info-value"><strong>${customer.id}</strong></div>
          </div>
          <div class="info-item">
            <div class="info-label">Angelegt am</div>
            <div class="info-value">${customer.created_at ? formatDate(customer.created_at) : '-'}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Adresse</div>
            <div class="info-value">${escapeHtml(customer.street)}<br>${escapeHtml(customer.zip)} ${escapeHtml(customer.city)}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Telefon</div>
            <div class="info-value">${customer.phone ? `<a href="tel:${escapeHtml(customer.phone)}">${escapeHtml(customer.phone)}</a>` : '-'}</div>
          </div>
          <div class="info-item">
            <div class="info-label">E-Mail</div>
            <div class="info-value">${customer.email ? `<a href="mailto:${escapeHtml(customer.email)}">${escapeHtml(customer.email)}</a>` : '-'}</div>
          </div>
          ${(customer.customer_type === 'Firmenkunde' || customer.customer_type === 'Werkstatt') && customer.contact_person ? `
          <div class="info-item">
            <div class="info-label">Ansprechpartner</div>
            <div class="info-value">${escapeHtml(customer.contact_person)}${customer.contact_phone ? ` | <a href="tel:${escapeHtml(customer.contact_phone)}">${escapeHtml(customer.contact_phone)}</a>` : ''}</div>
          </div>` : ''}
          ${customer.notes ? `
          <div class="info-item">
            <div class="info-label">Notizen</div>
            <div class="info-value">${escapeHtml(customer.notes)}</div>
          </div>` : ''}
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>Fahrzeuge (${customer.vehicles.length})</h3>
          <button class="btn btn-sm btn-primary" onclick="openVehicleForm(${id})">+ Fahrzeug</button>
        </div>
        ${customer.vehicles.length > 0 ? `
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Kennzeichen</th>
                <th>Hersteller</th>
                <th>Typ</th>
                <th>Bauart</th>
                <th>FIN</th>
                <th>Erstzulassung</th>
                <th>Angelegt am</th>
                <th>Aktionen</th>
              </tr>
            </thead>
            <tbody>
              ${customer.vehicles.map(v => {
                return `
                <tr>
                  <td><strong>${escapeHtml(v.license_plate) || '-'}</strong></td>
                  <td>${escapeHtml(v.manufacturer)}</td>
                  <td>${escapeHtml(v.model)}</td>
                  <td>${escapeHtml(v.vehicle_type) || '-'}</td>
                  <td style="font-family:monospace;font-size:12px;">${escapeHtml(v.vin) || '-'}</td>
                  <td>${formatDate(v.first_registration)}</td>
                  <td style="font-size:12px;color:var(--text-muted);">${v.created_at ? formatDate(v.created_at) : '-'}</td>
                  <td>
                    <button class="btn btn-sm btn-secondary" onclick="openVehicleForm(${id}, ${v.id})">Bearbeiten</button>
                    ${isAdmin() ? `<button class="btn btn-sm btn-danger" onclick="deleteVehicle(${v.id}, ${id})">Löschen</button>` : ''}
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>` : `
        <div class="empty-state">
          <p>Noch keine Fahrzeuge.</p>
          <button class="btn btn-primary" onclick="openVehicleForm(${id})">Fahrzeug hinzufügen</button>
        </div>`}
      </div>
    `;
  } catch (err) {
    main.innerHTML = `<div class="empty-state"><p>Fehler: ${escapeHtml(err.message)}</p></div>`;
  }
}


async function openVehicleForm(customerId, vehicleId) {
  let vehicle = { manufacturer: '', model: '', vehicle_type: '', vin: '', license_plate: '', first_registration: '' };

  if (vehicleId) {
    try {
      const vehicles = await api(`/api/customers/${customerId}/vehicles`);
      vehicle = vehicles.find(v => v.id === vehicleId) || vehicle;
    } catch (err) {
      showToast('Fehler beim Laden', 'error');
      return;
    }
  }

  const title = vehicleId ? 'Fahrzeug bearbeiten' : 'Neues Fahrzeug';
  const html = `
    <form id="vehicle-form" onsubmit="saveVehicle(event, ${customerId}, ${vehicleId || 'null'})">
      <div class="form-row">
        <div class="form-group">
          <label>Hersteller *</label>
          <input type="text" name="manufacturer" value="${escapeHtml(vehicle.manufacturer)}" required placeholder="z.B. Volkswagen">
        </div>
        <div class="form-group">
          <label>Typ/Modell *</label>
          <input type="text" name="model" value="${escapeHtml(vehicle.model)}" required placeholder="z.B. Golf 8">
        </div>
      </div>
      <div class="form-group">
        <label>Bauart *</label>
        <select name="vehicle_type" required>
          <option value="">-- Auswählen --</option>
          ${VEHICLE_TYPES.map(t => `<option value="${t}" ${vehicle.vehicle_type === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Kennzeichen</label>
          <input type="text" name="license_plate" value="${escapeHtml(vehicle.license_plate)}" placeholder="z.B. AC-AB 123">
        </div>
        <div class="form-group">
          <label>Fahrgestellnummer (FIN)</label>
          <input type="text" name="vin" value="${escapeHtml(vehicle.vin)}" placeholder="17-stellig">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Erstzulassung</label>
          <input type="date" name="first_registration" value="${vehicle.first_registration || ''}">
        </div>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">${vehicleId ? 'Speichern' : 'Hinzufügen'}</button>
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Abbrechen</button>
      </div>
    </form>
  `;
  openModal(title, html);
}

async function saveVehicle(e, customerId, vehicleId) {
  e.preventDefault();
  const form = e.target;
  if (!form.vehicle_type.value) {
    showToast('Bitte Bauart auswählen', 'error');
    return;
  }
  const data = {
    manufacturer: form.manufacturer.value.trim(),
    model: form.model.value.trim(),
    vehicle_type: form.vehicle_type.value,
    vin: form.vin.value.trim(),
    license_plate: form.license_plate.value.trim(),
    first_registration: form.first_registration.value,
  };

  try {
    if (vehicleId) {
      await api(`/api/vehicles/${vehicleId}`, { method: 'PUT', body: data });
      showToast('Fahrzeug aktualisiert');
    } else {
      await api(`/api/customers/${customerId}/vehicles`, { method: 'POST', body: data });
      showToast('Fahrzeug hinzugefügt');
    }
    closeModal();
    renderCustomerDetail(customerId);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteVehicle(vehicleId, customerId) {
  if (!confirm('Fahrzeug wirklich löschen?')) return;
  try {
    await api(`/api/vehicles/${vehicleId}`, { method: 'DELETE' });
    showToast('Fahrzeug gelöscht');
    renderCustomerDetail(customerId);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ===== PAGE: Mitarbeiter =====
const STAFF_ROLES = [
  { value: 'inspector', label: 'Prüfer' },
  { value: 'processor', label: 'Bearbeiter' },
];

function getRoleLabel(role) {
  return STAFF_ROLES.find(r => r.value === role)?.label || role;
}

// ===== PAGE: Kalender =====
const BOOKING_METHODS = ['Über Bemo', 'Über Webseite', 'Telefonisch', 'per Mail', 'Vor Ort', 'Blocker'];
const BOOKING_COLORS = { 'Über Bemo': 'cal-booking-online', 'Über Webseite': 'cal-booking-online', 'Telefonisch': 'cal-booking-telefonisch', 'per Mail': 'cal-booking-mail', 'Vor Ort': 'cal-booking-vorort', 'Blocker': 'cal-booking-blocker' };
const CAL_LEGEND_ITEMS = [
  { label: 'Online', colorClass: 'cal-booking-online' },
  { label: 'Telefonisch', colorClass: 'cal-booking-telefonisch' },
  { label: 'per Mail', colorClass: 'cal-booking-mail' },
  { label: 'Vor Ort', colorClass: 'cal-booking-vorort' },
  { label: 'Blocker', colorClass: 'cal-booking-blocker' }
];
function localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
let calCurrentDate = localDateStr(new Date());
let calVisibleColumns = null; // initialized on first render or from localStorage

function saveCalVisibleColumns() {
  try { localStorage.setItem('calVisibleColumns', JSON.stringify(calVisibleColumns)); } catch (e) {}
}

function loadCalVisibleColumns() {
  try {
    const saved = localStorage.getItem('calVisibleColumns');
    if (saved) return JSON.parse(saved);
  } catch (e) {}
  return null;
}
let _calSearchTimeout = null;

async function calSearch(query) {
  const panel = document.getElementById('cal-search-results');
  if (!panel) return;
  if (!query || query.trim().length < 2) {
    panel.style.display = 'none';
    return;
  }
  try {
    const results = await api(`/api/calendar/search?q=${encodeURIComponent(query.trim())}`);
    if (results.length === 0) {
      panel.innerHTML = '<div style="padding:12px;color:var(--text-muted);font-size:13px;">Keine Treffer gefunden</div>';
      panel.style.display = '';
      return;
    }
    panel.innerHTML = results.map(r => `
      <div class="cal-search-item" onclick="calGoToDate('${r.appointment_date}'); document.getElementById('cal-search-results').style.display='none'; document.getElementById('cal-search-input').value='';" style="padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border);display:flex;gap:10px;align-items:center;">
        <div style="min-width:80px;font-weight:600;font-size:13px;">${formatDate(r.appointment_date)}</div>
        <div style="min-width:50px;font-size:13px;color:var(--text-muted);">${escapeHtml(r.start_time)}</div>
        <div style="flex:1;font-size:13px;">${escapeHtml(r.customer_name)}</div>
        <div style="font-size:13px;font-weight:500;">${r.license_plate ? escapeHtml(r.license_plate) : '-'}</div>
        <div style="font-size:12px;color:var(--text-muted);">${escapeHtml(r.station)}</div>
      </div>
    `).join('');
    panel.style.display = '';
  } catch (err) {
    panel.innerHTML = '<div style="padding:12px;color:var(--danger);">Fehler bei der Suche</div>';
    panel.style.display = '';
  }
}

function onCalSearchInput(val) {
  clearTimeout(_calSearchTimeout);
  _calSearchTimeout = setTimeout(() => calSearch(val), 300);
}

function closeCalSearchOnClickOutside(e) {
  const panel = document.getElementById('cal-search-results');
  const input = document.getElementById('cal-search-input');
  if (panel && input && !panel.contains(e.target) && e.target !== input) {
    panel.style.display = 'none';
  }
}

let _calTimeLineInterval = null;

function updateCalTimeLine() {
  const line = document.getElementById('cal-time-line');
  const label = document.getElementById('cal-time-line-label');
  if (!line || !label) return;
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (nowMin < CAL_START_TOTAL_MIN || nowMin > CAL_END_TOTAL_MIN) {
    line.style.display = 'none';
    label.style.display = 'none';
    return;
  }
  const top = nowMin - CAL_START_TOTAL_MIN;
  line.style.top = top + 'px';
  line.style.display = '';
  label.style.top = (top - 8) + 'px';
  label.style.display = '';
  label.textContent = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
}

function startCalTimeLine() {
  if (_calTimeLineInterval) clearInterval(_calTimeLineInterval);
  updateCalTimeLine();
  _calTimeLineInterval = setInterval(updateCalTimeLine, 60000);
}

function stopCalTimeLine() {
  if (_calTimeLineInterval) { clearInterval(_calTimeLineInterval); _calTimeLineInterval = null; }
}

const CAL_START_HOUR = 7;
const CAL_START_MIN = 30;
const CAL_END_HOUR = 20;
const CAL_END_MIN = 0;
const CAL_START_TOTAL_MIN = CAL_START_HOUR * 60 + CAL_START_MIN;
const CAL_END_TOTAL_MIN = CAL_END_HOUR * 60 + CAL_END_MIN;
const PRUEFER_COLORS = ['#2563eb','#059669','#7c3aed','#0891b2','#6366f1','#0d9488','#8b5cf6','#2dd4bf','#4f46e5','#06b6d4'];

function formatCalDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const days = ['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag'];
  const months = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
  return `${days[d.getDay()]}, ${d.getDate()}. ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function calChangeDay(offset) {
  const d = new Date(calCurrentDate + 'T12:00:00');
  d.setDate(d.getDate() + offset);
  calCurrentDate = localDateStr(d);
  renderCalendar();
}

function calGoToDate(dateStr) {
  calCurrentDate = dateStr;
  renderCalendar();
}

function calToday() {
  calCurrentDate = localDateStr(new Date());
  renderCalendar();
}

async function renderCalendar() {
  const main = document.getElementById('main-content');
  try {
    const [appointments, vacEntries, allStaff] = await Promise.all([
      api(`/api/calendar?date=${calCurrentDate}`),
      api(`/api/vacation?status=Genehmigt`),
      api('/api/staff')
    ]);

    // Build Prüfer color map
    const prueferList = allStaff.filter(s => s.role === 'inspector' && s.active);
    const prueferColorMap = {};
    prueferList.forEach((s, i) => { prueferColorMap[s.id] = PRUEFER_COLORS[i % PRUEFER_COLORS.length]; });

    // Build all available columns: Allgemein + staff members with calendar enabled
    const activeStaff = allStaff.filter(s => s.active);
    const calendarStaff = activeStaff.filter(s => s.has_calendar && (
      (loggedInUser && s.id === loggedInUser.id) ||
      (s.calendar_visibility || '').split(',').includes(loggedInUser ? loggedInUser.permission_level : '')
    ));
    const allColumns = [
      { key: 'general', label: 'Allgemein', type: 'general' },
      ...calendarStaff.map(s => ({ key: `staff:${s.id}`, label: s.name, type: 'staff', staffId: s.id, role: s.role }))
    ];

    // Initialize visible columns: from localStorage, or defaults (all visible)
    if (!calVisibleColumns) {
      calVisibleColumns = loadCalVisibleColumns();
      if (!calVisibleColumns) {
        calVisibleColumns = {};
        allColumns.forEach(c => calVisibleColumns[c.key] = true);
      }
    }
    // Add new columns that don't exist in state yet (default visible)
    allColumns.forEach(c => { if (calVisibleColumns[c.key] === undefined) calVisibleColumns[c.key] = true; });

    const visibleCols = allColumns.filter(c => calVisibleColumns[c.key]);

    // Filter vacation entries that overlap with current date
    const todayVac = vacEntries.filter(v => v.start_date <= calCurrentDate && v.end_date >= calCurrentDate);

    // Group appointments by assigned staff
    const byStaff = {};
    activeStaff.forEach(s => byStaff[s.id] = []);
    appointments.forEach(a => {
      if (a.assigned_staff_id && byStaff[a.assigned_staff_id]) byStaff[a.assigned_staff_id].push(a);
    });

    // General appointments: no assigned staff
    const generalAppts = appointments.filter(a => !a.assigned_staff_id);

    // Build time column (15-min slots)
    let timeHtml = '';
    for (let m = CAL_START_TOTAL_MIN; m < CAL_END_TOTAL_MIN; m += 15) {
      const hh = String(Math.floor(m / 60)).padStart(2, '0');
      const mm = m % 60;
      const isHour = mm === 0;
      const isHalf = mm === 30;
      const cls = isHalf ? 'cal-half-hour' : (!isHour ? 'cal-quarter-label' : '');
      const label = (isHour || isHalf) ? `${hh}:${String(mm).padStart(2,'0')}` : '';
      timeHtml += `<div class="cal-time-label ${cls}">${label}</div>`;
    }

    // Build columns
    let stationHtml = '';
    visibleCols.forEach(col => {
      let hoursHtml = '';
      const clickStaffId = col.type === 'staff' ? col.staffId : 'null';
      for (let m = CAL_START_TOTAL_MIN; m < CAL_END_TOTAL_MIN; m += 15) {
        const hh = String(Math.floor(m / 60)).padStart(2, '0');
        const mm = String(m % 60).padStart(2, '0');
        const cls = (m % 60 === 30) ? 'cal-half-hour cal-quarter' : 'cal-quarter';
        hoursHtml += `<div class="cal-hour-row ${cls}" onclick="openCalendarForm('Allgemein', '${calCurrentDate}', '${hh}:${mm}', null, ${clickStaffId})"></div>`;
      }

      const appts = col.type === 'general' ? generalAppts : (byStaff[col.staffId] || []);
      let apptsHtml = '';
      appts.forEach(a => {
        const startMin = timeToMinutes(a.start_time) - CAL_START_TOTAL_MIN;
        const endMin = timeToMinutes(a.end_time) - CAL_START_TOTAL_MIN;
        const top = startMin;
        const height = Math.max(endMin - startMin, 20);

        const overlapping = appts.filter(b =>
          timeToMinutes(b.start_time) < timeToMinutes(a.end_time) &&
          timeToMinutes(b.end_time) > timeToMinutes(a.start_time)
        );
        const overlapCount = overlapping.length;
        const posInGroup = overlapping.indexOf(a);

        let overlapClass = '';
        if (overlapCount >= 4) overlapClass = `overlap-4 pos-${posInGroup}`;
        else if (overlapCount === 3) overlapClass = `overlap-3 pos-${posInGroup}`;
        else if (overlapCount === 2) overlapClass = `overlap-2 pos-${posInGroup}`;

        let colorClass = '';
        let inlineColor = '';
        if (col.type === 'staff') {
          const staffColor = prueferColorMap[col.staffId] || '#6366f1';
          inlineColor = `background:${staffColor};color:#fff;border-left-color:${staffColor};`;
        } else {
          // General column: use Allgemeine Termine color
          inlineColor = 'background:#0891b2;color:#fff;border-left-color:#0891b2;';
        }

        const custNotes = a.customer_notes ? String(a.customer_notes).trim() : '';
        const apptNotes = a.notes ? String(a.notes).trim() : '';
        const hasTooltip = custNotes || apptNotes;

        apptsHtml += `<div class="cal-appointment ${colorClass} ${overlapClass}"
          style="top:${top}px;height:${height}px;${inlineColor}"
          onclick="event.stopPropagation(); openCalendarForm('${a.station}', '${calCurrentDate}', null, ${a.id})"
          ${hasTooltip ? `data-cust-notes="${escapeHtml(custNotes)}" data-appt-notes="${escapeHtml(apptNotes)}" onmouseenter="showCalTooltip(event)" onmouseleave="hideCalTooltip()"` : ''}>
          <strong>${a.start_time}</strong> ${escapeHtml(a.customer_name)}
          ${a.license_plate ? '<br>' + escapeHtml(a.license_plate) : ''}
          ${a.vehicle_type ? ', ' + escapeHtml(a.vehicle_type) : ''}
        </div>`;
      });

      stationHtml += `<div class="cal-station-col" style="position:relative;">
        ${hoursHtml}
        ${apptsHtml}
      </div>`;
    });

    const totalHeight = CAL_END_TOTAL_MIN - CAL_START_TOTAL_MIN;
    const colCount = visibleCols.length;

    // Build dropdown checkboxes
    const dropdownItems = allColumns.map(c => {
      const checked = calVisibleColumns[c.key] ? 'checked' : '';
      return `<label style="display:flex;align-items:center;gap:6px;padding:4px 12px;cursor:pointer;white-space:nowrap;font-weight:normal;" onmousedown="event.preventDefault();">
        <input type="checkbox" ${checked} onchange="toggleCalColumn('${c.key}', this.checked)"> ${escapeHtml(c.label)}
      </label>`;
    }).join('');

    // ===== Mobile calendar: list view =====
    let mobileCalHtml = '';
    if (isMobileView()) {
      // Collect all appointments grouped by general/staff, sorted by time
      const mobileGroups = [];
      visibleCols.forEach(col => {
        const appts = col.type === 'general' ? generalAppts : (byStaff[col.staffId] || []);
        if (appts.length === 0) return;
        const sorted = [...appts].sort((a, b) => a.start_time.localeCompare(b.start_time));
        mobileGroups.push({ label: col.label, col, appointments: sorted });
      });

      // Also add groups with no appointments for visible columns
      visibleCols.forEach(col => {
        if (!mobileGroups.find(g => g.label === col.label)) {
          mobileGroups.push({ label: col.label, col, appointments: [] });
        }
      });

      const mobileGroupsHtml = mobileGroups.map(g => {
        const col = g.col;
        const clickStaffId = col.type === 'staff' ? col.staffId : 'null';

        let cardsHtml = '';
        if (g.appointments.length === 0) {
          cardsHtml = `<div style="padding:12px 16px;color:var(--text-muted);font-size:13px;">Keine Termine</div>`;
        } else {
          cardsHtml = g.appointments.map(a => {
            let bgColor = '#0891b2';
            if (col.type === 'staff') {
              bgColor = prueferColorMap[col.staffId] || '#6366f1';
            }
            return `<div class="cal-mobile-card" style="border-left:4px solid ${bgColor};" onclick="openCalendarForm('${a.station}', '${calCurrentDate}', null, ${a.id})">
              <div class="cal-mobile-time">${a.start_time.slice(0,5)} – ${a.end_time.slice(0,5)}</div>
              <div class="cal-mobile-name">${escapeHtml(a.customer_name)}</div>
              ${a.license_plate ? `<div class="cal-mobile-detail">${escapeHtml(a.license_plate)}${a.vehicle_type ? ' · ' + escapeHtml(a.vehicle_type) : ''}</div>` : ''}
              ${a.notes ? `<div class="cal-mobile-detail">${escapeHtml(a.notes)}</div>` : ''}
            </div>`;
          }).join('');
        }

        return `<div class="cal-mobile-group">
          <div class="cal-mobile-group-header">
            <span>${escapeHtml(g.label)}</span>
            <span class="cal-mobile-count">${g.appointments.length}</span>
          </div>
          ${cardsHtml}
          <div class="cal-mobile-add" onclick="openCalendarForm('Allgemein', '${calCurrentDate}', '08:00', null, ${clickStaffId})">+ Termin</div>
        </div>`;
      }).join('');

      mobileCalHtml = `
        ${todayVac.length > 0 ? `<div class="cal-vacation-banner" style="margin-bottom:12px;">
          ${todayVac.map(v => {
            const typeIcon = v.entry_type === 'Urlaub' ? '\u2708' : v.entry_type === 'Krankheit' ? '\u26A0' : '\u{1F4DA}';
            const bgColor = v.entry_type === 'Urlaub' ? '#dc2626' : v.entry_type === 'Krankheit' ? '#b91c1c' : '#7c3aed';
            return `<span class="cal-vac-tag" style="background:${bgColor};">${typeIcon} ${escapeHtml(v.staff_name)} – ${escapeHtml(v.entry_type)}</span>`;
          }).join('')}
        </div>` : ''}
        ${mobileGroupsHtml}
      `;
    }

    // ===== Desktop calendar: grid view =====
    const desktopCalHtml = `
      <div class="cal-legend" style="margin-bottom:4px;">
        <span style="font-weight:600;">Buchungsart:</span>
        ${CAL_LEGEND_ITEMS.map(l => `<span class="cal-legend-item"><span class="cal-legend-dot ${l.colorClass}"></span> ${l.label}</span>`).join('')}
      </div>
      ${prueferList.length > 0 ? `<div class="cal-legend" style="margin-bottom:10px;">
        <span style="font-weight:600;">Außendienst Prüfer:</span>
        ${prueferList.map(s => `<span class="cal-legend-item"><span class="cal-legend-dot" style="background:${prueferColorMap[s.id]};"></span> ${escapeHtml(s.name)}</span>`).join('')}
      </div>` : ''}
      ${todayVac.length > 0 ? `<div class="cal-vacation-banner">
        ${todayVac.map(v => {
          const typeIcon = v.entry_type === 'Urlaub' ? '\u2708' : v.entry_type === 'Krankheit' ? '\u26A0' : '\u{1F4DA}';
          const bgColor = v.entry_type === 'Urlaub' ? '#dc2626' : v.entry_type === 'Krankheit' ? '#b91c1c' : '#7c3aed';
          return `<span class="cal-vac-tag" style="background:${bgColor};">${typeIcon} ${escapeHtml(v.staff_name)} – ${escapeHtml(v.entry_type)} (${v.start_date} bis ${v.end_date})</span>`;
        }).join('')}
      </div>` : ''}
      <div class="cal-scroll-wrapper" style="overflow-y:auto;max-height:calc(100vh - 180px);">
        <div class="cal-grid" style="position:relative;min-height:${totalHeight + 40}px;grid-template-columns:60px repeat(${colCount}, 1fr);">
          <div style="background:var(--bg-dark);border-bottom:2px solid var(--border);padding:10px 4px;font-size:11px;color:var(--text-muted);text-align:center;">Zeit</div>
          ${visibleCols.map(c => `<div class="cal-station-header">${escapeHtml(c.label)}</div>`).join('')}
          <div class="cal-time-col">${timeHtml}</div>
          ${stationHtml}
          ${calCurrentDate === localDateStr(new Date()) ? `
            <div id="cal-time-line" class="cal-now-line"></div>
            <div id="cal-time-line-label" class="cal-now-label"></div>
          ` : ''}
        </div>
      </div>
    `;

    main.innerHTML = `
      <div class="cal-header">
        <button class="cal-nav-btn" onclick="calToday()">Heute</button>
        <button class="cal-nav-btn" onclick="calChangeDay(-1)" title="Tag zurück">\u25C0</button>
        <button class="cal-nav-btn" onclick="calChangeDay(1)" title="Tag vor">\u25B6</button>
        <h2 style="flex-shrink:0;">${formatCalDate(calCurrentDate)}</h2>
        <div class="cal-mobile-only" style="position:relative;margin-left:auto;">
          <button class="cal-nav-btn" onclick="toggleCalMobileFilter()" id="cal-mobile-filter-btn" style="font-size:13px;padding:6px 12px;">&#9881; Filter</button>
          <div id="cal-mobile-filter-dropdown" style="display:none;position:absolute;right:0;top:100%;z-index:200;background:var(--card-bg);border:1px solid var(--border);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.2);padding:8px 0;min-width:220px;max-height:70vh;overflow-y:auto;margin-top:4px;">
            <div style="padding:6px 14px 8px;font-weight:700;font-size:13px;color:var(--text);border-bottom:1px solid var(--border);margin-bottom:4px;">Sichtbare Kalender</div>
            ${allColumns.map(c => {
              const checked = calVisibleColumns[c.key] ? 'checked' : '';
              return `<label style="display:flex;align-items:center;gap:8px;padding:8px 14px;cursor:pointer;white-space:nowrap;font-weight:normal;font-size:14px;" onmousedown="event.preventDefault();">
                <input type="checkbox" ${checked} onchange="toggleCalColumn('${c.key}', this.checked)" style="width:18px;height:18px;"> ${escapeHtml(c.label)}
              </label>`;
            }).join('')}
          </div>
        </div>
        <div class="cal-desktop-only" style="position:relative;margin-left:auto;margin-right:12px;">
          <input type="text" id="cal-search-input" placeholder="Kunde oder Kennzeichen suchen..." oninput="onCalSearchInput(this.value)" onfocus="if(this.value.length>=2) calSearch(this.value)" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;width:240px;">
          <div id="cal-search-results" style="display:none;position:absolute;left:0;top:100%;z-index:200;background:var(--card-bg);border:1px solid var(--border);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.15);width:560px;max-height:350px;overflow-y:auto;margin-top:4px;"></div>
        </div>
        <div class="cal-desktop-only" style="position:relative;margin-right:8px;">
          <button class="cal-nav-btn" onclick="toggleCalDropdown()" id="cal-col-toggle-btn" style="font-size:13px;padding:6px 12px;">Kalender \u25BC</button>
          <div id="cal-col-dropdown" style="display:none;position:absolute;right:0;top:100%;z-index:100;background:var(--card-bg);border:1px solid var(--border);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.15);padding:8px 0;min-width:200px;max-height:400px;overflow-y:auto;">
            ${allColumns.map(c => {
              const checked = calVisibleColumns[c.key] ? 'checked' : '';
              return `<label style="display:flex;align-items:center;gap:6px;padding:4px 12px;cursor:pointer;white-space:nowrap;font-weight:normal;" onmousedown="event.preventDefault();">
                <input type="checkbox" ${checked} onchange="toggleCalColumn('${c.key}', this.checked)"> ${escapeHtml(c.label)}
              </label>`;
            }).join('')}
          </div>
        </div>
        <div class="cal-desktop-only">
          <button class="cal-nav-btn" onclick="calChangeDay(-7)" title="Woche zurück">\u25C0\u25C0</button>
          <button class="cal-nav-btn" onclick="calChangeDay(7)" title="Woche vor">\u25B6\u25B6</button>
        </div>
        <input type="date" value="${calCurrentDate}" onchange="calGoToDate(this.value)" style="padding:6px 8px;border:1px solid var(--border);border-radius:6px;">
      </div>
      ${isMobileView() ? mobileCalHtml : desktopCalHtml}
    `;
    document.removeEventListener('click', closeCalSearchOnClickOutside);
    document.addEventListener('click', closeCalSearchOnClickOutside);
    stopCalTimeLine();
    if (calCurrentDate === localDateStr(new Date())) startCalTimeLine();
  } catch (err) {
    main.innerHTML = `<div class="empty-state"><p>Fehler: ${escapeHtml(err.message)}</p></div>`;
  }
}

function toggleCalColumn(key, visible) {
  calVisibleColumns[key] = visible;
  saveCalVisibleColumns();
  renderCalendar();
}

function toggleCalDropdown() {
  const dd = document.getElementById('cal-col-dropdown');
  if (!dd) return;
  const isOpen = dd.style.display !== 'none';
  dd.style.display = isOpen ? 'none' : '';
  if (!isOpen) {
    const close = (e) => {
      if (!dd.contains(e.target) && e.target.id !== 'cal-col-toggle-btn') {
        dd.style.display = 'none';
        document.removeEventListener('click', close);
      }
    };
    setTimeout(() => document.addEventListener('click', close), 0);
  }
}

function toggleCalMobileFilter() {
  const dd = document.getElementById('cal-mobile-filter-dropdown');
  if (!dd) return;
  const isOpen = dd.style.display !== 'none';
  dd.style.display = isOpen ? 'none' : '';
  if (!isOpen) {
    const close = (e) => {
      if (!dd.contains(e.target) && e.target.id !== 'cal-mobile-filter-btn') {
        dd.style.display = 'none';
        document.removeEventListener('click', close);
      }
    };
    setTimeout(() => document.addEventListener('click', close), 0);
  }
}

function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + (m || 0);
}

async function openCalendarForm(station, date, startTime, editId, forStaffId) {
  let appt = {
    station: 'Allgemein',
    appointment_date: date || calCurrentDate,
    start_time: startTime || '08:00',
    end_time: '',
    customer_name: '',
    phone: '',
    email: '',
    license_plate: '',
    vehicle_type: '',
    vehicle_model: '',
    booking_method: 'Telefonisch',
    notes: '',
    assigned_staff_id: forStaffId || null
  };

  // Load staff for the staff dropdown
  let calendarStaffOptions = [];
  let allStaff = [];
  try {
    allStaff = await api('/api/staff');
    calendarStaffOptions = allStaff.filter(s => s.active && s.has_calendar);
  } catch (e) {}

  if (!appt.end_time) {
    const sm = timeToMinutes(appt.start_time);
    const eh = Math.floor((sm + 30) / 60);
    const em = (sm + 30) % 60;
    appt.end_time = `${String(eh).padStart(2,'0')}:${String(em).padStart(2,'0')}`;
  }

  let isEdit = false;
  if (editId) {
    try {
      const all = await api(`/api/calendar?date=${date}`);
      const found = all.find(a => a.id === editId);
      if (found) { appt = found; isEdit = true; }
    } catch (e) {}
  }

  const staffName = forStaffId && !editId ? (allStaff.find(s => s.id == forStaffId) || {}).name || '' : '';
  const title = isEdit ? 'Termin bearbeiten' : (staffName ? `Neuer Termin für ${staffName}` : 'Neuer Termin');
  const html = `
    <form onsubmit="saveCalendarAppointment(event, ${isEdit ? editId : 'null'})">
      <div class="form-row">
        <div class="form-group">
          <label>Mitarbeiter</label>
          <select id="cal-assigned-staff" onchange="toggleCalFormFields()">
            <option value="" ${!appt.assigned_staff_id ? 'selected' : ''}>Allgemein (kein Mitarbeiter)</option>
            ${calendarStaffOptions.map(s => `<option value="${s.id}" ${appt.assigned_staff_id == s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Datum *</label>
          <input type="date" id="cal-date" value="${appt.appointment_date}" required>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Von *</label>
          <input type="time" id="cal-start" value="${appt.start_time}" step="300" required onchange="calAutoEndTime()">
        </div>
        <div class="form-group">
          <label>Bis *</label>
          <input type="time" id="cal-end" value="${appt.end_time}" step="300" required>
        </div>
        <div class="form-group" id="cal-booking-group">
          <label>Buchungsart *</label>
          <select id="cal-booking" onchange="toggleCalBlocker()">
            ${BOOKING_METHODS.map(m => `<option value="${m}" ${appt.booking_method === m ? 'selected' : ''}>${m}</option>`).join('')}
          </select>
        </div>
      </div>
      <input type="hidden" id="cal-customer-id" value="${appt.customer_id || ''}">
      <div id="cal-detail-fields" style="${appt.booking_method === 'Blocker' ? 'display:none;' : ''}">
        <div id="cal-normal-fields">
          <div class="form-group" style="position:relative;">
            <label>Kunde suchen</label>
            <input type="text" id="cal-customer-search" placeholder="Name, Firma oder Kennzeichen..." autocomplete="off" oninput="calSearchCustomer(this.value)">
            <div id="cal-customer-results" style="display:none;position:absolute;z-index:200;left:0;right:0;top:100%;background:var(--card-bg);border:1px solid var(--border);border-radius:0 0 8px 8px;box-shadow:0 4px 16px rgba(0,0,0,0.15);max-height:200px;overflow-y:auto;"></div>
          </div>
          <div id="cal-customer-badge" style="display:${appt.customer_id ? '' : 'none'};margin-bottom:8px;">
            <span style="background:#e0f2fe;color:#0369a1;font-size:12px;font-weight:600;padding:3px 10px;border-radius:4px;">Kunde Nr. <span id="cal-customer-badge-id">${appt.customer_id || ''}</span></span>
            <button type="button" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:14px;margin-left:4px;" onclick="calClearCustomerLink()" title="Kundenverknüpfung entfernen">&times;</button>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Kundenname *</label>
              <input type="text" id="cal-name" value="${escapeHtml(appt.customer_name)}">
            </div>
            <div class="form-group">
              <label>Telefon</label>
              <input type="text" id="cal-phone" value="${escapeHtml(appt.phone)}">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>E-Mail</label>
              <input type="email" id="cal-email" value="${escapeHtml(appt.email)}">
            </div>
            <div class="form-group">
              <label>Kennzeichen</label>
              <input type="text" id="cal-plate" value="${escapeHtml(appt.license_plate)}">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Bauart</label>
              <select id="cal-vtype">
                <option value="">-- Auswählen --</option>
                ${VEHICLE_TYPES.map(t => `<option value="${t}" ${appt.vehicle_type === t ? 'selected' : ''}>${t}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label>Fahrzeug/Modell</label>
              <input type="text" id="cal-vmodel" value="${escapeHtml(appt.vehicle_model)}">
            </div>
          </div>
        </div>
        <div class="form-group">
          <label>Notizen</label>
          <textarea id="cal-notes" rows="2">${escapeHtml(appt.notes)}</textarea>
        </div>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">${isEdit ? 'Speichern' : 'Termin anlegen'}</button>
        ${isEdit ? `<button type="button" class="btn btn-danger" onclick="deleteCalendarAppointment(${editId})">Löschen</button>` : ''}
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Abbrechen</button>
      </div>
    </form>
  `;
  openModal(title, html);
}

let calSearchTimeout = null;
async function calSearchCustomer(term) {
  const resultsDiv = document.getElementById('cal-customer-results');
  if (!resultsDiv) return;
  if (!term || term.length < 2) { resultsDiv.style.display = 'none'; return; }
  clearTimeout(calSearchTimeout);
  calSearchTimeout = setTimeout(async () => {
    try {
      const customers = await api(`/api/customers?search=${encodeURIComponent(term)}`);
      if (customers.length === 0) {
        resultsDiv.innerHTML = '<div style="padding:8px 12px;color:var(--text-muted);font-size:13px;">Keine Kunden gefunden</div>';
        resultsDiv.style.display = '';
        return;
      }
      // Load vehicles for matching customers
      const vehiclePromises = customers.slice(0, 10).map(c => api(`/api/customers/${c.id}`).catch(() => null));
      const details = await Promise.all(vehiclePromises);
      let html = '';
      customers.slice(0, 10).forEach((c, i) => {
        const detail = details[i];
        const vehicles = detail ? (detail.vehicles || []) : [];
        const displayName = (c.customer_type === 'Firmenkunde' || c.customer_type === 'Werkstatt') ? (c.company_name || '') : (c.last_name + ', ' + c.first_name);
        const plates = vehicles.map(v => v.license_plate).filter(Boolean).join(', ');
        html += `<div style="padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border);font-size:13px;" onmousedown="calSelectCustomer(${c.id}, ${i})" onmouseover="this.style.background='var(--bg-dark)'" onmouseout="this.style.background=''">
          <strong>${escapeHtml(displayName)}</strong>
          ${c.phone ? ' | ' + escapeHtml(c.phone) : ''}
          ${plates ? '<br><span style="color:var(--text-muted);">Kennzeichen: ' + escapeHtml(plates) + '</span>' : ''}
        </div>`;
      });
      resultsDiv.innerHTML = html;
      resultsDiv.style.display = '';
      // Store customer data for selection
      resultsDiv._customers = customers.slice(0, 10);
      resultsDiv._details = details;
    } catch (err) {
      resultsDiv.style.display = 'none';
    }
  }, 300);
}

function calSelectCustomer(customerId, idx) {
  const resultsDiv = document.getElementById('cal-customer-results');
  const customers = resultsDiv._customers || [];
  const details = resultsDiv._details || [];
  const c = customers[idx];
  const detail = details[idx];
  if (!c) return;

  const displayName = (c.customer_type === 'Firmenkunde' || c.customer_type === 'Werkstatt') ? (c.company_name || '') : (c.last_name + ', ' + c.first_name);
  document.getElementById('cal-name').value = displayName;
  document.getElementById('cal-phone').value = c.phone || '';
  document.getElementById('cal-email').value = c.email || '';
  const custIdField = document.getElementById('cal-customer-id');
  if (custIdField) custIdField.value = c.id;
  const badge = document.getElementById('cal-customer-badge');
  const badgeId = document.getElementById('cal-customer-badge-id');
  if (badge && badgeId) { badgeId.textContent = c.id; badge.style.display = ''; }

  // Remove any existing vehicle picker and notes display
  const oldPicker = document.getElementById('cal-vehicle-picker');
  if (oldPicker) oldPicker.remove();
  const oldNotes = document.getElementById('cal-customer-notes');
  if (oldNotes) oldNotes.remove();

  // Show customer notes if present (read-only)
  const customerNotes = detail ? (detail.notes || '') : '';
  if (customerNotes.trim()) {
    const notesDiv = document.createElement('div');
    notesDiv.id = 'cal-customer-notes';
    notesDiv.style.cssText = 'margin-bottom:12px;padding:10px 14px;background:var(--bg-dark);border:1px solid var(--border);border-radius:6px;';
    notesDiv.innerHTML = `<label style="font-weight:600;margin-bottom:4px;display:block;font-size:12px;color:var(--text-muted);">Kundennotizen</label>
      <div style="font-size:13px;white-space:pre-wrap;">${escapeHtml(customerNotes)}</div>`;
    const nameField = document.getElementById('cal-name').closest('.form-row');
    nameField.parentElement.insertBefore(notesDiv, nameField.nextSibling);
  }

  const vehicles = detail ? (detail.vehicles || []) : [];
  if (vehicles.length > 1) {
    // Show vehicle picker dropdown
    const plateGroup = document.getElementById('cal-plate').closest('.form-group');
    const pickerHtml = document.createElement('div');
    pickerHtml.id = 'cal-vehicle-picker';
    pickerHtml.style.cssText = 'margin-bottom:12px;';
    let options = '<option value="">-- Fahrzeug auswählen --</option>';
    vehicles.forEach((v, vi) => {
      const label = (v.license_plate || 'Ohne Kennzeichen') + ' - ' + (v.manufacturer || '') + ' ' + (v.model || '') + (v.vehicle_type ? ' (' + v.vehicle_type + ')' : '');
      options += `<option value="${vi}">${escapeHtml(label)}</option>`;
    });
    pickerHtml.innerHTML = `<label style="font-weight:600;margin-bottom:4px;display:block;">Fahrzeug des Kunden</label>
      <select id="cal-vehicle-select" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-size:14px;" onchange="calPickVehicle()">
        ${options}
      </select>`;
    plateGroup.parentElement.insertBefore(pickerHtml, plateGroup.parentElement.firstChild);
    // Store vehicles for picker
    pickerHtml._vehicles = vehicles;
    // Clear vehicle fields until selection
    document.getElementById('cal-plate').value = '';
    const vtypeSelect = document.getElementById('cal-vtype');
    if (vtypeSelect) vtypeSelect.value = '';
    document.getElementById('cal-vmodel').value = '';
  } else if (vehicles.length === 1) {
    // Single vehicle: auto-fill
    calFillVehicleFields(vehicles[0]);
  }

  // Clear search
  document.getElementById('cal-customer-search').value = '';
  resultsDiv.style.display = 'none';
}

function calPickVehicle() {
  const select = document.getElementById('cal-vehicle-select');
  const picker = document.getElementById('cal-vehicle-picker');
  if (!select || !picker) return;
  const vi = select.value;
  if (vi === '') {
    document.getElementById('cal-plate').value = '';
    const vtypeSelect = document.getElementById('cal-vtype');
    if (vtypeSelect) vtypeSelect.value = '';
    document.getElementById('cal-vmodel').value = '';
    return;
  }
  const vehicles = picker._vehicles || [];
  const v = vehicles[parseInt(vi)];
  if (v) calFillVehicleFields(v);
}

function calClearCustomerLink() {
  const f = document.getElementById('cal-customer-id');
  if (f) f.value = '';
  const badge = document.getElementById('cal-customer-badge');
  if (badge) badge.style.display = 'none';
}

function calFillVehicleFields(v) {
  document.getElementById('cal-plate').value = v.license_plate || '';
  const vtypeSelect = document.getElementById('cal-vtype');
  if (vtypeSelect) vtypeSelect.value = v.vehicle_type || '';
  document.getElementById('cal-vmodel').value = (v.manufacturer || '') + (v.model ? ' ' + v.model : '');
}

function showCalTooltip(e) {
  hideCalTooltip();
  const el = e.currentTarget;
  const custNotes = el.getAttribute('data-cust-notes') || '';
  const apptNotes = el.getAttribute('data-appt-notes') || '';
  if (!custNotes && !apptNotes) return;
  const tip = document.createElement('div');
  tip.id = 'cal-tooltip';
  tip.style.cssText = 'position:fixed;z-index:9999;background:#1e293b;color:#f1f5f9;padding:14px 18px;border-radius:10px;font-size:13px;min-width:250px;max-width:400px;box-shadow:0 8px 30px rgba(0,0,0,0.35);pointer-events:none;line-height:1.6;';
  let html = '';
  if (custNotes) {
    html += '<div style="margin-bottom:' + (apptNotes ? '10px' : '0') + ';">';
    html += '<div style="font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#94a3b8;margin-bottom:4px;">Kundennotiz</div>';
    html += '<div style="white-space:pre-wrap;">' + custNotes + '</div>';
    html += '</div>';
  }
  if (custNotes && apptNotes) {
    html += '<hr style="border:none;border-top:1px solid rgba(255,255,255,0.15);margin:0 0 10px 0;">';
  }
  if (apptNotes) {
    html += '<div>';
    html += '<div style="font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#94a3b8;margin-bottom:4px;">Pr\u00fcfungsnotiz</div>';
    html += '<div style="white-space:pre-wrap;">' + apptNotes + '</div>';
    html += '</div>';
  }
  tip.innerHTML = html;
  document.body.appendChild(tip);
  const rect = el.getBoundingClientRect();
  let left = rect.right + 10;
  let top = rect.top;
  if (left + 420 > window.innerWidth) left = rect.left - tip.offsetWidth - 10;
  if (top + tip.offsetHeight > window.innerHeight) top = window.innerHeight - tip.offsetHeight - 10;
  if (top < 8) top = 8;
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
}
function hideCalTooltip() {
  const t = document.getElementById('cal-tooltip');
  if (t) t.remove();
}

function calAutoEndTime() {
  const startEl = document.getElementById('cal-start');
  const endEl = document.getElementById('cal-end');
  if (!startEl || !endEl || !startEl.value) return;
  const sm = timeToMinutes(startEl.value);
  const em = sm + 30;
  const h = Math.floor(em / 60);
  const m = em % 60;
  endEl.value = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

function toggleCalBlocker() {
  const isBlocker = document.getElementById('cal-booking').value === 'Blocker';
  document.getElementById('cal-detail-fields').style.display = isBlocker ? 'none' : '';
}

function toggleCalFormFields() {
  // Staff-based form: no special field toggling needed
  // The form always shows normal fields
}

// Keep old name as alias for backward compat
function toggleCalPruefer() { toggleCalFormFields(); }

function calAussenCustomerChange() {
  const sel = document.getElementById('cal-aussen-customer');
  const opt = sel.options[sel.selectedIndex];
  const phoneField = document.getElementById('cal-aussen-phone');
  if (phoneField) phoneField.value = opt && opt.dataset.phone ? opt.dataset.phone : '';
}

async function saveCalendarAppointment(e, id) {
  e.preventDefault();
  const assignedStaffVal = document.getElementById('cal-assigned-staff').value;
  const isBlocker = document.getElementById('cal-booking').value === 'Blocker';

  let customerName, phone, email, licensePlate, vehicleType, vehicleModel;
  if (isBlocker) {
    customerName = 'Blocker'; phone = ''; email = ''; licensePlate = ''; vehicleType = ''; vehicleModel = '';
  } else {
    customerName = document.getElementById('cal-name').value.trim();
    phone = document.getElementById('cal-phone').value.trim();
    email = document.getElementById('cal-email').value.trim();
    licensePlate = document.getElementById('cal-plate').value.trim();
    vehicleType = document.getElementById('cal-vtype').value;
    vehicleModel = document.getElementById('cal-vmodel').value.trim();
  }

  const data = {
    station: 'Allgemein',
    appointment_date: document.getElementById('cal-date').value,
    start_time: document.getElementById('cal-start').value,
    end_time: document.getElementById('cal-end').value,
    customer_name: customerName,
    phone: phone,
    email: email,
    license_plate: licensePlate,
    vehicle_type: vehicleType,
    vehicle_model: vehicleModel,
    booking_method: document.getElementById('cal-booking').value,
    notes: isBlocker ? '' : document.getElementById('cal-notes').value.trim(),
    assigned_staff_id: assignedStaffVal || null,
    customer_id: document.getElementById('cal-customer-id').value || null,
  };
  if (!isBlocker && !data.customer_name) { showToast('Kundenname ist Pflichtfeld', 'error'); return; }
  try {
    if (id) {
      await api(`/api/calendar/${id}`, { method: 'PUT', body: data });
      showToast('Termin aktualisiert');
    } else {
      await api('/api/calendar', { method: 'POST', body: data });
      showToast('Termin erstellt');
    }
    closeModal();
    calCurrentDate = data.appointment_date;
    renderCalendar();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteCalendarAppointment(id) {
  if (!confirm('Termin wirklich löschen?')) return;
  try {
    await api(`/api/calendar/${id}`, { method: 'DELETE' });
    showToast('Termin gelöscht');
    closeModal();
    renderCalendar();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function renderStaff() {
  const main = document.getElementById('main-content');

  try {
    const staff = await api('/api/staff?show_all=1');

    main.innerHTML = `
      <div class="page-header">
        <h2>Mitarbeiter</h2>
        <button class="btn btn-primary" onclick="openStaffForm()">+ Neuer Mitarbeiter</button>
      </div>

      <div class="card">
        <div class="filter-bar">
          <div class="form-group">
            <label>Funktion</label>
            <select id="staff-filter-role" onchange="filterStaffTable()">
              <option value="">Alle</option>
              ${STAFF_ROLES.map(r => `<option value="${r.value}">${r.label}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Status</label>
            <select id="staff-filter-active" onchange="filterStaffTable()">
              <option value="1">Nur aktive</option>
              <option value="">Alle</option>
              <option value="0">Nur inaktive</option>
            </select>
          </div>
        </div>

        ${staff.length > 0 ? `
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Funktion</th>
                <th>Freigabelevel</th>
                <th>Kalender</th>
                <th>Status</th>
                <th>Aktionen</th>
              </tr>
            </thead>
            <tbody id="staff-table-body">
              ${staff.map(s => renderStaffRow(s)).join('')}
            </tbody>
          </table>
        </div>` : `
        <div class="empty-state">
          <p>Keine Mitarbeiter angelegt.</p>
          <button class="btn btn-primary" onclick="openStaffForm()">Ersten Mitarbeiter anlegen</button>
        </div>`}
      </div>
    `;
  } catch (err) {
    main.innerHTML = `<div class="empty-state"><p>Fehler: ${escapeHtml(err.message)}</p></div>`;
  }
}

function renderStaffRow(s) {
  return `
    <tr data-role="${escapeHtml(s.role)}" data-active="${s.active}">
      <td><strong>${escapeHtml(s.name)}</strong></td>
      <td>${getRoleLabel(s.role)}</td>
      <td>${escapeHtml(s.permission_level || 'Benutzer')}</td>
      <td>${s.has_calendar ? '<span class="badge badge-blue">Ja</span>' : '<span class="badge badge-gray">Nein</span>'}</td>
      <td>
        ${s.active
          ? '<span class="badge badge-green">Aktiv</span>'
          : '<span class="badge badge-red">Inaktiv</span>'}
      </td>
      <td>
        <button class="btn btn-sm btn-secondary" onclick="openStaffForm(${s.id})">Bearbeiten</button>
        ${s.active
          ? `<button class="btn btn-sm btn-danger" onclick="toggleStaffActive(${s.id}, 0)">Deaktivieren</button>`
          : `<button class="btn btn-sm btn-success" onclick="toggleStaffActive(${s.id}, 1)">Aktivieren</button>`}
        ${isAdmin() ? `<button class="btn btn-sm btn-danger" onclick="deleteStaff(${s.id}, '${escapeHtml(s.name)}')">Löschen</button>` : ''}
      </td>
    </tr>`;
}

function filterStaffTable() {
  const roleFilter = document.getElementById('staff-filter-role').value;
  const activeFilter = document.getElementById('staff-filter-active').value;
  const rows = document.querySelectorAll('#staff-table-body tr');

  rows.forEach(row => {
    const role = row.dataset.role;
    const active = row.dataset.active;
    const matchRole = !roleFilter || role === roleFilter;
    const matchActive = activeFilter === '' || active === activeFilter;
    row.style.display = (matchRole && matchActive) ? '' : 'none';
  });
}

async function openStaffForm(id) {
  let staff = { name: '', role: '', station: '', password: '', permission_level: 'Benutzer', active: 1, has_calendar: 1, calendar_visibility: 'Admin,Verwaltung,Buchhaltung,Benutzer', vacation_days: 30, weekly_hours: 40, work_days: '1,2,3,4,5', entry_date: '', exit_date: '', email: '', street: '', zip: '', city: '', phone_private: '', phone_business: '', emergency_name: '', emergency_phone: '', default_station_id: null, username: '' };
  let perYearDays = {};
  let perYearBonus = {};

  const currentYear = new Date().getFullYear();
  const yearFrom = currentYear - 5;
  const yearTo = currentYear + 2;

  if (id) {
    try {
      const [allStaff, yearDaysArr] = await Promise.all([
        api('/api/staff?show_all=1'),
        api(`/api/staff/${id}/vacation-days`)
      ]);
      staff = allStaff.find(s => s.id === id) || staff;
      if (staff.has_calendar === null || staff.has_calendar === undefined) staff.has_calendar = 1;
      yearDaysArr.forEach(r => { perYearDays[r.year] = r.days; perYearBonus[r.year] = r.bonus_days || 0; });
    } catch (err) {
      showToast('Fehler beim Laden', 'error');
      return;
    }
  }

  // Build per-year vacation day inputs
  const defaultDays = staff.vacation_days !== undefined ? staff.vacation_days : 30;
  let yearInputsHtml = '';
  for (let y = yearFrom; y <= yearTo; y++) {
    const val = perYearDays[y] !== undefined ? perYearDays[y] : defaultDays;
    const bonus = perYearBonus[y] || 0;
    yearInputsHtml += `
      <div style="display:flex;align-items:center;gap:6px;">
        <label style="min-width:42px;font-size:13px;margin:0;">${y}</label>
        <input type="number" name="vac_${y}" value="${val}" min="0" max="365" style="width:70px;padding:4px 6px;">
        ${bonus > 0 ? `<span style="font-size:11px;color:var(--success);white-space:nowrap;">+${bonus} WB</span>` : ''}
      </div>`;
  }

  const title = id ? 'Mitarbeiter bearbeiten' : 'Neuer Mitarbeiter';
  const html = `
    <form id="staff-form" onsubmit="saveStaff(event, ${id || 'null'})">
      <div class="form-group">
        <label>Name *</label>
        <input type="text" name="name" value="${escapeHtml(staff.name)}" required>
      </div>
      <div class="form-group">
        <label>Funktion *</label>
        <select name="role" required>
          <option value="">-- Auswählen --</option>
          ${STAFF_ROLES.map(r => `<option value="${r.value}" ${staff.role === r.value ? 'selected' : ''}>${r.label}</option>`).join('')}
        </select>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Benutzername</label>
          <input type="text" name="username" value="${escapeHtml(staff.username || '')}" placeholder="Login-Name" autocomplete="off">
        </div>
        <div class="form-group">
          <label>Passwort</label>
          <input type="password" name="password" value="${escapeHtml(staff.password || '')}">
        </div>
      </div>
      <div class="form-group">
        <label>E-Mail</label>
        <input type="email" name="email" value="${escapeHtml(staff.email || '')}">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Straße</label>
          <input type="text" name="street" value="${escapeHtml(staff.street || '')}">
        </div>
        <div class="form-group">
          <label>PLZ</label>
          <input type="text" name="zip" value="${escapeHtml(staff.zip || '')}" style="max-width:100px;">
        </div>
        <div class="form-group">
          <label>Ort</label>
          <input type="text" name="city" value="${escapeHtml(staff.city || '')}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Telefon privat</label>
          <input type="text" name="phone_private" value="${escapeHtml(staff.phone_private || '')}">
        </div>
        <div class="form-group">
          <label>Telefon geschäftlich</label>
          <input type="text" name="phone_business" value="${escapeHtml(staff.phone_business || '')}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Notfallkontakt Name</label>
          <input type="text" name="emergency_name" value="${escapeHtml(staff.emergency_name || '')}">
        </div>
        <div class="form-group">
          <label>Notfallkontakt Telefon</label>
          <input type="text" name="emergency_phone" value="${escapeHtml(staff.emergency_phone || '')}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Eintrittsdatum *</label>
          <input type="date" name="entry_date" value="${staff.entry_date || ''}" required>
        </div>
        <div class="form-group">
          <label>Austrittsdatum</label>
          <input type="date" name="exit_date" value="${staff.exit_date || ''}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Wochenstunden</label>
          <input type="number" name="weekly_hours" value="${staff.weekly_hours || 40}" step="0.5" min="0" max="60">
        </div>
        <div class="form-group">
          <label>Standard-Standort</label>
          <select name="default_station_id">
            <option value="">-- Kein Standard --</option>
            ${ALL_STATIONS.map(s => `<option value="${s.id}" ${staff.default_station_id == s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>Arbeitstage</label>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          ${[{n:1,l:'Mo'},{n:2,l:'Di'},{n:3,l:'Mi'},{n:4,l:'Do'},{n:5,l:'Fr'},{n:6,l:'Sa'},{n:7,l:'So'}].map(d => {
            const checked = (staff.work_days || '1,2,3,4,5').split(',').map(Number).includes(d.n);
            return `<div class="form-check" style="margin:0;">
              <input type="checkbox" name="work_day_${d.n}" id="work-day-${d.n}" ${checked ? 'checked' : ''}>
              <label for="work-day-${d.n}" style="font-size:13px;">${d.l}</label>
            </div>`;
          }).join('')}
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Freigabelevel</label>
          <select name="permission_level" ${isAdmin() ? '' : 'disabled'}>
            ${['Benutzer', 'Verwaltung', 'Buchhaltung', 'Admin'].map(l => `<option value="${l}" ${(staff.permission_level || 'Benutzer') === l ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
          ${isAdmin() ? '' : '<input type="hidden" name="permission_level" value="' + escapeHtml(staff.permission_level || 'Benutzer') + '">'}
        </div>
      </div>
      <div class="form-group">
        <label>Urlaubstage pro Jahr</label>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          ${yearInputsHtml}
        </div>
      </div>
      <div class="form-group">
        <div class="form-check">
          <input type="checkbox" name="active" id="staff-active" ${staff.active ? 'checked' : ''}>
          <label for="staff-active">Mitarbeiter ist aktiv</label>
        </div>
        <div class="form-check" style="margin-top:8px;">
          <input type="checkbox" name="has_calendar" id="staff-has-calendar" ${staff.has_calendar ? 'checked' : ''} onchange="document.getElementById('calendar-visibility-group').style.display = this.checked ? '' : 'none'">
          <label for="staff-has-calendar">Eigener Kalender</label>
        </div>
        <div id="calendar-visibility-group" style="margin-top:8px;margin-left:24px;${staff.has_calendar ? '' : 'display:none;'}">
          <label style="font-size:13px;font-weight:600;margin-bottom:4px;display:block;">Sichtbar für:</label>
          ${['Admin','Verwaltung','Buchhaltung','Benutzer'].map(g => {
            const checked = (staff.calendar_visibility || 'Admin,Verwaltung,Buchhaltung,Benutzer').split(',').includes(g);
            return `<div class="form-check" style="margin-top:2px;">
              <input type="checkbox" name="cal_vis_${g}" id="cal-vis-${g}" ${checked ? 'checked' : ''}>
              <label for="cal-vis-${g}" style="font-size:13px;">${g}</label>
            </div>`;
          }).join('')}
        </div>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">${id ? 'Speichern' : 'Anlegen'}</button>
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Abbrechen</button>
      </div>
    </form>
  `;
  openModal(title, html);
}

async function saveStaff(e, id) {
  e.preventDefault();
  const form = e.target;
  const pw = form.password.value;
  if (pw !== '') {
    if (pw.length < 8) {
      showToast('Passwort muss mindestens 8 Zeichen haben', 'error');
      return;
    }
    if (!/[A-Z]/.test(pw)) {
      showToast('Passwort muss mindestens einen Großbuchstaben enthalten', 'error');
      return;
    }
    if (!/[^a-zA-Z0-9]/.test(pw)) {
      showToast('Passwort muss mindestens ein Sonderzeichen enthalten', 'error');
      return;
    }
  }

  const currentYear = new Date().getFullYear();
  const yearFrom = currentYear - 5;
  const yearTo = currentYear + 2;

  // Collect per-year vacation days
  const yearDays = [];
  for (let y = yearFrom; y <= yearTo; y++) {
    const input = form.querySelector(`[name="vac_${y}"]`);
    if (input) yearDays.push({ year: y, days: parseInt(input.value) || 30 });
  }

  const data = {
    name: form.name.value.trim(),
    role: form.role.value,
    station: '',
    password: pw,
    permission_level: form.permission_level.value,
    active: form.active.checked ? 1 : 0,
    has_calendar: document.getElementById('staff-has-calendar').checked ? 1 : 0,
    calendar_visibility: ['Admin','Verwaltung','Buchhaltung','Benutzer'].filter(g => document.getElementById('cal-vis-' + g)?.checked).join(','),
    vacation_days: yearDays.length > 0 ? yearDays.find(yd => yd.year === currentYear)?.days || 30 : 30,
    entry_date: form.entry_date.value,
    exit_date: form.exit_date.value,
    email: form.email.value.trim(),
    street: form.street.value.trim(),
    zip: form.zip.value.trim(),
    city: form.city.value.trim(),
    phone_private: form.phone_private.value.trim(),
    phone_business: form.phone_business.value.trim(),
    emergency_name: form.emergency_name.value.trim(),
    emergency_phone: form.emergency_phone.value.trim(),
    weekly_hours: parseFloat(form.weekly_hours.value) || 40,
    work_days: [1,2,3,4,5,6,7].filter(n => document.getElementById('work-day-' + n)?.checked).join(',') || '1,2,3,4,5',
    default_station_id: form.default_station_id.value ? Number(form.default_station_id.value) : null,
    username: form.username.value.trim(),
  };

  try {
    let staffId = id;
    if (id) {
      await api(`/api/staff/${id}`, { method: 'PUT', body: data });
    } else {
      const result = await api('/api/staff', { method: 'POST', body: data });
      staffId = result.id;
    }
    // Save per-year vacation days
    if (staffId && yearDays.length > 0) {
      await api(`/api/staff/${staffId}/vacation-days`, { method: 'PUT', body: { yearDays } });
    }
    showToast(id ? 'Mitarbeiter aktualisiert' : 'Mitarbeiter angelegt');
    closeModal();
    renderStaff();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function toggleStaffActive(id, active) {
  try {
    const allStaff = await api('/api/staff?show_all=1');
    const staff = allStaff.find(s => s.id === id);
    if (!staff) return;
    await api(`/api/staff/${id}`, { method: 'PUT', body: { ...staff, active } });
    showToast(active ? 'Mitarbeiter aktiviert' : 'Mitarbeiter deaktiviert');
    renderStaff();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteStaff(id, name) {
  if (!confirm(`Mitarbeiter "${name}" wirklich endgültig löschen?`)) return;
  try {
    await api(`/api/staff/${id}`, { method: 'DELETE' });
    showToast('Mitarbeiter gelöscht');
    renderStaff();
  } catch (err) {
    showToast(err.message, 'error');
  }
}


// ===== PAGE: An-/Abwesenheitsplaner =====
const VACATION_ENTRY_TYPES = ['Urlaub', 'Halber Urlaubstag', 'Krankheit', 'Weiterbildung'];
const VACATION_STAFF_COLORS = ['#2563eb','#dc2626','#059669','#d97706','#7c3aed','#db2777','#0891b2','#65a30d','#c026d3','#ea580c'];
let vacCurrentYear = new Date().getFullYear();
let vacSelectedStaff = 'alle';

function getNRWHolidays(year) {
  // Easter calculation (Anonymous Gregorian algorithm)
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  const easter = new Date(year, month - 1, day);

  function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
  function fmt(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }

  return new Map([
    [`${year}-01-01`, 'Neujahr'],
    [fmt(addDays(easter, -2)), 'Karfreitag'],
    [fmt(addDays(easter, 1)), 'Ostermontag'],
    [`${year}-05-01`, 'Tag der Arbeit'],
    [fmt(addDays(easter, 39)), 'Christi Himmelfahrt'],
    [fmt(addDays(easter, 50)), 'Pfingstmontag'],
    [fmt(addDays(easter, 60)), 'Fronleichnam'],
    [`${year}-10-03`, 'Tag der Deutschen Einheit'],
    [`${year}-11-01`, 'Allerheiligen'],
    [`${year}-12-25`, '1. Weihnachtstag'],
    [`${year}-12-26`, '2. Weihnachtstag'],
  ]);
}

function getVacationDaysInRange(startDate, endDate, holidays) {
  const days = [];
  const s = new Date(startDate + 'T12:00:00');
  const e = new Date(endDate + 'T12:00:00');
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
    days.push(localDateStr(d));
  }
  return days;
}

function countWorkdays(days, holidays) {
  return days.filter(d => {
    const dt = new Date(d + 'T12:00:00');
    const dow = dt.getDay();
    return dow !== 0 && dow !== 6 && !holidays.has(d);
  }).length;
}
// Note: holidays is now a Map but .has() works the same

function getVacSubNav(active) {
  return `<div style="display:flex;gap:8px;margin-bottom:18px;">
    <button class="btn ${active === 'calendar' ? 'btn-primary' : 'btn-secondary'}" onclick="navigate('vacation')">Kalender</button>
    <button class="btn ${active === 'requests' ? 'btn-primary' : 'btn-secondary'}" onclick="navigate('vacation-requests')">Urlaubsanträge</button>
  </div>`;
}

async function renderVacation() {
  const main = document.getElementById('main-content');
  try {
    const [entries, staffList] = await Promise.all([
      api(`/api/vacation?year=${vacCurrentYear}&status=Genehmigt`),
      api('/api/staff')
    ]);
    const holidays = getNRWHolidays(vacCurrentYear);
    const months = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];

    // Build staff color map
    const staffColorMap = {};
    staffList.forEach((s, i) => { staffColorMap[s.id] = VACATION_STAFF_COLORS[i % VACATION_STAFF_COLORS.length]; });

    // Filter entries based on selected staff
    let visibleEntries = entries;
    if (vacSelectedStaff === 'alle') {
      visibleEntries = entries.filter(e => e.entry_type === 'Urlaub');
    } else {
      visibleEntries = entries.filter(e => e.staff_id === Number(vacSelectedStaff));
    }

    // Build day map: dateStr -> [{staff_id, entry_type, entry_id}]
    const dayMap = {};
    visibleEntries.forEach(e => {
      const days = getVacationDaysInRange(e.start_date, e.end_date, holidays);
      days.forEach(d => {
        // Urlaub/Krankheit only on workdays, Weiterbildung also on weekends/holidays
        if (e.entry_type !== 'Weiterbildung') {
          const dt = new Date(d + 'T12:00:00');
          const dow = dt.getDay();
          if (dow === 0 || dow === 6 || holidays.has(d)) return;
        }
        if (!dayMap[d]) dayMap[d] = [];
        dayMap[d].push({ staff_id: e.staff_id, entry_type: e.entry_type, id: e.id, staff_name: e.staff_name, payment_status: e.payment_status || 0, half_day: e.half_day || 0 });
      });
    });

    // Calculate stats for selected staff (current year only)
    let statsHtml = '';
    if (vacSelectedStaff !== 'alle') {
      const staffObj = staffList.find(s => s.id === Number(vacSelectedStaff));
      if (staffObj) {
        // Fetch per-year vacation days for this staff
        const perYearDaysArr = await api(`/api/staff/${staffObj.id}/vacation-days`);
        const perYearMap = {};
        const perYearBonusMap = {};
        perYearDaysArr.forEach(r => { perYearMap[r.year] = r.days; perYearBonusMap[r.year] = r.bonus_days || 0; });
        const baseDays = perYearMap[vacCurrentYear] !== undefined ? perYearMap[vacCurrentYear] : (staffObj.vacation_days || 30);
        const bonusDays = perYearBonusMap[vacCurrentYear] || 0;
        const totalDays = baseDays + bonusDays;
        const hCurrent = getNRWHolidays(vacCurrentYear);

        // Count workdays per entry type for the selected year
        let urlaubDays = 0, krankheitDays = 0, weiterbildungDays = 0;
        visibleEntries.forEach(e => {
          const yStart = `${vacCurrentYear}-01-01`, yEnd = `${vacCurrentYear}-12-31`;
          const effStart = e.start_date > yStart ? e.start_date : yStart;
          const effEnd = e.end_date < yEnd ? e.end_date : yEnd;
          if (effStart > effEnd) return;
          const days = getVacationDaysInRange(effStart, effEnd, hCurrent);
          const wd = e.half_day ? 0.5 : countWorkdays(days, hCurrent);
          if (e.entry_type === 'Urlaub') urlaubDays += wd;
          else if (e.entry_type === 'Krankheit') krankheitDays += wd;
          else if (e.entry_type === 'Weiterbildung') weiterbildungDays += wd;
        });
        const remaining = totalDays - urlaubDays;
        const anspruchLabel = bonusDays > 0 ? `${baseDays} + ${bonusDays} Weiterbildung = ${totalDays}` : `${totalDays}`;

        statsHtml = `
          <div style="margin-bottom:14px;font-size:14px;line-height:1.8;color:var(--text-primary);">
            <strong>Urlaubsanspruch ${vacCurrentYear}:</strong> ${anspruchLabel} Tage &nbsp;|&nbsp;
            <strong>Verplant:</strong> ${String(urlaubDays).replace('.', ',')} Tage &nbsp;|&nbsp;
            <strong>Übrig:</strong> <span style="color:${remaining < 0 ? '#dc2626' : '#059669'};font-weight:700;">${String(remaining).replace('.', ',')} Tage</span>
            ${remaining < 0 ? ' <span style="color:#dc2626;">(überbucht)</span>' : ''}
            &nbsp;|&nbsp;
            <strong>Krankheitstage:</strong> ${String(krankheitDays).replace('.', ',')} &nbsp;|&nbsp;
            <strong>Weiterbildungstage:</strong> ${String(weiterbildungDays).replace('.', ',')}
          </div>`;
      }
    }

    // Legend for "Alle" view
    let legendHtml = '';
    if (vacSelectedStaff === 'alle') {
      const staffWithEntries = [...new Set(visibleEntries.map(e => e.staff_id))];
      legendHtml = `<div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:10px;align-items:center;">
        <span style="font-weight:600;">Legende:</span>
        ${staffWithEntries.map(sid => {
          const s = staffList.find(st => st.id === sid);
          return s ? `<span style="display:flex;align-items:center;gap:4px;"><span style="width:14px;height:14px;border-radius:3px;background:${staffColorMap[sid]};display:inline-block;"></span> ${escapeHtml(s.name)}</span>` : '';
        }).join('')}
      </div>`;
    } else {
      // Single staff: legend for entry types
      legendHtml = `<div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:10px;align-items:center;">
        <span style="font-weight:600;">Legende:</span>
        <span style="display:flex;align-items:center;gap:4px;"><span style="width:14px;height:14px;border-radius:3px;background:#2563eb;display:inline-block;"></span> Urlaub</span>
        <span style="display:flex;align-items:center;gap:4px;"><span style="width:14px;height:14px;border-radius:3px;background:#dc2626;display:inline-block;"></span> Krankheit</span>
        <span style="display:flex;align-items:center;gap:4px;"><span style="width:14px;height:14px;border-radius:3px;background:#7c3aed;display:inline-block;"></span> Weiterbildung</span>
      </div>`;
    }

    // Build calendar table
    let tableHtml = '<table class="vac-calendar"><tbody>';

    for (let m = 0; m < 12; m++) {
      const daysInMonth = new Date(vacCurrentYear, m + 1, 0).getDate();
      tableHtml += `<tr><td class="vac-month-cell">${months[m]}</td>`;
      for (let d = 1; d <= 31; d++) {
        if (d > daysInMonth) {
          tableHtml += '<td class="vac-day-cell vac-empty"></td>';
          continue;
        }
        const dateStr = `${vacCurrentYear}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const dt = new Date(dateStr + 'T12:00:00');
        const dow = dt.getDay();
        const isWeekend = dow === 0 || dow === 6;
        const isHoliday = holidays.has(dateStr);
        const dayEntries = dayMap[dateStr] || [];

        let cellClass = 'vac-day-cell';
        let cellStyle = '';
        let cellTitle = '';

        if (isHoliday) {
          cellClass += ' vac-holiday';
          cellTitle = holidays.get(dateStr);
        } else if (isWeekend) {
          cellClass += ' vac-weekend';
        }

        if (dayEntries.length > 0) {
          if (vacSelectedStaff === 'alle') {
            if (dayEntries.length === 1) {
              cellStyle = `background:${staffColorMap[dayEntries[0].staff_id]};color:#fff;`;
              cellTitle = dayEntries[0].staff_name;
            } else {
              // Multiple staff - split cell with gradient
              const colors = dayEntries.map(e => staffColorMap[e.staff_id]);
              const pct = 100 / colors.length;
              const stops = colors.map((c, i) => `${c} ${i * pct}%, ${c} ${(i + 1) * pct}%`).join(', ');
              cellStyle = `background:linear-gradient(135deg, ${stops});color:#fff;`;
              cellTitle = dayEntries.map(e => e.staff_name).join(', ');
            }
          } else {
            const entry = dayEntries[0];
            let bgColor = '#2563eb';
            if (entry.entry_type === 'Urlaub') bgColor = '#2563eb';
            else if (entry.entry_type === 'Krankheit') bgColor = '#dc2626';
            else if (entry.entry_type === 'Weiterbildung') bgColor = '#7c3aed';
            if (entry.entry_type === 'Krankheit') {
              const ps = entry.payment_status || 0;
              if (ps === 1) cellStyle = 'background:linear-gradient(135deg, #facc15 33%, #dc2626 33%);color:#fff;';
              else if (ps === 2) cellStyle = 'background:linear-gradient(135deg, #059669 33%, #dc2626 33%);color:#fff;';
              else cellStyle = entry.half_day ? `background:linear-gradient(135deg, ${bgColor} 50%, transparent 50%);` : `background:${bgColor};color:#fff;`;
            } else {
              cellStyle = entry.half_day ? `background:linear-gradient(135deg, ${bgColor} 50%, transparent 50%);` : `background:${bgColor};color:#fff;`;
            }
            cellTitle = entry.entry_type + (entry.half_day ? ' (½ Tag)' : '');
          }
        }

        // Right-click handler for Krankheit payment status (Admin/Buchhaltung only)
        const krankEntry = dayEntries.find(e => e.entry_type === 'Krankheit');
        const rightClick = (krankEntry && isBuchhaltung()) ? ` oncontextmenu="vacCyclePayment(event, ${krankEntry.id}, ${krankEntry.payment_status || 0})"` : '';

        // Check if date is outside staff entry/exit range
        let outsideRange = false;
        if (vacSelectedStaff !== 'alle') {
          const staffObj2 = staffList.find(s => s.id === Number(vacSelectedStaff));
          if (staffObj2) {
            if (staffObj2.entry_date && dateStr < staffObj2.entry_date) outsideRange = true;
            if (staffObj2.exit_date && dateStr > staffObj2.exit_date) outsideRange = true;
          }
        }

        if (outsideRange) {
          tableHtml += `<td class="${cellClass}" style="background:#e5e7eb;color:#9ca3af;cursor:default;" title="Nicht im Unternehmen">${d}</td>`;
        } else if (vacSelectedStaff !== 'alle' && isAdmin()) {
          tableHtml += `<td class="${cellClass}" style="${cellStyle}cursor:pointer;user-select:none;" title="${escapeHtml(cellTitle)}" data-date="${dateStr}" onmousedown="vacDragStart('${dateStr}', event)" onmouseover="vacDragOver('${dateStr}')"${rightClick}>${d}</td>`;
        } else {
          tableHtml += `<td class="${cellClass}" style="${cellStyle}" title="${escapeHtml(cellTitle)}"${rightClick}>${d}</td>`;
        }
      }
      tableHtml += '</tr>';
    }
    tableHtml += '</tbody></table>';

    main.innerHTML = `
      <div class="page-header">
        <h2>An-/Abwesenheitsplaner</h2>
        ${vacSelectedStaff !== 'alle' && isAdmin() ? '<button class="btn btn-primary" onclick="openVacationForm()">Abwesenheit eintragen</button>' : ''}
      </div>
      ${getVacSubNav('calendar')}
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap;">
        <button class="cal-nav-btn" onclick="vacChangeYear(-1)" ${vacCurrentYear <= new Date().getFullYear() - 5 ? 'disabled style="opacity:0.3;"' : ''}>\u25C0</button>
        <h3 style="margin:0;min-width:60px;text-align:center;">${vacCurrentYear}</h3>
        <button class="cal-nav-btn" onclick="vacChangeYear(1)" ${vacCurrentYear >= new Date().getFullYear() + 2 ? 'disabled style="opacity:0.3;"' : ''}>\u25B6</button>
        <div class="form-group" style="margin:0;margin-left:20px;">
          <select id="vac-staff-select" onchange="vacSelectStaff(this.value)" style="padding:6px 10px;">
            <option value="alle" ${vacSelectedStaff === 'alle' ? 'selected' : ''}>Alle Mitarbeiter</option>
            ${staffList.filter(s => {
              const yearStart = `${vacCurrentYear}-01-01`;
              const yearEnd = `${vacCurrentYear}-12-31`;
              if (s.entry_date && s.entry_date > yearEnd) return false;
              if (s.exit_date && s.exit_date < yearStart) return false;
              return true;
            }).map(s => `<option value="${s.id}" ${vacSelectedStaff == s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
          </select>
        </div>
      </div>
      ${statsHtml}
      <div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:6px;align-items:center;">
        <span style="display:flex;align-items:center;gap:4px;"><span style="width:14px;height:14px;border-radius:3px;background:#a8896a;display:inline-block;"></span> Wochenende</span>
        <span style="display:flex;align-items:center;gap:4px;"><span style="width:14px;height:14px;border-radius:3px;background:#facc15;display:inline-block;"></span> Feiertag</span>
      </div>
      ${isBuchhaltung() && vacSelectedStaff !== 'alle' ? `<div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:6px;align-items:center;">
        <span style="font-weight:600;font-size:12px;">Krankheit (Rechtsklick):</span>
        <span style="display:flex;align-items:center;gap:4px;"><span style="width:14px;height:14px;border-radius:3px;background:#dc2626;display:inline-block;"></span> Offen</span>
        <span style="display:flex;align-items:center;gap:4px;"><span style="width:14px;height:14px;border-radius:3px;background:linear-gradient(135deg, #facc15 33%, #dc2626 33%);display:inline-block;"></span> AU eingereicht</span>
        <span style="display:flex;align-items:center;gap:4px;"><span style="width:14px;height:14px;border-radius:3px;background:linear-gradient(135deg, #059669 33%, #dc2626 33%);display:inline-block;"></span> Abgerechnet</span>
      </div>` : ''}
      ${legendHtml}
      <div style="overflow-x:auto;">
        ${tableHtml}
      </div>
      ${vacSelectedStaff !== 'alle' && isAdmin() ? renderVacationList(visibleEntries) : ''}
    `;
  } catch (err) {
    main.innerHTML = `<p class="error">Fehler: ${escapeHtml(err.message)}</p>`;
  }
}

function renderVacationList(entries) {
  if (!entries.length) return '';
  const holidays = getNRWHolidays(vacCurrentYear);
  return `
    <div class="card" style="margin-top:20px;">
      <div class="card-header"><h3>Einträge ${vacCurrentYear}</h3></div>
      <table class="data-table">
        <thead><tr>
          <th>Typ</th><th>Von</th><th>Bis</th><th>Arbeitstage</th><th>Notizen</th><th>Aktionen</th>
        </tr></thead>
        <tbody>
          ${entries.map(e => {
            const days = getVacationDaysInRange(e.start_date, e.end_date, holidays);
            const wd = e.half_day ? 0.5 : countWorkdays(days, holidays);
            const typeColor = e.entry_type === 'Urlaub' ? 'badge-blue' : e.entry_type === 'Krankheit' ? 'badge-red' : 'badge-yellow';
            return `<tr>
              <td><span class="badge ${typeColor}">${escapeHtml(e.entry_type)}${e.half_day ? ' (½)' : ''}</span></td>
              <td>${e.start_date}</td>
              <td>${e.end_date}</td>
              <td>${String(wd).replace('.', ',')}</td>
              <td>${escapeHtml(e.notes || '')}</td>
              <td>
                <button class="btn btn-sm btn-secondary" onclick="openVacationForm(${e.id})">Bearbeiten</button>
                <button class="btn btn-sm btn-danger" onclick="deleteVacation(${e.id})">Löschen</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

function vacChangeYear(offset) {
  const currentYear = new Date().getFullYear();
  const newYear = vacCurrentYear + offset;
  if (newYear < currentYear - 5 || newYear > currentYear + 2) return;
  vacCurrentYear = newYear;
  renderVacation();
}

function vacSelectStaff(val) {
  vacSelectedStaff = val;
  renderVacation();
}

let vacDragStartDate = null;
let vacDragEndDate = null;
let vacDragging = false;

function vacDragStart(dateStr, e) {
  if (e.button !== 0) return;
  e.preventDefault();
  vacDragging = true;
  vacDragStartDate = dateStr;
  vacDragEndDate = dateStr;
  vacHighlightRange(dateStr, dateStr);
}

function vacDragOver(dateStr) {
  if (!vacDragging) return;
  vacDragEndDate = dateStr;
  vacHighlightRange(vacDragStartDate, vacDragEndDate);
}

async function vacDragEnd() {
  if (!vacDragging) return;
  vacDragging = false;
  const start = vacDragStartDate <= vacDragEndDate ? vacDragStartDate : vacDragEndDate;
  const end = vacDragStartDate <= vacDragEndDate ? vacDragEndDate : vacDragStartDate;
  vacClearHighlight();

  // Check if there's an existing entry overlapping this range
  try {
    const entries = await api(`/api/vacation?year=${vacCurrentYear}`);
    const staffFilter = vacSelectedStaff !== 'alle' ? Number(vacSelectedStaff) : null;
    const match = entries.find(e => {
      if (staffFilter && e.staff_id !== staffFilter) return false;
      return e.start_date <= end && e.end_date >= start;
    });
    if (match) {
      openVacationForm(match.id, start, end);
      return;
    }
  } catch (e) {}

  openVacationForm(null, start, end);
}

function vacHighlightRange(from, to) {
  const start = from <= to ? from : to;
  const end = from <= to ? to : from;
  document.querySelectorAll('.vac-calendar td[data-date]').forEach(td => {
    const d = td.dataset.date;
    if (d >= start && d <= end) {
      td.classList.add('vac-selecting');
    } else {
      td.classList.remove('vac-selecting');
    }
  });
}

async function vacCyclePayment(e, entryId, currentStatus) {
  e.preventDefault();
  const newStatus = (currentStatus + 1) % 3;
  try {
    await api(`/api/vacation/${entryId}/payment`, { method: 'PUT', body: { payment_status: newStatus } });
    renderVacation();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function vacClearHighlight() {
  document.querySelectorAll('.vac-selecting').forEach(td => td.classList.remove('vac-selecting'));
}

async function openVacationForm(editId, presetStart, presetEnd) {
  const staffList = await api('/api/staff');
  let entry = { staff_id: vacSelectedStaff !== 'alle' ? Number(vacSelectedStaff) : '', entry_type: 'Urlaub', start_date: presetStart || '', end_date: presetEnd || presetStart || '', notes: '' };

  let displayStart = presetStart || '';
  let displayEnd = presetEnd || presetStart || '';

  if (editId) {
    try {
      const all = await api(`/api/vacation?year=${vacCurrentYear}`);
      const found = all.find(e => e.id === editId);
      if (found) {
        entry = found;
        // Show selected range if provided, otherwise full entry
        if (presetStart) {
          displayStart = presetStart;
          displayEnd = presetEnd || presetStart;
        } else {
          displayStart = entry.start_date;
          displayEnd = entry.end_date;
        }
      }
    } catch (e) {}
  } else {
    displayStart = presetStart || '';
    displayEnd = presetEnd || presetStart || '';
  }

  const displayType = entry.entry_type === 'Urlaub' && entry.half_day ? 'Halber Urlaubstag' : entry.entry_type;
  const title = editId ? 'Eintrag bearbeiten' : 'Abwesenheit eintragen';
  const html = `
    <form onsubmit="saveVacation(event, ${editId || 'null'})">
      <div class="form-group">
        <label>Mitarbeiter *</label>
        <select id="vac-staff" required>
          <option value="">-- Auswählen --</option>
          ${staffList.map(s => `<option value="${s.id}" ${entry.staff_id == s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Art *</label>
        <select id="vac-type" required>
          ${VACATION_ENTRY_TYPES.map(t => `<option value="${t}" ${displayType === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Von *</label>
          <input type="date" id="vac-start" value="${displayStart}" required>
        </div>
        <div class="form-group">
          <label>Bis *</label>
          <input type="date" id="vac-end" value="${displayEnd}" required>
        </div>
      </div>
      <div class="form-group">
        <label>Notizen</label>
        <textarea id="vac-notes" rows="2">${escapeHtml(entry.notes || '')}</textarea>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">${editId ? 'Speichern' : 'Eintragen'}</button>
        ${editId ? `<button type="button" class="btn btn-danger" onclick="deleteVacation(${editId})">Löschen</button>` : ''}
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Abbrechen</button>
      </div>
    </form>
  `;
  openModal(title, html);
}

async function saveVacation(e, id) {
  e.preventDefault();
  const data = {
    staff_id: document.getElementById('vac-staff').value,
    entry_type: document.getElementById('vac-type').value === 'Halber Urlaubstag' ? 'Urlaub' : document.getElementById('vac-type').value,
    start_date: document.getElementById('vac-start').value,
    end_date: document.getElementById('vac-end').value,
    half_day: document.getElementById('vac-type').value === 'Halber Urlaubstag' ? 1 : 0,
    notes: document.getElementById('vac-notes').value.trim(),
  };
  if (!data.staff_id || !data.start_date || !data.end_date) {
    showToast('Bitte alle Pflichtfelder ausfüllen', 'error');
    return;
  }
  if (data.start_date > data.end_date) {
    showToast('Enddatum muss nach Startdatum liegen', 'error');
    return;
  }
  try {
    if (id) {
      await api(`/api/vacation/${id}`, { method: 'PUT', body: { ...data, status: 'Genehmigt' } });
      showToast('Eintrag aktualisiert');
    } else {
      // Check if there's already a pending request for this staff in this range
      const existing = await api('/api/vacation');
      const duplicate = existing.find(ex =>
        ex.staff_id === Number(data.staff_id) &&
        ex.start_date <= data.end_date &&
        ex.end_date >= data.start_date &&
        ex.status === 'Beantragt'
      );
      if (duplicate) {
        showToast('Es existiert bereits ein offener Antrag für diesen Zeitraum. Bitte über Urlaubsanträge genehmigen.', 'error');
        return;
      }
      await api('/api/vacation', { method: 'POST', body: { ...data, status: 'Genehmigt' } });
      showToast('Eintrag erstellt');

      // Ask about bonus vacation day for Weiterbildung
      if (data.entry_type === 'Weiterbildung') {
        const days = getVacationDaysInRange(data.start_date, data.end_date, getNRWHolidays(new Date(data.start_date + 'T12:00:00').getFullYear()));
        const wdCount = countWorkdays(days, getNRWHolidays(new Date(data.start_date + 'T12:00:00').getFullYear()));
        if (wdCount > 0) {
          closeModal();
          await askWeiterbildungBonus(Number(data.staff_id), new Date(data.start_date + 'T12:00:00').getFullYear(), wdCount);
          return;
        }
      }
    }
    closeModal();
    renderVacation();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function askWeiterbildungBonus(staffId, year, dayCount) {
  return new Promise(resolve => {
    const existing = document.getElementById('wb-bonus-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'wb-bonus-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:12px;padding:28px 32px;max-width:400px;width:90%;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,0.25);">
        <h3 style="margin:0 0 12px;font-size:17px;">Zusätzlicher Urlaubstag?</h3>
        <p style="margin:0 0 20px;color:#555;font-size:14px;line-height:1.5;">
          Soll der Mitarbeiter für ${dayCount === 1 ? 'diesen Weiterbildungstag' : 'diese ' + dayCount + ' Weiterbildungstage'} zusätzliche${dayCount === 1 ? 'n' : ''} Urlaubstag${dayCount === 1 ? '' : 'e'} erhalten?
        </p>
        <div style="display:flex;gap:10px;justify-content:center;">
          <button class="btn btn-secondary" id="wb-bonus-no">Nein</button>
          <button class="btn btn-primary" id="wb-bonus-yes">Ja, +${dayCount} Tag${dayCount === 1 ? '' : 'e'}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('wb-bonus-yes').onclick = async () => {
      try {
        await api(`/api/staff/${staffId}/vacation-days/bonus`, { method: 'POST', body: { year, delta: dayCount } });
        showToast(`+${dayCount} Urlaubstag${dayCount === 1 ? '' : 'e'} für Weiterbildung gutgeschrieben`);
      } catch (err) { showToast(err.message, 'error'); }
      overlay.remove();
      renderVacation();
      resolve();
    };
    document.getElementById('wb-bonus-no').onclick = () => {
      overlay.remove();
      renderVacation();
      resolve();
    };
  });
}

function askWeiterbildungBonusRemove(staffId, year, dayCount) {
  return new Promise(resolve => {
    const existing = document.getElementById('wb-bonus-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'wb-bonus-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:12px;padding:28px 32px;max-width:400px;width:90%;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,0.25);">
        <h3 style="margin:0 0 12px;font-size:17px;">Bonus-Urlaubstag entfernen?</h3>
        <p style="margin:0 0 20px;color:#555;font-size:14px;line-height:1.5;">
          Soll${dayCount === 1 ? '' : 'en'} der zusätzliche${dayCount === 1 ? '' : 'n'} ${dayCount} Urlaubstag${dayCount === 1 ? '' : 'e'} für Weiterbildung wieder abgezogen werden?
        </p>
        <div style="display:flex;gap:10px;justify-content:center;">
          <button class="btn btn-secondary" id="wb-remove-no">Nein, behalten</button>
          <button class="btn btn-danger" id="wb-remove-yes">Ja, -${dayCount} Tag${dayCount === 1 ? '' : 'e'}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('wb-remove-yes').onclick = async () => {
      try {
        await api(`/api/staff/${staffId}/vacation-days/bonus`, { method: 'POST', body: { year, delta: -dayCount } });
        showToast(`${dayCount} Bonus-Urlaubstag${dayCount === 1 ? '' : 'e'} entfernt`);
      } catch (err) { showToast(err.message, 'error'); }
      overlay.remove();
      renderVacation();
      resolve();
    };
    document.getElementById('wb-remove-no').onclick = () => {
      overlay.remove();
      renderVacation();
      resolve();
    };
  });
}

async function deleteVacation(id) {
  try {
    // Check if it's a Weiterbildung entry before deleting
    const allEntries = await api(`/api/vacation?year=${vacCurrentYear}`);
    const entry = allEntries.find(e => e.id === id);

    closeModal();
    await api(`/api/vacation/${id}`, { method: 'DELETE' });
    showToast('Eintrag gelöscht');

    // If Weiterbildung was deleted, ask about removing bonus day
    if (entry && entry.entry_type === 'Weiterbildung') {
      const holidays = getNRWHolidays(new Date(entry.start_date + 'T12:00:00').getFullYear());
      const days = getVacationDaysInRange(entry.start_date, entry.end_date, holidays);
      const wdCount = entry.half_day ? 0.5 : countWorkdays(days, holidays);
      if (wdCount > 0) {
        await askWeiterbildungBonusRemove(entry.staff_id, new Date(entry.start_date + 'T12:00:00').getFullYear(), wdCount);
        return;
      }
    }

    renderVacation();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ===== PAGE: Urlaubsanträge =====
const VAC_REQUEST_STATUS = ['Beantragt', 'Genehmigt', 'Abgelehnt'];

function getVacReqFilters() {
  return {
    staff_id: document.getElementById('vacreq-filter-staff')?.value || '',
    date_from: document.getElementById('vacreq-filter-from')?.value || '',
    date_to: document.getElementById('vacreq-filter-to')?.value || '',
    status: document.getElementById('vacreq-filter-status')?.value || '',
  };
}

async function renderVacationRequests(filters) {
  const main = document.getElementById('main-content');
  if (!filters) {
    const currentYear = new Date().getFullYear();
    filters = { staff_id: '', date_from: `${currentYear}-01-01`, date_to: `${currentYear}-12-31`, status: '' };
  }
  try {
    const [entries, staffList] = await Promise.all([
      api('/api/vacation'),
      api('/api/staff')
    ]);

    const admin = isAdmin();
    let requests = entries;
    if (!admin) {
      requests = entries.filter(e => e.staff_id === loggedInUser.id);
    }

    // Apply filters
    if (filters.staff_id) {
      requests = requests.filter(e => e.staff_id === Number(filters.staff_id));
    }
    if (filters.date_from) {
      requests = requests.filter(e => e.end_date >= filters.date_from);
    }
    if (filters.date_to) {
      requests = requests.filter(e => e.start_date <= filters.date_to);
    }
    if (filters.status) {
      requests = requests.filter(e => e.status === filters.status);
    }

    // Sort: Beantragt first, then by date
    const statusOrder = { 'Beantragt': 0, 'Genehmigt': 1, 'Abgelehnt': 2 };
    requests.sort((a, b) => (statusOrder[a.status] || 0) - (statusOrder[b.status] || 0) || a.start_date.localeCompare(b.start_date));

    const holidays = getNRWHolidays(new Date().getFullYear());

    let tableHtml = '';
    if (requests.length > 0) {
      tableHtml = `<table class="data-table">
        <thead><tr>
          <th>Mitarbeiter</th><th>Typ</th><th>Von</th><th>Bis</th><th>Tage</th><th>Notizen</th><th>Status</th>${admin ? '<th>Aktionen</th>' : ''}
        </tr></thead>
        <tbody>
        ${requests.map(e => {
          const days = getVacationDaysInRange(e.start_date, e.end_date, holidays);
          const wd = e.entry_type === 'Weiterbildung' ? days.length : countWorkdays(days, holidays);
          const statusColor = e.status === 'Beantragt' ? 'badge-yellow' : e.status === 'Genehmigt' ? 'badge-green' : 'badge-red';
          return `<tr>
            <td><strong>${escapeHtml(e.staff_name)}</strong></td>
            <td>${escapeHtml(e.entry_type)}</td>
            <td>${e.start_date}</td>
            <td>${e.end_date}</td>
            <td>${wd}</td>
            <td>${escapeHtml(e.notes || '')}</td>
            <td><span class="badge ${statusColor}">${escapeHtml(e.status)}</span></td>
            ${admin ? `<td style="white-space:nowrap;">
              ${e.status === 'Beantragt' ? `
                <button class="btn btn-sm btn-success" onclick="updateVacRequestStatus(${e.id}, 'Genehmigt')">Genehmigen</button>
                <button class="btn btn-sm btn-danger" onclick="updateVacRequestStatus(${e.id}, 'Abgelehnt')">Ablehnen</button>
              ` : ''}
              ${e.status === 'Abgelehnt' ? `
                <button class="btn btn-sm btn-success" onclick="updateVacRequestStatus(${e.id}, 'Genehmigt')">Genehmigen</button>
              ` : ''}
              ${e.status === 'Genehmigt' ? `
                <button class="btn btn-sm btn-danger" onclick="updateVacRequestStatus(${e.id}, 'Abgelehnt')">Widerrufen</button>
              ` : ''}
              <button class="btn btn-sm btn-danger" onclick="deleteVacRequest(${e.id})">Löschen</button>
            </td>` : ''}
          </tr>`;
        }).join('')}
        </tbody></table>`;
    } else {
      tableHtml = '<p style="color:var(--text-muted);padding:20px 0;">Keine Anträge vorhanden.</p>';
    }

    main.innerHTML = `
      <div class="page-header">
        <h2>An-/Abwesenheitsplaner</h2>
        <button class="btn btn-primary" onclick="openVacRequestForm()">Urlaubsantrag stellen</button>
      </div>
      ${getVacSubNav('requests')}
      <div class="card" style="margin-bottom:16px;">
        <div style="padding:12px 16px;display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">
          ${admin ? `<div class="form-group" style="margin:0;">
            <label style="font-size:12px;">Mitarbeiter</label>
            <select id="vacreq-filter-staff" onchange="renderVacationRequests(getVacReqFilters())" style="padding:5px 8px;">
              <option value="">Alle</option>
              ${staffList.map(s => `<option value="${s.id}" ${filters.staff_id == s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
            </select>
          </div>` : ''}
          <div class="form-group" style="margin:0;">
            <label style="font-size:12px;">Von</label>
            <input type="date" id="vacreq-filter-from" value="${filters.date_from}" onchange="renderVacationRequests(getVacReqFilters())" style="padding:5px 8px;">
          </div>
          <div class="form-group" style="margin:0;">
            <label style="font-size:12px;">Bis</label>
            <input type="date" id="vacreq-filter-to" value="${filters.date_to}" onchange="renderVacationRequests(getVacReqFilters())" style="padding:5px 8px;">
          </div>
          <div class="form-group" style="margin:0;">
            <label style="font-size:12px;">Status</label>
            <select id="vacreq-filter-status" onchange="renderVacationRequests(getVacReqFilters())" style="padding:5px 8px;">
              <option value="">Alle</option>
              ${VAC_REQUEST_STATUS.map(s => `<option value="${s}" ${filters.status === s ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><h3>Urlaubsanträge (${requests.length})</h3></div>
        ${tableHtml}
      </div>
    `;
  } catch (err) {
    main.innerHTML = `<p class="error">Fehler: ${escapeHtml(err.message)}</p>`;
  }
}

async function openVacRequestForm() {
  const staffList = await api('/api/staff');
  const admin = isAdmin() || isVerwaltung();
  const staffId = admin ? '' : loggedInUser.id;

  const html = `
    <form onsubmit="saveVacRequest(event)">
      ${admin ? `
      <div class="form-group">
        <label>Mitarbeiter *</label>
        <select id="vacreq-staff" required>
          <option value="">-- Auswählen --</option>
          ${staffList.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('')}
        </select>
      </div>` : `<input type="hidden" id="vacreq-staff" value="${staffId}">`}
      <div class="form-group">
        <label>Art *</label>
        <select id="vacreq-type" required>
          ${VACATION_ENTRY_TYPES.filter(t => t !== 'Krankheit' && t !== 'Weiterbildung').map(t => `<option value="${t}">${t}</option>`).join('')}
        </select>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Von *</label>
          <input type="date" id="vacreq-start" required>
        </div>
        <div class="form-group">
          <label>Bis *</label>
          <input type="date" id="vacreq-end" required>
        </div>
      </div>
      <div class="form-group">
        <label>Notizen</label>
        <textarea id="vacreq-notes" rows="2"></textarea>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">Antrag einreichen</button>
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Abbrechen</button>
      </div>
    </form>
  `;
  openModal('Urlaubsantrag stellen', html);
}

async function saveVacRequest(e) {
  e.preventDefault();
  const data = {
    staff_id: document.getElementById('vacreq-staff').value,
    entry_type: document.getElementById('vacreq-type').value,
    start_date: document.getElementById('vacreq-start').value,
    end_date: document.getElementById('vacreq-end').value,
    notes: document.getElementById('vacreq-notes').value.trim(),
    status: 'Beantragt',
  };
  if (!data.staff_id || !data.start_date || !data.end_date) {
    showToast('Bitte alle Pflichtfelder ausfüllen', 'error');
    return;
  }
  if (data.start_date > data.end_date) {
    showToast('Enddatum muss nach Startdatum liegen', 'error');
    return;
  }
  try {
    const result = await api('/api/vacation', { method: 'POST', body: data });
    showToast('Antrag eingereicht');
    if (result.emailSent) showToast('Admins/Verwaltung per E-Mail benachrichtigt', 'success');
    else if (result.emailSkipReason) showToast('E-Mail nicht gesendet: ' + result.emailSkipReason, 'warning');
    closeModal();
    renderVacationRequests();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function updateVacRequestStatus(id, newStatus) {
  try {
    const entries = await api('/api/vacation');
    const entry = entries.find(e => e.id === id);
    if (!entry) return;
    const result = await api(`/api/vacation/${id}`, { method: 'PUT', body: { ...entry, status: newStatus } });
    showToast(`Antrag ${newStatus === 'Genehmigt' ? 'genehmigt' : newStatus === 'Abgelehnt' ? 'abgelehnt' : 'aktualisiert'}`);
    if (result.emailSent) showToast('Mitarbeiter per E-Mail benachrichtigt', 'success');
    else if (result.emailSkipReason) showToast('E-Mail nicht gesendet: ' + result.emailSkipReason, 'warning');
    renderVacationRequests();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteVacRequest(id) {
  try {
    await api(`/api/vacation/${id}`, { method: 'DELETE' });
    showToast('Antrag gelöscht');
    renderVacationRequests();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ===== PAGE: Settings =====

// ===== TESTSEITE: S3 File Browser =====

let _s3CurrentPath = '';
let _s3SelectedFiles = new Set();

function s3FileIcon(ext) {
  const i = {
    // PDF — Acrobat-Stil: rotes Dokument mit weißem PDF
    pdf: '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 1h10l5 5v14a1 1 0 01-1 1H3a1 1 0 01-1-1V2a1 1 0 011-1z" fill="#fff" stroke="#ccc" stroke-width=".7"/><path d="M13 1v5h5" fill="#e8e8e8" stroke="#ccc" stroke-width=".7"/><rect x="3" y="11" width="15" height="8" rx="1" fill="#e2574c"/><text x="10.5" y="17.5" text-anchor="middle" font-size="5.5" font-weight="700" fill="#fff" font-family="Arial">PDF</text></svg>',
    // Word — blaues W
    doc: '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 1h10l5 5v14a1 1 0 01-1 1H3a1 1 0 01-1-1V2a1 1 0 011-1z" fill="#fff" stroke="#ccc" stroke-width=".7"/><path d="M13 1v5h5" fill="#e8e8e8" stroke="#ccc" stroke-width=".7"/><rect x="3" y="11" width="15" height="8" rx="1" fill="#2b579a"/><text x="10.5" y="17.5" text-anchor="middle" font-size="6" font-weight="700" fill="#fff" font-family="Arial">W</text></svg>',
    // Excel — grünes X
    xls: '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 1h10l5 5v14a1 1 0 01-1 1H3a1 1 0 01-1-1V2a1 1 0 011-1z" fill="#fff" stroke="#ccc" stroke-width=".7"/><path d="M13 1v5h5" fill="#e8e8e8" stroke="#ccc" stroke-width=".7"/><rect x="3" y="11" width="15" height="8" rx="1" fill="#217346"/><text x="10.5" y="17.5" text-anchor="middle" font-size="6" font-weight="700" fill="#fff" font-family="Arial">X</text></svg>',
    // PowerPoint — oranges P
    ppt: '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 1h10l5 5v14a1 1 0 01-1 1H3a1 1 0 01-1-1V2a1 1 0 011-1z" fill="#fff" stroke="#ccc" stroke-width=".7"/><path d="M13 1v5h5" fill="#e8e8e8" stroke="#ccc" stroke-width=".7"/><rect x="3" y="11" width="15" height="8" rx="1" fill="#d24726"/><text x="10.5" y="17.5" text-anchor="middle" font-size="6" font-weight="700" fill="#fff" font-family="Arial">P</text></svg>',
    // Bild — weißes Blatt mit Berglandschaft
    img: '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 1h10l5 5v14a1 1 0 01-1 1H3a1 1 0 01-1-1V2a1 1 0 011-1z" fill="#fff" stroke="#ccc" stroke-width=".7"/><path d="M13 1v5h5" fill="#e8e8e8" stroke="#ccc" stroke-width=".7"/><circle cx="8" cy="9" r="2" fill="#f4c542"/><path d="M3 17l4-5 3 3 3-4 5 6H3z" fill="#4a90d9" opacity=".6"/></svg>',
    // Video — Filmklappe
    vid: '<svg width="22" height="22" viewBox="0 0 22 22"><rect x="2" y="4" width="18" height="14" rx="2" fill="#fff" stroke="#8e44ad" stroke-width="1.2"/><rect x="2" y="4" width="18" height="3" fill="#8e44ad"/><path d="M5 4l2 3M9 4l2 3M13 4l2 3M17 4l2 3" stroke="#fff" stroke-width=".8"/><path d="M9 11v4l4-2z" fill="#8e44ad"/></svg>',
    // Audio — Musiknote
    aud: '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 1h10l5 5v14a1 1 0 01-1 1H3a1 1 0 01-1-1V2a1 1 0 011-1z" fill="#fff" stroke="#ccc" stroke-width=".7"/><path d="M13 1v5h5" fill="#e8e8e8" stroke="#ccc" stroke-width=".7"/><path d="M9 15V7l6-2v8" fill="none" stroke="#e67e22" stroke-width="1.3"/><circle cx="7.5" cy="15" r="1.8" fill="#e67e22"/><circle cx="13.5" cy="13" r="1.8" fill="#e67e22"/></svg>',
    // Zip — Ordner mit Reißverschluss
    zip: '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M2 7V4.5A1.5 1.5 0 013.5 3H8l2 2h8.5A1.5 1.5 0 0120 6.5V18a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 012 18V7z" fill="#f4c542" stroke="#c9a20a" stroke-width=".7"/><rect x="10" y="6" width="2" height="2" fill="#c9a20a" opacity=".5"/><rect x="10" y="10" width="2" height="2" fill="#c9a20a" opacity=".5"/><rect x="10" y="14" width="2" height="2" fill="#c9a20a" opacity=".5"/></svg>',
    // Text — weißes Blatt mit Zeilen
    txt: '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 1h10l5 5v14a1 1 0 01-1 1H3a1 1 0 01-1-1V2a1 1 0 011-1z" fill="#fff" stroke="#ccc" stroke-width=".7"/><path d="M13 1v5h5" fill="#e8e8e8" stroke="#ccc" stroke-width=".7"/><line x1="5" y1="10" x2="16" y2="10" stroke="#bbb" stroke-width=".8"/><line x1="5" y1="12.5" x2="14" y2="12.5" stroke="#bbb" stroke-width=".8"/><line x1="5" y1="15" x2="16" y2="15" stroke="#bbb" stroke-width=".8"/><line x1="5" y1="17.5" x2="11" y2="17.5" stroke="#bbb" stroke-width=".8"/></svg>',
    // Code — weißes Blatt mit <>
    code: '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 1h10l5 5v14a1 1 0 01-1 1H3a1 1 0 01-1-1V2a1 1 0 011-1z" fill="#fff" stroke="#ccc" stroke-width=".7"/><path d="M13 1v5h5" fill="#e8e8e8" stroke="#ccc" stroke-width=".7"/><text x="10.5" y="15" text-anchor="middle" font-size="8" font-weight="700" fill="#3178c6" font-family="monospace">&lt;/&gt;</text></svg>',
    // EXE/Programm
    exe: '<svg width="22" height="22" viewBox="0 0 22 22"><rect x="3" y="3" width="16" height="16" rx="3" fill="#fff" stroke="#555" stroke-width=".7"/><rect x="5" y="5" width="12" height="8" rx="1" fill="#1a56db"/><rect x="9" y="15" width="4" height="2" rx=".5" fill="#555"/></svg>',
    // Datenbank
    db: '<svg width="22" height="22" viewBox="0 0 22 22"><ellipse cx="11" cy="5" rx="8" ry="3" fill="#fff" stroke="#7f8c8d" stroke-width="1"/><path d="M3 5v12c0 1.7 3.6 3 8 3s8-1.3 8-3V5" fill="none" stroke="#7f8c8d" stroke-width="1"/><path d="M3 11c0 1.7 3.6 3 8 3s8-1.3 8-3" fill="none" stroke="#7f8c8d" stroke-width=".8"/></svg>',
    // E-Mail
    eml: '<svg width="22" height="22" viewBox="0 0 22 22"><rect x="2" y="4" width="18" height="14" rx="2" fill="#fff" stroke="#3498db" stroke-width="1"/><path d="M2 6l9 5 9-5" fill="none" stroke="#3498db" stroke-width="1"/></svg>',
    // Unbekannt — leeres Blatt
    default: '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 1h10l5 5v14a1 1 0 01-1 1H3a1 1 0 01-1-1V2a1 1 0 011-1z" fill="#fff" stroke="#ccc" stroke-width=".7"/><path d="M13 1v5h5" fill="#e8e8e8" stroke="#ccc" stroke-width=".7"/></svg>',
  };
  // Aliase
  i.docx = i.doc; i.odt = i.doc; i.rtf = i.doc;
  i.xlsx = i.xls; i.csv = i.xls; i.ods = i.xls;
  i.pptx = i.ppt; i.odp = i.ppt;
  i.jpg = i.img; i.jpeg = i.img; i.png = i.img; i.gif = i.img; i.webp = i.img; i.svg = i.img; i.bmp = i.img; i.ico = i.img;
  i.mp4 = i.vid; i.webm = i.vid; i.mov = i.vid; i.avi = i.vid; i.mkv = i.vid;
  i.mp3 = i.aud; i.wav = i.aud; i.ogg = i.aud; i.flac = i.aud; i.aac = i.aud;
  i.rar = i.zip; i['7z'] = i.zip; i.tar = i.zip; i.gz = i.zip;
  i.log = i.txt; i.md = i.txt; i.json = i.txt; i.xml = i.txt;
  i.js = i.code; i.ts = i.code; i.py = i.code; i.html = i.code; i.css = i.code; i.php = i.code;
  i.msi = i.exe; i.dmg = i.exe;
  i.sql = i.db; i.sqlite = i.db;
  i.msg = i.eml;
  return i[ext] || i.default;
}

async function renderTestseite() {
  const main = document.getElementById('main-content');
  main.innerHTML = `
    <div class="page-header">
      <h2>Testseite — S3 Dateispeicher</h2>
      <button class="btn btn-primary" onclick="s3CreateFolder()">+ Neuer Ordner</button>
    </div>

    <div id="s3-dropzone" class="s3-dropzone">
      <div class="s3-dropzone-icon">&#128228;</div>
      <div class="s3-dropzone-text">Dateien hierher ziehen</div>
      <div class="s3-dropzone-sub">oder <a href="#" onclick="event.preventDefault();document.getElementById('s3-file-input').click()">Dateien auswählen</a></div>
      <input type="file" id="s3-file-input" multiple style="display:none;" onchange="s3UploadFiles(this.files)">
    </div>

    <div id="s3-upload-progress" style="display:none;margin-top:12px;">
      <div class="card" style="padding:12px 16px;">
        <div id="s3-upload-status" style="font-size:13px;color:var(--text-muted);"></div>
        <div id="s3-upload-bar" style="margin-top:8px;height:4px;background:var(--border);border-radius:4px;overflow:hidden;">
          <div id="s3-upload-bar-fill" style="height:100%;width:0%;background:var(--primary);border-radius:4px;transition:width 0.3s;"></div>
        </div>
      </div>
    </div>

    <div class="card" style="padding:0;margin-top:12px;">
      <div id="s3-breadcrumb" style="padding:12px 16px;border-bottom:1px solid var(--border);background:var(--bg);display:flex;align-items:center;gap:4px;font-size:13px;flex-wrap:wrap;"></div>
      <div id="s3-selection-bar" style="display:none;padding:8px 16px;background:#eef2ff;border-bottom:1px solid var(--border);display:none;align-items:center;gap:10px;font-size:13px;"></div>
      <div id="s3-file-list" style="min-height:200px;" onclick="if(event.target===this){s3DeselectAll();}"></div>
    </div>
  `;

  // Drag & Drop
  const dropzone = document.getElementById('s3-dropzone');
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('s3-dropzone-active'); });
  dropzone.addEventListener('dragleave', () => { dropzone.classList.remove('s3-dropzone-active'); });
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('s3-dropzone-active');
    if (e.dataTransfer.files.length > 0) s3UploadFiles(e.dataTransfer.files);
  });

  await s3LoadFolder(_s3CurrentPath);
}

async function s3LoadFolder(folder) {
  _s3CurrentPath = folder;
  _s3SelectedFiles.clear();
  const listEl = document.getElementById('s3-file-list');
  const breadcrumbEl = document.getElementById('s3-breadcrumb');
  if (!listEl) return;

  listEl.innerHTML = '<div style="padding:20px;color:var(--text-muted);text-align:center;">Laden...</div>';
  const selBar = document.getElementById('s3-selection-bar');
  if (selBar) selBar.style.display = 'none';

  // Breadcrumb
  const parts = folder ? folder.split('/').filter(Boolean) : [];
  let breadcrumbHtml = '<a href="#" onclick="s3LoadFolder(\'\');return false;" style="color:var(--primary);text-decoration:none;font-weight:600;">S3 Root</a>';
  let cumPath = '';
  parts.forEach((p, i) => {
    cumPath += (cumPath ? '/' : '') + p;
    const isLast = i === parts.length - 1;
    breadcrumbHtml += ' <span style="color:var(--text-muted);">/</span> ';
    if (isLast) {
      breadcrumbHtml += '<span style="font-weight:600;">' + escapeHtml(p) + '</span>';
    } else {
      const pathCopy = cumPath;
      breadcrumbHtml += '<a href="#" onclick="s3LoadFolder(\'' + escapeHtml(pathCopy) + '\');return false;" style="color:var(--primary);text-decoration:none;">' + escapeHtml(p) + '</a>';
    }
  });
  breadcrumbEl.innerHTML = breadcrumbHtml;

  try {
    const result = await api('/api/files/list?folder=' + encodeURIComponent(folder));
    let html = '';

    // Back button
    if (folder) {
      const parentParts = parts.slice(0, -1);
      const parent = parentParts.join('/');
      html += '<div class="s3-row s3-folder-row" onclick="s3LoadFolder(\'' + escapeHtml(parent) + '\')">';
      html += '<span class="s3-icon"><svg width="20" height="20" viewBox="0 0 20 20"><path d="M2 6V4a2 2 0 012-2h4l2 2h6a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" fill="#f39c12" opacity="0.3" stroke="#f39c12" stroke-width="1.5"/><path d="M6 10l4-4 4 4" fill="none" stroke="#f39c12" stroke-width="1.5" stroke-linecap="round"/></svg></span>';
      html += '<span class="s3-name">..</span>';
      html += '<span class="s3-size"></span>';
      html += '<span class="s3-date"></span>';
      html += '</div>';
    }

    // Folders
    result.folders.forEach(f => {
      const fullPath = folder ? folder + '/' + f : f;
      html += '<div class="s3-row s3-folder-row" onclick="s3LoadFolder(\'' + escapeHtml(fullPath) + '\')" oncontextmenu="event.preventDefault();s3FolderContextMenu(event,\'' + escapeHtml(fullPath) + '\')">';
      html += '<span class="s3-icon"><svg width="20" height="20" viewBox="0 0 20 20"><path d="M2 6V4a2 2 0 012-2h4l2 2h6a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" fill="#f39c12" opacity="0.3" stroke="#f39c12" stroke-width="1.5"/></svg></span>';
      html += '<span class="s3-name" style="font-weight:600;">' + escapeHtml(f) + '</span>';
      html += '<span class="s3-size">—</span>';
      html += '<span class="s3-date">—</span>';
      html += '</div>';
    });

    // Files
    result.files.forEach(f => {
      if (f.name === '') return; // skip folder placeholder
      const sizeStr = f.size < 1024 ? f.size + ' B' : f.size < 1048576 ? (f.size / 1024).toFixed(1) + ' KB' : (f.size / 1048576).toFixed(1) + ' MB';
      const dateStr = f.modified ? new Date(f.modified).toLocaleString('de-DE') : '—';
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      const icon = s3FileIcon(ext);

      const fKey = escapeHtml(f.key);
      const fName = escapeHtml(f.name);
      html += '<div class="s3-row s3-file-row" data-key="' + fKey + '" data-name="' + fName + '" onclick="s3FileClick(event,\'' + fKey + '\',\'' + fName + '\')" oncontextmenu="event.preventDefault();s3ContextMenu(event,\'' + fKey + '\',\'' + fName + '\')">';
      html += '<span class="s3-icon">' + icon + '</span>';
      html += '<span class="s3-name">' + fName + '</span>';
      html += '<span class="s3-size">' + sizeStr + '</span>';
      html += '<span class="s3-date">' + dateStr + '</span>';
      html += '</div>';
    });

    if (result.folders.length === 0 && result.files.length === 0 && !folder) {
      html += '<div style="padding:40px;text-align:center;color:var(--text-muted);">Speicher ist leer. Erstelle einen Ordner oder lade Dateien hoch.</div>';
    } else if (result.folders.length === 0 && result.files.filter(f => f.name).length === 0 && folder) {
      html += '<div style="padding:40px;text-align:center;color:var(--text-muted);">Ordner ist leer.</div>';
    }

    listEl.innerHTML = html;
  } catch (err) {
    listEl.innerHTML = '<div style="padding:20px;color:var(--danger);text-align:center;">Fehler: ' + escapeHtml(err.message) + '</div>';
  }
}

async function s3UploadFiles(fileList) {
  if (!fileList || fileList.length === 0) return;
  const progressEl = document.getElementById('s3-upload-progress');
  const statusEl = document.getElementById('s3-upload-status');
  const barFill = document.getElementById('s3-upload-bar-fill');
  progressEl.style.display = '';
  barFill.style.width = '0%';

  for (let i = 0; i < fileList.length; i++) {
    const file = fileList[i];
    const pct = Math.round(((i) / fileList.length) * 100);
    barFill.style.width = pct + '%';
    statusEl.textContent = 'Lade hoch: ' + file.name + ' (' + (i + 1) + '/' + fileList.length + ')...';
    try {
      const base64 = await fileToBase64(file);
      await api('/api/files/upload', {
        method: 'POST',
        body: {
          folder: _s3CurrentPath,
          filename: file.name,
          data: base64,
          content_type: file.type || 'application/octet-stream'
        }
      });
    } catch (err) {
      showToast('Fehler bei ' + file.name + ': ' + err.message, 'error');
    }
  }

  barFill.style.width = '100%';
  statusEl.textContent = fileList.length + ' Datei(en) hochgeladen.';
  setTimeout(() => { progressEl.style.display = 'none'; }, 2000);
  const fileInput = document.getElementById('s3-file-input');
  if (fileInput) fileInput.value = '';
  await s3LoadFolder(_s3CurrentPath);
  showToast(fileList.length + ' Datei(en) hochgeladen');
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

let _s3LastClickedKey = null;

function s3FileClick(e, key, filename) {
  if (e.detail === 2) {
    // Doppelklick = Vorschau öffnen
    s3Preview(key, filename);
    return;
  }

  if (e.ctrlKey || e.metaKey) {
    // Ctrl+Klick = einzeln dazu/weg
    if (_s3SelectedFiles.has(key)) _s3SelectedFiles.delete(key);
    else _s3SelectedFiles.add(key);
  } else if (e.shiftKey && _s3LastClickedKey) {
    // Shift+Klick = Bereich selektieren
    const rows = Array.from(document.querySelectorAll('.s3-file-row[data-key]'));
    const keys = rows.map(r => r.dataset.key);
    const startIdx = keys.indexOf(_s3LastClickedKey);
    const endIdx = keys.indexOf(key);
    if (startIdx !== -1 && endIdx !== -1) {
      const from = Math.min(startIdx, endIdx);
      const to = Math.max(startIdx, endIdx);
      for (let i = from; i <= to; i++) _s3SelectedFiles.add(keys[i]);
    }
  } else {
    // Normaler Klick = nur diese Datei selektieren
    _s3SelectedFiles.clear();
    _s3SelectedFiles.add(key);
  }

  _s3LastClickedKey = key;
  s3UpdateSelection();
}

function s3SelectAll() {
  const rows = document.querySelectorAll('.s3-file-row[data-key]');
  rows.forEach(r => _s3SelectedFiles.add(r.dataset.key));
  s3UpdateSelection();
}

function s3DeselectAll() {
  _s3SelectedFiles.clear();
  s3UpdateSelection();
}

function s3UpdateSelection() {
  document.querySelectorAll('.s3-file-row[data-key]').forEach(row => {
    row.classList.toggle('s3-selected', _s3SelectedFiles.has(row.dataset.key));
  });
  // Update action bar
  const bar = document.getElementById('s3-selection-bar');
  if (!bar) return;
  if (_s3SelectedFiles.size > 0) {
    bar.style.display = '';
    bar.innerHTML = '<span style="font-weight:600;">' + _s3SelectedFiles.size + ' ausgewählt</span>'
      + ' <button class="btn btn-sm btn-secondary" onclick="s3DownloadSelected()">Download</button>'
      + ' <button class="btn btn-sm btn-danger" onclick="s3DeleteSelected()">Löschen</button>'
      + ' <button class="btn btn-sm" style="color:var(--text-muted);" onclick="s3DeselectAll()">Auswahl aufheben</button>';
  } else {
    bar.style.display = 'none';
  }
}

async function s3DownloadSelected() {
  for (const key of _s3SelectedFiles) {
    const name = key.split('/').pop();
    await s3Download(key, name);
  }
}

async function s3DeleteSelected() {
  for (const key of _s3SelectedFiles) {
    try { await api('/api/files/' + key, { method: 'DELETE' }); } catch(e) {}
  }
  _s3SelectedFiles.clear();
  showToast('Dateien gelöscht');
  await s3LoadFolder(_s3CurrentPath);
}

function s3FolderContextMenu(e, folderPath) {
  const old = document.getElementById('s3-ctx-menu');
  if (old) old.remove();
  const menu = document.createElement('div');
  menu.id = 's3-ctx-menu';
  menu.className = 's3-context-menu';
  menu.innerHTML = '<div class="s3-ctx-item s3-ctx-danger" onclick="s3DeleteFolder(\'' + escapeHtml(folderPath) + '\');s3CloseCtx();"><span style="width:20px;text-align:center;">&#10006;</span> Ordner löschen</div>';
  menu.style.left = e.pageX + 'px';
  menu.style.top = e.pageY + 'px';
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = (e.pageX - rect.width) + 'px';
  if (rect.bottom > window.innerHeight) menu.style.top = (e.pageY - rect.height) + 'px';
  setTimeout(() => document.addEventListener('click', s3CloseCtx, { once: true }), 0);
}

function s3ContextMenu(e, key, filename) {
  // Rechtsklick selektiert die Datei (wie im Explorer), außer sie ist schon selektiert
  if (!_s3SelectedFiles.has(key)) {
    _s3SelectedFiles.clear();
    _s3SelectedFiles.add(key);
    s3UpdateSelection();
  }
  const old = document.getElementById('s3-ctx-menu');
  if (old) old.remove();

  const menu = document.createElement('div');
  menu.id = 's3-ctx-menu';
  menu.className = 's3-context-menu';
  menu.innerHTML = `
    <div class="s3-ctx-item" onclick="s3Download('${escapeHtml(key)}','${escapeHtml(filename)}');s3CloseCtx();">
      <span style="width:20px;text-align:center;">&#11015;</span> Download
    </div>
    <div class="s3-ctx-divider"></div>
    <div class="s3-ctx-item s3-ctx-danger" onclick="s3DeleteFile('${escapeHtml(key)}');s3CloseCtx();">
      <span style="width:20px;text-align:center;">&#10006;</span> Löschen
    </div>
  `;

  // Position
  menu.style.left = e.pageX + 'px';
  menu.style.top = e.pageY + 'px';
  document.body.appendChild(menu);

  // Rand-Korrektur
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = (e.pageX - rect.width) + 'px';
  if (rect.bottom > window.innerHeight) menu.style.top = (e.pageY - rect.height) + 'px';

  // Klick außerhalb schließt
  setTimeout(() => document.addEventListener('click', s3CloseCtx, { once: true }), 0);
}

function s3CloseCtx() {
  const m = document.getElementById('s3-ctx-menu');
  if (m) m.remove();
}

async function s3Preview(key, filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  try {
    const result = await api('/api/files/download?key=' + encodeURIComponent(key));
    const url = result.url;

    let contentHtml = '';
    if (['jpg','jpeg','png','gif','webp','svg','bmp'].includes(ext)) {
      contentHtml = '<img src="' + url + '" style="max-width:100%;max-height:75vh;border-radius:8px;">';
    } else if (ext === 'pdf') {
      contentHtml = '<iframe src="' + url + '" style="width:100%;height:75vh;border:none;border-radius:8px;"></iframe>';
    } else if (['mp4','webm','mov'].includes(ext)) {
      contentHtml = '<video controls style="max-width:100%;max-height:75vh;border-radius:8px;"><source src="' + url + '"></video>';
    } else if (['mp3','wav','ogg'].includes(ext)) {
      contentHtml = '<audio controls style="width:100%;"><source src="' + url + '"></audio>';
    } else if (['txt','log','csv','json','xml','html','css','js','md'].includes(ext)) {
      try {
        const resp = await fetch(url);
        const text = await resp.text();
        contentHtml = '<pre style="max-height:75vh;overflow:auto;padding:16px;background:var(--bg);border-radius:8px;font-size:13px;white-space:pre-wrap;word-break:break-all;">' + escapeHtml(text) + '</pre>';
      } catch(e) {
        contentHtml = '<p style="color:var(--text-muted);">Textvorschau nicht möglich.</p>';
      }
    } else {
      contentHtml = '<div style="text-align:center;padding:40px;color:var(--text-muted);"><div style="font-size:48px;margin-bottom:16px;">&#128196;</div><p>Keine Vorschau für diesen Dateityp verfügbar.</p></div>';
    }

    openModal(filename, `
      <div style="text-align:center;">${contentHtml}</div>
      <div class="form-actions" style="margin-top:16px;justify-content:center;">
        <button class="btn btn-primary" onclick="s3Download('${escapeHtml(key)}', '${escapeHtml(filename)}')">Download</button>
        <button class="btn btn-secondary" onclick="closeModal()">Schließen</button>
      </div>
    `, 'modal-preview');
  } catch (err) {
    showToast('Vorschau fehlgeschlagen: ' + err.message, 'error');
  }
}

async function s3Download(key, filename) {
  try {
    const result = await api('/api/files/download?key=' + encodeURIComponent(key));
    const a = document.createElement('a');
    a.href = result.url;
    a.download = filename;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch (err) {
    showToast('Download fehlgeschlagen: ' + err.message, 'error');
  }
}

async function s3DeleteFile(key) {
  try {
    await api('/api/files/' + key, { method: 'DELETE' });
    showToast('Datei gelöscht');
    await s3LoadFolder(_s3CurrentPath);
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
}

async function s3DeleteFolder(folderPath) {
  try {
    // List all files in folder recursively and delete them
    const result = await api('/api/files/list?folder=' + encodeURIComponent(folderPath));
    for (const f of result.files) {
      await api('/api/files/' + f.key, { method: 'DELETE' });
    }
    for (const sub of result.folders) {
      await s3DeleteFolder(folderPath + '/' + sub);
    }
    showToast('Ordner gelöscht');
    await s3LoadFolder(_s3CurrentPath);
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
}

function s3CreateFolder() {
  const name = prompt('Ordnername:');
  if (!name || !name.trim()) return;
  const cleanName = name.trim().replace(/[\/\\]/g, '');
  // Create folder by uploading a placeholder file
  const folderPath = _s3CurrentPath ? _s3CurrentPath + '/' + cleanName : cleanName;
  api('/api/files/upload', {
    method: 'POST',
    body: { folder: folderPath, filename: '.folder', data: btoa(' '), content_type: 'text/plain' }
  }).then(() => {
    showToast('Ordner "' + cleanName + '" erstellt');
    s3LoadFolder(_s3CurrentPath);
  }).catch(err => showToast('Fehler: ' + err.message, 'error'));
}

// ===== SETTINGS: FIRMENDATEN =====
async function renderSettingsCompany() {
  const main = document.getElementById('main-content');

  main.innerHTML = `
    <div class="page-header">
      <h2>Einstellungen — Firmendaten</h2>
    </div>
  `;

  // Load company settings (only for Admin)
  if (isAdmin()) {
    let company = {};
    try {
      company = await api('/api/settings/company');
    } catch (e) {}

    main.innerHTML += `
    <div class="card">
      <div class="card-header">
        <h3>Firmendaten (Briefbogen / Rechnungen)</h3>
      </div>
      <p style="color:var(--text-muted);font-size:13px;margin-bottom:16px;">
        Diese Daten erscheinen auf Rechnungen, Gutschriften und dem Briefbogen. Der Firmenname (Bemo GmbH) ist fest hinterlegt.
      </p>

      <div style="border-bottom:1px solid var(--border);margin-bottom:16px;padding-bottom:4px;">
        <p style="font-weight:600;font-size:13px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;">Adresse & Kontakt</p>
      </div>
      <div class="form-row">
        <div class="form-group" style="flex:2;">
          <label>Straße</label>
          <input type="text" id="co-street" value="${escapeHtml(company.company_street || '')}">
        </div>
        <div class="form-group" style="flex:0 0 100px;">
          <label>PLZ</label>
          <input type="text" id="co-zip" value="${escapeHtml(company.company_zip || '')}">
        </div>
        <div class="form-group" style="flex:1;">
          <label>Ort</label>
          <input type="text" id="co-city" value="${escapeHtml(company.company_city || '')}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group" style="flex:1;">
          <label>Telefon</label>
          <input type="text" id="co-phone" value="${escapeHtml(company.company_phone || '')}">
        </div>
        <div class="form-group" style="flex:1;">
          <label>E-Mail</label>
          <input type="email" id="co-email" value="${escapeHtml(company.company_email || '')}">
        </div>
      </div>

      <div style="border-bottom:1px solid var(--border);margin:20px 0 16px;padding-bottom:4px;">
        <p style="font-weight:600;font-size:13px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;">Geschäftsführung & Steuern</p>
      </div>
      <div class="form-row">
        <div class="form-group" style="flex:1;">
          <label>Geschäftsführer</label>
          <input type="text" id="co-ceo" value="${escapeHtml(company.company_ceo || '')}">
        </div>
        <div class="form-group" style="flex:1;">
          <label>Steuernummer</label>
          <input type="text" id="co-tax" value="${escapeHtml(company.company_tax_number || '')}">
        </div>
        <div class="form-group" style="flex:1;">
          <label>Handelsregister</label>
          <input type="text" id="co-hrb" placeholder="z.B. HRB 26588 AG Aachen" value="${escapeHtml(company.company_hrb || '')}">
        </div>
      </div>

      <button class="btn btn-primary" onclick="saveCompanySettings()">Firmendaten speichern</button>
    </div>
    `;

    // Bank accounts table
    let banks = [];
    try { banks = await api('/api/bank-accounts'); } catch(e) {}

    let bankHtml = '<div class="card"><div class="card-header" style="display:flex;justify-content:space-between;align-items:center;"><h3>Bankverbindungen</h3><button class="btn btn-sm btn-primary" onclick="openBankAccountModal()">+ Neue Bankverbindung</button></div>';
    bankHtml += '<p style="color:var(--text-muted);font-size:13px;margin-bottom:16px;">Bei nur einer Bankverbindung wird diese automatisch auf allen Rechnungen verwendet. Bei mehreren wird bei der Rechnungserstellung abgefragt, welche genutzt werden soll.</p>';
    if (banks.length === 0) {
      bankHtml += '<div class="empty-state"><p>Noch keine Bankverbindung hinterlegt.</p></div>';
    } else {
      bankHtml += '<table class="data-table"><thead><tr><th>Bezeichnung</th><th>IBAN</th><th>BIC</th><th>Bank</th><th>Standard</th><th>Aktionen</th></tr></thead><tbody>';
      banks.forEach(b => {
        bankHtml += '<tr>';
        bankHtml += '<td>' + escapeHtml(b.label || '—') + '</td>';
        bankHtml += '<td style="font-family:monospace;font-size:13px;">' + escapeHtml(b.iban) + '</td>';
        bankHtml += '<td>' + escapeHtml(b.bic || '—') + '</td>';
        bankHtml += '<td>' + escapeHtml(b.bank_name || '—') + '</td>';
        bankHtml += '<td>' + (b.is_default ? '<span class="badge badge-green">Standard</span>' : '') + '</td>';
        bankHtml += '<td style="white-space:nowrap;">';
        bankHtml += '<button class="btn btn-sm btn-secondary" onclick="openBankAccountModal(' + b.id + ')">Bearbeiten</button> ';
        bankHtml += '<button class="btn btn-sm btn-danger" onclick="deleteBankAccount(' + b.id + ')">Löschen</button>';
        bankHtml += '</td></tr>';
      });
      bankHtml += '</tbody></table>';
    }
    bankHtml += '</div>';
    main.innerHTML += bankHtml;
  }
}

// ===== SETTINGS: PROGRAMMDATEN =====
async function renderSettingsProgram() {
  const main = document.getElementById('main-content');

  let apiKey = '';
  try {
    const data = await api('/api/settings/openai_api_key');
    apiKey = data.value || '';
  } catch (e) {}
  const masked = apiKey || '';

  main.innerHTML = `
    <div class="page-header">
      <h2>Einstellungen — Programmdaten</h2>
    </div>

    <div class="card">
      <div class="card-header">
        <h3>OpenAI API-Key (Fahrzeugschein-Scan)</h3>
      </div>
      <p style="color:var(--text-muted);font-size:13px;margin-bottom:12px;">
        Wird für die KI-gestützte Erkennung von Fahrzeugscheinen benötigt.
        Einen API-Key erhalten Sie unter <a href="https://platform.openai.com/api-keys" target="_blank">platform.openai.com</a>.
      </p>
      ${apiKey ? `<p style="margin-bottom:8px;">Aktueller Key: <code>${escapeHtml(masked)}</code> <span class="badge badge-green">Aktiv</span></p>` : '<p style="margin-bottom:8px;"><span class="badge badge-red">Kein API-Key hinterlegt</span></p>'}
      <div class="form-row">
        <div class="form-group" style="flex:1;">
          <label>Neuer API-Key</label>
          <input type="password" id="settings-api-key" placeholder="sk-..." value="">
        </div>
      </div>
      <button class="btn btn-primary" onclick="saveApiKey()">API-Key speichern</button>
    </div>
  `;

  // Load Office 365 settings (only for Admin)
  if (isAdmin()) {
    let o365 = {};
    try {
      const keys = ['o365_tenant_id', 'o365_client_id', 'o365_client_secret', 'o365_send_mailbox', 'o365_mailboxes'];
      const results = await Promise.all(keys.map(k => api('/api/settings/' + k)));
      results.forEach(r => { o365[r.key] = r.value || ''; });
    } catch (e) {}

    const secretMasked = o365.o365_client_secret || '';

    main.innerHTML += `
    <div class="card">
      <div class="card-header">
        <h3>Office 365 E-Mail-Anbindung</h3>
      </div>
      <p style="color:var(--text-muted);font-size:13px;margin-bottom:16px;">
        Verbindung zu Microsoft Graph API für E-Mail-Versand und -Empfang über geteilte Postfächer.
        Die App muss in <a href="https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps" target="_blank">Azure AD</a> registriert sein.
      </p>

      <div class="form-row">
        <div class="form-group" style="flex:1;">
          <label>Tenant ID (Verzeichnis-ID)</label>
          <input type="text" id="settings-o365-tenant" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" value="${escapeHtml(o365.o365_tenant_id || '')}">
        </div>
        <div class="form-group" style="flex:1;">
          <label>Client ID (Anwendungs-ID)</label>
          <input type="text" id="settings-o365-client-id" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" value="${escapeHtml(o365.o365_client_id || '')}">
        </div>
      </div>

      <div class="form-row">
        <div class="form-group" style="flex:1;">
          <label>Client Secret (Geheimer Clientschlüssel)</label>
          <input type="password" id="settings-o365-client-secret" placeholder="${secretMasked ? 'Gespeichert: ' + secretMasked : 'Neuen Secret eingeben...'}">
          ${secretMasked ? '<span style="font-size:11px;color:var(--text-muted);">Leer lassen um den bestehenden Schlüssel beizubehalten</span>' : ''}
        </div>
      </div>

      <div style="border-top:1px solid var(--border);margin:16px 0;padding-top:16px;">
        <p style="font-weight:600;margin-bottom:8px;">Postfächer</p>
      </div>

      <div class="form-row">
        <div class="form-group" style="flex:1;">
          <label>Ausgangs-Postfach (Versand)</label>
          <input type="email" id="settings-o365-send-mailbox" placeholder="" value="${escapeHtml(o365.o365_send_mailbox || '')}">
          <span style="font-size:11px;color:var(--text-muted);">E-Mails werden von dieser Adresse gesendet</span>
        </div>
      </div>

      <div class="form-group">
        <label>Eingangs-Postfächer (Empfang)</label>
        <textarea id="settings-o365-mailboxes" rows="3" placeholder="">${escapeHtml(o365.o365_mailboxes || '')}</textarea>
        <span style="font-size:11px;color:var(--text-muted);">Ein Postfach pro Zeile. Diese Postfächer werden im E-Mail-Eingang angezeigt.</span>
      </div>

      <div style="display:flex;gap:10px;align-items:center;margin-top:12px;">
        <button class="btn btn-primary" onclick="saveO365Settings()">Speichern</button>
        <button class="btn btn-secondary" onclick="testO365Connection()" id="btn-o365-test">Verbindung testen</button>
        <span id="o365-test-result" style="font-size:13px;"></span>
      </div>

      <div id="o365-status-box" style="margin-top:16px;padding:14px 16px;border-radius:8px;background:var(--bg);border:1px solid var(--border);">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <span id="o365-status-dot" style="width:10px;height:10px;border-radius:50%;background:var(--border);display:inline-block;"></span>
          <strong id="o365-status-text" style="font-size:13px;">Prüfe Verbindung...</strong>
        </div>
        <div id="o365-status-details" style="font-size:12px;color:var(--text-muted);margin-left:18px;"></div>
      </div>
    </div>
    `;

    // Auto-test connection on page load if credentials exist
    if (o365.o365_tenant_id && o365.o365_client_id && o365.o365_client_secret) {
      autoTestO365();
    } else {
      const dot = document.getElementById('o365-status-dot');
      const text = document.getElementById('o365-status-text');
      const details = document.getElementById('o365-status-details');
      if (dot) dot.style.background = 'var(--warning)';
      if (text) text.textContent = 'Nicht konfiguriert';
      if (details) details.textContent = 'Bitte Tenant ID, Client ID und Client Secret eingeben.';
    }
  }

  // S3 Storage settings (Admin only)
  if (isAdmin()) {
    let s3Settings = {};
    try {
      const keys = ['s3_endpoint', 's3_bucket', 's3_access_key', 's3_secret_key', 's3_region'];
      const results = await Promise.all(keys.map(k => api('/api/settings/' + k)));
      results.forEach(r => { s3Settings[r.key] = r.value || ''; });
    } catch (e) {}

    const secretMaskedS3 = s3Settings.s3_secret_key || '';

    main.innerHTML += `
    <div class="card">
      <div class="card-header">
        <h3>S3 Object Storage (Hetzner)</h3>
      </div>
      <p style="color:var(--text-muted);font-size:13px;margin-bottom:16px;">
        Verbindung zum S3-kompatiblen Speicher für Dateien, Dokumente und Backups.
      </p>

      <div class="form-row">
        <div class="form-group" style="flex:2;">
          <label>Endpoint</label>
          <input type="text" id="settings-s3-endpoint" placeholder="https://nbg1.your-objectstorage.com" value="${escapeHtml(s3Settings.s3_endpoint || '')}">
        </div>
        <div class="form-group" style="flex:1;">
          <label>Region</label>
          <input type="text" id="settings-s3-region" placeholder="nbg1" value="${escapeHtml(s3Settings.s3_region || '')}">
        </div>
      </div>

      <div class="form-group">
        <label>Bucket-Name</label>
        <input type="text" id="settings-s3-bucket" placeholder="mein-bucket" value="${escapeHtml(s3Settings.s3_bucket || '')}">
      </div>

      <div class="form-row">
        <div class="form-group" style="flex:1;">
          <label>Access Key</label>
          <input type="text" id="settings-s3-access-key" placeholder="Access Key ID" value="${escapeHtml(s3Settings.s3_access_key || '')}">
        </div>
        <div class="form-group" style="flex:1;">
          <label>Secret Key</label>
          <input type="password" id="settings-s3-secret-key" placeholder="${secretMaskedS3 ? 'Gespeichert — leer lassen zum Beibehalten' : 'Secret Access Key'}">
          ${secretMaskedS3 ? '<span style="font-size:11px;color:var(--text-muted);">Leer lassen um den bestehenden Schlüssel beizubehalten</span>' : ''}
        </div>
      </div>

      <div style="display:flex;gap:10px;align-items:center;margin-top:12px;">
        <button class="btn btn-primary" onclick="saveS3Settings()">Speichern</button>
        <button class="btn btn-secondary" onclick="testS3Connection()" id="btn-s3-test">Verbindung testen</button>
        <span id="s3-test-result" style="font-size:13px;"></span>
      </div>

      <div id="s3-status-box" style="margin-top:16px;padding:14px 16px;border-radius:8px;background:var(--bg);border:1px solid var(--border);">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <span id="s3-status-dot" style="width:10px;height:10px;border-radius:50%;background:var(--border);display:inline-block;"></span>
          <strong id="s3-status-text" style="font-size:13px;">Nicht getestet</strong>
        </div>
        <div id="s3-status-details" style="font-size:12px;color:var(--text-muted);margin-left:18px;"></div>
      </div>
    </div>
    `;
  }
}

async function saveApiKey() {
  const key = document.getElementById('settings-api-key').value.trim();
  if (!key) {
    showToast('Bitte einen API-Key eingeben', 'error');
    return;
  }
  try {
    await api('/api/settings/openai_api_key', { method: 'PUT', body: { value: key } });
    showToast('API-Key gespeichert');
    renderSettingsProgram();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function saveCompanySettings() {
  try {
    await api('/api/settings/company', {
      method: 'PUT',
      body: {
        company_street: document.getElementById('co-street').value.trim(),
        company_zip: document.getElementById('co-zip').value.trim(),
        company_city: document.getElementById('co-city').value.trim(),
        company_phone: document.getElementById('co-phone').value.trim(),
        company_email: document.getElementById('co-email').value.trim(),
        company_ceo: document.getElementById('co-ceo').value.trim(),
        company_tax_number: document.getElementById('co-tax').value.trim(),
        company_hrb: document.getElementById('co-hrb').value.trim()
      }
    });
    showToast('Firmendaten gespeichert');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function openBankAccountModal(editId) {
  let bank = { label: '', iban: '', bic: '', bank_name: '', is_default: 0 };
  if (editId) {
    try {
      const banks = await api('/api/bank-accounts');
      bank = banks.find(b => b.id === editId) || bank;
    } catch(e) {}
  }
  openModal(editId ? 'Bankverbindung bearbeiten' : 'Neue Bankverbindung', `
    <div class="form-group">
      <label>Bezeichnung <small style="color:var(--text-muted);font-weight:normal;">(z.B. "Geschäftskonto", "Sparkonto")</small></label>
      <input type="text" id="ba-label" value="${escapeHtml(bank.label)}" placeholder="Geschäftskonto">
    </div>
    <div class="form-group">
      <label>IBAN *</label>
      <input type="text" id="ba-iban" value="${escapeHtml(bank.iban)}" placeholder="DE...">
    </div>
    <div class="form-row">
      <div class="form-group" style="flex:1;">
        <label>BIC</label>
        <input type="text" id="ba-bic" value="${escapeHtml(bank.bic || '')}">
      </div>
      <div class="form-group" style="flex:1;">
        <label>Bankname</label>
        <input type="text" id="ba-bank" value="${escapeHtml(bank.bank_name || '')}">
      </div>
    </div>
    <div class="form-group" style="margin-top:8px;">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:normal;">
        <input type="checkbox" id="ba-default" ${bank.is_default ? 'checked' : ''} style="width:16px;height:16px;margin:0;">
        Als Standard-Bankverbindung verwenden
      </label>
    </div>
    <div class="form-actions">
      <button class="btn btn-primary" onclick="saveBankAccount(${editId || 'null'})">${editId ? 'Speichern' : 'Anlegen'}</button>
      <button class="btn btn-secondary" onclick="closeModal()">Abbrechen</button>
    </div>
  `);
}

async function saveBankAccount(editId) {
  const data = {
    label: document.getElementById('ba-label').value.trim(),
    iban: document.getElementById('ba-iban').value.trim(),
    bic: document.getElementById('ba-bic').value.trim(),
    bank_name: document.getElementById('ba-bank').value.trim(),
    is_default: document.getElementById('ba-default').checked ? 1 : 0
  };
  if (!data.iban) { showToast('IBAN ist Pflichtfeld', 'error'); return; }
  try {
    if (editId) {
      await api('/api/bank-accounts/' + editId, { method: 'PUT', body: data });
    } else {
      await api('/api/bank-accounts', { method: 'POST', body: data });
    }
    closeModal();
    showToast('Bankverbindung gespeichert');
    renderSettingsCompany();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteBankAccount(id) {
  if (!confirm('Bankverbindung wirklich löschen?')) return;
  try {
    await api('/api/bank-accounts/' + id, { method: 'DELETE' });
    showToast('Bankverbindung gelöscht');
    renderSettingsCompany();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ===== Force password on first login =====

function showForcePasswordScreen() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-container').style.display = 'none';

  let overlay = document.getElementById('force-password-screen');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'force-password-screen';
    document.body.appendChild(overlay);
  }
  overlay.style.cssText = 'position:fixed;inset:0;background:var(--bg);z-index:10000;display:flex;align-items:center;justify-content:center;';
  overlay.innerHTML = `
    <div style="background:var(--card-bg);border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.15);padding:32px;width:100%;max-width:420px;">
      <h2 style="margin-bottom:4px;">Passwort vergeben</h2>
      <p style="color:var(--text-muted);font-size:13px;margin-bottom:20px;">
        Hallo <strong>${escapeHtml(loggedInUser.name)}</strong>, bitte vergib ein Passwort für deinen Account bevor du fortfährst.
      </p>
      <div class="form-group" style="margin-bottom:12px;">
        <label>Neues Passwort</label>
        <input type="password" id="force-pw-new" placeholder="Mind. 8 Zeichen, 1 Großbuchstabe, 1 Sonderzeichen">
      </div>
      <div class="form-group" style="margin-bottom:16px;">
        <label>Passwort wiederholen</label>
        <input type="password" id="force-pw-confirm" placeholder="Passwort bestätigen">
      </div>
      <div id="force-pw-error" style="display:none;color:var(--danger);font-size:13px;margin-bottom:12px;"></div>
      <p style="font-size:11px;color:var(--text-muted);margin-bottom:16px;">Mindestens 8 Zeichen, 1 Großbuchstabe und 1 Sonderzeichen.</p>
      <button class="btn btn-primary" style="width:100%;" onclick="submitForcePassword()">Passwort speichern</button>
    </div>
  `;
  setTimeout(() => document.getElementById('force-pw-new')?.focus(), 100);
}

async function submitForcePassword() {
  const newPw = document.getElementById('force-pw-new').value;
  const confirm = document.getElementById('force-pw-confirm').value;
  const errorEl = document.getElementById('force-pw-error');

  if (!newPw || !confirm) {
    errorEl.textContent = 'Bitte beide Felder ausfüllen';
    errorEl.style.display = '';
    return;
  }
  if (newPw !== confirm) {
    errorEl.textContent = 'Passwörter stimmen nicht überein';
    errorEl.style.display = '';
    return;
  }
  try {
    await api('/api/staff/me/password', { method: 'PUT', body: { currentPassword: '', newPassword: newPw } });
    const overlay = document.getElementById('force-password-screen');
    if (overlay) overlay.remove();
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-container').style.display = '';
    await initApp();
    showToast('Passwort erfolgreich gesetzt');
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = '';
  }
}

// ===== Change own password =====

function openChangePasswordModal() {
  const html = `
    <div class="form-group">
      <label>Aktuelles Passwort</label>
      <input type="password" id="pw-current" placeholder="Aktuelles Passwort">
    </div>
    <div class="form-group">
      <label>Neues Passwort</label>
      <input type="password" id="pw-new" placeholder="Mind. 8 Zeichen, 1 Großbuchstabe, 1 Sonderzeichen">
    </div>
    <div class="form-group">
      <label>Neues Passwort wiederholen</label>
      <input type="password" id="pw-confirm" placeholder="Neues Passwort bestätigen">
    </div>
    <button class="btn btn-primary" onclick="submitChangePassword()">Passwort ändern</button>
  `;
  openModal('Passwort ändern', html);
}

async function submitChangePassword() {
  const current = document.getElementById('pw-current').value;
  const newPw = document.getElementById('pw-new').value;
  const confirm = document.getElementById('pw-confirm').value;
  if (!current || !newPw || !confirm) return showToast('Bitte alle Felder ausfüllen', 'error');
  if (newPw !== confirm) return showToast('Neue Passwörter stimmen nicht überein', 'error');
  try {
    await api('/api/staff/me/password', { method: 'PUT', body: { currentPassword: current, newPassword: newPw } });
    showToast('Passwort erfolgreich geändert');
    closeModal();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ===== Office 365 Settings =====

async function saveS3Settings() {
  try {
    const endpoint = document.getElementById('settings-s3-endpoint').value.trim();
    const region = document.getElementById('settings-s3-region').value.trim();
    const bucket = document.getElementById('settings-s3-bucket').value.trim();
    const accessKey = document.getElementById('settings-s3-access-key').value.trim();
    const secretKey = document.getElementById('settings-s3-secret-key').value.trim();

    const saves = [
      api('/api/settings/s3_endpoint', { method: 'PUT', body: { value: endpoint } }),
      api('/api/settings/s3_region', { method: 'PUT', body: { value: region } }),
      api('/api/settings/s3_bucket', { method: 'PUT', body: { value: bucket } }),
      api('/api/settings/s3_access_key', { method: 'PUT', body: { value: accessKey } })
    ];
    if (secretKey) {
      saves.push(api('/api/settings/s3_secret_key', { method: 'PUT', body: { value: secretKey } }));
    }
    await Promise.all(saves);
    showToast('S3-Einstellungen gespeichert');
    renderSettingsProgram();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function testS3Connection() {
  const btn = document.getElementById('btn-s3-test');
  const resultEl = document.getElementById('s3-test-result');
  const box = document.getElementById('s3-status-box');
  btn.disabled = true;
  resultEl.textContent = '';

  box.innerHTML = `
    <div style="text-align:center;padding:8px 0;">
      <div style="font-size:13px;color:var(--text-muted);margin-bottom:10px;">Verbindung wird getestet...</div>
      <div style="height:4px;background:var(--border);border-radius:4px;overflow:hidden;">
        <div style="height:100%;width:30%;background:var(--primary);border-radius:4px;animation:o365loading 1.2s ease-in-out infinite;"></div>
      </div>
    </div>
  `;

  try {
    const result = await api('/api/files/test');
    showS3Result({ success: true, bucket: result.bucket });
  } catch (err) {
    showS3Result({ success: false, error: err.message });
  }
  btn.disabled = false;
}

function showS3Result(res) {
  const box = document.getElementById('s3-status-box');
  if (!box) return;
  const dotColor = res.success ? 'var(--success)' : 'var(--danger)';
  const statusText = res.success ? 'Verbunden' : 'Verbindung fehlgeschlagen';
  const now = new Date().toLocaleTimeString('de-DE');
  const detail = res.success ? 'Bucket: ' + escapeHtml(res.bucket || '—') : escapeHtml(res.error || 'Unbekannter Fehler');

  box.style.opacity = '0';
  box.style.transition = 'opacity 0.2s';
  setTimeout(() => {
    box.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
        <span style="width:10px;height:10px;border-radius:50%;background:${dotColor};display:inline-block;"></span>
        <strong style="font-size:13px;">${statusText}</strong>
        <span style="margin-left:auto;font-size:11px;color:var(--text-muted);">Zuletzt geprüft: ${now}</span>
      </div>
      <div style="font-size:12px;color:var(--text-muted);margin-left:18px;">${detail}</div>
    `;
    box.style.opacity = '1';
  }, 200);
}

async function saveO365Settings() {
  try {
    const tenant = document.getElementById('settings-o365-tenant').value.trim();
    const clientId = document.getElementById('settings-o365-client-id').value.trim();
    const secret = document.getElementById('settings-o365-client-secret').value.trim();
    const sendMailbox = document.getElementById('settings-o365-send-mailbox').value.trim();
    const mailboxes = document.getElementById('settings-o365-mailboxes').value.trim();

    const saves = [
      api('/api/settings/o365_tenant_id', { method: 'PUT', body: { value: tenant } }),
      api('/api/settings/o365_client_id', { method: 'PUT', body: { value: clientId } }),
      api('/api/settings/o365_send_mailbox', { method: 'PUT', body: { value: sendMailbox } }),
      api('/api/settings/o365_mailboxes', { method: 'PUT', body: { value: mailboxes } })
    ];
    // Only update secret if a new one was entered
    if (secret) {
      saves.push(api('/api/settings/o365_client_secret', { method: 'PUT', body: { value: secret } }));
    }
    await Promise.all(saves);
    showToast('Office 365 Einstellungen gespeichert');
    renderSettingsProgram();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function testO365Connection() {
  const btn = document.getElementById('btn-o365-test');
  const box = document.getElementById('o365-status-box');
  const resultEl = document.getElementById('o365-test-result');
  btn.disabled = true;
  resultEl.textContent = '';

  // Hide old result, show loading bar
  box.innerHTML = `
    <div style="text-align:center;padding:8px 0;">
      <div style="font-size:13px;color:var(--text-muted);margin-bottom:10px;">Verbindung wird getestet...</div>
      <div style="height:4px;background:var(--border);border-radius:4px;overflow:hidden;">
        <div style="height:100%;width:30%;background:var(--primary);border-radius:4px;animation:o365loading 1.2s ease-in-out infinite;"></div>
      </div>
    </div>
  `;

  try {
    const res = await api('/api/o365/test');
    showO365Result(res);
  } catch (err) {
    showO365Result({ success: false, error: err.message });
  }
  btn.disabled = false;
}

async function autoTestO365() {
  const box = document.getElementById('o365-status-box');
  if (!box) return;

  box.innerHTML = `
    <div style="text-align:center;padding:8px 0;">
      <div style="font-size:13px;color:var(--text-muted);margin-bottom:10px;">Verbindung wird geprüft...</div>
      <div style="height:4px;background:var(--border);border-radius:4px;overflow:hidden;">
        <div style="height:100%;width:30%;background:var(--primary);border-radius:4px;animation:o365loading 1.2s ease-in-out infinite;"></div>
      </div>
    </div>
  `;

  try {
    const res = await api('/api/o365/test');
    showO365Result(res);
  } catch (err) {
    showO365Result({ success: false, error: err.message });
  }
}

function showO365Result(res) {
  const box = document.getElementById('o365-status-box');
  if (!box) return;

  const dotColor = res.success ? 'var(--success)' : 'var(--danger)';
  const statusText = res.success ? 'Verbunden' : 'Verbindung fehlgeschlagen';
  const now = new Date().toLocaleTimeString('de-DE');

  let detailHtml = '';
  if (res.success) {
    detailHtml = 'Authentifizierung erfolgreich. Microsoft Graph API erreichbar.';
    if (res.mailboxStatus) {
      detailHtml += '<br>' + res.mailboxStatus.map(m =>
        escapeHtml(m.mailbox) + ': ' + (m.ok ? '<span style="color:var(--success);">&#10004; OK</span>' : '<span style="color:var(--danger);">&#10008; ' + escapeHtml(m.error) + '</span>')
      ).join('<br>');
    }
  } else {
    detailHtml = escapeHtml(res.error || 'Unbekannter Fehler');
  }

  box.style.opacity = '0';
  box.style.transition = 'opacity 0.2s';
  setTimeout(() => {
    box.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
        <span style="width:10px;height:10px;border-radius:50%;background:${dotColor};display:inline-block;"></span>
        <strong style="font-size:13px;">${statusText}</strong>
        <span style="margin-left:auto;font-size:11px;color:var(--text-muted);">Zuletzt geprüft: ${now}</span>
      </div>
      <div style="font-size:12px;color:var(--text-muted);margin-left:18px;">${detailHtml}</div>
    `;
    box.style.opacity = '1';
  }, 200);
}

// ===== Fahrzeugschein Scanner (OpenAI Vision) =====

// Track where to return after scan
let _scanReturnTo = 'customers';
let _appointmentPhone = '';
let _appointmentEmail = '';

function openScanModal() {
  _scanReturnTo = 'customers';
  const html = `
    <div id="scan-step-upload">
      <p style="margin-bottom:12px;color:var(--text-muted);">
        Fotografieren Sie die <strong>Zulassungsbescheinigung Teil I</strong> (Fahrzeugschein) oder laden Sie ein Bild/PDF hoch.
        Die Daten werden per KI automatisch ausgelesen.
      </p>
      <div class="scan-upload-area" onclick="document.getElementById('scan-file-input').click()">
        <div class="scan-icon">&#128247;</div>
        <p><strong>Klicken zum Hochladen</strong> oder Datei hierher ziehen</p>
        <p>JPG, PNG oder PDF (Foto/Scan vom Fahrzeugschein)</p>
        <input type="file" id="scan-file-input" accept="image/*,application/pdf" capture="environment" onchange="handleScanFile(this.files[0])">
      </div>
    </div>
    <div id="scan-step-progress" style="display:none;">
      <img id="scan-preview-img" class="scan-preview" style="display:none;">
      <div class="scan-progress">
        <div class="scan-progress-bar">
          <div class="scan-progress-bar-fill" id="scan-progress-fill"></div>
        </div>
        <div class="scan-progress-text" id="scan-progress-text">Wird verarbeitet...</div>
      </div>
    </div>
    <div id="scan-step-result" style="display:none;"></div>
  `;
  openModal('Fahrzeugschein scannen', html);

  setTimeout(() => {
    const area = document.querySelector('.scan-upload-area');
    if (!area) return;
    area.addEventListener('dragover', e => { e.preventDefault(); area.style.borderColor = 'var(--primary)'; });
    area.addEventListener('dragleave', () => { area.style.borderColor = ''; });
    area.addEventListener('drop', e => {
      e.preventDefault();
      area.style.borderColor = '';
      if (e.dataTransfer.files.length) handleScanFile(e.dataTransfer.files[0]);
    });
  }, 100);
}

async function handleScanFile(file) {
  if (!file) return;

  document.getElementById('scan-step-upload').style.display = 'none';
  document.getElementById('scan-step-progress').style.display = 'block';

  const previewImg = document.getElementById('scan-preview-img');
  const progressFill = document.getElementById('scan-progress-fill');
  const progressText = document.getElementById('scan-progress-text');

  try {
    let base64, contentType;

    if (file.type === 'application/pdf') {
      // PDF: erste Seite mit PDF.js zu Bild rendern
      progressText.textContent = 'PDF wird verarbeitet...';
      progressFill.style.width = '10%';

      if (!window.pdfjsLib) {
        throw new Error('PDF-Bibliothek konnte nicht geladen werden. Bitte Seite neu laden.');
      }

      const arrayBuffer = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const scale = 2.0;
      const pageCanvases = [];
      let totalHeight = 0;
      let maxWidth = 0;

      for (let p = 1; p <= pdf.numPages; p++) {
        progressText.textContent = `PDF Seite ${p}/${pdf.numPages} wird verarbeitet...`;
        const page = await pdf.getPage(p);
        const viewport = page.getViewport({ scale });
        const c = document.createElement('canvas');
        c.width = viewport.width;
        c.height = viewport.height;
        await page.render({ canvasContext: c.getContext('2d'), viewport }).promise;
        pageCanvases.push(c);
        totalHeight += viewport.height;
        if (viewport.width > maxWidth) maxWidth = viewport.width;
      }

      const canvas = document.createElement('canvas');
      canvas.width = maxWidth;
      canvas.height = totalHeight;
      const ctx = canvas.getContext('2d');
      let yOffset = 0;
      for (const c of pageCanvases) {
        ctx.drawImage(c, 0, yOffset);
        yOffset += c.height;
      }

      previewImg.src = canvas.toDataURL('image/png');
      previewImg.style.display = 'block';

      base64 = canvas.toDataURL('image/png').split(',')[1];
      contentType = 'image/png';
    } else {
      // Bild direkt verarbeiten
      progressText.textContent = 'Bild wird vorbereitet...';
      progressFill.style.width = '10%';

      previewImg.src = URL.createObjectURL(file);
      previewImg.style.display = 'block';

      base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      contentType = file.type || 'image/jpeg';
    }

    progressText.textContent = 'Bild wird an KI gesendet...';
    progressFill.style.width = '30%';

    const response = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64, content_type: contentType }),
    });

    progressFill.style.width = '90%';
    progressText.textContent = 'Antwort wird verarbeitet...';

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Scan fehlgeschlagen');
    }

    progressFill.style.width = '100%';
    progressText.textContent = 'Erkennung abgeschlossen!';

    showScanResults(data);

  } catch (err) {
    progressText.textContent = 'Fehler: ' + err.message;
    progressFill.style.width = '0%';
    showToast(err.message, 'error');
  }
}

function showScanResults(parsed) {
  document.getElementById('scan-step-progress').style.display = 'none';
  const container = document.getElementById('scan-step-result');
  container.style.display = 'block';

  const fields = [parsed.last_name, parsed.first_name, parsed.street, parsed.zip,
    parsed.license_plate, parsed.manufacturer, parsed.model, parsed.vin, parsed.first_registration];
  const filled = fields.filter(f => f).length;

  container.innerHTML = `
    <div class="scan-badge-row">
      <span class="scan-badge-count">${filled}/${fields.length}</span>
      <span class="scan-badge-text">Felder erkannt — bitte prüfen</span>
    </div>

    <div class="scan-alt-box">
      <label>
        <input type="checkbox" id="scan-alt-customer" onchange="toggleScanAltCustomer(this.checked)">
        Abweichender Kunde (Nicht Fahrzeughalter)
      </label>
      <div id="scan-alt-customer-section" style="display:none;margin-top:10px;">
        <div class="form-group" style="position:relative;margin-bottom:0;">
          <input type="text" id="scan-alt-customer-search" placeholder="Kunde suchen..." autocomplete="off" oninput="searchScanAltCustomer(this.value)" style="padding:6px 9px;border-radius:6px;border:1px solid #e2e8f0;font-size:13px;width:100%;">
          <div id="scan-alt-customer-results" style="display:none;position:absolute;z-index:200;left:0;right:0;top:100%;background:var(--card-bg);border:1px solid var(--border);border-radius:0 0 8px 8px;box-shadow:0 4px 16px rgba(0,0,0,0.15);max-height:200px;overflow-y:auto;"></div>
        </div>
        <div id="scan-alt-customer-selected" style="display:none;margin-top:6px;padding:6px 10px;background:#fff;border:1px solid var(--primary);border-radius:6px;font-size:13px;"></div>
        <input type="hidden" id="scan-alt-customer-id" value="">
      </div>
    </div>

    <div id="scan-customer-data-section">
      <div class="scan-section-label">
        <span class="scan-sec-icon" style="background:rgba(26,86,219,0.06);color:var(--primary);">&#9823;</span>
        <span class="scan-sec-text">Kunde</span>
      </div>
      <div class="scan-grid">
        <div class="scan-result-field span-1">
          <label>Kundentyp</label>
          <select id="scan-customer-type" onchange="toggleScanCustomerType(this.value)">
            ${CUSTOMER_TYPES.map(t => `<option value="${t}">${t}</option>`).join('')}
          </select>
        </div>
        <div id="scan-private-fields" style="grid-column:span 2;display:grid;grid-template-columns:1fr 1fr;gap:6px 10px;">
          <div class="scan-result-field">
            <label>Vorname</label>
            <input type="text" id="scan-first-name" value="${escapeHtml(parsed.first_name || '')}">
          </div>
          <div class="scan-result-field">
            <label>Nachname</label>
            <input type="text" id="scan-last-name" value="${escapeHtml(parsed.last_name || '')}">
          </div>
        </div>
        <div id="scan-company-field" style="display:none;grid-column:span 2;">
          <div class="scan-result-field">
            <label>Firmenname</label>
            <input type="text" id="scan-company-name" value="">
          </div>
        </div>
        <div class="scan-result-field span-3">
          <label>Straße</label>
          <input type="text" id="scan-street" value="${escapeHtml(parsed.street || '')}">
        </div>
        <div class="scan-result-field span-1">
          <label>PLZ</label>
          <input type="text" id="scan-zip" value="${escapeHtml(parsed.zip || '')}">
        </div>
        <div class="scan-result-field span-2">
          <label>Ort</label>
          <input type="text" id="scan-city" value="${escapeHtml(parsed.city || '')}">
        </div>
        <div class="scan-result-field span-1">
          <label>Telefon</label>
          <input type="text" id="scan-phone" value="${escapeHtml(_appointmentPhone)}" placeholder="Optional">
        </div>
        <div class="scan-result-field span-2">
          <label>E-Mail</label>
          <input type="email" id="scan-email" value="${escapeHtml(_appointmentEmail)}" placeholder="Optional">
        </div>
      </div>
    </div>

    <div class="scan-section-label" style="margin-top:10px;">
      <span class="scan-sec-icon" style="background:rgba(5,150,105,0.06);color:var(--success);">&#9854;</span>
      <span class="scan-sec-text">Fahrzeug</span>
    </div>
    <div class="scan-grid">
      <div class="scan-result-field span-1">
        <label>Kennzeichen</label>
        <input type="text" id="scan-plate" value="${escapeHtml(parsed.license_plate || '')}" style="font-weight:600;letter-spacing:0.5px;">
      </div>
      <div class="scan-result-field span-1">
        <label>Hersteller</label>
        <input type="text" id="scan-manufacturer" value="${escapeHtml(parsed.manufacturer || '')}">
      </div>
      <div class="scan-result-field span-1">
        <label>Typ / Modell</label>
        <input type="text" id="scan-model" value="${escapeHtml(parsed.model || '')}">
      </div>
      <div class="scan-result-field span-1">
        <label>Erstzulassung</label>
        <input type="date" id="scan-registration" value="${parsed.first_registration || ''}">
      </div>
      <div class="scan-result-field span-2">
        <label>Fahrgestellnr. (FIN)</label>
        <input type="text" id="scan-vin" value="${escapeHtml(parsed.vin || '')}" style="font-family:'SF Mono',Consolas,monospace;font-size:12px;letter-spacing:0.3px;">
      </div>
      <div class="scan-result-field span-1">
        <label>Bauart *</label>
        <select id="scan-vehicle-type" required>
          <option value="">-- Wählen --</option>
          ${VEHICLE_TYPES.map(t => `<option value="${t}">${t}</option>`).join('')}
        </select>
      </div>
    </div>

    <div class="scan-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Abbrechen</button>
      <button class="btn btn-primary" onclick="startScanDuplicateCheck()">Prüfen &amp; Speichern</button>
    </div>
  `;
  _appointmentPhone = '';
  _appointmentEmail = '';
}

function toggleScanAltCustomer(checked) {
  document.getElementById('scan-alt-customer-section').style.display = checked ? '' : 'none';
  const customerSection = document.getElementById('scan-customer-data-section');
  if (customerSection) customerSection.style.display = checked ? 'none' : '';
  if (!checked) {
    document.getElementById('scan-alt-customer-id').value = '';
    document.getElementById('scan-alt-customer-selected').style.display = 'none';
    document.getElementById('scan-alt-customer-search').value = '';
    document.getElementById('scan-alt-customer-results').style.display = 'none';
  }
}

let _scanAltSearchTimeout = null;
async function searchScanAltCustomer(term) {
  clearTimeout(_scanAltSearchTimeout);
  const panel = document.getElementById('scan-alt-customer-results');
  if (!term || term.trim().length < 2) { panel.style.display = 'none'; return; }
  _scanAltSearchTimeout = setTimeout(async () => {
    try {
      const customers = await api(`/api/customers?search=${encodeURIComponent(term.trim())}`);
      if (customers.length === 0) {
        panel.innerHTML = '<div style="padding:10px;color:var(--text-muted);font-size:13px;">Keine Kunden gefunden</div>';
        panel.style.display = '';
        return;
      }
      panel.innerHTML = customers.slice(0, 15).map(c => `
        <div style="padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border);font-size:13px;"
             onmouseover="this.style.background='var(--bg-dark)'" onmouseout="this.style.background=''"
             onclick="selectScanAltCustomer(${c.id}, '${escapeHtml(customerDisplayName(c)).replace(/'/g, "\\'")}')">
          <strong>${customerDisplayName(c)}</strong>
          <span style="color:var(--text-muted);margin-left:8px;">${c.street ? escapeHtml(c.street) + ', ' : ''}${escapeHtml((c.zip || '') + ' ' + (c.city || ''))}</span>
        </div>
      `).join('');
      panel.style.display = '';
    } catch (e) {
      panel.style.display = 'none';
    }
  }, 300);
}

function selectScanAltCustomer(id, name) {
  document.getElementById('scan-alt-customer-id').value = id;
  document.getElementById('scan-alt-customer-search').value = '';
  document.getElementById('scan-alt-customer-results').style.display = 'none';
  const selected = document.getElementById('scan-alt-customer-selected');
  selected.innerHTML = `<span style="font-weight:600;">${name}</span> <span style="color:var(--text-muted);">(Kunde Nr. ${id})</span>
    <button type="button" style="float:right;background:none;border:none;color:var(--danger);cursor:pointer;font-size:14px;" onclick="clearScanAltCustomer()">&times; Entfernen</button>`;
  selected.style.display = '';
}

function clearScanAltCustomer() {
  document.getElementById('scan-alt-customer-id').value = '';
  document.getElementById('scan-alt-customer-selected').style.display = 'none';
}

function toggleScanCustomerType(type) {
  const isCompany = type === 'Firmenkunde' || type === 'Werkstatt';
  const firstName = document.getElementById('scan-first-name');
  const lastName = document.getElementById('scan-last-name');
  const companyName = document.getElementById('scan-company-name');
  if (isCompany && !companyName.value.trim()) {
    const parts = [firstName.value.trim(), lastName.value.trim()].filter(Boolean);
    if (parts.length) companyName.value = parts.join(' ');
  } else if (!isCompany && !firstName.value.trim() && !lastName.value.trim()) {
    const company = companyName.value.trim();
    if (company) lastName.value = company;
  }
  document.getElementById('scan-private-fields').style.display = isCompany ? 'none' : '';
  document.getElementById('scan-company-field').style.display = isCompany ? '' : 'none';
}

function getScanFormData() {
  const customerType = document.getElementById('scan-customer-type').value;
  const isCompany = customerType === 'Firmenkunde' || customerType === 'Werkstatt';
  return {
    customer: {
      customer_type: customerType,
      company_name: isCompany ? document.getElementById('scan-company-name').value.trim() : '',
      first_name: isCompany ? '' : document.getElementById('scan-first-name').value.trim(),
      last_name: isCompany ? '' : document.getElementById('scan-last-name').value.trim(),
      street: document.getElementById('scan-street').value.trim(),
      zip: document.getElementById('scan-zip').value.trim(),
      city: document.getElementById('scan-city').value.trim(),
      phone: document.getElementById('scan-phone').value.trim(),
      email: document.getElementById('scan-email').value.trim(),
      notes: '',
    },
    vehicle: {
      manufacturer: document.getElementById('scan-manufacturer').value.trim() || '-',
      model: document.getElementById('scan-model').value.trim() || '-',
      vehicle_type: document.getElementById('scan-vehicle-type').value,
      vin: document.getElementById('scan-vin').value.trim(),
      license_plate: document.getElementById('scan-plate').value.trim(),
      first_registration: document.getElementById('scan-registration').value,
    }
  };
}

function markScanField(id, invalid) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.borderColor = invalid ? 'var(--danger)' : '';
  el.style.boxShadow = invalid ? '0 0 0 2px rgba(220,38,38,0.12)' : '';
}

async function startScanDuplicateCheck() {
  const { customer, vehicle } = getScanFormData();

  // Reset all field markers
  ['scan-company-name','scan-first-name','scan-last-name','scan-vehicle-type'].forEach(id => markScanField(id, false));

  const isCompany = customer.customer_type === 'Firmenkunde' || customer.customer_type === 'Werkstatt';
  let hasError = false;

  if (isCompany && !customer.company_name) {
    markScanField('scan-company-name', true);
    hasError = true;
  }
  if (!isCompany && !customer.first_name && !customer.last_name) {
    markScanField('scan-first-name', true);
    markScanField('scan-last-name', true);
    hasError = true;
  }
  if (!vehicle.vehicle_type) {
    markScanField('scan-vehicle-type', true);
    hasError = true;
  }
  if (hasError) {
    showToast('Bitte alle Pflichtfelder ausfüllen', 'error');
    return;
  }

  if (!isCompany) {
    if (!customer.last_name) customer.last_name = customer.first_name;
    if (!customer.first_name) customer.first_name = '-';
  }

  const container = document.getElementById('scan-step-result');

  // Check if alternative customer was selected
  const altCustomerCheckbox = document.getElementById('scan-alt-customer');
  const altCustomerId = document.getElementById('scan-alt-customer-id')?.value;
  if (altCustomerCheckbox && altCustomerCheckbox.checked) {
    if (!altCustomerId) {
      showToast('Bitte einen abweichenden Kunden auswählen', 'error');
      return;
    }
    // Skip customer duplicate check, use selected customer directly
    try {
      await checkVehicleDuplicates(container, Number(altCustomerId), null, vehicle);
    } catch (err) {
      showToast('Fehler: ' + err.message, 'error');
    }
    return;
  }

  try {
    // Step 1: Check for duplicate customers
    const dupQuery = isCompany
      ? `/api/customers/check-duplicate?company_name=${encodeURIComponent(customer.company_name)}`
      : `/api/customers/check-duplicate?first_name=${encodeURIComponent(customer.first_name)}&last_name=${encodeURIComponent(customer.last_name)}`;
    const custCheck = await api(dupQuery);
    const allMatches = [...custCheck.exact, ...custCheck.similar];

    if (allMatches.length > 0) {
      showCustomerDuplicateStep(container, customer, vehicle, custCheck);
      return;
    }

    // No customer match -> check vehicle duplicates
    await checkVehicleDuplicates(container, null, customer, vehicle);

  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
}

function showCustomerDuplicateStep(container, customerData, vehicleData, custCheck) {
  const allMatches = [...custCheck.exact, ...custCheck.similar];
  const isExact = custCheck.exact.length > 0;

  let html = `<div class="scan-duplicate-check">`;
  html += `<h4 style="margin-bottom:12px;">${isExact ? 'Kunde bereits vorhanden!' : 'Mögliche Übereinstimmungen gefunden'}</h4>`;
  html += `<p style="margin-bottom:16px;color:var(--text-muted);">
    Gescannt: <strong>${escapeHtml(customerData.first_name || '')} ${escapeHtml(customerData.last_name || '')}</strong>
    ${customerData.street ? ', ' + escapeHtml(customerData.street) : ''}
    ${customerData.zip || customerData.city ? ', ' + escapeHtml(customerData.zip + ' ' + customerData.city) : ''}
  </p>`;

  html += `<div style="margin-bottom:16px;">`;
  allMatches.forEach(c => {
    const isExactMatch = custCheck.exact.find(e => e.id === c.id);
    html += `
      <div class="scan-match-card" style="border:1px solid ${isExactMatch ? 'var(--danger)' : 'var(--warning)'};border-radius:8px;padding:12px;margin-bottom:8px;cursor:pointer;transition:background 0.2s;"
           onmouseover="this.style.background='var(--bg-dark)'" onmouseout="this.style.background=''"
           onclick="selectExistingCustomer(${c.id}, this)">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <strong>${customerDisplayName(c)}</strong>
            ${isExactMatch ? '<span class="badge badge-danger" style="margin-left:8px;">Exakte Übereinstimmung</span>' : '<span class="badge badge-warning" style="margin-left:8px;">Ähnlich</span>'}
            <br><small style="color:var(--text-muted);">
              ${c.street ? escapeHtml(c.street) + ', ' : ''}${escapeHtml(c.zip + ' ' + c.city)}
              ${c.phone ? ' | Tel: ' + escapeHtml(c.phone) : ''}
            </small>
          </div>
          <div>
            <input type="radio" name="scan-customer-select" value="${c.id}" style="width:18px;height:18px;">
          </div>
        </div>
      </div>`;
  });
  html += `</div>`;

  html += `<div class="form-actions" style="gap:8px;flex-wrap:wrap;">
    <button class="btn btn-primary" onclick="useScanSelectedCustomer()" id="btn-use-existing" disabled>Ausgewählten Kunden verwenden</button>
    <button class="btn btn-secondary" onclick="createNewScanCustomer()">Trotzdem neu anlegen</button>
    <button class="btn btn-secondary" onclick="closeModal()">Abbrechen</button>
  </div>`;
  html += `</div>`;

  container.innerHTML = html;

  // Store data for later use
  window._scanCustomerData = customerData;
  window._scanVehicleData = vehicleData;
}

function selectExistingCustomer(id, el) {
  // Select radio
  const radio = el.querySelector('input[type=radio]');
  radio.checked = true;
  document.getElementById('btn-use-existing').disabled = false;
}

async function useScanSelectedCustomer() {
  const selected = document.querySelector('input[name="scan-customer-select"]:checked');
  if (!selected) {
    showToast('Bitte einen Kunden auswählen', 'error');
    return;
  }
  const customerId = Number(selected.value);
  const container = document.getElementById('scan-step-result');
  const vehicleData = window._scanVehicleData;
  const customerData = window._scanCustomerData;

  try {
    // Check if scanned contact info differs from existing customer
    const existing = await api(`/api/customers/${customerId}`);
    const newPhone = (customerData?.phone || '').trim();
    const newEmail = (customerData?.email || '').trim();
    const oldPhone = (existing.phone || '').trim();
    const oldEmail = (existing.email || '').trim();
    const phoneDiffers = newPhone && newPhone !== oldPhone;
    const emailDiffers = newEmail && newEmail !== oldEmail;

    if (phoneDiffers || emailDiffers) {
      showContactUpdateStep(container, customerId, vehicleData, existing, newPhone, newEmail, phoneDiffers, emailDiffers);
      return;
    }

    await checkVehicleDuplicates(container, customerId, null, vehicleData);
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
}

function showContactUpdateStep(container, customerId, vehicleData, existing, newPhone, newEmail, phoneDiffers, emailDiffers) {
  const name = customerDisplayName(existing);
  let html = `<div class="scan-duplicate-check">`;
  html += `<h4 style="margin-bottom:12px;">Kontaktdaten abweichend</h4>`;
  html += `<p style="margin-bottom:16px;color:var(--text-muted);">Die Kontaktdaten aus dem Termin weichen vom bestehenden Kunden <strong>${escapeHtml(name)}</strong> ab.</p>`;
  html += `<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
    <thead><tr>
      <th style="text-align:left;padding:8px;border-bottom:2px solid var(--border);"></th>
      <th style="text-align:left;padding:8px;border-bottom:2px solid var(--border);">Gespeichert</th>
      <th style="text-align:left;padding:8px;border-bottom:2px solid var(--border);">Neu (aus Termin)</th>
      <th style="text-align:center;padding:8px;border-bottom:2px solid var(--border);">Aktualisieren</th>
    </tr></thead><tbody>`;
  if (phoneDiffers) {
    html += `<tr>
      <td style="padding:8px;border-bottom:1px solid var(--border);font-weight:600;">Telefon</td>
      <td style="padding:8px;border-bottom:1px solid var(--border);">${escapeHtml(existing.phone || '–')}</td>
      <td style="padding:8px;border-bottom:1px solid var(--border);color:var(--primary);font-weight:600;">${escapeHtml(newPhone)}</td>
      <td style="padding:8px;border-bottom:1px solid var(--border);text-align:center;"><input type="checkbox" id="update-phone" checked style="width:18px;height:18px;"></td>
    </tr>`;
  }
  if (emailDiffers) {
    html += `<tr>
      <td style="padding:8px;border-bottom:1px solid var(--border);font-weight:600;">E-Mail</td>
      <td style="padding:8px;border-bottom:1px solid var(--border);">${escapeHtml(existing.email || '–')}</td>
      <td style="padding:8px;border-bottom:1px solid var(--border);color:var(--primary);font-weight:600;">${escapeHtml(newEmail)}</td>
      <td style="padding:8px;border-bottom:1px solid var(--border);text-align:center;"><input type="checkbox" id="update-email" checked style="width:18px;height:18px;"></td>
    </tr>`;
  }
  html += `</tbody></table>`;
  html += `<div class="form-actions" style="gap:8px;flex-wrap:wrap;">
    <button class="btn btn-primary" onclick="applyContactUpdate()">Weiter</button>
    <button class="btn btn-secondary" onclick="closeModal()">Abbrechen</button>
  </div>`;
  html += `</div>`;
  container.innerHTML = html;
  window._scanVehicleData = vehicleData;
  window._contactUpdateCtx = { customerId, newPhone, newEmail, phoneDiffers, emailDiffers };
}

async function applyContactUpdate() {
  const { customerId, newPhone, newEmail, phoneDiffers, emailDiffers } = window._contactUpdateCtx;
  const updatePhone = phoneDiffers && document.getElementById('update-phone')?.checked;
  const updateEmail = emailDiffers && document.getElementById('update-email')?.checked;

  try {
    if (updatePhone || updateEmail) {
      const body = {};
      if (updatePhone) body.phone = newPhone;
      if (updateEmail) body.email = newEmail;
      await api(`/api/customers/${customerId}/contact`, { method: 'PUT', body });
      showToast('Kontaktdaten aktualisiert');
    }
    const container = document.getElementById('scan-step-result');
    const vehicleData = window._scanVehicleData;
    await checkVehicleDuplicates(container, customerId, null, vehicleData);
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
}

async function createNewScanCustomer() {
  const container = document.getElementById('scan-step-result');
  const customerData = window._scanCustomerData;
  const vehicleData = window._scanVehicleData;

  try {
    await checkVehicleDuplicates(container, null, customerData, vehicleData);
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
}

async function checkVehicleDuplicates(container, existingCustomerId, newCustomerData, vehicleData) {
  const vin = vehicleData.vin;

  if (!vin) {
    // No VIN to check, just save
    await finalizeScanSave(existingCustomerId, newCustomerData, vehicleData);
    return;
  }

  const vehMatches = await api(`/api/vehicles/check-duplicate?vin=${encodeURIComponent(vin)}`);

  if (vehMatches.length === 0) {
    // No vehicle duplicate, save directly
    await finalizeScanSave(existingCustomerId, newCustomerData, vehicleData);
    return;
  }

  // Vehicle exists -> show info and options
  showVehicleDuplicateStep(container, existingCustomerId, newCustomerData, vehicleData, vehMatches[0]);
}

function showVehicleDuplicateStep(container, existingCustomerId, newCustomerData, vehicleData, match) {
  // Check if vehicle belongs to the same customer we selected
  const sameCustomer = existingCustomerId && match.customer_id === existingCustomerId;

  let html = `<div class="scan-duplicate-check">`;
  html += `<h4 style="margin-bottom:12px;color:var(--danger);">Fahrzeug bereits in der Datenbank!</h4>`;
  html += `<p style="margin-bottom:16px;color:var(--text-muted);">
    Ein Fahrzeug mit dieser Fahrgestellnummer existiert bereits:
  </p>`;

  html += `
    <div style="border:1px solid var(--danger);border-radius:8px;padding:16px;margin-bottom:16px;">
      <strong>${escapeHtml(match.manufacturer)} ${escapeHtml(match.model)}</strong><br>
      Kennzeichen: <strong>${escapeHtml(match.license_plate || '-')}</strong><br>
      FIN: <strong style="font-family:monospace;">${escapeHtml(match.vin)}</strong><br><br>
      Aktueller Halter: <strong>${customerDisplayName(match)}</strong>
      ${match.phone ? '<br>Tel: ' + escapeHtml(match.phone) : ''}
      ${match.email ? '<br>E-Mail: ' + escapeHtml(match.email) : ''}
    </div>`;

  if (sameCustomer) {
    html += `<p style="color:var(--success);margin-bottom:16px;"><strong>Das Fahrzeug gehört bereits diesem Kunden.</strong></p>`;
    html += `<div class="form-actions">
      <button class="btn btn-primary" onclick="openExistingCustomerVehicle(${match.customer_id}, ${match.id})">Kunde öffnen</button>
      <button class="btn btn-secondary" onclick="closeModal()">Abbrechen</button>
    </div>`;
  } else {
    // Determine new customer name for display
    const newCustName = existingCustomerId
      ? '(ausgewählter Kunde)'
      : (newCustomerData ? newCustomerData.first_name + ' ' + newCustomerData.last_name : '');

    html += `<p style="margin-bottom:16px;">Was möchten Sie tun?</p>`;
    html += `<div class="form-actions" style="gap:8px;flex-wrap:wrap;">`;

    html += `<button class="btn btn-primary" onclick="openExistingCustomerVehicle(${match.customer_id}, ${match.id})">
      Kunde ${customerDisplayName(match)} öffnen
    </button>`;

    html += `<button class="btn btn-warning" onclick="reassignVehicleToCustomer(${match.id}, ${existingCustomerId || 'null'})">
      Fahrzeug an ${escapeHtml(newCustName)} umschreiben
    </button>`;

    html += `<button class="btn btn-secondary" onclick="closeModal()">Abbrechen</button>`;
    html += `</div>`;
  }

  html += `</div>`;
  container.innerHTML = html;

  // Store data for later
  window._scanCustomerData = newCustomerData;
}

function openExistingCustomerVehicle(customerId, vehicleId) {
  closeModal();
  navigate('customer-detail', customerId);
}

async function reassignVehicleToCustomer(vehicleId, existingCustomerId) {
  try {
    let customerId = existingCustomerId;
    if (!customerId) {
      const custResult = await api('/api/customers', { method: 'POST', body: window._scanCustomerData });
      customerId = custResult.id;
    }
    await api(`/api/vehicles/${vehicleId}/reassign`, { method: 'PUT', body: { customer_id: customerId } });
    showToast('Fahrzeug wurde dem Kunden zugewiesen!');
    closeModal();
    navigate('customer-detail', customerId);
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
}

async function finalizeScanSave(existingCustomerId, newCustomerData, vehicleData) {
  try {
    let customerId = existingCustomerId;

    // Create new customer if needed
    if (!customerId) {
      const custResult = await api('/api/customers', { method: 'POST', body: newCustomerData });
      customerId = custResult.id;
    }

    const vehResult = await api(`/api/customers/${customerId}/vehicles`, { method: 'POST', body: vehicleData });

    showToast('Kunde und Fahrzeug erfolgreich gespeichert!');
    closeModal();
    navigate('customer-detail', customerId);

  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
}

// ===== PAGE: Invoices =====

const INVOICE_STATUSES = ['Entwurf', 'Offen', 'Bezahlt', 'Storniert', 'Mahnstufe 1', 'Mahnstufe 2'];

function getInvoiceStatusBadge(status) {
  const map = {
    'Entwurf':     'gray',
    'Offen':       'blue',
    'Bezahlt':     'green',
    'Storniert':   'red',
    'Mahnstufe 1': 'mahnstufe1',
    'Mahnstufe 2': 'mahnstufe2',
  };
  return `<span class="badge badge-${map[status] || 'gray'}">${escapeHtml(status)}</span>`;
}

// Globaler Cache aller Rechnungen — wird beim Laden einmal befuellt
let _allInvoices = [];

async function renderInvoices() {
  const main = document.getElementById('main-content');
  try {
    _allInvoices = await api('/api/invoices');

    // LIST-01: Standard = aktueller Monat (YYYY-MM als Praefix im Datumsfeld)
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = String(now.getFullYear());
    const defaultDateFilter = mm + '.' + yyyy; // z.B. "03.2026"

    main.innerHTML = `
      <div class="page-header">
        <h2>Rechnungen</h2>
        <button class="btn btn-primary" onclick="openNewInvoiceModal()">+ Neue Rechnung</button>
      </div>
      <div class="card">
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Rechnungsnr.</th>
                <th>Datum</th>
                <th>Kundenname</th>
                <th>Zahlart</th>
                <th>Netto</th>
                <th>Brutto</th>
                <th>Status</th>
                <th>Aktionen</th>
              </tr>
              <tr class="filter-row">
                <td><input type="text" id="inv-filter-nr"       placeholder="Suchen..." oninput="applyInvoiceFilters()" class="filter-input"></td>
                <td><input type="text" id="inv-filter-date"     placeholder="z.B. 03.2026" value="${defaultDateFilter}" oninput="applyInvoiceFilters()" class="filter-input"></td>
                <td><input type="text" id="inv-filter-customer" placeholder="Suchen..." oninput="applyInvoiceFilters()" class="filter-input"></td>
                <td><input type="text" id="inv-filter-zahlart"  placeholder="Suchen..." oninput="applyInvoiceFilters()" class="filter-input"></td>
                <td></td>
                <td></td>
                <td>
                  <select id="inv-filter-status" onchange="applyInvoiceFilters()" class="filter-input">
                    <option value="">Alle</option>
                    ${INVOICE_STATUSES.map(s => `<option value="${s}">${s}</option>`).join('')}
                  </select>
                </td>
                <td></td>
              </tr>
            </thead>
            <tbody id="invoices-tbody"></tbody>
          </table>
        </div>
      </div>
    `;

    applyInvoiceFilters();
  } catch (err) {
    main.innerHTML = `<p style="color:var(--danger);">Fehler: ${escapeHtml(err.message)}</p>`;
  }
}

function applyInvoiceFilters() {
  const nr       = (document.getElementById('inv-filter-nr')?.value       || '').trim().toLowerCase();
  const dateStr  = (document.getElementById('inv-filter-date')?.value     || '').trim();
  const customer = (document.getElementById('inv-filter-customer')?.value || '').trim().toLowerCase();
  const zahlart  = (document.getElementById('inv-filter-zahlart')?.value  || '').trim().toLowerCase();
  const status   = (document.getElementById('inv-filter-status')?.value   || '');

  // LIST-05: Datums-Teilsuche
  // "2026"    -> passt auf jedes invoice_date das "2026" enthaelt (alle Jahresrechnungen)
  // "03.2026" -> Eingabe enthaelt Punkt -> interpretiere als MM.YYYY -> passt auf YYYY-MM-XX Felder
  function matchesDate(invoiceDate) {
    if (!dateStr) return true;
    if (!invoiceDate) return false;
    // invoiceDate ist im Format YYYY-MM-DD (ISO)
    const d = invoiceDate; // z.B. "2026-03-15"
    const parts = dateStr.split('.');
    if (parts.length === 2 && parts[0].length <= 2 && parts[1].length === 4) {
      // Format MM.YYYY eingegeben
      const mm = parts[0].padStart(2, '0');
      const yyyy = parts[1];
      return d.startsWith(yyyy + '-' + mm);
    }
    // Sonst: einfache Teilsuche (z.B. "2026" trifft alle 2026-Daten)
    return d.includes(dateStr);
  }

  const filtered = _allInvoices.filter(inv => {
    if (nr       && !inv.invoice_number.toLowerCase().includes(nr))          return false;
    if (!matchesDate(inv.invoice_date))                                       return false;
    if (customer && !(inv.customer_name || '').toLowerCase().includes(customer)) return false;
    if (zahlart  && !(inv.payment_method || '').toLowerCase().includes(zahlart)) return false;
    if (status   && inv.status !== status)                                   return false;
    return true;
  });

  const tbody = document.getElementById('invoices-tbody');
  if (!tbody) return;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:24px;">Keine Rechnungen gefunden.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(inv => `
    <tr class="clickable" ondblclick="navigate('invoice-detail', ${inv.id})">
      <td><strong>${escapeHtml(inv.invoice_number)}</strong></td>
      <td>${formatDate(inv.invoice_date)}</td>
      <td>${escapeHtml(inv.customer_name || '')}</td>
      <td>${escapeHtml(inv.payment_method || '')}</td>
      <td>${Number(inv.total_net).toFixed(2)} &euro;</td>
      <td>${Number(inv.total_gross).toFixed(2)} &euro;</td>
      <td>${getInvoiceStatusBadge(inv.status)}</td>
      <td style="white-space:nowrap;">
        <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation(); navigate('invoice-detail', ${inv.id})">Öffnen</button>
        <button class="btn btn-sm btn-primary" onclick="event.stopPropagation(); window.open('/api/invoices/${inv.id}/pdf','_blank')">PDF</button>
      </td>
    </tr>
  `).join('');
}

// --- New Invoice Modal ---
let newInvoiceCustomerId = null;

// FORM-01: Kunde wird aus Kundenliste gewählt via searchInvoiceCustomer() + selectInvoiceCustomer()
// Keine Freitexteingabe -- createInvoice() blockiert ohne gesetztes newInvoiceCustomerId
async function openNewInvoiceModal() {
  newInvoiceCustomerId = null;
  const today = new Date().toISOString().split('T')[0];
  const due = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0];
  let banks = [];
  try { banks = await api('/api/bank-accounts'); } catch(e) {}
  let bankSelect = '';
  if (banks.length > 1) {
    const hasDefault = banks.some(b => b.is_default);
    bankSelect = `
    <div class="form-group">
      <label>Bankverbindung <span style="color:var(--danger);">*</span></label>
      <select id="inv-new-bank-account" required>
        ${hasDefault ? '' : '<option value="">— Bitte wählen —</option>'}
        ${banks.map(b => `<option value="${b.id}" ${b.is_default ? 'selected' : ''}>${escapeHtml(b.label || b.bank_name || 'Konto')} — ${escapeHtml(b.iban)}</option>`).join('')}
      </select>
    </div>`;
  }
  openModal('Neue Rechnung', `
    <div class="form-group" style="position:relative;">
      <label>Kunde suchen</label>
      <input type="text" id="inv-customer-search" placeholder="Name oder Firma eingeben..." oninput="searchInvoiceCustomer()" autocomplete="off">
      <div class="search-dropdown" id="inv-customer-dropdown"></div>
    </div>
    <div id="inv-customer-selected" style="display:none;margin-bottom:16px;"></div>
    <div class="form-row">
      <div class="form-group">
        <label>Rechnungsdatum</label>
        <input type="date" id="inv-new-date" value="${today}">
      </div>
      <div class="form-group">
        <label>Fällig bis <small style="color:var(--text-muted);font-weight:normal;">(14 Tage ab Rechnungsdatum, automatisch)</small></label>
        <input type="date" id="inv-new-due" value="${due}">
      </div>
    </div>
    <div class="form-group">
      <label>Leistungsdatum <span style="color:var(--danger);">*</span></label>
      <input type="date" id="inv-new-service-date" value="${today}" required>
    </div>
    <div class="form-group">
      <label>Zahlart</label>
      <select id="inv-new-payment-method">
        <option value="Überweisung" selected>Überweisung</option>
        <option value="Bar">Bar</option>
        <option value="Karte">Karte</option>
      </select>
    </div>
    ${bankSelect}
    <div class="form-group">
      <label>Bemerkungen</label>
      <textarea id="inv-new-notes" rows="2" placeholder="Optionale Hinweise..."></textarea>
    </div>
    <div class="form-actions">
      <button class="btn btn-primary" onclick="createInvoice()">Rechnung erstellen</button>
      <button class="btn btn-secondary" onclick="closeModal()">Abbrechen</button>
    </div>
  `);
}

async function searchInvoiceCustomer() {
  const term = document.getElementById('inv-customer-search').value.trim();
  const dropdown = document.getElementById('inv-customer-dropdown');
  if (term.length < 2) { dropdown.style.display = 'none'; return; }
  try {
    const customers = await api(`/api/customers?search=${encodeURIComponent(term)}`);
    if (customers.length === 0) {
      dropdown.innerHTML = '<div class="search-dropdown-item" style="color:var(--text-muted);">Keine Kunden gefunden</div>';
    } else {
      dropdown.innerHTML = customers.slice(0, 10).map(c => {
        const name = (c.customer_type === 'Firmenkunde' || c.customer_type === 'Werkstatt') ? c.company_name : `${c.last_name}, ${c.first_name}`;
        const sub = c.city ? ` — ${c.city}` : '';
        return `<div class="search-dropdown-item" onclick="selectInvoiceCustomer(${c.id}, '${escapeHtml(name)}${escapeHtml(sub)}')">${escapeHtml(name)}${escapeHtml(sub)}</div>`;
      }).join('');
    }
    dropdown.style.display = 'block';
  } catch (err) {
    dropdown.style.display = 'none';
  }
}

function selectInvoiceCustomer(id, displayName) {
  newInvoiceCustomerId = id;
  const dropdown = document.getElementById('inv-customer-dropdown');
  if (dropdown) dropdown.style.display = 'none';
  const searchInput = document.getElementById('inv-customer-search');
  if (searchInput) searchInput.style.display = 'none';
  document.getElementById('inv-customer-selected').style.display = '';
  document.getElementById('inv-customer-selected').innerHTML = `
    <div class="search-selected">
      <span>${displayName}</span>
      <button class="btn btn-sm btn-secondary" onclick="clearInvoiceCustomer()">Ändern</button>
    </div>
  `;
}

function clearInvoiceCustomer() {
  newInvoiceCustomerId = null;
  document.getElementById('inv-customer-selected').style.display = 'none';
  const searchInput = document.getElementById('inv-customer-search');
  searchInput.style.display = '';
  searchInput.value = '';
  searchInput.focus();
}

async function createInvoice() {
  if (!newInvoiceCustomerId) { showToast('Bitte einen Kunden auswählen', 'error'); return; }
  const date = document.getElementById('inv-new-date').value;
  const due = document.getElementById('inv-new-due').value;
  if (!date) { showToast('Rechnungsdatum ist Pflichtfeld', 'error'); return; }
  const serviceDate = document.getElementById('inv-new-service-date').value;
  if (!serviceDate) { showToast('Leistungsdatum ist Pflichtfeld', 'error'); return; }
  const paymentMethod = document.getElementById('inv-new-payment-method').value;
  const notes = document.getElementById('inv-new-notes').value.trim();
  const bankEl = document.getElementById('inv-new-bank-account');
  const bank_account_id = bankEl ? Number(bankEl.value) || null : null;
  if (bankEl && !bank_account_id) { showToast('Bitte eine Bankverbindung auswählen', 'error'); return; }
  try {
    const result = await api('/api/invoices', { method: 'POST', body: { customer_id: newInvoiceCustomerId, invoice_date: date, due_date: due, service_date: serviceDate, payment_method: paymentMethod, notes: notes, bank_account_id } });
    closeModal();
    showToast(`Rechnung ${result.invoice_number} erstellt`);
    navigate('invoice-detail', result.id);
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
}

// --- Invoice Detail Page ---
async function renderInvoiceDetail(id) {
  const main = document.getElementById('main-content');
  try {
    const inv = await api(`/api/invoices/${id}`);
    const canEdit = canEditInvoice();
    const customerName = (inv.customer_type === 'Firmenkunde' || inv.customer_type === 'Werkstatt')
      ? escapeHtml(inv.company_name)
      : escapeHtml(inv.last_name) + ', ' + escapeHtml(inv.first_name);

    main.innerHTML = `
      <a class="back-link" onclick="navigate('invoices')">&#8592; Zurück zur Liste</a>
      <div class="page-header">
        <h2>Rechnung ${escapeHtml(inv.invoice_number)}</h2>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-primary" onclick="window.open('/api/invoices/${id}/pdf','_blank')">PDF anzeigen</button>
          ${isAdmin() ? `<button class="btn btn-danger" onclick="deleteInvoice(${id})">Löschen</button>` : ''}
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h3>Kundendaten</h3></div>
        <div class="customer-info-grid">
          <div class="info-item"><div class="info-label">Kunde</div><div class="info-value">${customerName}</div></div>
          <div class="info-item"><div class="info-label">Adresse</div><div class="info-value">${escapeHtml(inv.street)}<br>${escapeHtml(inv.zip)} ${escapeHtml(inv.city)}</div></div>
          <div class="info-item"><div class="info-label">Telefon</div><div class="info-value">${escapeHtml(inv.phone)}</div></div>
          <div class="info-item"><div class="info-label">E-Mail</div><div class="info-value">${escapeHtml(inv.email)}</div></div>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h3>Rechnungsdaten</h3></div>
        <div class="form-row">
          <div class="form-group">
            <label>Rechnungsnummer</label>
            <div class="form-control-static">${escapeHtml(inv.invoice_number)}</div>
          </div>
          <div class="form-group">
            <label>Rechnungsdatum</label>
            <div class="form-control-static">${formatDate(inv.invoice_date)}</div>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Zahlungsfrist</label>
            <div class="form-control-static">${inv.due_date ? formatDate(inv.due_date) : (inv.invoice_date ? formatDate(new Date(new Date(inv.invoice_date).getTime() + 14 * 86400000).toISOString().split('T')[0]) : '—')} <small style="color:var(--text-muted);">(14 Tage ab Rechnungsdatum)</small></div>
          </div>
          <div class="form-group">
            <label>Status</label>
            ${canEdit
              ? `<select id="inv-edit-status" onchange="saveInvoiceHeader(${id})">
                   ${INVOICE_STATUSES.map(s => `<option value="${s}" ${s === inv.status ? 'selected' : ''}>${s}</option>`).join('')}
                 </select>`
              : `<div class="form-control-static">${getInvoiceStatusBadge(inv.status)}</div>`}
          </div>
        </div>
        <div class="form-group">
          <label>Leistungsdatum <span style="color:var(--danger);">*</span></label>
          ${canEdit
            ? `<input type="date" id="inv-edit-service-date" value="${inv.service_date || ''}" onchange="saveInvoiceHeader(${id})">`
            : `<div class="form-control-static">${inv.service_date ? formatDate(inv.service_date) : '—'}</div>`}
        </div>
        <div class="form-group">
          <label>Zahlart</label>
          ${canEdit
            ? `<select id="inv-edit-payment-method" onchange="saveInvoiceHeader(${id})">
                 ${ ['Überweisung','Bar','Karte'].map(m =>
                     `<option value="${m}" ${(inv.payment_method||'Überweisung')===m?'selected':''}>${m}</option>`
                   ).join('') }
               </select>`
            : `<div class="form-control-static">${escapeHtml(inv.payment_method || 'Überweisung')}</div>`}
        </div>
        <div class="form-group">
          <label>Bemerkungen</label>
          ${canEdit
            ? `<textarea id="inv-edit-notes" rows="2" onchange="saveInvoiceHeader(${id})">${escapeHtml(inv.notes || '')}</textarea>`
            : `<div class="form-control-static" style="min-height:60px;">${escapeHtml(inv.notes || '—')}</div>`}
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>Positionen</h3>
          ${canEdit ? `<button class="btn btn-sm btn-primary" onclick="addInvoiceItemRow(${id})">+ Position</button>` : ''}
        </div>
        <div id="invoice-items-list">
          ${renderInvoiceItemsTable(inv.items, id, canEdit)}
        </div>
        <div class="invoice-summary" id="invoice-summary">
          ${renderInvoiceSummary(inv)}
        </div>
      </div>
    `;
  } catch (err) {
    main.innerHTML = `<p style="color:var(--danger);">Fehler: ${escapeHtml(err.message)}</p>`;
  }
}

function renderInvoiceItemsTable(items, invoiceId, canEdit) {
  if (items.length === 0) return '<p style="color:var(--text-muted);font-size:13px;">Noch keine Positionen vorhanden.</p>';
  let html = `<table class="invoice-items-table">
    <thead><tr>
      <th style="width:40px;">Pos</th><th>Bezeichnung</th><th style="width:80px;">Menge</th><th style="width:100px;">Einzelpreis</th><th style="width:100px;">Gesamt</th>${canEdit ? '<th style="width:140px;">Aktionen</th>' : ''}
    </tr></thead><tbody>`;
  items.forEach(item => {
    html += `<tr id="inv-item-row-${item.id}">
      <td>${item.position}</td>
      <td>${escapeHtml(item.description)}</td>
      <td>${Number(item.quantity) % 1 === 0 ? Number(item.quantity) : Number(item.quantity).toFixed(2)}</td>
      <td>${Number(item.unit_price).toFixed(2)} &euro;</td>
      <td>${Number(item.total_net).toFixed(2)} &euro;</td>
      ${canEdit ? `<td style="white-space:nowrap;">
        <button class="btn btn-sm btn-secondary" onclick="editInvoiceItemRow(${item.id}, ${invoiceId})">Bearbeiten</button>
        ${isAdmin() ? `<button class="btn btn-sm btn-danger" onclick="deleteInvoiceItem(${item.id}, ${invoiceId})">Löschen</button>` : ''}
      </td>` : '<td></td>'}
    </tr>`;
  });
  html += '</tbody></table>';
  return html;
}

function renderInvoiceSummary(inv) {
  return `<table>
    <tr><td style="text-align:right;">Netto:</td><td style="text-align:right;width:100px;"><strong>${Number(inv.total_net).toFixed(2)} &euro;</strong></td></tr>
    <tr><td style="text-align:right;">zzgl. 19% MwSt:</td><td style="text-align:right;">${Number(inv.total_vat).toFixed(2)} &euro;</td></tr>
    <tr class="total-row"><td style="text-align:right;">Brutto:</td><td style="text-align:right;">${Number(inv.total_gross).toFixed(2)} &euro;</td></tr>
  </table>`;
}

async function saveInvoiceHeader(invoiceId) {
  if (!canEditInvoice()) { showToast('Keine Berechtigung', 'error'); return; }
  const serviceDate = document.getElementById('inv-edit-service-date')?.value || '';
  if (!serviceDate) { showToast('Leistungsdatum ist Pflichtfeld', 'error'); return; }
  const data = {
    status: document.getElementById('inv-edit-status').value,
    service_date: serviceDate,
    payment_method: document.getElementById('inv-edit-payment-method').value,
    notes: document.getElementById('inv-edit-notes').value.trim(),
  };
  try {
    await api(`/api/invoices/${invoiceId}`, { method: 'PUT', body: data });
    showToast('Rechnung aktualisiert');
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
}

async function deleteInvoice(invoiceId) {
  if (!confirm('Rechnung wirklich löschen?')) return;
  try {
    await api(`/api/invoices/${invoiceId}`, { method: 'DELETE' });
    showToast('Rechnung gelöscht');
    navigate('invoices');
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
}

// --- Inline Invoice Items ---
function addInvoiceItemRow(invoiceId) {
  if (!canEditInvoice()) return;
  const container = document.getElementById('invoice-items-list');
  const noMsg = container.querySelector('p');
  if (noMsg) noMsg.remove();

  let table = container.querySelector('table');
  if (!table) {
    container.innerHTML = `<table class="invoice-items-table">
      <thead><tr>
        <th style="width:40px;">Pos</th><th>Bezeichnung</th><th style="width:80px;">Menge</th><th style="width:100px;">Einzelpreis</th><th style="width:100px;">Gesamt</th><th style="width:140px;">Aktionen</th>
      </tr></thead><tbody></tbody></table>`;
    table = container.querySelector('table');
  }
  const tbody = table.querySelector('tbody');
  // Don't add if already adding
  if (document.getElementById('inv-item-row-new')) return;
  const tr = document.createElement('tr');
  tr.id = 'inv-item-row-new';
  tr.innerHTML = `
    <td>-</td>
    <td><input type="text" id="new-inv-item-desc" placeholder="Bezeichnung"></td>
    <td><input type="number" id="new-inv-item-qty" step="0.01" value="1" min="0.01"></td>
    <td>
      <div style="display:flex;align-items:center;gap:4px;">
        <input type="number" id="new-inv-item-price" step="0.01" placeholder="0.00" style="flex:1;" oninput="updateItemPriceToggleDisplay('new')">
        <button type="button" id="new-inv-item-price-toggle" class="btn btn-sm btn-outline price-toggle-btn" onclick="toggleItemPriceMode('new')" title="Zwischen Netto und Brutto umschalten">Netto</button>
      </div>
    </td>
    <td>-</td>
    <td style="white-space:nowrap;">
      <button class="btn btn-sm btn-primary" onclick="saveInvoiceItemNew(${invoiceId})">Speichern</button>
      <button class="btn btn-sm btn-secondary" onclick="this.closest('tr').remove()">Abbrechen</button>
    </td>
  `;
  tbody.appendChild(tr);
  tr.querySelector('#new-inv-item-desc').focus();
}

// Track price input mode per row: key = prefix ('new' or 'edit-{id}'), value = 'netto' | 'brutto'
const _itemPriceMode = {};

function toggleItemPriceMode(prefix) {
  const btn = document.getElementById(`${prefix}-inv-item-price-toggle`);
  if (!btn) return;
  const current = _itemPriceMode[prefix] || 'netto';
  const next = current === 'netto' ? 'brutto' : 'netto';
  _itemPriceMode[prefix] = next;
  btn.textContent = next === 'netto' ? 'Netto' : 'Brutto';
  btn.classList.toggle('price-toggle-brutto', next === 'brutto');
}

function getItemNettoPrice(prefix, inputId) {
  const raw = parseFloat(document.getElementById(inputId).value) || 0;
  const mode = _itemPriceMode[prefix] || 'netto';
  if (mode === 'brutto') {
    return Math.round((raw / 1.19) * 100) / 100;
  }
  return raw;
}

function updateItemPriceToggleDisplay(prefix) {
  // placeholder for future live-preview if needed
}

async function saveInvoiceItemNew(invoiceId) {
  const data = {
    description: document.getElementById('new-inv-item-desc').value.trim(),
    quantity: parseFloat(document.getElementById('new-inv-item-qty').value) || 1,
    unit_price: getItemNettoPrice('new', 'new-inv-item-price'),
  };
  delete _itemPriceMode['new'];
  if (!data.description) { showToast('Bezeichnung ist Pflichtfeld', 'error'); return; }
  try {
    await api(`/api/invoices/${invoiceId}/items`, { method: 'POST', body: data });
    showToast('Position hinzugefügt');
    refreshInvoiceItems(invoiceId);
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
}

function editInvoiceItemRow(itemId, invoiceId) {
  const row = document.getElementById(`inv-item-row-${itemId}`);
  if (!row) return;
  const cells = row.querySelectorAll('td');
  const desc = cells[1].textContent.trim();
  const qty = cells[2].textContent.trim();
  const price = cells[3].textContent.replace('€', '').trim();

  row.innerHTML = `
    <td>${cells[0].textContent}</td>
    <td><input type="text" id="edit-inv-item-desc-${itemId}" value="${escapeHtml(desc)}"></td>
    <td><input type="number" id="edit-inv-item-qty-${itemId}" step="0.01" value="${qty}" min="0.01"></td>
    <td>
      <div style="display:flex;align-items:center;gap:4px;">
        <input type="number" id="edit-inv-item-price-${itemId}" step="0.01" value="${price}" style="flex:1;" oninput="updateItemPriceToggleDisplay('edit-${itemId}')">
        <button type="button" id="edit-${itemId}-inv-item-price-toggle" class="btn btn-sm btn-outline price-toggle-btn" onclick="toggleItemPriceMode('edit-${itemId}')" title="Zwischen Netto und Brutto umschalten">Netto</button>
      </div>
    </td>
    <td>-</td>
    <td style="white-space:nowrap;">
      <button class="btn btn-sm btn-primary" onclick="saveInvoiceItemEdit(${itemId}, ${invoiceId})">Speichern</button>
      <button class="btn btn-sm btn-secondary" onclick="refreshInvoiceItems(${invoiceId})">Abbrechen</button>
    </td>
  `;
}

async function saveInvoiceItemEdit(itemId, invoiceId) {
  const prefix = `edit-${itemId}`;
  const data = {
    description: document.getElementById(`edit-inv-item-desc-${itemId}`).value.trim(),
    quantity: parseFloat(document.getElementById(`edit-inv-item-qty-${itemId}`).value) || 1,
    unit_price: getItemNettoPrice(prefix, `edit-inv-item-price-${itemId}`),
  };
  delete _itemPriceMode[prefix];
  if (!data.description) { showToast('Bezeichnung ist Pflichtfeld', 'error'); return; }
  try {
    await api(`/api/invoice-items/${itemId}`, { method: 'PUT', body: data });
    showToast('Position aktualisiert');
    refreshInvoiceItems(invoiceId);
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
}

async function deleteInvoiceItem(itemId, invoiceId) {
  if (!confirm('Position wirklich löschen?')) return;
  try {
    await api(`/api/invoice-items/${itemId}`, { method: 'DELETE' });
    showToast('Position gelöscht');
    refreshInvoiceItems(invoiceId);
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
}

async function refreshInvoiceItems(invoiceId) {
  try {
    const inv = await api(`/api/invoices/${invoiceId}`);
    document.getElementById('invoice-items-list').innerHTML = renderInvoiceItemsTable(inv.items, invoiceId, canEditInvoice());
    document.getElementById('invoice-summary').innerHTML = renderInvoiceSummary(inv);
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
}

// ===== Gutschriften (Credit Notes) =====
const CREDIT_STATUSES = ['Entwurf', 'Offen', 'Bezahlt'];

function getCreditStatusBadge(status) {
  const map = { 'Entwurf': 'gray', 'Offen': 'blue', 'Bezahlt': 'green' };
  return `<span class="badge badge-${map[status] || 'gray'}">${escapeHtml(status)}</span>`;
}

let _allCreditNotes = [];

async function renderCreditNotes() {
  const main = document.getElementById('main-content');
  try {
    _allCreditNotes = await api('/api/credit-notes');
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = String(now.getFullYear());
    const defaultDateFilter = mm + '.' + yyyy;

    main.innerHTML = `
      <div class="page-header">
        <h2>Gutschriften</h2>
        <button class="btn btn-primary" onclick="openNewCreditNoteModal()">+ Neue Gutschrift</button>
      </div>
      <div class="card">
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Gutschriftnr.</th>
                <th>Datum</th>
                <th>Kundenname</th>
                <th>Zahlart</th>
                <th>Netto</th>
                <th>Brutto</th>
                <th>Status</th>
                <th>Aktionen</th>
              </tr>
              <tr class="filter-row">
                <td><input type="text" id="cn-filter-nr"       placeholder="Suchen..." oninput="applyCreditFilters()" class="filter-input"></td>
                <td><input type="text" id="cn-filter-date"     placeholder="z.B. 03.2026" value="${defaultDateFilter}" oninput="applyCreditFilters()" class="filter-input"></td>
                <td><input type="text" id="cn-filter-customer" placeholder="Suchen..." oninput="applyCreditFilters()" class="filter-input"></td>
                <td><input type="text" id="cn-filter-zahlart"  placeholder="Suchen..." oninput="applyCreditFilters()" class="filter-input"></td>
                <td></td>
                <td></td>
                <td>
                  <select id="cn-filter-status" onchange="applyCreditFilters()" class="filter-input">
                    <option value="">Alle</option>
                    ${CREDIT_STATUSES.map(s => `<option value="${s}">${s}</option>`).join('')}
                  </select>
                </td>
                <td></td>
              </tr>
            </thead>
            <tbody id="credit-notes-tbody"></tbody>
          </table>
        </div>
      </div>
    `;
    applyCreditFilters();
  } catch (err) {
    main.innerHTML = `<p style="color:var(--danger);">Fehler: ${escapeHtml(err.message)}</p>`;
  }
}

function applyCreditFilters() {
  const nr       = (document.getElementById('cn-filter-nr')?.value       || '').trim().toLowerCase();
  const dateStr  = (document.getElementById('cn-filter-date')?.value     || '').trim();
  const customer = (document.getElementById('cn-filter-customer')?.value || '').trim().toLowerCase();
  const zahlart  = (document.getElementById('cn-filter-zahlart')?.value  || '').trim().toLowerCase();
  const status   = (document.getElementById('cn-filter-status')?.value   || '');

  function matchesDate(creditDate) {
    if (!dateStr) return true;
    if (!creditDate) return false;
    const d = creditDate;
    const parts = dateStr.split('.');
    if (parts.length === 2 && parts[0].length <= 2 && parts[1].length === 4) {
      const mm = parts[0].padStart(2, '0');
      const yyyy = parts[1];
      return d.startsWith(yyyy + '-' + mm);
    }
    return d.includes(dateStr);
  }

  const filtered = _allCreditNotes.filter(cn => {
    if (nr       && !cn.credit_number.toLowerCase().includes(nr))            return false;
    if (!matchesDate(cn.credit_date))                                         return false;
    if (customer && !(cn.customer_name || '').toLowerCase().includes(customer)) return false;
    if (zahlart  && !(cn.payment_method || '').toLowerCase().includes(zahlart)) return false;
    if (status   && cn.status !== status)                                     return false;
    return true;
  });

  const tbody = document.getElementById('credit-notes-tbody');
  if (!tbody) return;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:24px;">Keine Gutschriften gefunden.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(cn => `
    <tr class="clickable" ondblclick="navigate('credit-detail', ${cn.id})">
      <td><strong>${escapeHtml(cn.credit_number)}</strong></td>
      <td>${formatDate(cn.credit_date)}</td>
      <td>${escapeHtml(cn.customer_name || '')}</td>
      <td>${escapeHtml(cn.payment_method || '')}</td>
      <td>${Number(cn.total_net).toFixed(2)} &euro;</td>
      <td>${Number(cn.total_gross).toFixed(2)} &euro;</td>
      <td>${getCreditStatusBadge(cn.status)}</td>
      <td style="white-space:nowrap;">
        <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation(); navigate('credit-detail', ${cn.id})">Öffnen</button>
        <button class="btn btn-sm btn-primary" onclick="event.stopPropagation(); window.open('/api/credit-notes/${cn.id}/pdf','_blank')">PDF</button>
      </td>
    </tr>
  `).join('');
}

// --- New Credit Note Modal ---
let newCreditCustomerId = null;

async function openNewCreditNoteModal() {
  newCreditCustomerId = null;
  const today = new Date().toISOString().split('T')[0];
  let banks = [];
  try { banks = await api('/api/bank-accounts'); } catch(e) {}
  let bankSelect = '';
  if (banks.length > 1) {
    const hasDefault = banks.some(b => b.is_default);
    bankSelect = `
    <div class="form-group">
      <label>Bankverbindung <span style="color:var(--danger);">*</span></label>
      <select id="cn-new-bank-account" required>
        ${hasDefault ? '' : '<option value="">— Bitte wählen —</option>'}
        ${banks.map(b => `<option value="${b.id}" ${b.is_default ? 'selected' : ''}>${escapeHtml(b.label || b.bank_name || 'Konto')} — ${escapeHtml(b.iban)}</option>`).join('')}
      </select>
    </div>`;
  }
  openModal('Neue Gutschrift', `
    <div class="form-group" style="position:relative;">
      <label>Kunde suchen</label>
      <input type="text" id="cn-customer-search" placeholder="Name oder Firma eingeben..." oninput="searchCreditCustomer()" autocomplete="off">
      <div class="search-dropdown" id="cn-customer-dropdown"></div>
    </div>
    <div id="cn-customer-selected" style="display:none;margin-bottom:16px;"></div>
    <div class="form-group">
      <label>Gutschriftsdatum</label>
      <input type="date" id="cn-new-date" value="${today}">
    </div>
    <div class="form-group">
      <label>Zahlart</label>
      <select id="cn-new-payment-method">
        <option value="Überweisung" selected>Überweisung</option>
        <option value="Bar">Bar</option>
      </select>
    </div>
    ${bankSelect}
    <div class="form-group">
      <label>Bemerkungen</label>
      <textarea id="cn-new-notes" rows="2" placeholder="Optionale Hinweise..."></textarea>
    </div>
    <div class="form-actions">
      <button class="btn btn-primary" onclick="createCreditNote()">Gutschrift erstellen</button>
      <button class="btn btn-secondary" onclick="closeModal()">Abbrechen</button>
    </div>
  `);
}

async function searchCreditCustomer() {
  const term = document.getElementById('cn-customer-search').value.trim();
  const dropdown = document.getElementById('cn-customer-dropdown');
  if (term.length < 2) { dropdown.style.display = 'none'; return; }
  try {
    const customers = await api(`/api/customers?search=${encodeURIComponent(term)}`);
    if (customers.length === 0) {
      dropdown.innerHTML = '<div class="search-dropdown-item" style="color:var(--text-muted);">Keine Kunden gefunden</div>';
    } else {
      dropdown.innerHTML = customers.slice(0, 10).map(c => {
        const name = (c.customer_type === 'Firmenkunde' || c.customer_type === 'Werkstatt') ? c.company_name : `${c.last_name}, ${c.first_name}`;
        const sub = c.city ? ` — ${c.city}` : '';
        return `<div class="search-dropdown-item" onclick="selectCreditCustomer(${c.id}, '${escapeHtml(name)}${escapeHtml(sub)}')">${escapeHtml(name)}${escapeHtml(sub)}</div>`;
      }).join('');
    }
    dropdown.style.display = 'block';
  } catch (err) {
    dropdown.style.display = 'none';
  }
}

function selectCreditCustomer(id, displayName) {
  newCreditCustomerId = id;
  document.getElementById('cn-customer-dropdown').style.display = 'none';
  document.getElementById('cn-customer-search').style.display = 'none';
  document.getElementById('cn-customer-selected').style.display = '';
  document.getElementById('cn-customer-selected').innerHTML = `
    <div class="search-selected">
      <span>${displayName}</span>
      <button class="btn btn-sm btn-secondary" onclick="clearCreditCustomer()">Ändern</button>
    </div>
  `;
}

function clearCreditCustomer() {
  newCreditCustomerId = null;
  document.getElementById('cn-customer-selected').style.display = 'none';
  const searchInput = document.getElementById('cn-customer-search');
  searchInput.style.display = '';
  searchInput.value = '';
  searchInput.focus();
}

async function createCreditNote() {
  if (!newCreditCustomerId) { showToast('Bitte einen Kunden auswählen', 'error'); return; }
  const date = document.getElementById('cn-new-date').value;
  if (!date) { showToast('Gutschriftsdatum ist Pflichtfeld', 'error'); return; }
  const paymentMethod = document.getElementById('cn-new-payment-method').value;
  const notes = document.getElementById('cn-new-notes').value.trim();
  const bankEl = document.getElementById('cn-new-bank-account');
  const bank_account_id = bankEl ? Number(bankEl.value) || null : null;
  if (bankEl && !bank_account_id) { showToast('Bitte eine Bankverbindung auswählen', 'error'); return; }
  try {
    const result = await api('/api/credit-notes', { method: 'POST', body: { customer_id: newCreditCustomerId, credit_date: date, payment_method: paymentMethod, notes, bank_account_id } });
    closeModal();
    showToast(`Gutschrift ${result.credit_number} erstellt`);
    navigate('credit-detail', result.id);
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
}

// --- Credit Note Detail Page ---
async function renderCreditNoteDetail(id) {
  const main = document.getElementById('main-content');
  try {
    const cn = await api(`/api/credit-notes/${id}`);
    const canEdit = canEditInvoice();
    const customerName = (cn.customer_type === 'Firmenkunde' || cn.customer_type === 'Werkstatt')
      ? escapeHtml(cn.company_name)
      : escapeHtml(cn.last_name) + ', ' + escapeHtml(cn.first_name);

    main.innerHTML = `
      <a class="back-link" onclick="navigate('gutschriften')">&#8592; Zurück zur Liste</a>
      <div class="page-header">
        <h2>Gutschrift ${escapeHtml(cn.credit_number)}</h2>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-primary" onclick="window.open('/api/credit-notes/${id}/pdf','_blank')">PDF anzeigen</button>
          ${isAdmin() ? `<button class="btn btn-danger" onclick="deleteCreditNote(${id})">Löschen</button>` : ''}
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h3>Kundendaten</h3></div>
        <div class="customer-info-grid">
          <div class="info-item"><div class="info-label">Kunde</div><div class="info-value">${customerName}</div></div>
          <div class="info-item"><div class="info-label">Adresse</div><div class="info-value">${escapeHtml(cn.street)}<br>${escapeHtml(cn.zip)} ${escapeHtml(cn.city)}</div></div>
          <div class="info-item"><div class="info-label">Telefon</div><div class="info-value">${escapeHtml(cn.phone)}</div></div>
          <div class="info-item"><div class="info-label">E-Mail</div><div class="info-value">${escapeHtml(cn.email)}</div></div>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h3>Gutschriftsdaten</h3></div>
        <div class="form-row">
          <div class="form-group">
            <label>Gutschriftnummer</label>
            <div class="form-control-static">${escapeHtml(cn.credit_number)}</div>
          </div>
          <div class="form-group">
            <label>Datum</label>
            <div class="form-control-static">${formatDate(cn.credit_date)}</div>
          </div>
        </div>
        <div class="form-group">
          <label>Status</label>
          ${canEdit
            ? `<select id="cn-edit-status" onchange="saveCreditHeader(${id})">
                 ${CREDIT_STATUSES.map(s => `<option value="${s}" ${s === cn.status ? 'selected' : ''}>${s}</option>`).join('')}
               </select>`
            : `<div class="form-control-static">${getCreditStatusBadge(cn.status)}</div>`}
        </div>
        <div class="form-group">
          <label>Zahlart</label>
          ${canEdit
            ? `<select id="cn-edit-payment-method" onchange="saveCreditHeader(${id})">
                 ${ ['Überweisung','Bar'].map(m =>
                     `<option value="${m}" ${(cn.payment_method||'Überweisung')===m?'selected':''}>${m}</option>`
                   ).join('') }
               </select>`
            : `<div class="form-control-static">${escapeHtml(cn.payment_method || 'Überweisung')}</div>`}
        </div>
        <div class="form-group">
          <label>Bemerkungen</label>
          ${canEdit
            ? `<textarea id="cn-edit-notes" rows="2" onchange="saveCreditHeader(${id})">${escapeHtml(cn.notes || '')}</textarea>`
            : `<div class="form-control-static" style="min-height:60px;">${escapeHtml(cn.notes || '—')}</div>`}
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>Positionen</h3>
          ${canEdit ? `<button class="btn btn-sm btn-primary" onclick="addCreditItemRow(${id})">+ Position</button>` : ''}
        </div>
        <div id="credit-items-list">
          ${renderCreditItemsTable(cn.items, id, canEdit)}
        </div>
        <div class="invoice-summary" id="credit-summary">
          ${renderCreditSummary(cn)}
        </div>
      </div>
    `;
  } catch (err) {
    main.innerHTML = `<p style="color:var(--danger);">Fehler: ${escapeHtml(err.message)}</p>`;
  }
}

function renderCreditItemsTable(items, creditId, canEdit) {
  if (items.length === 0) return '<p style="color:var(--text-muted);font-size:13px;">Noch keine Positionen vorhanden.</p>';
  let html = `<table class="invoice-items-table">
    <thead><tr>
      <th style="width:40px;">Pos</th><th>Bezeichnung</th><th style="width:80px;">Menge</th><th style="width:100px;">Einzelpreis</th><th style="width:100px;">Gesamt</th>${canEdit ? '<th style="width:140px;">Aktionen</th>' : ''}
    </tr></thead><tbody>`;
  items.forEach(item => {
    html += `<tr id="cn-item-row-${item.id}">
      <td>${item.position}</td>
      <td>${escapeHtml(item.description)}</td>
      <td>${Number(item.quantity) % 1 === 0 ? Number(item.quantity) : Number(item.quantity).toFixed(2)}</td>
      <td>${Number(item.unit_price).toFixed(2)} &euro;</td>
      <td>${Number(item.total_net).toFixed(2)} &euro;</td>
      ${canEdit ? `<td style="white-space:nowrap;">
        <button class="btn btn-sm btn-secondary" onclick="editCreditItemRow(${item.id}, ${creditId})">Bearbeiten</button>
        ${isAdmin() ? `<button class="btn btn-sm btn-danger" onclick="deleteCreditItem(${item.id}, ${creditId})">Löschen</button>` : ''}
      </td>` : '<td></td>'}
    </tr>`;
  });
  html += '</tbody></table>';
  return html;
}

function renderCreditSummary(cn) {
  return `<table>
    <tr><td style="text-align:right;">Netto:</td><td style="text-align:right;width:100px;"><strong>${Number(cn.total_net).toFixed(2)} &euro;</strong></td></tr>
    <tr><td style="text-align:right;">zzgl. 19% MwSt:</td><td style="text-align:right;">${Number(cn.total_vat).toFixed(2)} &euro;</td></tr>
    <tr class="total-row"><td style="text-align:right;">Brutto:</td><td style="text-align:right;">${Number(cn.total_gross).toFixed(2)} &euro;</td></tr>
  </table>`;
}

async function saveCreditHeader(creditId) {
  if (!canEditInvoice()) { showToast('Keine Berechtigung', 'error'); return; }
  const data = {
    status: document.getElementById('cn-edit-status').value,
    payment_method: document.getElementById('cn-edit-payment-method').value,
    notes: document.getElementById('cn-edit-notes').value.trim(),
  };
  try {
    await api(`/api/credit-notes/${creditId}`, { method: 'PUT', body: data });
    showToast('Gutschrift aktualisiert');
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
}

async function deleteCreditNote(creditId) {
  if (!confirm('Gutschrift wirklich löschen?')) return;
  try {
    await api(`/api/credit-notes/${creditId}`, { method: 'DELETE' });
    showToast('Gutschrift gelöscht');
    navigate('gutschriften');
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
}

// --- Inline Credit Note Items ---
function addCreditItemRow(creditId) {
  if (!canEditInvoice()) return;
  const container = document.getElementById('credit-items-list');
  const noMsg = container.querySelector('p');
  if (noMsg) noMsg.remove();

  let table = container.querySelector('table');
  if (!table) {
    container.innerHTML = `<table class="invoice-items-table">
      <thead><tr>
        <th style="width:40px;">Pos</th><th>Bezeichnung</th><th style="width:80px;">Menge</th><th style="width:100px;">Einzelpreis</th><th style="width:100px;">Gesamt</th><th style="width:140px;">Aktionen</th>
      </tr></thead><tbody></tbody></table>`;
    table = container.querySelector('table');
  }
  const tbody = table.querySelector('tbody');
  if (document.getElementById('cn-item-row-new')) return;
  const tr = document.createElement('tr');
  tr.id = 'cn-item-row-new';
  tr.innerHTML = `
    <td>-</td>
    <td><input type="text" id="new-cn-item-desc" placeholder="Bezeichnung"></td>
    <td><input type="number" id="new-cn-item-qty" step="0.01" value="1" min="0.01"></td>
    <td>
      <div style="display:flex;align-items:center;gap:4px;">
        <input type="number" id="new-cn-item-price" step="0.01" placeholder="0.00" style="flex:1;">
        <button type="button" id="new-cn-price-toggle" class="btn btn-sm btn-outline price-toggle-btn" onclick="toggleCnPriceMode('new')" title="Zwischen Netto und Brutto umschalten">Netto</button>
      </div>
    </td>
    <td>-</td>
    <td style="white-space:nowrap;">
      <button class="btn btn-sm btn-primary" onclick="saveCreditItemNew(${creditId})">Speichern</button>
      <button class="btn btn-sm btn-secondary" onclick="this.closest('tr').remove()">Abbrechen</button>
    </td>
  `;
  tbody.appendChild(tr);
  tr.querySelector('#new-cn-item-desc').focus();
}

const _cnPriceMode = {};
function toggleCnPriceMode(prefix) {
  const btn = document.getElementById(`${prefix}-cn-price-toggle`);
  if (!btn) return;
  const current = _cnPriceMode[prefix] || 'netto';
  const next = current === 'netto' ? 'brutto' : 'netto';
  _cnPriceMode[prefix] = next;
  btn.textContent = next === 'netto' ? 'Netto' : 'Brutto';
  btn.classList.toggle('price-toggle-brutto', next === 'brutto');
}

function getCnNettoPrice(prefix, inputId) {
  const raw = parseFloat(document.getElementById(inputId).value) || 0;
  const mode = _cnPriceMode[prefix] || 'netto';
  if (mode === 'brutto') return Math.round((raw / 1.19) * 100) / 100;
  return raw;
}

async function saveCreditItemNew(creditId) {
  const data = {
    description: document.getElementById('new-cn-item-desc').value.trim(),
    quantity: parseFloat(document.getElementById('new-cn-item-qty').value) || 1,
    unit_price: getCnNettoPrice('new', 'new-cn-item-price'),
  };
  delete _cnPriceMode['new'];
  if (!data.description) { showToast('Bezeichnung ist Pflichtfeld', 'error'); return; }
  try {
    await api(`/api/credit-notes/${creditId}/items`, { method: 'POST', body: data });
    showToast('Position hinzugefügt');
    refreshCreditItems(creditId);
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
}

function editCreditItemRow(itemId, creditId) {
  const row = document.getElementById(`cn-item-row-${itemId}`);
  if (!row) return;
  const cells = row.querySelectorAll('td');
  const desc = cells[1].textContent.trim();
  const qty = cells[2].textContent.trim();
  const price = cells[3].textContent.replace('€', '').trim();
  row.innerHTML = `
    <td>${cells[0].textContent}</td>
    <td><input type="text" id="edit-cn-item-desc-${itemId}" value="${escapeHtml(desc)}"></td>
    <td><input type="number" id="edit-cn-item-qty-${itemId}" step="0.01" value="${qty}" min="0.01"></td>
    <td>
      <div style="display:flex;align-items:center;gap:4px;">
        <input type="number" id="edit-cn-item-price-${itemId}" step="0.01" value="${price}" style="flex:1;">
        <button type="button" id="edit-${itemId}-cn-price-toggle" class="btn btn-sm btn-outline price-toggle-btn" onclick="toggleCnPriceMode('edit-${itemId}')" title="Zwischen Netto und Brutto umschalten">Netto</button>
      </div>
    </td>
    <td>-</td>
    <td style="white-space:nowrap;">
      <button class="btn btn-sm btn-primary" onclick="saveCreditItemEdit(${itemId}, ${creditId})">Speichern</button>
      <button class="btn btn-sm btn-secondary" onclick="refreshCreditItems(${creditId})">Abbrechen</button>
    </td>
  `;
}

async function saveCreditItemEdit(itemId, creditId) {
  const prefix = `edit-${itemId}`;
  const data = {
    description: document.getElementById(`edit-cn-item-desc-${itemId}`).value.trim(),
    quantity: parseFloat(document.getElementById(`edit-cn-item-qty-${itemId}`).value) || 1,
    unit_price: getCnNettoPrice(prefix, `edit-cn-item-price-${itemId}`),
  };
  delete _cnPriceMode[prefix];
  if (!data.description) { showToast('Bezeichnung ist Pflichtfeld', 'error'); return; }
  try {
    await api(`/api/credit-note-items/${itemId}`, { method: 'PUT', body: data });
    showToast('Position aktualisiert');
    refreshCreditItems(creditId);
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
}

async function deleteCreditItem(itemId, creditId) {
  if (!confirm('Position wirklich löschen?')) return;
  try {
    await api(`/api/credit-note-items/${itemId}`, { method: 'DELETE' });
    showToast('Position gelöscht');
    refreshCreditItems(creditId);
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
}

async function refreshCreditItems(creditId) {
  try {
    const cn = await api(`/api/credit-notes/${creditId}`);
    document.getElementById('credit-items-list').innerHTML = renderCreditItemsTable(cn.items, creditId, canEditInvoice());
    document.getElementById('credit-summary').innerHTML = renderCreditSummary(cn);
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
}

// ===== Login =====
async function initLogin() {
  const usernameEl = document.getElementById('login-username');
  if (usernameEl) usernameEl.focus();
}

async function doLogin(e) {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');

  if (!username) {
    errorEl.textContent = 'Bitte Benutzername eingeben';
    errorEl.style.display = '';
    return;
  }

  try {
    const user = await api('/api/login', { method: 'POST', body: { username, password } });
    loggedInUser = user;
    if (user.needs_password) {
      showForcePasswordScreen();
      return;
    }
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-container').style.display = '';
    await initApp();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = '';
  }
}

function doLogout() {
  loggedInUser = null;
  document.getElementById('app-container').style.display = 'none';
  document.getElementById('login-screen').style.display = '';
  document.getElementById('login-username').value = '';
  document.getElementById('login-password').value = '';
  document.getElementById('login-error').style.display = 'none';
}

let appInitialized = false;

// Auto-reload on new version
let _appVersion = null;
let _updateModalShown = false;
async function checkVersion() {
  try {
    const { version } = await api('/api/version');
    if (_appVersion && _appVersion !== version && !_updateModalShown) {
      _updateModalShown = true;
      showUpdateModal();
    }
    if (!_appVersion) _appVersion = version;
  } catch (e) { /* offline or restarting */ }
}

function showUpdateModal() {
  const existing = document.getElementById('update-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'update-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:99999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);';

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:16px;padding:36px 40px;max-width:420px;width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.3);position:relative;">
      <button onclick="document.getElementById('update-overlay').remove()" style="
        position:absolute;top:12px;right:16px;background:none;border:none;font-size:22px;
        color:#999;cursor:pointer;line-height:1;
      ">&times;</button>
      <div style="font-size:48px;margin-bottom:12px;">&#128260;</div>
      <h2 style="margin:0 0 10px;font-size:20px;color:#1a1a2e;">Neue Version verfügbar</h2>
      <p style="margin:0 0 24px;color:#555;font-size:14px;line-height:1.5;">
        Es wurde ein Update eingespielt. Bitte laden Sie die Seite bei Gelegenheit neu, um mit der aktuellen Version weiterzuarbeiten.
      </p>
      <div style="display:flex;gap:10px;justify-content:center;">
        <button onclick="document.getElementById('update-overlay').remove()" style="
          background:#f1f5f9;color:#475569;border:none;padding:10px 24px;border-radius:8px;
          font-size:14px;cursor:pointer;
        ">Später</button>
        <button onclick="location.reload()" style="
          background:#2563eb;color:#fff;border:none;padding:10px 24px;border-radius:8px;
          font-size:14px;font-weight:600;cursor:pointer;
        ">Jetzt neu laden</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
}

async function initApp() {
  // Load stations from DB
  await loadStations();

  // Start version polling
  checkVersion();
  setInterval(checkVersion, 30000);

  // Bind event listeners only once (prevent duplicates on re-login)
  if (!appInitialized) {
    appInitialized = true;

    // Navigation click handler
    document.querySelectorAll('.nav-link').forEach(link => {
      if (link.classList.contains('nav-submenu-toggle')) return;
      link.addEventListener('click', e => {
        e.preventDefault();
        navigate(link.dataset.page);
      });
    });

    // Modal close handlers
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal-overlay').addEventListener('click', e => {
      if (e.target === e.currentTarget) closeModal();
    });

    // Escape key closes modal
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeModal();
    });

    // Submenu toggle
    document.querySelectorAll('.nav-submenu-toggle').forEach(toggle => {
      toggle.addEventListener('click', e => {
        e.preventDefault();
        toggle.closest('.nav-item-has-submenu').classList.toggle('open');
        if (toggle.dataset.page) navigate(toggle.dataset.page);
      });
    });
  }

  // Show logged-in user in sidebar
  if (loggedInUser) {
    const userEl = document.getElementById('sidebar-user');
    if (userEl) userEl.textContent = loggedInUser.name;
  }

  // Show/hide permission-based nav items
  document.getElementById('nav-staff').style.display = isVerwaltung() ? '' : 'none';
  document.getElementById('nav-settings').style.display = isAdmin() ? '' : 'none';
  document.getElementById('nav-buchhaltung').style.display = '';

  // Load unread badges
  updateUnreadBadges();

  // Check for unacknowledged changelog
  checkChangelogPopup();

  // Load dashboard
  navigate('dashboard');
}

// ===== CHANGELOG (Programmversion) =====

async function checkChangelogPopup() {
  try {
    const entry = await api('/api/changelog/unacknowledged');
    if (!entry) return;
    const html = `
      <div style="margin-bottom:16px;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
          <span style="font-size:28px;font-weight:700;color:var(--primary);">Version ${escapeHtml(entry.version)}</span>
          <span style="color:var(--text-muted);">${formatDate(entry.release_date)}</span>
        </div>
        <div class="changelog-description" style="font-size:14px;line-height:1.7;max-height:400px;overflow-y:auto;padding:16px;background:var(--bg);border-radius:8px;border:1px solid var(--border);">
          ${entry.description ? sanitizeHtml(entry.description) : '<span style="color:var(--text-muted)">Keine Beschreibung</span>'}
        </div>
      </div>
      <div class="form-actions" style="justify-content:center;">
        <button class="btn btn-primary" onclick="acknowledgeChangelog(${entry.id})" style="min-width:200px;">Gelesen und verstanden</button>
      </div>
    `;
    openModal('Neue Programmversion verfügbar', html);
  } catch (e) { /* silent */ }
}

async function acknowledgeChangelog(id) {
  try {
    await api(`/api/changelog/${id}/acknowledge`, { method: 'POST' });
    closeModal();
    // Nächste unbestätigte Version anzeigen (falls vorhanden)
    checkChangelogPopup();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function renderChangelog() {
  const main = document.getElementById('main-content');
  try {
    const entries = await api('/api/changelog');
    const currentVersion = entries.length > 0 ? entries[0].version : '-';
    let html = `
      <div class="page-header">
        <h2>Programmversion</h2>
        ${isAdmin() ? '<button class="btn btn-primary" onclick="openChangelogForm()">Neue Version</button>' : ''}
      </div>
      <div class="card" style="margin-bottom:20px;">
        <div style="padding:16px;font-size:15px;">
          <strong>Aktuelle Version:</strong> <span style="font-size:18px;font-weight:700;color:var(--primary);">${escapeHtml(currentVersion)}</span>
        </div>
      </div>`;

    if (entries.length === 0) {
      html += '<div class="empty-state"><p>Noch keine Versionen vorhanden.</p></div>';
    } else {
      entries.forEach(e => {
        html += `<div class="card" style="margin-bottom:12px;">
          <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;">
            <div>
              <strong style="font-size:16px;">Version ${escapeHtml(e.version)}</strong>
              <span style="color:var(--text-muted);margin-left:12px;">${formatDate(e.release_date)}</span>
            </div>
            ${isAdmin() ? `<div style="display:flex;gap:6px;">
              <button class="btn btn-sm btn-secondary" onclick="openChangelogForm(${e.id})">Bearbeiten</button>
              <button class="btn btn-sm btn-danger" onclick="deleteChangelog(${e.id})">Löschen</button>
            </div>` : ''}
          </div>
          <div class="changelog-description" style="padding:12px 16px;font-size:14px;line-height:1.6;">${e.description ? sanitizeHtml(e.description) : '<span style="color:var(--text-muted)">Keine Beschreibung</span>'}</div>
        </div>`;
      });
    }
    main.innerHTML = html;
  } catch (err) {
    main.innerHTML = `<div class="empty-state"><p>Fehler: ${escapeHtml(err.message)}</p></div>`;
  }
}

async function openChangelogForm(id) {
  let entry = { version: '', release_date: new Date().toISOString().slice(0, 10), description: '' };
  if (id) {
    try {
      const entries = await api('/api/changelog');
      const found = entries.find(e => e.id === id);
      if (found) entry = found;
    } catch (err) {
      showToast('Fehler beim Laden', 'error');
      return;
    }
  }
  const title = id ? 'Version bearbeiten' : 'Neue Version';
  const html = `
    <form onsubmit="saveChangelog(event, ${id || 'null'})">
      <div class="form-row">
        <div class="form-group">
          <label>Version *</label>
          <input type="text" name="version" value="${escapeHtml(entry.version)}" placeholder="z.B. 1.2.0" required>
        </div>
        <div class="form-group">
          <label>Datum *</label>
          <input type="date" name="release_date" value="${entry.release_date || ''}" required>
        </div>
      </div>
      <div class="form-group">
        <label>Änderungen</label>
        <div class="richtext-editor">
          <div class="richtext-toolbar">
            <button type="button" onclick="rtCmd('bold')" title="Fett"><b>F</b></button>
            <button type="button" onclick="rtCmd('italic')" title="Kursiv"><i>K</i></button>
            <button type="button" onclick="rtCmd('underline')" title="Unterstrichen"><u>U</u></button>
            <div class="separator"></div>
            <button type="button" onclick="rtCmd('insertUnorderedList')" title="Aufzählung">&#8226; Liste</button>
            <button type="button" onclick="rtCmd('insertOrderedList')" title="Nummerierung">1. Liste</button>
            <div class="separator"></div>
            <button type="button" onclick="rtCmd('removeFormat')" title="Formatierung entfernen">&#10005; Format</button>
          </div>
          <div class="richtext-content" id="changelog-editor" contenteditable="true" data-placeholder="Was wurde geändert?">${entry.description || ''}</div>
        </div>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">${id ? 'Speichern' : 'Anlegen'}</button>
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Abbrechen</button>
      </div>
    </form>`;
  openModal(title, html);
}

function rtCmd(command) {
  document.execCommand(command, false, null);
  document.getElementById('changelog-editor').focus();
}

async function saveChangelog(e, id) {
  e.preventDefault();
  const form = e.target;
  const editor = document.getElementById('changelog-editor');
  const data = {
    version: form.version.value.trim(),
    release_date: form.release_date.value,
    description: sanitizeHtml(editor.innerHTML.trim()),
  };
  try {
    if (id) {
      await api(`/api/changelog/${id}`, { method: 'PUT', body: data });
      showToast('Version aktualisiert');
    } else {
      await api('/api/changelog', { method: 'POST', body: data });
      showToast('Version erstellt');
    }
    closeModal();
    renderChangelog();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteChangelog(id) {
  if (!confirm('Version wirklich löschen?')) return;
  try {
    await api(`/api/changelog/${id}`, { method: 'DELETE' });
    showToast('Version gelöscht');
    renderChangelog();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ===== FUHRPARK (Fleet Management) =====

function getFleetWarnings(v) {
  const warnings = [];
  const today = new Date().toISOString().slice(0, 10);
  const currentMonth = today.slice(0, 7);
  // TÜV fällig
  if (v.next_tuev_date && v.next_tuev_date <= currentMonth) {
    warnings.push('tuev');
  }
  // Wartung nach Datum fällig
  if (v.next_maintenance_date && v.next_maintenance_date <= today) {
    warnings.push('maint_date');
  }
  // Wartung nach KM fällig
  const km = Number(v.latest_km) || 0;
  const maintKm = Number(v.next_maintenance_km) || 0;
  if (maintKm > 0 && km >= maintKm) {
    warnings.push('maint_km');
  }
  return warnings;
}

function fleetWarningBadges(warnings) {
  let html = '';
  if (warnings.includes('tuev')) html += ' <span style="background:#e74c3c;color:#fff;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:600;">TÜV fällig</span>';
  if (warnings.includes('maint_date')) html += ' <span style="background:#e67e22;color:#fff;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:600;">Wartung fällig</span>';
  if (warnings.includes('maint_km')) html += ' <span style="background:#e67e22;color:#fff;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:600;">Wartung (KM)</span>';
  return html;
}

async function renderFuhrpark() {
  const main = document.getElementById('main-content');
  try {
    const vehicles = await api('/api/fleet-vehicles');
    const kurzzeit = vehicles.filter(v => v.rental_type !== 'lang');
    const langzeit = vehicles.filter(v => v.rental_type === 'lang');

    let html = `
      <div class="page-header">
        <h2>Fuhrpark</h2>
        ${isVerwaltung() ? '<button class="btn btn-primary" onclick="openFleetVehicleForm()">Neues Fahrzeug</button>' : ''}
      </div>`;

    // Kurzzeit-Tabelle
    html += '<div class="card"><div class="card-header"><h3>Kurzzeitvermietung</h3></div>';
    if (kurzzeit.length === 0) {
      html += '<div class="empty-state"><p>Keine Kurzzeit-Fahrzeuge vorhanden.</p></div>';
    } else {
      html += '<table class="data-table"><thead><tr>';
      html += '<th>Kennzeichen</th><th>Hersteller</th><th>Modell</th><th>Typ</th><th>KM-Stand</th><th>Nächster TÜV</th><th>Nächste Wartung</th><th>Status</th><th>Aktionen</th>';
      html += '</tr></thead><tbody>';
      kurzzeit.forEach(v => {
        const warnings = getFleetWarnings(v);
        const rowStyle = warnings.length > 0 ? 'background:rgba(231,76,60,0.08);' : '';
        const maintInfo = [];
        if (v.next_maintenance_date) maintInfo.push(formatDate(v.next_maintenance_date));
        if (v.next_maintenance_km && Number(v.next_maintenance_km) > 0) maintInfo.push(Number(v.next_maintenance_km).toLocaleString('de-DE') + ' km');
        html += `<tr style="cursor:pointer;${rowStyle}" onclick="navigate('fuhrpark-detail', ${v.id})">
          <td><strong>${escapeHtml(v.license_plate || '-')}</strong></td>
          <td>${escapeHtml(v.manufacturer)}</td>
          <td>${escapeHtml(v.model)}</td>
          <td>${escapeHtml(v.vehicle_type || '-')}</td>
          <td>${v.latest_km ? Number(v.latest_km).toLocaleString('de-DE') + ' km' : '-'}</td>
          <td>${formatDate(v.next_tuev_date)}</td>
          <td>${maintInfo.length > 0 ? maintInfo.join(' / ') : '-'}</td>
          <td>${fleetWarningBadges(warnings) || '<span style="color:var(--text-muted);font-size:12px;">OK</span>'}</td>
          <td onclick="event.stopPropagation();">
            <button class="btn btn-sm btn-secondary" onclick="openFleetKmUpdate(${v.id}, ${v.latest_km || 0})">KM</button>
            ${isAdmin() ? `<button class="btn btn-sm btn-danger" onclick="deleteFleetVehicle(${v.id})">Löschen</button>` : ''}
          </td>
        </tr>`;
      });
      html += '</tbody></table>';
    }
    html += '</div>';

    // Langzeit-Tabelle
    html += '<div class="card" style="margin-top:20px;"><div class="card-header"><h3>Langzeitvermietung</h3></div>';
    if (langzeit.length === 0) {
      html += '<div class="empty-state"><p>Keine Langzeit-Fahrzeuge vorhanden.</p></div>';
    } else {
      html += '<table class="data-table"><thead><tr>';
      html += '<th>Kennzeichen</th><th>Hersteller</th><th>Modell</th><th>Typ</th><th>Zugewiesen an</th><th>KM-Stand</th><th>Nächster TÜV</th><th>Status</th><th>Aktionen</th>';
      html += '</tr></thead><tbody>';
      langzeit.forEach(v => {
        const warnings = getFleetWarnings(v);
        const rowStyle = warnings.length > 0 ? 'background:rgba(231,76,60,0.08);' : '';
        html += `<tr style="cursor:pointer;${rowStyle}" onclick="navigate('fuhrpark-detail', ${v.id})">
          <td><strong>${escapeHtml(v.license_plate || '-')}</strong></td>
          <td>${escapeHtml(v.manufacturer)}</td>
          <td>${escapeHtml(v.model)}</td>
          <td>${escapeHtml(v.vehicle_type || '-')}</td>
          <td><strong>${escapeHtml(v.assigned_customer_name || '-')}</strong></td>
          <td>${v.latest_km ? Number(v.latest_km).toLocaleString('de-DE') + ' km' : '-'}</td>
          <td>${formatDate(v.next_tuev_date)}</td>
          <td>${fleetWarningBadges(warnings) || '<span style="color:var(--text-muted);font-size:12px;">OK</span>'}</td>
          <td onclick="event.stopPropagation();">
            <button class="btn btn-sm btn-secondary" onclick="openFleetKmUpdate(${v.id}, ${v.latest_km || 0})">KM</button>
            ${isAdmin() ? `<button class="btn btn-sm btn-danger" onclick="deleteFleetVehicle(${v.id})">Löschen</button>` : ''}
          </td>
        </tr>`;
      });
      html += '</tbody></table>';
    }
    html += '</div>';

    main.innerHTML = html;
  } catch (err) {
    main.innerHTML = `<div class="empty-state"><p>Fehler: ${escapeHtml(err.message)}</p></div>`;
  }
}

async function renderFuhrparkDetail(id) {
  const main = document.getElementById('main-content');
  try {
    const data = await api(`/api/fleet-vehicles/${id}`);
    let html = `
      <div class="page-header">
        <h2>${escapeHtml(data.manufacturer)} ${escapeHtml(data.model)} ${data.license_plate ? '(' + escapeHtml(data.license_plate) + ')' : ''}</h2>
        <div>
          <button class="btn btn-secondary" onclick="navigate('fuhrpark')">Zurück</button>
          <button class="btn btn-primary" onclick="openFleetKmUpdate(${data.id}, ${data.latest_km || 0})">KM aktualisieren</button>
          ${isVerwaltung() ? `<button class="btn btn-secondary" onclick="openFleetVehicleForm(${data.id})">Bearbeiten</button>` : ''}
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h3>Fahrzeugdaten</h3></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 24px;padding:16px;">
          <div><strong>Hersteller:</strong> ${escapeHtml(data.manufacturer)}</div>
          <div><strong>Modell:</strong> ${escapeHtml(data.model)}</div>
          <div><strong>Typ:</strong> ${escapeHtml(data.vehicle_type || '-')}</div>
          <div><strong>Kennzeichen:</strong> ${escapeHtml(data.license_plate || '-')}</div>
          <div><strong>FIN:</strong> ${escapeHtml(data.vin || '-')}</div>
          <div><strong>Erstzulassung:</strong> ${formatDate(data.first_registration)}</div>
          <div><strong>Nächster TÜV:</strong> ${formatDate(data.next_tuev_date)}</div>
          <div><strong>Mietart:</strong> ${data.rental_type === 'lang' ? '<span class="badge badge-yellow">Langzeit</span>' : '<span class="badge badge-green">Kurzzeit</span>'}</div>
          ${data.rental_type === 'lang' && data.assigned_customer_name ? '<div><strong>Zugewiesen an:</strong> ' + escapeHtml(data.assigned_customer_name) + (data.assigned_contact_person ? ' (Fahrer: ' + escapeHtml(data.assigned_contact_person) + ')' : '') + '</div>' : ''}
          <div><strong>Notizen:</strong> ${escapeHtml(data.notes || '-')}</div>
          ${(() => { const w = getFleetWarnings(data); return w.length > 0 ? '<div style="grid-column:1/-1;margin-top:4px;">' + fleetWarningBadges(w) + '</div>' : ''; })()}
        </div>
      </div>

      <div class="card" style="margin-top:20px;">
        <div class="card-header">
          <h3>Wartungshistorie</h3>
          ${isVerwaltung() ? `<button class="btn btn-sm btn-primary" onclick="openFleetMaintenanceForm(${data.id})">+ Wartung</button>` : ''}
        </div>
        <div id="fleet-maint-list">${renderFleetMaintenanceTable(data.maintenance || [], data.id)}</div>
      </div>

      <div class="card" style="margin-top:20px;">
        <div class="card-header"><h3>KM-Historie</h3></div>
        <div id="fleet-mileage-list">${renderFleetMileageTable(data.mileage || [])}</div>
      </div>`;

    main.innerHTML = html;
  } catch (err) {
    main.innerHTML = `<div class="empty-state"><p>Fehler: ${escapeHtml(err.message)}</p></div>`;
  }
}

async function openFleetVehicleForm(id) {
  let vehicle = { manufacturer: '', model: '', vehicle_type: '', vin: '', license_plate: '', first_registration: '', next_tuev_date: '', notes: '', rental_type: 'kurz', assigned_customer_id: null, assigned_customer_name: '', assigned_contact_person: '' };
  let staffList = [];

  try {
    staffList = (await api('/api/staff')).filter(s => s.active);
  } catch (e) {}

  if (id) {
    try {
      const data = await api(`/api/fleet-vehicles/${id}`);
      vehicle = data;
    } catch (err) {
      showToast('Fehler beim Laden', 'error');
      return;
    }
  }

  const title = id ? 'Fahrzeug bearbeiten' : 'Neues Fahrzeug';
  const html = `
    <form id="fleet-vehicle-form" onsubmit="saveFleetVehicle(event, ${id || 'null'})">
      ${!id ? `<div style="margin-bottom:16px;">
        <button type="button" class="btn btn-secondary" onclick="openFleetScan()">Fahrzeugschein scannen</button>
      </div>` : ''}
      <div class="form-row">
        <div class="form-group">
          <label>Hersteller *</label>
          <input type="text" name="manufacturer" value="${escapeHtml(vehicle.manufacturer)}" required>
        </div>
        <div class="form-group">
          <label>Modell *</label>
          <input type="text" name="model" value="${escapeHtml(vehicle.model)}" required>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Fahrzeugtyp</label>
          <select name="vehicle_type">
            <option value="">-- Auswählen --</option>
            ${VEHICLE_TYPES.map(t => `<option value="${t}" ${vehicle.vehicle_type === t ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Kennzeichen</label>
          <input type="text" name="license_plate" value="${escapeHtml(vehicle.license_plate)}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>FIN (Fahrgestellnummer)</label>
          <input type="text" name="vin" value="${escapeHtml(vehicle.vin)}">
        </div>
        <div class="form-group">
          <label>Erstzulassung</label>
          <input type="date" name="first_registration" value="${vehicle.first_registration || ''}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Nächster TÜV</label>
          <input type="month" name="next_tuev_date" value="${vehicle.next_tuev_date || ''}">
        </div>
        <div class="form-group">
          <label>Mietart</label>
          <select name="rental_type" onchange="document.getElementById('fleet-assigned-to-group').style.display=this.value==='lang'?'':'none';">
            <option value="kurz" ${vehicle.rental_type !== 'lang' ? 'selected' : ''}>Kurzzeitvermietung</option>
            <option value="lang" ${vehicle.rental_type === 'lang' ? 'selected' : ''}>Langzeitvermietung</option>
          </select>
        </div>
      </div>
      <div id="fleet-assigned-to-group" style="${vehicle.rental_type === 'lang' ? '' : 'display:none;'}">
        <div class="form-group" style="position:relative;">
          <label>Zugewiesen an (Kunde) *</label>
          <input type="text" id="fleet-customer-search" placeholder="Kunde suchen..." autocomplete="off" oninput="searchFleetCustomer(this.value)" onkeydown="fleetCustomerKeydown(event)" value="${escapeHtml(vehicle.assigned_customer_name || '')}" ${vehicle.assigned_customer_id ? 'style="display:none;"' : ''}>
          <input type="hidden" name="assigned_customer_id" id="fleet-assigned-customer-id" value="${vehicle.assigned_customer_id || ''}">
          <div class="search-dropdown" id="fleet-customer-dropdown"></div>
          ${vehicle.assigned_customer_id ? `<div id="fleet-customer-selected" class="search-selected"><span>${escapeHtml(vehicle.assigned_customer_name || '')}</span><button type="button" class="btn btn-sm btn-secondary" onclick="clearFleetCustomer()">Ändern</button></div>` : '<div id="fleet-customer-selected" style="display:none;"></div>'}
        </div>
        <div class="form-group" id="fleet-contact-person-group" style="${vehicle.assigned_customer_id ? '' : 'display:none;'}">
          <label>Zugewiesener Fahrer <small style="color:var(--text-muted);font-weight:normal;">(optional)</small></label>
          <input type="text" name="assigned_contact_person" value="${escapeHtml(vehicle.assigned_contact_person || '')}" placeholder="z.B. Max Mustermann">
        </div>
      </div>
      <div class="form-group">
        <label>Notizen</label>
        <textarea name="notes" rows="2">${escapeHtml(vehicle.notes)}</textarea>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">${id ? 'Speichern' : 'Anlegen'}</button>
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Abbrechen</button>
      </div>
    </form>`;
  openModal(title, html, 'modal-wide');
}

let _fleetDropdownIdx = -1;

async function searchFleetCustomer(term) {
  const dropdown = document.getElementById('fleet-customer-dropdown');
  _fleetDropdownIdx = -1;
  if (!term || term.length < 2) { dropdown.style.display = 'none'; return; }
  try {
    const customers = await api('/api/customers?search=' + encodeURIComponent(term));
    if (customers.length === 0) {
      dropdown.innerHTML = '<div class="search-dropdown-item" style="color:var(--text-muted);">Keine Kunden gefunden</div>';
    } else {
      dropdown.innerHTML = customers.slice(0, 10).map((c, idx) => {
        const name = (c.customer_type === 'Firmenkunde' || c.customer_type === 'Werkstatt') ? c.company_name : c.last_name + ', ' + c.first_name;
        const sub = c.city ? ' — ' + c.city : '';
        const isFirma = c.customer_type === 'Firmenkunde' || c.customer_type === 'Werkstatt';
        return '<div class="search-dropdown-item" data-idx="' + idx + '" data-id="' + c.id + '" data-name="' + escapeHtml(name + sub) + '" data-firma="' + isFirma + '" onclick="selectFleetCustomer(' + c.id + ',\'' + escapeHtml(name) + escapeHtml(sub) + '\',' + isFirma + ')" onmouseenter="_fleetDropdownIdx=' + idx + ';fleetHighlightDropdown()">' + escapeHtml(name) + escapeHtml(sub) + (isFirma ? ' <span class="badge badge-blue">Firma</span>' : '') + '</div>';
      }).join('');
    }
    dropdown.style.display = 'block';
  } catch (e) { dropdown.style.display = 'none'; }
}

function fleetCustomerKeydown(e) {
  const dropdown = document.getElementById('fleet-customer-dropdown');
  if (!dropdown || dropdown.style.display === 'none') return;
  const items = dropdown.querySelectorAll('.search-dropdown-item[data-id]');
  if (items.length === 0) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    _fleetDropdownIdx = Math.min(_fleetDropdownIdx + 1, items.length - 1);
    fleetHighlightDropdown();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    _fleetDropdownIdx = Math.max(_fleetDropdownIdx - 1, 0);
    fleetHighlightDropdown();
  } else if (e.key === 'Enter' && _fleetDropdownIdx >= 0 && _fleetDropdownIdx < items.length) {
    e.preventDefault();
    const item = items[_fleetDropdownIdx];
    selectFleetCustomer(Number(item.dataset.id), item.dataset.name, item.dataset.firma === 'true');
  } else if (e.key === 'Tab' && dropdown.style.display !== 'none' && items.length > 0) {
    e.preventDefault();
    if (_fleetDropdownIdx < 0) _fleetDropdownIdx = 0;
    fleetHighlightDropdown();
  } else if (e.key === 'Escape') {
    dropdown.style.display = 'none';
    _fleetDropdownIdx = -1;
  }
}

function fleetHighlightDropdown() {
  const dropdown = document.getElementById('fleet-customer-dropdown');
  if (!dropdown) return;
  const items = dropdown.querySelectorAll('.search-dropdown-item[data-id]');
  items.forEach((item, i) => {
    item.style.background = i === _fleetDropdownIdx ? 'var(--primary-light)' : '';
  });
  if (_fleetDropdownIdx >= 0 && items[_fleetDropdownIdx]) {
    items[_fleetDropdownIdx].scrollIntoView({ block: 'nearest' });
  }
}

function selectFleetCustomer(id, displayName, isFirma) {
  document.getElementById('fleet-customer-dropdown').style.display = 'none';
  document.getElementById('fleet-customer-search').style.display = 'none';
  document.getElementById('fleet-assigned-customer-id').value = id;
  document.getElementById('fleet-customer-selected').style.display = '';
  document.getElementById('fleet-customer-selected').innerHTML = '<span>' + displayName + '</span> <button type="button" class="btn btn-sm btn-secondary" onclick="clearFleetCustomer()">Ändern</button>';
  document.getElementById('fleet-contact-person-group').style.display = isFirma ? '' : 'none';
}

function clearFleetCustomer() {
  document.getElementById('fleet-assigned-customer-id').value = '';
  document.getElementById('fleet-customer-selected').style.display = 'none';
  const search = document.getElementById('fleet-customer-search');
  search.style.display = '';
  search.value = '';
  search.focus();
  document.getElementById('fleet-contact-person-group').style.display = 'none';
}

async function saveFleetVehicle(e, id) {
  e.preventDefault();
  const form = e.target;
  const data = {
    manufacturer: form.manufacturer.value.trim(),
    model: form.model.value.trim(),
    vehicle_type: form.vehicle_type.value,
    vin: form.vin.value.trim(),
    license_plate: form.license_plate.value.trim(),
    first_registration: form.first_registration.value,
    next_tuev_date: form.next_tuev_date.value,
    rental_type: form.rental_type.value,
    assigned_customer_id: document.getElementById('fleet-assigned-customer-id').value || null,
    assigned_contact_person: form.assigned_contact_person ? form.assigned_contact_person.value.trim() : '',
    notes: form.notes.value.trim(),
  };
  try {
    if (id) {
      await api(`/api/fleet-vehicles/${id}`, { method: 'PUT', body: data });
      showToast('Fahrzeug aktualisiert');
    } else {
      await api('/api/fleet-vehicles', { method: 'POST', body: data });
      showToast('Fahrzeug angelegt');
    }
    closeModal();
    renderFuhrpark();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function openFleetScan() {
  closeModal();
  const html = `
    <div id="fleet-scan-upload">
      <p style="margin-bottom:12px;color:var(--text-muted);">
        Fotografieren Sie die <strong>Zulassungsbescheinigung Teil I</strong> (Fahrzeugschein) oder laden Sie ein Bild/PDF hoch.
      </p>
      <div class="scan-upload-area" onclick="document.getElementById('fleet-scan-file').click()">
        <div class="scan-icon">&#128247;</div>
        <p><strong>Klicken zum Hochladen</strong> oder Datei hierher ziehen</p>
        <p>JPG, PNG oder PDF</p>
        <input type="file" id="fleet-scan-file" accept="image/*,application/pdf" capture="environment" onchange="handleFleetScanFile(this.files[0])">
      </div>
    </div>
    <div id="fleet-scan-progress" style="display:none;">
      <img id="fleet-scan-preview" class="scan-preview" style="display:none;">
      <div class="scan-progress">
        <div class="scan-progress-bar">
          <div class="scan-progress-bar-fill" id="fleet-scan-fill"></div>
        </div>
        <p id="fleet-scan-status">Wird verarbeitet...</p>
      </div>
    </div>
  `;
  openModal('Fahrzeugschein scannen', html);

  setTimeout(() => {
    const area = document.querySelector('.scan-upload-area');
    if (!area) return;
    area.addEventListener('dragover', e => { e.preventDefault(); area.style.borderColor = 'var(--primary)'; });
    area.addEventListener('dragleave', () => { area.style.borderColor = ''; });
    area.addEventListener('drop', e => {
      e.preventDefault();
      area.style.borderColor = '';
      if (e.dataTransfer.files.length) handleFleetScanFile(e.dataTransfer.files[0]);
    });
  }, 100);
}

async function handleFleetScanFile(file) {
  if (!file) return;

  document.getElementById('fleet-scan-upload').style.display = 'none';
  document.getElementById('fleet-scan-progress').style.display = 'block';
  const fill = document.getElementById('fleet-scan-fill');
  const status = document.getElementById('fleet-scan-status');
  fill.style.width = '30%';

  try {
    let base64, contentType;

    if (file.type === 'application/pdf') {
      // PDF: alle Seiten zu einem Bild zusammenfuegen
      status.textContent = 'PDF wird verarbeitet...';
      if (!window.pdfjsLib) {
        throw new Error('PDF-Bibliothek konnte nicht geladen werden. Bitte Seite neu laden.');
      }
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const scale = 2;
      const pageCanvases = [];
      let totalHeight = 0, maxWidth = 0;
      for (let p = 1; p <= pdf.numPages; p++) {
        status.textContent = `PDF Seite ${p}/${pdf.numPages}...`;
        const page = await pdf.getPage(p);
        const viewport = page.getViewport({ scale });
        const c = document.createElement('canvas');
        c.width = viewport.width;
        c.height = viewport.height;
        await page.render({ canvasContext: c.getContext('2d'), viewport }).promise;
        pageCanvases.push(c);
        totalHeight += viewport.height;
        if (viewport.width > maxWidth) maxWidth = viewport.width;
      }
      const canvas = document.createElement('canvas');
      canvas.width = maxWidth;
      canvas.height = totalHeight;
      const ctx = canvas.getContext('2d');
      let yOff = 0;
      for (const c of pageCanvases) { ctx.drawImage(c, 0, yOff); yOff += c.height; }
      base64 = canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
      contentType = 'image/jpeg';
    } else {
      base64 = await new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.readAsDataURL(file);
      });
      contentType = file.type || 'image/jpeg';
    }

    fill.style.width = '60%';
    status.textContent = 'KI analysiert Fahrzeugschein...';

    const result = await api('/api/scan', { method: 'POST', body: { image: base64, content_type: contentType } });
    fill.style.width = '100%';

    // Close scan modal and re-open fleet form with data filled
    closeModal();
    await openFleetVehicleForm(null);

    // Fill form fields
    const form = document.getElementById('fleet-vehicle-form');
    if (form) {
      if (result.manufacturer) form.manufacturer.value = result.manufacturer;
      if (result.model) form.model.value = result.model;
      if (result.vin) form.vin.value = result.vin;
      if (result.license_plate) form.license_plate.value = result.license_plate;
      if (result.first_registration) form.first_registration.value = result.first_registration;
    }

    showToast('Fahrzeugdaten übernommen');
  } catch (err) {
    closeModal();
    showToast('Scan-Fehler: ' + err.message, 'error');
    openFleetVehicleForm(null);
  }
}

async function deleteFleetVehicle(id) {
  if (!confirm('Fahrzeug wirklich löschen? Alle zugehörigen Wartungen und KM-Einträge werden ebenfalls gelöscht.')) return;
  try {
    await api(`/api/fleet-vehicles/${id}`, { method: 'DELETE' });
    showToast('Fahrzeug gelöscht');
    renderFuhrpark();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function openFleetKmUpdate(vehicleId, currentKm) {
  const html = `
    <form id="fleet-km-form" onsubmit="saveFleetKm(event, ${vehicleId})">
      <div class="form-group">
        <label>Aktueller KM-Stand: <strong>${Number(currentKm).toLocaleString('de-DE')} km</strong></label>
        <input type="number" name="km_stand" min="${currentKm}" value="" placeholder="Neuen KM-Stand eingeben" required autofocus>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">Speichern</button>
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Abbrechen</button>
      </div>
    </form>`;
  openModal('KM-Stand aktualisieren', html);
}

async function saveFleetKm(e, vehicleId) {
  e.preventDefault();
  const km = parseInt(e.target.km_stand.value);
  if (isNaN(km)) { showToast('Bitte gültigen KM-Stand eingeben', 'error'); return; }
  try {
    await api(`/api/fleet-vehicles/${vehicleId}/km`, { method: 'PUT', body: { km_stand: km } });
    showToast('KM-Stand aktualisiert');
    closeModal();
    if (currentPage === 'fuhrpark-detail') {
      renderFuhrparkDetail(vehicleId);
    } else {
      renderFuhrpark();
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function openFleetMaintenanceForm(vehicleId, maintId) {
  let maint = { maintenance_date: '', workshop: '', km_stand: 0, cost: 0, description: '', next_maintenance_date: '', next_maintenance_km: 0 };
  if (maintId) {
    try {
      const data = await api(`/api/fleet-vehicles/${vehicleId}`);
      const found = (data.maintenance || []).find(m => m.id === maintId);
      if (found) maint = found;
    } catch (err) {
      showToast('Fehler beim Laden', 'error');
      return;
    }
  }
  const title = maintId ? 'Wartung bearbeiten' : 'Neue Wartung';
  const html = `
    <form id="fleet-maint-form" onsubmit="saveFleetMaintenance(event, ${vehicleId}, ${maintId || 'null'})">
      <div class="form-row">
        <div class="form-group">
          <label>Datum</label>
          <input type="date" name="maintenance_date" value="${maint.maintenance_date || ''}">
        </div>
        <div class="form-group">
          <label>Werkstatt</label>
          <input type="text" name="workshop" value="${escapeHtml(maint.workshop || '')}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>KM-Stand bei Wartung</label>
          <input type="number" name="km_stand" value="${maint.km_stand || 0}" min="0">
        </div>
        <div class="form-group">
          <label>Kosten (EUR)</label>
          <input type="number" name="cost" value="${Number(maint.cost || 0).toFixed(2)}" step="0.01" min="0">
        </div>
      </div>
      <div class="form-group">
        <label>Beschreibung</label>
        <textarea name="description" rows="2">${escapeHtml(maint.description || '')}</textarea>
      </div>
      <hr style="margin:16px 0;border:none;border-top:1px solid var(--border);">
      <p style="font-size:13px;color:var(--text-muted);margin-bottom:8px;"><strong>Nächste Wartung fällig:</strong></p>
      <div class="form-row">
        <div class="form-group">
          <label>Datum</label>
          <input type="date" name="next_maintenance_date" value="${maint.next_maintenance_date || ''}">
        </div>
        <div class="form-group">
          <label>KM-Stand</label>
          <input type="number" name="next_maintenance_km" value="${maint.next_maintenance_km || 0}" min="0">
        </div>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">${maintId ? 'Speichern' : 'Anlegen'}</button>
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Abbrechen</button>
      </div>
    </form>`;
  openModal(title, html);
}

async function saveFleetMaintenance(e, vehicleId, maintId) {
  e.preventDefault();
  const form = e.target;
  const data = {
    maintenance_date: form.maintenance_date.value,
    workshop: form.workshop.value.trim(),
    km_stand: parseInt(form.km_stand.value) || 0,
    cost: parseFloat(form.cost.value) || 0,
    description: form.description.value.trim(),
    next_maintenance_date: form.next_maintenance_date.value,
    next_maintenance_km: parseInt(form.next_maintenance_km.value) || 0,
  };
  try {
    if (maintId) {
      await api(`/api/fleet-maintenance/${maintId}`, { method: 'PUT', body: data });
      showToast('Wartung aktualisiert');
    } else {
      await api(`/api/fleet-vehicles/${vehicleId}/maintenance`, { method: 'POST', body: data });
      showToast('Wartung erstellt');
    }
    closeModal();
    renderFuhrparkDetail(vehicleId);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteFleetMaintenance(maintId, vehicleId) {
  if (!confirm('Wartung wirklich löschen?')) return;
  try {
    await api(`/api/fleet-maintenance/${maintId}`, { method: 'DELETE' });
    showToast('Wartung gelöscht');
    renderFuhrparkDetail(vehicleId);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function renderFleetMaintenanceTable(maintenance, vehicleId) {
  if (maintenance.length === 0) {
    return '<p style="color:var(--text-muted);font-size:13px;padding:16px;">Noch keine Wartungen vorhanden.</p>';
  }
  let html = `<table class="data-table">
    <thead><tr>
      <th>Datum</th><th>Werkstatt</th><th>KM-Stand</th><th>Kosten</th><th>Beschreibung</th><th>Nächste Wartung</th>${isVerwaltung() ? '<th>Aktionen</th>' : ''}
    </tr></thead><tbody>`;
  maintenance.forEach(m => {
    const nextInfo = [];
    if (m.next_maintenance_date) nextInfo.push(formatDate(m.next_maintenance_date));
    if (m.next_maintenance_km && Number(m.next_maintenance_km) > 0) nextInfo.push(Number(m.next_maintenance_km).toLocaleString('de-DE') + ' km');
    html += `<tr>
      <td>${formatDate(m.maintenance_date)}</td>
      <td>${escapeHtml(m.workshop || '-')}</td>
      <td>${m.km_stand ? Number(m.km_stand).toLocaleString('de-DE') + ' km' : '-'}</td>
      <td>${Number(m.cost || 0).toFixed(2)} &euro;</td>
      <td>${escapeHtml(m.description || '-')}</td>
      <td>${nextInfo.length > 0 ? nextInfo.join(' / ') : '-'}</td>
      ${isVerwaltung() ? `<td style="white-space:nowrap;">
        <button class="btn btn-sm btn-secondary" onclick="openFleetMaintenanceForm(${vehicleId}, ${m.id})">Bearbeiten</button>
        ${isAdmin() ? `<button class="btn btn-sm btn-danger" onclick="deleteFleetMaintenance(${m.id}, ${vehicleId})">Löschen</button>` : ''}
      </td>` : ''}
    </tr>`;
  });
  html += '</tbody></table>';
  return html;
}

function renderFleetMileageTable(mileage) {
  if (mileage.length === 0) {
    return '<p style="color:var(--text-muted);font-size:13px;padding:16px;">Noch keine KM-Einträge vorhanden.</p>';
  }
  let html = `<table class="data-table">
    <thead><tr>
      <th>Datum</th><th>KM-Stand</th><th>Erfasst von</th>${isAdmin() ? '<th>Aktionen</th>' : ''}
    </tr></thead><tbody>`;
  mileage.forEach(m => {
    html += `<tr>
      <td>${formatDate(m.record_date)}</td>
      <td>${Number(m.km_stand).toLocaleString('de-DE')} km</td>
      <td>${escapeHtml(m.staff_name || '-')}</td>
      ${isAdmin() ? `<td><button class="btn btn-sm btn-danger" onclick="deleteFleetMileage(${m.id})">Löschen</button></td>` : ''}
    </tr>`;
  });
  html += '</tbody></table>';
  return html;
}

async function deleteFleetMileage(mileageId) {
  if (!confirm('KM-Eintrag wirklich löschen?')) return;
  try {
    await api(`/api/fleet-mileage/${mileageId}`, { method: 'DELETE' });
    showToast('KM-Eintrag gelöscht');
    // Refresh the detail view
    const vehicleIdMatch = document.querySelector('[onclick*="renderFuhrparkDetail"]');
    // Re-render current detail page
    if (currentPage === 'fuhrpark-detail') {
      const heading = document.querySelector('.page-header h2');
      const kmBtn = document.querySelector('[onclick*="openFleetKmUpdate"]');
      if (kmBtn) {
        const match = kmBtn.getAttribute('onclick').match(/openFleetKmUpdate\((\d+)/);
        if (match) renderFuhrparkDetail(Number(match[1]));
      }
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ===== TICKETS =====

async function updateUnreadBadges() {
  try {
    const [ticketData, suggestionData] = await Promise.all([
      api('/api/tickets/unread-count'),
      api('/api/suggestions/unread-count')
    ]);
    const tBadge = document.getElementById('ticket-badge');
    const sBadge = document.getElementById('suggestion-badge');
    if (tBadge) {
      tBadge.textContent = ticketData.count;
      tBadge.style.display = ticketData.count > 0 ? '' : 'none';
    }
    if (sBadge) {
      sBadge.textContent = suggestionData.count;
      sBadge.style.display = suggestionData.count > 0 ? '' : 'none';
    }
  } catch (e) { /* ignore */ }
}

function ticketStatusBadge(status) {
  const map = { 'Offen': 'badge-gray', 'In Bearbeitung': 'badge-blue', 'Erledigt': 'badge-green' };
  return `<span class="badge ${map[status] || 'badge-gray'}">${escapeHtml(status)}</span>`;
}

function suggestionStatusBadge(status) {
  const map = { 'Offen': 'badge-gray', 'In Pruefung': 'badge-blue', 'Umgesetzt': 'badge-green', 'Verworfen': 'badge-red' };
  return `<span class="badge ${map[status] || 'badge-gray'}">${escapeHtml(status)}</span>`;
}

async function renderTickets() {
  const main = document.getElementById('main-content');
  try {
    const tickets = await api('/api/tickets');
    const statuses = ['Offen & In Bearbeitung', 'Alle', 'Offen', 'In Bearbeitung', 'Erledigt'];
    const filterHtml = `<div class="filter-bar">
      <div class="form-group">
        <label>Status</label>
        <select id="ticket-filter-status" onchange="filterTicketTable()">
          ${statuses.map(s => `<option value="${s}">${s}</option>`).join('')}
        </select>
      </div>
    </div>`;
    main.innerHTML = `
      <div class="page-header">
        <h2>Support-Tickets</h2>
        <button class="btn btn-primary" onclick="openTicketForm()">+ Neues Ticket</button>
      </div>
      ${filterHtml}
      <div class="card">
        <div class="table-wrapper">
          <table id="tickets-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Betreff</th>
                ${isAdmin() ? '<th>Erstellt von</th>' : ''}
                <th>Status</th>
                <th>Erstellt am</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${tickets.length === 0 ? `<tr><td colspan="${isAdmin() ? 6 : 5}" style="text-align:center;color:var(--text-muted);">Keine Tickets vorhanden</td></tr>` : tickets.map(t => `
                <tr class="clickable" onclick="openTicketDetail(${t.id})" style="${t.read_by_creator === 0 ? 'font-weight:600;background:#eff6ff;' : ''}">
                  <td>${t.id}</td>
                  <td>${escapeHtml(t.subject)}${t.read_by_creator === 0 ? ' <span class="nav-badge">Neu</span>' : ''}</td>
                  ${isAdmin() ? `<td>${escapeHtml(t.staff_name || '')}</td>` : ''}
                  <td>${ticketStatusBadge(t.status)}</td>
                  <td>${formatDate(t.created_at || '')}</td>
                  <td></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
    filterTicketTable();
  } catch (err) {
    main.innerHTML = `<p style="color:var(--danger);">${err.message}</p>`;
  }
}

function filterTicketTable() {
  const status = document.getElementById('ticket-filter-status')?.value || 'Offen & In Bearbeitung';
  document.querySelectorAll('#tickets-table tbody tr').forEach(row => {
    if (status === 'Alle') { row.style.display = ''; return; }
    const badge = row.querySelector('.badge');
    const badgeText = badge?.textContent || '';
    if (status === 'Offen & In Bearbeitung') {
      row.style.display = (badgeText === 'Offen' || badgeText === 'In Bearbeitung') ? '' : 'none';
    } else {
      row.style.display = badgeText === status ? '' : 'none';
    }
  });
}

async function openTicketDetail(id) {
  try {
    const tickets = await api('/api/tickets');
    const t = tickets.find(x => x.id === id);
    if (!t) return showToast('Ticket nicht gefunden', 'error');

    // Mark as read if unread
    if (t.read_by_creator === 0 && t.staff_id === loggedInUser.id) {
      await api(`/api/tickets/${id}/read`, { method: 'PUT' });
      updateUnreadBadges();
    }

    let adminFormHtml = '';
    if (isAdmin()) {
      adminFormHtml = `
        <hr style="margin:16px 0;">
        <h3 style="margin-bottom:12px;">Admin-Bearbeitung</h3>
        <div class="form-group">
          <label>Status</label>
          <select id="ticket-detail-status">
            ${['Offen', 'In Bearbeitung', 'Erledigt'].map(s => `<option value="${s}" ${t.status === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Antwort</label>
          <textarea id="ticket-detail-response" rows="4">${escapeHtml(t.admin_response || '')}</textarea>
        </div>
        <div class="form-actions">
          <button class="btn btn-primary" onclick="saveTicketResponse(${t.id})">Speichern</button>
        </div>
      `;
    }

    const html = `
      <div style="margin-bottom:12px;">
        <span class="info-label">STATUS</span><br>
        ${ticketStatusBadge(t.status)}
      </div>
      <div style="margin-bottom:12px;">
        <span class="info-label">ERSTELLT VON</span><br>
        <span class="info-value">${escapeHtml(t.staff_name || '')} &mdash; ${formatDate(t.created_at || '')}</span>
      </div>
      <div style="margin-bottom:12px;">
        <span class="info-label">BESCHREIBUNG</span><br>
        <div style="white-space:pre-wrap;">${escapeHtml(t.description || '-')}</div>
      </div>
      ${t.admin_response ? `
        <div style="margin-bottom:12px;padding:12px;background:#eff6ff;border-radius:6px;">
          <span class="info-label">ADMIN-ANTWORT</span><br>
          <div style="white-space:pre-wrap;">${escapeHtml(t.admin_response)}</div>
        </div>
      ` : ''}
      ${adminFormHtml}
    `;
    openModal('Ticket #' + t.id + ': ' + escapeHtml(t.subject), html);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function saveTicketResponse(id) {
  try {
    const status = document.getElementById('ticket-detail-status').value;
    const admin_response = document.getElementById('ticket-detail-response').value;
    const result = await api(`/api/tickets/${id}`, { method: 'PUT', body: { status, admin_response } });
    showToast('Ticket aktualisiert');
    if (result.emailSent) showToast('Benachrichtigung per E-Mail versendet', 'success');
    else if (result.emailSkipReason) showToast('E-Mail nicht gesendet: ' + result.emailSkipReason, 'warning');
    closeModal();
    renderTickets();
    updateUnreadBadges();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function openTicketForm() {
  const html = `
    <div class="form-group">
      <label>Betreff *</label>
      <input type="text" id="ticket-subject" required>
    </div>
    <div class="form-group">
      <label>Beschreibung</label>
      <textarea id="ticket-description" rows="5"></textarea>
    </div>
    <div class="form-actions">
      <button class="btn btn-primary" onclick="submitTicket()">Ticket erstellen</button>
      <button class="btn btn-secondary" onclick="closeModal()">Abbrechen</button>
    </div>
  `;
  openModal('Neues Support-Ticket', html);
}

async function submitTicket() {
  try {
    const subject = document.getElementById('ticket-subject').value.trim();
    const description = document.getElementById('ticket-description').value.trim();
    if (!subject) return showToast('Betreff ist Pflichtfeld', 'error');
    await api('/api/tickets', { method: 'POST', body: { subject, description } });
    showToast('Ticket erstellt');
    closeModal();
    renderTickets();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ===== SUGGESTIONS (Verbesserungsvorschläge) =====

async function renderSuggestions() {
  const main = document.getElementById('main-content');
  try {
    const suggestions = await api('/api/suggestions');
    const statuses = ['Offen & In Prüfung', 'Alle', 'Offen', 'In Pruefung', 'Umgesetzt', 'Verworfen'];
    const filterHtml = `<div class="filter-bar">
      <div class="form-group">
        <label>Status</label>
        <select id="suggestion-filter-status" onchange="filterSuggestionTable()">
          ${statuses.map(s => `<option value="${s}">${s}</option>`).join('')}
        </select>
      </div>
    </div>`;
    main.innerHTML = `
      <div class="page-header">
        <h2>Verbesserungsvorschläge</h2>
        <button class="btn btn-primary" onclick="openSuggestionForm()">+ Neuer Vorschlag</button>
      </div>
      ${filterHtml}
      <div class="card">
        <div class="table-wrapper">
          <table id="suggestions-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Betreff</th>
                ${isAdmin() ? '<th>Erstellt von</th>' : ''}
                <th>Status</th>
                <th>Erstellt am</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${suggestions.length === 0 ? `<tr><td colspan="${isAdmin() ? 6 : 5}" style="text-align:center;color:var(--text-muted);">Keine Vorschläge vorhanden</td></tr>` : suggestions.map(s => `
                <tr class="clickable" onclick="openSuggestionDetail(${s.id})" style="${s.read_by_creator === 0 ? 'font-weight:600;background:#eff6ff;' : ''}">
                  <td>${s.id}</td>
                  <td>${escapeHtml(s.subject)}${s.read_by_creator === 0 ? ' <span class="nav-badge">Neu</span>' : ''}</td>
                  ${isAdmin() ? `<td>${escapeHtml(s.staff_name || '')}</td>` : ''}
                  <td>${suggestionStatusBadge(s.status)}</td>
                  <td>${formatDate(s.created_at || '')}</td>
                  <td></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
    filterSuggestionTable();
  } catch (err) {
    main.innerHTML = `<p style="color:var(--danger);">${err.message}</p>`;
  }
}

function filterSuggestionTable() {
  const status = document.getElementById('suggestion-filter-status')?.value || 'Offen & In Prüfung';
  document.querySelectorAll('#suggestions-table tbody tr').forEach(row => {
    if (status === 'Alle') { row.style.display = ''; return; }
    const badge = row.querySelector('.badge');
    const badgeText = badge?.textContent || '';
    if (status === 'Offen & In Prüfung') {
      row.style.display = (badgeText === 'Offen' || badgeText === 'In Pruefung') ? '' : 'none';
    } else {
      row.style.display = badgeText === status ? '' : 'none';
    }
  });
}

async function openSuggestionDetail(id) {
  try {
    const suggestions = await api('/api/suggestions');
    const s = suggestions.find(x => x.id === id);
    if (!s) return showToast('Vorschlag nicht gefunden', 'error');

    // Mark as read if unread
    if (s.read_by_creator === 0 && s.staff_id === loggedInUser.id) {
      await api(`/api/suggestions/${id}/read`, { method: 'PUT' });
      updateUnreadBadges();
    }

    let adminFormHtml = '';
    if (isAdmin()) {
      adminFormHtml = `
        <hr style="margin:16px 0;">
        <h3 style="margin-bottom:12px;">Admin-Bearbeitung</h3>
        <div class="form-group">
          <label>Status</label>
          <select id="suggestion-detail-status">
            ${['Offen', 'In Pruefung', 'Umgesetzt', 'Verworfen'].map(st => `<option value="${st}" ${s.status === st ? 'selected' : ''}>${st}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Kommentar</label>
          <textarea id="suggestion-detail-comment" rows="4">${escapeHtml(s.admin_comment || '')}</textarea>
        </div>
        <div class="form-actions">
          <button class="btn btn-primary" onclick="saveSuggestionResponse(${s.id})">Speichern</button>
        </div>
      `;
    }

    const html = `
      <div style="margin-bottom:12px;">
        <span class="info-label">STATUS</span><br>
        ${suggestionStatusBadge(s.status)}
      </div>
      <div style="margin-bottom:12px;">
        <span class="info-label">ERSTELLT VON</span><br>
        <span class="info-value">${escapeHtml(s.staff_name || '')} &mdash; ${formatDate(s.created_at || '')}</span>
      </div>
      <div style="margin-bottom:12px;">
        <span class="info-label">BESCHREIBUNG</span><br>
        <div style="white-space:pre-wrap;">${escapeHtml(s.description || '-')}</div>
      </div>
      ${s.admin_comment ? `
        <div style="margin-bottom:12px;padding:12px;background:#eff6ff;border-radius:6px;">
          <span class="info-label">ADMIN-KOMMENTAR</span><br>
          <div style="white-space:pre-wrap;">${escapeHtml(s.admin_comment)}</div>
        </div>
      ` : ''}
      ${adminFormHtml}
    `;
    openModal('Vorschlag #' + s.id + ': ' + escapeHtml(s.subject), html);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function saveSuggestionResponse(id) {
  try {
    const status = document.getElementById('suggestion-detail-status').value;
    const admin_comment = document.getElementById('suggestion-detail-comment').value;
    const result = await api(`/api/suggestions/${id}`, { method: 'PUT', body: { status, admin_comment } });
    showToast('Vorschlag aktualisiert');
    if (result.emailSent) showToast('Benachrichtigung per E-Mail versendet', 'success');
    else if (result.emailSkipReason) showToast('E-Mail nicht gesendet: ' + result.emailSkipReason, 'warning');
    closeModal();
    renderSuggestions();
    updateUnreadBadges();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function openSuggestionForm() {
  const html = `
    <div class="form-group">
      <label>Betreff *</label>
      <input type="text" id="suggestion-subject" required>
    </div>
    <div class="form-group">
      <label>Beschreibung</label>
      <textarea id="suggestion-description" rows="5"></textarea>
    </div>
    <div class="form-actions">
      <button class="btn btn-primary" onclick="submitSuggestion()">Vorschlag einreichen</button>
      <button class="btn btn-secondary" onclick="closeModal()">Abbrechen</button>
    </div>
  `;
  openModal('Neuer Verbesserungsvorschlag', html);
}

async function submitSuggestion() {
  try {
    const subject = document.getElementById('suggestion-subject').value.trim();
    const description = document.getElementById('suggestion-description').value.trim();
    if (!subject) return showToast('Betreff ist Pflichtfeld', 'error');
    await api('/api/suggestions', { method: 'POST', body: { subject, description } });
    showToast('Vorschlag erstellt');
    closeModal();
    renderSuggestions();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ===== TIME TRACKING =====

let timeTrackingWeekOffset = 0;
let timeTrackingSelectedStaffId = null;

function getWeekDates(offset = 0) {
  const now = new Date();
  now.setDate(now.getDate() + offset * 7);
  const day = now.getDay();
  const diff = day === 0 ? 6 : day - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - diff);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    days.push(d);
  }
  return days;
}

function getKW(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function formatDuration(minutes) {
  if (minutes === 0) return '0h 00m';
  const neg = minutes < 0;
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = Math.round(abs % 60);
  return (neg ? '-' : '') + h + 'h ' + String(m).padStart(2, '0') + 'm';
}

function calcWorkMinutes(start, end, breakMin) {
  if (!start || !end) return 0;
  const sp = start.split(':').map(Number);
  const ep = end.split(':').map(Number);
  const startMin = sp[0] * 60 + sp[1];
  const endMin = ep[0] * 60 + ep[1];
  const total = endMin - startMin - (breakMin || 0);
  return total > 0 ? total : 0;
}

async function renderTimeTracking() {
  const main = document.getElementById('main-content');
  const weekDates = getWeekDates(timeTrackingWeekOffset);
  const monday = weekDates[0];
  const sunday = weekDates[6];
  const kw = getKW(monday);
  const fromStr = localDateStr(monday);
  const toStr = localDateStr(sunday);
  const todayStr = localDateStr(new Date());

  const effectiveStaffId = timeTrackingSelectedStaffId || (loggedInUser ? loggedInUser.id : null);

  try {
    const canSeeDeductions = loggedInUser && ['Verwaltung', 'Buchhaltung', 'Admin'].includes(loggedInUser.permission_level);
    const promises = {
      status: api(`/api/time/status`),
      entries: api(`/api/time/entries?staff_id=${effectiveStaffId}&from=${fromStr}&to=${toStr}`),
      overtime: api(`/api/time/overtime?staff_id=${effectiveStaffId}`),
      vacation: api(`/api/vacation?staff_id=${effectiveStaffId}&status=Genehmigt`),
      staff: (isAdmin() || isVerwaltung() || isBuchhaltung()) ? api('/api/staff') : Promise.resolve([]),
      deductions: canSeeDeductions ? api(`/api/overtime-deductions?staff_id=${effectiveStaffId}`) : Promise.resolve([])
    };
    const keys = Object.keys(promises);
    const results = await Promise.all(Object.values(promises));
    const fetched = {};
    keys.forEach((k, i) => fetched[k] = results[i]);

    const status = fetched.status;
    const entries = fetched.entries;
    const overtime = fetched.overtime;
    const vacEntries = fetched.vacation || [];
    const staffList = fetched.staff || [];
    const deductions = fetched.deductions || [];

    // Build absence map for displayed week from vacation/absence calendar
    const holidays = getNRWHolidays(monday.getFullYear());
    // Also get holidays for Sunday's year if it differs (week spanning year boundary)
    const sundayYear = sunday.getFullYear();
    if (sundayYear !== monday.getFullYear()) {
      const h2 = getNRWHolidays(sundayYear);
      h2.forEach((v, k) => holidays.set(k, v));
    }
    const absenceMap = {};
    vacEntries.forEach(v => {
      const s = new Date(v.start_date + 'T12:00:00');
      const e = new Date(v.end_date + 'T12:00:00');
      for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
        const ds = localDateStr(d);
        if (ds >= fromStr && ds <= toStr) {
          absenceMap[ds] = { type: v.entry_type, half_day: v.half_day || 0 };
        }
      }
    });

    // No entry_date → show hint instead of time tracking
    if (overtime.no_entry_date) {
      let staffDropdown = '';
      if (isAdmin() || isVerwaltung() || isBuchhaltung()) {
        const allStaff = staffList.filter(s => s.active);
        staffDropdown = `<div class="form-group" style="margin-bottom:16px;">
          <label>Mitarbeiter</label>
          <select id="time-staff-select" onchange="changeTimeTrackingStaff(this.value)">
            ${allStaff.map(s => `<option value="${s.id}" ${s.id === effectiveStaffId ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
          </select>
        </div>`;
      }
      main.innerHTML = `
        <div class="page-header"><h2>Zeiterfassung</h2></div>
        ${staffDropdown}
        <div class="card" style="text-align:center;padding:40px;">
          <p style="font-size:16px;color:var(--text-muted);margin:0;">Kein Eintrittsdatum hinterlegt.</p>
          <p style="font-size:14px;color:var(--text-muted);margin:8px 0 0;">Bitte zuerst ein Eintrittsdatum in der Mitarbeiterverwaltung eintragen, damit die Zeiterfassung berechnet werden kann.</p>
        </div>`;
      return;
    }

    const dayNames = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

    // Build week table rows using per-day data from overtime response
    const weeklyHours = overtime.weekly_hours || 40;
    const workDaysArr = (overtime.work_days || '1,2,3,4,5').split(',').map(Number);

    // Find the matching week in overtime.weeks (by week_start = Monday of current view)
    const currentWeekData = (overtime.weeks || []).find(w => w.week_start === fromStr);
    const weekDays = currentWeekData ? currentWeekData.days : {};

    let weekTotalMinutes = 0;
    let weekTargetMinutes = 0;
    const weekDayData = weekDates.map((date, i) => {
      const dateStr = localDateStr(date);
      const dayEntries = entries.filter(e => e.entry_date === dateStr);
      const isToday = dateStr === todayStr;
      const dayNum = i + 1;
      const isOffDay = !workDaysArr.includes(dayNum);
      const dayInfo = weekDays[dateStr] || {};
      const dayTargetMinutes = dayInfo.target_minutes || 0;
      weekTargetMinutes += dayTargetMinutes;

      const absence = absenceMap[dateStr] || null;
      const holidayName = holidays.get(dateStr) || null;
      let absenceType = null;
      if (absence) {
        if (absence.type === 'Urlaub' && absence.half_day) absenceType = 'Halber Urlaubstag';
        else if (absence.type === 'Halber Urlaubstag') absenceType = 'Halber Urlaubstag';
        else absenceType = absence.type;
      } else if (holidayName && !isOffDay) {
        absenceType = 'Feiertag';
      }

      let rowBg = '';
      if (absenceType === 'Krankheit') rowBg = 'background:rgba(220,38,38,0.13);';
      else if (absenceType === 'Urlaub') rowBg = 'background:rgba(30,64,175,0.15);';
      else if (absenceType === 'Halber Urlaubstag') rowBg = 'background:rgba(96,165,250,0.15);';
      else if (absenceType === 'Feiertag') rowBg = 'background:rgba(234,179,8,0.15);';

      let firstStart = '', lastEnd = '', dayWorkMinutes = 0, pauseMinutes = 0;
      if (dayEntries.length > 0) {
        firstStart = dayEntries[0].start_time.slice(0, 5);
        const completedEntries = dayEntries.filter(e => e.end_time);
        const lastEndRaw = completedEntries.length > 0 ? completedEntries[completedEntries.length - 1].end_time : '';
        lastEnd = lastEndRaw ? lastEndRaw.slice(0, 5) : '';
        dayEntries.forEach((e, j) => {
          const hasEnd = e.end_time && e.end_time.length >= 5;
          if (hasEnd) dayWorkMinutes += calcWorkMinutes(e.start_time, e.end_time, e.break_minutes || 0);
          if (e.notes === '__pause__' && hasEnd && j < dayEntries.length - 1) {
            const gap = calcWorkMinutes(e.end_time, dayEntries[j + 1].start_time, 0);
            if (gap > 0) pauseMinutes += gap;
          }
        });
      }
      weekTotalMinutes += dayWorkMinutes;
      const dayDiff = dayWorkMinutes - dayTargetMinutes;
      const hasTarget = dayTargetMinutes > 0;

      return { date, dateStr, dayName: dayNames[i], isToday, isOffDay, absenceType, holidayName, rowBg, firstStart, lastEnd, dayWorkMinutes, pauseMinutes, dayTargetMinutes, dayDiff, hasTarget };
    });

    // Desktop: table rows
    const weekRows = weekDayData.map(d => {
      const rowClass = d.isToday ? 'time-today-row' : (d.isOffDay && !d.absenceType ? 'time-weekend-row' : '');
      const absLabel = d.absenceType ? `<span style="font-size:12px;color:var(--text-muted);margin-left:4px;">${d.holidayName || d.absenceType}</span>` : '';
      const diffColor = d.hasTarget && d.dayWorkMinutes > 0 ? (d.dayDiff >= 0 ? 'var(--success)' : 'var(--danger)') : (!d.hasTarget && d.dayWorkMinutes > 0 ? 'var(--success)' : 'var(--text-muted)');
      if (d.firstStart === '') {
        return `<tr class="${rowClass}" style="cursor:pointer;${d.rowBg}" onclick="openDayDetailModal(${effectiveStaffId}, '${d.dateStr}')">
          <td><strong>${d.dayName}</strong></td>
          <td>${d.date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}${absLabel}</td>
          <td>—</td><td>—</td><td>—</td><td>—</td>
          <td style="color:var(--text-muted);font-weight:600;">${d.dayTargetMinutes > 0 ? '-' + formatDuration(d.dayTargetMinutes) : '—'}</td>
        </tr>`;
      }
      return `<tr class="${rowClass}" style="cursor:pointer;${d.rowBg}" onclick="openDayDetailModal(${effectiveStaffId}, '${d.dateStr}')">
        <td><strong>${d.dayName}</strong></td>
        <td>${d.date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}${absLabel}</td>
        <td>${d.firstStart}</td>
        <td>${d.lastEnd || '—'}</td>
        <td>${d.pauseMinutes > 0 ? d.pauseMinutes + ' min' : '—'}</td>
        <td>${d.dayWorkMinutes > 0 ? formatDuration(d.dayWorkMinutes) : '—'}</td>
        <td style="color:${diffColor};font-weight:600;">${d.dayWorkMinutes > 0 || d.hasTarget ? (d.dayDiff >= 0 ? '+' : '') + formatDuration(d.dayDiff) : '—'}</td>
      </tr>`;
    }).join('');

    // Mobile: day cards
    const mobileWeekCards = weekDayData.map(d => {
      const isActive = d.isToday;
      const dimmed = d.isOffDay && !d.absenceType && !d.firstStart;
      const absLabel = d.absenceType ? (d.holidayName || d.absenceType) : '';
      const diffColor = d.hasTarget && d.dayWorkMinutes > 0 ? (d.dayDiff >= 0 ? 'var(--success)' : 'var(--danger)') : (!d.hasTarget && d.dayWorkMinutes > 0 ? 'var(--success)' : 'var(--text-muted)');
      const diffText = d.dayWorkMinutes > 0 || d.hasTarget ? (d.dayDiff >= 0 ? '+' : '') + formatDuration(d.dayDiff) : '';

      return `<div class="tt-mobile-day ${isActive ? 'tt-mobile-today' : ''} ${dimmed ? 'tt-mobile-off' : ''}" style="${d.rowBg}" onclick="openDayDetailModal(${effectiveStaffId}, '${d.dateStr}')">
        <div class="tt-mobile-day-header">
          <span class="tt-mobile-day-name">${d.dayName}</span>
          <span class="tt-mobile-day-date">${d.date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}</span>
          ${absLabel ? `<span class="tt-mobile-day-abs">${absLabel}</span>` : ''}
          ${diffText ? `<span class="tt-mobile-day-diff" style="color:${diffColor};">${diffText}</span>` : ''}
        </div>
        ${d.firstStart ? `<div class="tt-mobile-day-details">
          <span>${d.firstStart} – ${d.lastEnd || '...'}</span>
          ${d.pauseMinutes > 0 ? `<span>Pause: ${d.pauseMinutes}m</span>` : ''}
          <span style="font-weight:600;">${formatDuration(d.dayWorkMinutes)}</span>
        </div>` : ''}
      </div>`;
    }).join('');

    // Weekly totals from per-day targets
    const targetMinutes = weekTargetMinutes;
    const weekDiff = weekTotalMinutes - targetMinutes;

    // Stamp area
    const isOwnView = !timeTrackingSelectedStaffId || timeTrackingSelectedStaffId === loggedInUser.id;
    let stampHtml = '';
    if (isOwnView) {
      let statusText = '';
      let statusColor = 'var(--text-muted)';
      let mainBtnLabel = 'Einstempeln';
      let mainBtnClass = 'stamp-btn-in';
      let showPause = false;

      if (status.stamped_in) {
        statusText = `<span class="stamp-active-indicator"></span> Eingestempelt seit ${status.current_entry.start_time.slice(0,5)} <span id="stamp-elapsed" style="color:var(--text-muted);"></span>`;
        statusColor = 'var(--success)';
        mainBtnLabel = 'Ausstempeln';
        mainBtnClass = 'stamp-btn-out';
        showPause = true;
      } else if (status.on_pause) {
        statusText = `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--warning);animation:pulse 1.5s ease-in-out infinite;"></span> In Pause seit ${status.last_entry.end_time.slice(0,5)} <span id="stamp-elapsed" style="color:var(--text-muted);"></span>`;
        statusColor = 'var(--warning)';
        mainBtnLabel = 'Einstempeln';
        mainBtnClass = 'stamp-btn-in';
      } else {
        statusText = 'Ausgestempelt';
      }

      stampHtml = `
        <div style="margin-bottom:20px;">
          <div style="margin-bottom:10px;font-size:15px;font-weight:600;color:${statusColor};">${statusText}</div>
          <div style="display:flex;align-items:center;gap:12px;">
            <button class="btn stamp-btn ${mainBtnClass}" onclick="doStamp()">${mainBtnLabel}</button>
            ${showPause ? '<button class="btn stamp-btn stamp-btn-pause" onclick="doPause()">Pause</button>' : ''}
          </div>
        </div>`;
    }

    // Staff dropdown for Admin, Verwaltung, Buchhaltung
    let staffDropdown = '';
    if (isAdmin() || isVerwaltung() || isBuchhaltung()) {
      staffDropdown = `
        <div class="form-group" style="margin-bottom:16px;">
          <label>Mitarbeiter</label>
          <select id="time-staff-select" onchange="changeTimeTrackingStaff(this.value)">
            ${staffList.filter(s => s.active).map(s => `<option value="${s.id}" ${s.id === effectiveStaffId ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
          </select>
        </div>`;
    }

    // Overtime display
    const totalOT = overtime.total_overtime_minutes || 0;
    const otColor = totalOT >= 0 ? 'var(--success)' : 'var(--danger)';

    const isMobile = isMobileView();

    // Week navigation (shared, but styled differently)
    const weekNavHtml = isMobile ? `
      <div class="tt-mobile-week-nav">
        <button class="btn btn-secondary btn-sm" onclick="timeTrackingWeekOffset--;renderTimeTracking();">&laquo;</button>
        <div class="tt-mobile-week-label">
          <strong>KW ${kw}</strong>
          <span>${monday.toLocaleDateString('de-DE', {day:'2-digit',month:'2-digit'})} – ${sunday.toLocaleDateString('de-DE', {day:'2-digit',month:'2-digit',year:'numeric'})}</span>
        </div>
        <button class="btn btn-secondary btn-sm" onclick="timeTrackingWeekOffset++;renderTimeTracking();">&raquo;</button>
      </div>
      ${timeTrackingWeekOffset !== 0 ? '<div style="text-align:center;margin-bottom:12px;"><button class="btn btn-primary btn-sm" onclick="timeTrackingWeekOffset=0;renderTimeTracking();">Aktuelle Woche</button></div>' : ''}
    ` : `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <button class="btn btn-secondary btn-sm" onclick="timeTrackingWeekOffset--;renderTimeTracking();">&laquo; Vorherige</button>
        <div style="text-align:center;">
          <strong>KW ${kw}</strong>
          <span style="color:var(--text-muted);margin-left:8px;">(${monday.toLocaleDateString('de-DE', {day:'2-digit',month:'2-digit',year:'numeric'})} - ${sunday.toLocaleDateString('de-DE', {day:'2-digit',month:'2-digit',year:'numeric'})})</span>
        </div>
        <div style="display:flex;gap:6px;">
          ${timeTrackingWeekOffset !== 0 ? '<button class="btn btn-primary btn-sm" onclick="timeTrackingWeekOffset=0;renderTimeTracking();">Aktuelle Woche</button>' : ''}
          <button class="btn btn-secondary btn-sm" onclick="timeTrackingWeekOffset++;renderTimeTracking();">Nächste &raquo;</button>
        </div>
      </div>
    `;

    // Week content: mobile cards or desktop table
    const weekContentHtml = isMobile ? `
      ${mobileWeekCards}
      <div class="tt-mobile-summary">
        <div class="tt-mobile-summary-row">
          <span>Soll</span>
          <span>${formatDuration(targetMinutes)}</span>
        </div>
        <div class="tt-mobile-summary-row">
          <span>Ist</span>
          <span>${formatDuration(weekTotalMinutes)}</span>
        </div>
        <div class="tt-mobile-summary-row tt-mobile-summary-diff">
          <span>+/–</span>
          <span style="color:${weekDiff >= 0 ? 'var(--success)' : 'var(--danger)'};">${(weekDiff >= 0 ? '+' : '') + formatDuration(weekDiff)}</span>
        </div>
      </div>
    ` : `
      <div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:10px;font-size:12px;">
        <span style="display:flex;align-items:center;gap:4px;"><span style="width:14px;height:14px;border-radius:3px;background:rgba(220,38,38,0.3);display:inline-block;"></span> Krank</span>
        <span style="display:flex;align-items:center;gap:4px;"><span style="width:14px;height:14px;border-radius:3px;background:rgba(30,64,175,0.3);display:inline-block;"></span> Urlaub</span>
        <span style="display:flex;align-items:center;gap:4px;"><span style="width:14px;height:14px;border-radius:3px;background:rgba(96,165,250,0.3);display:inline-block;"></span> Halber Urlaubstag</span>
        <span style="display:flex;align-items:center;gap:4px;"><span style="width:14px;height:14px;border-radius:3px;background:rgba(234,179,8,0.3);display:inline-block;"></span> Feiertag</span>
      </div>
      <div class="table-wrapper">
        <table class="time-week-table">
          <thead>
            <tr>
              <th>Tag</th>
              <th>Datum</th>
              <th>Start</th>
              <th>Ende</th>
              <th>Pause</th>
              <th>Arbeitszeit</th>
              <th>+/-</th>
            </tr>
          </thead>
          <tbody>
            ${weekRows}
          </tbody>
          <tfoot>
            <tr style="font-weight:700;border-top:2px solid var(--border);">
              <td colspan="5">Wochensumme</td>
              <td>${formatDuration(weekTotalMinutes)}</td>
              <td style="color:${weekDiff >= 0 ? 'var(--success)' : 'var(--danger)'};">${(weekDiff >= 0 ? '+' : '') + formatDuration(weekDiff)}</td>
            </tr>
            <tr>
              <td colspan="5">Soll</td>
              <td>${formatDuration(targetMinutes)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    `;

    main.innerHTML = `
      <div class="page-header">
        <h2>Zeiterfassung</h2>
      </div>

      ${stampHtml}
      ${staffDropdown}

      ${isMobile ? `
        ${weekNavHtml}
        ${weekContentHtml}
      ` : `
        <div class="card">
          ${weekNavHtml}
          ${weekContentHtml}
        </div>
      `}

      <div class="card" style="margin-top:16px;">
        <div class="card-header">
          <h3>Überstundenkonto</h3>
        </div>
        <div style="text-align:center;padding:12px;">
          <div style="font-size:${isMobile ? '26' : '32'}px;font-weight:700;color:${otColor};">${(totalOT >= 0 ? '+' : '') + formatDuration(totalOT)}</div>
          <div style="color:var(--text-muted);margin-top:4px;">Laufender Saldo</div>
        </div>
      </div>

      ${!isMobile && canSeeDeductions ? `
      <div class="card" style="margin-top:16px;">
        <div class="card-header" style="display:flex;align-items:center;justify-content:space-between;">
          <h3>Überstunden-Abzüge</h3>
          <button class="btn btn-primary btn-sm" onclick="openOvertimeDeductionForm(${effectiveStaffId})">+ Korrektur</button>
        </div>
        <div id="overtime-deductions-table">
          ${deductions.length === 0 ? '<p style="padding:12px;color:var(--text-muted);">Keine Abzüge vorhanden</p>' : `
          <div class="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Stunden</th>
                  <th>Begründung</th>
                  <th>Erstellt von</th>
                  ${canSeeDeductions ? '<th>Aktionen</th>' : ''}
                </tr>
              </thead>
              <tbody>
                ${deductions.map(d => `
                <tr>
                  <td>${formatDate(d.deduction_date)}</td>
                  <td style="color:${d.minutes < 0 ? 'var(--success)' : 'var(--danger)'};">${d.minutes < 0 ? '+' : '-'}${Math.abs(d.minutes / 60).toFixed(1).replace('.', ',')}h</td>
                  <td>${escapeHtml(d.reason || '-')}</td>
                  <td>${escapeHtml(d.created_by_name || '-')}</td>
                  ${canSeeDeductions ? `<td>
                    <button class="btn btn-sm btn-secondary" onclick="editOvertimeDeduction(${d.id}, '${d.deduction_date}', ${d.minutes}, '${escapeHtml(d.reason || '').replace(/'/g, "\\'")}')">Bearbeiten</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteOvertimeDeduction(${d.id})">Löschen</button>
                  </td>` : ''}
                </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          `}
        </div>
      </div>
      ` : ''}
    `;

    // Start live elapsed timer if stamped in or on pause
    if (isOwnView && status.stamped_in) {
      startStampElapsedTimer(status.current_entry.start_time);
    } else if (isOwnView && status.on_pause) {
      startStampElapsedTimer(status.last_entry.end_time);
    }

  } catch (err) {
    main.innerHTML = `<div class="empty-state"><p>Fehler: ${escapeHtml(err.message)}</p></div>`;
  }
}

function openOvertimeDeductionForm(staffId, editId, editDate, editMinutes, editReason) {
  const isEdit = !!editId;
  const today = localDateStr(new Date());
  const html = `
    <form onsubmit="saveOvertimeDeduction(event, ${staffId}, ${editId || 'null'})">
      <div class="form-group">
        <label>Datum *</label>
        <input type="date" id="ot-ded-date" value="${editDate || today}" required>
      </div>
      <div class="form-group">
        <label>Stunden * <span style="font-weight:400;color:var(--text-muted);font-size:12px;">(positiv = Abzug, negativ = Gutschrift)</span></label>
        <input type="number" id="ot-ded-hours" step="0.5" value="${editMinutes ? (editMinutes / 60).toFixed(1) : ''}" required placeholder="z.B. 8 oder -4">
      </div>
      <div class="form-group">
        <label>Begründung</label>
        <input type="text" id="ot-ded-reason" value="${escapeHtml(editReason || '')}" placeholder="z.B. Auszahlung Überstunden">
      </div>
      <div class="form-actions">
        <button class="btn btn-primary" type="submit">${isEdit ? 'Speichern' : 'Hinzufügen'}</button>
        <button class="btn btn-secondary" type="button" onclick="closeModal()">Abbrechen</button>
      </div>
    </form>
  `;
  openModal(isEdit ? 'Korrektur bearbeiten' : 'Neue Überstunden-Korrektur', html);
}

async function saveOvertimeDeduction(e, staffId, editId) {
  e.preventDefault();
  const date = document.getElementById('ot-ded-date').value;
  const hours = parseFloat(document.getElementById('ot-ded-hours').value);
  const reason = document.getElementById('ot-ded-reason').value.trim();
  if (!date || isNaN(hours) || hours === 0) { showToast('Bitte Datum und Stunden eingeben (nicht 0)', 'error'); return; }
  const minutes = Math.round(hours * 60);
  try {
    if (editId) {
      await api(`/api/overtime-deductions/${editId}`, { method: 'PUT', body: { deduction_date: date, minutes, reason } });
      showToast('Abzug aktualisiert');
    } else {
      await api('/api/overtime-deductions', { method: 'POST', body: { staff_id: staffId, deduction_date: date, minutes, reason } });
      showToast('Abzug hinzugefügt');
    }
    closeModal();
    renderTimeTracking();
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
}

function editOvertimeDeduction(id, date, minutes, reason) {
  const staffId = timeTrackingSelectedStaffId || (loggedInUser ? loggedInUser.id : null);
  openOvertimeDeductionForm(staffId, id, date, minutes, reason);
}

async function deleteOvertimeDeduction(id) {
  if (!confirm('Abzug wirklich löschen?')) return;
  try {
    await api(`/api/overtime-deductions/${id}`, { method: 'DELETE' });
    showToast('Abzug gelöscht');
    renderTimeTracking();
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
}

function calcElapsedHMS(startTime) {
  const now = new Date();
  const parts = startTime.split(':').map(Number);
  const sh = parts[0] || 0, sm = parts[1] || 0, ss = parts[2] || 0;
  const startSec = sh * 3600 + sm * 60 + ss;
  const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  const diff = nowSec - startSec;
  if (diff < 0) return '0:00:00';
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

let stampElapsedInterval = null;
function startStampElapsedTimer(startTime) {
  if (stampElapsedInterval) clearInterval(stampElapsedInterval);
  const update = () => {
    const el = document.getElementById('stamp-elapsed');
    if (el) {
      el.textContent = '(' + calcElapsedHMS(startTime) + ')';
    } else {
      clearInterval(stampElapsedInterval);
    }
  };
  update();
  stampElapsedInterval = setInterval(update, 1000);
}

async function silentRefreshTimeTracking() {
  if (currentPage !== 'time-tracking') return;
  if (document.getElementById('modal-overlay')?.classList.contains('active')) return;
  try { await renderTimeTracking(); } catch(e) {}
}

async function doStamp() {
  try {
    const result = await api('/api/time/stamp', { method: 'POST' });
    showToast(result.status === 'stamped_in' ? 'Eingestempelt' : 'Ausgestempelt');
    renderTimeTracking();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function doPause() {
  try {
    await api('/api/time/stamp', { method: 'POST', body: { action: 'pause' } });
    showToast('Pause gestartet');
    renderTimeTracking();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function changeTimeTrackingStaff(staffId) {
  timeTrackingSelectedStaffId = Number(staffId);
  renderTimeTracking();
}

async function openDayDetailModal(staffId, dateStr) {
  try {
    const entries = await api(`/api/time/entries?staff_id=${staffId}&from=${dateStr}&to=${dateStr}`);
    const d = new Date(dateStr + 'T00:00:00');
    const dayName = d.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
    const canEdit = isAdmin() || isVerwaltung() || isBuchhaltung();

    // Build display rows: work entries from DB + pause rows from gaps
    const displayRows = [];
    let totalWorkMinutes = 0;
    let totalPauseMinutes = 0;

    entries.forEach((e, i) => {
      const hasEnd = e.end_time && e.end_time.length >= 5;
      const mins = hasEnd ? calcWorkMinutes(e.start_time, e.end_time, e.break_minutes || 0) : 0;
      totalWorkMinutes += mins;
      displayRows.push({ type: 'work', start: e.start_time, end: e.end_time, mins, notes: e.notes === '__pause__' ? '' : (e.notes || ''), id: e.id });

      // If entry ended with pause and there's a next entry, insert pause gap row
      if (e.notes === '__pause__' && e.end_time && i < entries.length - 1) {
        const nextStart = entries[i + 1].start_time;
        const pauseMins = calcWorkMinutes(e.end_time, nextStart, 0);
        if (pauseMins > 0) {
          totalPauseMinutes += pauseMins;
          displayRows.push({ type: 'pause', start: e.end_time, end: nextStart, mins: pauseMins, notes: '', id: e.id });
        }
      }
    });

    const isMobile = isMobileView();

    let html = `<div style="margin-bottom:16px;display:flex;gap:${isMobile ? '12' : '24'}px;flex-wrap:wrap;">
      <div style="color:var(--text-muted);font-size:${isMobile ? '13' : '14'}px;">Arbeitszeit: <strong style="color:var(--success);">${formatDuration(totalWorkMinutes)}</strong></div>
      <div style="color:var(--text-muted);font-size:${isMobile ? '13' : '14'}px;">Pausenzeit: <strong style="color:var(--warning, #e67e22);">${formatDuration(totalPauseMinutes)}</strong></div>
    </div>`;

    if (displayRows.length > 0) {
      if (isMobile) {
        // Mobile: card layout
        displayRows.forEach(r => {
          const isPause = r.type === 'pause';
          const borderColor = isPause ? 'var(--warning, #e67e22)' : 'var(--success)';
          const bgColor = isPause ? 'rgba(230,126,34,0.06)' : '';
          html += `<div style="border-left:4px solid ${borderColor};${bgColor ? 'background:' + bgColor + ';' : ''}padding:10px 12px;margin-bottom:6px;border-radius:0 var(--radius) var(--radius) 0;border:1px solid var(--border);border-left:4px solid ${borderColor};">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span style="font-weight:700;font-size:14px;">${r.start.slice(0,5)} – ${r.end ? r.end.slice(0,5) : '<span style="color:var(--warning);">läuft</span>'}</span>
              <span style="font-size:13px;font-weight:600;color:${isPause ? 'var(--warning, #e67e22)' : 'var(--success)'};">${isPause ? 'Pause' : 'Arbeit'} · ${r.mins > 0 ? formatDuration(r.mins) : '—'}</span>
            </div>
            ${r.notes ? `<div style="font-size:12px;color:var(--text-muted);margin-top:4px;">${escapeHtml(r.notes)}</div>` : ''}
            ${canEdit && !isPause ? `<div style="display:flex;gap:8px;margin-top:8px;">
              <button class="btn btn-sm btn-secondary" onclick="editTimeEntry(${r.id}, ${staffId}, '${dateStr}')" style="flex:1;">Bearbeiten</button>
              <button class="btn btn-sm btn-danger" onclick="deleteTimeEntry(${r.id}, ${staffId}, '${dateStr}')" style="flex:1;">Löschen</button>
            </div>` : ''}
          </div>`;
        });
      } else {
        // Desktop: table layout
        html += `<table style="width:100%;font-size:13px;">
          <thead><tr><th>Start</th><th>Ende</th><th>Art</th><th>Gesamtzeit</th><th>Notizen</th>${canEdit ? '<th>Aktionen</th>' : ''}</tr></thead>
          <tbody>`;
        displayRows.forEach(r => {
          const isPause = r.type === 'pause';
          const artLabel = isPause
            ? '<span style="color:var(--warning, #e67e22);font-weight:600;">Pause</span>'
            : '<span style="color:var(--success);font-weight:600;">Arbeitszeit</span>';
          html += `<tr${isPause ? ' style="background:rgba(230,126,34,0.06);"' : ''}>
            <td>${r.start}</td>
            <td>${r.end || '<span class="badge badge-yellow">läuft</span>'}</td>
            <td>${artLabel}</td>
            <td>${r.mins > 0 ? formatDuration(r.mins) : '—'}</td>
            <td>${escapeHtml(r.notes)}</td>
            ${canEdit ? `<td>
              <button class="btn btn-sm btn-secondary" onclick="editTimeEntry(${r.id}, ${staffId}, '${dateStr}')">Bearbeiten</button>
              ${canEdit ? `<button class="btn btn-sm btn-danger" onclick="deleteTimeEntry(${r.id}, ${staffId}, '${dateStr}')">Löschen</button>` : ''}
            </td>` : ''}
          </tr>`;
        });
        html += '</tbody></table>';
      }
    } else {
      html += '<div class="empty-state" style="padding:20px;"><p>Keine Einträge für diesen Tag.</p></div>';
    }

    if (canEdit) {
      html += `<div style="margin-top:16px;border-top:1px solid var(--border);padding-top:12px;display:flex;gap:8px;${isMobile ? 'flex-direction:column;' : ''}">
        <button class="btn btn-primary btn-sm" onclick="addManualTimeEntry(${staffId}, '${dateStr}')" ${isMobile ? 'style="width:100%;"' : ''}>+ Manuell hinzufügen</button>
        <button class="btn btn-success btn-sm" onclick="createStandardDay(${staffId}, '${dateStr}')" style="font-weight:700;${isMobile ? 'width:100%;' : ''}">Standardtag (8–17 Uhr)</button>
      </div>`;
    }

    openModal(dayName, html);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function editTimeEntry(entryId, staffId, dateStr) {
  try {
    const entries = await api(`/api/time/entries?staff_id=${staffId}&from=${dateStr}&to=${dateStr}`);
    const entry = entries.find(e => e.id === entryId);
    if (!entry) return showToast('Eintrag nicht gefunden', 'error');

    const isPause = entry.notes === '__pause__';
    const startHHMM = (entry.start_time || '').slice(0, 5);
    const endHHMM = (entry.end_time || '').slice(0, 5);
    const html = `
      <form onsubmit="saveTimeEntry(event, ${entryId}, ${staffId}, '${dateStr}')">
        <div class="form-row">
          <div class="form-group">
            <label>Datum</label>
            <input type="date" name="entry_date" value="${entry.entry_date}" required>
          </div>
          <div class="form-group">
            <label>Art</label>
            <select name="entry_type" required>
              <option value="work"${!isPause ? ' selected' : ''}>Arbeitszeit</option>
              <option value="pause"${isPause ? ' selected' : ''}>Pause</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Start</label>
            <input type="time" name="start_time" value="${startHHMM}" required>
          </div>
          <div class="form-group">
            <label>Ende</label>
            <input type="time" name="end_time" value="${endHHMM}">
          </div>
        </div>
        <div class="form-group">
          <label>Notizen</label>
          <textarea name="notes" rows="2">${escapeHtml(isPause ? '' : (entry.notes || ''))}</textarea>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">Speichern</button>
          <button type="button" class="btn btn-secondary" onclick="openDayDetailModal(${staffId}, '${dateStr}')">Zurück</button>
        </div>
      </form>`;
    openModal('Zeiteintrag bearbeiten', html);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function saveTimeEntry(e, entryId, staffId, dateStr) {
  e.preventDefault();
  const form = e.target;
  try {
    const isPauseType = form.entry_type.value === 'pause';
    const startVal = form.start_time.value;
    const endVal = form.end_time.value;
    await api(`/api/time/entries/${entryId}`, {
      method: 'PUT',
      body: {
        entry_date: form.entry_date.value,
        start_time: startVal && startVal.length === 5 ? startVal + ':00' : startVal,
        end_time: endVal ? (endVal.length === 5 ? endVal + ':00' : endVal) : '',
        break_minutes: 0,
        notes: isPauseType ? '__pause__' : form.notes.value.trim()
      }
    });
    showToast('Eintrag aktualisiert');
    openDayDetailModal(staffId, form.entry_date.value);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function addManualTimeEntry(staffId, dateStr) {
  const html = `
    <form onsubmit="createManualTimeEntry(event, ${staffId}, '${dateStr}')">
      <div class="form-row">
        <div class="form-group">
          <label>Datum</label>
          <input type="date" name="entry_date" value="${dateStr}" required>
        </div>
        <div class="form-group">
          <label>Art</label>
          <select name="entry_type" required>
            <option value="work">Arbeitszeit</option>
            <option value="pause">Pause</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Start</label>
          <input type="time" name="start_time" required>
        </div>
        <div class="form-group">
          <label>Ende</label>
          <input type="time" name="end_time">
        </div>
      </div>
      <div class="form-group">
        <label>Notizen</label>
        <textarea name="notes" rows="2"></textarea>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">Anlegen</button>
        <button type="button" class="btn btn-secondary" onclick="openDayDetailModal(${staffId}, '${dateStr}')">Zurück</button>
      </div>
    </form>`;
  openModal('Manueller Zeiteintrag', html);
}

async function createManualTimeEntry(e, staffId, dateStr) {
  e.preventDefault();
  const form = e.target;
  const isPause = form.entry_type.value === 'pause';
  try {
    const startVal = form.start_time.value;
    const endVal = form.end_time.value;
    await api('/api/time/entries', {
      method: 'POST',
      body: {
        staff_id: staffId,
        entry_date: form.entry_date.value,
        start_time: startVal && startVal.length === 5 ? startVal + ':00' : startVal,
        end_time: endVal ? (endVal.length === 5 ? endVal + ':00' : endVal) : '',
        break_minutes: 0,
        notes: isPause ? '__pause__' : form.notes.value.trim()
      }
    });
    showToast('Eintrag erstellt');
    openDayDetailModal(staffId, form.entry_date.value);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function createStandardDay(staffId, dateStr) {
  try {
    await api('/api/time/entries', {
      method: 'POST',
      body: {
        staff_id: staffId,
        entry_date: dateStr,
        start_time: '08:00:00',
        end_time: '17:00:00',
        break_minutes: 60,
        notes: ''
      }
    });
    showToast('Standardtag (8–17 Uhr, 1h Pause) erstellt');
    openDayDetailModal(staffId, dateStr);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteTimeEntry(entryId, staffId, dateStr) {
  if (!confirm('Zeiteintrag wirklich löschen?')) return;
  try {
    await api(`/api/time/entries/${entryId}`, { method: 'DELETE' });
    showToast('Eintrag gelöscht');
    openDayDetailModal(staffId, dateStr);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ===== PAGE: Vermietung (Rental) =====
const RENTAL_VEHICLE_COLORS = ['#2563eb','#dc2626','#059669','#d97706','#7c3aed','#db2777','#0891b2','#65a30d','#c026d3','#ea580c'];
let rentalCurrentYear = new Date().getFullYear();
let rentalCurrentMonth = new Date().getMonth(); // 0-11
let rentalSelectedVehicle = 'alle';
let rentalDragStartDate = null;
let rentalDragEndDate = null;
let rentalDragging = false;

async function renderVermietung() {
  if (rentalSelectedVehicle === 'alle') {
    renderVermietungOverview();
  } else {
    renderVermietungSingle();
  }
}

async function renderVermietungOverview() {
  const main = document.getElementById('main-content');
  try {
    const allVehicles = await api('/api/fleet-vehicles');
    const vehicleList = allVehicles.filter(v => v.rental_type !== 'lang');
    const year = rentalCurrentYear;
    const month = rentalCurrentMonth;
    const monthNames = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
    const dayNames = ['So','Mo','Di','Mi','Do','Fr','Sa'];
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const holidays = getNRWHolidays(year);

    // Load rentals for this month
    const monthStr = String(month + 1).padStart(2, '0');
    const monthStart = year + '-' + monthStr + '-01';
    const monthEnd = year + '-' + monthStr + '-' + String(daysInMonth).padStart(2, '0');
    const allRentals = await api('/api/rentals?year=' + year);
    // Filter to rentals that overlap with this month
    const monthRentals = allRentals.filter(r => r.start_date <= monthEnd && r.end_date >= monthStart);

    // Build per-vehicle day map
    const vehicleDayMap = {};
    vehicleList.forEach(v => { vehicleDayMap[v.id] = {}; });
    monthRentals.forEach(r => {
      if (!vehicleDayMap[r.vehicle_id]) return;
      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = year + '-' + monthStr + '-' + String(d).padStart(2, '0');
        if (dateStr >= r.start_date && dateStr <= r.end_date) {
          vehicleDayMap[r.vehicle_id][dateStr] = r;
        }
      }
    });

    // Build table in vac-calendar style
    let tableHtml = '<table class="rental-calendar"><tbody>';

    // Header row with day numbers
    tableHtml += '<tr><td class="vac-month-cell" style="font-weight:600;">Fahrzeug</td>';
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = year + '-' + monthStr + '-' + String(d).padStart(2, '0');
      const dt = new Date(dateStr + 'T12:00:00');
      const dow = dt.getDay();
      const isWeekend = dow === 0 || dow === 6;
      const isHoliday = holidays.has(dateStr);
      let cls = 'vac-day-cell';
      let style = 'font-weight:600;font-size:10px;line-height:1.1;';
      if (isHoliday) { cls += ' vac-holiday'; }
      else if (isWeekend) { cls += ' vac-weekend'; }
      tableHtml += '<td class="' + cls + '" style="' + style + '" title="' + (isHoliday ? escapeHtml(holidays.get(dateStr)) : dayNames[dow]) + '"><div style="color:var(--text-muted);">' + dayNames[dow] + '</div>' + d + '</td>';
    }
    tableHtml += '</tr>';

    // Vehicle rows
    vehicleList.forEach(v => {
      const label = escapeHtml((v.license_plate || '?') + ' — ' + (v.manufacturer || '') + ' ' + (v.model || ''));
      tableHtml += '<tr>';
      tableHtml += '<td class="vac-month-cell" style="cursor:pointer;white-space:nowrap;" onclick="rentalSelectVehicle(\'' + v.id + '\')" title="Klicken für Jahresansicht">' + label + '</td>';
      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = year + '-' + monthStr + '-' + String(d).padStart(2, '0');
        const dt = new Date(dateStr + 'T12:00:00');
        const dow = dt.getDay();
        const isWeekend = dow === 0 || dow === 6;
        const isHoliday = holidays.has(dateStr);
        const rental = vehicleDayMap[v.id][dateStr];

        let cls = 'vac-day-cell';
        let cellStyle = '';
        let title = '';
        if (rental) {
          if (isHoliday) {
            cellStyle = 'background:#6ee7b7;color:#065f46;cursor:pointer;';
          } else if (isWeekend) {
            cellStyle = 'background:#6ee7b7;color:#065f46;cursor:pointer;';
          } else {
            cellStyle = 'background:#059669;color:#fff;cursor:pointer;';
          }
          title = escapeHtml(rental.customer_name || 'Vermietet');
        } else if (isHoliday) {
          cls += ' vac-holiday';
          title = escapeHtml(holidays.get(dateStr));
        } else if (isWeekend) {
          cls += ' vac-weekend';
        }
        tableHtml += '<td class="' + cls + '" style="' + cellStyle + '" title="' + title + '"' + (rental ? ' onclick="openRentalForm(' + rental.id + ')"' : '') + '></td>';
      }
      tableHtml += '</tr>';
    });
    tableHtml += '</tbody></table>';

    // Month navigation
    const prevMonth = month === 0 ? 11 : month - 1;
    const prevYear = month === 0 ? year - 1 : year;
    const nextMonth = month === 11 ? 0 : month + 1;
    const nextYear = month === 11 ? year + 1 : year;

    main.innerHTML = `
      <div class="page-header">
        <h2>Vermietung — Übersicht</h2>
        ${isAdmin() ? '<button class="btn btn-primary" onclick="openRentalForm()">Vermietung eintragen</button>' : ''}
      </div>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap;">
        <button class="cal-nav-btn" onclick="rentalCurrentMonth=${prevMonth};rentalCurrentYear=${prevYear};renderVermietung();">\u25C0</button>
        <h3 style="margin:0;min-width:180px;text-align:center;">${monthNames[month]} ${year}</h3>
        <button class="cal-nav-btn" onclick="rentalCurrentMonth=${nextMonth};rentalCurrentYear=${nextYear};renderVermietung();">\u25B6</button>
        <div class="form-group" style="margin:0;margin-left:20px;">
          <select id="rental-vehicle-select" onchange="rentalSelectVehicle(this.value)" style="padding:6px 10px;">
            <option value="alle" selected>Alle Fahrzeuge</option>
            ${vehicleList.map(v => `<option value="${v.id}">${escapeHtml(v.license_plate || '')} - ${escapeHtml(v.manufacturer)} ${escapeHtml(v.model)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:10px;align-items:center;">
        <span style="display:flex;align-items:center;gap:4px;"><span style="width:14px;height:14px;border-radius:3px;background:#059669;display:inline-block;"></span> Vermietet</span>
        <span style="display:flex;align-items:center;gap:4px;"><span style="width:14px;height:14px;border-radius:3px;background:#a8896a;display:inline-block;"></span> Wochenende</span>
        <span style="display:flex;align-items:center;gap:4px;"><span style="width:14px;height:14px;border-radius:3px;background:#facc15;display:inline-block;"></span> Feiertag</span>
        <span style="font-size:12px;color:var(--text-muted);margin-left:8px;">Klicke links auf ein Fahrzeug für die Jahresansicht</span>
      </div>
      <div style="overflow-x:auto;">
        ${tableHtml}
      </div>
    `;
  } catch (err) {
    main.innerHTML = '<p class="error">Fehler: ' + escapeHtml(err.message) + '</p>';
  }
}

async function renderVermietungSingle() {
  const main = document.getElementById('main-content');
  try {
    const [entries, allVehicles] = await Promise.all([
      api('/api/rentals?year=' + rentalCurrentYear),
      api('/api/fleet-vehicles')
    ]);
    const vehicleList = allVehicles.filter(v => v.rental_type !== 'lang');
    const holidays = getNRWHolidays(rentalCurrentYear);
    const months = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];

    const visibleEntries = entries.filter(e => e.vehicle_id === Number(rentalSelectedVehicle));
    const selectedVeh = allVehicles.find(v => v.id === Number(rentalSelectedVehicle));
    const vehicleLabel = selectedVeh ? (selectedVeh.license_plate || '') + ' — ' + selectedVeh.manufacturer + ' ' + selectedVeh.model : '';

    // Build day map
    const dayMap = {};
    visibleEntries.forEach(e => {
      const days = getVacationDaysInRange(e.start_date, e.end_date, holidays);
      days.forEach(d => {
        if (!dayMap[d]) dayMap[d] = [];
        dayMap[d].push(e);
      });
    });

    // Build calendar table
    let tableHtml = '<table class="rental-calendar"><tbody>';
    for (let m = 0; m < 12; m++) {
      const daysInMonth = new Date(rentalCurrentYear, m + 1, 0).getDate();
      tableHtml += '<tr><td class="vac-month-cell">' + months[m] + '</td>';
      for (let d = 1; d <= 31; d++) {
        if (d > daysInMonth) { tableHtml += '<td class="vac-day-cell vac-empty"></td>'; continue; }
        const dateStr = rentalCurrentYear + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
        const dt = new Date(dateStr + 'T12:00:00');
        const dow = dt.getDay();
        const isWeekend = dow === 0 || dow === 6;
        const isHoliday = holidays.has(dateStr);
        const dayEntries = dayMap[dateStr] || [];

        let cellClass = 'vac-day-cell';
        let cellStyle = '';
        let cellTitle = '';
        if (isHoliday) { cellClass += ' vac-holiday'; cellTitle = holidays.get(dateStr); }
        else if (isWeekend) { cellClass += ' vac-weekend'; }
        if (dayEntries.length > 0) {
          if (isHoliday || isWeekend) {
            cellStyle = 'background:#6ee7b7;color:#065f46;';
          } else {
            cellStyle = 'background:#059669;color:#fff;';
          }
          cellTitle = dayEntries[0].customer_name || 'Vermietet';
        }

        if (isAdmin()) {
          tableHtml += '<td class="' + cellClass + '" style="' + cellStyle + 'cursor:pointer;user-select:none;" title="' + escapeHtml(cellTitle) + '" data-rdate="' + dateStr + '" onmousedown="rentalDragStart(\'' + dateStr + '\', event)" onmouseover="rentalDragOver(\'' + dateStr + '\')">' + d + '</td>';
        } else {
          tableHtml += '<td class="' + cellClass + '" style="' + cellStyle + '" title="' + escapeHtml(cellTitle) + '">' + d + '</td>';
        }
      }
      tableHtml += '</tr>';
    }
    tableHtml += '</tbody></table>';

    main.innerHTML = `
      <div class="page-header">
        <h2>Vermietung — ${escapeHtml(vehicleLabel)}</h2>
        ${isAdmin() ? '<button class="btn btn-primary" onclick="openRentalForm()">Vermietung eintragen</button>' : ''}
      </div>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap;">
        <button class="cal-nav-btn" onclick="rentalChangeYear(-1)">\u25C0</button>
        <h3 style="margin:0;min-width:60px;text-align:center;">${rentalCurrentYear}</h3>
        <button class="cal-nav-btn" onclick="rentalChangeYear(1)">\u25B6</button>
        <div class="form-group" style="margin:0;margin-left:20px;">
          <select id="rental-vehicle-select" onchange="rentalSelectVehicle(this.value)" style="padding:6px 10px;">
            <option value="alle">Alle Fahrzeuge</option>
            ${vehicleList.map(v => `<option value="${v.id}" ${rentalSelectedVehicle == v.id ? 'selected' : ''}>${escapeHtml(v.license_plate || '')} - ${escapeHtml(v.manufacturer)} ${escapeHtml(v.model)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:6px;align-items:center;">
        <span style="display:flex;align-items:center;gap:4px;"><span style="width:14px;height:14px;border-radius:3px;background:#059669;display:inline-block;"></span> Vermietet</span>
        <span style="display:flex;align-items:center;gap:4px;"><span style="width:14px;height:14px;border-radius:3px;background:#a8896a;display:inline-block;"></span> Wochenende</span>
        <span style="display:flex;align-items:center;gap:4px;"><span style="width:14px;height:14px;border-radius:3px;background:#facc15;display:inline-block;"></span> Feiertag</span>
      </div>
      <div style="overflow-x:auto;">
        ${tableHtml}
      </div>
      ${isAdmin() ? renderRentalList(visibleEntries) : ''}
    `;
  } catch (err) {
    main.innerHTML = '<p class="error">Fehler: ' + escapeHtml(err.message) + '</p>';
  }
}

function renderRentalList(entries) {
  if (!entries.length) return '';
  return `
    <div class="card" style="margin-top:20px;">
      <div class="card-header"><h3>Vermietungen ${rentalCurrentYear}</h3></div>
      <table class="data-table">
        <thead><tr>
          <th>Fahrzeug</th><th>Kunde</th><th>Von</th><th>Bis</th><th>Notizen</th><th>Aktionen</th>
        </tr></thead>
        <tbody>
          ${entries.map(e => {
            return `<tr>
              <td>${escapeHtml((e.license_plate || '') + ' - ' + (e.manufacturer || '') + ' ' + (e.model || ''))}</td>
              <td>${escapeHtml(e.customer_name || '')}</td>
              <td>${formatDate(e.start_date)}</td>
              <td>${formatDate(e.end_date)}</td>
              <td>${escapeHtml(e.notes || '')}</td>
              <td>
                <button class="btn btn-sm btn-secondary" onclick="openRentalForm(${e.id})">Bearbeiten</button>
                <button class="btn btn-sm btn-danger" onclick="deleteRental(${e.id})">L\u00f6schen</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

function rentalChangeYear(offset) {
  const currentYear = new Date().getFullYear();
  const newYear = rentalCurrentYear + offset;
  if (newYear < currentYear - 5 || newYear > currentYear + 2) return;
  rentalCurrentYear = newYear;
  renderVermietung();
}

function rentalSelectVehicle(val) {
  rentalSelectedVehicle = val;
  renderVermietung();
}

function rentalDragStart(dateStr, e) {
  if (e.button !== 0) return;
  e.preventDefault();
  rentalDragging = true;
  rentalDragStartDate = dateStr;
  rentalDragEndDate = dateStr;
  rentalHighlightRange(dateStr, dateStr);
}

function rentalDragOver(dateStr) {
  if (!rentalDragging) return;
  rentalDragEndDate = dateStr;
  rentalHighlightRange(rentalDragStartDate, rentalDragEndDate);
}

async function rentalDragEnd() {
  if (!rentalDragging) return;
  rentalDragging = false;
  const start = rentalDragStartDate <= rentalDragEndDate ? rentalDragStartDate : rentalDragEndDate;
  const end = rentalDragStartDate <= rentalDragEndDate ? rentalDragEndDate : rentalDragStartDate;
  rentalClearHighlight();

  // Check if there's an existing rental overlapping this range
  try {
    const entries = await api(`/api/rentals?year=${rentalCurrentYear}`);
    const vehicleFilter = rentalSelectedVehicle !== 'alle' ? Number(rentalSelectedVehicle) : null;
    const match = entries.find(e => {
      if (vehicleFilter && e.vehicle_id !== vehicleFilter) return false;
      return e.start_date <= end && e.end_date >= start;
    });
    if (match) {
      openRentalForm(match.id, start, end);
      return;
    }
  } catch (e) {}

  openRentalForm(null, start, end);
}

function rentalHighlightRange(from, to) {
  const start = from <= to ? from : to;
  const end = from <= to ? to : from;
  document.querySelectorAll('.rental-calendar td[data-rdate]').forEach(td => {
    const d = td.dataset.rdate;
    if (d >= start && d <= end) {
      td.classList.add('rental-selecting');
    } else {
      td.classList.remove('rental-selecting');
    }
  });
}

function rentalClearHighlight() {
  document.querySelectorAll('.rental-selecting').forEach(td => td.classList.remove('rental-selecting'));
}

async function openRentalForm(editId, presetStart, presetEnd) {
  const vehicleList = await api('/api/fleet-vehicles');
  let entry = { vehicle_id: rentalSelectedVehicle !== 'alle' ? Number(rentalSelectedVehicle) : '', customer_name: '', start_date: presetStart || '', end_date: presetEnd || presetStart || '', notes: '' };

  let displayStart = presetStart || '';
  let displayEnd = presetEnd || presetStart || '';

  if (editId) {
    try {
      const all = await api(`/api/rentals?year=${rentalCurrentYear}`);
      const found = all.find(e => e.id === editId);
      if (found) {
        entry = found;
        if (presetStart) {
          displayStart = presetStart;
          displayEnd = presetEnd || presetStart;
        } else {
          displayStart = entry.start_date;
          displayEnd = entry.end_date;
        }
      }
    } catch (e) {}
  } else {
    displayStart = presetStart || '';
    displayEnd = presetEnd || presetStart || '';
  }

  const title = editId ? 'Vermietung bearbeiten' : 'Vermietung eintragen';
  const html = `
    <form onsubmit="saveRental(event, ${editId || 'null'})">
      <div class="form-group">
        <label>Fahrzeug *</label>
        <select id="rental-vehicle" required>
          <option value="">-- Auswählen --</option>
          ${vehicleList.map(v => `<option value="${v.id}" ${entry.vehicle_id == v.id ? 'selected' : ''}>${escapeHtml(v.license_plate || '')} - ${escapeHtml(v.manufacturer)} ${escapeHtml(v.model)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Kundenname</label>
        <input type="text" id="rental-customer" value="${escapeHtml(entry.customer_name || '')}">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Von *</label>
          <input type="date" id="rental-start" value="${displayStart}" required>
        </div>
        <div class="form-group">
          <label>Bis *</label>
          <input type="date" id="rental-end" value="${displayEnd}" required>
        </div>
      </div>
      <div class="form-group">
        <label>Notizen</label>
        <textarea id="rental-notes" rows="2">${escapeHtml(entry.notes || '')}</textarea>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">${editId ? 'Speichern' : 'Eintragen'}</button>
        ${editId ? `<button type="button" class="btn btn-danger" onclick="deleteRental(${editId})">L\u00f6schen</button>` : ''}
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Abbrechen</button>
      </div>
    </form>
  `;
  openModal(title, html);
}

async function saveRental(e, id) {
  e.preventDefault();
  const data = {
    vehicle_id: document.getElementById('rental-vehicle').value,
    customer_name: document.getElementById('rental-customer').value.trim(),
    start_date: document.getElementById('rental-start').value,
    end_date: document.getElementById('rental-end').value,
    notes: document.getElementById('rental-notes').value.trim(),
  };
  if (!data.vehicle_id || !data.start_date || !data.end_date) {
    showToast('Bitte alle Pflichtfelder ausf\u00fcllen', 'error');
    return;
  }
  if (data.start_date > data.end_date) {
    showToast('Enddatum muss nach Startdatum liegen', 'error');
    return;
  }
  try {
    if (id) {
      await api(`/api/rentals/${id}`, { method: 'PUT', body: data });
      showToast('Vermietung aktualisiert');
    } else {
      await api('/api/rentals', { method: 'POST', body: data });
      showToast('Vermietung erstellt');
    }
    closeModal();
    renderVermietung();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteRental(id) {
  if (!confirm('Vermietung wirklich l\u00f6schen?')) return;
  try {
    await api(`/api/rentals/${id}`, { method: 'DELETE' });
    showToast('Vermietung gel\u00f6scht');
    closeModal();
    renderVermietung();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ===== PAGE: Anwälte (Lawyers) =====
let _lawyerData = [];
let _lawyerSort = { field: 'name', dir: 'asc' };

async function renderLawyers() {
  const main = document.getElementById('main-content');
  main.innerHTML = `
    <div class="page-header">
      <h2>Anwälte</h2>
      ${isAdmin() ? '<button class="btn btn-primary" onclick="openLawyerForm()">+ Neuer Anwalt</button>' : ''}
    </div>
    <div class="card" style="margin-bottom:20px;">
      <div class="filter-bar">
        <div class="form-group" style="flex:1;min-width:250px;">
          <label>Suche (Name, Kanzlei, Ort, Fachgebiet)</label>
          <input type="text" id="lawyer-search" placeholder="z.B. Müller" oninput="filterLawyers()">
        </div>
        <button class="btn btn-secondary" onclick="document.getElementById('lawyer-search').value='';filterLawyers()">Zurücksetzen</button>
      </div>
    </div>
    <div class="card">
      <div id="lawyer-table-content"><div class="loading">Laden...</div></div>
    </div>
  `;
  try {
    _lawyerData = await api('/api/lawyers');
    renderLawyerTable();
  } catch (err) {
    document.getElementById('lawyer-table-content').innerHTML = '<div class="empty-state"><p>Fehler: ' + escapeHtml(err.message) + '</p></div>';
  }
}

function filterLawyers() {
  renderLawyerTable();
}

function sortLawyers(field) {
  if (_lawyerSort.field === field) {
    _lawyerSort.dir = _lawyerSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    _lawyerSort.field = field;
    _lawyerSort.dir = 'asc';
  }
  renderLawyerTable();
}

function lawyerSortIcon(field) {
  if (_lawyerSort.field !== field) return '<span style="opacity:0.3;">&#9650;</span>';
  return _lawyerSort.dir === 'asc' ? '<span>&#9650;</span>' : '<span>&#9660;</span>';
}

function renderLawyerTable() {
  const container = document.getElementById('lawyer-table-content');
  if (!container) return;
  let data = [..._lawyerData];
  const term = (document.getElementById('lawyer-search')?.value || '').toLowerCase().trim();

  if (term) {
    data = data.filter(l => [l.name, l.kanzlei, l.ort, l.email, l.telefon1].join(' ').toLowerCase().includes(term));
  }

  data.sort((a, b) => {
    const f = _lawyerSort.field;
    if (f === 'id') return _lawyerSort.dir === 'asc' ? a.id - b.id : b.id - a.id;
    let va = (a[f] || '').toString().toLowerCase();
    let vb = (b[f] || '').toString().toLowerCase();
    return _lawyerSort.dir === 'asc' ? va.localeCompare(vb, 'de') : vb.localeCompare(va, 'de');
  });

  if (data.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>Keine Anwälte gefunden.</p></div>';
    return;
  }

  const thStyle = 'cursor:pointer;user-select:none;white-space:nowrap;';
  container.innerHTML = `
    <div style="padding:8px 16px;color:var(--text-muted);font-size:13px;">${data.length} Anwalt${data.length !== 1 ? '\u0308e' : ''}</div>
    <div class="table-wrapper">
      <table>
        <thead><tr>
          <th style="${thStyle}" onclick="sortLawyers('name')">Name ${lawyerSortIcon('name')}</th>
          <th style="${thStyle}" onclick="sortLawyers('kanzlei')">Kanzlei ${lawyerSortIcon('kanzlei')}</th>
          <th style="${thStyle}" onclick="sortLawyers('ort')">Ort ${lawyerSortIcon('ort')}</th>
          <th style="${thStyle}" onclick="sortLawyers('telefon1')">Telefon ${lawyerSortIcon('telefon1')}</th>
          <th style="${thStyle}" onclick="sortLawyers('email')">E-Mail ${lawyerSortIcon('email')}</th>
          <th>Aktionen</th>
        </tr></thead>
        <tbody>
          ${data.map(l => `<tr style="cursor:pointer;" onclick="openLawyerDetail(${l.id})">
            <td><strong>${escapeHtml(l.name || '')}</strong></td>
            <td>${escapeHtml(l.kanzlei || '')}</td>
            <td>${escapeHtml(l.plz ? l.plz + ' ' + (l.ort || '') : l.ort || '')}</td>
            <td>${escapeHtml(l.telefon1 || '')}</td>
            <td>${l.email ? '<a href="mailto:' + escapeHtml(l.email) + '" onclick="event.stopPropagation();">' + escapeHtml(l.email) + '</a>' : ''}</td>
            <td>
              ${isAdmin() ? '<div style="display:flex;gap:6px;white-space:nowrap;"><button class="btn btn-sm btn-primary" onclick="event.stopPropagation();openLawyerForm(' + l.id + ')">Bearbeiten</button><button class="btn btn-sm btn-danger" onclick="event.stopPropagation();deleteLawyer(' + l.id + ',\'' + escapeHtml(l.name || '').replace(/'/g, "\\'") + '\')">Löschen</button></div>' : '<button class="btn btn-sm btn-secondary" onclick="event.stopPropagation();openLawyerDetail(' + l.id + ')">Details</button>'}
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function openLawyerDetail(id) {
  const l = _lawyerData.find(x => x.id === id);
  if (!l) return;
  const fields = [
    ['Anrede', l.anrede],
    ['Name', l.name],
    ['Kanzlei', l.kanzlei],
    ['Straße', l.strasse],
    ['PLZ / Ort', (l.plz || '') + ' ' + (l.ort || '')],
    ['Telefon 1', l.telefon1],
    ['Telefon 2', l.telefon2],
    ['Mobil', l.mobil],
    ['Fax', l.fax],
    ['E-Mail', l.email],
    ['E-Mail 2', l.email2],
    ['Webseite', l.webseite],
    ['Kommentar', l.kommentar]
  ];
  openModal(l.name || 'Anwalt', `
    <table style="width:100%;">
      ${fields.filter(([, v]) => v && v.trim()).map(([label, val]) => `
        <tr>
          <td style="padding:6px 12px 6px 0;font-weight:600;white-space:nowrap;vertical-align:top;color:var(--text-muted);">${escapeHtml(label)}</td>
          <td style="padding:6px 0;white-space:pre-wrap;">${label.includes('Mail') && val.includes('@') ? '<a href="mailto:' + escapeHtml(val.trim()) + '">' + escapeHtml(val.trim()) + '</a>' : label === 'Webseite' && val.trim() ? '<a href="' + (val.trim().startsWith('http') ? '' : 'https://') + escapeHtml(val.trim()) + '" target="_blank">' + escapeHtml(val.trim()) + '</a>' : escapeHtml(val)}</td>
        </tr>
      `).join('')}
    </table>
    <div style="margin-top:20px;display:flex;gap:10px;">
      ${isAdmin() ? '<button class="btn btn-primary" onclick="closeModal();openLawyerForm(' + l.id + ')">Bearbeiten</button>' : ''}
      <button class="btn btn-secondary" onclick="closeModal()">Schließen</button>
    </div>
  `);
}

async function openLawyerForm(editId) {
  let l = { anrede: '', name: '', kanzlei: '', strasse: '', plz: '', ort: '', telefon1: '', telefon2: '', mobil: '', fax: '', email: '', email2: '', webseite: '', fachgebiet: '', kommentar: '' };
  if (editId) {
    try { l = await api('/api/lawyers/' + editId); } catch { showToast('Anwalt nicht gefunden', 'error'); return; }
  }
  openModal(editId ? 'Anwalt bearbeiten' : 'Neuer Anwalt', `
    <form onsubmit="saveLawyer(event, ${editId || 'null'})">
      <div style="background:var(--bg);border-radius:var(--radius);padding:14px 16px;margin-bottom:12px;">
        <div style="font-size:12px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px;">Stammdaten</div>
        <div style="display:grid;grid-template-columns:100px 1fr 1fr;gap:10px 16px;">
          <div class="form-group"><label>Anrede</label>
            <select id="law-anrede">
              ${['', 'Herr', 'Frau', 'Dr.', 'Prof.', 'Prof. Dr.'].map(a => '<option value="' + a + '" ' + (l.anrede === a ? 'selected' : '') + '>' + (a || '(keine)') + '</option>').join('')}
            </select>
          </div>
          <div class="form-group"><label>Name *</label><input type="text" id="law-name" value="${escapeHtml(l.name)}" required></div>
          <div class="form-group"><label>Kanzlei</label><input type="text" id="law-kanzlei" value="${escapeHtml(l.kanzlei)}"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 90px 1fr;gap:10px 16px;">
          <div class="form-group"><label>Straße</label><input type="text" id="law-strasse" value="${escapeHtml(l.strasse)}"></div>
          <div class="form-group"><label>PLZ</label><input type="text" id="law-plz" value="${escapeHtml(l.plz)}"></div>
          <div class="form-group"><label>Ort</label><input type="text" id="law-ort" value="${escapeHtml(l.ort)}"></div>
        </div>
      </div>
      <div style="background:var(--bg);border-radius:var(--radius);padding:14px 16px;">
        <div style="font-size:12px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px;">Kontaktdaten</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px 16px;">
          <div class="form-group"><label>Telefon 1</label><input type="text" id="law-telefon1" value="${escapeHtml(l.telefon1)}"></div>
          <div class="form-group"><label>Telefon 2</label><input type="text" id="law-telefon2" value="${escapeHtml(l.telefon2)}"></div>
          <div class="form-group"><label>Mobil</label><input type="text" id="law-mobil" value="${escapeHtml(l.mobil)}"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 16px;">
          <div class="form-group"><label>E-Mail</label><input type="email" id="law-email" value="${escapeHtml(l.email)}"></div>
          <div class="form-group"><label>E-Mail 2</label><input type="email" id="law-email2" value="${escapeHtml(l.email2)}"></div>
          <div class="form-group"><label>Fax</label><input type="text" id="law-fax" value="${escapeHtml(l.fax)}"></div>
          <div class="form-group"><label>Webseite</label><input type="text" id="law-webseite" value="${escapeHtml(l.webseite)}"></div>
        </div>
        <div class="form-group"><label>Kommentar</label><textarea id="law-kommentar" rows="2">${escapeHtml(l.kommentar)}</textarea></div>
      </div>
      <div style="display:flex;gap:10px;margin-top:16px;">
        <button type="submit" class="btn btn-primary">${editId ? 'Speichern' : 'Anlegen'}</button>
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Abbrechen</button>
      </div>
    </form>
  `);
}

async function saveLawyer(e, editId) {
  e.preventDefault();
  const data = {
    anrede: document.getElementById('law-anrede').value,
    name: document.getElementById('law-name').value,
    kanzlei: document.getElementById('law-kanzlei').value,
    strasse: document.getElementById('law-strasse').value,
    plz: document.getElementById('law-plz').value,
    ort: document.getElementById('law-ort').value,
    telefon1: document.getElementById('law-telefon1').value,
    telefon2: document.getElementById('law-telefon2').value,
    mobil: document.getElementById('law-mobil').value,
    fax: document.getElementById('law-fax').value,
    email: document.getElementById('law-email').value,
    email2: document.getElementById('law-email2').value,
    webseite: document.getElementById('law-webseite').value,
    kommentar: document.getElementById('law-kommentar').value
  };
  try {
    if (editId) {
      await api('/api/lawyers/' + editId, { method: 'PUT', body: data });
      showToast('Anwalt aktualisiert');
    } else {
      await api('/api/lawyers', { method: 'POST', body: data });
      showToast('Anwalt angelegt');
    }
    closeModal();
    renderLawyers();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteLawyer(id, name) {
  if (!confirm('Anwalt "' + name + '" wirklich löschen?')) return;
  try {
    await api('/api/lawyers/' + id, { method: 'DELETE' });
    showToast('Anwalt gelöscht');
    renderLawyers();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ===== PAGE: Vermittler =====
let _vermittlerData = [];
let _vermittlerSort = { field: 'name', dir: 'asc' };

async function renderVermittler() {
  const main = document.getElementById('main-content');
  main.innerHTML = `
    <div class="page-header">
      <h2>Vermittler</h2>
      ${isAdmin() ? '<button class="btn btn-primary" onclick="openVermittlerForm()">+ Neuer Vermittler</button>' : ''}
    </div>
    <div class="card" style="margin-bottom:20px;">
      <div class="filter-bar">
        <div class="form-group" style="flex:1;min-width:250px;">
          <label>Suche (Name, Ort, Branche, E-Mail)</label>
          <input type="text" id="vermittler-search" placeholder="z.B. Werkstatt" oninput="filterVermittler()">
        </div>
        <div class="form-group" style="min-width:150px;">
          <label>Branche</label>
          <select id="vermittler-filter-typ" onchange="filterVermittler()">
            <option value="">Alle</option>
          </select>
        </div>
        <button class="btn btn-secondary" onclick="document.getElementById('vermittler-search').value='';document.getElementById('vermittler-filter-typ').value='';filterVermittler()">Zurücksetzen</button>
      </div>
    </div>
    <div class="card">
      <div id="vermittler-table-content"><div class="loading">Laden...</div></div>
    </div>
  `;
  try {
    _vermittlerData = await api('/api/vermittler');
    // Populate typ filter
    const typs = [...new Set(_vermittlerData.map(v => v.typ).filter(Boolean))].sort();
    const sel = document.getElementById('vermittler-filter-typ');
    if (sel) typs.forEach(t => { const o = document.createElement('option'); o.value = t; o.textContent = t; sel.appendChild(o); });
    renderVermittlerTable();
  } catch (err) {
    document.getElementById('vermittler-table-content').innerHTML = '<div class="empty-state"><p>Fehler: ' + escapeHtml(err.message) + '</p></div>';
  }
}

function filterVermittler() { renderVermittlerTable(); }

function sortVermittler(field) {
  if (_vermittlerSort.field === field) {
    _vermittlerSort.dir = _vermittlerSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    _vermittlerSort.field = field;
    _vermittlerSort.dir = field === 'id' ? 'desc' : 'asc';
  }
  renderVermittlerTable();
}

function vermittlerSortIcon(field) {
  if (_vermittlerSort.field !== field) return '<span style="opacity:0.3;">&#9650;</span>';
  return _vermittlerSort.dir === 'asc' ? '<span>&#9650;</span>' : '<span>&#9660;</span>';
}

function renderVermittlerTable() {
  const container = document.getElementById('vermittler-table-content');
  if (!container) return;
  let data = [..._vermittlerData];
  const term = (document.getElementById('vermittler-search')?.value || '').toLowerCase().trim();
  const typFilter = document.getElementById('vermittler-filter-typ')?.value || '';

  if (term) data = data.filter(v => [v.name, v.ort, v.typ, v.email, v.ansprechpartner, v.telefon].join(' ').toLowerCase().includes(term));
  if (typFilter) data = data.filter(v => v.typ === typFilter);

  data.sort((a, b) => {
    const f = _vermittlerSort.field;
    if (f === 'id') return _vermittlerSort.dir === 'asc' ? a.id - b.id : b.id - a.id;
    let va = (a[f] || '').toString().toLowerCase();
    let vb = (b[f] || '').toString().toLowerCase();
    return _vermittlerSort.dir === 'asc' ? va.localeCompare(vb, 'de') : vb.localeCompare(va, 'de');
  });

  if (data.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>Keine Vermittler gefunden.</p></div>';
    return;
  }

  const thStyle = 'cursor:pointer;user-select:none;white-space:nowrap;';
  container.innerHTML = `
    <div style="padding:8px 16px;color:var(--text-muted);font-size:13px;">${data.length} Vermittler</div>
    <div class="table-wrapper">
      <table>
        <thead><tr>
          <th style="${thStyle}" onclick="sortVermittler('id')">Nr. ${vermittlerSortIcon('id')}</th>
          <th style="${thStyle}" onclick="sortVermittler('name')">Name ${vermittlerSortIcon('name')}</th>
          <th style="${thStyle}" onclick="sortVermittler('typ')">Branche ${vermittlerSortIcon('typ')}</th>
          <th style="${thStyle}" onclick="sortVermittler('ort')">Ort ${vermittlerSortIcon('ort')}</th>
          <th style="${thStyle}" onclick="sortVermittler('telefon')">Telefon ${vermittlerSortIcon('telefon')}</th>
          <th style="${thStyle}" onclick="sortVermittler('email')">E-Mail ${vermittlerSortIcon('email')}</th>
          <th style="${thStyle}" onclick="sortVermittler('ansprechpartner')">Ansprechpartner ${vermittlerSortIcon('ansprechpartner')}</th>
          <th>Aktionen</th>
        </tr></thead>
        <tbody>
          ${data.map(v => `<tr style="cursor:pointer;" onclick="openVermittlerDetail(${v.id})">
            <td>${v.id}</td>
            <td><strong>${escapeHtml(v.name || '')}</strong></td>
            <td>${escapeHtml(v.typ || '')}</td>
            <td>${escapeHtml(v.plz ? v.plz + ' ' + (v.ort || '') : v.ort || '')}</td>
            <td>${escapeHtml(v.telefon || '')}</td>
            <td>${v.email ? '<a href="mailto:' + escapeHtml(v.email) + '" onclick="event.stopPropagation();">' + escapeHtml(v.email) + '</a>' : ''}</td>
            <td>${escapeHtml(v.ansprechpartner || '')}</td>
            <td>
              ${isAdmin() ? '<div style="display:flex;gap:6px;white-space:nowrap;"><button class="btn btn-sm btn-primary" onclick="event.stopPropagation();openVermittlerForm(' + v.id + ')">Bearbeiten</button><button class="btn btn-sm btn-danger" onclick="event.stopPropagation();deleteVermittler(' + v.id + ',\'' + escapeHtml(v.name || '').replace(/'/g, "\\'") + '\')">Löschen</button></div>' : '<button class="btn btn-sm btn-secondary" onclick="event.stopPropagation();openVermittlerDetail(' + v.id + ')">Details</button>'}
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function openVermittlerDetail(id) {
  const v = _vermittlerData.find(x => x.id === id);
  if (!v) return;
  const fmt = (val) => val && String(val).trim() ? escapeHtml(String(val)) : '<span style="color:var(--text-muted);">-</span>';
  const fmtMail = (val) => val && val.includes('@') ? '<a href="mailto:' + escapeHtml(val.trim()) + '">' + escapeHtml(val.trim()) + '</a>' : fmt(val);
  const fmtPhone = (val) => val && String(val).trim() ? '<a href="tel:' + escapeHtml(String(val).trim()) + '">' + escapeHtml(String(val)) + '</a>' : '<span style="color:var(--text-muted);">-</span>';
  const cell = (label, val) => `<div><div style="font-size:11px;color:var(--text-muted);margin-bottom:2px;">${escapeHtml(label)}</div><div style="font-size:14px;">${val}</div></div>`;
  openModal(v.name || 'Vermittler', `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
      <div style="width:42px;height:42px;border-radius:50%;background:var(--primary-light);color:var(--primary);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;flex-shrink:0;">${escapeHtml((v.name || '?')[0].toUpperCase())}</div>
      <div>
        <div style="font-size:16px;font-weight:600;">${escapeHtml(v.name || '')}</div>
        <div style="font-size:13px;color:var(--text-muted);">${v.typ ? escapeHtml(v.typ) : 'Keine Branche'}${v.anrede ? ' · ' + escapeHtml(v.anrede) : ''}</div>
      </div>
    </div>
    <div style="background:var(--bg);border-radius:var(--radius);padding:14px 16px;margin-bottom:12px;">
      <div style="font-size:12px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">Stammdaten</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 24px;">
        ${cell('Straße', fmt(v.strasse))}
        ${cell('PLZ / Ort', fmt((v.plz || '') + (v.plz && v.ort ? ' ' : '') + (v.ort || '')))}
        ${cell('Telefon', fmtPhone(v.telefon))}
        ${cell('Telefon 2', fmtPhone(v.telefon2))}
        ${cell('E-Mail', fmtMail(v.email))}
        ${cell('Ansprechpartner', fmt(v.ansprechpartner))}
        ${cell('Steuernummer', fmt(v.steuernummer))}
        ${cell('Entfernung', fmt(v.entfernung))}
        ${cell('Akquiriert', fmt(v.akquiriert))}
      </div>
      ${v.kommentar && v.kommentar.trim() ? '<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);">' + cell('Kommentar', '<span style="white-space:pre-wrap;">' + escapeHtml(v.kommentar) + '</span>') + '</div>' : ''}
    </div>
    <div style="background:var(--bg);border-radius:var(--radius);padding:14px 16px;">
      <div style="font-size:12px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">Reparaturdaten</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px 24px;">
        ${cell('Stunden 1', fmt(v.stunden1))}
        ${cell('Stunden 2', fmt(v.stunden2))}
        ${cell('Stunden 3', fmt(v.stunden3))}
        ${cell('Hagel', fmt(v.hagel))}
        ${cell('Lackaufschlag', fmt(v.lackaufschlag))}
        ${cell('Teileaufschlag', fmt(v.teileaufschlag))}
        ${cell('Verbringung', fmt(v.verbringung))}
        ${cell('Verbringung Achse', fmt(v.verbringung_achse))}
        ${cell('DEKRA/DRS', v.dekra_drs === 'true' || v.dekra_drs === true ? '<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;background:#d1fae5;color:#065f46;">Ja</span>' : '<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;background:var(--border);color:var(--text-muted);">Nein</span>')}
      </div>
    </div>
    <div style="margin-top:16px;display:flex;gap:10px;">
      ${isAdmin() ? '<button class="btn btn-primary" onclick="closeModal();openVermittlerForm(' + v.id + ')">Bearbeiten</button>' : ''}
      <button class="btn btn-secondary" onclick="closeModal()">Schließen</button>
    </div>
  `);
}

async function openVermittlerForm(editId) {
  let v = { anrede:'Firma', name:'', strasse:'', plz:'', ort:'', ansprechpartner:'', telefon:'', telefon2:'', email:'', typ:'', stunden1:'', stunden2:'', stunden3:'', hagel:'', lackaufschlag:'', verbringung:'', verbringung_achse:'', teileaufschlag:'', kommentar:'', akquiriert:'', steuernummer:'', entfernung:'', dekra_drs:'' };
  if (editId) {
    try { v = await api('/api/vermittler/' + editId); } catch { showToast('Vermittler nicht gefunden', 'error'); return; }
  }
  openModal(editId ? 'Vermittler bearbeiten' : 'Neuer Vermittler', `
    <form onsubmit="saveVermittler(event, ${editId || 'null'})">
      <div style="background:var(--bg);border-radius:var(--radius);padding:14px 16px;margin-bottom:12px;">
        <div style="font-size:12px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px;">Stammdaten</div>
        <div style="display:grid;grid-template-columns:100px 1fr 1fr;gap:10px 16px;">
          <div class="form-group"><label>Anrede</label>
            <select id="verm-anrede">${['Firma','Herr','Frau',''].map(a => '<option value="'+a+'" '+(v.anrede===a?'selected':'')+'>'+(a||'(keine)')+'</option>').join('')}</select>
          </div>
          <div class="form-group"><label>Name *</label><input type="text" id="verm-name" value="${escapeHtml(v.name)}" required></div>
          <div class="form-group"><label>Branche</label>
            <select id="verm-typ">${['','Privatperson','Lackiererei','Werkstatt','Reifenhandel','Taxi','Autohaus','Händler','Vermittler','Anwalt'].map(t => '<option value="'+t+'" '+(v.typ===t?'selected':'')+'>'+(t||'(keine)')+'</option>').join('')}</select>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 90px 1fr;gap:10px 16px;">
          <div class="form-group"><label>Straße</label><input type="text" id="verm-strasse" value="${escapeHtml(v.strasse)}"></div>
          <div class="form-group"><label>PLZ</label><input type="text" id="verm-plz" value="${escapeHtml(v.plz)}"></div>
          <div class="form-group"><label>Ort</label><input type="text" id="verm-ort" value="${escapeHtml(v.ort)}"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 16px;">
          <div class="form-group"><label>Telefon</label><input type="text" id="verm-telefon" value="${escapeHtml(v.telefon)}"></div>
          <div class="form-group"><label>Telefon 2</label><input type="text" id="verm-telefon2" value="${escapeHtml(v.telefon2)}"></div>
          <div class="form-group"><label>E-Mail</label><input type="text" id="verm-email" value="${escapeHtml(v.email)}"></div>
          <div class="form-group"><label>Ansprechpartner</label><input type="text" id="verm-ansprechpartner" value="${escapeHtml(v.ansprechpartner)}"></div>
          <div class="form-group"><label>Steuernummer</label><input type="text" id="verm-steuernummer" value="${escapeHtml(v.steuernummer)}"></div>
          <div class="form-group"><label>Entfernung</label><input type="text" id="verm-entfernung" value="${escapeHtml(v.entfernung)}"></div>
          <div class="form-group"><label>Akquiriert</label><input type="text" id="verm-akquiriert" value="${escapeHtml(v.akquiriert)}"></div>
        </div>
        <div class="form-group"><label>Kommentar</label><textarea id="verm-kommentar" rows="2">${escapeHtml(v.kommentar)}</textarea></div>
      </div>
      <div style="background:var(--bg);border-radius:var(--radius);padding:14px 16px;">
        <div style="font-size:12px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px;">Reparaturdaten</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px 16px;">
          <div class="form-group"><label>Stunden 1</label><input type="text" id="verm-stunden1" value="${escapeHtml(v.stunden1)}"></div>
          <div class="form-group"><label>Stunden 2</label><input type="text" id="verm-stunden2" value="${escapeHtml(v.stunden2)}"></div>
          <div class="form-group"><label>Stunden 3</label><input type="text" id="verm-stunden3" value="${escapeHtml(v.stunden3)}"></div>
          <div class="form-group"><label>Hagel</label><input type="text" id="verm-hagel" value="${escapeHtml(v.hagel)}"></div>
          <div class="form-group"><label>Lackaufschlag</label><input type="text" id="verm-lackaufschlag" value="${escapeHtml(v.lackaufschlag)}"></div>
          <div class="form-group"><label>Teileaufschlag</label><input type="text" id="verm-teileaufschlag" value="${escapeHtml(v.teileaufschlag)}"></div>
          <div class="form-group"><label>Verbringung</label><input type="text" id="verm-verbringung" value="${escapeHtml(v.verbringung)}"></div>
          <div class="form-group"><label>Verbr. Achse</label><input type="text" id="verm-verbringung_achse" value="${escapeHtml(v.verbringung_achse)}"></div>
          <div class="form-group" style="display:flex;align-items:center;gap:8px;padding-top:22px;"><input type="checkbox" id="verm-dekra_drs" ${v.dekra_drs === 'true' || v.dekra_drs === true ? 'checked' : ''} style="width:auto;margin:0;"><label for="verm-dekra_drs" style="margin:0;cursor:pointer;">DEKRA/DRS</label></div>
        </div>
      </div>
      <div style="display:flex;gap:10px;margin-top:16px;">
        <button type="submit" class="btn btn-primary">${editId ? 'Speichern' : 'Anlegen'}</button>
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Abbrechen</button>
      </div>
    </form>
  `, 'modal-wide');
}

async function saveVermittler(e, editId) {
  e.preventDefault();
  const fields = ['anrede','name','strasse','plz','ort','ansprechpartner','telefon','telefon2','email','typ','stunden1','stunden2','stunden3','hagel','lackaufschlag','verbringung','verbringung_achse','teileaufschlag','kommentar','akquiriert','steuernummer','entfernung','dekra_drs'];
  const data = {};
  fields.forEach(f => {
    const el = document.getElementById('verm-' + f);
    if (!el) { data[f] = ''; return; }
    data[f] = el.type === 'checkbox' ? String(el.checked) : (el.value || '');
  });
  try {
    if (editId) {
      await api('/api/vermittler/' + editId, { method: 'PUT', body: data });
      showToast('Vermittler aktualisiert');
    } else {
      await api('/api/vermittler', { method: 'POST', body: data });
      showToast('Vermittler angelegt');
    }
    closeModal();
    renderVermittler();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteVermittler(id, name) {
  if (!confirm('Vermittler "' + name + '" wirklich löschen?')) return;
  try {
    await api('/api/vermittler/' + id, { method: 'DELETE' });
    showToast('Vermittler gelöscht');
    renderVermittler();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ===== PAGE: Akten (Case Files) =====
const AKTEN_STATUS = ['offen', 'in Bearbeitung', 'abgeschlossen', 'storniert'];
const AKTEN_ZAHLUNGSSTATUS = ['offen', 'teilweise bezahlt', 'bezahlt', 'Mahnung', 'storniert'];
const MIETART_OPTIONS = ['Reparaturmiete', 'Totalschadenmiete'];

let _aktenData = [];
let _aktenSort = { field: 'id', dir: 'desc' };
let _aktenFilterState = { search: '', status: '' };

async function renderAkten() {
  const main = document.getElementById('main-content');
  main.innerHTML = `
    <div class="page-header">
      <h2>Akten</h2>
      ${isAdmin() ? '<button class="btn btn-primary" onclick="openAkteForm()">+ Neue Akte</button>' : ''}
    </div>
    <div class="card" style="margin-bottom:20px;">
      <div class="filter-bar">
        <div class="form-group" style="flex:1;min-width:250px;">
          <label>Suche (Aktennr., Kundenname, Status)</label>
          <input type="text" id="akten-search" placeholder="z.B. AK-2026-001" oninput="filterAkten()">
        </div>
        <div class="form-group" style="min-width:150px;">
          <label>Status</label>
          <select id="akten-filter-status" onchange="filterAkten()">
            <option value="">Alle</option>
            ${AKTEN_STATUS.map(s => '<option value="' + s + '">' + s + '</option>').join('')}
          </select>
        </div>
        <button class="btn btn-secondary" onclick="clearAktenFilter()">Zurücksetzen</button>
      </div>
    </div>
    <div class="card">
      <div id="akten-table-content"><div class="loading">Laden...</div></div>
    </div>
  `;
  // Restore persisted filter state
  const _sEl = document.getElementById('akten-search');
  const _stEl = document.getElementById('akten-filter-status');
  if (_sEl) _sEl.value = _aktenFilterState.search;
  if (_stEl) _stEl.value = _aktenFilterState.status;
  try {
    _aktenData = await api('/api/akten');
    renderAktenTable();
  } catch (err) {
    document.getElementById('akten-table-content').innerHTML = '<div class="empty-state"><p>Fehler: ' + escapeHtml(err.message) + '</p></div>';
  }
}

function clearAktenFilter() {
  _aktenFilterState = { search: '', status: '' };
  const s = document.getElementById('akten-search'); if (s) s.value = '';
  const st = document.getElementById('akten-filter-status'); if (st) st.value = '';
  filterAkten();
}

function filterAkten() {
  renderAktenTable();
}

function sortAkten(field) {
  if (_aktenSort.field === field) {
    _aktenSort.dir = _aktenSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    _aktenSort.field = field;
    _aktenSort.dir = field === 'id' ? 'desc' : 'asc';
  }
  renderAktenTable();
}

function aktenSortIcon(field) {
  if (_aktenSort.field !== field) return '<span style="opacity:0.3;">&#9650;</span>';
  return _aktenSort.dir === 'asc' ? '<span>&#9650;</span>' : '<span>&#9660;</span>';
}

function aktenStatusBadge(status) {
  const colors = { 'offen': '#3b82f6', 'in Bearbeitung': '#f59e0b', 'abgeschlossen': '#10b981', 'storniert': '#6b7280' };
  const bg = colors[status] || '#6b7280';
  return '<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;color:#fff;background:' + bg + ';">' + escapeHtml(status) + '</span>';
}

function aktenZahlungBadge(status) {
  const colors = { 'offen': '#ef4444', 'teilweise bezahlt': '#f59e0b', 'bezahlt': '#10b981', 'Mahnung': '#dc2626', 'storniert': '#6b7280' };
  const bg = colors[status] || '#6b7280';
  return '<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;color:#fff;background:' + bg + ';">' + escapeHtml(status) + '</span>';
}

function aktenWiedervorlageBadge(datum) {
  if (!datum) return '<span style="color:var(--text-muted);">-</span>';
  const d = datum.split('-').reverse().join('.');
  const isOverdue = new Date(datum) < new Date(new Date().toDateString());
  if (isOverdue) {
    return '<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;color:#fff;background:#ef4444;">' + escapeHtml(d) + '</span>';
  }
  return escapeHtml(d);
}

function renderAktenTable() {
  const container = document.getElementById('akten-table-content');
  if (!container) return;
  let data = [..._aktenData];

  const searchTerm = (document.getElementById('akten-search')?.value || '').toLowerCase().trim();
  const statusFilter = document.getElementById('akten-filter-status')?.value || '';
  _aktenFilterState = { search: searchTerm, status: statusFilter };

  if (searchTerm) {
    data = data.filter(a => {
      const name = (a.customer_name || a.kunde || '').toLowerCase();
      return (a.aktennummer || '').toLowerCase().includes(searchTerm)
        || name.includes(searchTerm)
        || (a.status || '').toLowerCase().includes(searchTerm);
    });
  }
  if (statusFilter) data = data.filter(a => a.status === statusFilter);

  data.sort((a, b) => {
    const f = _aktenSort.field;
    if (f === 'id') { return _aktenSort.dir === 'asc' ? a.id - b.id : b.id - a.id; }
    let va = (a[f] || '').toString().toLowerCase();
    let vb = (b[f] || '').toString().toLowerCase();
    return _aktenSort.dir === 'asc' ? va.localeCompare(vb, 'de') : vb.localeCompare(va, 'de');
  });

  if (data.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>Keine Akten gefunden.</p></div>';
    return;
  }

  const thStyle = 'cursor:pointer;user-select:none;white-space:nowrap;';
  container.innerHTML = `
    <div style="padding:8px 16px;color:var(--text-muted);font-size:13px;">${data.length} Akte${data.length !== 1 ? 'n' : ''}</div>
    <div class="table-wrapper">
      <table>
        <thead><tr>
          <th style="${thStyle}" onclick="sortAkten('aktennummer')">Aktennr. ${aktenSortIcon('aktennummer')}</th>
          <th style="${thStyle}" onclick="sortAkten('customer_name')">Kunde ${aktenSortIcon('customer_name')}</th>
          <th style="${thStyle}" onclick="sortAkten('mietart')">Mietart ${aktenSortIcon('mietart')}</th>
          <th style="${thStyle}" onclick="sortAkten('status')">Status ${aktenSortIcon('status')}</th>
          <th style="${thStyle}" onclick="sortAkten('wiedervorlage_datum')">Wiedervorlage ${aktenSortIcon('wiedervorlage_datum')}</th>
          <th>Aktionen</th>
        </tr></thead>
        <tbody>
          ${data.map(a => `<tr style="cursor:pointer;" onclick="navigate('akte-detail', ${a.id})">
            <td><strong>${escapeHtml(a.aktennummer || '')}</strong></td>
            <td>${escapeHtml(a.customer_name || a.kunde || '')}</td>
            <td>${escapeHtml(a.mietart || '')}</td>
            <td>${aktenStatusBadge(a.status)}</td>
            <td>${aktenWiedervorlageBadge(a.wiedervorlage_datum)}</td>
            <td>
              ${isAdmin() ? '<button class="btn btn-sm btn-primary" onclick="event.stopPropagation();openAkteForm(' + a.id + ')">Bearbeiten</button> <button class="btn btn-sm btn-danger" onclick="event.stopPropagation();deleteAkte(' + a.id + ',\'' + escapeHtml(a.aktennummer || '').replace(/\'/g, "\\'") + '\')">Löschen</button>' : '<button class="btn btn-sm btn-secondary" onclick="event.stopPropagation();navigate(\'akte-detail\', ' + a.id + ')">Details</button>'}
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function renderAkteDetail(id) {
  const main = document.getElementById('main-content');
  currentAkteId = id;
  try {
    const a = await api(`/api/akten/${id}`);

    // Helper functions (same pattern as Vermittler detail)
    const fmt = (val) => val && String(val).trim() ? escapeHtml(String(val)) : '<span style="color:var(--text-muted);">-</span>';
    const fmtMail = (val) => val && val.includes('@') ? '<a href="mailto:' + escapeHtml(val.trim()) + '">' + escapeHtml(val.trim()) + '</a>' : fmt(val);
    const fmtPhone = (val) => val && String(val).trim() ? '<a href="tel:' + escapeHtml(String(val).trim()) + '">' + escapeHtml(String(val)) + '</a>' : '<span style="color:var(--text-muted);">-</span>';
    const cell = (label, val) => `<div><div style="font-size:11px;color:var(--text-muted);margin-bottom:2px;">${escapeHtml(label)}</div><div style="font-size:14px;">${val}</div></div>`;

    // Badge helpers
    const badgeJa = '<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;background:#d1fae5;color:#065f46;">Ja</span>';
    const badgeNein = '<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;background:var(--border);color:var(--text-muted);">Nein</span>';
    const badgeNichtVerknuepft = '<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;background:var(--border);color:var(--text-muted);">Nicht verkn\u00fcpft</span>';
    const badgeLegacy = '<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;background:#fef3c7;color:#92400e;">nicht verkn\u00fcpft</span>';

    // Mietdauer calculation
    function mietdauerTage(startDate, endDate) {
      if (!startDate || !endDate) return null;
      const start = new Date(startDate + 'T00:00:00');
      const end = new Date(endDate + 'T00:00:00');
      return Math.max(0, Math.round((end - start) / 86400000));
    }

    // === Customer block ===
    let kundenHtml;
    if (a.customer) {
      const c = a.customer;
      const displayName = (c.customer_type === 'Firmenkunde' || c.customer_type === 'Werkstatt')
        ? c.company_name : `${c.first_name} ${c.last_name}`;
      kundenHtml = `
        ${cell('Name', fmt(displayName))}
        ${cell('Telefon', fmtPhone(c.phone))}
        ${cell('E-Mail', fmtMail(c.email))}`;
    } else if (a.kunde && a.kunde.trim()) {
      kundenHtml = `${cell('Kunde (Altdaten)', escapeHtml(a.kunde) + ' ' + badgeLegacy)}`;
    } else {
      kundenHtml = `<div style="color:var(--text-muted);">Kein Kunde hinterlegt</div>`;
    }

    // === Unfall block ===
    const unfallHtml = `
      ${cell('Unfalldatum', a.unfalldatum ? fmt(formatDate(a.unfalldatum)) : fmt(''))}
      ${cell('Unfallort', fmt(a.unfallort))}
      ${cell('Polizei vor Ort', a.polizei_vor_ort ? badgeJa : badgeNein)}`;

    // === Mietvorgang block ===
    let mietvorgangHtml;
    if (a.rental) {
      const r = a.rental;
      const dauer = mietdauerTage(r.start_date, r.end_date);
      mietvorgangHtml = `
        ${cell('Kennzeichen', fmt(r.license_plate))}
        ${cell('Fahrzeug', fmt((r.manufacturer || '') + ' ' + (r.model || '')))}
        ${cell('Mietbeginn', r.start_date ? fmt(formatDate(r.start_date)) : fmt(''))}
        ${cell('Mietende', r.end_date ? fmt(formatDate(r.end_date)) : fmt(''))}
        ${cell('Mietdauer', dauer !== null ? dauer + ' Tage' : fmt(''))}`;
    } else {
      mietvorgangHtml = `<div style="color:var(--text-muted);">Kein Mietvorgang verkn\u00fcpft</div>`;
    }

    // === Mietart + Wiedervorlage block ===
    const aktendetailsHtml = `
      ${cell('Mietart', a.mietart ? fmt(a.mietart) : fmt(''))}
      ${cell('Wiedervorlagedatum', a.wiedervorlage_datum ? fmt(formatDate(a.wiedervorlage_datum)) : fmt(''))}
      ${cell('Status', aktenStatusBadge(a.status))}
      ${cell('Zahlungsstatus', aktenZahlungBadge(a.zahlungsstatus))}
      ${cell('Anwalt', fmt(a.anwalt))}
      ${cell('Vorlage', fmt(a.vorlage))}`;

    // === Vermittler block ===
    let vermittlerHtml;
    if (a.vermittler_obj) {
      const v = a.vermittler_obj;
      vermittlerHtml = `
        ${cell('Name', fmt(v.name))}
        ${cell('Telefon', fmtPhone(v.telefon))}
        ${cell('E-Mail', fmtMail(v.email))}
        ${cell('Ansprechpartner', fmt(v.ansprechpartner))}`;
    } else if (a.vermittler && a.vermittler.trim()) {
      vermittlerHtml = `${cell('Vermittler (Altdaten)', escapeHtml(a.vermittler) + ' ' + badgeLegacy)}`;
    } else {
      vermittlerHtml = `<div style="color:var(--text-muted);">${badgeNichtVerknuepft}</div>`;
    }

    // === Versicherung block ===
    let versicherungHtml;
    if (a.versicherung_obj) {
      const ins = a.versicherung_obj;
      versicherungHtml = `
        ${cell('Name', fmt(ins.name))}
        ${cell('Telefon', fmtPhone(ins.telefon || ins.phone))}
        ${cell('E-Mail', fmtMail(ins.email))}
        ${cell('Ansprechpartner', fmt(ins.ansprechpartner || ins.contact_person))}`;
    } else {
      versicherungHtml = `<div style="color:var(--text-muted);">${badgeNichtVerknuepft}</div>`;
    }

    // === Assemble full page ===
    main.innerHTML = `
      <a class="back-link" onclick="navigate('akten')">&larr; Zur\u00fcck zur Aktenliste</a>
      <div class="page-header">
        <h2>Akte ${escapeHtml(a.aktennummer || '#' + a.id)}</h2>
        <div>
          ${(isAdmin() || isVerwaltung() || isBuchhaltung())
            ? '<button class="btn btn-primary" onclick="openAkteForm(' + id + ')">Bearbeiten</button>' : ''}
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div style="background:var(--bg);border-radius:var(--radius);padding:14px 16px;">
          <div style="font-size:12px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">Kundendaten</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 24px;">
            ${kundenHtml}
          </div>
        </div>

        <div style="background:var(--bg);border-radius:var(--radius);padding:14px 16px;">
          <div style="font-size:12px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">Unfalldaten</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 24px;">
            ${unfallHtml}
          </div>
        </div>
      </div>

      <div style="background:var(--bg);border-radius:var(--radius);padding:14px 16px;margin-top:16px;">
        <div style="font-size:12px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">Mietvorgang</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 24px;">
          ${mietvorgangHtml}
        </div>
      </div>

      <div style="background:var(--bg);border-radius:var(--radius);padding:14px 16px;margin-top:16px;">
        <div style="font-size:12px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">Aktendetails</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px 24px;">
          ${aktendetailsHtml}
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px;">
        <div style="background:var(--bg);border-radius:var(--radius);padding:14px 16px;">
          <div style="font-size:12px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">Vermittler</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 24px;">
            ${vermittlerHtml}
          </div>
        </div>

        <div style="background:var(--bg);border-radius:var(--radius);padding:14px 16px;">
          <div style="font-size:12px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">Versicherung</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 24px;">
            ${versicherungHtml}
          </div>
        </div>
      </div>

      ${a.notizen && a.notizen.trim() ? `
      <div style="background:var(--bg);border-radius:var(--radius);padding:14px 16px;margin-top:16px;">
        <div style="font-size:12px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">Notizen</div>
        <div style="white-space:pre-wrap;font-size:14px;">${escapeHtml(a.notizen)}</div>
      </div>` : ''}
    `;
  } catch (err) {
    main.innerHTML = '<div class="empty-state"><p>Fehler beim Laden: ' + escapeHtml(err.message) + '</p></div>';
  }
}

function openAkteDetail(id) {
  const a = _aktenData.find(x => x.id === id);
  if (!a) return;
  const fields = [
    ['Aktennummer', a.aktennummer],
    ['Datum', a.datum ? a.datum.split('-').reverse().join('.') : ''],
    ['Kunde', a.kunde],
    ['Anwalt', a.anwalt],
    ['Vorlage', a.vorlage],
    ['Zahlungsstatus', a.zahlungsstatus],
    ['Vermittler', a.vermittler],
    ['Status', a.status],
    ['Notizen', a.notizen]
  ];
  openModal('Akte ' + (a.aktennummer || '#' + a.id), `
    <table style="width:100%;">
      ${fields.filter(([, v]) => v && v.trim()).map(([label, val]) => `
        <tr>
          <td style="padding:6px 12px 6px 0;font-weight:600;white-space:nowrap;vertical-align:top;color:var(--text-muted);">${escapeHtml(label)}</td>
          <td style="padding:6px 0;white-space:pre-wrap;">${escapeHtml(val)}</td>
        </tr>
      `).join('')}
    </table>
    <div style="margin-top:20px;display:flex;gap:10px;">
      ${isAdmin() ? '<button class="btn btn-primary" onclick="closeModal();openAkteForm(' + a.id + ')">Bearbeiten</button>' : ''}
      <button class="btn btn-secondary" onclick="closeModal()">Schließen</button>
    </div>
  `);
}

async function openAkteForm(editId) {
  let a = {
    aktennummer: '', datum: '', kunde: '', anwalt: '', vorlage: '',
    zahlungsstatus: 'offen', vermittler: '', status: 'offen', notizen: '',
    customer_id: null, vermittler_id: null, versicherung_id: null, rental_id: null,
    unfalldatum: '', unfallort: '', polizei_vor_ort: 0, mietart: '', wiedervorlage_datum: ''
  };
  let vermittlerList = [], versicherungen = [], rentals = [];

  try {
    const results = await Promise.all([
      api('/api/vermittler'),
      api('/api/insurances'),
      api('/api/rentals')
    ]);
    vermittlerList = results[0] || [];
    versicherungen = results[1] || [];
    rentals = results[2] || [];
    if (editId) a = await api('/api/akten/' + editId);
  } catch (err) {
    showToast('Fehler beim Laden der Formulardaten', 'error');
    return;
  }

  // Pre-compute customer display name for edit mode
  let customerDisplayText = '';
  if (a.customer && a.customer_id) {
    const c = a.customer;
    customerDisplayText = (c.customer_type === 'Firmenkunde' || c.customer_type === 'Werkstatt')
      ? (c.company_name || '') : `${c.last_name || ''}, ${c.first_name || ''}`;
  }

  openModal(editId ? 'Akte bearbeiten' : 'Neue Akte', `
    <form onsubmit="saveAkte(event, ${editId || 'null'})">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="form-group"><label>Aktennummer *</label><input type="text" id="akte-nummer" value="${escapeHtml(a.aktennummer)}" required></div>
        <div class="form-group"><label>Datum</label><input type="date" id="akte-datum" value="${escapeHtml(a.datum)}"></div>
      </div>

      <div class="form-group" style="position:relative;">
        <label>Kunde suchen</label>
        <input type="text" id="akte-customer-search" placeholder="Name oder Firma eingeben..."
          oninput="searchAkteCustomer()" autocomplete="off"
          ${a.customer_id ? 'style="display:none;"' : ''}>
        <div class="search-dropdown" id="akte-customer-dropdown"></div>
      </div>
      <div id="akte-customer-selected" style="${a.customer_id ? '' : 'display:none;'}margin-bottom:16px;">
        ${a.customer_id ? '<div class="search-selected"><span>' + escapeHtml(customerDisplayText) + '</span><button class="btn btn-sm btn-secondary" type="button" onclick="clearAkteCustomer()">\u00c4ndern</button></div>' : ''}
      </div>
      <input type="hidden" id="akte-customer-id" value="${a.customer_id || ''}">

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="form-group"><label>Vermittler</label>
          <select id="akte-vermittler-id">
            <option value="">\u2014 kein Vermittler \u2014</option>
            ${vermittlerList.map(v => '<option value="' + v.id + '" ' + (a.vermittler_id == v.id ? 'selected' : '') + '>' + escapeHtml(v.name || '') + '</option>').join('')}
          </select>
        </div>
        <div class="form-group"><label>Versicherung</label>
          <select id="akte-versicherung-id">
            <option value="">\u2014 keine Versicherung \u2014</option>
            ${versicherungen.map(ins => '<option value="' + ins.id + '" ' + (a.versicherung_id == ins.id ? 'selected' : '') + '>' + escapeHtml(ins.name || '') + '</option>').join('')}
          </select>
        </div>
      </div>

      <div class="form-group"><label>Mietvorgang</label>
        <select id="akte-rental-id">
          <option value="">\u2014 kein Mietvorgang \u2014</option>
          ${rentals.map(r => '<option value="' + r.id + '" ' + (a.rental_id == r.id ? 'selected' : '') + '>' + escapeHtml(r.license_plate || '') + ' ' + escapeHtml((r.manufacturer || '') + ' ' + (r.model || '')) + ' \u00b7 ' + (r.start_date ? formatDate(r.start_date) : '') + '\u2013' + (r.end_date ? formatDate(r.end_date) : '') + (r.customer_name ? ' \u00b7 ' + escapeHtml(r.customer_name) : '') + '</option>').join('')}
        </select>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="form-group"><label>Unfalldatum</label><input type="date" id="akte-unfalldatum" value="${escapeHtml(a.unfalldatum)}"></div>
        <div class="form-group"><label>Unfallort</label><input type="text" id="akte-unfallort" value="${escapeHtml(a.unfallort)}" placeholder="z.B. Aachen, B1"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="form-group" style="display:flex;align-items:center;gap:8px;padding-top:22px;">
          <input type="checkbox" id="akte-polizei" ${a.polizei_vor_ort ? 'checked' : ''} style="width:auto;margin:0;">
          <label for="akte-polizei" style="margin:0;cursor:pointer;">Polizei vor Ort</label>
        </div>
        <div class="form-group"><label>Mietart</label>
          <select id="akte-mietart">
            <option value="">\u2014 keine \u2014</option>
            ${MIETART_OPTIONS.map(m => '<option value="' + m + '" ' + (a.mietart === m ? 'selected' : '') + '>' + m + '</option>').join('')}
          </select>
        </div>
      </div>
      <div class="form-group"><label>Wiedervorlagedatum</label><input type="date" id="akte-wiedervorlage-datum" value="${escapeHtml(a.wiedervorlage_datum)}"></div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="form-group"><label>Anwalt</label><input type="text" id="akte-anwalt" value="${escapeHtml(a.anwalt)}"></div>
        <div class="form-group"><label>Vorlage</label><input type="text" id="akte-vorlage" value="${escapeHtml(a.vorlage)}"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="form-group"><label>Zahlungsstatus</label>
          <select id="akte-zahlungsstatus">
            ${AKTEN_ZAHLUNGSSTATUS.map(s => '<option value="' + s + '" ' + (a.zahlungsstatus === s ? 'selected' : '') + '>' + s + '</option>').join('')}
          </select>
        </div>
        <div class="form-group"><label>Status</label>
          <select id="akte-status">
            ${AKTEN_STATUS.map(s => '<option value="' + s + '" ' + (a.status === s ? 'selected' : '') + '>' + s + '</option>').join('')}
          </select>
        </div>
      </div>
      <div class="form-group"><label>Notizen</label><textarea id="akte-notizen" rows="3">${escapeHtml(a.notizen)}</textarea></div>
      <div style="display:flex;gap:10px;margin-top:16px;">
        <button type="submit" class="btn btn-primary">${editId ? 'Speichern' : 'Anlegen'}</button>
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Abbrechen</button>
      </div>
    </form>
  `, 'modal-wide');
}

async function searchAkteCustomer() {
  const term = document.getElementById('akte-customer-search').value.trim();
  const dropdown = document.getElementById('akte-customer-dropdown');
  if (term.length < 2) { dropdown.style.display = 'none'; return; }
  try {
    const customers = await api(`/api/customers?search=${encodeURIComponent(term)}`);
    if (customers.length === 0) {
      dropdown.innerHTML = '<div class="search-dropdown-item" style="color:var(--text-muted);">Keine Kunden gefunden</div>';
    } else {
      dropdown.innerHTML = customers.slice(0, 10).map(c => {
        const name = (c.customer_type === 'Firmenkunde' || c.customer_type === 'Werkstatt')
          ? c.company_name : `${c.last_name}, ${c.first_name}`;
        const sub = c.city ? ` \u2014 ${c.city}` : '';
        return `<div class="search-dropdown-item" onclick="selectAkteCustomer(${c.id}, '${escapeHtml(name + sub)}')">${escapeHtml(name + sub)}</div>`;
      }).join('');
    }
    dropdown.style.display = 'block';
  } catch { dropdown.style.display = 'none'; }
}

function selectAkteCustomer(id, displayName) {
  document.getElementById('akte-customer-id').value = id;
  document.getElementById('akte-customer-dropdown').style.display = 'none';
  document.getElementById('akte-customer-search').style.display = 'none';
  document.getElementById('akte-customer-selected').style.display = '';
  document.getElementById('akte-customer-selected').innerHTML = `
    <div class="search-selected">
      <span>${escapeHtml(displayName)}</span>
      <button class="btn btn-sm btn-secondary" type="button" onclick="clearAkteCustomer()">\u00c4ndern</button>
    </div>`;
}

function clearAkteCustomer() {
  document.getElementById('akte-customer-id').value = '';
  document.getElementById('akte-customer-search').value = '';
  document.getElementById('akte-customer-search').style.display = '';
  document.getElementById('akte-customer-selected').style.display = 'none';
  document.getElementById('akte-customer-search').focus();
}

async function saveAkte(e, editId) {
  e.preventDefault();
  const data = {
    aktennummer: document.getElementById('akte-nummer').value,
    datum: document.getElementById('akte-datum').value,
    zahlungsstatus: document.getElementById('akte-zahlungsstatus').value,
    status: document.getElementById('akte-status').value,
    notizen: document.getElementById('akte-notizen').value,
    anwalt: document.getElementById('akte-anwalt').value,
    vorlage: document.getElementById('akte-vorlage').value,
    // Legacy text fields preserved for backwards compat
    kunde: '',
    vermittler: '',
    // FK fields
    customer_id: Number(document.getElementById('akte-customer-id').value) || null,
    vermittler_id: Number(document.getElementById('akte-vermittler-id').value) || null,
    versicherung_id: Number(document.getElementById('akte-versicherung-id').value) || null,
    rental_id: Number(document.getElementById('akte-rental-id').value) || null,
    // Unfall fields
    unfalldatum: document.getElementById('akte-unfalldatum').value,
    unfallort: document.getElementById('akte-unfallort').value,
    polizei_vor_ort: document.getElementById('akte-polizei').checked ? 1 : 0,
    // Miet fields
    mietart: document.getElementById('akte-mietart').value,
    wiedervorlage_datum: document.getElementById('akte-wiedervorlage-datum').value
  };
  try {
    if (editId) {
      await api('/api/akten/' + editId, { method: 'PUT', body: data });
      showToast('Akte aktualisiert');
    } else {
      await api('/api/akten', { method: 'POST', body: data });
      showToast('Akte angelegt');
    }
    closeModal();
    // Navigate back to detail page if editing from detail, otherwise to list
    if (currentAkteId && editId) {
      renderAkteDetail(currentAkteId);
    } else {
      currentAkteId = null;
      renderAkten();
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteAkte(id, name) {
  if (!confirm('Akte "' + name + '" wirklich löschen?')) return;
  try {
    await api('/api/akten/' + id, { method: 'DELETE' });
    showToast('Akte gelöscht');
    renderAkten();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ===== PAGE: Versicherungen (Insurance) =====
let _insuranceData = [];
let _insuranceSort = { field: 'name', dir: 'asc' };

async function renderInsurances() {
  const main = document.getElementById('main-content');
  main.innerHTML = `
    <div class="page-header">
      <h2>Versicherungen</h2>
      ${isAdmin() ? '<button class="btn btn-primary" onclick="openInsuranceForm()">+ Neue Versicherung</button>' : ''}
    </div>
    <div class="card" style="margin-bottom:20px;">
      <div class="filter-bar">
        <div class="form-group" style="flex:1;min-width:250px;">
          <label>Suche (Name, Ort, E-Mail, Telefon)</label>
          <input type="text" id="insurance-search" placeholder="z.B. Allianz" oninput="filterInsurances()">
        </div>
        <button class="btn btn-secondary" onclick="document.getElementById('insurance-search').value='';filterInsurances()">Zurücksetzen</button>
      </div>
    </div>
    <div class="card">
      <div id="insurance-table-content"><div class="loading">Laden...</div></div>
    </div>
  `;
  try {
    _insuranceData = await api('/api/insurances');
    renderInsuranceTable();
  } catch (err) {
    document.getElementById('insurance-table-content').innerHTML = '<div class="empty-state"><p>Fehler: ' + escapeHtml(err.message) + '</p></div>';
  }
}

function filterInsurances() {
  const term = (document.getElementById('insurance-search')?.value || '').toLowerCase().trim();
  renderInsuranceTable(term);
}

function sortInsurances(field) {
  if (_insuranceSort.field === field) {
    _insuranceSort.dir = _insuranceSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    _insuranceSort.field = field;
    _insuranceSort.dir = 'asc';
  }
  filterInsurances();
}

function insuranceSortIcon(field) {
  if (_insuranceSort.field !== field) return '<span style="opacity:0.3;">&#9650;</span>';
  return _insuranceSort.dir === 'asc' ? '<span>&#9650;</span>' : '<span>&#9660;</span>';
}

function renderInsuranceTable(searchTerm) {
  const container = document.getElementById('insurance-table-content');
  if (!container) return;
  let data = [..._insuranceData];

  if (searchTerm) {
    data = data.filter(ins => {
      const hay = [ins.name, ins.ort, ins.email, ins.email2, ins.telefon1, ins.telefon2, ins.ansprechpartner, ins.plz].join(' ').toLowerCase();
      return hay.includes(searchTerm);
    });
  }

  // Sort
  data.sort((a, b) => {
    const f = _insuranceSort.field;
    let va = (a[f] || '').toString().toLowerCase();
    let vb = (b[f] || '').toString().toLowerCase();
    if (f === 'id') { va = a.id; vb = b.id; return _insuranceSort.dir === 'asc' ? va - vb : vb - va; }
    return _insuranceSort.dir === 'asc' ? va.localeCompare(vb, 'de') : vb.localeCompare(va, 'de');
  });

  if (data.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>Keine Versicherungen gefunden.</p></div>';
    return;
  }

  const thStyle = 'cursor:pointer;user-select:none;white-space:nowrap;';
  container.innerHTML = `
    <div style="padding:8px 16px;color:var(--text-muted);font-size:13px;">${data.length} Versicherung${data.length !== 1 ? 'en' : ''}</div>
    <div class="table-wrapper">
      <table>
        <thead><tr>
          <th style="${thStyle}" onclick="sortInsurances('id')">Nr. ${insuranceSortIcon('id')}</th>
          <th style="${thStyle}" onclick="sortInsurances('name')">Name ${insuranceSortIcon('name')}</th>
          <th style="${thStyle}" onclick="sortInsurances('ort')">Ort ${insuranceSortIcon('ort')}</th>
          <th style="${thStyle}" onclick="sortInsurances('telefon1')">Telefon ${insuranceSortIcon('telefon1')}</th>
          <th style="${thStyle}" onclick="sortInsurances('email')">E-Mail ${insuranceSortIcon('email')}</th>
          <th>Ansprechpartner</th>
          <th>Aktionen</th>
        </tr></thead>
        <tbody>
          ${data.map(ins => `<tr style="cursor:pointer;" onclick="openInsuranceDetail(${ins.id})">
            <td>${ins.id}</td>
            <td><strong>${escapeHtml(ins.name || '')}</strong></td>
            <td>${escapeHtml(ins.plz ? ins.plz + ' ' + (ins.ort || '') : ins.ort || '')}</td>
            <td>${escapeHtml(ins.telefon1 || '')}</td>
            <td>${ins.email ? '<a href="mailto:' + escapeHtml(ins.email) + '" onclick="event.stopPropagation();">' + escapeHtml(ins.email) + '</a>' : ''}</td>
            <td>${escapeHtml(ins.ansprechpartner || '')}</td>
            <td>
              ${isAdmin() ? '<div style="display:flex;gap:6px;white-space:nowrap;"><button class="btn btn-sm btn-primary" onclick="event.stopPropagation();openInsuranceForm(' + ins.id + ')">Bearbeiten</button><button class="btn btn-sm btn-danger" onclick="event.stopPropagation();deleteInsurance(' + ins.id + ',\'' + escapeHtml(ins.name || '').replace(/'/g, "\\'") + '\')">Löschen</button></div>' : '<button class="btn btn-sm btn-secondary" onclick="event.stopPropagation();openInsuranceDetail(' + ins.id + ')">Details</button>'}
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function openInsuranceDetail(id) {
  const ins = _insuranceData.find(i => i.id === id);
  if (!ins) return;
  const fields = [
    ['Anrede', ins.anrede],
    ['Name', ins.name],
    ['Straße', ins.strasse],
    ['PLZ / Ort', (ins.plz || '') + ' ' + (ins.ort || '')],
    ['Ansprechpartner', ins.ansprechpartner],
    ['Telefon 1', ins.telefon1],
    ['Telefon 2', ins.telefon2],
    ['Mobil', ins.mobil],
    ['E-Mail', ins.email],
    ['E-Mail 2', ins.email2],
    ['Kommentar', ins.kommentar]
  ];
  openModal(ins.name || 'Versicherung', `
    <table style="width:100%;">
      ${fields.filter(([, v]) => v && v.trim()).map(([label, val]) => `
        <tr>
          <td style="padding:6px 12px 6px 0;font-weight:600;white-space:nowrap;vertical-align:top;color:var(--text-muted);">${escapeHtml(label)}</td>
          <td style="padding:6px 0;white-space:pre-wrap;">${label.includes('Mail') && val.includes('@') ? '<a href="mailto:' + escapeHtml(val.trim()) + '">' + escapeHtml(val.trim()) + '</a>' : escapeHtml(val)}</td>
        </tr>
      `).join('')}
    </table>
    <div style="margin-top:20px;display:flex;gap:10px;">
      ${isAdmin() ? '<button class="btn btn-primary" onclick="closeModal();openInsuranceForm(' + ins.id + ')">Bearbeiten</button>' : ''}
      <button class="btn btn-secondary" onclick="closeModal()">Schließen</button>
    </div>
  `);
}

async function openInsuranceForm(editId) {
  let ins = { anrede: 'Versicherungsgesellschaft', name: '', strasse: '', plz: '', ort: '', ansprechpartner: '', telefon1: '', telefon2: '', mobil: '', email: '', email2: '', kommentar: '' };
  if (editId) {
    try { ins = await api('/api/insurances/' + editId); } catch { showToast('Versicherung nicht gefunden', 'error'); return; }
  }
  openModal(editId ? 'Versicherung bearbeiten' : 'Neue Versicherung', `
    <form onsubmit="saveInsurance(event, ${editId || 'null'})">
      <div style="background:var(--bg);border-radius:var(--radius);padding:14px 16px;margin-bottom:12px;">
        <div style="font-size:12px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px;">Stammdaten</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 16px;">
          <div class="form-group"><label>Anrede</label>
            <select id="ins-anrede">
              ${['Versicherungsgesellschaft', 'Firma', 'Gericht', ''].map(a => '<option value="' + a + '" ' + (ins.anrede === a ? 'selected' : '') + '>' + (a || '(keine)') + '</option>').join('')}
            </select>
          </div>
          <div class="form-group"><label>Name *</label><input type="text" id="ins-name" value="${escapeHtml(ins.name)}" required></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 90px 1fr;gap:10px 16px;">
          <div class="form-group"><label>Straße</label><input type="text" id="ins-strasse" value="${escapeHtml(ins.strasse)}"></div>
          <div class="form-group"><label>PLZ</label><input type="text" id="ins-plz" value="${escapeHtml(ins.plz)}"></div>
          <div class="form-group"><label>Ort</label><input type="text" id="ins-ort" value="${escapeHtml(ins.ort)}"></div>
        </div>
      </div>
      <div style="background:var(--bg);border-radius:var(--radius);padding:14px 16px;">
        <div style="font-size:12px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px;">Kontaktdaten</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 16px;">
          <div class="form-group"><label>Ansprechpartner</label><input type="text" id="ins-ansprechpartner" value="${escapeHtml(ins.ansprechpartner)}"></div>
          <div class="form-group"><label>Mobil</label><input type="text" id="ins-mobil" value="${escapeHtml(ins.mobil)}"></div>
          <div class="form-group"><label>Telefon 1</label><input type="text" id="ins-telefon1" value="${escapeHtml(ins.telefon1)}"></div>
          <div class="form-group"><label>Telefon 2</label><input type="text" id="ins-telefon2" value="${escapeHtml(ins.telefon2)}"></div>
          <div class="form-group"><label>E-Mail</label><input type="email" id="ins-email" value="${escapeHtml(ins.email)}"></div>
          <div class="form-group"><label>E-Mail 2</label><input type="email" id="ins-email2" value="${escapeHtml(ins.email2)}"></div>
        </div>
        <div class="form-group"><label>Kommentar</label><textarea id="ins-kommentar" rows="2">${escapeHtml(ins.kommentar)}</textarea></div>
      </div>
      <div style="display:flex;gap:10px;margin-top:16px;">
        <button type="submit" class="btn btn-primary">${editId ? 'Speichern' : 'Anlegen'}</button>
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Abbrechen</button>
      </div>
    </form>
  `);
}

async function saveInsurance(e, editId) {
  e.preventDefault();
  const data = {
    anrede: document.getElementById('ins-anrede').value,
    name: document.getElementById('ins-name').value,
    strasse: document.getElementById('ins-strasse').value,
    plz: document.getElementById('ins-plz').value,
    ort: document.getElementById('ins-ort').value,
    ansprechpartner: document.getElementById('ins-ansprechpartner').value,
    telefon1: document.getElementById('ins-telefon1').value,
    telefon2: document.getElementById('ins-telefon2').value,
    mobil: document.getElementById('ins-mobil').value,
    email: document.getElementById('ins-email').value,
    email2: document.getElementById('ins-email2').value,
    kommentar: document.getElementById('ins-kommentar').value
  };
  try {
    if (editId) {
      await api('/api/insurances/' + editId, { method: 'PUT', body: data });
      showToast('Versicherung aktualisiert');
    } else {
      await api('/api/insurances', { method: 'POST', body: data });
      showToast('Versicherung angelegt');
    }
    closeModal();
    renderInsurances();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteInsurance(id, name) {
  if (!confirm('Versicherung "' + name + '" wirklich löschen?')) return;
  try {
    await api('/api/insurances/' + id, { method: 'DELETE' });
    showToast('Versicherung gelöscht');
    renderInsurances();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ===== Initialization =====
document.addEventListener('DOMContentLoaded', () => {
  initLogin();
  document.addEventListener('mouseup', vacDragEnd);
  document.addEventListener('mouseup', rentalDragEnd);
});
