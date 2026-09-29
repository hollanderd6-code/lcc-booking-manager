'use strict';
/**
 * INTL-OWNER-INVOICE-IMPORT-CURRENCY
 *
 * Vérifie les correctifs multi-devise introduits dans IOS-OWNER-INVOICES-MULTICURRENCY-1C :
 *
 * A — invoice-summary bucketing par (platform, currency)           CURR-A-01 à CURR-A-06
 * B — POST /api/owner-invoices — validation currency des articles  CURR-B-01 à CURR-B-05
 * C — PUT /api/owner-invoices/:id — immutabilité de la devise      CURR-C-01 à CURR-C-04
 * D — clients.html — transport de devise dans l'import             CURR-D-01 à CURR-D-05
 * E — fmtImportAmount — formateur côté client                      CURR-E-01 à CURR-E-03
 * F — factures-proprietaires.html — currency sur les lignes        CURR-F-01 à CURR-F-02
 * G — Régressions — gardes existants préservés                     CURR-G-01 à CURR-G-02
 */

const fs   = require('fs');
const path = require('path');

const serverSrc   = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const clientsHtml = fs.readFileSync(path.join(__dirname, '../public/clients.html'), 'utf8');
const facturesHtml = fs.readFileSync(path.join(__dirname, '../public/factures-proprietaires.html'), 'utf8');

// ── Extraire le bloc invoice-summary ─────────────────────────────────────────
const summaryIdx   = serverSrc.indexOf("app.get('/api/reservations/invoice-summary'");
const summaryBlock = summaryIdx !== -1 ? serverSrc.substring(summaryIdx, summaryIdx + 12000) : '';

// ── Extraire le bloc POST owner-invoices ─────────────────────────────────────
const postMatch = serverSrc.match(/app\.post\('\/api\/owner-invoices',[\s\S]+?client\.release\(\);\s*\}\s*\}\);/);
const postBlock = postMatch ? postMatch[0] : '';

// ── Extraire le bloc PUT owner-invoices/:id ───────────────────────────────────
const putMatch  = serverSrc.match(/app\.put\('\/api\/owner-invoices\/:id',[\s\S]+?client\.release\(\);\s*\}\s*\}\);/);
const putBlock  = putMatch ? putMatch[0] : '';

// ── A. invoice-summary — bucketing par (platform, devise) ────────────────────
describe('A. invoice-summary — bucketing (platform, currency)', () => {

  test('CURR-A-01 : bucketKey calculé à partir de la plateforme ET la devise', () => {
    // La clé de bucket doit être composite : `${platform}::${rowCurrency}`
    expect(summaryBlock).toMatch(/bucketKey\s*=\s*`\$\{platform\}::\$\{rowCurrency\}`/);
  });

  test('CURR-A-02 : rowCurrency normalisé via normalizeCurrency()', () => {
    expect(summaryBlock).toMatch(/normalizeCurrency\(row\.currency\)/);
  });

  test('CURR-A-03 : bucket initialisé avec un champ currency', () => {
    // Le bucket créé lors de la première résa doit inclure `currency: rowCurrency`
    expect(summaryBlock).toMatch(/currency:\s*rowCurrency/);
  });

  test('CURR-A-04 : bucket indexé par bucketKey (pas seulement platform)', () => {
    // byPlatform[bucketKey] doit être utilisé comme clé de bucket
    expect(summaryBlock).toMatch(/byPlatform\[bucketKey\]/);
  });

  test('CURR-A-05 : le champ currency est présent dans la réponse summary (via spread)', () => {
    // Le spread `...p` dans le .map() propage le champ currency du bucket
    expect(summaryBlock).toMatch(/\.\.\.p,/);
    // Et le bloc log confirme le nombre de buckets (pas de filtre qui supprimerait currency)
    expect(summaryBlock).toMatch(/summary\.length.*plateforme/);
  });

  test('CURR-A-06 : reservationsList inclut le champ currency', () => {
    // Les réservations individuelles doivent aussi exposer leur devise
    expect(summaryBlock).toMatch(/reservationsList\.push\([\s\S]{0,400}currency:\s*rowCurrency/);
  });
});

// ── B. POST /api/owner-invoices — validation currency des articles ────────────
describe('B. POST /api/owner-invoices — validation items[].currency', () => {

  test('CURR-B-01 : boucle vérifiant item.currency pour les articles non-débours', () => {
    expect(postBlock).toMatch(/item\.currency[\s\S]{0,100}!item\.isDebours|!item\.isDebours[\s\S]{0,100}item\.currency/);
  });

  test('CURR-B-02 : code erreur OWNER_INVOICE_ITEM_CURRENCY_MISMATCH retourné', () => {
    expect(postBlock).toMatch(/OWNER_INVOICE_ITEM_CURRENCY_MISMATCH/);
  });

  test('CURR-B-03 : normalizeCurrency appliqué à item.currency', () => {
    expect(postBlock).toMatch(/normalizeCurrency\(item\.currency\)/);
  });

  test('CURR-B-04 : la vérification compare itemCur à invoiceCurrency', () => {
    expect(postBlock).toMatch(/itemCur\s*!==\s*invoiceCurrency|invoiceCurrency\s*!==\s*itemCur/);
  });

  test('CURR-B-05 : la vérification item.currency précède BEGIN (hors transaction)', () => {
    const itemCurrIdx = postBlock.indexOf('OWNER_INVOICE_ITEM_CURRENCY_MISMATCH');
    const beginIdx    = postBlock.indexOf("client.query('BEGIN')");
    expect(itemCurrIdx).toBeGreaterThan(-1);
    expect(beginIdx).toBeGreaterThan(-1);
    expect(itemCurrIdx).toBeLessThan(beginIdx);
  });
});

// ── C. PUT /api/owner-invoices/:id — immutabilité de la devise ────────────────
describe('C. PUT /api/owner-invoices/:id — currency immutability', () => {

  test('CURR-C-01 : comparaison _putCtx.currency vs _storedInvoiceCurrency', () => {
    expect(putBlock).toMatch(/_putCtx\.currency\s*!==\s*_storedInvoiceCurrency/);
  });

  test('CURR-C-02 : code erreur OWNER_INVOICE_DRAFT_CURRENCY_CHANGE_REQUIRES_RECREATE retourné', () => {
    expect(putBlock).toMatch(/OWNER_INVOICE_DRAFT_CURRENCY_CHANGE_REQUIRES_RECREATE/);
  });

  test('CURR-C-03 : pas de SET currency = sur le brouillon dans le bloc propertyIds', () => {
    // La mise à jour silencieuse de la devise a été supprimée
    const propBlock = putBlock.match(/if \(Array\.isArray\(propertyIds\)\)[\s\S]+?(?=await client\.query\('DELETE FROM owner_invoice_properties)/)?.[0] || '';
    expect(propBlock).not.toMatch(/SET currency\s*=/);
    expect(propBlock).not.toMatch(/UPDATE owner_invoices SET currency/);
  });

  test('CURR-C-04 : ROLLBACK effectué avant le retour 400 de currency mismatch', () => {
    const mismatchIdx  = putBlock.indexOf('OWNER_INVOICE_DRAFT_CURRENCY_CHANGE_REQUIRES_RECREATE');
    // Look back 500 chars to clear the long error message string before the code line
    const rollbackText = putBlock.substring(Math.max(0, mismatchIdx - 500), mismatchIdx);
    expect(rollbackText).toMatch(/ROLLBACK/);
  });
});

// ── D. clients.html — transport de devise dans l'import ──────────────────────
describe('D. clients.html — import currency transport', () => {

  test('CURR-D-01 : initialisation _importResaChecked avec clé composite platform|currency', () => {
    expect(clientsHtml).toMatch(/\._importResaChecked\[p\.platform\s*\+\s*'[|]'\s*\+/);
  });

  test('CURR-D-02 : renderImportResaSummary utilise bk (clé composite) pour la checkbox', () => {
    // La variable bk doit être définie avec la clé composite
    expect(clientsHtml).toMatch(/var bk\s*=\s*p\.platform\s*\+\s*'[|]'\s*\+/);
    // Et utilisée comme clé dans _importResaChecked
    expect(clientsHtml).toMatch(/_importResaChecked\[bk\]/);
  });

  test('CURR-D-03 : confirmImportReservations ajoute currency au prestation', () => {
    // Le push dans prestations doit inclure currency: p.currency
    const confirmIdx   = clientsHtml.indexOf('window.confirmImportReservations');
    const confirmBlock = clientsHtml.substring(confirmIdx, confirmIdx + 2600);
    expect(confirmBlock).toMatch(/currency:\s*p\.currency/);
  });

  test('CURR-D-04 : guard anti-devises-mixtes dans confirmImportReservations', () => {
    const confirmIdx   = clientsHtml.indexOf('window.confirmImportReservations');
    const confirmBlock = clientsHtml.substring(confirmIdx, confirmIdx + 2000);
    expect(confirmBlock).toMatch(/selectedCurrencies/);
    expect(confirmBlock).toMatch(/selectedCurrencies\.length\s*>\s*1/);
    expect(confirmBlock).toMatch(/return/);
  });

  test('CURR-D-05 : updateImportResaTotal détecte les devises mixtes et désactive le bouton', () => {
    const totalIdx   = clientsHtml.indexOf('window.updateImportResaTotal');
    const totalBlock = clientsHtml.substring(totalIdx, totalIdx + 1500);
    expect(totalBlock).toMatch(/selectedCurrencies\.length\s*>\s*1/);
    expect(totalBlock).toMatch(/btn\.disabled\s*=\s*true/);
  });
});

// ── E. fmtImportAmount — formateur montant client ────────────────────────────
describe('E. fmtImportAmount — currency-aware formatter', () => {

  test('CURR-E-01 : fmtImportAmount définie dans clients.html', () => {
    expect(clientsHtml).toMatch(/function fmtImportAmount\(/);
  });

  test('CURR-E-02 : utilise Intl.NumberFormat avec style currency', () => {
    const fmtIdx   = clientsHtml.indexOf('function fmtImportAmount(');
    const fmtBlock = clientsHtml.substring(fmtIdx, fmtIdx + 400);
    expect(fmtBlock).toMatch(/Intl\.NumberFormat/);
    expect(fmtBlock).toMatch(/style:\s*'currency'/);
  });

  test('CURR-E-03 : fmtImportAmount ne contient pas le symbole € codé en dur', () => {
    const fmtIdx   = clientsHtml.indexOf('function fmtImportAmount(');
    const fmtBlock = clientsHtml.substring(fmtIdx, fmtIdx + 400);
    // Le symbole ne doit pas être hardcodé comme € ni comme €
    expect(fmtBlock).not.toMatch(/\\u20ac|" €"|' €'|`€`/);
  });
});

// ── F. factures-proprietaires.html — currency sur les lignes ─────────────────
describe('F. factures-proprietaires.html — currency passthrough', () => {

  test('CURR-F-01 : items map inclut currency de la prestation', () => {
    const createIdx   = facturesHtml.indexOf('window.createInvoice');
    const createBlock = facturesHtml.substring(createIdx, createIdx + 2000);
    expect(createBlock).toMatch(/currency:\s*p\.currency/);
  });

  test('CURR-F-02 : currency est conditionnel (seulement si présent)', () => {
    const createIdx   = facturesHtml.indexOf('window.createInvoice');
    const createBlock = facturesHtml.substring(createIdx, createIdx + 2000);
    // Le spread conditionnel `...(p.currency ? { currency: p.currency } : {})` ou similaire
    expect(createBlock).toMatch(/p\.currency\s*\?.*currency.*p\.currency|\.\.\..*p\.currency/s);
  });
});

// ── G. Régressions — gardes existants préservés ──────────────────────────────
describe('G. Régressions — gardes INTL-DEBOUR préservés', () => {

  test('CURR-G-01 : garde INTL-DEBOUR toujours présent dans POST owner-invoices', () => {
    expect(postBlock).toMatch(/INTL-DEBOUR/);
    expect(postBlock).toMatch(/Le débours est en/);
  });

  test('CURR-G-02 : garde INTL-DEBOUR toujours présent dans PUT owner-invoices', () => {
    expect(putBlock).toMatch(/INTL-DEBOUR/);
    expect(putBlock).toMatch(/Le débours est en/);
  });
});
