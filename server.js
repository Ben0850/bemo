const express = require('express');
const cors = require('cors');
const path = require('path');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const { execFile } = require('child_process');
const os = require('os');
const msal = require('@azure/msal-node');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { getDb, queryAll, queryOne, execute } = require('./db');

const app = express();
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';
const APP_VERSION = Date.now().toString();

app.get('/api/version', (req, res) => res.json({ version: APP_VERSION }));

// Helper: current date/time in Europe/Berlin timezone
function berlinNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
}
function berlinToday() {
  const n = berlinNow();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}
function berlinTime() {
  const n = berlinNow();
  return `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}:${String(n.getSeconds()).padStart(2, '0')}`;
}

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js') || filePath.endsWith('.css') || filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
  }
}));

// Trust proxy headers (Nginx reverse proxy)
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// ===== HEALTH CHECK =====
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), env: process.env.NODE_ENV || 'development' });
});

// Admin-only guard for DELETE requests (except calendar, time, files, payments)
app.use((req, res, next) => {
  if (req.method === 'DELETE') {
    const permission = req.headers['x-user-permission'];
    if (permission !== 'Admin'
        && !req.path.startsWith('/api/calendar/')
        && !req.path.startsWith('/api/time/')
        && !req.path.startsWith('/api/files/')
        && !req.path.startsWith('/api/payments/')) {
      return res.status(403).json({ error: 'Nur Admins dürfen Einträge löschen' });
    }
  }
  next();
});

// ===== CUSTOMERS =====

app.get('/api/customers', (req, res) => {
  const { search, station } = req.query;
  const lastStationSql = `(SELECT v.last_station FROM vehicles v WHERE v.customer_id = customers.id AND v.last_station != '' ORDER BY v.updated_at DESC LIMIT 1) AS last_station`;
  if (search) {
    const term = `%${search}%`;
    let sql = `SELECT customers.*, ${lastStationSql} FROM customers WHERE (first_name LIKE ?1 OR last_name LIKE ?1 OR company_name LIKE ?1 OR phone LIKE ?1 OR email LIKE ?1 OR id IN (SELECT customer_id FROM vehicles WHERE license_plate LIKE ?1 OR manufacturer LIKE ?1 OR model LIKE ?1))`;
    const params = [term];
    if (station) {
      sql += ` AND customers.id IN (SELECT v2.customer_id FROM vehicles v2 WHERE v2.last_station = ?2)`;
      params.push(station);
    }
    sql += ' ORDER BY last_name, first_name';
    res.json(queryAll(sql, params));
  } else {
    let sql = `SELECT customers.*, ${lastStationSql} FROM customers`;
    const params = [];
    if (station) {
      sql += ` WHERE customers.id IN (SELECT v2.customer_id FROM vehicles v2 WHERE v2.last_station = ?1)`;
      params.push(station);
    }
    sql += ' ORDER BY last_name, first_name';
    res.json(queryAll(sql, params));
  }
});

// Duplicate check: find customers by name (exact + similar)
app.get('/api/customers/check-duplicate', (req, res) => {
  const { first_name, last_name, company_name } = req.query;

  // Company/Workshop check
  if (company_name) {
    const exact = queryAll(
      `SELECT * FROM customers WHERE LOWER(company_name) = LOWER(?) AND customer_type IN ('Firmenkunde','Werkstatt') ORDER BY company_name`,
      [company_name]
    );
    const similar = queryAll(
      `SELECT * FROM customers WHERE LOWER(company_name) LIKE LOWER(?) AND customer_type IN ('Firmenkunde','Werkstatt')
       AND LOWER(company_name) != LOWER(?)
       ORDER BY company_name LIMIT 10`,
      [`%${company_name}%`, company_name]
    );
    return res.json({ exact, similar });
  }

  // Private customer check
  if (!last_name) return res.json({ exact: [], similar: [] });

  const exact = queryAll(
    `SELECT * FROM customers WHERE LOWER(first_name) = LOWER(?) AND LOWER(last_name) = LOWER(?) ORDER BY last_name, first_name`,
    [first_name || '', last_name]
  );

  const similar = queryAll(
    `SELECT * FROM customers WHERE (LOWER(last_name) = LOWER(?) OR LOWER(last_name) LIKE LOWER(?) OR LOWER(first_name) LIKE LOWER(?))
     AND NOT (LOWER(first_name) = LOWER(?) AND LOWER(last_name) = LOWER(?))
     ORDER BY last_name, first_name LIMIT 10`,
    [last_name, `%${last_name}%`, `%${last_name}%`, first_name || '', last_name]
  );

  res.json({ exact, similar });
});

// Duplicate check: find vehicles by VIN (Fahrgestellnummer)
app.get('/api/vehicles/check-duplicate', (req, res) => {
  const { vin } = req.query;
  if (!vin) return res.json([]);

  const results = queryAll(
    `SELECT v.*, c.id as customer_id, c.first_name, c.last_name, c.customer_type, c.company_name, c.phone, c.email
     FROM vehicles v JOIN customers c ON v.customer_id = c.id
     WHERE LOWER(v.vin) = LOWER(?) AND v.vin != ''`,
    [vin]
  );
  res.json(results);
});

// Reassign vehicle to a different customer
app.put('/api/vehicles/:id/reassign', (req, res) => {
  const { customer_id } = req.body;
  if (!customer_id) return res.status(400).json({ error: 'Kunden-ID fehlt' });
  execute('UPDATE vehicles SET customer_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [customer_id, Number(req.params.id)]);
  res.json({ message: 'Fahrzeug wurde dem Kunden zugewiesen' });
});

app.get('/api/vehicles/search', (req, res) => {
  const { license_plate, vin } = req.query;
  let sql = `
    SELECT v.*, c.id as customer_id, c.first_name, c.last_name, c.customer_type, c.company_name, c.phone, c.email
    FROM vehicles v
    JOIN customers c ON v.customer_id = c.id
    WHERE 1=1
  `;
  const params = [];
  if (license_plate) {
    sql += ' AND v.license_plate LIKE ?';
    params.push(`%${license_plate}%`);
  }
  if (vin) {
    sql += ' AND v.vin LIKE ?';
    params.push(`%${vin}%`);
  }
  sql += ' ORDER BY c.last_name, c.first_name';
  res.json(queryAll(sql, params));
});

app.get('/api/customers/:id', (req, res) => {
  const customer = queryOne('SELECT * FROM customers WHERE id = ?', [Number(req.params.id)]);
  if (!customer) return res.status(404).json({ error: 'Kunde nicht gefunden' });
  const vehicles = queryAll('SELECT * FROM vehicles WHERE customer_id = ? ORDER BY license_plate', [Number(req.params.id)]);
  res.json({ ...customer, vehicles });
});

app.post('/api/customers', (req, res) => {
  const { first_name, last_name, street, zip, city, phone, email, reminder_asked, reminder_response, reminder_blocked, notes, customer_type, company_name, contact_person, contact_phone } = req.body;
  const type = customer_type || 'Privatkunde';
  if (type === 'Privatkunde') {
    if (!first_name || !last_name) return res.status(400).json({ error: 'Vor- und Nachname sind Pflichtfelder' });
  } else {
    if (!company_name) return res.status(400).json({ error: 'Firmenname ist ein Pflichtfeld' });
  }
  const result = execute(
    `INSERT INTO customers (first_name, last_name, street, zip, city, phone, email, reminder_asked, reminder_response, reminder_blocked, notes, customer_type, company_name, contact_person, contact_phone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [first_name || '', last_name || '', street || '', zip || '', city || '', phone || '', email || '', reminder_asked ? 1 : 0, reminder_response || '', reminder_blocked ? 1 : 0, notes || '', type, company_name || '', contact_person || '', contact_phone || '']
  );
  res.json({ id: result.lastId, message: 'Kunde erstellt' });
});

// Update contact info (phone/email) only
app.put('/api/customers/:id/contact', (req, res) => {
  const { phone, email } = req.body;
  const sets = [];
  const params = [];
  if (phone !== undefined) { sets.push('phone=?'); params.push(phone); }
  if (email !== undefined) { sets.push('email=?'); params.push(email); }
  if (sets.length === 0) return res.json({ message: 'Nichts zu aktualisieren' });
  sets.push('updated_at=CURRENT_TIMESTAMP');
  params.push(Number(req.params.id));
  execute(`UPDATE customers SET ${sets.join(', ')} WHERE id=?`, params);
  res.json({ message: 'Kontaktdaten aktualisiert' });
});

app.put('/api/customers/:id', (req, res) => {
  const { first_name, last_name, street, zip, city, phone, email, reminder_asked, reminder_response, reminder_blocked, notes, customer_type, company_name, contact_person, contact_phone } = req.body;
  const type = customer_type || 'Privatkunde';
  execute(
    `UPDATE customers SET first_name=?, last_name=?, street=?, zip=?, city=?, phone=?, email=?, reminder_asked=?, reminder_response=?, reminder_blocked=?, notes=?, customer_type=?, company_name=?, contact_person=?, contact_phone=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    [first_name || '', last_name || '', street || '', zip || '', city || '', phone || '', email || '', reminder_asked ? 1 : 0, reminder_response || '', reminder_blocked ? 1 : 0, notes || '', type, company_name || '', contact_person || '', contact_phone || '', Number(req.params.id)]
  );
  res.json({ message: 'Kunde aktualisiert' });
});

// Special agreements update
app.put('/api/customers/:id/special-agreements', (req, res) => {
  const { special_agreements } = req.body;
  execute('UPDATE customers SET special_agreements = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [special_agreements || '', Number(req.params.id)]);
  res.json({ message: 'Vereinbarungen aktualisiert' });
});

app.put('/api/customers/:id/bank', (req, res) => {
  const { bank_iban, bank_bic, bank_holder, bank_name } = req.body;
  execute('UPDATE customers SET bank_iban=?, bank_bic=?, bank_holder=?, bank_name=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
    [bank_iban || '', bank_bic || '', bank_holder || '', bank_name || '', Number(req.params.id)]);
  res.json({ message: 'Bankverbindung aktualisiert' });
});

// Credits CRUD
app.get('/api/customers/:id/credits', (req, res) => {
  res.json(queryAll('SELECT * FROM credits WHERE customer_id = ? ORDER BY credit_date DESC, id DESC', [Number(req.params.id)]));
});

app.post('/api/customers/:id/credits', (req, res) => {
  try {
    const { credit_number, credit_date, description, amount_net, amount_gross, settled_period, credit_type } = req.body;
    const result = execute(
      'INSERT INTO credits (customer_id, credit_number, credit_date, description, amount_net, amount_gross, settled_period, credit_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [Number(req.params.id), credit_number || '', credit_date || '', description || '', Number(amount_net) || 0, Number(amount_gross) || 0, settled_period || '', credit_type || '']
    );
    res.json({ id: result.lastId, message: 'Gutschrift erstellt' });
  } catch(e) {
    console.error('Credits POST error:', e.message);
    res.status(500).json({ error: 'Fehler beim Speichern: ' + e.message });
  }
});

app.put('/api/credits/:id', (req, res) => {
  try {
    const { credit_number, credit_date, description, amount_net, amount_gross, settled_period, credit_type } = req.body;
    execute(
      'UPDATE credits SET credit_number=?, credit_date=?, description=?, amount_net=?, amount_gross=?, settled_period=?, credit_type=? WHERE id=?',
      [credit_number || '', credit_date || '', description || '', Number(amount_net) || 0, Number(amount_gross) || 0, settled_period || '', credit_type || '', Number(req.params.id)]
    );
    res.json({ message: 'Gutschrift aktualisiert' });
  } catch(e) {
    console.error('Credits PUT error:', e.message);
    res.status(500).json({ error: 'Fehler beim Speichern: ' + e.message });
  }
});

// Lookup credit note by number (for auto-fill in credit form)
app.get('/api/credit-notes/lookup/:number', (req, res) => {
  const cn = queryOne(
    `SELECT cn.credit_number, cn.credit_date, cn.total_net, cn.total_gross, cn.notes,
     GROUP_CONCAT(ci.description, ', ') as item_descriptions
     FROM credit_notes cn
     LEFT JOIN credit_note_items ci ON ci.credit_note_id = cn.id
     WHERE cn.credit_number = ?
     GROUP BY cn.id`,
    [req.params.number]
  );
  if (!cn) return res.json({ found: false });
  res.json({ found: true, credit_date: cn.credit_date, total_net: cn.total_net, total_gross: cn.total_gross, description: cn.item_descriptions || cn.notes || '' });
});

app.delete('/api/credits/:id', (req, res) => {
  const permission = req.headers['x-user-permission'];
  if (permission !== 'Admin') return res.status(403).json({ error: 'Nur Admin darf Gutschriften löschen' });
  execute('DELETE FROM credits WHERE id = ?', [Number(req.params.id)]);
  res.json({ message: 'Gutschrift gelöscht' });
});

// ===== CUSTOMER REBATES (Rückvergütungsvereinbarungen) =====

app.get('/api/customers/:id/rebates', (req, res) => {
  const rows = queryAll(
    `SELECT r.*, s1.name as agreed_with_name, s2.name as created_by_name
     FROM customer_rebates r
     LEFT JOIN staff s1 ON r.agreed_with_staff_id = s1.id
     LEFT JOIN staff s2 ON r.created_by_staff_id = s2.id
     WHERE r.customer_id = ? ORDER BY COALESCE(r.is_active, 1) DESC, r.rebate_date DESC, r.id DESC`,
    [Number(req.params.id)]
  );
  res.json(rows);
});

app.post('/api/customers/:id/rebates', (req, res) => {
  const permission = req.headers['x-user-permission'];
  if (!['Admin', 'Verwaltung', 'Buchhaltung'].includes(permission)) return res.status(403).json({ error: 'Keine Berechtigung' });
  const userId = Number(req.headers['x-user-id']);
  const { rebate_date, rebate_text, rebate_type, rebate_period, agreed_with_staff_id, next_due_date } = req.body;
  if (!rebate_date || !rebate_text) return res.status(400).json({ error: 'Datum und Rückvergütung sind Pflichtfelder' });
  if (!rebate_period) return res.status(400).json({ error: 'Zeitraum ist ein Pflichtfeld' });
  if (!next_due_date) return res.status(400).json({ error: 'Nächste Fälligkeit ist ein Pflichtfeld' });
  // Deactivate previous agreements for this customer
  execute('UPDATE customer_rebates SET is_active = 0, next_due_date = "" WHERE customer_id = ?', [Number(req.params.id)]);
  const result = execute(
    'INSERT INTO customer_rebates (customer_id, rebate_date, rebate_text, rebate_type, rebate_period, agreed_with_staff_id, created_by_staff_id, next_due_date, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)',
    [Number(req.params.id), rebate_date, rebate_text, rebate_type || '', rebate_period || '', agreed_with_staff_id ? Number(agreed_with_staff_id) : null, userId, next_due_date || '']
  );
  res.json({ id: result.lastId, message: 'Eintrag erstellt' });
});

// Update only next_due_date
app.put('/api/rebates/:id/due-date', (req, res) => {
  const permission = req.headers['x-user-permission'];
  if (!['Admin', 'Verwaltung', 'Buchhaltung'].includes(permission)) return res.status(403).json({ error: 'Keine Berechtigung' });
  const { next_due_date } = req.body;
  execute('UPDATE customer_rebates SET next_due_date = ? WHERE id = ?', [next_due_date || '', Number(req.params.id)]);
  res.json({ message: 'Fälligkeit aktualisiert' });
});

app.put('/api/rebates/:id', (req, res) => {
  const permission = req.headers['x-user-permission'];
  if (permission !== 'Admin') return res.status(403).json({ error: 'Nur Admin darf Vereinbarungen bearbeiten' });
  const { rebate_text, rebate_type, rebate_period, agreed_with_staff_id, next_due_date } = req.body;
  execute(
    'UPDATE customer_rebates SET rebate_text=?, rebate_type=?, rebate_period=?, agreed_with_staff_id=?, next_due_date=? WHERE id=?',
    [rebate_text || '', rebate_type || '', rebate_period || '', agreed_with_staff_id ? Number(agreed_with_staff_id) : null, next_due_date || '', Number(req.params.id)]
  );
  res.json({ message: 'Eintrag aktualisiert' });
});

app.get('/api/rebates/due', (req, res) => {
  const today = berlinNow().toISOString().split('T')[0];
  const due = queryAll(
    `SELECT r.*, c.id as customer_id, c.first_name, c.last_name, c.company_name, c.customer_type
     FROM customer_rebates r JOIN customers c ON r.customer_id = c.id
     WHERE r.next_due_date != '' AND r.next_due_date <= ? AND COALESCE(r.is_active, 1) = 1
     ORDER BY r.next_due_date`, [today]
  );
  res.json(due);
});

app.delete('/api/rebates/:id', (req, res) => {
  const permission = req.headers['x-user-permission'];
  if (permission !== 'Admin') return res.status(403).json({ error: 'Nur Admin darf Einträge löschen' });
  execute('DELETE FROM customer_rebates WHERE id = ?', [Number(req.params.id)]);
  res.json({ message: 'Eintrag gelöscht' });
});

// ===== VERMITTLER-VERWALTUNG (lokal in Bemo-DB) =====

// Management (Bank, Vereinbarungen)
app.get('/api/vermittler-mgmt/:vermittlerId', (req, res) => {
  const row = queryOne('SELECT * FROM vermittler_management WHERE vermittler_id = ?', [Number(req.params.vermittlerId)]);
  res.json(row || { vermittler_id: Number(req.params.vermittlerId), bank_iban: '', bank_bic: '', bank_holder: '', bank_name: '', special_agreements: '' });
});

app.put('/api/vermittler-mgmt/:vermittlerId/bank', (req, res) => {
  const vid = Number(req.params.vermittlerId);
  const { bank_iban, bank_bic, bank_holder, bank_name } = req.body;
  const existing = queryOne('SELECT id FROM vermittler_management WHERE vermittler_id = ?', [vid]);
  if (existing) {
    execute('UPDATE vermittler_management SET bank_iban=?, bank_bic=?, bank_holder=?, bank_name=?, updated_at=CURRENT_TIMESTAMP WHERE vermittler_id=?',
      [bank_iban || '', bank_bic || '', bank_holder || '', bank_name || '', vid]);
  } else {
    execute('INSERT INTO vermittler_management (vermittler_id, bank_iban, bank_bic, bank_holder, bank_name) VALUES (?, ?, ?, ?, ?)',
      [vid, bank_iban || '', bank_bic || '', bank_holder || '', bank_name || '']);
  }
  res.json({ message: 'Bankverbindung aktualisiert' });
});

app.put('/api/vermittler-mgmt/:vermittlerId/agreements', (req, res) => {
  const vid = Number(req.params.vermittlerId);
  const { special_agreements } = req.body;
  const existing = queryOne('SELECT id FROM vermittler_management WHERE vermittler_id = ?', [vid]);
  if (existing) {
    execute('UPDATE vermittler_management SET special_agreements=?, updated_at=CURRENT_TIMESTAMP WHERE vermittler_id=?', [special_agreements || '', vid]);
  } else {
    execute('INSERT INTO vermittler_management (vermittler_id, special_agreements) VALUES (?, ?)', [vid, special_agreements || '']);
  }
  res.json({ message: 'Vereinbarungen aktualisiert' });
});

// Vermittler Rebates
app.get('/api/vermittler-mgmt/:vermittlerId/rebates', (req, res) => {
  res.json(queryAll(
    `SELECT r.*, s1.name as agreed_with_name, s2.name as created_by_name
     FROM vermittler_rebates r
     LEFT JOIN staff s1 ON r.agreed_with_staff_id = s1.id
     LEFT JOIN staff s2 ON r.created_by_staff_id = s2.id
     WHERE r.vermittler_id = ? ORDER BY COALESCE(r.is_active, 1) DESC, r.rebate_date DESC, r.id DESC`,
    [Number(req.params.vermittlerId)]
  ));
});

app.post('/api/vermittler-mgmt/:vermittlerId/rebates', (req, res) => {
  const permission = req.headers['x-user-permission'];
  if (!['Admin', 'Verwaltung', 'Buchhaltung'].includes(permission)) return res.status(403).json({ error: 'Keine Berechtigung' });
  const userId = Number(req.headers['x-user-id']);
  const { rebate_date, rebate_text, rebate_type, rebate_period, agreed_with_staff_id, next_due_date } = req.body;
  if (!rebate_date || !rebate_text) return res.status(400).json({ error: 'Datum und Rückvergütung sind Pflichtfelder' });
  if (!rebate_period) return res.status(400).json({ error: 'Zeitraum ist ein Pflichtfeld' });
  if (!next_due_date) return res.status(400).json({ error: 'Nächste Fälligkeit ist ein Pflichtfeld' });
  execute('UPDATE vermittler_rebates SET is_active = 0, next_due_date = "" WHERE vermittler_id = ?', [Number(req.params.vermittlerId)]);
  const result = execute(
    'INSERT INTO vermittler_rebates (vermittler_id, rebate_date, rebate_text, rebate_type, rebate_period, agreed_with_staff_id, created_by_staff_id, next_due_date, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)',
    [Number(req.params.vermittlerId), rebate_date, rebate_text, rebate_type || '', rebate_period || '', agreed_with_staff_id ? Number(agreed_with_staff_id) : null, userId, next_due_date || '']
  );
  res.json({ id: result.lastId, message: 'Eintrag erstellt' });
});

app.put('/api/vermittler-rebates/:id/due-date', (req, res) => {
  const permission = req.headers['x-user-permission'];
  if (!['Admin', 'Verwaltung', 'Buchhaltung'].includes(permission)) return res.status(403).json({ error: 'Keine Berechtigung' });
  execute('UPDATE vermittler_rebates SET next_due_date = ? WHERE id = ?', [req.body.next_due_date || '', Number(req.params.id)]);
  res.json({ message: 'Fälligkeit aktualisiert' });
});

app.put('/api/vermittler-rebates/:id', (req, res) => {
  const permission = req.headers['x-user-permission'];
  if (permission !== 'Admin') return res.status(403).json({ error: 'Nur Admin darf Vereinbarungen bearbeiten' });
  const { rebate_text, rebate_type, rebate_period, agreed_with_staff_id, next_due_date } = req.body;
  execute('UPDATE vermittler_rebates SET rebate_text=?, rebate_type=?, rebate_period=?, agreed_with_staff_id=?, next_due_date=? WHERE id=?',
    [rebate_text || '', rebate_type || '', rebate_period || '', agreed_with_staff_id ? Number(agreed_with_staff_id) : null, next_due_date || '', Number(req.params.id)]);
  res.json({ message: 'Eintrag aktualisiert' });
});

app.delete('/api/vermittler-rebates/:id', (req, res) => {
  const permission = req.headers['x-user-permission'];
  if (permission !== 'Admin') return res.status(403).json({ error: 'Nur Admin darf Einträge löschen' });
  execute('DELETE FROM vermittler_rebates WHERE id = ?', [Number(req.params.id)]);
  res.json({ message: 'Eintrag gelöscht' });
});

app.get('/api/vermittler-rebates/due', (req, res) => {
  const today = berlinNow().toISOString().split('T')[0];
  res.json(queryAll(
    `SELECT r.*, r.vermittler_id FROM vermittler_rebates r
     WHERE r.next_due_date != '' AND r.next_due_date <= ? AND COALESCE(r.is_active, 1) = 1
     ORDER BY r.next_due_date`, [today]
  ));
});

// Vermittler Credits
app.get('/api/vermittler-mgmt/:vermittlerId/credits', (req, res) => {
  res.json(queryAll('SELECT * FROM vermittler_credits WHERE vermittler_id = ? ORDER BY credit_date DESC, id DESC', [Number(req.params.vermittlerId)]));
});

app.post('/api/vermittler-mgmt/:vermittlerId/credits', (req, res) => {
  try {
    const { credit_number, credit_date, description, amount_net, amount_gross, settled_period, credit_type } = req.body;
    const result = execute(
      'INSERT INTO vermittler_credits (vermittler_id, credit_number, credit_date, description, amount_net, amount_gross, settled_period, credit_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [Number(req.params.vermittlerId), credit_number || '', credit_date || '', description || '', Number(amount_net) || 0, Number(amount_gross) || 0, settled_period || '', credit_type || '']
    );
    res.json({ id: result.lastId, message: 'Gutschrift erstellt' });
  } catch(e) { res.status(500).json({ error: 'Fehler: ' + e.message }); }
});

app.put('/api/vermittler-credits/:id', (req, res) => {
  try {
    const { credit_number, credit_date, description, amount_net, amount_gross, settled_period, credit_type } = req.body;
    execute('UPDATE vermittler_credits SET credit_number=?, credit_date=?, description=?, amount_net=?, amount_gross=?, settled_period=?, credit_type=? WHERE id=?',
      [credit_number || '', credit_date || '', description || '', Number(amount_net) || 0, Number(amount_gross) || 0, settled_period || '', credit_type || '', Number(req.params.id)]);
    res.json({ message: 'Gutschrift aktualisiert' });
  } catch(e) { res.status(500).json({ error: 'Fehler: ' + e.message }); }
});

app.delete('/api/vermittler-credits/:id', (req, res) => {
  const permission = req.headers['x-user-permission'];
  if (permission !== 'Admin') return res.status(403).json({ error: 'Nur Admin darf Gutschriften löschen' });
  execute('DELETE FROM vermittler_credits WHERE id = ?', [Number(req.params.id)]);
  res.json({ message: 'Gutschrift gelöscht' });
});

// Set/unset reminder block on customer (with password check for unblock)
app.put('/api/customers/:id/reminder-block', (req, res) => {
  const { blocked } = req.body;
  if (blocked) {
    execute('UPDATE customers SET reminder_blocked = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [Number(req.params.id)]);
    return res.json({ message: 'Erinnerungssperre gesetzt' });
  } else {
    const permission = req.headers['x-user-permission'];
    if (permission !== 'Admin') {
      return res.status(403).json({ error: 'Nur Admins dürfen die Erinnerungssperre aufheben' });
    }
    execute('UPDATE customers SET reminder_blocked = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [Number(req.params.id)]);
    return res.json({ message: 'Erinnerungssperre aufgehoben' });
  }
});

app.delete('/api/customers/:id', (req, res) => {
  execute('DELETE FROM vehicles WHERE customer_id = ?', [Number(req.params.id)]);
  execute('DELETE FROM customers WHERE id = ?', [Number(req.params.id)]);
  res.json({ message: 'Kunde gelöscht' });
});

// ===== VEHICLES =====

app.get('/api/customers/:customerId/vehicles', (req, res) => {
  res.json(queryAll('SELECT * FROM vehicles WHERE customer_id = ? ORDER BY license_plate', [Number(req.params.customerId)]));
});

app.post('/api/customers/:customerId/vehicles', (req, res) => {
  const { manufacturer, model, vehicle_type, vin, license_plate, first_registration, next_tuev_date, next_sp_date, last_station } = req.body;
  if (!manufacturer || !model) return res.status(400).json({ error: 'Hersteller und Typ sind Pflichtfelder' });
  if (!vehicle_type) return res.status(400).json({ error: 'Bauart ist ein Pflichtfeld' });
  const result = execute(
    `INSERT INTO vehicles (customer_id, manufacturer, model, vehicle_type, vin, license_plate, first_registration, next_tuev_date, next_sp_date, last_station) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [Number(req.params.customerId), manufacturer, model, vehicle_type, vin || '', license_plate || '', first_registration || '', next_tuev_date || '', next_sp_date || '', last_station || '']
  );
  res.json({ id: result.lastId, message: 'Fahrzeug hinzugefügt' });
});

app.put('/api/vehicles/:id', (req, res) => {
  const { manufacturer, model, vehicle_type, vin, license_plate, first_registration, next_tuev_date, next_sp_date, last_station } = req.body;
  execute(
    `UPDATE vehicles SET manufacturer=?, model=?, vehicle_type=?, vin=?, license_plate=?, first_registration=?, next_tuev_date=?, next_sp_date=?, last_station=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    [manufacturer, model, vehicle_type || '', vin || '', license_plate || '', first_registration || '', next_tuev_date || '', next_sp_date || '', last_station || '', Number(req.params.id)]
  );
  res.json({ message: 'Fahrzeug aktualisiert' });
});

app.delete('/api/vehicles/:id', (req, res) => {
  execute('DELETE FROM vehicles WHERE id = ?', [Number(req.params.id)]);
  res.json({ message: 'Fahrzeug gelöscht' });
});

// ===== LOGIN =====

app.post('/api/login', (req, res) => {
  const { staff_id, username, password } = req.body;

  let staff;
  if (username) {
    // Login by username
    staff = queryOne('SELECT * FROM staff WHERE username = ? AND active = 1', [username.trim()]);
    if (!staff) return res.status(401).json({ error: 'Benutzername oder Passwort falsch' });
  } else if (staff_id) {
    // Legacy login by ID (fallback)
    staff = queryOne('SELECT * FROM staff WHERE id = ? AND active = 1', [Number(staff_id)]);
    if (!staff) return res.status(404).json({ error: 'Mitarbeiter nicht gefunden' });
  } else {
    return res.status(400).json({ error: 'Bitte Benutzername eingeben' });
  }

  // If staff has a password, check it
  if (staff.password && staff.password !== '') {
    if (password !== staff.password) {
      return res.status(401).json({ error: username ? 'Benutzername oder Passwort falsch' : 'Falsches Passwort' });
    }
  }

  const needsPassword = !staff.password || staff.password === '';
  res.json({ id: staff.id, name: staff.name, role: staff.role, permission_level: staff.permission_level || 'Benutzer', default_station_id: staff.default_station_id || null, work_days: staff.work_days || '1,2,3,4,5', needs_password: needsPassword });
});

// ===== STAFF =====

app.get('/api/staff', (req, res) => {
  const { role, show_all } = req.query;
  const activeFilter = show_all === '1' ? '' : ' AND active = 1';
  if (role) {
    res.json(queryAll(`SELECT * FROM staff WHERE role = ?${activeFilter} ORDER BY name`, [role]));
  } else {
    res.json(queryAll(`SELECT * FROM staff WHERE 1=1${activeFilter} ORDER BY active DESC, role, name`));
  }
});

app.put('/api/staff/me/password', (req, res) => {
  const staffId = Number(req.headers['x-user-id']);
  if (!staffId) return res.status(400).json({ error: 'Kein Benutzer' });
  const { currentPassword, newPassword } = req.body;
  const staff = queryOne('SELECT password FROM staff WHERE id = ?', [staffId]);
  if (!staff) return res.status(404).json({ error: 'Mitarbeiter nicht gefunden' });
  // Allow empty currentPassword only if staff has no password set
  const hasPassword = staff.password && staff.password !== '';
  if (hasPassword && staff.password !== currentPassword) return res.status(403).json({ error: 'Aktuelles Passwort ist falsch' });
  const pwError = validatePassword(newPassword);
  if (pwError) return res.status(400).json({ error: pwError });
  execute('UPDATE staff SET password = ? WHERE id = ?', [newPassword, staffId]);
  res.json({ message: 'Passwort geändert' });
});

function validatePassword(pw) {
  if (!pw || pw === '') return null;
  if (pw.length < 8) return 'Passwort muss mindestens 8 Zeichen haben';
  if (!/[A-Z]/.test(pw)) return 'Passwort muss mindestens einen Großbuchstaben enthalten';
  if (!/[^a-zA-Z0-9]/.test(pw)) return 'Passwort muss mindestens ein Sonderzeichen enthalten';
  return null;
}

app.post('/api/staff', (req, res) => {
  const { name, role, station, password, permission_level, has_calendar, calendar_visibility, entry_date, exit_date, email, street, zip, city, phone_private, phone_business, emergency_name, emergency_phone, weekly_hours, default_station_id, work_days, username } = req.body;
  if (!name || !role) return res.status(400).json({ error: 'Name und Rolle sind Pflichtfelder' });
  const pwError = validatePassword(password);
  if (pwError) return res.status(400).json({ error: pwError });
  const callerPermission = req.headers['x-user-permission'];
  const canChangeLevel = (callerPermission === 'Admin' || callerPermission === 'Verwaltung');
  const finalPermissionLevel = canChangeLevel ? (permission_level || 'Benutzer') : 'Benutzer';
  if (finalPermissionLevel === 'Admin' && callerPermission !== 'Admin') return res.status(403).json({ error: 'Nur Admins können Admin-Rechte vergeben' });
  const result = execute('INSERT INTO staff (name, role, station, password, permission_level, has_calendar, calendar_visibility, entry_date, exit_date, email, street, zip, city, phone_private, phone_business, emergency_name, emergency_phone, weekly_hours, default_station_id, work_days, username) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [name, role, station || '', password || '', finalPermissionLevel, has_calendar !== undefined ? has_calendar : 1, calendar_visibility || 'Admin,Verwaltung,Buchhaltung,Benutzer', entry_date || '', exit_date || '', email || '', street || '', zip || '', city || '', phone_private || '', phone_business || '', emergency_name || '', emergency_phone || '', weekly_hours || 40, default_station_id || null, work_days || '1,2,3,4,5', username || '']);
  res.json({ id: result.lastId, message: 'Mitarbeiter hinzugefügt' });
});

app.put('/api/staff/:id', (req, res) => {
  const { name, role, station, active, password, permission_level, has_calendar, calendar_visibility, vacation_days, entry_date, exit_date, email, street, zip, city, phone_private, phone_business, emergency_name, emergency_phone, weekly_hours, default_station_id, work_days, username } = req.body;
  const pwError = validatePassword(password);
  if (pwError) return res.status(400).json({ error: pwError });
  const callerPermission = req.headers['x-user-permission'];
  const existing = queryOne('SELECT permission_level FROM staff WHERE id = ?', [Number(req.params.id)]);
  const canChangeLevel = (callerPermission === 'Admin' || callerPermission === 'Verwaltung');
  const finalPermissionLevel = canChangeLevel ? (permission_level || 'Benutzer') : (existing ? existing.permission_level : 'Benutzer');
  if (finalPermissionLevel === 'Admin' && callerPermission !== 'Admin') return res.status(403).json({ error: 'Nur Admins können Admin-Rechte vergeben' });
  execute('UPDATE staff SET name=?, role=?, station=?, active=?, password=?, permission_level=?, has_calendar=?, calendar_visibility=?, vacation_days=?, entry_date=?, exit_date=?, email=?, street=?, zip=?, city=?, phone_private=?, phone_business=?, emergency_name=?, emergency_phone=?, weekly_hours=?, default_station_id=?, work_days=?, username=? WHERE id=?',
    [name, role, station || '', active !== undefined ? active : 1, password || '', finalPermissionLevel, has_calendar !== undefined ? has_calendar : 1, calendar_visibility || 'Admin,Verwaltung,Buchhaltung,Benutzer', vacation_days !== undefined ? vacation_days : 30, entry_date || '', exit_date || '', email || '', street || '', zip || '', city || '', phone_private || '', phone_business || '', emergency_name || '', emergency_phone || '', weekly_hours !== undefined ? weekly_hours : 40, default_station_id !== undefined ? default_station_id : null, work_days || '1,2,3,4,5', username || '', Number(req.params.id)]);
  res.json({ message: 'Mitarbeiter aktualisiert' });
});

app.delete('/api/staff/:id', (req, res) => {
  execute('DELETE FROM staff WHERE id = ?', [Number(req.params.id)]);
  res.json({ message: 'Mitarbeiter gelöscht' });
});

// ===== STAFF VACATION DAYS (per year) =====

app.get('/api/staff/:id/vacation-days', (req, res) => {
  const rows = queryAll('SELECT year, days, bonus_days FROM staff_vacation_days WHERE staff_id = ? ORDER BY year', [Number(req.params.id)]);
  res.json(rows.map(r => ({ ...r, bonus_days: r.bonus_days || 0 })));
});

app.put('/api/staff/:id/vacation-days', (req, res) => {
  const staffId = Number(req.params.id);
  const { yearDays } = req.body; // Array of {year, days}
  if (!Array.isArray(yearDays)) return res.status(400).json({ error: 'yearDays muss ein Array sein' });
  yearDays.forEach(({ year, days }) => {
    const existing = queryOne('SELECT id FROM staff_vacation_days WHERE staff_id = ? AND year = ?', [staffId, year]);
    if (existing) {
      execute('UPDATE staff_vacation_days SET days = ? WHERE staff_id = ? AND year = ?', [days, staffId, year]);
    } else {
      execute('INSERT INTO staff_vacation_days (staff_id, year, days) VALUES (?, ?, ?)', [staffId, year, days]);
    }
  });
  res.json({ message: 'Urlaubstage aktualisiert' });
});

app.post('/api/staff/:id/vacation-days/bonus', (req, res) => {
  try {
    const staffId = Number(req.params.id);
    if (!staffId) return res.status(400).json({ error: 'Ungültige Staff-ID' });
    const { year, delta } = req.body;
    if (!year || delta === undefined || delta === null) return res.status(400).json({ error: 'year und delta erforderlich' });

    const existing = queryOne('SELECT id, bonus_days, days FROM staff_vacation_days WHERE staff_id = ? AND year = ?', [staffId, year]);
    if (existing) {
      const newBonus = Math.max(0, (existing.bonus_days || 0) + delta);
      execute('UPDATE staff_vacation_days SET bonus_days = ? WHERE staff_id = ? AND year = ?', [newBonus, staffId, year]);
      res.json({ bonus_days: newBonus });
    } else {
      const staff = queryOne('SELECT vacation_days FROM staff WHERE id = ?', [staffId]);
      const defaultDays = staff ? (staff.vacation_days || 30) : 30;
      const newBonus = Math.max(0, delta);
      execute('INSERT INTO staff_vacation_days (staff_id, year, days, bonus_days) VALUES (?, ?, ?, ?)', [staffId, year, defaultDays, newBonus]);
      res.json({ bonus_days: newBonus });
    }
  } catch (err) {
    res.status(500).json({ error: err.message || 'Serverfehler' });
  }
});

// ===== SETTINGS =====

const crypto = require('crypto');
const SETTINGS_ENCRYPTION_KEY = crypto.createHash('sha256').update(process.env.SETTINGS_KEY || 'bemo-default-key-change-in-prod').digest();

function encryptValue(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', SETTINGS_ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decryptValue(text) {
  try {
    const [ivHex, encrypted] = text.split(':');
    if (!ivHex || !encrypted) return text; // Not encrypted (legacy), return as-is
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', SETTINGS_ENCRYPTION_KEY, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) {
    return text; // Decryption failed, return raw (legacy unencrypted value)
  }
}

// ===== COMPANY SETTINGS (Firmendaten) =====

const COMPANY_KEYS = [
  'company_street', 'company_zip', 'company_city', 'company_phone', 'company_email',
  'company_ceo', 'company_tax_number', 'company_hrb'
];

const COMPANY_DEFAULTS = {
  company_street: 'Werner-Heisenberg-Str. 1',
  company_zip: '52499',
  company_city: 'Baesweiler',
  company_phone: '+49 172 8122065',
  company_email: 'info@bemo-autovermietung.de',
  company_ceo: 'Maurice Bouvry',
  company_tax_number: '202/5738/2094',
  company_hrb: 'HRB 26588 AG Aachen'
};

function getBankAccount(bankAccountId) {
  if (bankAccountId) {
    const ba = queryOne('SELECT * FROM bank_accounts WHERE id = ?', [Number(bankAccountId)]);
    if (ba) return ba;
  }
  // Fallback: default bank account, or first one
  return queryOne('SELECT * FROM bank_accounts WHERE is_default = 1')
    || queryOne('SELECT * FROM bank_accounts ORDER BY id LIMIT 1');
}

function buildSnapshot(bankAccountId) {
  const co = getCompanySettings();
  const ba = getBankAccount(bankAccountId);
  co.bank_iban = ba ? ba.iban : '';
  co.bank_bic = ba ? ba.bic : '';
  co.bank_name = ba ? ba.bank_name : '';
  co.bank_label = ba ? ba.label : '';
  return co;
}

function getCompanySettings() {
  const settings = { ...COMPANY_DEFAULTS };
  const rows = queryAll(
    `SELECT key, value FROM settings WHERE key IN (${COMPANY_KEYS.map(() => '?').join(',')})`,
    COMPANY_KEYS
  );
  for (const row of rows) {
    if (row.value) settings[row.key] = row.value;
  }
  return settings;
}

app.get('/api/settings/company', (req, res) => {
  if (req.headers['x-user-permission'] !== 'Admin') {
    return res.status(403).json({ error: 'Nur Admins' });
  }
  res.json(getCompanySettings());
});

app.put('/api/settings/company', (req, res) => {
  if (req.headers['x-user-permission'] !== 'Admin') {
    return res.status(403).json({ error: 'Nur Admins' });
  }
  const data = req.body;
  for (const key of COMPANY_KEYS) {
    if (data[key] !== undefined) {
      const value = data[key] || '';
      const exists = queryOne('SELECT key FROM settings WHERE key = ?', [key]);
      if (exists) {
        execute('UPDATE settings SET value = ? WHERE key = ?', [value, key]);
      } else {
        execute('INSERT INTO settings (key, value) VALUES (?, ?)', [key, value]);
      }
    }
  }
  res.json({ message: 'Firmendaten gespeichert' });
});

// ===== BANK ACCOUNTS =====

app.get('/api/bank-accounts', (req, res) => {
  res.json(queryAll('SELECT * FROM bank_accounts ORDER BY is_default DESC, id'));
});

app.post('/api/bank-accounts', (req, res) => {
  if (req.headers['x-user-permission'] !== 'Admin') return res.status(403).json({ error: 'Nur Admins' });
  const { label, iban, bic, bank_name, is_default } = req.body;
  if (!iban) return res.status(400).json({ error: 'IBAN ist Pflichtfeld' });
  if (is_default) {
    execute('UPDATE bank_accounts SET is_default = 0');
  }
  const result = execute(
    'INSERT INTO bank_accounts (label, iban, bic, bank_name, is_default) VALUES (?, ?, ?, ?, ?)',
    [label || '', iban, bic || '', bank_name || '', is_default ? 1 : 0]
  );
  res.json({ id: result.lastId, message: 'Bankverbindung angelegt' });
});

app.put('/api/bank-accounts/:id', (req, res) => {
  if (req.headers['x-user-permission'] !== 'Admin') return res.status(403).json({ error: 'Nur Admins' });
  const { label, iban, bic, bank_name, is_default } = req.body;
  if (!iban) return res.status(400).json({ error: 'IBAN ist Pflichtfeld' });
  if (is_default) {
    execute('UPDATE bank_accounts SET is_default = 0');
  }
  execute(
    'UPDATE bank_accounts SET label=?, iban=?, bic=?, bank_name=?, is_default=? WHERE id=?',
    [label || '', iban, bic || '', bank_name || '', is_default ? 1 : 0, Number(req.params.id)]
  );
  res.json({ message: 'Bankverbindung aktualisiert' });
});

app.delete('/api/bank-accounts/:id', (req, res) => {
  if (req.headers['x-user-permission'] !== 'Admin') return res.status(403).json({ error: 'Nur Admins' });
  execute('DELETE FROM bank_accounts WHERE id = ?', [Number(req.params.id)]);
  res.json({ message: 'Bankverbindung gelöscht' });
});

// ===== GENERIC SETTINGS =====

const SENSITIVE_KEYS = ['o365_client_secret', 'openai_api_key', 's3_secret_key'];
const ADMIN_ONLY_KEYS = ['o365_tenant_id', 'o365_client_id', 'o365_client_secret', 'o365_send_mailbox', 'o365_mailboxes', 's3_endpoint', 's3_bucket', 's3_access_key', 's3_secret_key', 's3_region'];

app.get('/api/settings/:key', (req, res) => {
  const key = req.params.key;
  if (ADMIN_ONLY_KEYS.includes(key) && req.headers['x-user-permission'] !== 'Admin') {
    return res.status(403).json({ error: 'Nur Admins' });
  }
  const row = queryOne('SELECT value FROM settings WHERE key = ?', [key]);
  let value = row ? row.value : '';
  // Decrypt sensitive values for internal use but mask for frontend
  if (SENSITIVE_KEYS.includes(key) && value) {
    const decrypted = decryptValue(value);
    // Return masked version to frontend
    value = decrypted.length > 8 ? decrypted.slice(0, 4) + '****' + decrypted.slice(-4) : '****';
  }
  res.json({ key, value });
});

app.put('/api/settings/:key', (req, res) => {
  const key = req.params.key;
  if (ADMIN_ONLY_KEYS.includes(key) && req.headers['x-user-permission'] !== 'Admin') {
    return res.status(403).json({ error: 'Nur Admins' });
  }
  const { value } = req.body;
  const storeValue = SENSITIVE_KEYS.includes(key) && value ? encryptValue(value) : (value || '');
  const exists = queryOne('SELECT key FROM settings WHERE key = ?', [key]);
  if (exists) {
    execute('UPDATE settings SET value = ? WHERE key = ?', [storeValue, key]);
  } else {
    execute('INSERT INTO settings (key, value) VALUES (?, ?)', [key, storeValue]);
  }
  res.json({ message: 'Einstellung gespeichert' });
});

// ===== OFFICE 365 / MICROSOFT GRAPH =====

function getSettingDecrypted(key) {
  const row = queryOne('SELECT value FROM settings WHERE key = ?', [key]);
  if (!row || !row.value) return '';
  return SENSITIVE_KEYS.includes(key) ? decryptValue(row.value) : row.value;
}

async function getGraphToken() {
  const tenantId = getSettingDecrypted('o365_tenant_id');
  const clientId = getSettingDecrypted('o365_client_id');
  const clientSecret = getSettingDecrypted('o365_client_secret');
  if (!tenantId || !clientId || !clientSecret) throw new Error('Office 365 Zugangsdaten nicht vollständig konfiguriert');

  const cca = new msal.ConfidentialClientApplication({
    auth: { clientId, authority: `https://login.microsoftonline.com/${tenantId}`, clientSecret }
  });
  const result = await cca.acquireTokenByClientCredential({ scopes: ['https://graph.microsoft.com/.default'] });
  if (!result || !result.accessToken) throw new Error('Token-Abruf fehlgeschlagen');
  return result.accessToken;
}

async function graphRequest(token, url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Graph API Fehler: ${res.status}`);
  }
  if (res.status === 204 || res.status === 202) return null;
  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text);
}

app.get('/api/o365/test', async (req, res) => {
  try {
    const token = await getGraphToken();

    // Collect all mailboxes to test
    const sendMailbox = getSettingDecrypted('o365_send_mailbox');
    const mailboxesStr = getSettingDecrypted('o365_mailboxes');
    const inboxMailboxes = mailboxesStr ? mailboxesStr.split('\n').map(m => m.trim()).filter(Boolean) : [];
    const allMailboxes = [];
    if (sendMailbox) allMailboxes.push(sendMailbox);
    inboxMailboxes.forEach(m => { if (!allMailboxes.includes(m)) allMailboxes.push(m); });

    // Test each mailbox
    const mailboxStatus = await Promise.all(allMailboxes.map(async (mailbox) => {
      try {
        await graphRequest(token, `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/mailFolders/inbox?$select=displayName`);
        return { mailbox, ok: true };
      } catch (err) {
        return { mailbox, ok: false, error: err.message };
      }
    }));

    res.json({ success: true, mailboxStatus });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.get('/api/o365/mailboxes', async (req, res) => {
  try {
    const mailboxesStr = queryOne("SELECT value FROM settings WHERE key = 'o365_mailboxes'")?.value || '';
    const sendMailbox = queryOne("SELECT value FROM settings WHERE key = 'o365_send_mailbox'")?.value || '';
    const mailboxes = mailboxesStr.split('\n').map(m => m.trim()).filter(Boolean);
    if (sendMailbox && !mailboxes.includes(sendMailbox)) mailboxes.unshift(sendMailbox);
    res.json(mailboxes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/o365/mails/:mailbox', async (req, res) => {
  try {
    const token = await getGraphToken();
    const mailbox = req.params.mailbox;
    const folder = req.query.folder || 'inbox';
    const top = Math.min(Number(req.query.top) || 30, 50);
    const skip = Number(req.query.skip) || 0;
    const data = await graphRequest(token,
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/mailFolders/${folder}/messages?$top=${top}&$skip=${skip}&$orderby=receivedDateTime desc&$select=id,subject,from,receivedDateTime,isRead,bodyPreview,body,toRecipients,ccRecipients`
    );
    res.json(data.value || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/o365/mails/:mailbox/:messageId/read', async (req, res) => {
  try {
    const token = await getGraphToken();
    await graphRequest(token,
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(req.params.mailbox)}/messages/${req.params.messageId}`,
      { method: 'PATCH', body: JSON.stringify({ isRead: true }) }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/o365/send', async (req, res) => {
  try {
    const token = await getGraphToken();
    const sendMailbox = queryOne("SELECT value FROM settings WHERE key = 'o365_send_mailbox'")?.value;
    if (!sendMailbox) return res.status(400).json({ error: 'Kein Ausgangs-Postfach konfiguriert' });
    const { to, cc, subject, body, replyTo } = req.body;
    if (!to || !subject || !body) return res.status(400).json({ error: 'Empfänger, Betreff und Nachricht sind Pflichtfelder' });

    const message = {
      subject,
      body: { contentType: 'HTML', content: body },
      toRecipients: to.split(',').map(e => ({ emailAddress: { address: e.trim() } }))
    };
    if (cc) message.ccRecipients = cc.split(',').map(e => ({ emailAddress: { address: e.trim() } }));
    if (replyTo) message.replyTo = [{ emailAddress: { address: replyTo.trim() } }];

    await graphRequest(token,
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sendMailbox)}/sendMail`,
      { method: 'POST', body: JSON.stringify({ message, saveToSentItems: true }) }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== FAHRZEUGSCHEIN SCAN (OpenAI Vision) =====

app.post('/api/scan', async (req, res) => {
  // Get API key from settings
  const keyRow = queryOne("SELECT value FROM settings WHERE key = 'openai_api_key'");
  const apiKey = keyRow?.value;
  if (!apiKey) {
    return res.status(400).json({ error: 'OpenAI API-Key nicht konfiguriert. Bitte unter Einstellungen hinterlegen.' });
  }

  try {
    const { image, content_type } = req.body;
    if (!image) {
      return res.status(400).json({ error: 'Kein Bild gesendet' });
    }
    const base64Image = image;
    const contentType = content_type || 'image/jpeg';

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-5.4',
        messages: [
          {
            role: 'system',
            content: `Du bist ein Experte für deutsche Fahrzeugdokumente. Du liest eine Zulassungsbescheinigung Teil I (Fahrzeugschein) aus.
Extrahiere die folgenden Felder und gib sie als JSON zurück. Wenn ein Feld nicht lesbar ist, gib einen leeren String zurück.
Antworte NUR mit dem JSON-Objekt, kein anderer Text.

{
  "last_name": "Nachname des Halters (Feld C.1.1)",
  "first_name": "Vorname des Halters (Feld C.1.2)",
  "street": "Straße und Hausnummer (aus Feld C.1.3)",
  "zip": "Postleitzahl (aus Feld C.1.3)",
  "city": "Ort (aus Feld C.1.3)",
  "manufacturer": "Marke/Hersteller (Feld D.1)",
  "model": "Handelsbezeichnung (Feld D.3, z.B. Golf, A4, 3er)",
  "vin": "Fahrzeug-Identifizierungsnummer FIN (Feld E), 17 Zeichen",
  "license_plate": "Amtliches Kennzeichen (oben auf dem Dokument)",
  "first_registration": "Datum der Erstzulassung (Feld B) im Format YYYY-MM-DD"
}`
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Bitte lies diese Zulassungsbescheinigung Teil I (Fahrzeugschein) aus und extrahiere alle Felder als JSON.'
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${contentType};base64,${base64Image}`,
                  detail: 'high'
                }
              }
            ]
          }
        ],
        max_tokens: 2000,
        temperature: 0,
      })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const errMsg = errData.error?.message || `OpenAI API Fehler (${response.status})`;
      return res.status(500).json({ error: errMsg });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    // Parse JSON from response (handle markdown code blocks)
    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonStr = jsonMatch[1];
    jsonStr = jsonStr.trim();

    const parsed = JSON.parse(jsonStr);

    // Fix capitalization: "AACHEN" -> "Aachen", "MÜLLER" -> "Müller"
    function titleCase(str) {
      if (!str) return str;
      return str.replace(/\S+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
    }
    ['last_name', 'first_name', 'street', 'city', 'manufacturer', 'model'].forEach(key => {
      if (parsed[key] && parsed[key] === parsed[key].toUpperCase() && parsed[key].length > 1) {
        parsed[key] = titleCase(parsed[key]);
      }
    });

    res.json(parsed);

  } catch (err) {
    console.error('Scan-Fehler:', err);
    res.status(500).json({ error: 'Fehler beim Verarbeiten: ' + err.message });
  }
});

// ===== CALENDAR =====

app.get('/api/calendar/search', (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 2) return res.json([]);
  const term = `%${q.trim()}%`;
  const now = berlinNow();
  const from = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate()).toISOString().split('T')[0];
  const to = new Date(now.getFullYear(), now.getMonth() + 3, now.getDate()).toISOString().split('T')[0];
  res.json(queryAll(
    `SELECT ca.id, ca.appointment_date, ca.start_time, ca.end_time, ca.customer_name,
            ca.license_plate, ca.station, ca.vehicle_type, s.name as assigned_staff_name
     FROM calendar_appointments ca
     LEFT JOIN staff s ON ca.assigned_staff_id = s.id
     WHERE (ca.customer_name LIKE ? OR ca.license_plate LIKE ?)
       AND ca.appointment_date BETWEEN ? AND ?
     ORDER BY ca.appointment_date DESC, ca.start_time
     LIMIT 30`, [term, term, from, to]
  ));
});

app.get('/api/calendar', (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'Datum erforderlich' });
  res.json(queryAll(`SELECT ca.*, s.name as assigned_staff_name,
    COALESCE(c.notes, '') as customer_notes
    FROM calendar_appointments ca
    LEFT JOIN staff s ON ca.assigned_staff_id = s.id
    LEFT JOIN customers c ON ca.customer_id = c.id
    WHERE ca.appointment_date = ? ORDER BY ca.start_time, ca.station`, [date]));
});

app.post('/api/calendar', (req, res) => {
  const { station, appointment_date, start_time, end_time, customer_name, phone, email, license_plate, vehicle_type, vehicle_model, booking_method, notes, assigned_staff_id, customer_id } = req.body;
  if (!station || !appointment_date || !start_time || !end_time || !customer_name) {
    return res.status(400).json({ error: 'Pflichtfelder: Prüfstelle, Datum, Start, Ende, Kundenname' });
  }
  const result = execute(
    `INSERT INTO calendar_appointments (station, appointment_date, start_time, end_time, customer_name, phone, email, license_plate, vehicle_type, vehicle_model, booking_method, notes, assigned_staff_id, customer_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [station, appointment_date, start_time, end_time, customer_name, phone || '', email || '', license_plate || '', vehicle_type || '', vehicle_model || '', booking_method || 'Telefonisch', notes || '', assigned_staff_id || null, customer_id || null]
  );
  res.json({ id: result.lastId, message: 'Termin erstellt' });
});

app.put('/api/calendar/:id', (req, res) => {
  const { station, appointment_date, start_time, end_time, customer_name, phone, email, license_plate, vehicle_type, vehicle_model, booking_method, notes, assigned_staff_id, customer_id } = req.body;
  execute(
    `UPDATE calendar_appointments SET station=?, appointment_date=?, start_time=?, end_time=?, customer_name=?, phone=?, email=?, license_plate=?, vehicle_type=?, vehicle_model=?, booking_method=?, notes=?, assigned_staff_id=?, customer_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    [station, appointment_date, start_time, end_time, customer_name, phone || '', email || '', license_plate || '', vehicle_type || '', vehicle_model || '', booking_method || 'Telefonisch', notes || '', assigned_staff_id || null, customer_id || null, Number(req.params.id)]
  );
  res.json({ message: 'Termin aktualisiert' });
});

app.delete('/api/calendar/:id', (req, res) => {
  execute('DELETE FROM calendar_appointments WHERE id = ?', [Number(req.params.id)]);
  res.json({ message: 'Termin gelöscht' });
});

// ===== VACATION =====

app.get('/api/vacation', (req, res) => {
  const { staff_id, year, status } = req.query;
  let sql = 'SELECT v.*, COALESCE(v.half_day, 0) as half_day, s.name as staff_name FROM vacation_entries v JOIN staff s ON v.staff_id = s.id WHERE 1=1';
  const params = [];
  if (staff_id) {
    sql += ' AND v.staff_id = ?';
    params.push(Number(staff_id));
  }
  if (year) {
    sql += ' AND (substr(v.start_date, 1, 4) = ? OR substr(v.end_date, 1, 4) = ?)';
    params.push(year, year);
  }
  if (status) {
    sql += ' AND v.status = ?';
    params.push(status);
  }
  sql += ' ORDER BY v.start_date';
  res.json(queryAll(sql, params));
});

app.post('/api/vacation', async (req, res) => {
  const { staff_id, entry_type, start_date, end_date, notes, status, half_day } = req.body;
  if (!staff_id || !start_date || !end_date) return res.status(400).json({ error: 'Mitarbeiter, Start- und Enddatum sind Pflichtfelder' });
  const callerPermission = req.headers['x-user-permission'];
  const callerId = Number(req.headers['x-user-id']);
  if (callerPermission !== 'Admin' && callerPermission !== 'Verwaltung' && Number(staff_id) !== callerId) {
    return res.status(403).json({ error: 'Du darfst nur für dich selbst einen Antrag stellen' });
  }
  const result = execute('INSERT INTO vacation_entries (staff_id, entry_type, start_date, end_date, notes, status, half_day) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [Number(staff_id), entry_type || 'Urlaub', start_date, end_date, notes || '', status || 'Genehmigt', half_day ? 1 : 0]);

  // Notify Admins and Verwaltung when a vacation request is submitted
  let emailSent = false;
  let emailSkipReason = '';
  if ((status || 'Genehmigt') === 'Beantragt') {
    try {
      const sendMailbox = getSettingDecrypted('o365_send_mailbox');
      if (!sendMailbox) { emailSkipReason = 'Kein Ausgangs-Postfach konfiguriert'; }
      else {
        const staff = queryOne('SELECT name FROM staff WHERE id = ?', [Number(staff_id)]);
        const staffName = staff ? staff.name : 'Unbekannt';
        const von = start_date ? start_date.split('-').reverse().join('.') : '';
        const bis = end_date ? end_date.split('-').reverse().join('.') : '';
        const recipients = queryAll("SELECT email FROM staff WHERE active = 1 AND email != '' AND (permission_level = 'Admin' OR permission_level = 'Verwaltung')");
        if (recipients.length === 0) { emailSkipReason = 'Keine Admins/Verwaltung mit E-Mail-Adresse gefunden'; }
        else {
          const token = await getGraphToken();
          const body = `<p>Neuer Urlaubsantrag eingegangen:</p>
<p><strong>Mitarbeiter:</strong> ${staffName}<br>
<strong>Art:</strong> ${entry_type || 'Urlaub'}<br>
<strong>Zeitraum:</strong> ${von} bis ${bis}${half_day ? ' (halber Tag)' : ''}<br>
${notes ? `<strong>Anmerkung:</strong> ${notes}` : ''}</p>
<p>Bitte im System prüfen und genehmigen oder ablehnen.</p>`;
          await graphRequest(token,
            `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sendMailbox)}/sendMail`,
            { method: 'POST', body: JSON.stringify({ message: { subject: `Urlaubsantrag von ${staffName}`, body: { contentType: 'HTML', content: body }, toRecipients: recipients.map(r => ({ emailAddress: { address: r.email } })) }, saveToSentItems: true }) }
          );
          emailSent = true;
        }
      }
    } catch (e) { emailSkipReason = e.message; }
  }

  res.json({ id: result.lastId, message: 'Eintrag erstellt', emailSent, emailSkipReason });
});

app.put('/api/vacation/:id', async (req, res) => {
  const { staff_id, entry_type, start_date, end_date, notes, status, half_day } = req.body;
  execute('UPDATE vacation_entries SET staff_id=?, entry_type=?, start_date=?, end_date=?, notes=?, status=?, half_day=? WHERE id=?',
    [Number(staff_id), entry_type || 'Urlaub', start_date, end_date, notes || '', status || 'Genehmigt', half_day ? 1 : 0, Number(req.params.id)]);

  let emailSent = false;
  let emailSkipReason = '';
  if (status === 'Genehmigt' || status === 'Abgelehnt') {
    try {
      const staff = queryOne('SELECT name, email FROM staff WHERE id = ?', [Number(staff_id)]);
      if (!staff) { emailSkipReason = 'Mitarbeiter nicht gefunden'; }
      else if (!staff.email) { emailSkipReason = `Mitarbeiter "${staff.name}" hat keine E-Mail-Adresse hinterlegt`; }
      else {
        const sendMailbox = getSettingDecrypted('o365_send_mailbox');
        if (!sendMailbox) { emailSkipReason = 'Kein Ausgangs-Postfach konfiguriert'; }
        else {
          const von = start_date ? start_date.split('-').reverse().join('.') : '';
          const bis = end_date ? end_date.split('-').reverse().join('.') : '';
          const isApproved = status === 'Genehmigt';
          const token = await getGraphToken();
          const body = `<p>Hallo ${staff.name},</p>
<p>dein Urlaubsantrag vom ${von} bis ${bis} wurde <strong>${isApproved ? 'genehmigt' : 'abgelehnt'}</strong>.</p>
${isApproved ? '<p>Wir wünschen dir einen erholsamen Urlaub.</p>' : '<p>Bei Rückfragen wende dich bitte an die Verwaltung.</p>'}
<p>Mit freundlichen Grüßen<br>Die Verwaltung</p>`;
          await graphRequest(token,
            `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sendMailbox)}/sendMail`,
            { method: 'POST', body: JSON.stringify({ message: { subject: `Urlaubsantrag ${isApproved ? 'genehmigt' : 'abgelehnt'}`, body: { contentType: 'HTML', content: body }, toRecipients: [{ emailAddress: { address: staff.email } }] }, saveToSentItems: true }) }
          );
          emailSent = true;
        }
      }
    } catch (e) { emailSkipReason = e.message; }
  }

  res.json({ message: 'Eintrag aktualisiert', emailSent, emailSkipReason });
});

app.put('/api/vacation/:id/payment', (req, res) => {
  const { payment_status } = req.body;
  execute('UPDATE vacation_entries SET payment_status=? WHERE id=?',
    [payment_status, Number(req.params.id)]);
  res.json({ message: 'Zahlungsstatus aktualisiert' });
});

app.delete('/api/vacation/:id', (req, res) => {
  execute('DELETE FROM vacation_entries WHERE id = ?', [Number(req.params.id)]);
  res.json({ message: 'Eintrag gelöscht' });
});

// ===== INVOICES =====

// Helper: recalculate invoice totals from items
function recalcInvoiceTotals(invoiceId) {
  const items = queryAll('SELECT * FROM invoice_items WHERE invoice_id = ?', [invoiceId]);
  let totalNet = 0;
  let totalGross = 0;
  items.forEach(item => {
    totalNet += Number(item.total_net) || 0;
    totalGross += Number(item.total_gross) || 0;
  });
  const totalVat = totalGross - totalNet;
  execute('UPDATE invoices SET total_net = ?, total_gross = ?, total_vat = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [totalNet, totalGross, totalVat, invoiceId]);
}

// Helper: generate next invoice number MMJJJJXXX (e.g. 032026001)
// DB-03: new format per PROJECT.md; DB-05: old RE-YYYY-NNNN rows are unaffected
function generateInvoiceNumber() {
  const now = berlinNow();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = String(now.getFullYear());
  const prefix = mm + yyyy; // e.g. "032026"
  const last = queryOne(
    "SELECT invoice_number FROM invoices WHERE invoice_number LIKE ? ORDER BY invoice_number DESC LIMIT 1",
    [prefix + '%']
  );
  let nextNum = 1;
  if (last) {
    nextNum = parseInt(last.invoice_number.slice(6)) + 1;
  }
  return prefix + String(nextNum).padStart(3, '0'); // e.g. "032026001"
}

app.get('/api/invoices', (req, res) => {
  const { status, search, date_from, date_to } = req.query;
  let sql = `SELECT i.*,
    CASE WHEN c.customer_type IN ('Firmenkunde','Werkstatt') THEN c.company_name ELSE c.last_name || ', ' || c.first_name END as customer_name
    FROM invoices i JOIN customers c ON i.customer_id = c.id WHERE 1=1`;
  const params = [];
  if (status) { sql += ' AND i.status = ?'; params.push(status); }
  if (date_from) { sql += ' AND i.invoice_date >= ?'; params.push(date_from); }
  if (date_to) { sql += ' AND i.invoice_date <= ?'; params.push(date_to); }
  if (search) {
    const term = `%${search}%`;
    sql += ' AND (i.invoice_number LIKE ? OR c.last_name LIKE ? OR c.first_name LIKE ? OR c.company_name LIKE ?)';
    params.push(term, term, term, term);
  }
  sql += ' ORDER BY i.invoice_date DESC, i.id DESC';
  res.json(queryAll(sql, params));
});

app.get('/api/invoices/:id', (req, res) => {
  const invoice = queryOne(`SELECT i.*, c.first_name, c.last_name, c.company_name, c.customer_type, c.street, c.zip, c.city, c.email, c.phone
    FROM invoices i JOIN customers c ON i.customer_id = c.id WHERE i.id = ?`, [Number(req.params.id)]);
  if (!invoice) return res.status(404).json({ error: 'Rechnung nicht gefunden' });
  const items = queryAll('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY position, id', [Number(req.params.id)]);
  res.json({ ...invoice, items });
});

app.post('/api/invoices', (req, res) => {
  // AUTH-02: Nur Verwaltung, Buchhaltung, Admin dürfen Rechnungen erstellen
  const permission = req.headers['x-user-permission'];
  if (!['Verwaltung', 'Buchhaltung', 'Admin'].includes(permission)) {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }
  const { customer_id, invoice_date, due_date, service_date, payment_method, notes, bank_account_id } = req.body;
  if (!customer_id || !invoice_date) {
    return res.status(400).json({ error: 'Kunde und Rechnungsdatum sind Pflichtfelder' });
  }
  // DB-03/DB-04: Nummernvergabe mit try/catch für UNIQUE-Constraint-Schutz
  let invoice_number;
  try {
    invoice_number = generateInvoiceNumber();
  } catch(e) {
    return res.status(500).json({ error: 'Rechnungsnummer konnte nicht vergeben werden' });
  }
  try {
    const snapshot = JSON.stringify(buildSnapshot(bank_account_id));
    const result = execute(
      'INSERT INTO invoices (invoice_number, customer_id, invoice_date, due_date, service_date, payment_method, notes, company_snapshot) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [invoice_number, customer_id, invoice_date, due_date || '', service_date || '', payment_method || 'Überweisung', notes || '', snapshot]
    );
    res.json({ id: result.lastId, invoice_number, message: 'Rechnung erstellt' });
  } catch(e) {
    res.status(500).json({ error: 'Rechnung konnte nicht erstellt werden' });
  }
});

app.put('/api/invoices/:id', (req, res) => {
  // AUTH-02: Nur Verwaltung, Buchhaltung, Admin dürfen Rechnungen bearbeiten
  const permission = req.headers['x-user-permission'];
  if (!['Verwaltung', 'Buchhaltung', 'Admin'].includes(permission)) {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }
  // AUTH-04: invoice_date und invoice_number sind nach Erstellung unveränderbar.
  // Sie werden hier bewusst NICHT aus req.body gelesen und NICHT im UPDATE-Statement verwendet.
  const { due_date, status, service_date, payment_method, notes } = req.body;
  execute(
    'UPDATE invoices SET due_date=?, status=?, service_date=?, payment_method=?, notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
    [due_date || '', status || 'Entwurf', service_date || '', payment_method || 'Überweisung', notes || '', Number(req.params.id)]
  );
  res.json({ message: 'Rechnung aktualisiert' });
});

app.delete('/api/invoices/:id', (req, res) => {
  // AUTH-03: Admin-only-Guard läuft bereits via globales Middleware (server.js:33)
  // AUTH-05: GoBD — finalisierte Rechnungen (status != Entwurf) dürfen nicht gelöscht werden
  const invoice = queryOne('SELECT status FROM invoices WHERE id = ?', [Number(req.params.id)]);
  if (!invoice) return res.status(404).json({ error: 'Rechnung nicht gefunden' });
  if (invoice.status !== 'Entwurf') {
    return res.status(403).json({ error: 'Finalisierte Rechnungen dürfen nicht gelöscht werden (GoBD)' });
  }
  execute('DELETE FROM invoices WHERE id = ?', [Number(req.params.id)]);
  res.json({ message: 'Rechnung gelöscht' });
});

// Invoice Items
app.post('/api/invoices/:id/items', (req, res) => {
  // AUTH-02: Gleiche Berechtigung wie invoice create/update
  const permission = req.headers['x-user-permission'];
  if (!['Verwaltung', 'Buchhaltung', 'Admin'].includes(permission)) {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }
  const invoiceId = Number(req.params.id);
  const { description, quantity, unit_price, vat_rate } = req.body;
  if (!description) return res.status(400).json({ error: 'Bezeichnung ist Pflichtfeld' });
  const qty = Number(quantity) || 1;
  const price = Number(unit_price) || 0;
  const rate = Number(vat_rate) || 0.19;
  // Pitfall 4: Rundung VOR dem Speichern (verhindert Centdifferenzen)
  const totalNet = Math.round(qty * price * 100) / 100;
  const totalGross = Math.round(totalNet * (1 + rate) * 100) / 100;
  // Get next position number
  const lastPos = queryOne('SELECT MAX(position) as maxPos FROM invoice_items WHERE invoice_id = ?', [invoiceId]);
  const position = (lastPos?.maxPos || 0) + 1;
  const result = execute(
    'INSERT INTO invoice_items (invoice_id, position, description, quantity, unit_price, total_net, total_gross, vat_rate) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [invoiceId, position, description, qty, price, totalNet, totalGross, rate]
  );
  recalcInvoiceTotals(invoiceId);
  res.json({ id: result.lastId, message: 'Position hinzugefügt' });
});

app.put('/api/invoice-items/:id', (req, res) => {
  // AUTH-02: Gleiche Berechtigung wie invoice create/update
  const permission = req.headers['x-user-permission'];
  if (!['Verwaltung', 'Buchhaltung', 'Admin'].includes(permission)) {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }
  const { description, quantity, unit_price, vat_rate } = req.body;
  const qty = Number(quantity) || 1;
  const price = Number(unit_price) || 0;
  const rate = Number(vat_rate) || 0.19;
  // Pitfall 4: Rundung VOR dem Speichern
  const totalNet = Math.round(qty * price * 100) / 100;
  const totalGross = Math.round(totalNet * (1 + rate) * 100) / 100;
  execute(
    'UPDATE invoice_items SET description=?, quantity=?, unit_price=?, total_net=?, total_gross=?, vat_rate=? WHERE id=?',
    [description || '', qty, price, totalNet, totalGross, rate, Number(req.params.id)]
  );
  // Get invoice_id to recalc
  const item = queryOne('SELECT invoice_id FROM invoice_items WHERE id = ?', [Number(req.params.id)]);
  if (item) recalcInvoiceTotals(item.invoice_id);
  res.json({ message: 'Position aktualisiert' });
});

app.delete('/api/invoice-items/:id', (req, res) => {
  const item = queryOne('SELECT invoice_id FROM invoice_items WHERE id = ?', [Number(req.params.id)]);
  execute('DELETE FROM invoice_items WHERE id = ?', [Number(req.params.id)]);
  if (item) recalcInvoiceTotals(item.invoice_id);
  res.json({ message: 'Position gelöscht' });
});

// ===== INVOICE PAYMENTS (Phase 4 — Zahlungsverwaltung) =====

// PAY-API-01: Liste aller Zahlungen einer Rechnung, sortiert nach payment_date ASC
app.get('/api/invoices/:id/payments', (req, res) => {
  const invoiceId = Number(req.params.id);
  if (!invoiceId) return res.status(400).json({ error: 'Ungültige Rechnungs-ID' });
  const invoice = queryOne('SELECT id FROM invoices WHERE id = ?', [invoiceId]);
  if (!invoice) return res.status(404).json({ error: 'Rechnung nicht gefunden' });
  const payments = queryAll(
    `SELECT p.*, b.label AS bank_account_label, b.iban AS bank_account_iban
     FROM invoice_payments p
     LEFT JOIN bank_accounts b ON p.bank_account_id = b.id
     WHERE p.invoice_id = ?
     ORDER BY p.payment_date ASC, p.id ASC`,
    [invoiceId]
  );
  res.json(payments);
});

// PAY-API-02 + PAY-API-05: Neue Zahlung anlegen, booked_by automatisch aus x-user-name
app.post('/api/invoices/:id/payments', (req, res) => {
  // Permission-Guard
  const permission = req.headers['x-user-permission'];
  if (!['Verwaltung', 'Buchhaltung', 'Admin'].includes(permission)) {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }
  const invoiceId = Number(req.params.id);
  if (!invoiceId) return res.status(400).json({ error: 'Ungültige Rechnungs-ID' });
  const invoice = queryOne('SELECT id FROM invoices WHERE id = ?', [invoiceId]);
  if (!invoice) return res.status(404).json({ error: 'Rechnung nicht gefunden' });

  const { direction, amount, payment_date, payment_method, bank_account_id, reference, notes } = req.body;

  // Body-Validation (vor SQL — klare 400-Antworten)
  if (!direction || !['in', 'out'].includes(direction)) {
    return res.status(400).json({ error: "direction muss 'in' oder 'out' sein" });
  }
  const amt = Number(amount);
  if (!amt || amt <= 0) {
    return res.status(400).json({ error: 'amount muss > 0 sein' });
  }
  if (!payment_date || !/^\d{4}-\d{2}-\d{2}$/.test(payment_date)) {
    return res.status(400).json({ error: 'payment_date muss im Format YYYY-MM-DD sein' });
  }

  // booked_by automatisch aus Header (nicht aus Body)
  const bookedBy = req.headers['x-user-name'] || '';

  try {
    const result = execute(
      `INSERT INTO invoice_payments
        (invoice_id, direction, amount, payment_date, payment_method, bank_account_id, reference, notes, booked_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        invoiceId,
        direction,
        amt,
        payment_date,
        payment_method || '',
        bank_account_id || null,
        reference || '',
        notes || '',
        bookedBy
      ]
    );
    const created = queryOne('SELECT * FROM invoice_payments WHERE id = ?', [result.lastId]);
    res.status(201).json(created);
  } catch (e) {
    res.status(500).json({ error: 'Zahlung konnte nicht angelegt werden: ' + e.message });
  }
});

// PAY-API-03 + PAY-API-05: Zahlung ändern (alle Felder außer booked_by und created_at)
app.put('/api/payments/:id', (req, res) => {
  // Permission-Guard
  const permission = req.headers['x-user-permission'];
  if (!['Verwaltung', 'Buchhaltung', 'Admin'].includes(permission)) {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }
  const paymentId = Number(req.params.id);
  if (!paymentId) return res.status(400).json({ error: 'Ungültige Zahlungs-ID' });
  const existing = queryOne('SELECT * FROM invoice_payments WHERE id = ?', [paymentId]);
  if (!existing) return res.status(404).json({ error: 'Zahlung nicht gefunden' });

  const { direction, amount, payment_date, payment_method, bank_account_id, reference, notes } = req.body;

  // Body-Validation (gleiche Regeln wie POST)
  if (direction !== undefined && !['in', 'out'].includes(direction)) {
    return res.status(400).json({ error: "direction muss 'in' oder 'out' sein" });
  }
  const amt = (amount !== undefined) ? Number(amount) : existing.amount;
  if (!amt || amt <= 0) {
    return res.status(400).json({ error: 'amount muss > 0 sein' });
  }
  if (payment_date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(payment_date)) {
    return res.status(400).json({ error: 'payment_date muss im Format YYYY-MM-DD sein' });
  }

  // PAY-API-03: booked_by und created_at sind UNVERÄNDERLICH — werden hier NICHT in UPDATE-SQL aufgenommen
  try {
    execute(
      `UPDATE invoice_payments SET
         direction = ?,
         amount = ?,
         payment_date = ?,
         payment_method = ?,
         bank_account_id = ?,
         reference = ?,
         notes = ?,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        direction || existing.direction,
        amt,
        payment_date || existing.payment_date,
        (payment_method !== undefined) ? payment_method : existing.payment_method,
        (bank_account_id !== undefined) ? (bank_account_id || null) : existing.bank_account_id,
        (reference !== undefined) ? reference : existing.reference,
        (notes !== undefined) ? notes : existing.notes,
        paymentId
      ]
    );
    const updated = queryOne('SELECT * FROM invoice_payments WHERE id = ?', [paymentId]);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: 'Zahlung konnte nicht aktualisiert werden: ' + e.message });
  }
});

// PAY-API-04 + PAY-API-05: Zahlung löschen
app.delete('/api/payments/:id', (req, res) => {
  // Permission-Guard (das globale Middleware lässt /api/payments/ durch — siehe Zeile 53)
  const permission = req.headers['x-user-permission'];
  if (!['Verwaltung', 'Buchhaltung', 'Admin'].includes(permission)) {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }
  const paymentId = Number(req.params.id);
  if (!paymentId) return res.status(400).json({ error: 'Ungültige Zahlungs-ID' });
  const existing = queryOne('SELECT id FROM invoice_payments WHERE id = ?', [paymentId]);
  if (!existing) return res.status(404).json({ error: 'Zahlung nicht gefunden' });
  execute('DELETE FROM invoice_payments WHERE id = ?', [paymentId]);
  res.json({ success: true, message: 'Zahlung gelöscht' });
});

// PDF Generation
app.get('/api/invoices/:id/pdf', (req, res) => {
  const invoice = queryOne(
    `SELECT i.*, c.first_name, c.last_name, c.company_name, c.customer_type, c.street, c.zip, c.city
     FROM invoices i JOIN customers c ON i.customer_id = c.id WHERE i.id = ?`,
    [Number(req.params.id)]
  );
  if (!invoice) return res.status(404).json({ error: 'Rechnung nicht gefunden' });
  const items = queryAll(
    'SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY position, id',
    [Number(req.params.id)]
  );

  // GoBD: Firmendaten aus Snapshot der Rechnung verwenden (eingefroren bei Erstellung)
  const co = invoice.company_snapshot ? JSON.parse(invoice.company_snapshot) : getCompanySettings();
  const PAGE_CONTENT_BOTTOM = 720;
  const PAGE_CONTENT_START  = 160;

  const doc = new PDFDocument({ size: 'A4', margin: 50, autoFirstPage: false });
  let _drawingHeader = false; // recursion guard for pageAdded

  // --- Inner helper: Letterhead (Briefkopf) ---
  function drawLetterhead() {
    if (_drawingHeader) return; // prevent recursion from doc.text/image triggering addPage
    _drawingHeader = true;
    // Logo top left
    const logoPath = path.join(__dirname, 'BemoLogo.png');
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, 50, 30, { fit: [144, 96] });
    }
    // Company name + address top right
    const addrX = 380;
    doc.fontSize(12).font('Helvetica-Bold').text('Bemo GmbH', addrX, 50, { lineBreak: false });
    doc.fontSize(8).font('Helvetica');
    doc.text(co.company_street, addrX, 66, { lineBreak: false });
    doc.text(`${co.company_zip} ${co.company_city}`, addrX, 76, { lineBreak: false });
    doc.text(`Tel: ${co.company_phone}`, addrX, 86, { lineBreak: false });
    doc.text(co.company_email, addrX, 96, { lineBreak: false });
    // Footer on every page
    drawFooter();
    _drawingHeader = false;
  }

  // --- Inner helper: Footer ---
  function drawFooter() {
    const footerY = 750;
    const lineH = 10;
    const rightX = 310;
    doc.fontSize(7).font('Helvetica');
    doc.moveTo(50, footerY).lineTo(545, footerY).stroke();
    // Left block
    doc.text('Bemo GmbH', 50, footerY + 6, { lineBreak: false });
    doc.text(co.company_street, 50, footerY + 6 + lineH, { lineBreak: false });
    doc.text(`${co.company_zip} ${co.company_city}`, 50, footerY + 6 + lineH * 2, { lineBreak: false });
    doc.text(`Geschäftsführer: ${co.company_ceo}`, 50, footerY + 6 + lineH * 3, { lineBreak: false });
    // Right block
    doc.text('Kontoinhaber: Bemo GmbH', rightX, footerY + 6, { lineBreak: false });
    doc.text(`IBAN: ${co.bank_iban || co.company_iban || '—'}   BIC: ${co.bank_bic || co.company_bic || '—'}`, rightX, footerY + 6 + lineH, { lineBreak: false });
    doc.text(co.bank_name || co.company_bank || '—', rightX, footerY + 6 + lineH * 2, { lineBreak: false });
    doc.text(`Steuernummer: ${co.company_tax_number}   ${co.company_hrb}`, rightX, footerY + 6 + lineH * 3, { lineBreak: false });
  }

  // --- Inner helper: Table column headers ---
  function drawTableHeader(headerY) {
    const colPos = 50, colDesc = 80, colQty = 340, colPrice = 400, colTotal = 480;
    doc.fontSize(9).font('Helvetica-Bold');
    doc.text('Pos',         colPos,   headerY);
    doc.text('Bezeichnung', colDesc,  headerY);
    doc.text('Menge',       colQty,   headerY, { width: 50,  align: 'right' });
    doc.text('Einzelpreis', colPrice, headerY, { width: 70,  align: 'right' });
    doc.text('Gesamt',      colTotal, headerY, { width: 65,  align: 'right' });
    doc.moveTo(50, headerY + 14).lineTo(545, headerY + 14).stroke();
  }

  // Register pageAdded BEFORE pipe so every addPage() draws letterhead+footer.
  doc.on('pageAdded', drawLetterhead);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${invoice.invoice_number}.pdf"`);
  doc.pipe(res);

  // === PAGE 1 === (autoFirstPage:false, so addPage triggers pageAdded → drawLetterhead)
  doc.addPage();

  // --- Sender line (DIN 5008, for windowed envelopes) ---
  doc.fontSize(7).font('Helvetica')
    .text(
      `Bemo GmbH · ${co.company_street} · ${co.company_zip} ${co.company_city}`,
      50, 130, { underline: true }
    );

  // --- Recipient address block ---
  doc.fontSize(10).font('Helvetica');
  let addrY = 148;
  if (invoice.customer_type === 'Firmenkunde' || invoice.customer_type === 'Werkstatt') {
    doc.text(invoice.company_name || '', 50, addrY);
    if (invoice.first_name || invoice.last_name) {
      addrY += 14;
      doc.text(`${invoice.first_name} ${invoice.last_name}`.trim(), 50, addrY);
    }
  } else {
    doc.text(`${invoice.first_name} ${invoice.last_name}`, 50, addrY);
  }
  addrY += 14;
  if (invoice.street) { doc.text(invoice.street, 50, addrY); addrY += 14; }
  if (invoice.zip || invoice.city) {
    doc.text(`${invoice.zip} ${invoice.city}`.trim(), 50, addrY);
  }

  // --- Right side: Invoice info block ---
  const infoX = 380;
  let infoY = 148;
  doc.fontSize(9);
  doc.font('Helvetica-Bold').text('Rechnungsnr.:', infoX, infoY, { continued: true })
    .font('Helvetica').text('  ' + invoice.invoice_number);
  infoY += 16;
  doc.font('Helvetica-Bold').text('Rechnungsdatum:', infoX, infoY, { continued: true })
    .font('Helvetica').text('  ' + formatDateDE(invoice.invoice_date));
  infoY += 16;
  if (invoice.service_date) {
    doc.font('Helvetica-Bold').text('Leistungsdatum:', infoX, infoY, { continued: true })
      .font('Helvetica').text('  ' + formatDateDE(invoice.service_date));
    infoY += 16;
  }
  if (invoice.due_date) {
    doc.font('Helvetica-Bold').text('Fällig bis:', infoX, infoY, { continued: true })
      .font('Helvetica').text('  ' + formatDateDE(invoice.due_date));
    infoY += 16;
  }
  doc.font('Helvetica-Bold').text('Kundennr.:', infoX, infoY, { continued: true })
    .font('Helvetica').text('  K-' + String(invoice.customer_id).padStart(4, '0'));

  // --- Title ---
  doc.fontSize(16).font('Helvetica-Bold').text('Rechnung', 50, 260);
  doc.moveTo(50, 280).lineTo(545, 280).stroke();

  // --- Items table ---
  const tableTop = 295;
  const colPos   = 50;
  const colDesc  = 80;
  const colQty   = 340;
  const colPrice = 400;
  const colTotal = 480;

  drawTableHeader(tableTop);

  let y = tableTop + 22;
  doc.font('Helvetica').fontSize(9);

  items.forEach(item => {
    // Pre-check: measure row height BEFORE drawing to prevent footer overlap
    const descHeight = doc.heightOfString(item.description || '', { width: 255, fontSize: 9 });
    const rowHeight  = Math.max(descHeight, 14);

    if (y + rowHeight > PAGE_CONTENT_BOTTOM) {
      doc.addPage();           // triggers pageAdded → drawLetterhead() + drawFooter()
      y = PAGE_CONTENT_START;
      drawTableHeader(y - 20);
      y += 4;
      doc.font('Helvetica').fontSize(9);
    }

    doc.text(String(item.position),       colPos,   y, { width: 25 });
    doc.text(item.description || '',      colDesc,  y, { width: 255 });
    doc.text(formatNumber(item.quantity), colQty,   y, { width: 50,  align: 'right' });
    doc.text(formatEuro(item.unit_price), colPrice, y, { width: 70,  align: 'right' });
    doc.text(formatEuro(item.total_net),  colTotal, y, { width: 65,  align: 'right' });
    y += rowHeight + 4;
  });

  // --- Totals block ---
  // If totals won't fit on current page, start a new one
  const TOTALS_BLOCK_HEIGHT = 80;
  if (y + TOTALS_BLOCK_HEIGHT > PAGE_CONTENT_BOTTOM) {
    doc.addPage();
    y = PAGE_CONTENT_START;
    doc.font('Helvetica').fontSize(9);
  }

  y += 8;
  doc.moveTo(350, y).lineTo(545, y).stroke();
  y += 10;

  doc.fontSize(9).font('Helvetica');
  doc.text('Nettobetrag:',    350, y, { width: 120, align: 'right' });
  doc.text(formatEuro(invoice.total_net),   colTotal, y, { width: 65, align: 'right' });
  y += 16;
  doc.text('zzgl. 19% MwSt:', 350, y, { width: 120, align: 'right' });
  doc.text(formatEuro(invoice.total_vat),   colTotal, y, { width: 65, align: 'right' });
  y += 16;
  doc.moveTo(350, y).lineTo(545, y).stroke();
  y += 6;
  doc.font('Helvetica-Bold').fontSize(11);
  doc.text('Bruttobetrag:',   350, y, { width: 120, align: 'right' });
  doc.text(formatEuro(invoice.total_gross), colTotal, y, { width: 65, align: 'right' });

  // --- Notes / Bemerkungen ---
  if (invoice.notes) {
    y += 40;
    if (y + 30 > PAGE_CONTENT_BOTTOM) {
      doc.addPage();
      y = PAGE_CONTENT_START;
    }
    doc.font('Helvetica').fontSize(9).text(invoice.notes, 50, y, { width: 495 });
  }

  doc.end();
});

// PDF helper functions
function formatDateDE(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}.${parts[1]}.${parts[0]}`;
}

function formatEuro(val) {
  return Number(val || 0).toFixed(2).replace('.', ',') + ' €';
}

function formatNumber(val) {
  const n = Number(val || 0);
  return n % 1 === 0 ? String(n) : n.toFixed(2).replace('.', ',');
}

// ===== CREDIT NOTES (Gutschriften) =====

function generateCreditNumber() {
  const now = berlinNow();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = String(now.getFullYear());
  const prefix = 'G' + mm + yyyy;
  const last = queryOne(
    "SELECT credit_number FROM credit_notes WHERE credit_number LIKE ? ORDER BY credit_number DESC LIMIT 1",
    [prefix + '%']
  );
  let nextNum = 1;
  if (last) {
    nextNum = parseInt(last.credit_number.slice(7)) + 1;
  }
  return prefix + String(nextNum).padStart(3, '0');
}

function recalcCreditTotals(creditId) {
  const items = queryAll('SELECT * FROM credit_note_items WHERE credit_note_id = ?', [creditId]);
  let totalNet = 0, totalGross = 0;
  items.forEach(item => {
    totalNet += Number(item.total_net) || 0;
    totalGross += Number(item.total_gross) || 0;
  });
  const totalVat = totalGross - totalNet;
  execute('UPDATE credit_notes SET total_net = ?, total_gross = ?, total_vat = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [totalNet, totalGross, totalVat, creditId]);
}

app.get('/api/credit-notes', (req, res) => {
  const { status, search } = req.query;
  let sql = `SELECT cn.*,
    CASE WHEN c.customer_type IN ('Firmenkunde','Werkstatt') THEN c.company_name ELSE c.last_name || ', ' || c.first_name END as customer_name
    FROM credit_notes cn JOIN customers c ON cn.customer_id = c.id WHERE 1=1`;
  const params = [];
  if (status) { sql += ' AND cn.status = ?'; params.push(status); }
  if (search) {
    const term = `%${search}%`;
    sql += ' AND (cn.credit_number LIKE ? OR c.last_name LIKE ? OR c.first_name LIKE ? OR c.company_name LIKE ?)';
    params.push(term, term, term, term);
  }
  sql += ' ORDER BY cn.credit_date DESC, cn.id DESC';
  res.json(queryAll(sql, params));
});

app.get('/api/credit-notes/:id', (req, res) => {
  const cn = queryOne(`SELECT cn.*, c.first_name, c.last_name, c.company_name, c.customer_type, c.street, c.zip, c.city, c.email, c.phone
    FROM credit_notes cn JOIN customers c ON cn.customer_id = c.id WHERE cn.id = ?`, [Number(req.params.id)]);
  if (!cn) return res.status(404).json({ error: 'Gutschrift nicht gefunden' });
  const items = queryAll('SELECT * FROM credit_note_items WHERE credit_note_id = ? ORDER BY position, id', [Number(req.params.id)]);
  res.json({ ...cn, items });
});

app.post('/api/credit-notes', (req, res) => {
  const permission = req.headers['x-user-permission'];
  if (!['Verwaltung', 'Buchhaltung', 'Admin'].includes(permission)) {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }
  const { customer_id, vermittler_id, credit_date, due_date, service_date, payment_method, notes, bank_account_id } = req.body;
  if (!customer_id && !vermittler_id) {
    if (!credit_date) return res.status(400).json({ error: 'Gutschriftsdatum ist ein Pflichtfeld' });
    return res.status(400).json({ error: 'Kunde oder Vermittler ist ein Pflichtfeld' });
  }
  if (!credit_date) {
    return res.status(400).json({ error: 'Gutschriftsdatum ist ein Pflichtfeld' });
  }
  let credit_number;
  try {
    credit_number = generateCreditNumber();
  } catch(e) {
    return res.status(500).json({ error: 'Gutschriftennummer konnte nicht vergeben werden' });
  }
  try {
    const snapshot = JSON.stringify(buildSnapshot(bank_account_id));
    const result = execute(
      'INSERT INTO credit_notes (credit_number, customer_id, vermittler_id, credit_date, due_date, service_date, payment_method, notes, company_snapshot) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [credit_number, customer_id || 0, vermittler_id || null, credit_date, due_date || '', service_date || '', payment_method || 'Überweisung', notes || '', snapshot]
    );
    res.json({ id: result.lastId, credit_number, message: 'Gutschrift erstellt' });
  } catch(e) {
    console.error('Credit note creation error:', e.message);
    res.status(500).json({ error: 'Gutschrift konnte nicht erstellt werden: ' + e.message });
  }
});

app.put('/api/credit-notes/:id', (req, res) => {
  const permission = req.headers['x-user-permission'];
  if (!['Verwaltung', 'Buchhaltung', 'Admin'].includes(permission)) {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }
  const { due_date, status, service_date, payment_method, notes } = req.body;
  execute(
    'UPDATE credit_notes SET due_date=?, status=?, service_date=?, payment_method=?, notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
    [due_date || '', status || 'Entwurf', service_date || '', payment_method || 'Überweisung', notes || '', Number(req.params.id)]
  );
  res.json({ message: 'Gutschrift aktualisiert' });
});

app.delete('/api/credit-notes/:id', (req, res) => {
  const cn = queryOne('SELECT status FROM credit_notes WHERE id = ?', [Number(req.params.id)]);
  if (!cn) return res.status(404).json({ error: 'Gutschrift nicht gefunden' });
  if (cn.status !== 'Entwurf') {
    return res.status(403).json({ error: 'Finalisierte Gutschriften dürfen nicht gelöscht werden' });
  }
  execute('DELETE FROM credit_notes WHERE id = ?', [Number(req.params.id)]);
  res.json({ message: 'Gutschrift gelöscht' });
});

// Credit Note Items
app.post('/api/credit-notes/:id/items', (req, res) => {
  const permission = req.headers['x-user-permission'];
  if (!['Verwaltung', 'Buchhaltung', 'Admin'].includes(permission)) {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }
  const creditId = Number(req.params.id);
  const { description, quantity, unit_price, vat_rate } = req.body;
  if (!description) return res.status(400).json({ error: 'Bezeichnung ist Pflichtfeld' });
  const qty = Number(quantity) || 1;
  const price = Number(unit_price) || 0;
  const rate = Number(vat_rate) || 0.19;
  const totalNet = Math.round(qty * price * 100) / 100;
  const totalGross = Math.round(totalNet * (1 + rate) * 100) / 100;
  const lastPos = queryOne('SELECT MAX(position) as maxPos FROM credit_note_items WHERE credit_note_id = ?', [creditId]);
  const position = (lastPos?.maxPos || 0) + 1;
  const result = execute(
    'INSERT INTO credit_note_items (credit_note_id, position, description, quantity, unit_price, total_net, total_gross, vat_rate) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [creditId, position, description, qty, price, totalNet, totalGross, rate]
  );
  recalcCreditTotals(creditId);
  res.json({ id: result.lastId, message: 'Position hinzugefügt' });
});

app.put('/api/credit-note-items/:id', (req, res) => {
  const permission = req.headers['x-user-permission'];
  if (!['Verwaltung', 'Buchhaltung', 'Admin'].includes(permission)) {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }
  const { description, quantity, unit_price, vat_rate } = req.body;
  const qty = Number(quantity) || 1;
  const price = Number(unit_price) || 0;
  const rate = Number(vat_rate) || 0.19;
  const totalNet = Math.round(qty * price * 100) / 100;
  const totalGross = Math.round(totalNet * (1 + rate) * 100) / 100;
  execute(
    'UPDATE credit_note_items SET description=?, quantity=?, unit_price=?, total_net=?, total_gross=?, vat_rate=? WHERE id=?',
    [description || '', qty, price, totalNet, totalGross, rate, Number(req.params.id)]
  );
  const item = queryOne('SELECT credit_note_id FROM credit_note_items WHERE id = ?', [Number(req.params.id)]);
  if (item) recalcCreditTotals(item.credit_note_id);
  res.json({ message: 'Position aktualisiert' });
});

app.delete('/api/credit-note-items/:id', (req, res) => {
  const item = queryOne('SELECT credit_note_id FROM credit_note_items WHERE id = ?', [Number(req.params.id)]);
  execute('DELETE FROM credit_note_items WHERE id = ?', [Number(req.params.id)]);
  if (item) recalcCreditTotals(item.credit_note_id);
  res.json({ message: 'Position gelöscht' });
});

// Credit Note PDF
app.get('/api/credit-notes/:id/pdf', (req, res) => {
  const cn = queryOne(
    `SELECT cn.*, c.first_name, c.last_name, c.company_name, c.customer_type, c.street, c.zip, c.city
     FROM credit_notes cn JOIN customers c ON cn.customer_id = c.id WHERE cn.id = ?`,
    [Number(req.params.id)]
  );
  if (!cn) return res.status(404).json({ error: 'Gutschrift nicht gefunden' });
  const items = queryAll('SELECT * FROM credit_note_items WHERE credit_note_id = ? ORDER BY position, id', [Number(req.params.id)]);

  // GoBD: Firmendaten aus Snapshot der Gutschrift verwenden (eingefroren bei Erstellung)
  const co = cn.company_snapshot ? JSON.parse(cn.company_snapshot) : getCompanySettings();
  const PAGE_CONTENT_BOTTOM = 720;
  const PAGE_CONTENT_START  = 160;

  const doc = new PDFDocument({ size: 'A4', margin: 50, autoFirstPage: false });
  let _drawingHeader = false;

  function drawLetterhead() {
    if (_drawingHeader) return;
    _drawingHeader = true;
    const logoPath = path.join(__dirname, 'BemoLogo.png');
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, 50, 30, { fit: [144, 96] });
    }
    const addrX = 380;
    doc.fontSize(12).font('Helvetica-Bold').text('Bemo GmbH', addrX, 50, { lineBreak: false });
    doc.fontSize(8).font('Helvetica');
    doc.text(co.company_street, addrX, 66, { lineBreak: false });
    doc.text(`${co.company_zip} ${co.company_city}`, addrX, 76, { lineBreak: false });
    doc.text(`Tel: ${co.company_phone}`, addrX, 86, { lineBreak: false });
    doc.text(co.company_email, addrX, 96, { lineBreak: false });
    drawCreditFooter();
    _drawingHeader = false;
  }

  function drawCreditFooter() {
    const footerY = 750;
    const lineH = 10;
    const rightX = 310;
    doc.fontSize(7).font('Helvetica');
    doc.moveTo(50, footerY).lineTo(545, footerY).stroke();
    doc.text('Bemo GmbH', 50, footerY + 6, { lineBreak: false });
    doc.text(co.company_street, 50, footerY + 6 + lineH, { lineBreak: false });
    doc.text(`${co.company_zip} ${co.company_city}`, 50, footerY + 6 + lineH * 2, { lineBreak: false });
    doc.text(`Geschäftsführer: ${co.company_ceo}`, 50, footerY + 6 + lineH * 3, { lineBreak: false });
    doc.text('Kontoinhaber: Bemo GmbH', rightX, footerY + 6, { lineBreak: false });
    doc.text(`IBAN: ${co.bank_iban || co.company_iban || '—'}   BIC: ${co.bank_bic || co.company_bic || '—'}`, rightX, footerY + 6 + lineH, { lineBreak: false });
    doc.text(co.bank_name || co.company_bank || '—', rightX, footerY + 6 + lineH * 2, { lineBreak: false });
    doc.text(`Steuernummer: ${co.company_tax_number}   ${co.company_hrb}`, rightX, footerY + 6 + lineH * 3, { lineBreak: false });
  }

  function drawTableHeader(headerY) {
    const colPos = 50, colDesc = 80, colQty = 340, colPrice = 400, colTotal = 480;
    doc.fontSize(9).font('Helvetica-Bold');
    doc.text('Pos',         colPos,   headerY);
    doc.text('Bezeichnung', colDesc,  headerY);
    doc.text('Menge',       colQty,   headerY, { width: 50,  align: 'right' });
    doc.text('Einzelpreis', colPrice, headerY, { width: 70,  align: 'right' });
    doc.text('Gesamt',      colTotal, headerY, { width: 65,  align: 'right' });
    doc.moveTo(50, headerY + 14).lineTo(545, headerY + 14).stroke();
  }

  doc.on('pageAdded', drawLetterhead);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${cn.credit_number}.pdf"`);
  doc.pipe(res);

  doc.addPage();

  doc.fontSize(7).font('Helvetica')
    .text(`Bemo GmbH · ${co.company_street} · ${co.company_zip} ${co.company_city}`, 50, 130, { underline: true });

  doc.fontSize(10).font('Helvetica');
  let addrY = 148;
  if (cn.customer_type === 'Firmenkunde' || cn.customer_type === 'Werkstatt') {
    doc.text(cn.company_name || '', 50, addrY);
    if (cn.first_name || cn.last_name) { addrY += 14; doc.text(`${cn.first_name} ${cn.last_name}`.trim(), 50, addrY); }
  } else {
    doc.text(`${cn.first_name} ${cn.last_name}`, 50, addrY);
  }
  addrY += 14;
  if (cn.street) { doc.text(cn.street, 50, addrY); addrY += 14; }
  if (cn.zip || cn.city) { doc.text(`${cn.zip} ${cn.city}`.trim(), 50, addrY); }

  const infoX = 380;
  let infoY = 148;
  doc.fontSize(9);
  doc.font('Helvetica-Bold').text('Gutschriftnr.:', infoX, infoY, { continued: true })
    .font('Helvetica').text('  ' + cn.credit_number);
  infoY += 16;
  doc.font('Helvetica-Bold').text('Datum:', infoX, infoY, { continued: true })
    .font('Helvetica').text('  ' + formatDateDE(cn.credit_date));
  infoY += 16;
  doc.font('Helvetica-Bold').text('Kundennr.:', infoX, infoY, { continued: true })
    .font('Helvetica').text('  K-' + String(cn.customer_id).padStart(4, '0'));

  doc.fontSize(16).font('Helvetica-Bold').text('Gutschrift', 50, 260);
  doc.moveTo(50, 280).lineTo(545, 280).stroke();

  const tableTop = 295;
  const colPos = 50, colDesc = 80, colQty = 340, colPrice = 400, colTotal = 480;
  drawTableHeader(tableTop);

  let y = tableTop + 22;
  doc.font('Helvetica').fontSize(9);

  items.forEach(item => {
    const descHeight = doc.heightOfString(item.description || '', { width: 255, fontSize: 9 });
    const rowHeight = Math.max(descHeight, 14);
    if (y + rowHeight > PAGE_CONTENT_BOTTOM) {
      doc.addPage();
      y = PAGE_CONTENT_START;
      drawTableHeader(y - 20);
      y += 4;
      doc.font('Helvetica').fontSize(9);
    }
    doc.text(String(item.position),       colPos,   y, { width: 25 });
    doc.text(item.description || '',      colDesc,  y, { width: 255 });
    doc.text(formatNumber(item.quantity), colQty,   y, { width: 50,  align: 'right' });
    doc.text(formatEuro(item.unit_price), colPrice, y, { width: 70,  align: 'right' });
    doc.text(formatEuro(item.total_net),  colTotal, y, { width: 65,  align: 'right' });
    y += rowHeight + 4;
  });

  const TOTALS_BLOCK_HEIGHT = 80;
  if (y + TOTALS_BLOCK_HEIGHT > PAGE_CONTENT_BOTTOM) { doc.addPage(); y = PAGE_CONTENT_START; doc.font('Helvetica').fontSize(9); }

  y += 8;
  doc.moveTo(350, y).lineTo(545, y).stroke();
  y += 10;
  doc.fontSize(9).font('Helvetica');
  doc.text('Nettobetrag:',    350, y, { width: 120, align: 'right' });
  doc.text(formatEuro(cn.total_net),   colTotal, y, { width: 65, align: 'right' });
  y += 16;
  doc.text('zzgl. 19% MwSt:', 350, y, { width: 120, align: 'right' });
  doc.text(formatEuro(cn.total_vat),   colTotal, y, { width: 65, align: 'right' });
  y += 16;
  doc.moveTo(350, y).lineTo(545, y).stroke();
  y += 6;
  doc.font('Helvetica-Bold').fontSize(11);
  doc.text('Bruttobetrag:',   350, y, { width: 120, align: 'right' });
  doc.text(formatEuro(cn.total_gross), colTotal, y, { width: 65, align: 'right' });

  if (cn.notes) {
    y += 40;
    if (y + 30 > PAGE_CONTENT_BOTTOM) { doc.addPage(); y = PAGE_CONTENT_START; }
    doc.font('Helvetica').fontSize(9).text(cn.notes, 50, y, { width: 495 });
  }

  doc.end();
});

// ===== CHANGELOG (Programmversion) =====

app.get('/api/changelog/unacknowledged', (req, res) => {
  const userId = Number(req.headers['x-user-id']);
  if (!userId) return res.json(null);
  // Eintrittsdatum des Mitarbeiters ermitteln - nur Updates danach anzeigen
  const staff = queryOne('SELECT entry_date FROM staff WHERE id = ?', [userId]);
  const entryDate = staff && staff.entry_date ? staff.entry_date : '1900-01-01';
  // Älteste unbestätigte Version zuerst (nur nach Eintrittsdatum)
  const oldest = queryOne(
    `SELECT * FROM changelog WHERE release_date >= ? AND id NOT IN (SELECT changelog_id FROM changelog_acknowledgements WHERE staff_id = ?) ORDER BY release_date ASC, id ASC LIMIT 1`,
    [entryDate, userId]
  );
  if (!oldest) return res.json(null);
  res.json(oldest);
});

app.get('/api/changelog', (req, res) => {
  res.json(queryAll('SELECT * FROM changelog ORDER BY release_date DESC, id DESC'));
});

app.post('/api/changelog/:id/acknowledge', (req, res) => {
  const userId = Number(req.headers['x-user-id']);
  const changelogId = Number(req.params.id);
  try {
    execute('INSERT OR IGNORE INTO changelog_acknowledgements (staff_id, changelog_id) VALUES (?, ?)', [userId, changelogId]);
  } catch (e) { /* already acknowledged */ }
  res.json({ message: 'Bestätigt' });
});

app.post('/api/changelog', (req, res) => {
  const permission = req.headers['x-user-permission'];
  if (permission !== 'Admin') return res.status(403).json({ error: 'Nur Admins dürfen Versionen anlegen' });
  const { version, release_date, description } = req.body;
  if (!version || !release_date) return res.status(400).json({ error: 'Version und Datum sind Pflichtfelder' });
  const result = execute(
    'INSERT INTO changelog (version, release_date, description) VALUES (?, ?, ?)',
    [version, release_date, description || '']
  );
  res.json({ id: result.lastId, message: 'Version erstellt' });
});

app.put('/api/changelog/:id', (req, res) => {
  const permission = req.headers['x-user-permission'];
  if (permission !== 'Admin') return res.status(403).json({ error: 'Nur Admins dürfen Versionen bearbeiten' });
  const { version, release_date, description } = req.body;
  if (!version || !release_date) return res.status(400).json({ error: 'Version und Datum sind Pflichtfelder' });
  execute(
    'UPDATE changelog SET version=?, release_date=?, description=? WHERE id=?',
    [version, release_date, description || '', Number(req.params.id)]
  );
  res.json({ message: 'Version aktualisiert' });
});

app.delete('/api/changelog/:id', (req, res) => {
  execute('DELETE FROM changelog WHERE id = ?', [Number(req.params.id)]);
  res.json({ message: 'Version gelöscht' });
});

// ===== TICKETS =====

app.get('/api/tickets/unread-count', (req, res) => {
  const userId = Number(req.headers['x-user-id']);
  const count = queryOne('SELECT COUNT(*) as count FROM tickets WHERE staff_id = ? AND read_by_creator = 0', [userId]);
  res.json({ count: count?.count || 0 });
});

app.get('/api/tickets', (req, res) => {
  const permission = req.headers['x-user-permission'];
  const userId = Number(req.headers['x-user-id']);
  if (permission === 'Admin') {
    res.json(queryAll('SELECT t.*, s.name as staff_name FROM tickets t LEFT JOIN staff s ON t.staff_id = s.id ORDER BY t.created_at DESC'));
  } else {
    res.json(queryAll('SELECT t.*, s.name as staff_name FROM tickets t LEFT JOIN staff s ON t.staff_id = s.id WHERE t.staff_id = ? ORDER BY t.created_at DESC', [userId]));
  }
});

app.post('/api/tickets', (req, res) => {
  const userId = Number(req.headers['x-user-id']);
  const { subject, description } = req.body;
  if (!subject) return res.status(400).json({ error: 'Betreff ist Pflichtfeld' });
  const result = execute(
    'INSERT INTO tickets (staff_id, subject, description) VALUES (?, ?, ?)',
    [userId, subject, description || '']
  );
  res.json({ id: result.lastId, message: 'Ticket erstellt' });
});

app.put('/api/tickets/:id', async (req, res) => {
  const permission = req.headers['x-user-permission'];
  if (permission !== 'Admin') return res.status(403).json({ error: 'Nur Admins dürfen Tickets bearbeiten' });
  const { status, admin_response } = req.body;
  execute(
    'UPDATE tickets SET status=?, admin_response=?, read_by_creator=0, updated_at=CURRENT_TIMESTAMP WHERE id=?',
    [status || 'Offen', admin_response || '', Number(req.params.id)]
  );

  // Send email notification to ticket creator
  let emailSent = false;
  let emailSkipReason = '';
  try {
    const ticket = queryOne('SELECT t.*, s.name as staff_name, s.email as staff_email FROM tickets t JOIN staff s ON t.staff_id = s.id WHERE t.id = ?', [Number(req.params.id)]);
    if (!ticket) {
      emailSkipReason = 'Ticket nicht gefunden';
    } else if (!ticket.staff_email) {
      emailSkipReason = `Mitarbeiter "${ticket.staff_name}" hat keine E-Mail-Adresse hinterlegt`;
    } else {
      const sendMailbox = getSettingDecrypted('o365_send_mailbox');
      if (!sendMailbox) {
        emailSkipReason = 'Kein Ausgangs-Postfach konfiguriert';
      } else {
        const datum = ticket.created_at ? ticket.created_at.split(' ')[0].split('-').reverse().join('.') : '';
        const token = await getGraphToken();
        const body = `<p>Hallo ${ticket.staff_name},</p>
<p>der Status deines Support-Tickets vom ${datum} hat sich geändert auf <strong>${status || 'Offen'}</strong>.</p>
${admin_response ? `<p><strong>Kommentar:</strong><br>${admin_response.replace(/\n/g, '<br>')}</p>` : ''}
<p>Ich hoffe, dein Ticket wurde zu deiner Zufriedenheit bearbeitet.</p>
<p>Mit freundlichen Grüßen<br>Der Admin</p>`;
        await graphRequest(token,
          `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sendMailbox)}/sendMail`,
          { method: 'POST', body: JSON.stringify({ message: { subject: `Ticket-Update: ${ticket.subject}`, body: { contentType: 'HTML', content: body }, toRecipients: [{ emailAddress: { address: ticket.staff_email } }] }, saveToSentItems: true }) }
        );
        emailSent = true;
      }
    }
  } catch (e) { emailSkipReason = e.message; }

  res.json({ message: 'Ticket aktualisiert', emailSent, emailSkipReason });
});

app.put('/api/tickets/:id/read', (req, res) => {
  execute('UPDATE tickets SET read_by_creator=1 WHERE id=?', [Number(req.params.id)]);
  res.json({ message: 'Als gelesen markiert' });
});

// ===== SUGGESTIONS =====

app.get('/api/suggestions/unread-count', (req, res) => {
  const userId = Number(req.headers['x-user-id']);
  const count = queryOne('SELECT COUNT(*) as count FROM suggestions WHERE staff_id = ? AND read_by_creator = 0', [userId]);
  res.json({ count: count?.count || 0 });
});

app.get('/api/suggestions', (req, res) => {
  const permission = req.headers['x-user-permission'];
  const userId = Number(req.headers['x-user-id']);
  if (permission === 'Admin') {
    res.json(queryAll('SELECT sg.*, s.name as staff_name FROM suggestions sg LEFT JOIN staff s ON sg.staff_id = s.id ORDER BY sg.created_at DESC'));
  } else {
    res.json(queryAll('SELECT sg.*, s.name as staff_name FROM suggestions sg LEFT JOIN staff s ON sg.staff_id = s.id WHERE sg.staff_id = ? ORDER BY sg.created_at DESC', [userId]));
  }
});

app.post('/api/suggestions', (req, res) => {
  const userId = Number(req.headers['x-user-id']);
  const { subject, description } = req.body;
  if (!subject) return res.status(400).json({ error: 'Betreff ist Pflichtfeld' });
  const result = execute(
    'INSERT INTO suggestions (staff_id, subject, description) VALUES (?, ?, ?)',
    [userId, subject, description || '']
  );
  res.json({ id: result.lastId, message: 'Vorschlag erstellt' });
});

app.put('/api/suggestions/:id', async (req, res) => {
  const permission = req.headers['x-user-permission'];
  if (permission !== 'Admin') return res.status(403).json({ error: 'Nur Admins dürfen Vorschläge bearbeiten' });
  const { status, admin_comment } = req.body;
  execute(
    'UPDATE suggestions SET status=?, admin_comment=?, read_by_creator=0, updated_at=CURRENT_TIMESTAMP WHERE id=?',
    [status || 'Offen', admin_comment || '', Number(req.params.id)]
  );

  // Send email notification to suggestion creator
  let emailSent = false;
  let emailSkipReason = '';
  try {
    const suggestion = queryOne('SELECT s.*, st.name as staff_name, st.email as staff_email FROM suggestions s JOIN staff st ON s.staff_id = st.id WHERE s.id = ?', [Number(req.params.id)]);
    if (!suggestion) {
      emailSkipReason = 'Vorschlag nicht gefunden';
    } else if (!suggestion.staff_email) {
      emailSkipReason = `Mitarbeiter "${suggestion.staff_name}" hat keine E-Mail-Adresse hinterlegt`;
    } else {
      const sendMailbox = getSettingDecrypted('o365_send_mailbox');
      if (!sendMailbox) {
        emailSkipReason = 'Kein Ausgangs-Postfach konfiguriert';
      } else {
        const datum = suggestion.created_at ? suggestion.created_at.split(' ')[0].split('-').reverse().join('.') : '';
        const token = await getGraphToken();
        const body = `<p>Hallo ${suggestion.staff_name},</p>
<p>der Status deines Vorschlages vom ${datum} hat sich geändert auf <strong>${status || 'Offen'}</strong>.</p>
${admin_comment ? `<p><strong>Kommentar:</strong><br>${admin_comment.replace(/\n/g, '<br>')}</p>` : ''}
<p>Danke für deinen Vorschlag.</p>
<p>Mit freundlichen Grüßen<br>Der Admin</p>`;
        await graphRequest(token,
          `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sendMailbox)}/sendMail`,
          { method: 'POST', body: JSON.stringify({ message: { subject: `Vorschlags-Update: ${suggestion.subject}`, body: { contentType: 'HTML', content: body }, toRecipients: [{ emailAddress: { address: suggestion.staff_email } }] }, saveToSentItems: true }) }
        );
        emailSent = true;
      }
    }
  } catch (e) { emailSkipReason = e.message; }

  res.json({ message: 'Vorschlag aktualisiert', emailSent, emailSkipReason });
});

app.put('/api/suggestions/:id/read', (req, res) => {
  execute('UPDATE suggestions SET read_by_creator=1 WHERE id=?', [Number(req.params.id)]);
  res.json({ message: 'Als gelesen markiert' });
});

// ===== FLEET VEHICLES (Fuhrpark) =====

app.get('/api/fleet-vehicles', (req, res) => {
  const permission = req.headers['x-user-permission'];
  const userId = req.headers['x-user-id'];
  const kmSub = `(SELECT km_stand FROM fleet_mileage WHERE fleet_vehicle_id = fv.id ORDER BY record_date DESC, id DESC LIMIT 1)`;
  const maintDateSub = `(SELECT next_maintenance_date FROM fleet_maintenance WHERE fleet_vehicle_id = fv.id AND next_maintenance_date != '' ORDER BY maintenance_date DESC, id DESC LIMIT 1)`;
  const maintKmSub = `(SELECT next_maintenance_km FROM fleet_maintenance WHERE fleet_vehicle_id = fv.id AND next_maintenance_km > 0 ORDER BY maintenance_date DESC, id DESC LIMIT 1)`;
  const custSub = `CASE WHEN c.customer_type IN ('Firmenkunde','Werkstatt') THEN c.company_name ELSE c.first_name || ' ' || c.last_name END`;
  if (permission === 'Admin' || permission === 'Verwaltung') {
    res.json(queryAll(`SELECT fv.*, s.name as staff_name, ${custSub} as assigned_customer_name, ${kmSub} as latest_km, ${maintDateSub} as next_maintenance_date, ${maintKmSub} as next_maintenance_km FROM fleet_vehicles fv LEFT JOIN staff s ON fv.assigned_staff_id = s.id LEFT JOIN customers c ON fv.assigned_customer_id = c.id ORDER BY fv.rental_type, fv.manufacturer, fv.model`));
  } else {
    res.json(queryAll(`SELECT fv.*, s.name as staff_name, ${custSub} as assigned_customer_name, ${kmSub} as latest_km, ${maintDateSub} as next_maintenance_date, ${maintKmSub} as next_maintenance_km FROM fleet_vehicles fv LEFT JOIN staff s ON fv.assigned_staff_id = s.id LEFT JOIN customers c ON fv.assigned_customer_id = c.id WHERE fv.assigned_staff_id = ? ORDER BY fv.rental_type, fv.manufacturer, fv.model`, [Number(userId)]));
  }
});

app.get('/api/fleet-vehicles/:id', (req, res) => {
  const permission = req.headers['x-user-permission'];
  const userId = req.headers['x-user-id'];
  const kmSub = `(SELECT km_stand FROM fleet_mileage WHERE fleet_vehicle_id = fv.id ORDER BY record_date DESC, id DESC LIMIT 1)`;
  const maintDateSub = `(SELECT next_maintenance_date FROM fleet_maintenance WHERE fleet_vehicle_id = fv.id AND next_maintenance_date != '' ORDER BY maintenance_date DESC, id DESC LIMIT 1)`;
  const maintKmSub = `(SELECT next_maintenance_km FROM fleet_maintenance WHERE fleet_vehicle_id = fv.id AND next_maintenance_km > 0 ORDER BY maintenance_date DESC, id DESC LIMIT 1)`;
  const custSub2 = `CASE WHEN c.customer_type IN ('Firmenkunde','Werkstatt') THEN c.company_name ELSE c.first_name || ' ' || c.last_name END`;
  const vehicle = queryOne(`SELECT fv.*, s.name as staff_name, ${custSub2} as assigned_customer_name, ${kmSub} as latest_km, ${maintDateSub} as next_maintenance_date, ${maintKmSub} as next_maintenance_km FROM fleet_vehicles fv LEFT JOIN staff s ON fv.assigned_staff_id = s.id LEFT JOIN customers c ON fv.assigned_customer_id = c.id WHERE fv.id = ?`, [Number(req.params.id)]);
  if (!vehicle) return res.status(404).json({ error: 'Fahrzeug nicht gefunden' });
  if (permission !== 'Admin' && permission !== 'Verwaltung' && vehicle.assigned_staff_id !== Number(userId)) {
    return res.status(403).json({ error: 'Kein Zugriff auf dieses Fahrzeug' });
  }
  const maintenance = queryAll('SELECT * FROM fleet_maintenance WHERE fleet_vehicle_id = ? ORDER BY maintenance_date DESC, id DESC', [Number(req.params.id)]);
  const mileage = queryAll('SELECT fm.*, s.name as staff_name FROM fleet_mileage fm LEFT JOIN staff s ON fm.recorded_by_staff_id = s.id WHERE fm.fleet_vehicle_id = ? ORDER BY fm.record_date DESC, fm.id DESC', [Number(req.params.id)]);
  const damages = queryAll('SELECT * FROM fleet_damages WHERE fleet_vehicle_id = ? ORDER BY damage_date DESC, id DESC', [Number(req.params.id)]);
  const insurance = queryAll('SELECT * FROM fleet_insurance WHERE fleet_vehicle_id = ? ORDER BY contract_date DESC, id DESC', [Number(req.params.id)]);
  const tax = queryAll('SELECT * FROM fleet_tax WHERE fleet_vehicle_id = ? ORDER BY tax_date DESC, id DESC', [Number(req.params.id)]);
  res.json({ ...vehicle, maintenance, mileage, damages, insurance, tax });
});

app.post('/api/fleet-vehicles', (req, res) => {
  const permission = req.headers['x-user-permission'];
  if (permission !== 'Admin' && permission !== 'Verwaltung') return res.status(403).json({ error: 'Keine Berechtigung' });
  const { manufacturer, model, vehicle_type, vin, license_plate, first_registration, next_tuev_date, rental_type, assigned_customer_id, assigned_contact_person, notes } = req.body;
  if (!manufacturer || !model) return res.status(400).json({ error: 'Hersteller und Modell sind Pflichtfelder' });
  const result = execute(
    'INSERT INTO fleet_vehicles (manufacturer, model, vehicle_type, vin, license_plate, first_registration, next_tuev_date, rental_type, assigned_customer_id, assigned_contact_person, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [manufacturer, model, vehicle_type || '', vin || '', license_plate || '', first_registration || '', next_tuev_date || '', rental_type || 'kurz', assigned_customer_id || null, assigned_contact_person || '', notes || '']
  );
  res.json({ id: result.lastId, message: 'Fahrzeug erstellt' });
});

app.put('/api/fleet-vehicles/:id', (req, res) => {
  const permission = req.headers['x-user-permission'];
  if (permission !== 'Admin' && permission !== 'Verwaltung') return res.status(403).json({ error: 'Keine Berechtigung' });
  const { manufacturer, model, vehicle_type, vin, license_plate, first_registration, next_tuev_date, rental_type, assigned_customer_id, assigned_contact_person, notes } = req.body;
  if (!manufacturer || !model) return res.status(400).json({ error: 'Hersteller und Modell sind Pflichtfelder' });
  execute(
    'UPDATE fleet_vehicles SET manufacturer=?, model=?, vehicle_type=?, vin=?, license_plate=?, first_registration=?, next_tuev_date=?, rental_type=?, assigned_customer_id=?, assigned_contact_person=?, notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
    [manufacturer, model, vehicle_type || '', vin || '', license_plate || '', first_registration || '', next_tuev_date || '', rental_type || 'kurz', assigned_customer_id || null, assigned_contact_person || '', notes || '', Number(req.params.id)]
  );
  res.json({ message: 'Fahrzeug aktualisiert' });
});

app.put('/api/fleet-vehicles/:id/km', (req, res) => {
  const permission = req.headers['x-user-permission'];
  const userId = req.headers['x-user-id'];
  const vehicle = queryOne('SELECT * FROM fleet_vehicles WHERE id = ?', [Number(req.params.id)]);
  if (!vehicle) return res.status(404).json({ error: 'Fahrzeug nicht gefunden' });
  if (permission !== 'Admin' && permission !== 'Verwaltung' && vehicle.assigned_staff_id !== Number(userId)) {
    return res.status(403).json({ error: 'Kein Zugriff auf dieses Fahrzeug' });
  }
  const { km_stand } = req.body;
  if (!km_stand && km_stand !== 0) return res.status(400).json({ error: 'KM-Stand ist Pflichtfeld' });
  execute('INSERT INTO fleet_mileage (fleet_vehicle_id, record_date, km_stand, recorded_by_staff_id) VALUES (?, date("now"), ?, ?)',
    [Number(req.params.id), Number(km_stand), Number(userId) || null]);
  res.json({ message: 'KM-Stand aktualisiert' });
});

app.delete('/api/fleet-vehicles/:id', (req, res) => {
  execute('DELETE FROM fleet_vehicles WHERE id = ?', [Number(req.params.id)]);
  res.json({ message: 'Fahrzeug gelöscht' });
});

// Fleet Maintenance
app.post('/api/fleet-vehicles/:id/maintenance', (req, res) => {
  const permission = req.headers['x-user-permission'];
  if (permission !== 'Admin' && permission !== 'Verwaltung') return res.status(403).json({ error: 'Keine Berechtigung' });
  const { maintenance_date, workshop, km_stand, cost, description, next_maintenance_date, next_maintenance_km } = req.body;
  const result = execute(
    'INSERT INTO fleet_maintenance (fleet_vehicle_id, maintenance_date, workshop, km_stand, cost, description, next_maintenance_date, next_maintenance_km) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [Number(req.params.id), maintenance_date || '', workshop || '', Number(km_stand) || 0, Number(cost) || 0, description || '', next_maintenance_date || '', Number(next_maintenance_km) || 0]
  );
  res.json({ id: result.lastId, message: 'Wartung erstellt' });
});

app.put('/api/fleet-maintenance/:id', (req, res) => {
  const permission = req.headers['x-user-permission'];
  if (permission !== 'Admin' && permission !== 'Verwaltung') return res.status(403).json({ error: 'Keine Berechtigung' });
  const { maintenance_date, workshop, km_stand, cost, description, next_maintenance_date, next_maintenance_km } = req.body;
  execute(
    'UPDATE fleet_maintenance SET maintenance_date=?, workshop=?, km_stand=?, cost=?, description=?, next_maintenance_date=?, next_maintenance_km=? WHERE id=?',
    [maintenance_date || '', workshop || '', Number(km_stand) || 0, Number(cost) || 0, description || '', next_maintenance_date || '', Number(next_maintenance_km) || 0, Number(req.params.id)]
  );
  res.json({ message: 'Wartung aktualisiert' });
});

app.delete('/api/fleet-maintenance/:id', (req, res) => {
  execute('DELETE FROM fleet_maintenance WHERE id = ?', [Number(req.params.id)]);
  res.json({ message: 'Wartung gelöscht' });
});

app.delete('/api/fleet-mileage/:id', (req, res) => {
  execute('DELETE FROM fleet_mileage WHERE id = ?', [Number(req.params.id)]);
  res.json({ message: 'KM-Eintrag gelöscht' });
});

// Fleet damages
app.get('/api/fleet-vehicles/:id/damages', (req, res) => {
  res.json(queryAll('SELECT * FROM fleet_damages WHERE fleet_vehicle_id = ? ORDER BY damage_date DESC, id DESC', [Number(req.params.id)]));
});

app.post('/api/fleet-vehicles/:id/damages', (req, res) => {
  const permission = req.headers['x-user-permission'];
  if (permission !== 'Admin' && permission !== 'Verwaltung') return res.status(403).json({ error: 'Keine Berechtigung' });
  const { damage_date, damage_type, repair_cost, caused_by, status } = req.body;
  if (!damage_date || !damage_type) return res.status(400).json({ error: 'Schadensdatum und Schadensart sind Pflichtfelder' });
  const result = execute(
    'INSERT INTO fleet_damages (fleet_vehicle_id, damage_date, damage_type, repair_cost, caused_by, status) VALUES (?, ?, ?, ?, ?, ?)',
    [Number(req.params.id), damage_date, damage_type, Number(repair_cost) || 0, caused_by || '', status || 'unrepariert']
  );
  res.json({ id: result.lastId, message: 'Schaden erstellt' });
});

app.put('/api/fleet-damages/:id', (req, res) => {
  const permission = req.headers['x-user-permission'];
  if (permission !== 'Admin' && permission !== 'Verwaltung') return res.status(403).json({ error: 'Keine Berechtigung' });
  const { damage_date, damage_type, repair_cost, caused_by, status } = req.body;
  execute(
    'UPDATE fleet_damages SET damage_date=?, damage_type=?, repair_cost=?, caused_by=?, status=? WHERE id=?',
    [damage_date || '', damage_type || '', Number(repair_cost) || 0, caused_by || '', status || 'unrepariert', Number(req.params.id)]
  );
  res.json({ message: 'Schaden aktualisiert' });
});

// Fleet insurance contracts
app.get('/api/fleet-vehicles/:id/insurance', (req, res) => {
  res.json(queryAll('SELECT * FROM fleet_insurance WHERE fleet_vehicle_id = ? ORDER BY contract_date DESC, id DESC', [Number(req.params.id)]));
});

app.post('/api/fleet-vehicles/:id/insurance', (req, res) => {
  const permission = req.headers['x-user-permission'];
  if (permission !== 'Admin' && permission !== 'Verwaltung') return res.status(403).json({ error: 'Keine Berechtigung' });
  const { contract_date, insurance_name, insurance_type, annual_premium, payment_interval, payment_method } = req.body;
  if (!contract_date) return res.status(400).json({ error: 'Datum ist Pflichtfeld' });
  const result = execute(
    'INSERT INTO fleet_insurance (fleet_vehicle_id, contract_date, insurance_name, insurance_type, annual_premium, payment_interval, payment_method) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [Number(req.params.id), contract_date, insurance_name || '', insurance_type || '', Number(annual_premium) || 0, payment_interval || '', payment_method || '']
  );
  res.json({ id: result.lastId });
});

app.put('/api/fleet-insurance/:id', (req, res) => {
  const permission = req.headers['x-user-permission'];
  if (permission !== 'Admin' && permission !== 'Verwaltung') return res.status(403).json({ error: 'Keine Berechtigung' });
  const { contract_date, insurance_name, insurance_type, annual_premium, payment_interval, payment_method } = req.body;
  execute(
    'UPDATE fleet_insurance SET contract_date=?, insurance_name=?, insurance_type=?, annual_premium=?, payment_interval=?, payment_method=? WHERE id=?',
    [contract_date || '', insurance_name || '', insurance_type || '', Number(annual_premium) || 0, payment_interval || '', payment_method || '', Number(req.params.id)]
  );
  res.json({ success: true });
});

app.delete('/api/fleet-insurance/:id', (req, res) => {
  const permission = req.headers['x-user-permission'];
  if (permission !== 'Admin' && permission !== 'Verwaltung') return res.status(403).json({ error: 'Keine Berechtigung' });
  execute('DELETE FROM fleet_insurance WHERE id = ?', [Number(req.params.id)]);
  res.json({ success: true });
});

// Fleet vehicle tax
app.get('/api/fleet-vehicles/:id/tax', (req, res) => {
  res.json(queryAll('SELECT * FROM fleet_tax WHERE fleet_vehicle_id = ? ORDER BY tax_date DESC, id DESC', [Number(req.params.id)]));
});

app.post('/api/fleet-vehicles/:id/tax', (req, res) => {
  const permission = req.headers['x-user-permission'];
  if (permission !== 'Admin' && permission !== 'Verwaltung') return res.status(403).json({ error: 'Keine Berechtigung' });
  const { tax_date, tax_year, tax_amount, payment_method } = req.body;
  if (!tax_date) return res.status(400).json({ error: 'Datum ist Pflichtfeld' });
  const result = execute(
    'INSERT INTO fleet_tax (fleet_vehicle_id, tax_date, tax_year, tax_amount, payment_method) VALUES (?, ?, ?, ?, ?)',
    [Number(req.params.id), tax_date, tax_year || '', Number(tax_amount) || 0, payment_method || '']
  );
  res.json({ id: result.lastId });
});

app.put('/api/fleet-tax/:id', (req, res) => {
  const permission = req.headers['x-user-permission'];
  if (permission !== 'Admin' && permission !== 'Verwaltung') return res.status(403).json({ error: 'Keine Berechtigung' });
  const { tax_date, tax_year, tax_amount, payment_method } = req.body;
  execute(
    'UPDATE fleet_tax SET tax_date=?, tax_year=?, tax_amount=?, payment_method=? WHERE id=?',
    [tax_date || '', tax_year || '', Number(tax_amount) || 0, payment_method || '', Number(req.params.id)]
  );
  res.json({ success: true });
});

app.delete('/api/fleet-tax/:id', (req, res) => {
  const permission = req.headers['x-user-permission'];
  if (permission !== 'Admin' && permission !== 'Verwaltung') return res.status(403).json({ error: 'Keine Berechtigung' });
  execute('DELETE FROM fleet_tax WHERE id = ?', [Number(req.params.id)]);
  res.json({ success: true });
});

// Fleet maintenance documents
app.get('/api/fleet-maintenance/:id/docs', (req, res) => {
  res.json(queryAll('SELECT * FROM fleet_maintenance_docs WHERE maintenance_id = ? ORDER BY created_at DESC', [Number(req.params.id)]));
});
app.post('/api/fleet-maintenance/:id/docs', (req, res) => {
  const permission = req.headers['x-user-permission'];
  if (permission !== 'Admin' && permission !== 'Verwaltung') return res.status(403).json({ error: 'Keine Berechtigung' });
  const { filename, s3_key } = req.body;
  if (!filename || !s3_key) return res.status(400).json({ error: 'Dateiname und S3-Key erforderlich' });
  const result = execute('INSERT INTO fleet_maintenance_docs (maintenance_id, filename, s3_key) VALUES (?, ?, ?)', [Number(req.params.id), filename, s3_key]);
  res.json({ id: result.lastId });
});
app.delete('/api/fleet-maintenance-docs/:id', (req, res) => {
  const permission = req.headers['x-user-permission'];
  if (permission !== 'Admin' && permission !== 'Verwaltung') return res.status(403).json({ error: 'Keine Berechtigung' });
  execute('DELETE FROM fleet_maintenance_docs WHERE id = ?', [Number(req.params.id)]);
  res.json({ success: true });
});

// Fleet insurance documents
app.get('/api/fleet-insurance/:id/docs', (req, res) => {
  res.json(queryAll('SELECT * FROM fleet_insurance_docs WHERE insurance_id = ? ORDER BY created_at DESC', [Number(req.params.id)]));
});
app.post('/api/fleet-insurance/:id/docs', (req, res) => {
  const permission = req.headers['x-user-permission'];
  if (permission !== 'Admin' && permission !== 'Verwaltung') return res.status(403).json({ error: 'Keine Berechtigung' });
  const { filename, s3_key } = req.body;
  if (!filename || !s3_key) return res.status(400).json({ error: 'Dateiname und S3-Key erforderlich' });
  const result = execute('INSERT INTO fleet_insurance_docs (insurance_id, filename, s3_key) VALUES (?, ?, ?)', [Number(req.params.id), filename, s3_key]);
  res.json({ id: result.lastId });
});
app.delete('/api/fleet-insurance-docs/:id', (req, res) => {
  const permission = req.headers['x-user-permission'];
  if (permission !== 'Admin' && permission !== 'Verwaltung') return res.status(403).json({ error: 'Keine Berechtigung' });
  execute('DELETE FROM fleet_insurance_docs WHERE id = ?', [Number(req.params.id)]);
  res.json({ success: true });
});

// Fleet damage documents
app.get('/api/fleet-damages/:id/docs', (req, res) => {
  res.json(queryAll('SELECT * FROM fleet_damage_docs WHERE damage_id = ? ORDER BY created_at DESC', [Number(req.params.id)]));
});

app.post('/api/fleet-damages/:id/docs', (req, res) => {
  const permission = req.headers['x-user-permission'];
  if (permission !== 'Admin' && permission !== 'Verwaltung') return res.status(403).json({ error: 'Keine Berechtigung' });
  const { filename, s3_key } = req.body;
  if (!filename || !s3_key) return res.status(400).json({ error: 'Dateiname und S3-Key erforderlich' });
  const result = execute(
    'INSERT INTO fleet_damage_docs (damage_id, filename, s3_key) VALUES (?, ?, ?)',
    [Number(req.params.id), filename, s3_key]
  );
  res.json({ id: result.lastId });
});

app.delete('/api/fleet-damage-docs/:id', (req, res) => {
  const permission = req.headers['x-user-permission'];
  if (permission !== 'Admin' && permission !== 'Verwaltung') return res.status(403).json({ error: 'Keine Berechtigung' });
  execute('DELETE FROM fleet_damage_docs WHERE id = ?', [Number(req.params.id)]);
  res.json({ success: true });
});

app.delete('/api/fleet-damages/:id', (req, res) => {
  const permission = req.headers['x-user-permission'];
  if (permission !== 'Admin' && permission !== 'Verwaltung') return res.status(403).json({ error: 'Keine Berechtigung' });
  execute('DELETE FROM fleet_damages WHERE id = ?', [Number(req.params.id)]);
  res.json({ message: 'Schaden gel\u00f6scht' });
});

// ===== RENTALS (Vermietung) =====

app.get('/api/rentals', (req, res) => {
  const { year } = req.query;
  let sql = `SELECT r.id, r.vehicle_id, fv.license_plate, fv.manufacturer, fv.model, r.customer_name, r.start_date, r.end_date, r.start_time, r.end_time, r.km_start, r.km_end, r.mietart, r.status, r.notes, r.created_at
    FROM rentals r
    JOIN fleet_vehicles fv ON r.vehicle_id = fv.id
    WHERE 1=1`;
  const params = [];
  if (year) {
    sql += ' AND (substr(r.start_date, 1, 4) = ? OR substr(r.end_date, 1, 4) = ?)';
    params.push(year, year);
  }
  sql += ' ORDER BY r.start_date';
  res.json(queryAll(sql, params));
});

app.get('/api/rentals/:id', async (req, res) => {
  const row = queryOne(
    `SELECT r.*, fv.license_plate, fv.manufacturer, fv.model, s.name AS created_by_name
     FROM rentals r
     JOIN fleet_vehicles fv ON r.vehicle_id = fv.id
     LEFT JOIN staff s ON r.created_by = s.id
     WHERE r.id = ?`, [Number(req.params.id)]
  );
  if (!row) return res.status(404).json({ error: 'Not found' });

  // Load Beteiligte
  const beteiligte = queryAll(
    'SELECT * FROM rental_beteiligte WHERE rental_id = ? ORDER BY sort_order ASC, id ASC',
    [Number(req.params.id)]
  );
  const enriched = await Promise.all(beteiligte.map(async (b) => {
    if (b.type === 'kunde' && b.entity_id) {
      b.entity = queryOne('SELECT * FROM customers WHERE id = ?', [b.entity_id]) || null;
    } else if (b.type === 'vermittler' && b.entity_id) {
      b.entity = await fetchStammdatenById(`/api/vermittler/${b.entity_id}`);
    } else if (b.type === 'werkstatt' && b.entity_id) {
      b.entity = await fetchStammdatenById(`/api/vermittler/${b.entity_id}`);
    } else if (b.type === 'versicherung' && b.entity_id) {
      b.entity = await fetchStammdatenById(`/api/insurances/${b.entity_id}`);
    } else if (b.type === 'anwalt' && b.entity_id) {
      b.entity = await fetchStammdatenById(`/api/lawyers/${b.entity_id}`);
    }
    return b;
  }));
  row.beteiligte = enriched;
  res.json(row);
});

// Rental-Beteiligte CRUD
app.post('/api/rentals/:id/beteiligte', (req, res) => {
  const permission = req.headers['x-user-permission'];
  if (!['Admin', 'Verwaltung', 'Buchhaltung'].includes(permission)) {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }
  const { type, entity_id, name, adresse, telefon, email, art } = req.body;
  if (!type) return res.status(400).json({ error: 'Typ erforderlich' });
  const rentalId = Number(req.params.id);
  if (type === 'kunde') {
    const existing = queryOne('SELECT id FROM rental_beteiligte WHERE rental_id = ? AND type = ?', [rentalId, 'kunde']);
    if (existing) return res.status(400).json({ error: 'Es darf nur ein Kunde pro Mietvorgang hinterlegt sein' });
  }
  const maxOrder = queryOne('SELECT MAX(sort_order) as m FROM rental_beteiligte WHERE rental_id = ?', [rentalId]);
  const nextOrder = (maxOrder && maxOrder.m !== null ? maxOrder.m : -1) + 1;
  execute(
    'INSERT INTO rental_beteiligte (rental_id, type, entity_id, name, adresse, telefon, email, art, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [rentalId, type, entity_id || null, name || '', adresse || '', telefon || '', email || '', art || '', nextOrder]
  );
  res.status(201).json({ success: true });
});

app.delete('/api/rentals/:id/beteiligte/:betId', (req, res) => {
  const permission = req.headers['x-user-permission'];
  if (!['Admin', 'Verwaltung', 'Buchhaltung'].includes(permission)) {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }
  execute(
    'DELETE FROM rental_beteiligte WHERE id = ? AND rental_id = ?',
    [Number(req.params.betId), Number(req.params.id)]
  );
  res.json({ success: true });
});

app.put('/api/rentals/:id/beteiligte/sort', (req, res) => {
  const permission = req.headers['x-user-permission'];
  if (!['Admin', 'Verwaltung', 'Buchhaltung'].includes(permission)) {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }
  const { order } = req.body;
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order array required' });
  const rentalId = Number(req.params.id);
  order.forEach((betId, idx) => {
    execute('UPDATE rental_beteiligte SET sort_order = ? WHERE id = ? AND rental_id = ?', [idx, Number(betId), rentalId]);
  });
  res.json({ success: true });
});

app.post('/api/rentals', (req, res) => {
  const { vehicle_id, customer_name, start_date, end_date, start_time, end_time, mietart, status, notes } = req.body;
  const userId = Number(req.headers['x-user-id']) || null;
  if (!vehicle_id || !start_date || !end_date) return res.status(400).json({ error: 'Fahrzeug, Start- und Enddatum sind Pflichtfelder' });
  const result = execute(
    'INSERT INTO rentals (vehicle_id, customer_name, start_date, end_date, start_time, end_time, mietart, status, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [Number(vehicle_id), customer_name || '', start_date, end_date, start_time || '', end_time || '', mietart || '', status || 'Reservierung', notes || '', userId]
  );
  res.json({ id: result.lastId, message: 'Vermietung erstellt' });
});

app.put('/api/rentals/:id', (req, res) => {
  const existing = queryOne('SELECT * FROM rentals WHERE id = ?', [Number(req.params.id)]);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const b = req.body;
  const merged = {
    vehicle_id: b.vehicle_id !== undefined ? Number(b.vehicle_id) : existing.vehicle_id,
    customer_name: b.customer_name !== undefined ? (b.customer_name || '') : existing.customer_name,
    start_date: b.start_date !== undefined ? b.start_date : existing.start_date,
    end_date: b.end_date !== undefined ? b.end_date : existing.end_date,
    start_time: b.start_time !== undefined ? (b.start_time || '') : existing.start_time,
    end_time: b.end_time !== undefined ? (b.end_time || '') : existing.end_time,
    km_start: b.km_start !== undefined ? (b.km_start || '') : existing.km_start,
    km_end: b.km_end !== undefined ? (b.km_end || '') : existing.km_end,
    mietart: b.mietart !== undefined ? (b.mietart || '') : existing.mietart,
    status: b.status !== undefined ? (b.status || 'Reservierung') : existing.status,
    notes: b.notes !== undefined ? (b.notes || '') : existing.notes,
  };
  execute(
    'UPDATE rentals SET vehicle_id=?, customer_name=?, start_date=?, end_date=?, start_time=?, end_time=?, km_start=?, km_end=?, mietart=?, status=?, notes=? WHERE id=?',
    [merged.vehicle_id, merged.customer_name, merged.start_date, merged.end_date, merged.start_time, merged.end_time, merged.km_start, merged.km_end, merged.mietart, merged.status, merged.notes, Number(req.params.id)]
  );
  res.json({ message: 'Vermietung aktualisiert' });
});

app.delete('/api/rentals/:id', (req, res) => {
  const rentalId = Number(req.params.id);
  // Check if rental is used in any Akte
  const akteRef = queryOne('SELECT id, aktennummer FROM akten WHERE rental_id = ?', [rentalId]);
  if (akteRef) {
    return res.status(400).json({
      error: `Mietvorgang kann nicht gel\u00f6scht werden, da er in Akte ${akteRef.aktennummer || akteRef.id} verwendet wird. Bitte entfernen Sie den Mietvorgang zuerst aus der Akte.`
    });
  }
  execute('DELETE FROM rentals WHERE id = ?', [rentalId]);
  res.json({ message: 'Vermietung gel\u00f6scht' });
});

// ===== TIME TRACKING =====

// POST /api/time/stamp – Ein-/Ausstempeln/Pause
app.post('/api/time/stamp', (req, res) => {
  const staffId = Number(req.headers['x-user-id']);
  if (!staffId) return res.status(400).json({ error: 'Kein Benutzer' });
  const { action } = req.body || {}; // 'pause' or undefined

  const today = berlinToday();
  const currentTime = berlinTime();

  // Check for open entry (no end_time)
  const openEntry = queryOne('SELECT * FROM time_entries WHERE staff_id = ? AND end_time = ?', [staffId, '']);

  if (openEntry) {
    // Stamp out (pause or final)
    const isPause = action === 'pause' ? 1 : 0;
    execute('UPDATE time_entries SET end_time = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [currentTime, isPause ? '__pause__' : (openEntry.notes || ''), openEntry.id]);
    const updated = queryOne('SELECT * FROM time_entries WHERE id = ?', [openEntry.id]);
    res.json({ status: isPause ? 'paused' : 'stamped_out', entry: updated });
  } else {
    // Stamp in
    const result = execute('INSERT INTO time_entries (staff_id, entry_date, start_time, end_time) VALUES (?, ?, ?, ?)',
      [staffId, today, currentTime, '']);
    const entry = queryOne('SELECT * FROM time_entries WHERE id = ?', [result.lastId]);
    res.json({ status: 'stamped_in', entry });
  }
});

// GET /api/time/status – Aktueller Stempel-Status
app.get('/api/time/status', (req, res) => {
  const staffId = Number(req.headers['x-user-id']);
  if (!staffId) return res.status(400).json({ error: 'Kein Benutzer' });

  const today = berlinToday();
  const openEntry = queryOne('SELECT * FROM time_entries WHERE staff_id = ? AND end_time = ?', [staffId, '']);
  const todayEntries = queryAll('SELECT * FROM time_entries WHERE staff_id = ? AND entry_date = ? ORDER BY start_time', [staffId, today]);
  const lastEntry = todayEntries.length > 0 ? todayEntries[todayEntries.length - 1] : null;
  const onPause = !openEntry && lastEntry && lastEntry.notes === '__pause__';
  res.json({ stamped_in: !!openEntry, current_entry: openEntry || null, on_pause: !!onPause, last_entry: onPause ? lastEntry : null });
});

// GET /api/time/entries – Eintraege abrufen
app.get('/api/time/entries', (req, res) => {
  const userId = Number(req.headers['x-user-id']);
  const permission = req.headers['x-user-permission'];
  let staffId = Number(req.query.staff_id) || userId;

  // Only Benutzer restricted to own entries
  if (!['Admin', 'Verwaltung', 'Buchhaltung'].includes(permission)) staffId = userId;

  const { from, to } = req.query;
  let dateFrom = from;
  let dateTo = to;

  // Default to current week (Mon-Sun)
  if (!dateFrom || !dateTo) {
    const now = berlinNow();
    const day = now.getDay();
    const diff = day === 0 ? 6 : day - 1; // Monday=0
    const monday = new Date(now);
    monday.setDate(now.getDate() - diff);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    dateFrom = fmt(monday);
    dateTo = fmt(sunday);
  }

  const entries = queryAll(
    'SELECT * FROM time_entries WHERE staff_id = ? AND entry_date >= ? AND entry_date <= ? ORDER BY entry_date, start_time',
    [staffId, dateFrom, dateTo]
  );
  res.json(entries);
});

// POST /api/time/entries – Manueller Eintrag
app.post('/api/time/entries', (req, res) => {
  const userId = Number(req.headers['x-user-id']);
  const permission = req.headers['x-user-permission'];
  const { staff_id, entry_date, start_time, end_time, break_minutes, notes } = req.body;

  // Benutzer dürfen keine manuellen Einträge erstellen
  if (!['Admin', 'Verwaltung', 'Buchhaltung'].includes(permission)) {
    return res.status(403).json({ error: 'Keine Berechtigung, Einträge manuell zu erstellen' });
  }
  const targetStaffId = Number(staff_id) || userId;
  if (!entry_date || !start_time) return res.status(400).json({ error: 'Datum und Startzeit sind Pflichtfelder' });

  const result = execute(
    'INSERT INTO time_entries (staff_id, entry_date, start_time, end_time, break_minutes, notes) VALUES (?, ?, ?, ?, ?, ?)',
    [targetStaffId, entry_date, start_time, end_time || '', break_minutes || 0, notes || '']
  );
  const entry = queryOne('SELECT * FROM time_entries WHERE id = ?', [result.lastId]);
  res.json(entry);
});

// PUT /api/time/entries/:id – Eintrag bearbeiten
app.put('/api/time/entries/:id', (req, res) => {
  const userId = Number(req.headers['x-user-id']);
  const permission = req.headers['x-user-permission'];
  const entryId = Number(req.params.id);

  const entry = queryOne('SELECT * FROM time_entries WHERE id = ?', [entryId]);
  if (!entry) return res.status(404).json({ error: 'Eintrag nicht gefunden' });

  // Benutzer dürfen keine Einträge bearbeiten
  if (!['Admin', 'Verwaltung', 'Buchhaltung'].includes(permission)) {
    return res.status(403).json({ error: 'Keine Berechtigung, Einträge zu bearbeiten' });
  }

  const { start_time, end_time, break_minutes, notes, entry_date } = req.body;
  execute(
    'UPDATE time_entries SET start_time=?, end_time=?, break_minutes=?, notes=?, entry_date=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
    [start_time || entry.start_time, end_time !== undefined ? end_time : entry.end_time, break_minutes !== undefined ? break_minutes : entry.break_minutes, notes !== undefined ? notes : entry.notes, entry_date || entry.entry_date, entryId]
  );
  const updated = queryOne('SELECT * FROM time_entries WHERE id = ?', [entryId]);
  res.json(updated);
});

// DELETE /api/time/entries/:id – Eintrag loeschen
app.delete('/api/time/entries/:id', (req, res) => {
  const userId = Number(req.headers['x-user-id']);
  const permission = req.headers['x-user-permission'];
  const entryId = Number(req.params.id);

  const entry = queryOne('SELECT * FROM time_entries WHERE id = ?', [entryId]);
  if (!entry) return res.status(404).json({ error: 'Eintrag nicht gefunden' });

  // Admin, Verwaltung, Buchhaltung can delete time entries
  if (!['Admin', 'Verwaltung', 'Buchhaltung'].includes(permission)) {
    return res.status(403).json({ error: 'Keine Berechtigung, Zeiteinträge zu löschen' });
  }

  execute('DELETE FROM time_entries WHERE id = ?', [entryId]);
  res.json({ message: 'Eintrag gelöscht' });
});

// GET /api/time/overtime – Ueberstundenkonto (tagesaktuell)
app.get('/api/time/overtime', (req, res) => {
  const userId = Number(req.headers['x-user-id']);
  const permission = req.headers['x-user-permission'];
  let staffId = Number(req.query.staff_id) || userId;

  if (!['Admin', 'Verwaltung', 'Buchhaltung'].includes(permission)) staffId = userId;

  const staff = queryOne('SELECT weekly_hours, work_days, entry_date FROM staff WHERE id = ?', [staffId]);
  const weeklyHours = staff ? (staff.weekly_hours || 40) : 40;
  const workDaysStr = staff ? (staff.work_days || '1,2,3,4,5') : '1,2,3,4,5';
  const entryDate = staff ? (staff.entry_date || '') : '';

  // No entry_date → no time tracking possible
  if (!entryDate) {
    return res.json({ weekly_hours: weeklyHours, work_days: workDaysStr, no_entry_date: true, total_overtime_minutes: 0, weeks: [] });
  }

  const workDaysArr = workDaysStr.split(',').map(Number); // 1=Mo,...,7=So
  const workDayCount = workDaysArr.length || 5;
  const dailyTargetMinutes = (weeklyHours / workDayCount) * 60;

  // Map JS getDay() (0=So,1=Mo,...,6=Sa) to our format (1=Mo,...,7=So)
  function jsDayToWorkDay(jsDay) { return jsDay === 0 ? 7 : jsDay; }

  // Local date formatter (avoids UTC shift from toISOString)
  function fmtDate(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // NRW holidays (same algorithm as frontend)
  function getNRWHolidays(year) {
    const a = year % 19, b = Math.floor(year / 100), c = year % 100;
    const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    const easter = new Date(year, month - 1, day);
    function addD(dt, n) { const r = new Date(dt); r.setDate(r.getDate() + n); return r; }
    const holidays = {};
    [[`${year}-01-01`,'Neujahr'],[fmtDate(addD(easter,-2)),'Karfreitag'],[fmtDate(addD(easter,1)),'Ostermontag'],
     [`${year}-05-01`,'Tag der Arbeit'],[fmtDate(addD(easter,39)),'Christi Himmelfahrt'],
     [fmtDate(addD(easter,50)),'Pfingstmontag'],[fmtDate(addD(easter,60)),'Fronleichnam'],
     [`${year}-10-03`,'Tag der Deutschen Einheit'],[`${year}-11-01`,'Allerheiligen'],
     [`${year}-12-25`,'1. Weihnachtstag'],[`${year}-12-26`,'2. Weihnachtstag']
    ].forEach(([d,n]) => { holidays[d] = n; });
    return holidays;
  }

  // Get all completed time entries
  const entries = queryAll(
    'SELECT * FROM time_entries WHERE staff_id = ? AND end_time != ? ORDER BY entry_date, start_time',
    [staffId, '']
  );

  // Get approved vacation/sick entries for this staff
  const vacEntries = queryAll(
    "SELECT * FROM vacation_entries WHERE staff_id = ? AND status = 'Genehmigt' ORDER BY start_date",
    [staffId]
  );

  // Build a day-map of absence info: dateStr -> { type, half_day }
  const absenceMap = {};
  vacEntries.forEach(v => {
    const s = new Date(v.start_date + 'T12:00:00');
    const e = new Date(v.end_date + 'T12:00:00');
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
      const ds = fmtDate(d);
      absenceMap[ds] = { type: v.entry_type, half_day: v.half_day || 0 };
    }
  });

  // Start from entry_date, aligned to Monday of that week
  const today = fmtDate(new Date());
  const startD = new Date(entryDate + 'T12:00:00');
  const startDow = startD.getDay();
  const startDiff = startDow === 0 ? 6 : startDow - 1;
  startD.setDate(startD.getDate() - startDiff);
  const startDate = fmtDate(startD);

  // Group time entries by date
  const entryByDate = {};
  entries.forEach(e => {
    if (!entryByDate[e.entry_date]) entryByDate[e.entry_date] = [];
    entryByDate[e.entry_date].push(e);
  });

  // Cache holidays per year
  const holidayCache = {};
  function isHoliday(dateStr) {
    const year = parseInt(dateStr.slice(0, 4));
    if (!holidayCache[year]) holidayCache[year] = getNRWHolidays(year);
    return holidayCache[year][dateStr] || null;
  }

  // Iterate day by day from startDate to today
  let totalOvertimeMinutes = 0;
  const weekMap = {}; // weekKey -> { target, actual, days: { dateStr -> {target, actual, absence} } }

  const cur = new Date(startDate + 'T12:00:00');
  const end = new Date(today + 'T12:00:00');

  while (cur <= end) {
    const dateStr = fmtDate(cur);
    const jsDay = cur.getDay();
    const workDay = jsDayToWorkDay(jsDay);
    const isWorkDay = workDaysArr.includes(workDay);

    // Compute ISO week key (Monday)
    const diff = jsDay === 0 ? 6 : jsDay - 1;
    const monday = new Date(cur);
    monday.setDate(cur.getDate() - diff);
    const weekKey = fmtDate(monday);
    if (!weekMap[weekKey]) weekMap[weekKey] = { target_minutes: 0, actual_minutes: 0, days: {} };

    // Determine daily target (no target before entry_date)
    let dayTargetMinutes = 0;
    let absenceType = null;
    const beforeEntry = dateStr < entryDate;
    const holidayName = isHoliday(dateStr);
    const absence = absenceMap[dateStr];

    if (beforeEntry) {
      // Before employment start → no target
      dayTargetMinutes = 0;
    } else if (holidayName && isWorkDay) {
      // Holiday on a work day -> no target
      absenceType = 'Feiertag';
      dayTargetMinutes = 0;
    } else if (absence) {
      absenceType = absence.type;
      if (absence.type === 'Krankheit') {
        dayTargetMinutes = 0;
      } else if (absence.type === 'Urlaub') {
        if (absence.half_day) {
          dayTargetMinutes = isWorkDay ? dailyTargetMinutes / 2 : 0;
          absenceType = 'Halber Urlaubstag';
        } else {
          dayTargetMinutes = 0;
        }
      } else if (absence.type === 'Halber Urlaubstag') {
        dayTargetMinutes = isWorkDay ? dailyTargetMinutes / 2 : 0;
        absenceType = 'Halber Urlaubstag';
      } else {
        // Weiterbildung etc. -> no target
        dayTargetMinutes = 0;
      }
    } else if (isWorkDay) {
      dayTargetMinutes = dailyTargetMinutes;
    }

    // Calculate actual worked minutes for this day
    let dayActualMinutes = 0;
    const dayEntries = entryByDate[dateStr] || [];
    dayEntries.forEach(e => {
      const [sh, sm] = e.start_time.split(':').map(Number);
      const [eh, em] = e.end_time.split(':').map(Number);
      const worked = (eh * 60 + em) - (sh * 60 + sm) - (e.break_minutes || 0);
      if (worked > 0) dayActualMinutes += worked;
    });

    weekMap[weekKey].target_minutes += dayTargetMinutes;
    weekMap[weekKey].actual_minutes += dayActualMinutes;
    weekMap[weekKey].days[dateStr] = {
      target_minutes: dayTargetMinutes,
      actual_minutes: dayActualMinutes,
      absence_type: absenceType,
      holiday_name: holidayName || null
    };

    totalOvertimeMinutes += (dayActualMinutes - dayTargetMinutes);

    cur.setDate(cur.getDate() + 1);
  }

  // Build weeks array sorted by week start
  let runningTotal = 0;
  const weeks = Object.keys(weekMap).sort().map(weekStart => {
    const w = weekMap[weekStart];
    const diffMinutes = w.actual_minutes - w.target_minutes;
    runningTotal += diffMinutes;
    return {
      week_start: weekStart,
      target_minutes: w.target_minutes,
      actual_minutes: w.actual_minutes,
      diff_minutes: diffMinutes,
      running_total: runningTotal,
      days: w.days
    };
  });

  // Subtract overtime deductions
  const deductionRows = queryAll('SELECT minutes FROM overtime_deductions WHERE staff_id = ?', [staffId]);
  const deductedMinutes = deductionRows.reduce((sum, r) => sum + (Number(r.minutes) || 0), 0);
  const adjustedOvertime = totalOvertimeMinutes - deductedMinutes;

  res.json({ weekly_hours: weeklyHours, work_days: workDaysStr, total_overtime_minutes: adjustedOvertime, deducted_minutes: deductedMinutes, weeks });
});

// ===== OVERTIME DEDUCTIONS =====

app.get('/api/overtime-deductions', (req, res) => {
  const permission = req.headers['x-user-permission'];
  if (!['Verwaltung', 'Buchhaltung', 'Admin'].includes(permission)) return res.status(403).json({ error: 'Keine Berechtigung' });
  const staffId = Number(req.query.staff_id);
  if (!staffId) return res.status(400).json({ error: 'staff_id erforderlich' });
  res.json(queryAll(
    `SELECT od.*, s.name as created_by_name FROM overtime_deductions od LEFT JOIN staff s ON od.created_by = s.id WHERE od.staff_id = ? ORDER BY od.deduction_date DESC`,
    [staffId]
  ));
});

app.post('/api/overtime-deductions', (req, res) => {
  const permission = req.headers['x-user-permission'];
  if (!['Verwaltung', 'Buchhaltung', 'Admin'].includes(permission)) return res.status(403).json({ error: 'Keine Berechtigung' });
  const userId = Number(req.headers['x-user-id']);
  const { staff_id, deduction_date, minutes, reason } = req.body;
  if (!staff_id || !deduction_date || !minutes) return res.status(400).json({ error: 'staff_id, deduction_date und minutes erforderlich' });
  const result = execute(
    'INSERT INTO overtime_deductions (staff_id, deduction_date, minutes, reason, created_by) VALUES (?, ?, ?, ?, ?)',
    [staff_id, deduction_date, Number(minutes), reason || '', userId]
  );
  res.json({ id: result.lastId, message: 'Eintrag erstellt' });
});

app.delete('/api/overtime-deductions/:id', (req, res) => {
  const permission = req.headers['x-user-permission'];
  if (!['Admin', 'Verwaltung', 'Buchhaltung'].includes(permission)) return res.status(403).json({ error: 'Keine Berechtigung' });
  execute('DELETE FROM overtime_deductions WHERE id = ?', [Number(req.params.id)]);
  res.json({ message: 'Eintrag gelöscht' });
});

app.put('/api/overtime-deductions/:id', (req, res) => {
  const permission = req.headers['x-user-permission'];
  if (!['Admin', 'Verwaltung', 'Buchhaltung'].includes(permission)) return res.status(403).json({ error: 'Keine Berechtigung' });
  const { deduction_date, minutes, reason } = req.body;
  execute(
    'UPDATE overtime_deductions SET deduction_date=?, minutes=?, reason=? WHERE id=?',
    [deduction_date, Number(minutes), reason || '', Number(req.params.id)]
  );
  res.json({ message: 'Eintrag aktualisiert' });
});

// ===== S3 FILE STORAGE =====

function getS3Config() {
  let endpoint = (queryOne("SELECT value FROM settings WHERE key = 's3_endpoint'")?.value) || process.env.S3_ENDPOINT || '';
  // Ensure https:// prefix
  if (endpoint && !endpoint.startsWith('http')) endpoint = 'https://' + endpoint;
  const region = (queryOne("SELECT value FROM settings WHERE key = 's3_region'")?.value) || process.env.S3_REGION || 'nbg1';
  const bucket = (queryOne("SELECT value FROM settings WHERE key = 's3_bucket'")?.value) || process.env.S3_BUCKET || '';
  const accessKey = (queryOne("SELECT value FROM settings WHERE key = 's3_access_key'")?.value) || process.env.S3_ACCESS_KEY || '';
  const secretKey = getSettingDecrypted('s3_secret_key') || process.env.S3_SECRET_KEY || '';
  // Derive region from endpoint if not set (e.g. nbg1 from nbg1.your-objectstorage.com)
  const effectiveRegion = region || (endpoint.match(/\/\/([\w]+)\./)?.[1]) || 'nbg1';
  return { endpoint, region: effectiveRegion, bucket, accessKey, secretKey };
}

function getS3Client() {
  const cfg = getS3Config();
  return new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
    forcePathStyle: true
  });
}

function getS3Bucket() {
  return getS3Config().bucket;
}

// File log helper
function logFileAction(action, fileKey, filename, folder, req, size, details) {
  const userId = Number(req.headers['x-user-id']) || 0;
  const username = req.headers['x-user-name'] || '';
  const now = berlinToday() + ' ' + berlinTime();
  execute(
    `INSERT INTO file_log (action, file_key, filename, folder, user_id, username, file_size, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [action, fileKey, filename, folder, userId, username, size || 0, details || '', now]
  );
}

// Upload file (base64 body)
app.post('/api/files/upload', async (req, res) => {
  try {
    const { folder, filename, data, content_type } = req.body;
    if (!filename || !data) return res.status(400).json({ error: 'filename und data sind Pflichtfelder' });
    const key = folder ? `${folder}/${filename}` : filename;
    const buffer = Buffer.from(data, 'base64');

    // Check if file already exists (for log: upload vs overwrite)
    let isOverwrite = false;
    try {
      const existing = await getS3Client().send(new GetObjectCommand({ Bucket: getS3Bucket(), Key: key }));
      if (existing) isOverwrite = true;
    } catch (e) { /* file doesn't exist, normal upload */ }

    await getS3Client().send(new PutObjectCommand({
      Bucket: getS3Bucket(),
      Key: key,
      Body: buffer,
      ContentType: content_type || 'application/octet-stream'
    }));
    logFileAction(isOverwrite ? 'überschrieben' : 'hochgeladen', key, filename, folder || '', req, buffer.length, content_type || '');
    res.json({ key, message: 'Datei hochgeladen', size: buffer.length });
  } catch (err) {
    console.error('S3 Upload Error:', err.message);
    res.status(500).json({ error: 'Upload fehlgeschlagen: ' + err.message });
  }
});

// List files in folder
app.get('/api/files/list', async (req, res) => {
  try {
    const prefix = req.query.folder ? `${req.query.folder}/` : '';
    const result = await getS3Client().send(new ListObjectsV2Command({
      Bucket: getS3Bucket(),
      Prefix: prefix,
      Delimiter: '/'
    }));
    const files = (result.Contents || []).map(f => ({
      key: f.Key,
      name: f.Key.split('/').pop(),
      size: f.Size,
      modified: f.LastModified
    }));
    const folders = (result.CommonPrefixes || []).map(p => p.Prefix.replace(/\/$/, '').split('/').pop());
    res.json({ files, folders });
  } catch (err) {
    console.error('S3 List Error:', err.message);
    res.status(500).json({ error: 'Auflisten fehlgeschlagen: ' + err.message });
  }
});

// Get download URL (pre-signed, 1h valid)
app.get('/api/files/download', async (req, res) => {
  try {
    const { key } = req.query;
    if (!key) return res.status(400).json({ error: 'key ist Pflichtfeld' });
    const url = await getSignedUrl(getS3Client(), new GetObjectCommand({ Bucket: getS3Bucket(), Key: key }), { expiresIn: 3600 });
    res.json({ url });
  } catch (err) {
    console.error('S3 Download Error:', err.message);
    res.status(500).json({ error: 'Download-URL fehlgeschlagen: ' + err.message });
  }
});

// Proxy file download (avoids CORS and Office Online redirect)
app.get('/api/files/proxy-download', async (req, res) => {
  try {
    const { key } = req.query;
    if (!key) return res.status(400).json({ error: 'key ist Pflichtfeld' });
    const filename = key.split('/').pop();
    const command = new GetObjectCommand({ Bucket: getS3Bucket(), Key: key });
    const response = await getS3Client().send(command);
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename.replace(/"/g, '') + '"');
    res.setHeader('Content-Type', response.ContentType || 'application/octet-stream');
    response.Body.pipe(res);
  } catch (err) {
    console.error('S3 Proxy Download Error:', err.message);
    res.status(500).json({ error: 'Download fehlgeschlagen: ' + err.message });
  }
});

// Office → PDF conversion for preview (LibreOffice headless)
const _pdfCache = new Map();
const _pdfCacheMax = 100;
const _pdfConverting = new Set(); // keys currently being converted
let _pdfConvertQueue = [];
const _pdfMaxConcurrent = 2;
let _pdfActiveCount = 0;
const SOFFICE = process.platform === 'win32'
  ? 'C:\\Program Files\\LibreOffice\\program\\soffice.exe'
  : '/usr/bin/libreoffice';
const OFFICE_EXT = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'];

async function convertOfficeToPdf(s3Key) {
  if (_pdfCache.has(s3Key)) return _pdfCache.get(s3Key);
  if (_pdfConverting.has(s3Key)) return null; // already in progress

  _pdfConverting.add(s3Key);
  try {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bemo-office-'));
    const ext = (s3Key.split('.').pop() || '').toLowerCase();
    const inputFile = path.join(tmpDir, 'input.' + ext);
    const command = new GetObjectCommand({ Bucket: getS3Bucket(), Key: s3Key });
    const response = await getS3Client().send(command);
    const chunks = [];
    for await (const chunk of response.Body) chunks.push(chunk);
    fs.writeFileSync(inputFile, Buffer.concat(chunks));

    await new Promise((resolve, reject) => {
      execFile(SOFFICE, [
        '--headless', '--invisible', '--nocrashreport', '--nodefault', '--nologo', '--nofirststartwizard', '--norestore',
        '--convert-to', 'pdf', '--outdir', tmpDir, inputFile
      ], { timeout: 30000 }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve();
      });
    });

    const pdfFile = path.join(tmpDir, 'input.pdf');
    if (!fs.existsSync(pdfFile)) throw new Error('PDF wurde nicht erzeugt');
    const pdfData = fs.readFileSync(pdfFile);
    fs.rmSync(tmpDir, { recursive: true, force: true });

    // LRU cache: remove oldest if full
    if (_pdfCache.size >= _pdfCacheMax) {
      const firstKey = _pdfCache.keys().next().value;
      _pdfCache.delete(firstKey);
    }
    _pdfCache.set(s3Key, pdfData);
    return pdfData;
  } catch (err) {
    console.error('Office-to-PDF convert error (' + s3Key + '):', err.message);
    return null;
  } finally {
    _pdfConverting.delete(s3Key);
  }
}

// Process preload queue (max 2 concurrent)
function processPreloadQueue() {
  while (_pdfActiveCount < _pdfMaxConcurrent && _pdfConvertQueue.length > 0) {
    const key = _pdfConvertQueue.shift();
    if (_pdfCache.has(key) || _pdfConverting.has(key)) { processPreloadQueue(); return; }
    _pdfActiveCount++;
    convertOfficeToPdf(key).finally(() => { _pdfActiveCount--; processPreloadQueue(); });
  }
}

// Serve PDF preview
app.get('/api/files/office-to-pdf', async (req, res) => {
  try {
    const { key } = req.query;
    if (!key) return res.status(400).json({ error: 'key ist Pflichtfeld' });

    if (_pdfCache.has(key)) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline');
      return res.send(_pdfCache.get(key));
    }

    const pdfData = await convertOfficeToPdf(key);
    if (!pdfData) return res.status(500).json({ error: 'Konvertierung fehlgeschlagen' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline');
    res.send(pdfData);
  } catch (err) {
    console.error('Office-to-PDF Error:', err.message);
    res.status(500).json({ error: 'PDF-Konvertierung fehlgeschlagen: ' + err.message });
  }
});

// Preload: convert all Office files in a folder in background
app.post('/api/files/preload-office', async (req, res) => {
  const { keys } = req.body;
  if (!keys || !Array.isArray(keys)) return res.json({ queued: 0 });
  const toConvert = keys.filter(k => {
    const ext = (k.split('.').pop() || '').toLowerCase();
    return OFFICE_EXT.includes(ext) && !_pdfCache.has(k) && !_pdfConverting.has(k);
  });
  _pdfConvertQueue.push(...toConvert);
  processPreloadQueue();
  res.json({ queued: toConvert.length, cached: keys.length - toConvert.length });
});

// File log
app.get('/api/files/log', (req, res) => {
  const limit = Number(req.query.limit) || 100;
  res.json(queryAll('SELECT * FROM file_log ORDER BY id DESC LIMIT ?', [limit]));
});

// Delete file
app.delete('/api/files/:key(*)', async (req, res) => {
  try {
    const key = req.params.key;
    const filename = key.split('/').pop();
    const folder = key.split('/').slice(0, -1).join('/');
    await getS3Client().send(new DeleteObjectCommand({ Bucket: getS3Bucket(), Key: key }));
    logFileAction('gelöscht', key, filename, folder, req, 0, '');
    res.json({ message: 'Datei gelöscht' });
  } catch (err) {
    console.error('S3 Delete Error:', err.message);
    res.status(500).json({ error: 'Löschen fehlgeschlagen: ' + err.message });
  }
});

// Test S3 connection
app.get('/api/files/test', async (req, res) => {
  try {
    const bucket = getS3Bucket();
    const result = await getS3Client().send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }));
    res.json({ status: 'ok', bucket, message: 'S3-Verbindung erfolgreich' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Parse .msg files for preview
app.get('/api/files/docx-preview', async (req, res) => {
  try {
    const { key } = req.query;
    if (!key) return res.status(400).json({ error: 'key ist Pflichtfeld' });
    const mammoth = require('mammoth');
    const response = await getS3Client().send(new GetObjectCommand({ Bucket: getS3Bucket(), Key: key }));
    const chunks = [];
    for await (const chunk of response.Body) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);
    const result = await mammoth.convertToHtml({ buffer });
    res.json({ html: result.value });
  } catch (err) {
    res.status(500).json({ error: 'Vorschau fehlgeschlagen: ' + err.message });
  }
});

app.get('/api/files/msg-preview', async (req, res) => {
  try {
    const { key } = req.query;
    if (!key) return res.status(400).json({ error: 'key ist Pflichtfeld' });
    const MsgReader = require('@kenjiuno/msgreader').default || require('@kenjiuno/msgreader');
    const response = await getS3Client().send(new GetObjectCommand({ Bucket: getS3Bucket(), Key: key }));
    const chunks = [];
    for await (const chunk of response.Body) { chunks.push(chunk); }
    const buffer = Buffer.concat(chunks);
    const reader = new MsgReader(buffer);
    const msg = reader.getFileData();
    res.json({
      subject: msg.subject || '',
      from: msg.senderName || msg.senderEmail || '',
      senderEmail: msg.senderEmail || '',
      to: msg.recipients ? msg.recipients.map(r => r.name + (r.email ? ' <' + r.email + '>' : '')).join(', ') : '',
      date: msg.messageDeliveryTime || msg.clientSubmitTime || '',
      body: msg.body || '',
      attachments: msg.attachments ? msg.attachments.map(a => ({ name: a.fileName || a.name || 'Anhang', size: a.contentLength || 0 })) : []
    });
  } catch (err) {
    console.error('MSG Parse Error:', err.message);
    res.status(500).json({ error: 'MSG-Vorschau fehlgeschlagen: ' + err.message });
  }
});

// ===== Akten (Case Files) =====
app.get('/api/akten', (req, res) => {
  const { search } = req.query;
  const base = `
    SELECT a.*,
      CASE WHEN c.customer_type IN ('Firmenkunde','Werkstatt') THEN c.company_name
           ELSE c.last_name || ', ' || c.first_name END as customer_name,
      (SELECT name FROM akten_beteiligte WHERE akte_id = a.id AND type = 'kunde' ORDER BY sort_order ASC LIMIT 1) as bet_kunde,
      (SELECT name FROM akten_beteiligte WHERE akte_id = a.id AND type = 'anwalt' ORDER BY sort_order ASC LIMIT 1) as bet_anwalt,
      (SELECT name FROM akten_beteiligte WHERE akte_id = a.id AND type = 'versicherung' ORDER BY sort_order ASC LIMIT 1) as bet_versicherung,
      (SELECT name FROM akten_beteiligte WHERE akte_id = a.id AND type IN ('vermittler','werkstatt') ORDER BY sort_order ASC LIMIT 1) as bet_vermittler
    FROM akten a
    LEFT JOIN customers c ON a.customer_id = c.id
  `;
  if (search) {
    const term = `%${search}%`;
    res.json(queryAll(
      base + ` WHERE a.aktennummer LIKE ? OR a.kunde LIKE ? OR a.anwalt LIKE ? OR a.vermittler LIKE ? OR a.status LIKE ?
        OR a.id IN (SELECT akte_id FROM akten_beteiligte WHERE name LIKE ?)
        ORDER BY a.id DESC`,
      [term, term, term, term, term, term]
    ));
  } else {
    res.json(queryAll(base + ' ORDER BY a.id DESC'));
  }
});

app.get('/api/akten/:id', async (req, res) => {
  const row = queryOne(
    `SELECT a.*, s.name AS created_by_name FROM akten a LEFT JOIN staff s ON a.created_by = s.id WHERE a.id = ?`,
    [Number(req.params.id)]
  );
  if (!row) return res.status(404).json({ error: 'Not found' });

  // Local FK joins (synchronous, in-memory SQLite)
  if (row.customer_id) {
    row.customer = queryOne(
      'SELECT id, first_name, last_name, phone, email, company_name, customer_type FROM customers WHERE id = ?',
      [row.customer_id]
    ) || null;
  }
  if (row.rental_id) {
    row.rental = queryOne(
      `SELECT r.id, r.start_date, r.end_date, r.mietart, fv.license_plate, fv.manufacturer, fv.model
       FROM rentals r
       JOIN fleet_vehicles fv ON r.vehicle_id = fv.id
       WHERE r.id = ?`,
      [row.rental_id]
    ) || null;
  }

  // External Stammdaten (parallel, non-blocking) — legacy FK fields
  const [vermittlerData, versicherungData] = await Promise.all([
    row.vermittler_id ? fetchStammdatenById(`/api/vermittler/${row.vermittler_id}`) : Promise.resolve(null),
    row.versicherung_id ? fetchStammdatenById(`/api/insurances/${row.versicherung_id}`) : Promise.resolve(null)
  ]);
  row.vermittler_obj = vermittlerData;
  row.versicherung_obj = versicherungData;

  // Load Beteiligte (new many-to-many table)
  const beteiligte = queryAll(
    'SELECT * FROM akten_beteiligte WHERE akte_id = ? ORDER BY sort_order ASC, id ASC',
    [Number(req.params.id)]
  );
  // Enrich each Beteiligter with entity data
  const enriched = await Promise.all(beteiligte.map(async (b) => {
    if (b.type === 'kunde' && b.entity_id) {
      b.entity = queryOne('SELECT * FROM customers WHERE id = ?', [b.entity_id]) || null;
    } else if (b.type === 'vermittler' && b.entity_id) {
      b.entity = await fetchStammdatenById(`/api/vermittler/${b.entity_id}`);
    } else if (b.type === 'werkstatt' && b.entity_id) {
      b.entity = await fetchStammdatenById(`/api/vermittler/${b.entity_id}`);
    } else if (b.type === 'versicherung' && b.entity_id) {
      b.entity = await fetchStammdatenById(`/api/insurances/${b.entity_id}`);
    } else if (b.type === 'anwalt' && b.entity_id) {
      b.entity = await fetchStammdatenById(`/api/lawyers/${b.entity_id}`);
    }
    return b;
  }));
  row.beteiligte = enriched;

  res.json(row);
});

app.post('/api/akten', (req, res) => {
  // SEC-01: Permission guard
  const permission = req.headers['x-user-permission'];
  if (!['Admin', 'Verwaltung', 'Buchhaltung'].includes(permission)) {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }
  const { datum, kunde, anwalt, zahlungsstatus, vermittler, status,
          customer_id, vermittler_id, versicherung_id, rental_id,
          unfalldatum, unfallort, polizei_vor_ort, mietart, wiedervorlage_datum } = req.body;
  const userId = Number(req.headers['x-user-id']) || null;

  // Auto-generate Aktennummer: next number starting from 1000
  const row = queryOne('SELECT MAX(CAST(aktennummer AS INTEGER)) as max_nr FROM akten');
  const nextNr = Math.max((row && row.max_nr) || 0, 999) + 1;
  const aktennummer = String(nextNr);

  const result = execute(
    `INSERT INTO akten (aktennummer, datum, kunde, anwalt, zahlungsstatus, vermittler, status,
       customer_id, vermittler_id, versicherung_id, rental_id,
       unfalldatum, unfallort, polizei_vor_ort, mietart, wiedervorlage_datum, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [aktennummer, datum || '', kunde || '', anwalt || '',
     zahlungsstatus || 'offen', vermittler || '', status || 'Neu Angelegt',
     customer_id || null, vermittler_id || null, versicherung_id || null, rental_id || null,
     unfalldatum || '', unfallort || '', polizei_vor_ort ? 1 : 0,
     mietart || '', wiedervorlage_datum || '', userId]
  );
  res.status(201).json(queryOne('SELECT * FROM akten WHERE id = ?', [result.lastId]));
});

app.put('/api/akten/:id', (req, res) => {
  // SEC-01: Permission guard
  const permission = req.headers['x-user-permission'];
  if (!['Admin', 'Verwaltung', 'Buchhaltung'].includes(permission)) {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }
  const userId = Number(req.headers['x-user-id']);
  const existing = queryOne('SELECT * FROM akten WHERE id = ?', [Number(req.params.id)]);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  // DB-05: Audit trail — diff before update
  const TRACKED_FIELDS = [
    'datum', 'kunde', 'anwalt', 'vermittler',
    'customer_id', 'vermittler_id', 'versicherung_id', 'rental_id',
    'unfalldatum', 'unfallort', 'polizei_vor_ort',
    'mietart', 'wiedervorlage_datum',
    'zahlungsstatus', 'status'
  ];

  const FK_FIELDS = ['customer_id', 'vermittler_id', 'versicherung_id', 'rental_id'];
  function norm(field, val) {
    if (FK_FIELDS.includes(field)) {
      return (val === null || val === undefined || val === '' || val === 0) ? null : val;
    }
    return (val === null || val === undefined) ? '' : String(val);
  }

  const now = `${berlinToday()} ${berlinTime()}`;

  for (const field of TRACKED_FIELDS) {
    if (req.body[field] === undefined) continue;
    const oldVal = norm(field, existing[field]);
    const newVal = norm(field, req.body[field]);
    if (String(oldVal ?? '') !== String(newVal ?? '')) {
      execute(
        `INSERT INTO akten_history (akte_id, changed_by, changed_at, field_name, old_value, new_value)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [Number(req.params.id), userId, now, field, String(oldVal ?? ''), String(newVal ?? '')]
      );
    }
  }

  // Perform the update — merge request body with existing data (only overwrite sent fields)
  const b = req.body;
  const merged = {
    datum:              b.datum !== undefined ? (b.datum || '') : existing.datum,
    kunde:              b.kunde !== undefined ? (b.kunde || '') : existing.kunde,
    anwalt:             b.anwalt !== undefined ? (b.anwalt || '') : existing.anwalt,
    vermittler:         b.vermittler !== undefined ? (b.vermittler || '') : existing.vermittler,
    customer_id:        b.customer_id !== undefined ? (b.customer_id || null) : existing.customer_id,
    vermittler_id:      b.vermittler_id !== undefined ? (b.vermittler_id || null) : existing.vermittler_id,
    versicherung_id:    b.versicherung_id !== undefined ? (b.versicherung_id || null) : existing.versicherung_id,
    rental_id:          b.rental_id !== undefined ? (b.rental_id || null) : existing.rental_id,
    unfalldatum:        b.unfalldatum !== undefined ? (b.unfalldatum || '') : existing.unfalldatum,
    unfallort:          b.unfallort !== undefined ? (b.unfallort || '') : existing.unfallort,
    polizei_vor_ort:    b.polizei_vor_ort !== undefined ? (b.polizei_vor_ort ? 1 : 0) : existing.polizei_vor_ort,
    mietart:            b.mietart !== undefined ? (b.mietart || '') : existing.mietart,
    wiedervorlage_datum: b.wiedervorlage_datum !== undefined ? (b.wiedervorlage_datum || '') : existing.wiedervorlage_datum,
    zahlungsstatus:     b.zahlungsstatus !== undefined ? (b.zahlungsstatus || 'offen') : existing.zahlungsstatus,
    status:             b.status !== undefined ? (b.status || 'Neu Angelegt') : existing.status,
  };
  execute(
    `UPDATE akten SET
      datum=?, kunde=?, anwalt=?, vermittler=?,
      customer_id=?, vermittler_id=?, versicherung_id=?, rental_id=?,
      unfalldatum=?, unfallort=?, polizei_vor_ort=?,
      mietart=?, wiedervorlage_datum=?,
      zahlungsstatus=?, status=?,
      updated_at=CURRENT_TIMESTAMP
     WHERE id=?`,
    [
      merged.datum, merged.kunde, merged.anwalt, merged.vermittler,
      merged.customer_id, merged.vermittler_id, merged.versicherung_id, merged.rental_id,
      merged.unfalldatum, merged.unfallort, merged.polizei_vor_ort,
      merged.mietart, merged.wiedervorlage_datum,
      merged.zahlungsstatus, merged.status,
      Number(req.params.id)
    ]
  );

  res.json(queryOne('SELECT * FROM akten WHERE id = ?', [Number(req.params.id)]));
});

// ===== Akten-Beteiligte (participants) =====
app.get('/api/akten/:id/beteiligte', (req, res) => {
  res.json(queryAll(
    'SELECT * FROM akten_beteiligte WHERE akte_id = ? ORDER BY sort_order ASC, id ASC',
    [Number(req.params.id)]
  ));
});

app.put('/api/akten/:id/beteiligte/sort', (req, res) => {
  const permission = req.headers['x-user-permission'];
  if (!['Admin', 'Verwaltung', 'Buchhaltung'].includes(permission)) {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }
  const { order } = req.body; // array of beteiligter IDs in desired order
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order array required' });
  const akteId = Number(req.params.id);
  order.forEach((betId, idx) => {
    execute('UPDATE akten_beteiligte SET sort_order = ? WHERE id = ? AND akte_id = ?', [idx, Number(betId), akteId]);
  });
  res.json({ success: true });
});

app.post('/api/akten/:id/beteiligte', (req, res) => {
  const permission = req.headers['x-user-permission'];
  if (!['Admin', 'Verwaltung', 'Buchhaltung'].includes(permission)) {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }
  const { type, entity_id, name, adresse, telefon, email, art } = req.body;
  if (!type) return res.status(400).json({ error: 'Typ erforderlich' });
  const akteId = Number(req.params.id);
  if (type === 'kunde') {
    const existing = queryOne('SELECT id FROM akten_beteiligte WHERE akte_id = ? AND type = ?', [akteId, 'kunde']);
    if (existing) return res.status(400).json({ error: 'Es darf nur ein Kunde pro Akte hinterlegt sein' });
  }
  const maxOrder = queryOne('SELECT MAX(sort_order) as m FROM akten_beteiligte WHERE akte_id = ?', [akteId]);
  const nextOrder = (maxOrder && maxOrder.m !== null ? maxOrder.m : -1) + 1;
  execute(
    'INSERT INTO akten_beteiligte (akte_id, type, entity_id, name, adresse, telefon, email, art, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [akteId, type, entity_id || null, name || '', adresse || '', telefon || '', email || '', art || '', nextOrder]
  );
  res.status(201).json({ success: true });
});

app.delete('/api/akten/:id/beteiligte/:betId', (req, res) => {
  const permission = req.headers['x-user-permission'];
  if (!['Admin', 'Verwaltung', 'Buchhaltung'].includes(permission)) {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }
  execute(
    'DELETE FROM akten_beteiligte WHERE id = ? AND akte_id = ?',
    [Number(req.params.betId), Number(req.params.id)]
  );
  res.json({ success: true });
});

// ===== Akteneinträge (case entries) =====
// ===== AKTEN-POST (Korrespondenz) =====
app.get('/api/akten/:id/post', (req, res) => {
  res.json(queryAll(
    `SELECT p.*, s.name AS uploader_name FROM akten_post p LEFT JOIN staff s ON p.uploaded_by = s.id WHERE p.akte_id = ? ORDER BY p.post_date DESC, p.id DESC`,
    [Number(req.params.id)]
  ));
});

app.post('/api/akten/:id/post', (req, res) => {
  const userId = Number(req.headers['x-user-id']);
  const { post_date, sender, recipient, subject, s3_key, filename, attachment_count } = req.body;
  if (!filename) return res.status(400).json({ error: 'Dateiname ist Pflichtfeld' });
  const result = execute(
    'INSERT INTO akten_post (akte_id, post_date, sender, recipient, subject, s3_key, filename, uploaded_by, attachment_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [Number(req.params.id), post_date || new Date().toISOString().split('T')[0], sender || '', recipient || '', subject || '', s3_key || '', filename, userId, Number(attachment_count) || 0]
  );
  res.json({ id: result.lastId, message: 'Post eingetragen' });
});

app.put('/api/akten-post/:id', (req, res) => {
  const { post_date, sender, recipient, subject, s3_key, filename, attachment_count } = req.body;
  let sql = 'UPDATE akten_post SET post_date=?, sender=?, recipient=?, subject=?';
  const params = [post_date || '', sender || '', recipient || '', subject || ''];
  if (s3_key !== undefined) { sql += ', s3_key=?'; params.push(s3_key); }
  if (filename !== undefined) { sql += ', filename=?'; params.push(filename); }
  if (attachment_count !== undefined) { sql += ', attachment_count=?'; params.push(Number(attachment_count) || 0); }
  sql += ' WHERE id=?';
  params.push(Number(req.params.id));
  execute(sql, params);
  res.json({ message: 'Post aktualisiert' });
});

app.delete('/api/akten-post/:id', (req, res) => {
  const permission = req.headers['x-user-permission'];
  if (!['Admin', 'Verwaltung', 'Buchhaltung'].includes(permission)) return res.status(403).json({ error: 'Keine Berechtigung' });
  execute('DELETE FROM akten_post WHERE id = ?', [Number(req.params.id)]);
  res.json({ message: 'Post gelöscht' });
});

app.get('/api/akten/:id/eintraege', (req, res) => {
  const rows = queryAll(
    `SELECT e.*, s.name AS author_name
     FROM akten_eintraege e
     LEFT JOIN staff s ON e.created_by = s.id
     WHERE e.akte_id = ?
     ORDER BY e.created_at DESC`,
    [Number(req.params.id)]
  );
  res.json(rows);
});

app.post('/api/akten/:id/eintraege', (req, res) => {
  const permission = req.headers['x-user-permission'];
  if (!['Admin', 'Verwaltung', 'Buchhaltung'].includes(permission)) {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }
  const akteId = Number(req.params.id);
  const userId = Number(req.headers['x-user-id']);
  const { text } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'Text darf nicht leer sein' });
  }
  const now = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Berlin' }).replace(' ', 'T');
  execute(
    'INSERT INTO akten_eintraege (akte_id, text, created_by, created_at) VALUES (?, ?, ?, ?)',
    [akteId, text.trim(), userId, now]
  );
  res.json({ success: true });
});

app.delete('/api/akten/:akteId/eintraege/:eintragId', (req, res) => {
  const permission = req.headers['x-user-permission'];
  const userId = Number(req.headers['x-user-id']);
  const eintrag = queryOne('SELECT * FROM akten_eintraege WHERE id = ? AND akte_id = ?', [Number(req.params.eintragId), Number(req.params.akteId)]);
  if (!eintrag) return res.status(404).json({ error: 'Eintrag nicht gefunden' });

  // Admin kann alles löschen
  if (permission === 'Admin') {
    execute('DELETE FROM akten_eintraege WHERE id = ?', [eintrag.id]);
    return res.json({ success: true });
  }

  // Andere: nur eigene Einträge und max 24h alt
  if (eintrag.created_by !== userId) {
    return res.status(403).json({ error: 'Sie k\u00f6nnen nur eigene Eintr\u00e4ge l\u00f6schen.' });
  }

  const created = new Date(eintrag.created_at);
  const now = new Date();
  const diffHours = (now - created) / (1000 * 60 * 60);
  if (diffHours > 24) {
    return res.status(403).json({ error: 'Eintr\u00e4ge k\u00f6nnen nur innerhalb von 24 Stunden gel\u00f6scht werden.' });
  }

  execute('DELETE FROM akten_eintraege WHERE id = ?', [eintrag.id]);
  res.json({ success: true });
});

app.delete('/api/akten/:id', (req, res) => {
  // SEC-01: Permission guard (explicit — global middleware only allows Admin, this adds Verwaltung/Buchhaltung)
  const permission = req.headers['x-user-permission'];
  if (!['Admin', 'Verwaltung', 'Buchhaltung'].includes(permission)) {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }
  const existing = queryOne('SELECT * FROM akten WHERE id = ?', [Number(req.params.id)]);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  execute('DELETE FROM akten WHERE id = ?', [Number(req.params.id)]);
  res.json({ success: true });
});

// ===== Stammdaten API Proxy =====
const STAMMDATEN_API_URL = process.env.STAMMDATEN_API_URL || 'http://localhost:3010';
const http = require('http');
const https = require('https');

// Internal helper: fetch a single Stammdaten record by path (returns parsed JSON or null)
async function fetchStammdatenById(urlPath) {
  return new Promise((resolve) => {
    const fullUrl = `${STAMMDATEN_API_URL}${urlPath}`;
    const proto = fullUrl.startsWith('https') ? https : http;
    let data = '';
    const req = proto.get(fullUrl, (proxyRes) => {
      proxyRes.on('data', chunk => data += chunk);
      proxyRes.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
  });
}

function proxyStammdatenRequest(req, res) {
  const url = `${STAMMDATEN_API_URL}${req.originalUrl}`;
  const proto = url.startsWith('https') ? https : http;
  const options = {
    method: req.method,
    headers: { 'Content-Type': 'application/json' }
  };
  const proxyReq = proto.request(url, options, proxyRes => {
    res.status(proxyRes.statusCode);
    let data = '';
    proxyRes.on('data', c => data += c);
    proxyRes.on('end', () => {
      try { res.json(JSON.parse(data)); } catch { res.send(data); }
    });
  });
  proxyReq.on('error', err => {
    console.error('Stammdaten API proxy error:', err.message);
    res.status(502).json({ error: 'Stammdaten API not reachable' });
  });
  if (req.body && ['POST', 'PUT'].includes(req.method)) {
    proxyReq.write(JSON.stringify(req.body));
  }
  proxyReq.end();
}

app.get('/api/insurances', proxyStammdatenRequest);
app.get('/api/insurances/:id', proxyStammdatenRequest);
app.post('/api/insurances', proxyStammdatenRequest);
app.put('/api/insurances/:id', proxyStammdatenRequest);
app.delete('/api/insurances/:id', proxyStammdatenRequest);

app.get('/api/lawyers', proxyStammdatenRequest);
app.get('/api/lawyers/:id', proxyStammdatenRequest);
app.post('/api/lawyers', proxyStammdatenRequest);
app.put('/api/lawyers/:id', proxyStammdatenRequest);
app.delete('/api/lawyers/:id', proxyStammdatenRequest);

app.get('/api/vermittler', proxyStammdatenRequest);
app.get('/api/vermittler/:id', proxyStammdatenRequest);
app.post('/api/vermittler', proxyStammdatenRequest);
app.put('/api/vermittler/:id', proxyStammdatenRequest);
app.delete('/api/vermittler/:id', proxyStammdatenRequest);

app.get('/api/dekra-drs', proxyStammdatenRequest);
app.get('/api/dekra-drs/:id', proxyStammdatenRequest);
app.post('/api/dekra-drs', proxyStammdatenRequest);
app.put('/api/dekra-drs/:id', proxyStammdatenRequest);
app.delete('/api/dekra-drs/:id', proxyStammdatenRequest);

// Fallback: serve index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Graceful shutdown
function gracefulShutdown(signal) {
  console.log(`\n${signal} empfangen. Server wird heruntergefahren...`);
  process.exit(0);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start server after DB is ready
getDb().then(() => {
  app.listen(PORT, HOST, () => {
    console.log(`Bemo-Verwaltung läuft auf http://${HOST}:${PORT} [${process.env.NODE_ENV || 'development'}]`);
  });
}).catch(err => {
  console.error('Datenbankfehler:', err);
  process.exit(1);
});
