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

  // Migration: fleet_vehicles rental type and assignment
  try { db.run("ALTER TABLE fleet_vehicles ADD COLUMN rental_type TEXT DEFAULT 'kurz'"); } catch(e) {}
  try { db.run("ALTER TABLE fleet_vehicles ADD COLUMN assigned_to TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE fleet_vehicles ADD COLUMN assigned_customer_id INTEGER DEFAULT NULL"); } catch(e) {}
  try { db.run("ALTER TABLE fleet_vehicles ADD COLUMN assigned_contact_person TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE fleet_vehicles ADD COLUMN vehicle_group TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE fleet_vehicles ADD COLUMN transmission TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE fleet_vehicles ADD COLUMN fuel_type TEXT DEFAULT ''"); } catch(e) {}

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
  try { db.run("ALTER TABLE staff ADD COLUMN hidden_in_planning INTEGER DEFAULT 0"); } catch(e) {}
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
  try { db.run("ALTER TABLE customer_rebates ADD COLUMN next_due_date TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE customer_rebates ADD COLUMN is_active INTEGER DEFAULT 1"); } catch(e) {}

  // Customer: Firmenkunden-Erweiterung (Bankverbindung, Steuernr, Rechnungskunde, Mahnstufe)
  try { db.run("ALTER TABLE customers ADD COLUMN tax_number TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE customers ADD COLUMN bank_iban TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE customers ADD COLUMN bank_bic TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE customers ADD COLUMN bank_holder TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE customers ADD COLUMN bank_name TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE customers ADD COLUMN is_invoice_customer INTEGER DEFAULT 0"); } catch(e) {}
  try { db.run("ALTER TABLE customers ADD COLUMN dunning_level TEXT DEFAULT ''"); } catch(e) {}

  // Credits: Erweiterte Felder (Art, abgerechneter Zeitraum)
  try { db.run("ALTER TABLE credits ADD COLUMN credit_type TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE credits ADD COLUMN settled_period TEXT DEFAULT ''"); } catch(e) {}

  // ===== Vermittler-Verwaltung (lokal in Bemo-DB, nicht in Stammdaten-API) =====
  db.run(`
    CREATE TABLE IF NOT EXISTS vermittler_management (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vermittler_id INTEGER NOT NULL UNIQUE,
      bank_iban TEXT DEFAULT '',
      bank_bic TEXT DEFAULT '',
      bank_holder TEXT DEFAULT '',
      bank_name TEXT DEFAULT '',
      special_agreements TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS vermittler_rebates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vermittler_id INTEGER NOT NULL,
      rebate_date TEXT NOT NULL,
      rebate_text TEXT NOT NULL DEFAULT '',
      rebate_type TEXT NOT NULL DEFAULT '',
      rebate_period TEXT DEFAULT '',
      next_due_date TEXT DEFAULT '',
      is_active INTEGER DEFAULT 1,
      agreed_with_staff_id INTEGER DEFAULT NULL,
      created_by_staff_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (agreed_with_staff_id) REFERENCES staff(id),
      FOREIGN KEY (created_by_staff_id) REFERENCES staff(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS vermittler_credits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vermittler_id INTEGER NOT NULL,
      credit_number TEXT DEFAULT '',
      credit_date TEXT DEFAULT '',
      description TEXT DEFAULT '',
      amount_net REAL DEFAULT 0,
      amount_gross REAL DEFAULT 0,
      credit_type TEXT DEFAULT '',
      settled_period TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Invoice schema additions for v1 milestone (DB-01, DB-02)
  try { db.run("ALTER TABLE invoices ADD COLUMN service_date TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE invoices ADD COLUMN payment_method TEXT DEFAULT 'Überweisung'"); } catch(e) {}
  // GoBD: Firmendaten-Snapshot bei Erstellung einfrieren
  try { db.run("ALTER TABLE invoices ADD COLUMN company_snapshot TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE invoices ADD COLUMN vermittler_id INTEGER DEFAULT NULL"); } catch(e) {}
  try { db.run("ALTER TABLE credit_notes ADD COLUMN company_snapshot TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE credit_notes ADD COLUMN vermittler_id INTEGER DEFAULT NULL"); } catch(e) {}
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

  // Phase 4: Zahlungserfassung (PAY-DB-01 bis PAY-DB-04)
  // invoice_payments — bidirektionale Zahlungsbuchungen (Eingänge + Ausgänge) pro Rechnung
  db.run(`
    CREATE TABLE IF NOT EXISTS invoice_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL,
      direction TEXT NOT NULL CHECK (direction IN ('in','out')),
      amount REAL NOT NULL CHECK (amount > 0),
      payment_date TEXT NOT NULL,
      payment_method TEXT DEFAULT '',
      bank_account_id INTEGER,
      reference TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      booked_by TEXT NOT NULL DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
      FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id)
    )
  `);

  // Performance-Indizes (PAY-DB-04)
  db.run(`CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice_date ON invoice_payments(invoice_id, payment_date)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_invoice_payments_bank_account ON invoice_payments(bank_account_id)`);

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

  // Akten <-> Invoices/Credit-Notes (Many-to-Many)
  db.run(`
    CREATE TABLE IF NOT EXISTS akten_invoices (
      akte_id INTEGER NOT NULL,
      invoice_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (akte_id, invoice_id),
      FOREIGN KEY (akte_id) REFERENCES akten(id) ON DELETE CASCADE,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
    )
  `);
  try { db.run('CREATE INDEX IF NOT EXISTS idx_akten_invoices_invoice ON akten_invoices(invoice_id)'); } catch(e) {}

  db.run(`
    CREATE TABLE IF NOT EXISTS akten_credit_notes (
      akte_id INTEGER NOT NULL,
      credit_note_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (akte_id, credit_note_id),
      FOREIGN KEY (akte_id) REFERENCES akten(id) ON DELETE CASCADE,
      FOREIGN KEY (credit_note_id) REFERENCES credit_notes(id) ON DELETE CASCADE
    )
  `);
  try { db.run('CREATE INDEX IF NOT EXISTS idx_akten_credit_notes_credit ON akten_credit_notes(credit_note_id)'); } catch(e) {}

  // Rentals (Vermietung)
  db.run(`
    CREATE TABLE IF NOT EXISTS rentals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER NOT NULL,
      customer_name TEXT DEFAULT '',
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      notes TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (vehicle_id) REFERENCES fleet_vehicles(id) ON DELETE CASCADE
    )
  `);

  // Migration: add mietart and created_by to rentals
  try { db.run("ALTER TABLE rentals ADD COLUMN mietart TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE rentals ADD COLUMN created_by INTEGER DEFAULT NULL"); } catch(e) {}
  try { db.run("ALTER TABLE rentals ADD COLUMN status TEXT DEFAULT 'Reservierung'"); } catch(e) {}
  try { db.run("ALTER TABLE rentals ADD COLUMN start_time TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE rentals ADD COLUMN end_time TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE rentals ADD COLUMN km_start TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE rentals ADD COLUMN km_end TEXT DEFAULT ''"); } catch(e) {}

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

  // File activity log
  db.run(`
    CREATE TABLE IF NOT EXISTS file_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      file_key TEXT NOT NULL,
      filename TEXT NOT NULL DEFAULT '',
      folder TEXT NOT NULL DEFAULT '',
      user_id INTEGER,
      username TEXT NOT NULL DEFAULT '',
      file_size INTEGER DEFAULT 0,
      details TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT ''
    )
  `);

  // Akten (case files) table
  db.run(`
    CREATE TABLE IF NOT EXISTS akten (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      aktennummer TEXT NOT NULL DEFAULT '',
      datum TEXT NOT NULL DEFAULT '',
      kunde TEXT NOT NULL DEFAULT '',
      anwalt TEXT NOT NULL DEFAULT '',
      vorlage TEXT NOT NULL DEFAULT '',
      zahlungsstatus TEXT NOT NULL DEFAULT 'offen',
      vermittler TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'offen',
      notizen TEXT NOT NULL DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Phase 1 migrations: akten new columns (DB-01, DB-02, DB-03)
  try { db.run("ALTER TABLE akten ADD COLUMN customer_id INTEGER DEFAULT NULL"); } catch(e) {}
  try { db.run("ALTER TABLE akten ADD COLUMN vermittler_id INTEGER DEFAULT NULL"); } catch(e) {}
  try { db.run("ALTER TABLE akten ADD COLUMN versicherung_id INTEGER DEFAULT NULL"); } catch(e) {}
  try { db.run("ALTER TABLE akten ADD COLUMN rental_id INTEGER DEFAULT NULL"); } catch(e) {}
  try { db.run("ALTER TABLE akten ADD COLUMN unfalldatum TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE akten ADD COLUMN unfallort TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE akten ADD COLUMN polizei_vor_ort INTEGER DEFAULT 0"); } catch(e) {}
  try { db.run("ALTER TABLE akten ADD COLUMN mietart TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE akten ADD COLUMN wiedervorlage_datum TEXT DEFAULT ''"); } catch(e) {}

  // Phase 1: Table reconstruction for UNIQUE(aktennummer) constraint (DB-04)
  try {
    const idxResult = db.exec("PRAGMA index_list(akten)");
    // db.exec returns [{ columns: [...], values: [[seq, name, unique, origin, partial], ...] }]
    // Column index 2 is the 'unique' flag (1 = unique index exists)
    const uniqueExists = idxResult.length > 0 &&
      idxResult[0].values.some(row => row[2] === 1);

    if (!uniqueExists) {
      db.run('PRAGMA foreign_keys = OFF');
      db.run('BEGIN TRANSACTION');

      db.run(`
        CREATE TABLE akten_new (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          aktennummer     TEXT NOT NULL DEFAULT '' UNIQUE,
          datum           TEXT NOT NULL DEFAULT '',
          kunde           TEXT NOT NULL DEFAULT '',
          anwalt          TEXT NOT NULL DEFAULT '',
          vorlage         TEXT NOT NULL DEFAULT '',
          vermittler      TEXT NOT NULL DEFAULT '',
          customer_id     INTEGER DEFAULT NULL,
          vermittler_id   INTEGER DEFAULT NULL,
          versicherung_id INTEGER DEFAULT NULL,
          rental_id       INTEGER DEFAULT NULL,
          unfalldatum     TEXT DEFAULT '',
          unfallort       TEXT DEFAULT '',
          polizei_vor_ort INTEGER DEFAULT 0,
          mietart         TEXT DEFAULT '',
          wiedervorlage_datum TEXT DEFAULT '',
          zahlungsstatus  TEXT NOT NULL DEFAULT 'offen',
          status          TEXT NOT NULL DEFAULT 'offen',
          notizen         TEXT NOT NULL DEFAULT '',
          created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      db.run(`
        INSERT INTO akten_new
          (id, aktennummer, datum, kunde, anwalt, vorlage, vermittler,
           customer_id, vermittler_id, versicherung_id, rental_id,
           unfalldatum, unfallort, polizei_vor_ort,
           mietart, wiedervorlage_datum,
           zahlungsstatus, status, notizen, created_at, updated_at)
        SELECT
          id, aktennummer, datum, kunde, anwalt, vorlage, vermittler,
          customer_id, vermittler_id, versicherung_id, rental_id,
          unfalldatum, unfallort, polizei_vor_ort,
          mietart, wiedervorlage_datum,
          zahlungsstatus, status, notizen, created_at, updated_at
        FROM akten
      `);

      db.run('DROP TABLE akten');
      db.run('ALTER TABLE akten_new RENAME TO akten');
      db.run('COMMIT');
      db.run('PRAGMA foreign_keys = ON');
      console.log('akten migration: table reconstructed with UNIQUE(aktennummer) and new columns');
    }
  } catch (e) {
    try { db.run('ROLLBACK'); } catch (_) {}
    db.run('PRAGMA foreign_keys = ON');
    console.error('akten migration failed:', e.message);
  }

  // Migration: add created_by to akten
  try { db.run("ALTER TABLE akten ADD COLUMN created_by INTEGER DEFAULT NULL"); } catch(e) {}

  // Akten-Nummerierung: separate Sequenz-Tabelle, damit gelöschte Aktennummern NIEMALS wiedervergeben werden.
  // Eine Zeile mit dem zuletzt vergebenen Wert. Beim INSERT wird der Wert atomic erhöht.
  db.run(`
    CREATE TABLE IF NOT EXISTS akten_sequence (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_used_nummer INTEGER NOT NULL DEFAULT 999
    )
  `);
  // Initialisierung: existierende Zeile sicherstellen, Wert = max(aktuelles MAX in akten, gespeicherter Wert, 999)
  // So bleibt eine bestehende Sequenz erhalten, wird aber nie hinter den höchsten Bestandswert zurückgesetzt.
  try {
    const seqRow = queryOne('SELECT last_used_nummer FROM akten_sequence WHERE id = 1');
    const maxRow = queryOne('SELECT MAX(CAST(aktennummer AS INTEGER)) AS m FROM akten');
    const existingMax = (maxRow && maxRow.m) || 0;
    if (!seqRow) {
      const startVal = Math.max(existingMax, 999);
      execute('INSERT INTO akten_sequence (id, last_used_nummer) VALUES (1, ?)', [startVal]);
    } else if (existingMax > seqRow.last_used_nummer) {
      // Sicherheitsnetz: falls jemand manuell eine höhere Nummer eingetragen hat, Sequenz nachziehen
      execute('UPDATE akten_sequence SET last_used_nummer = ? WHERE id = 1', [existingMax]);
    }
  } catch (e) { /* erste Initialisierung läuft beim ersten Akten-Anlegen */ }

  // Migration: remove vorlage and notizen columns from akten
  try {
    const colCheck = db.exec("PRAGMA table_info(akten)");
    const hasVorlage = colCheck.length > 0 && colCheck[0].values.some(row => row[1] === 'vorlage');
    if (hasVorlage) {
      db.run('PRAGMA foreign_keys = OFF');
      db.run('BEGIN TRANSACTION');
      db.run(`
        CREATE TABLE akten_clean (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          aktennummer     TEXT NOT NULL DEFAULT '' UNIQUE,
          datum           TEXT NOT NULL DEFAULT '',
          kunde           TEXT NOT NULL DEFAULT '',
          anwalt          TEXT NOT NULL DEFAULT '',
          vermittler      TEXT NOT NULL DEFAULT '',
          customer_id     INTEGER DEFAULT NULL,
          vermittler_id   INTEGER DEFAULT NULL,
          versicherung_id INTEGER DEFAULT NULL,
          rental_id       INTEGER DEFAULT NULL,
          unfalldatum     TEXT DEFAULT '',
          unfallort       TEXT DEFAULT '',
          polizei_vor_ort INTEGER DEFAULT 0,
          mietart         TEXT DEFAULT '',
          wiedervorlage_datum TEXT DEFAULT '',
          zahlungsstatus  TEXT NOT NULL DEFAULT 'offen',
          status          TEXT NOT NULL DEFAULT 'Neu Angelegt',
          created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      db.run(`
        INSERT INTO akten_clean
          (id, aktennummer, datum, kunde, anwalt, vermittler,
           customer_id, vermittler_id, versicherung_id, rental_id,
           unfalldatum, unfallort, polizei_vor_ort,
           mietart, wiedervorlage_datum,
           zahlungsstatus, status, created_at, updated_at)
        SELECT
          id, aktennummer, datum, kunde, anwalt, vermittler,
          customer_id, vermittler_id, versicherung_id, rental_id,
          unfalldatum, unfallort, polizei_vor_ort,
          mietart, wiedervorlage_datum,
          zahlungsstatus, status, created_at, updated_at
        FROM akten
      `);
      db.run('DROP TABLE akten');
      db.run('ALTER TABLE akten_clean RENAME TO akten');
      db.run('COMMIT');
      db.run('PRAGMA foreign_keys = ON');
      console.log('akten migration: removed vorlage and notizen columns');
    }
  } catch (e) {
    try { db.run('ROLLBACK'); } catch (_) {}
    db.run('PRAGMA foreign_keys = ON');
    console.error('akten cleanup migration failed:', e.message);
  }

  // Akten-Beteiligte (participants, many-per-akte)
  db.run(`
    CREATE TABLE IF NOT EXISTS akten_beteiligte (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      akte_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      entity_id INTEGER,
      name TEXT DEFAULT '',
      adresse TEXT DEFAULT '',
      telefon TEXT DEFAULT '',
      email TEXT DEFAULT '',
      art TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (akte_id) REFERENCES akten(id) ON DELETE CASCADE
    )
  `);
  // Migration: add columns if missing
  try { db.run("ALTER TABLE akten_beteiligte ADD COLUMN adresse TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE akten_beteiligte ADD COLUMN telefon TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE akten_beteiligte ADD COLUMN email TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE akten_beteiligte ADD COLUMN art TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE akten_beteiligte ADD COLUMN sort_order INTEGER DEFAULT 0"); } catch(e) {}

  // Fleet vehicle damages
  db.run(`
    CREATE TABLE IF NOT EXISTS fleet_damages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fleet_vehicle_id INTEGER NOT NULL,
      damage_date TEXT NOT NULL DEFAULT '',
      damage_type TEXT NOT NULL DEFAULT '',
      repair_cost REAL DEFAULT 0,
      caused_by TEXT DEFAULT '',
      status TEXT DEFAULT 'unrepariert',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (fleet_vehicle_id) REFERENCES fleet_vehicles(id) ON DELETE CASCADE
    )
  `);

  // Fleet insurance contracts
  db.run(`
    CREATE TABLE IF NOT EXISTS fleet_insurance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fleet_vehicle_id INTEGER NOT NULL,
      contract_date TEXT NOT NULL DEFAULT '',
      insurance_name TEXT DEFAULT '',
      insurance_type TEXT DEFAULT '',
      annual_premium REAL DEFAULT 0,
      payment_interval TEXT DEFAULT '',
      payment_method TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (fleet_vehicle_id) REFERENCES fleet_vehicles(id) ON DELETE CASCADE
    )
  `);
  try { db.run("ALTER TABLE fleet_insurance ADD COLUMN deductible REAL DEFAULT 0"); } catch(e) {}
  try { db.run("ALTER TABLE fleet_insurance ADD COLUMN sf_class TEXT DEFAULT ''"); } catch(e) {}

  // Fleet vehicle tax
  db.run(`
    CREATE TABLE IF NOT EXISTS fleet_tax (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fleet_vehicle_id INTEGER NOT NULL,
      tax_date TEXT NOT NULL DEFAULT '',
      tax_year TEXT DEFAULT '',
      tax_amount REAL DEFAULT 0,
      payment_method TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (fleet_vehicle_id) REFERENCES fleet_vehicles(id) ON DELETE CASCADE
    )
  `);

  // Fleet maintenance documents
  db.run(`
    CREATE TABLE IF NOT EXISTS fleet_maintenance_docs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      maintenance_id INTEGER NOT NULL,
      filename TEXT NOT NULL DEFAULT '',
      s3_key TEXT NOT NULL DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (maintenance_id) REFERENCES fleet_maintenance(id) ON DELETE CASCADE
    )
  `);

  // Fleet insurance documents
  db.run(`
    CREATE TABLE IF NOT EXISTS fleet_insurance_docs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      insurance_id INTEGER NOT NULL,
      filename TEXT NOT NULL DEFAULT '',
      s3_key TEXT NOT NULL DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (insurance_id) REFERENCES fleet_insurance(id) ON DELETE CASCADE
    )
  `);

  // Fleet damage documents
  db.run(`
    CREATE TABLE IF NOT EXISTS fleet_damage_docs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      damage_id INTEGER NOT NULL,
      filename TEXT NOT NULL DEFAULT '',
      s3_key TEXT NOT NULL DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (damage_id) REFERENCES fleet_damages(id) ON DELETE CASCADE
    )
  `);

  // Rental-Beteiligte (participants for rentals)
  db.run(`
    CREATE TABLE IF NOT EXISTS rental_beteiligte (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rental_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      entity_id INTEGER,
      name TEXT DEFAULT '',
      adresse TEXT DEFAULT '',
      telefon TEXT DEFAULT '',
      email TEXT DEFAULT '',
      art TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (rental_id) REFERENCES rentals(id) ON DELETE CASCADE
    )
  `);

  // Akteneinträge (case entries / notes log)
  db.run(`
    CREATE TABLE IF NOT EXISTS akten_eintraege (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      akte_id INTEGER NOT NULL,
      text TEXT NOT NULL DEFAULT '',
      created_by INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (akte_id) REFERENCES akten(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES staff(id)
    )
  `);

  // Akten-Post (Korrespondenz)
  db.run(`
    CREATE TABLE IF NOT EXISTS akten_post (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      akte_id INTEGER NOT NULL,
      post_date TEXT NOT NULL,
      sender TEXT DEFAULT '',
      recipient TEXT DEFAULT '',
      subject TEXT DEFAULT '',
      s3_key TEXT NOT NULL DEFAULT '',
      filename TEXT NOT NULL DEFAULT '',
      uploaded_by INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (akte_id) REFERENCES akten(id) ON DELETE CASCADE,
      FOREIGN KEY (uploaded_by) REFERENCES staff(id)
    )
  `);

  try { db.run("ALTER TABLE akten_post ADD COLUMN attachment_count INTEGER DEFAULT 0"); } catch(e) {}
  try { db.run("ALTER TABLE akten_post ADD COLUMN direction TEXT DEFAULT 'eingehend'"); } catch(e) {}
  try { db.run("ALTER TABLE akten_post ADD COLUMN participant TEXT DEFAULT ''"); } catch(e) {}
  // Bestandsdaten: participant aus sender (eingehend) bzw. recipient (ausgehend) befüllen, falls leer
  try { db.run("UPDATE akten_post SET participant = COALESCE(NULLIF(sender,''), NULLIF(recipient,''), '') WHERE participant IS NULL OR participant = ''"); } catch(e) {}

  // Akten-Kommunikation (Telefonate & Notizen)
  db.run(`
    CREATE TABLE IF NOT EXISTS akten_kommunikation (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      akte_id INTEGER NOT NULL,
      entry_type TEXT NOT NULL DEFAULT 'Telefon',
      direction TEXT DEFAULT 'eingehend',
      entry_date TEXT NOT NULL,
      entry_time TEXT DEFAULT '',
      participant TEXT DEFAULT '',
      subject TEXT DEFAULT '',
      content TEXT DEFAULT '',
      created_by INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (akte_id) REFERENCES akten(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES staff(id)
    )
  `);

  // Phase 1: Audit trail table (DB-05 — GoBD compliance)
  db.run(`
    CREATE TABLE IF NOT EXISTS akten_history (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      akte_id     INTEGER NOT NULL,
      changed_by  INTEGER NOT NULL,
      changed_at  TEXT NOT NULL,
      field_name  TEXT NOT NULL,
      old_value   TEXT,
      new_value   TEXT,
      FOREIGN KEY (akte_id) REFERENCES akten(id) ON DELETE CASCADE,
      FOREIGN KEY (changed_by) REFERENCES staff(id)
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
