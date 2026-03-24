const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'bemo.db');
const DATA_DIR = path.join(__dirname, 'data');

let db = null;

async function getDb() {
  if (db) return db;

  const SQL = await initSqlJs();

  // Ensure data directory exists
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  // Load existing database or create new one
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // Enable foreign keys
  db.run('PRAGMA foreign_keys = ON');

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      street TEXT DEFAULT '',
      zip TEXT DEFAULT '',
      city TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      email TEXT DEFAULT '',
      reminder_asked INTEGER DEFAULT 0,
      reminder_response TEXT DEFAULT '',
      reminder_blocked INTEGER DEFAULT 0,
      customer_type TEXT DEFAULT 'Privatkunde',
      company_name TEXT DEFAULT '',
      special_agreements TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS vehicles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      manufacturer TEXT NOT NULL,
      model TEXT NOT NULL,
      vehicle_type TEXT DEFAULT '',
      vin TEXT DEFAULT '',
      license_plate TEXT DEFAULT '',
      first_registration TEXT DEFAULT '',
      next_tuev_date TEXT DEFAULT '',
      last_station TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
    )
  `);

  // Migration: add last_station column if missing
  try {
    db.run('ALTER TABLE vehicles ADD COLUMN last_station TEXT DEFAULT ""');
  } catch (e) { /* column already exists */ }

  // Migration: add next_sp_date for LKW Sicherheitsprüfung
  try {
    db.run("ALTER TABLE vehicles ADD COLUMN next_sp_date TEXT DEFAULT ''");
  } catch (e) { /* column already exists */ }

  db.run(`
    CREATE TABLE IF NOT EXISTS staff (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      station TEXT DEFAULT '',
      password TEXT DEFAULT '',
      permission_level TEXT DEFAULT 'Benutzer',
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS credits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      credit_number TEXT DEFAULT '',
      credit_date TEXT DEFAULT '',
      description TEXT DEFAULT '',
      amount_net REAL DEFAULT 0,
      amount_gross REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS calendar_appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      station TEXT NOT NULL,
      appointment_date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      phone TEXT DEFAULT '',
      email TEXT DEFAULT '',
      license_plate TEXT DEFAULT '',
      vehicle_type TEXT DEFAULT '',
      vehicle_model TEXT DEFAULT '',
      booking_method TEXT DEFAULT 'Telefonisch',
      notes TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS vacation_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      staff_id INTEGER NOT NULL,
      entry_type TEXT NOT NULL DEFAULT 'Urlaub',
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      notes TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT DEFAULT ''
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_number TEXT NOT NULL UNIQUE,
      customer_id INTEGER NOT NULL,
      invoice_date TEXT NOT NULL,
      due_date TEXT DEFAULT '',
      status TEXT DEFAULT 'Entwurf',
      total_net REAL DEFAULT 0,
      total_gross REAL DEFAULT 0,
      total_vat REAL DEFAULT 0,
      notes TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS invoice_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL,
      position INTEGER DEFAULT 1,
      description TEXT DEFAULT '',
      quantity REAL DEFAULT 1,
      unit_price REAL DEFAULT 0,
      total_net REAL DEFAULT 0,
      total_gross REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS staff_vacation_days (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      staff_id INTEGER NOT NULL,
      year INTEGER NOT NULL,
      days INTEGER NOT NULL DEFAULT 30,
      FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE,
      UNIQUE(staff_id, year)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS fleet_vehicles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      manufacturer TEXT NOT NULL,
      model TEXT NOT NULL,
      vehicle_type TEXT DEFAULT '',
      vin TEXT DEFAULT '',
      license_plate TEXT DEFAULT '',
      first_registration TEXT DEFAULT '',
      next_tuev_date TEXT DEFAULT '',
      assigned_staff_id INTEGER DEFAULT NULL,
      notes TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (assigned_staff_id) REFERENCES staff(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS fleet_maintenance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fleet_vehicle_id INTEGER NOT NULL,
      maintenance_date TEXT DEFAULT '',
      workshop TEXT DEFAULT '',
      km_stand INTEGER DEFAULT 0,
      cost REAL DEFAULT 0,
      description TEXT DEFAULT '',
      next_maintenance_date TEXT DEFAULT '',
      next_maintenance_km INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (fleet_vehicle_id) REFERENCES fleet_vehicles(id) ON DELETE CASCADE
    )
  `);

  // Migration: fleet_maintenance new columns
  try { db.run("ALTER TABLE fleet_maintenance ADD COLUMN next_maintenance_date TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE fleet_maintenance ADD COLUMN next_maintenance_km INTEGER DEFAULT 0"); } catch(e) {}

  db.run(`
    CREATE TABLE IF NOT EXISTS fleet_mileage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fleet_vehicle_id INTEGER NOT NULL,
      record_date TEXT DEFAULT '',
      km_stand INTEGER DEFAULT 0,
      recorded_by_staff_id INTEGER DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (fleet_vehicle_id) REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
      FOREIGN KEY (recorded_by_staff_id) REFERENCES staff(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS changelog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version TEXT NOT NULL,
      release_date TEXT NOT NULL,
      description TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS changelog_acknowledgements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      staff_id INTEGER NOT NULL,
      changelog_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(staff_id, changelog_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      staff_id INTEGER NOT NULL,
      subject TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT DEFAULT 'Offen',
      admin_response TEXT DEFAULT '',
      read_by_creator INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      staff_id INTEGER NOT NULL,
      subject TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT DEFAULT 'Offen',
      admin_comment TEXT DEFAULT '',
      read_by_creator INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Migration: staff entry/exit dates
  try { db.run("ALTER TABLE staff ADD COLUMN entry_date TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE staff ADD COLUMN exit_date TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE staff ADD COLUMN email TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE staff ADD COLUMN street TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE staff ADD COLUMN zip TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE staff ADD COLUMN city TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE staff ADD COLUMN phone_private TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE staff ADD COLUMN phone_business TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE staff ADD COLUMN emergency_name TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE staff ADD COLUMN emergency_phone TEXT DEFAULT ''"); } catch(e) {}

  // Migrations for existing databases
  try { db.run('ALTER TABLE customers ADD COLUMN reminder_blocked INTEGER DEFAULT 0'); } catch(e) {}
  try { db.run("ALTER TABLE staff ADD COLUMN password TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE staff ADD COLUMN permission_level TEXT DEFAULT 'Benutzer'"); } catch(e) {}
  try { db.run("ALTER TABLE vehicles ADD COLUMN vehicle_type TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE customers ADD COLUMN customer_type TEXT DEFAULT 'Privatkunde'"); } catch(e) {}
  try { db.run("ALTER TABLE customers ADD COLUMN company_name TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE customers ADD COLUMN special_agreements TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE staff ADD COLUMN vacation_days INTEGER DEFAULT 30"); } catch(e) {}
  try { db.run("ALTER TABLE vacation_entries ADD COLUMN status TEXT DEFAULT 'Genehmigt'"); } catch(e) {}
  try { db.run("ALTER TABLE vacation_entries ADD COLUMN payment_status INTEGER DEFAULT 0"); } catch(e) {}
  try { db.run("ALTER TABLE vacation_entries ADD COLUMN half_day INTEGER DEFAULT 0"); } catch(e) {}
  try { db.run("ALTER TABLE calendar_appointments ADD COLUMN assigned_staff_id INTEGER DEFAULT NULL"); } catch(e) {}
  try { db.run("ALTER TABLE customers ADD COLUMN contact_person TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE customers ADD COLUMN contact_phone TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE calendar_appointments ADD COLUMN customer_id INTEGER DEFAULT NULL"); } catch(e) {}
  try { db.run("ALTER TABLE staff ADD COLUMN has_calendar INTEGER DEFAULT 1"); } catch(e) {}
  try { db.run("UPDATE staff SET has_calendar = 1 WHERE has_calendar IS NULL"); } catch(e) {}
  try { db.run("ALTER TABLE staff ADD COLUMN calendar_visibility TEXT DEFAULT 'Admin,Verwaltung,Buchhaltung,Benutzer'"); } catch(e) {}
  try { db.run("UPDATE staff SET calendar_visibility = 'Admin,Verwaltung,Buchhaltung,Benutzer' WHERE calendar_visibility IS NULL"); } catch(e) {}

  try { db.run("ALTER TABLE staff_vacation_days ADD COLUMN bonus_days INTEGER DEFAULT 0"); } catch(e) {}

  db.run(`
    CREATE TABLE IF NOT EXISTS customer_rebates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      rebate_date TEXT NOT NULL,
      rebate_text TEXT NOT NULL DEFAULT '',
      rebate_type TEXT NOT NULL DEFAULT '',
      agreed_with_staff_id INTEGER DEFAULT NULL,
      created_by_staff_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
      FOREIGN KEY (agreed_with_staff_id) REFERENCES staff(id),
      FOREIGN KEY (created_by_staff_id) REFERENCES staff(id)
    )
  `);

  try { db.run("ALTER TABLE customer_rebates ADD COLUMN rebate_period TEXT DEFAULT ''"); } catch(e) {}

  // Invoice schema additions for v1 milestone (DB-01, DB-02)
  try { db.run("ALTER TABLE invoices ADD COLUMN service_date TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE invoices ADD COLUMN payment_method TEXT DEFAULT 'Überweisung'"); } catch(e) {}
  // GoBD: Firmendaten-Snapshot bei Erstellung einfrieren
  try { db.run("ALTER TABLE invoices ADD COLUMN company_snapshot TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE credit_notes ADD COLUMN company_snapshot TEXT DEFAULT ''"); } catch(e) {}
  // Bank accounts (Bankverbindungen)
  db.run(`
    CREATE TABLE IF NOT EXISTS bank_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL DEFAULT '',
      iban TEXT NOT NULL DEFAULT '',
      bic TEXT DEFAULT '',
      bank_name TEXT DEFAULT '',
      is_default INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // vat_rate per item for GoBD reproducibility (DB column needed for Phase 5 PDF)
  try { db.run("ALTER TABLE invoice_items ADD COLUMN vat_rate REAL DEFAULT 0.19"); } catch(e) {}

  // Time tracking entries
  db.run(`
    CREATE TABLE IF NOT EXISTS time_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      staff_id INTEGER NOT NULL,
      entry_date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT DEFAULT '',
      break_minutes INTEGER DEFAULT 0,
      notes TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
    )
  `);

  // Migration: weekly_hours on staff
  try { db.run("ALTER TABLE staff ADD COLUMN weekly_hours REAL DEFAULT 40"); } catch(e) {}

  // Migration: work_days on staff (1=Mo,2=Di,...,7=So)
  try { db.run("ALTER TABLE staff ADD COLUMN work_days TEXT DEFAULT '1,2,3,4,5'"); } catch(e) {}

  // Migration: default_station_id on staff
  try { db.run("ALTER TABLE staff ADD COLUMN default_station_id INTEGER DEFAULT NULL"); } catch(e) {}

  // Migration: add username to staff
  try { db.run("ALTER TABLE staff ADD COLUMN username TEXT DEFAULT ''"); } catch(e) {}

  // Credit notes (Gutschriften)
  db.run(`
    CREATE TABLE IF NOT EXISTS credit_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      credit_number TEXT NOT NULL UNIQUE,
      customer_id INTEGER NOT NULL,
      credit_date TEXT NOT NULL,
      due_date TEXT DEFAULT '',
      status TEXT DEFAULT 'Entwurf',
      total_net REAL DEFAULT 0,
      total_gross REAL DEFAULT 0,
      total_vat REAL DEFAULT 0,
      service_date TEXT DEFAULT '',
      payment_method TEXT DEFAULT 'Überweisung',
      notes TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS credit_note_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      credit_note_id INTEGER NOT NULL,
      position INTEGER DEFAULT 1,
      description TEXT DEFAULT '',
      quantity REAL DEFAULT 1,
      unit_price REAL DEFAULT 0,
      total_net REAL DEFAULT 0,
      total_gross REAL DEFAULT 0,
      vat_rate REAL DEFAULT 0.19,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (credit_note_id) REFERENCES credit_notes(id) ON DELETE CASCADE
    )
  `);

  // Overtime deductions table
  db.run(`
    CREATE TABLE IF NOT EXISTS overtime_deductions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      staff_id INTEGER NOT NULL,
      deduction_date TEXT NOT NULL,
      minutes INTEGER NOT NULL,
      reason TEXT DEFAULT '',
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
    )
  `);

  save();
  return db;
}

function save() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// Helper: run query and return all rows as objects
function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

// Helper: run query and return first row as object
function queryOne(sql, params = []) {
  const rows = queryAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

// Helper: run an insert/update/delete and save
function execute(sql, params = []) {
  db.run(sql, params);
  const result = db.exec("SELECT last_insert_rowid() as id");
  const lastId = result.length > 0 ? result[0].values[0][0] : 0;
  save();
  return { lastId };
}

module.exports = { getDb, queryAll, queryOne, execute, save };
