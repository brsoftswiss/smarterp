-- =====================================================================
-- Seed (Entwicklung): ein Testmandant mit CH-KMU-Kontenplan + MwSt-Codes.
-- Idempotent: feste Mandant-UUID + INSERT IGNORE (UNIQUE-Keys verhindern
-- Duplikate bei wiederholtem `npm run seed`).
-- =====================================================================

SET @mandant := '00000000-0000-0000-0000-000000000001';

-- ── Mandant ──────────────────────────────────────────────────────────
INSERT IGNORE INTO fibu_mandanten
  (id, name, uid, mwst_nr, mwst_pflichtig, waehrung, kontenrahmen, adresse, plz, ort, land)
VALUES
  (@mandant, 'Testmandant AG', 'CHE-123.456.789', 'CHE-123.456.789 MWST', TRUE,
   'CHF', 'CH_KMU', 'Teststrasse 1', '8000', 'Zürich', 'CH');

-- ── MwSt-Codes (CH, Stand 8.1/2.6/3.8 %) ─────────────────────────────
-- code, bezeichnung, satz, typ, konto_vorsteuer, konto_umsatz, sortierung, abrechnung_ziffer
INSERT IGNORE INTO fibu_mwst_codes
  (mandant_id, code, bezeichnung, satz, typ, konto_vorsteuer, konto_umsatz, sortierung, abrechnung_ziffer)
VALUES
  (@mandant, 'M81', 'Vorsteuer 8.1 % (Normalsteuersatz)',                  8.1, 'vorsteuer',     '1170', NULL,   10,  '400'),
  (@mandant, 'M26', 'Vorsteuer 2.6 % (Reduziertensatz)',                   2.6, 'vorsteuer',     '1170', NULL,   20,  '400'),
  (@mandant, 'M38', 'Vorsteuer 3.8 % (Beherbergung)',                      3.8, 'vorsteuer',     '1170', NULL,   30,  '400'),
  (@mandant, 'I81', 'Vorsteuer Investitionen 8.1 %',                       8.1, 'vorsteuer',     '1171', NULL,   40,  '405'),
  (@mandant, 'M0',  'Kein MWST (steuerbefreit / nicht steuerpflichtig)',   0.0, 'steuerbefreit', NULL,   NULL,   50,  NULL),
  (@mandant, 'U81', 'Umsatzsteuer 8.1 % (Normalsteuersatz)',               8.1, 'umsatzsteuer',  NULL,   '2200', 60,  '302'),
  (@mandant, 'U26', 'Umsatzsteuer 2.6 % (Reduziertensatz)',                2.6, 'umsatzsteuer',  NULL,   '2200', 70,  '312'),
  (@mandant, 'U38', 'Umsatzsteuer 3.8 % (Beherbergung)',                   3.8, 'umsatzsteuer',  NULL,   '2200', 80,  '342'),
  (@mandant, 'U0',  'Steuerbefreite Umsätze (Export Art. 23, mit VSt-Abzug)', 0.0, 'steuerbefreit', NULL, NULL, 90,  '221'),
  (@mandant, 'U0A', 'Ausgenommene Umsätze (Art. 21, ohne VSt-Abzug)',      0.0, 'steuerbefreit', NULL,   NULL,   95,  '230'),
  (@mandant, 'BZ',  'Bezugsteuer 8.1 % (Leistungsbezug Ausland)',          8.1, 'bezugsteuer',   '1170', '2200', 100, '382');

-- ── Kontenplan CH KMU ────────────────────────────────────────────────
-- mwst_code referenziert die obigen Codes (konto.mwst_code ist weicher Verweis).
INSERT IGNORE INTO fibu_konten (mandant_id, konto_nr, bezeichnung, konto_typ, mwst_code) VALUES
  -- Umlaufvermögen
  (@mandant,'1000','Kasse','aktiv',NULL),
  (@mandant,'1020','Bank','aktiv',NULL),
  (@mandant,'1030','PostFinance','aktiv',NULL),
  (@mandant,'1100','Debitoren aus Lieferungen & Leistungen','aktiv',NULL),
  (@mandant,'1109','Delkredere','aktiv',NULL),
  (@mandant,'1170','Vorsteuer (Eingangssteuern)','aktiv',NULL),
  (@mandant,'1171','Vorsteuer Investitionen','aktiv',NULL),
  (@mandant,'1176','Verrechnungssteuer','aktiv',NULL),
  (@mandant,'1200','Vorräte','aktiv',NULL),
  (@mandant,'1300','Aktive Rechnungsabgrenzung','aktiv',NULL),
  -- Anlagevermögen
  (@mandant,'1500','Maschinen, Einrichtungen','aktiv',NULL),
  (@mandant,'1510','Fahrzeuge','aktiv',NULL),
  (@mandant,'1520','Büromaschinen, EDV','aktiv',NULL),
  (@mandant,'1800','Beteiligungen','aktiv',NULL),
  -- Kurzfristiges Fremdkapital
  (@mandant,'2000','Kreditoren aus Lieferungen & Leistungen','passiv',NULL),
  (@mandant,'2200','Mehrwertsteuer (Umsatzsteuern)','passiv',NULL),
  (@mandant,'2206','Abrechnungskonto MWST','passiv',NULL),
  (@mandant,'2210','Direkte Steuern (Rückstellung)','passiv',NULL),
  (@mandant,'2300','Kurzfristige Bankverbindlichkeiten','passiv',NULL),
  (@mandant,'2400','Passive Rechnungsabgrenzung','passiv',NULL),
  -- Langfristiges Fremdkapital
  (@mandant,'2500','Langfristige Bankdarlehen','passiv',NULL),
  -- Eigenkapital
  (@mandant,'2800','Aktienkapital / Stammkapital','passiv',NULL),
  (@mandant,'2900','Gesetzliche Kapitalreserve','passiv',NULL),
  (@mandant,'2910','Gesetzliche Gewinnreserve','passiv',NULL),
  (@mandant,'2950','Freiwillige Gewinnreserven','passiv',NULL),
  (@mandant,'2960','Gewinnvortrag / Verlustvortrag','passiv',NULL),
  (@mandant,'2979','Jahresgewinn / Jahresverlust','passiv',NULL),
  -- Betriebsertrag
  (@mandant,'3000','Dienstleistungsertrag','ertrag','U81'),
  (@mandant,'3400','Erlösminderungen','ertrag',NULL),
  -- Materialaufwand
  (@mandant,'4200','Materialaufwand','aufwand','M81'),
  -- Personalaufwand
  (@mandant,'5000','Lohnaufwand','aufwand',NULL),
  (@mandant,'5700','Sozialversicherungsaufwand (AHV/IV/EO/ALV)','aufwand',NULL),
  (@mandant,'5720','Pensionskassenaufwand (BVG)','aufwand',NULL),
  (@mandant,'5730','UVG / UVGZ Aufwand','aufwand',NULL),
  (@mandant,'5800','Übriger Personalaufwand','aufwand',NULL),
  -- Sonstiger Betriebsaufwand
  (@mandant,'6000','Raumaufwand','aufwand','M81'),
  (@mandant,'6100','Unterhalt, Reparaturen','aufwand','M81'),
  (@mandant,'6200','Fahrzeug- und Transportaufwand','aufwand','M81'),
  (@mandant,'6210','Energieaufwand','aufwand','M81'),
  (@mandant,'6300','Versicherungsaufwand','aufwand',NULL),
  (@mandant,'6400','Verwaltungsaufwand','aufwand','M81'),
  (@mandant,'6500','IT-Infrastruktur','aufwand','M81'),
  (@mandant,'6510','Büromaschinen, Mobiliar','aufwand','M81'),
  (@mandant,'6600','Büromaterial','aufwand','M26'),
  (@mandant,'6640','Reisekosten','aufwand',NULL),
  (@mandant,'6700','Werbeaufwand','aufwand','M81'),
  (@mandant,'6800','Beratungsaufwand','aufwand','M81'),
  (@mandant,'6900','Abschreibungen','aufwand',NULL),
  -- Finanzertrag / -aufwand
  (@mandant,'7000','Finanzertrag','ertrag',NULL),
  (@mandant,'7100','Finanzaufwand','aufwand',NULL),
  -- Betriebsfremdes / Ausserordentliches
  (@mandant,'8000','Betriebsfremder Ertrag','ertrag',NULL),
  (@mandant,'8100','Betriebsfremder Aufwand','aufwand',NULL),
  (@mandant,'8900','Direkte Steuern','aufwand',NULL),
  -- Abschlusskonten
  (@mandant,'9000','Eröffnungsbilanz','abschluss',NULL),
  (@mandant,'9100','Schlussbilanz','abschluss',NULL),
  (@mandant,'9200','Erfolgsrechnung','abschluss',NULL);
