-- =====================================================================
-- FiBu Kern-Schema (M2) — MariaDB 11.4
-- Portiert aus den ~60 Supabase/PostgreSQL-Migrationen von mailflow
-- (supabase/migrations/*fibu*.sql), finaler Spaltenstand je Tabelle.
--
-- Portierungs-Konventionen (siehe handoff.md §6):
--   UUID / gen_random_uuid()  -> CHAR(36) DEFAULT (UUID()); App-seitige IDs moeglich
--   TIMESTAMPTZ / NOW()       -> DATETIME DEFAULT CURRENT_TIMESTAMP (UTC per Konvention)
--   updated_at-Trigger        -> ON UPDATE CURRENT_TIMESTAMP
--   NUMERIC(p,s)              -> DECIMAL(p,s)
--   BOOLEAN                   -> BOOLEAN (TINYINT(1))
--   TEXT in UNIQUE/Index      -> VARCHAR(n); lange Freitexte bleiben TEXT/LONGTEXT
--   CHECK (x IN (...))        -> CHECK (MariaDB 11.4 erzwingt sie)
--   FK auf auth.users         -> entfaellt; reine CHAR(36)-Spalte (JWT-Auth kommt M6)
--   FK auf public.customers   -> entfaellt (CRM ausserhalb des FiBu-Moduls)
--   RLS-Policies / DB-Trigger -> entfallen; Mandanten-/Rollenfilter in der API-Schicht
--   Partielle Unique-Indizes  -> als normale Indizes; Dedup/Standard-Logik in der API
--
-- Alle Tabellen: ENGINE=InnoDB, utf8mb4. Reihenfolge = FK-Abhaengigkeit.
-- =====================================================================

-- ── 1. Mandantenstamm (Tenant) ───────────────────────────────────────
-- rechnung_zahlstelle_id -> fibu_zahlstellen wird am Ende per ALTER ergaenzt
-- (zirkulaere Abhaengigkeit mandanten <-> zahlstellen).
CREATE TABLE fibu_mandanten (
  id                      CHAR(36)      NOT NULL DEFAULT (UUID()),
  name                    VARCHAR(255)  NOT NULL,
  uid                     VARCHAR(20),
  mwst_nr                 VARCHAR(30),
  mwst_pflichtig          BOOLEAN       NOT NULL DEFAULT TRUE,
  geschaeftsjahr_beginn   SMALLINT      NOT NULL DEFAULT 1 CHECK (geschaeftsjahr_beginn BETWEEN 1 AND 12),
  waehrung                CHAR(3)       NOT NULL DEFAULT 'CHF',
  kontenrahmen            VARCHAR(20)   NOT NULL DEFAULT 'CH_KMU',
  adresse                 VARCHAR(255),
  plz                     VARCHAR(10),
  ort                     VARCHAR(100),
  land                    CHAR(2)       NOT NULL DEFAULT 'CH',
  aktiv                   BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at              DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  inbox_code              VARCHAR(50),
  imap_host               VARCHAR(255),
  imap_port               INT           DEFAULT 993,
  imap_user               VARCHAR(255),
  imap_password           VARCHAR(255),
  imap_mailbox            VARCHAR(100)  DEFAULT 'INBOX',
  imap_aktiv              BOOLEAN       NOT NULL DEFAULT FALSE,
  mwst_methode            VARCHAR(20)   NOT NULL DEFAULT 'effektiv'
                            CHECK (mwst_methode IN ('effektiv','saldosteuersatz','pauschalsteuersatz')),
  saldosteuersatz_prozent DECIMAL(5,2),
  abrechnungsperiode      VARCHAR(20)   NOT NULL DEFAULT 'quartal'
                            CHECK (abrechnungsperiode IN ('quartal','semester')),
  geschaeftsjahr          INT           NOT NULL DEFAULT (YEAR(CURRENT_DATE)),
  gesperrt_bis            DATE,
  belegfreigabe_aktiv     BOOLEAN       NOT NULL DEFAULT FALSE,
  fw_buchungskurs         VARCHAR(10)   NOT NULL DEFAULT 'monat' CHECK (fw_buchungskurs IN ('monat','tag')),
  fw_bewertungskurs       VARCHAR(10)   NOT NULL DEFAULT 'tag'   CHECK (fw_bewertungskurs IN ('monat','tag')),
  rechnung_logo_url       VARCHAR(500),
  rechnung_absender       TEXT,
  rechnung_fusszeile      TEXT,
  rechnung_zahlstelle_id  CHAR(36),
  rechnung_vorlage        VARCHAR(20)   NOT NULL DEFAULT 'klassisch'
                            CHECK (rechnung_vorlage IN ('klassisch','modern','kompakt')),
  PRIMARY KEY (id),
  UNIQUE KEY uq_mandanten_inbox_code (inbox_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 2. Zahlstellen (Bankverbindungen des Mandanten) ──────────────────
CREATE TABLE fibu_zahlstellen (
  id           CHAR(36)     NOT NULL DEFAULT (UUID()),
  mandant_id   CHAR(36)     NOT NULL,
  bezeichnung  VARCHAR(255) NOT NULL,
  konto_nr     VARCHAR(20),
  iban         VARCHAR(34)  NOT NULL,
  bic          VARCHAR(11),
  bank_name    VARCHAR(100),
  ist_standard BOOLEAN      NOT NULL DEFAULT FALSE,
  aktiv        BOOLEAN      NOT NULL DEFAULT TRUE,
  sortierung   SMALLINT     NOT NULL DEFAULT 0,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  waehrung     CHAR(3)      NOT NULL DEFAULT 'CHF',
  qr_iban      VARCHAR(34),
  PRIMARY KEY (id),
  KEY idx_zahlstellen_standard (mandant_id, ist_standard),  -- nur 1 Standard/Mandant: in API erzwingen
  CONSTRAINT fk_zahlstellen_mandant FOREIGN KEY (mandant_id) REFERENCES fibu_mandanten(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Jetzt die zirkulaere FK nachtragen.
ALTER TABLE fibu_mandanten
  ADD CONSTRAINT fk_mandanten_rechnung_zahlstelle
  FOREIGN KEY (rechnung_zahlstelle_id) REFERENCES fibu_zahlstellen(id);

-- ── 3. User -> Mandant Zugang (Rollen) ───────────────────────────────
-- user_id: kein FK (eigene Benutzertabelle folgt in M6); nur UUID-Referenz.
CREATE TABLE fibu_user_mandant_access (
  id         CHAR(36)    NOT NULL DEFAULT (UUID()),
  user_id    CHAR(36)    NOT NULL,
  mandant_id CHAR(36)    NOT NULL,
  role       VARCHAR(20) NOT NULL CHECK (role IN ('admin','buchhalter','readonly')),
  created_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_access_user_mandant (user_id, mandant_id),
  KEY idx_access_user (user_id),
  CONSTRAINT fk_access_mandant FOREIGN KEY (mandant_id) REFERENCES fibu_mandanten(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 4. Kontenplan ────────────────────────────────────────────────────
CREATE TABLE fibu_konten (
  id          CHAR(36)     NOT NULL DEFAULT (UUID()),
  mandant_id  CHAR(36)     NOT NULL,
  konto_nr    VARCHAR(20)  NOT NULL,
  bezeichnung VARCHAR(255) NOT NULL,
  konto_typ   VARCHAR(20)  NOT NULL CHECK (konto_typ IN ('aktiv','passiv','ertrag','aufwand','abschluss')),
  mwst_code   VARCHAR(10),
  aktiv       BOOLEAN      NOT NULL DEFAULT TRUE,
  waehrung    CHAR(3)      NOT NULL DEFAULT 'CHF',
  PRIMARY KEY (id),
  UNIQUE KEY uq_konten_mandant_nr (mandant_id, konto_nr),
  CONSTRAINT fk_konten_mandant FOREIGN KEY (mandant_id) REFERENCES fibu_mandanten(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 5. MwSt-Codes ────────────────────────────────────────────────────
CREATE TABLE fibu_mwst_codes (
  id                CHAR(36)     NOT NULL DEFAULT (UUID()),
  mandant_id        CHAR(36)     NOT NULL,
  code              VARCHAR(10)  NOT NULL,
  bezeichnung       VARCHAR(255) NOT NULL,
  satz              DECIMAL(5,2) NOT NULL DEFAULT 0,
  typ               VARCHAR(20)  NOT NULL
                      CHECK (typ IN ('vorsteuer','umsatzsteuer','steuerbefreit','bezugsteuer')),
  konto_vorsteuer   VARCHAR(20),
  konto_umsatz      VARCHAR(20),
  aktiv             BOOLEAN      NOT NULL DEFAULT TRUE,
  sortierung        SMALLINT     NOT NULL DEFAULT 0,
  abrechnung_ziffer VARCHAR(10),
  PRIMARY KEY (id),
  UNIQUE KEY uq_mwst_mandant_code (mandant_id, code),
  CONSTRAINT fk_mwst_mandant FOREIGN KEY (mandant_id) REFERENCES fibu_mandanten(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 6. Kontierungsregeln (Stichwort -> Konto/MwSt) ───────────────────
CREATE TABLE fibu_kontierungsregeln (
  id         CHAR(36)     NOT NULL DEFAULT (UUID()),
  mandant_id CHAR(36)     NOT NULL,
  stichwort  VARCHAR(255) NOT NULL,
  konto_nr   VARCHAR(20)  NOT NULL,
  mwst_code  VARCHAR(10),
  sortierung SMALLINT     NOT NULL DEFAULT 0,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_kontierung_mandant FOREIGN KEY (mandant_id) REFERENCES fibu_mandanten(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 7. Wechselkurse (globale Referenzdaten, kein Mandant) ────────────
CREATE TABLE fibu_wechselkurse (
  id          CHAR(36)      NOT NULL DEFAULT (UUID()),
  typ         VARCHAR(10)   NOT NULL CHECK (typ IN ('monat','tag')),
  datum       DATE          NOT NULL,
  waehrung    CHAR(3)       NOT NULL,
  einheit     INT           NOT NULL DEFAULT 1,
  kurs        DECIMAL(16,8) NOT NULL,
  kurs_raw    DECIMAL(16,8) NOT NULL,
  land        VARCHAR(100),
  quelle      VARCHAR(50)   NOT NULL DEFAULT 'BAZG/ESTV',
  imported_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_wechselkurse (typ, datum, waehrung)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 8. Lieferantenstamm ──────────────────────────────────────────────
CREATE TABLE fibu_lieferanten (
  id                     CHAR(36)     NOT NULL DEFAULT (UUID()),
  mandant_id             CHAR(36)     NOT NULL,
  nr                     VARCHAR(50)  NOT NULL,
  name                   VARCHAR(255) NOT NULL,
  uid                    VARCHAR(20),
  adresse                VARCHAR(255),
  plz                    VARCHAR(10),
  ort                    VARCHAR(100),
  land                   CHAR(2)      NOT NULL DEFAULT 'CH',
  iban                   VARCHAR(34),
  bank_name              VARCHAR(100),
  zahlungsbedingung_tage SMALLINT     NOT NULL DEFAULT 30,
  skonto_prozent         DECIMAL(5,2),
  skonto_tage            SMALLINT,
  standard_konto_nr      VARCHAR(20),
  mwst_code              VARCHAR(10)  NOT NULL DEFAULT 'M81',
  notiz                  TEXT,
  aktiv                  BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at             DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  waehrung               CHAR(3)      NOT NULL DEFAULT 'CHF',
  PRIMARY KEY (id),
  UNIQUE KEY uq_lieferanten_mandant_nr (mandant_id, nr),
  CONSTRAINT fk_lieferanten_mandant FOREIGN KEY (mandant_id) REFERENCES fibu_mandanten(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 9. Kreditoren-Belegkoepfe ────────────────────────────────────────
-- gebucht_von / freigegeben_von: ehemals FK auf auth.users -> jetzt reine UUID-Spalte.
CREATE TABLE fibu_kreditoren_belege (
  id                     CHAR(36)      NOT NULL DEFAULT (UUID()),
  mandant_id             CHAR(36)      NOT NULL,
  beleg_nr               VARCHAR(50)   NOT NULL,
  lieferant_id           CHAR(36)      NOT NULL,
  lieferant_beleg_nr     VARCHAR(100),
  belegdatum             DATE          NOT NULL,
  valutadatum            DATE,
  faelligkeit            DATE          NOT NULL,
  zahlungsbedingung_tage SMALLINT,
  waehrung               CHAR(3)       NOT NULL DEFAULT 'CHF',
  betrag_netto           DECIMAL(14,2) NOT NULL DEFAULT 0,
  betrag_mwst            DECIMAL(14,2) NOT NULL DEFAULT 0,
  betrag_brutto          DECIMAL(14,2) NOT NULL DEFAULT 0,
  betrag_bezahlt         DECIMAL(14,2) NOT NULL DEFAULT 0,
  bezahlt_am             DATE,
  zahlungsreferenz       VARCHAR(50),
  status                 VARCHAR(20)   NOT NULL DEFAULT 'offen'
                           CHECK (status IN ('offen','ausstehend','teilbezahlt','bezahlt','ebanking','storniert')),
  notiz                  TEXT,
  scan_url               VARCHAR(500),
  scan_ocr_text          TEXT,
  gebucht_am             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  gebucht_von            CHAR(36),
  created_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  verbucht               BOOLEAN       NOT NULL DEFAULT FALSE,
  belegtyp               VARCHAR(20)   NOT NULL DEFAULT 'rechnung' CHECK (belegtyp IN ('rechnung','gutschrift')),
  storno_beleg_id        CHAR(36),
  kurs                   DECIMAL(16,8),
  freigabe_status        VARCHAR(20)   NOT NULL DEFAULT 'freigegeben'
                           CHECK (freigabe_status IN ('ausstehend','freigegeben')),
  freigegeben_am         DATETIME,
  freigegeben_von        CHAR(36),
  buchungsdatum          DATE,
  mwst_abgerechnet       BOOLEAN       NOT NULL DEFAULT FALSE,
  mwst_abrechnung_ref    VARCHAR(100),
  belegreferenz          VARCHAR(100),
  gruppe                 VARCHAR(100),
  belegtext              VARCHAR(255),
  skonto_gebucht         BOOLEAN       NOT NULL DEFAULT FALSE,
  PRIMARY KEY (id),
  UNIQUE KEY uq_kreditoren_belege_mandant_nr (mandant_id, beleg_nr),
  KEY idx_kreditoren_belege_status (mandant_id, status),
  KEY idx_kreditoren_belege_faelligkeit (mandant_id, faelligkeit),
  KEY idx_kreditoren_belege_lieferant (mandant_id, lieferant_id),
  CONSTRAINT fk_kreditoren_belege_mandant   FOREIGN KEY (mandant_id)      REFERENCES fibu_mandanten(id) ON DELETE CASCADE,
  CONSTRAINT fk_kreditoren_belege_lieferant FOREIGN KEY (lieferant_id)    REFERENCES fibu_lieferanten(id),
  CONSTRAINT fk_kreditoren_belege_storno    FOREIGN KEY (storno_beleg_id) REFERENCES fibu_kreditoren_belege(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 10. Kreditoren-Positionen (Aufwandszeilen) ───────────────────────
CREATE TABLE fibu_kreditoren_positionen (
  id            CHAR(36)      NOT NULL DEFAULT (UUID()),
  mandant_id    CHAR(36)      NOT NULL,
  beleg_id      CHAR(36)      NOT NULL,
  position      SMALLINT      NOT NULL DEFAULT 1,
  konto_nr      VARCHAR(20)   NOT NULL,
  bezeichnung   VARCHAR(255),
  mwst_code     VARCHAR(10)   NOT NULL DEFAULT 'M81',
  mwst_satz     DECIMAL(5,2)  NOT NULL DEFAULT 8.1,
  betrag_netto  DECIMAL(14,2) NOT NULL DEFAULT 0,
  betrag_mwst   DECIMAL(14,2) NOT NULL DEFAULT 0,
  betrag_brutto DECIMAL(14,2) NOT NULL DEFAULT 0,
  kostenstelle  VARCHAR(50),
  PRIMARY KEY (id),
  KEY idx_kreditoren_positionen_beleg (beleg_id),
  CONSTRAINT fk_kreditoren_pos_mandant FOREIGN KEY (mandant_id) REFERENCES fibu_mandanten(id) ON DELETE CASCADE,
  CONSTRAINT fk_kreditoren_pos_beleg   FOREIGN KEY (beleg_id)   REFERENCES fibu_kreditoren_belege(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 11. Kreditoren-Dauerbelege ───────────────────────────────────────
CREATE TABLE fibu_kreditoren_dauerbelege (
  id                     CHAR(36)      NOT NULL DEFAULT (UUID()),
  mandant_id             CHAR(36)      NOT NULL,
  lieferant_id           CHAR(36)      NOT NULL,
  bezeichnung            VARCHAR(255)  NOT NULL,
  konto_nr               VARCHAR(20)   NOT NULL,
  mwst_code              VARCHAR(10),
  betrag_brutto          DECIMAL(14,2) NOT NULL,
  waehrung               CHAR(3)       NOT NULL DEFAULT 'CHF',
  intervall              VARCHAR(20)   NOT NULL
                           CHECK (intervall IN ('monatlich','quartal','halbjahr','jaehrlich')),
  zahlungsbedingung_tage SMALLINT      NOT NULL DEFAULT 30,
  naechstes_belegdatum   DATE          NOT NULL,
  letzte_erzeugung       DATE,
  aktiv                  BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_dauerbelege_mandant   FOREIGN KEY (mandant_id)   REFERENCES fibu_mandanten(id) ON DELETE CASCADE,
  CONSTRAINT fk_dauerbelege_lieferant FOREIGN KEY (lieferant_id) REFERENCES fibu_lieferanten(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 12. Kreditoren-Verrechnungen (Gutschrift gegen Rechnung) ─────────
CREATE TABLE fibu_kreditoren_verrechnungen (
  id                  CHAR(36)      NOT NULL DEFAULT (UUID()),
  mandant_id          CHAR(36)      NOT NULL,
  gutschrift_beleg_id CHAR(36)      NOT NULL,
  rechnung_beleg_id   CHAR(36)      NOT NULL,
  betrag              DECIMAL(14,2) NOT NULL,
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by          CHAR(36),
  PRIMARY KEY (id),
  CONSTRAINT fk_verrechnung_mandant    FOREIGN KEY (mandant_id)          REFERENCES fibu_mandanten(id) ON DELETE CASCADE,
  CONSTRAINT fk_verrechnung_gutschrift FOREIGN KEY (gutschrift_beleg_id) REFERENCES fibu_kreditoren_belege(id),
  CONSTRAINT fk_verrechnung_rechnung   FOREIGN KEY (rechnung_beleg_id)   REFERENCES fibu_kreditoren_belege(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 13. Hauptbuch-Buchungen (GL) ─────────────────────────────────────
CREATE TABLE fibu_buchungen (
  id            CHAR(36)      NOT NULL DEFAULT (UUID()),
  mandant_id    CHAR(36)      NOT NULL,
  buchungs_nr   VARCHAR(50)   NOT NULL,
  buchungsdatum DATE          NOT NULL,
  beleg_ref     VARCHAR(100),
  konto_soll    VARCHAR(20)   NOT NULL,
  konto_haben   VARCHAR(20)   NOT NULL,
  betrag        DECIMAL(14,2) NOT NULL,
  mwst_code     VARCHAR(10),
  mwst_betrag   DECIMAL(14,2),
  text          VARCHAR(255),
  quelle        VARCHAR(20)   CHECK (quelle IN ('kreditoren','debitoren','manuell','zahlungslauf','abschluss')),
  quelle_id     CHAR(36),
  storniert     BOOLEAN       NOT NULL DEFAULT FALSE,
  storno_von    CHAR(36),
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by    CHAR(36),
  periode_art   VARCHAR(20)   NOT NULL DEFAULT 'normal'
                  CHECK (periode_art IN ('normal','eroeffnung','abschluss')),
  fw_waehrung   CHAR(3),
  fw_betrag     DECIMAL(14,2),
  PRIMARY KEY (id),
  UNIQUE KEY uq_buchungen_mandant_nr (mandant_id, buchungs_nr),
  KEY idx_buchungen_datum (mandant_id, buchungsdatum),
  KEY idx_buchungen_soll  (mandant_id, konto_soll),
  KEY idx_buchungen_haben (mandant_id, konto_haben),
  KEY idx_buchungen_periode_art (mandant_id, periode_art),
  CONSTRAINT fk_buchungen_mandant FOREIGN KEY (mandant_id) REFERENCES fibu_mandanten(id) ON DELETE CASCADE,
  CONSTRAINT fk_buchungen_storno  FOREIGN KEY (storno_von) REFERENCES fibu_buchungen(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 14. Buchungsbelege (Koepfe fuer manuelle Buchungen) ──────────────
CREATE TABLE fibu_buchung_belege (
  id                CHAR(36)     NOT NULL DEFAULT (UUID()),
  mandant_id        CHAR(36)     NOT NULL,
  beleg_nr          VARCHAR(50)  NOT NULL,
  buchungsdatum     DATE         NOT NULL,
  text              VARCHAR(255),
  art               VARCHAR(20)  NOT NULL DEFAULT 'normal'
                      CHECK (art IN ('normal','storno','saldovortrag')),
  pdf_path          VARCHAR(500),
  pdf_name          VARCHAR(255),
  storniert         BOOLEAN      NOT NULL DEFAULT FALSE,
  storno_beleg_id   CHAR(36),
  original_beleg_id CHAR(36),
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by        CHAR(36),
  PRIMARY KEY (id),
  UNIQUE KEY uq_buchung_belege_mandant_nr (mandant_id, beleg_nr),
  CONSTRAINT fk_buchung_belege_mandant  FOREIGN KEY (mandant_id)        REFERENCES fibu_mandanten(id) ON DELETE CASCADE,
  CONSTRAINT fk_buchung_belege_storno   FOREIGN KEY (storno_beleg_id)   REFERENCES fibu_buchung_belege(id),
  CONSTRAINT fk_buchung_belege_original FOREIGN KEY (original_beleg_id) REFERENCES fibu_buchung_belege(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 15. Buchungs-Serien (wiederkehrende Buchungen) ───────────────────
CREATE TABLE fibu_buchung_serien (
  id               CHAR(36)      NOT NULL DEFAULT (UUID()),
  mandant_id       CHAR(36)      NOT NULL,
  bezeichnung      VARCHAR(255)  NOT NULL,
  konto_soll       VARCHAR(20)   NOT NULL,
  konto_haben      VARCHAR(20)   NOT NULL,
  betrag_total     DECIMAL(14,2) NOT NULL,
  anzahl_perioden  SMALLINT      NOT NULL DEFAULT 12 CHECK (anzahl_perioden BETWEEN 1 AND 120),
  intervall        VARCHAR(20)   NOT NULL DEFAULT 'monatlich'
                     CHECK (intervall IN ('monatlich','quartal','jaehrlich')),
  naechstes_datum  DATE          NOT NULL,
  erzeugt_anzahl   SMALLINT      NOT NULL DEFAULT 0,
  letzte_erzeugung DATE,
  aktiv            BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_buchung_serien_mandant FOREIGN KEY (mandant_id) REFERENCES fibu_mandanten(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 16. Bank-Imports (CAMT.053 Datei-Importe) ────────────────────────
CREATE TABLE fibu_bank_imports (
  id                   CHAR(36)     NOT NULL DEFAULT (UUID()),
  mandant_id           CHAR(36)     NOT NULL,
  dateiname            VARCHAR(255),
  konto_iban           VARCHAR(34),
  konto_nr             VARCHAR(20),
  import_datum         DATETIME     DEFAULT CURRENT_TIMESTAMP,
  anzahl_transaktionen INT          DEFAULT 0,
  erstellt_von         CHAR(36),
  PRIMARY KEY (id),
  CONSTRAINT fk_bank_imports_mandant FOREIGN KEY (mandant_id) REFERENCES fibu_mandanten(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 17. Bank-Transaktionen (CAMT-Zeilen + Matching) ──────────────────
-- matched_beleg_id: bewusst OHNE FK (polymorph Kreditor/Debitor via matched_typ).
CREATE TABLE fibu_bank_transaktionen (
  id               CHAR(36)      NOT NULL DEFAULT (UUID()),
  mandant_id       CHAR(36)      NOT NULL,
  import_id        CHAR(36),
  konto_iban       VARCHAR(34),
  buchungsdatum    DATE          NOT NULL,
  valutadatum      DATE,
  betrag           DECIMAL(15,2) NOT NULL,
  waehrung         CHAR(3)       DEFAULT 'CHF',
  richtung         VARCHAR(10)   NOT NULL CHECK (richtung IN ('eingang','ausgang')),
  gegenpartei_name VARCHAR(255),
  gegenpartei_iban VARCHAR(34),
  referenz_typ     VARCHAR(20),
  referenz_nr      VARCHAR(50),
  end_to_end_id    VARCHAR(64),
  verwendungszweck TEXT,
  zusatzinfo       TEXT,
  status           VARCHAR(20)   NOT NULL DEFAULT 'offen'
                     CHECK (status IN ('offen','vorschlag','gematcht','ignoriert','verbucht')),
  matched_beleg_id CHAR(36),
  matched_typ      VARCHAR(20)   CHECK (matched_typ IN ('kreditor','debitor')),
  match_confidence DECIMAL(4,2),
  match_methode    VARCHAR(50),
  buchungs_id      CHAR(36),
  created_at       DATETIME      DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bank_tx_dedup (mandant_id, konto_iban, buchungsdatum, betrag, richtung),  -- Dedup in API (part. Unique entfaellt)
  KEY idx_bank_tx_referenz (mandant_id, referenz_nr),
  CONSTRAINT fk_bank_tx_mandant FOREIGN KEY (mandant_id) REFERENCES fibu_mandanten(id) ON DELETE CASCADE,
  CONSTRAINT fk_bank_tx_import  FOREIGN KEY (import_id)   REFERENCES fibu_bank_imports(id) ON DELETE CASCADE,
  CONSTRAINT fk_bank_tx_buchung FOREIGN KEY (buchungs_id) REFERENCES fibu_buchungen(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 18. Zahlungslaeufe (PAIN.001) ────────────────────────────────────
CREATE TABLE fibu_zahlungslaeufe (
  id                 CHAR(36)      NOT NULL DEFAULT (UUID()),
  mandant_id         CHAR(36)      NOT NULL,
  lauf_nr            VARCHAR(50)   NOT NULL,
  valutadatum        DATE          NOT NULL,
  zahlungskonto_nr   VARCHAR(20)   NOT NULL,
  zahlungskonto_iban VARCHAR(34),
  total_betrag       DECIMAL(14,2) NOT NULL DEFAULT 0,
  anzahl_zahlungen   SMALLINT      NOT NULL DEFAULT 0,
  status             VARCHAR(20)   NOT NULL DEFAULT 'entwurf'
                       CHECK (status IN ('entwurf','freigegeben','exportiert','teilverbucht','verbucht','storniert')),
  pain001_xml        LONGTEXT,
  exportiert_am      DATETIME,
  verbucht_am        DATETIME,
  created_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by         CHAR(36),
  PRIMARY KEY (id),
  UNIQUE KEY uq_zahlungslaeufe_mandant_nr (mandant_id, lauf_nr),
  CONSTRAINT fk_zahlungslaeufe_mandant FOREIGN KEY (mandant_id) REFERENCES fibu_mandanten(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 19. Zahlungslauf-Positionen ──────────────────────────────────────
CREATE TABLE fibu_zahlungslauf_positionen (
  id                 CHAR(36)      NOT NULL DEFAULT (UUID()),
  mandant_id         CHAR(36)      NOT NULL,
  zahlungslauf_id    CHAR(36)      NOT NULL,
  beleg_id           CHAR(36)      NOT NULL,
  lieferant_id       CHAR(36)      NOT NULL,
  iban               VARCHAR(34)   NOT NULL,
  betrag             DECIMAL(14,2) NOT NULL,
  zahlungsreferenz   VARCHAR(50),
  zahlungsmitteilung VARCHAR(255),
  rueckgemeldet      BOOLEAN       NOT NULL DEFAULT FALSE,
  rueckgemeldet_am   DATETIME,
  bank_tx_id         CHAR(36),
  status             VARCHAR(20)   NOT NULL DEFAULT 'offen'
                       CHECK (status IN ('offen','ausgefuehrt','storniert')),
  skonto_betrag      DECIMAL(14,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  CONSTRAINT fk_zlp_mandant   FOREIGN KEY (mandant_id)      REFERENCES fibu_mandanten(id) ON DELETE CASCADE,
  CONSTRAINT fk_zlp_lauf      FOREIGN KEY (zahlungslauf_id) REFERENCES fibu_zahlungslaeufe(id) ON DELETE CASCADE,
  CONSTRAINT fk_zlp_beleg     FOREIGN KEY (beleg_id)        REFERENCES fibu_kreditoren_belege(id),
  CONSTRAINT fk_zlp_lieferant FOREIGN KEY (lieferant_id)    REFERENCES fibu_lieferanten(id),
  CONSTRAINT fk_zlp_bank_tx   FOREIGN KEY (bank_tx_id)      REFERENCES fibu_bank_transaktionen(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 20. Kundenstamm (Debitoren) ──────────────────────────────────────
-- crm_customer_id: FK auf public.customers entfaellt (CRM ausserhalb FiBu).
CREATE TABLE fibu_kunden (
  id                     CHAR(36)     NOT NULL DEFAULT (UUID()),
  mandant_id             CHAR(36)     NOT NULL,
  nr                     VARCHAR(50)  NOT NULL,
  name                   VARCHAR(255) NOT NULL,
  uid                    VARCHAR(20),
  adresse                VARCHAR(255),
  plz                    VARCHAR(10),
  ort                    VARCHAR(100),
  land                   CHAR(2)      NOT NULL DEFAULT 'CH',
  email                  VARCHAR(255),
  iban                   VARCHAR(34),
  zahlungsbedingung_tage SMALLINT     NOT NULL DEFAULT 30,
  standard_konto_nr      VARCHAR(20),
  mwst_code              VARCHAR(10)  NOT NULL DEFAULT 'U81',
  notiz                  TEXT,
  aktiv                  BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at             DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  crm_customer_id        CHAR(36),
  PRIMARY KEY (id),
  UNIQUE KEY uq_kunden_mandant_nr (mandant_id, nr),
  CONSTRAINT fk_kunden_mandant FOREIGN KEY (mandant_id) REFERENCES fibu_mandanten(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 21. Artikel/Leistungen (Debitoren) ───────────────────────────────
CREATE TABLE fibu_artikel (
  id            CHAR(36)      NOT NULL DEFAULT (UUID()),
  mandant_id    CHAR(36)      NOT NULL,
  nr            VARCHAR(50)   NOT NULL,
  typ           VARCHAR(20)   NOT NULL DEFAULT 'dienstleistung'
                  CHECK (typ IN ('dienstleistung','material')),
  name          VARCHAR(255)  NOT NULL,
  beschreibung  TEXT,
  einheit       VARCHAR(20)   NOT NULL DEFAULT 'Stk',
  verkaufspreis DECIMAL(14,2) NOT NULL DEFAULT 0,
  waehrung      CHAR(3)       NOT NULL DEFAULT 'CHF',
  mwst_code     VARCHAR(10)   NOT NULL DEFAULT 'U81',
  ertragskonto  VARCHAR(20),
  aktiv         BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_artikel_mandant_nr (mandant_id, nr),
  CONSTRAINT fk_artikel_mandant FOREIGN KEY (mandant_id) REFERENCES fibu_mandanten(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 22. Debitoren-Belegkoepfe ────────────────────────────────────────
CREATE TABLE fibu_debitoren_belege (
  id                     CHAR(36)      NOT NULL DEFAULT (UUID()),
  mandant_id             CHAR(36)      NOT NULL,
  beleg_nr               VARCHAR(50)   NOT NULL,
  kunde_id               CHAR(36)      NOT NULL,
  belegtyp               VARCHAR(20)   NOT NULL DEFAULT 'rechnung' CHECK (belegtyp IN ('rechnung','gutschrift')),
  titel                  VARCHAR(255),
  belegdatum             DATE          NOT NULL,
  valutadatum            DATE,
  faelligkeit            DATE          NOT NULL,
  zahlungsbedingung_tage SMALLINT,
  waehrung               CHAR(3)       NOT NULL DEFAULT 'CHF',
  betrag_netto           DECIMAL(14,2) NOT NULL DEFAULT 0,
  betrag_mwst            DECIMAL(14,2) NOT NULL DEFAULT 0,
  betrag_brutto          DECIMAL(14,2) NOT NULL DEFAULT 0,
  betrag_bezahlt         DECIMAL(14,2) NOT NULL DEFAULT 0,
  bezahlt_am             DATE,
  zahlungsreferenz       VARCHAR(50),
  status                 VARCHAR(20)   NOT NULL DEFAULT 'entwurf'
                           CHECK (status IN ('entwurf','offen','teilbezahlt','bezahlt','storniert')),
  notiz                  TEXT,
  pdf_url                VARCHAR(500),
  verbucht               BOOLEAN       NOT NULL DEFAULT FALSE,
  storno_beleg_id        CHAR(36),
  gebucht_am             DATETIME,
  gebucht_von            CHAR(36),
  created_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  mahnstufe              SMALLINT      NOT NULL DEFAULT 0,
  letzte_mahnung_am      DATE,
  gesendet_am            DATETIME,
  gesendet_an            VARCHAR(255),
  source_system          VARCHAR(50),
  source_id              CHAR(36),
  buchungsdatum          DATE,
  PRIMARY KEY (id),
  UNIQUE KEY uq_debitoren_belege_mandant_nr (mandant_id, beleg_nr),
  KEY idx_debitoren_belege_status (mandant_id, status),
  KEY idx_debitoren_belege_faelligkeit (mandant_id, faelligkeit),
  KEY idx_debitoren_belege_kunde (mandant_id, kunde_id),
  CONSTRAINT fk_debitoren_belege_mandant FOREIGN KEY (mandant_id)      REFERENCES fibu_mandanten(id) ON DELETE CASCADE,
  CONSTRAINT fk_debitoren_belege_kunde   FOREIGN KEY (kunde_id)        REFERENCES fibu_kunden(id),
  CONSTRAINT fk_debitoren_belege_storno  FOREIGN KEY (storno_beleg_id) REFERENCES fibu_debitoren_belege(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 23. Debitoren-Positionen ─────────────────────────────────────────
CREATE TABLE fibu_debitoren_positionen (
  id            CHAR(36)      NOT NULL DEFAULT (UUID()),
  mandant_id    CHAR(36)      NOT NULL,
  beleg_id      CHAR(36)      NOT NULL,
  position      SMALLINT      NOT NULL DEFAULT 1,
  artikel_id    CHAR(36),
  bezeichnung   VARCHAR(255),
  menge         DECIMAL(14,3) NOT NULL DEFAULT 1,
  einheit       VARCHAR(20),
  einzelpreis   DECIMAL(14,2) NOT NULL DEFAULT 0,
  konto_nr      VARCHAR(20)   NOT NULL,
  mwst_code     VARCHAR(10)   NOT NULL DEFAULT 'U81',
  mwst_satz     DECIMAL(5,2)  NOT NULL DEFAULT 8.1,
  betrag_netto  DECIMAL(14,2) NOT NULL DEFAULT 0,
  betrag_mwst   DECIMAL(14,2) NOT NULL DEFAULT 0,
  betrag_brutto DECIMAL(14,2) NOT NULL DEFAULT 0,
  kostenstelle  VARCHAR(50),
  PRIMARY KEY (id),
  KEY idx_debitoren_positionen_beleg (beleg_id),
  CONSTRAINT fk_debitoren_pos_mandant FOREIGN KEY (mandant_id) REFERENCES fibu_mandanten(id) ON DELETE CASCADE,
  CONSTRAINT fk_debitoren_pos_beleg   FOREIGN KEY (beleg_id)   REFERENCES fibu_debitoren_belege(id) ON DELETE CASCADE,
  CONSTRAINT fk_debitoren_pos_artikel FOREIGN KEY (artikel_id) REFERENCES fibu_artikel(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 24. Debitoren-Mahnungen ──────────────────────────────────────────
CREATE TABLE fibu_debitoren_mahnungen (
  id           CHAR(36)      NOT NULL DEFAULT (UUID()),
  mandant_id   CHAR(36)      NOT NULL,
  beleg_id     CHAR(36)      NOT NULL,
  stufe        SMALLINT      NOT NULL DEFAULT 1 CHECK (stufe BETWEEN 1 AND 3),
  mahndatum    DATE          NOT NULL DEFAULT (CURRENT_DATE),
  faellig_am   DATE,
  gebuehr      DECIMAL(14,2) NOT NULL DEFAULT 0,
  betrag_offen DECIMAL(14,2) NOT NULL DEFAULT 0,
  pdf_url      VARCHAR(500),
  gesendet_am  DATETIME,
  gesendet_an  VARCHAR(255),
  created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by   CHAR(36),
  PRIMARY KEY (id),
  CONSTRAINT fk_mahnungen_mandant FOREIGN KEY (mandant_id) REFERENCES fibu_mandanten(id) ON DELETE CASCADE,
  CONSTRAINT fk_mahnungen_beleg   FOREIGN KEY (beleg_id)   REFERENCES fibu_debitoren_belege(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 25. Budget (Soll-Werte pro Konto/Jahr) ───────────────────────────
CREATE TABLE fibu_budget (
  id         CHAR(36)      NOT NULL DEFAULT (UUID()),
  mandant_id CHAR(36)      NOT NULL,
  jahr       SMALLINT      NOT NULL,
  konto_nr   VARCHAR(20)   NOT NULL,
  betrag     DECIMAL(14,2) NOT NULL DEFAULT 0,
  updated_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_budget_mandant_jahr_konto (mandant_id, jahr, konto_nr),
  CONSTRAINT fk_budget_mandant FOREIGN KEY (mandant_id) REFERENCES fibu_mandanten(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 26. MwSt-Abrechnungsperioden ─────────────────────────────────────
CREATE TABLE fibu_mwst_abrechnungsperioden (
  id             CHAR(36)      NOT NULL DEFAULT (UUID()),
  mandant_id     CHAR(36)      NOT NULL,
  periode_von    DATE          NOT NULL,
  periode_bis    DATE          NOT NULL,
  status         VARCHAR(20)   NOT NULL DEFAULT 'offen'
                   CHECK (status IN ('offen','eingereicht','abgerechnet')),
  zahllast_chf   DECIMAL(15,2),
  eingereicht_am DATETIME,
  abgerechnet_am DATETIME,
  benutzer_id    CHAR(36),
  notizen        TEXT,
  created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mwst_perioden (mandant_id, periode_von, periode_bis),
  CONSTRAINT fk_mwst_perioden_mandant FOREIGN KEY (mandant_id) REFERENCES fibu_mandanten(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 27. Jahresabschluss ──────────────────────────────────────────────
CREATE TABLE fibu_jahresabschluss (
  id                   CHAR(36)      NOT NULL DEFAULT (UUID()),
  mandant_id           CHAR(36)      NOT NULL,
  jahr                 INT           NOT NULL,
  status               VARCHAR(20)   NOT NULL DEFAULT 'offen'
                         CHECK (status IN ('offen','abgeschlossen')),
  gewinn_verlust       DECIMAL(15,2),
  konto_jahresergebnis VARCHAR(20)   NOT NULL DEFAULT '9999',
  konto_gewinnvortrag  VARCHAR(20)   NOT NULL DEFAULT '2970',
  konto_verlustvortrag VARCHAR(20)   NOT NULL DEFAULT '2979',
  konto_eroeffnung     VARCHAR(20)   NOT NULL DEFAULT '9900',
  abgeschlossen_am     DATETIME,
  abgeschlossen_von    CHAR(36),
  created_at           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_jahresabschluss (mandant_id, jahr),
  CONSTRAINT fk_jahresabschluss_mandant FOREIGN KEY (mandant_id) REFERENCES fibu_mandanten(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 28. Rechnungs-Inbox (E-Mail/IMAP/OCR Belegeingang) ───────────────
-- mandant_id NULLABLE: Webhook-Eintraege koennen initial ohne Mandant ankommen.
CREATE TABLE fibu_rechnung_inbox (
  id                CHAR(36)     NOT NULL DEFAULT (UUID()),
  mandant_id        CHAR(36),
  sender_email      VARCHAR(255),
  sender_name       VARCHAR(255),
  betreff           VARCHAR(500),
  email_body        TEXT,
  received_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  pdf_path          VARCHAR(500),
  pdf_name          VARCHAR(255),
  status            VARCHAR(20)  NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','verarbeitet','ignoriert')),
  beleg_id          CHAR(36),
  inbox_code        VARCHAR(50),
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  extracted_text    TEXT,
  extraction_status VARCHAR(20)  NOT NULL DEFAULT 'pending',
  extraction_error  TEXT,
  ocr_used          BOOLEAN      NOT NULL DEFAULT FALSE,
  ocr_confidence    DECIMAL(6,4),
  ai_result         JSON,
  ai_status         VARCHAR(20)  NOT NULL DEFAULT 'pending',
  source            VARCHAR(20)  NOT NULL DEFAULT 'webhook' CHECK (source IN ('webhook','imap','manual')),
  imap_uid          BIGINT,
  imap_mailbox      VARCHAR(100),
  imap_message_id   VARCHAR(255),
  PRIMARY KEY (id),
  KEY idx_inbox_imap_uid (mandant_id, imap_mailbox, imap_uid),  -- Dedup in API (part. Unique entfaellt)
  CONSTRAINT fk_inbox_mandant FOREIGN KEY (mandant_id) REFERENCES fibu_mandanten(id) ON DELETE CASCADE,
  CONSTRAINT fk_inbox_beleg   FOREIGN KEY (beleg_id)   REFERENCES fibu_kreditoren_belege(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
