# Feature Landscape

**Domain:** Car Rental Management Software (Autovermietung)
**Project:** Bemo Verwaltungssystem
**Researched:** 2026-03-26
**Context:** Existing system with most modules in place. Focus is (1) polishing existing features and (2) designing an "Akten" module for rental processes.

---

## What the App Already Has

The following are already implemented and are NOT research targets here (noted for completeness):

- Customer management (Privat/Firma), vehicle management, fleet overview
- Staff management with 4 roles, login, calendar, time tracking, vacation planner
- Invoicing with auto-numbering, PDF generation, credit notes
- Vermittler, Versicherungen, Anwälte master data
- OCR vehicle registration scan, S3 file upload, O365 email
- Support tickets, suggestions, company settings
- Rental module (basic structure only)

---

## Table Stakes

Features users of car rental management software expect. Missing = product feels incomplete or creates operational risk.

### Rental Process / Mietvorgang

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Mietvertrag (rental contract) with all core fields | Legal requirement, every rental generates one | Medium | Fields: customer, vehicle, pickup/return date+time+location, rental rate, mileage in/out, fuel level in/out, deposit amount, driver's license number, additional drivers |
| Übergabeprotokoll (vehicle handover record) | Protects against damage disputes; standard in DE | Medium | Checklist: exterior damage map, fuel level, mileage, equipment check (warning triangle, first aid, vest), existing scratches/dents noted |
| Rückgabeprotokoll (vehicle return record) | Mirror of handover; required for damage claims | Medium | Same fields as handover + new damage noted, final mileage, fuel level on return |
| Rental status tracking | Operators need to know what's out, when it returns | Low | States: Angebot, Gebucht, Ausgegeben, Zurückgegeben, Abgerechnet, Storniert |
| Rental linked to customer + vehicle | Core data relationship | Low | Already partially exists in rental module |
| Rental linked to Vermittler (broker) | Common in DE for insurance replacement rentals | Low | Already have Vermittler master data |
| Rental rate / price calculation | Needed for invoicing | Medium | Daily rate * days + extras; mileage overage optional |
| Invoice generation from rental | Closes the billing loop | Medium | Already have invoice module; need to link rental → invoice |
| Document attachment per rental | Contracts, photos, repair bills | Low | Already have S3 upload; need attachment per rental record |

### Akten Module (Case File Management)

A core insight from the German rental market: Bemo primarily does **Unfallersatz** (accident replacement vehicles). This means every rental is tied to an insurance claim, a Werkstatt (repair shop), and often a Rechtsanwalt (lawyer). An "Akte" is not just a rental record — it is a case file that tracks the entire liability/insurance workflow.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Akte (case file) as container for a rental process | Groups all related documents, parties, and status | Medium | One Akte = one rental incident; links to: customer, vehicle rented, vehicle being repaired, Versicherung, Anwalt, Vermittler |
| Schadensfahrzeug (damaged vehicle) reference | The car being repaired — distinct from the rental car | Low | Fields: owner, license plate/make/model, insurance claim number |
| Versicherung linked to Akte | Whose insurance is paying, claim number, contact | Low | Already have Versicherungen master data |
| Anwalt linked to Akte | Attorney handling the claim | Low | Already have Anwälte master data |
| Status workflow for Akte | Know where in the process each case is | Medium | States e.g.: Neu, In Bearbeitung, Fahrzeug ausgegeben, Reparatur abgeschlossen, Rechnung gestellt, Offen, Abgeschlossen |
| Mietdauer / Reparaturdauer tracking | Rental is only valid for the repair period; must be documented | Low | Start/end dates + Werkstatt confirmation |
| Kostenübernahme-Typ | Who pays: gegnerische Haftpflicht, Kaskoversicherung, Selbstzahler | Low | Determines billing address and rate table |
| Notes/Verlauf (case history log) | Track communications, decisions, issues per case | Medium | Timestamped log entries per Akte, author tracked |
| Search and filter Akten | Operators need to find cases by customer, vehicle, status, date | Low | Standard list view with filters |

### Existing Module Polish (Common Missing Items)

Based on the "unfertige Detailansichten" (unfinished detail views) problem noted in PROJECT.md, and patterns observed across German rental software:

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Detail view for every entity | Users expect click-through to full record | Low–Medium | Common gap: list views exist but detail/edit modal is incomplete |
| Required field validation with clear messages | Data integrity; avoids orphaned records | Low | Already partially exists; needs consistent application |
| Consistent empty states | "No records found" with helpful prompt | Low | Purely UI polish |
| Confirmation dialogs for destructive actions | Prevents accidental deletes | Low | Already partially exists |
| Search/filter on all list views | Operators have hundreds of records | Low | Calendar, tickets, time tracking may still lack search |
| Status badges on list views | Quick visual scan of record state | Low | Already exists on invoices; needs to extend to rentals, Akten |
| Pagination or virtual scroll on large lists | Performance and UX at scale | Medium | SQLite is fast but 10K+ records need pagination |
| Audit trail for key records | Who changed what, when — required for compliance | Medium | Currently no structured logging |
| PDF export for rental contract / handover protocol | Physical signature requirement in DE | Medium | Already have pdfkit for invoices; pattern exists |

---

## Differentiators

Features that set a product apart. Bemo is a custom internal tool, so competitive differentiation is against manual (paper/spreadsheet) processes, not against other SaaS products.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Unfallersatz workflow automation | Guides staff through the complete accident-replacement process step by step | High | Reduces training burden; ensures nothing is missed |
| Cross-module search | Find anything (customer, vehicle, Akte, invoice) from one search bar | Medium | Very useful as the system grows; prevents duplicate records |
| Akte → Invoice generation (one click) | Close the loop between case file and billing without re-entering data | Medium | Highest-value integration in this system |
| Rental calendar view (vehicle availability) | See which cars are out when; prevent double-booking | Medium | Already have a calendar; needs to integrate rental dates |
| Dashboard KPIs for rentals | Active rentals, overdue returns, open invoices — at a glance | Low | Currently dashboard is time-tracking focused |
| Schadenskarte (damage diagram) in handover protocol | Visual car outline to mark scratches/dents — reduces disputes | High | Requires canvas/SVG drawing; high value, high complexity |
| Email notifications for Akte milestones | Alert Anwalt, Versicherung, or customer when status changes | Medium | Already have O365 email integration; needs triggers |
| Duplicate detection for Akten | Prevent two case files for the same incident | Low | Customer + vehicle + date combination check |

---

## Anti-Features

Things to deliberately NOT build in this milestone.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Online booking portal for customers | Bemo is B2B/internal; customers don't self-serve | Staff-operated intake only |
| GPS vehicle tracking | Overkill for a small multi-location operation; separate hardware concern | Note vehicle location as a text field if needed |
| Dynamic pricing / revenue management | Rates are negotiated with Vermittler/Versicherung upfront | Fixed rate tables per category |
| Customer-facing self-service portal | Not the business model | Staff handles all customer interaction |
| Automated dunning (Mahnwesen) | Explicitly out of scope per PROJECT.md | Manual status flags on invoices |
| Mobile app | Explicitly out of scope per PROJECT.md | Ensure web UI is functional on tablet for handover use |
| Multi-tenancy / SaaS features | Single company internal tool | Keep single-tenant architecture |
| AI damage detection from photos | Technically complex, requires external API, marginal benefit for this scale | Manual damage notes + photo upload is sufficient |
| Booking channel integrations (OTA, etc.) | Not a consumer-facing rental company | Rentals are created manually by staff |

---

## Feature Dependencies

```
Akte (case file)
  requires: Customer, Vehicle (rental car), Versicherung, Anwalt, Vermittler (all exist)
  requires: Rental record (basic structure exists, needs completion)
  enables: Invoice generation (already exists, needs Akte link)
  enables: PDF rental contract (needs pdfkit template)

Rental record (full)
  requires: Customer, Vehicle
  requires: Pricing/rate (new: rate field or rate table)
  enables: Akte
  enables: Invoice

Übergabeprotokoll / Rückgabeprotokoll
  requires: Rental record
  enables: Damage claim
  enables: PDF generation

PDF rental contract
  requires: Rental record (all fields populated)
  depends on: pdfkit (already in use for invoices)

Akte status workflow
  enables: Email notifications (via existing O365 integration)
  enables: Dashboard KPIs

Cross-module search
  depends on: All modules having stable data models
  suggest: Build last, after modules are stable
```

---

## MVP Recommendation

Given that this is a polish + new-module milestone (not a greenfield build), priorities are:

**Phase 1 — Complete rental module (prerequisite for Akten):**
1. Full Mietvertrag data model (all required fields)
2. Rental status states
3. Rental linked to invoice

**Phase 2 — Akten module (the main deliverable):**
1. Akte as case container (customer + vehicle + Versicherung + Anwalt + Vermittler)
2. Schadensfahrzeug reference
3. Kostenübernahme-Typ
4. Status workflow
5. Notes/Verlauf log
6. List view with search/filter

**Phase 3 — Protocols and PDF (closes the paper trail):**
1. Übergabeprotokoll fields
2. Rückgabeprotokoll fields
3. PDF generation for rental contract and handover protocol

**Defer:**
- Schadenskarte (damage diagram): High complexity, can use photo upload + notes instead
- Cross-module search: Build after all modules are stable
- Rental calendar integration: Useful but not blocking
- Dashboard KPIs: Low effort, but low priority against core data model work

---

## Sources

- [Car Rental Management Software Features — Adamosoft](https://adamosoft.com/blog/travel-software-development/must-have-features-of-car-rental-management-software/) (MEDIUM confidence — marketing content, cross-referenced with other sources)
- [Rentsoft Autovermietung Features](https://rentsoft.de/branchen/autovermietung/) (MEDIUM confidence — German market product, authoritative for DE context)
- [Remoso Car Rental Software](https://www.remoso.com/en/software-solutions/car-rental-software) (MEDIUM confidence — German market product)
- [Mietwagen Übergabeprotokoll — billiger-mietwagen.de](https://www.billiger-mietwagen.de/faq/mietwagen-uebergabeprotokoll.html) (MEDIUM confidence — consumer-facing explanation of protocol fields)
- [Mietwagen nach Unfall Ablauf — bussgeldkatalog.org](https://www.bussgeldkatalog.org/mietwagen-nach-unfall/) (MEDIUM confidence — DE legal/process overview)
- [Unfallrechtler Stuttgart — Mietwagen beim Unfallschaden](https://www.unfallrechtler-stuttgart.de/unfallschaden-a-z/mietwagen/) (MEDIUM confidence — DE attorney perspective on documentation requirements)
- [Record360 — Vehicle Inspection Workflows](https://record360.com/) (LOW confidence — US market SaaS, general inspection workflow patterns)
- [Fleetster — Damage Management](https://www.fleetster.net/fleet-software/fleet-management/damage-management) (LOW confidence — general fleet SaaS, not rental-specific)
