#!/usr/bin/env node
/* ============================================================
   outils/premier-jour.js
   L'ecran d'un compte vide — etat 2a de la maquette
   ============================================================
   Cibles : public/js/bh-premier-jour.js (nouveau)
            public/app.html (une balise <script>)

   ── LE CONSTAT ──────────────────────────────────────────────────
   Des gens s'inscrivent, disposent de quatorze jours, et ne prennent
   pas d'abonnement. Personne ne sait ou ils s'arretent : aucun contact
   n'a jamais ete pris avec eux, et le produit ne mesure rien.

   Ce qu'on sait, en revanche : leur premier ecran est un tableau de
   bord concu pour un compte rempli. Sept entrees de menu, des cartes de
   statistiques a zero, une liste de reservations vide. Rien n'indique
   par ou commencer.

   ── CE QUE FAIT CE CORRECTIF ────────────────────────────────────
   Quand le compte ne contient AUCUN logement, le tableau de bord
   s'efface et laisse une seule chose a faire, chiffree en minutes :
   brancher une annonce. Plus un rappel de ce qui suivra — un essai sans
   horizon ne donne pas envie de continuer.

   Des qu'un logement existe, le module ne fait rien : le tableau de
   bord reprend sa place, inchange.

   ── POURQUOI UN MODULE SEPARE ───────────────────────────────────
   public/app.html fait 756 Ko. Y operer pour un ecran conditionnel
   serait risque et illisible. Le module s'ajoute par une balise, ne
   modifie aucune ligne existante, et se retire en supprimant cette
   balise — l'application revient exactement a son etat d'avant.

   ── PRUDENCE ────────────────────────────────────────────────────
   · Il ne s'active que sur une reponse VALIDE de /api/properties avec
     un tableau vide. Une erreur reseau, un 401, une reponse illisible :
     il s'abstient. Masquer un tableau de bord qui fonctionne serait
     bien pire que de ne rien faire.
   · Il masque les elements (display:none) au lieu de les supprimer, et
     les marque d'un attribut : l'etat d'origine reste recuperable.
   · Il reutilise openAddPropertyModal si elle existe — le parcours
     d'ajout n'est pas reecrit.
   · API_URL n'etant pas globale sur toutes les pages (le pont Hosterzz
     en a fait les frais), le module se donne un repli explicite.

   Usage :
     node outils/premier-jour.js --essai
     node outils/premier-jour.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const MODULE_PATH = path.join(process.cwd(), 'public', 'js', 'bh-premier-jour.js');
const APP = path.join(process.cwd(), 'public', 'app.html');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

if (!fs.existsSync(APP)) echec('public/app.html introuvable. Lancez depuis la racine du projet.');
let app = fs.readFileSync(APP, 'utf8');

if (app.indexOf('bh-premier-jour.js') !== -1) {
  console.log('\n  Le module est deja installe — rien a faire.\n');
  process.exit(0);
}

const MODULE = "/* ============================================================================\n   BH-PREMIER-JOUR — l'ecran d'un compte vide\n   ============================================================================\n   INSTALLATION — dans public/app.html, avant </body> :\n\n     <script src=\"/js/bh-premier-jour.js\"></script>\n\n   POURQUOI\n   Un nouvel inscrit arrive sur un tableau de bord concu pour un compte\n   rempli : sept entrees de menu, des cartes de statistiques a zero, une\n   liste de reservations vide. Rien ne lui dit par ou commencer, et les\n   quatorze jours d'essai passent.\n\n   Ce module ne s'active que si le compte ne contient AUCUN logement —\n   le seul etat ou l'on est certain qu'il n'y a rien a montrer. Des qu'un\n   logement existe, il s'efface et le tableau de bord reprend sa place.\n\n   Il n'ecrit rien, ne modifie aucune donnee, et ne touche pas au code\n   existant : il masque les enfants du conteneur de page et pose son\n   propre ecran. Retirer la balise <script> annule tout.\n   ========================================================================== */\n(function () {\n  'use strict';\n\n  var V = {\n    vert: '#0E3B2E', vertFonce: '#0A2C22', vertPale: '#F1F6F3', vertFilet: '#A8CDBE',\n    encre: '#20221F', t2: '#5A5A54', t3: '#6A6A64', ligne: '#E8E6E0',\n    or: '#916018', creme: '#F4F1E9',\n    serif: \"'Instrument Serif',Georgia,serif\",\n    sans: \"'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif\"\n  };\n\n  function jeton() { try { return localStorage.getItem('lcc_token'); } catch (e) { return null; } }\n\n  /* API_URL est declaree dans un autre bloc <script> selon les pages et\n     n'est pas toujours globale — le pont Hosterzz en a fait les frais.\n     On se donne donc un repli explicite. */\n  function base() {\n    if (typeof window.API_URL === 'string' && window.API_URL) return window.API_URL;\n    try { if (typeof API_URL === 'string' && API_URL) return API_URL; } catch (e) {}\n    return '';\n  }\n\n  function prenom() {\n    try {\n      var u = JSON.parse(localStorage.getItem('lcc_user') || '{}');\n      var n = (u.firstName || u.first_name || u.company || '').trim();\n      return n ? n.split(/\\s+/)[0] : '';\n    } catch (e) { return ''; }\n  }\n\n  function conteneur() {\n    return document.querySelector('.page-content')\n        || document.querySelector('main.main-content')\n        || document.querySelector('main');\n  }\n\n  function ecran(nom) {\n    var salut = nom ? 'Bonjour ' + nom + '.' : 'Bienvenue.';\n    return '' +\n      '<div id=\"bhPremierJour\" style=\"max-width:520px;margin:32px auto 60px;font-family:' + V.sans + ';\">' +\n\n        '<div style=\"background:' + V.vert + ';border-radius:18px;overflow:hidden;box-shadow:0 3px 20px rgba(32,34,31,.10);\">' +\n          '<div style=\"padding:34px 32px 30px;text-align:center;\">' +\n            '<div style=\"font-family:' + V.serif + ';font-size:30px;color:#fff;line-height:1.2;\">' + salut + '</div>' +\n            '<div style=\"font-size:14.5px;color:#C6DDD2;margin-top:11px;line-height:1.6;max-width:340px;margin-left:auto;margin-right:auto;\">' +\n              'Une seule chose \\u00e0 faire pour commencer : brancher une annonce. ' +\n              'Vos r\\u00e9servations, vos messages et votre m\\u00e9nage suivront tout seuls.' +\n            '</div>' +\n          '</div>' +\n          '<div style=\"background:#fff;padding:24px 28px 26px;display:flex;flex-direction:column;gap:16px;\">' +\n            '<div style=\"display:flex;gap:14px;align-items:center;\">' +\n              '<span style=\"width:38px;height:38px;border-radius:11px;background:' + V.vertPale + ';border:1px solid ' + V.vertFilet + ';' +\n                'display:flex;align-items:center;justify-content:center;flex:none;font-size:15px;color:' + V.vert + ';\">' +\n                '<i class=\"fas fa-home\"></i></span>' +\n              '<span style=\"flex:1;\">' +\n                '<span style=\"display:block;font-size:15px;font-weight:600;color:' + V.encre + ';\">Brancher mon premier logement</span>' +\n                '<span style=\"display:block;font-size:13px;color:' + V.t3 + ';margin-top:2px;\">Environ 8 minutes \\u00b7 vous pouvez vous arr\\u00eater en route</span>' +\n              '</span>' +\n            '</div>' +\n            '<button type=\"button\" id=\"bhPjStart\" style=\"width:100%;border:0;background:' + V.vert + ';color:#fff;' +\n              'font-family:inherit;font-size:15px;font-weight:600;padding:14px;border-radius:11px;cursor:pointer;\">Commencer</button>' +\n            '<div style=\"text-align:center;font-size:12.5px;color:' + V.t3 + ';\">' +\n              'Pas envie maintenant&nbsp;? <a href=\"/help.html\" style=\"color:' + V.vert + ';text-decoration:none;border-bottom:1px solid rgba(14,59,46,.3);\">Nous \\u00e9crire</a>' +\n            '</div>' +\n          '</div>' +\n        '</div>' +\n\n        /* Ce qui viendra ensuite. Non pas pour occuper l'ecran, mais parce\n           qu'un essai sans horizon ne donne pas envie de continuer. */\n        '<div style=\"margin-top:22px;background:' + V.creme + ';border-radius:14px;padding:18px 20px;\">' +\n          '<div style=\"font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:' + V.or + ';\">Une fois branch\\u00e9</div>' +\n          '<div style=\"margin-top:12px;display:flex;flex-direction:column;gap:9px;\">' +\n            ligneSuite('Vos r\\u00e9servations arrivent seules') +\n            ligneSuite('Les voyageurs re\\u00e7oivent leurs informations sans vous') +\n            ligneSuite('Le m\\u00e9nage est planifi\\u00e9 \\u00e0 chaque d\\u00e9part') +\n          '</div>' +\n        '</div>' +\n\n      '</div>';\n  }\n\n  function ligneSuite(t) {\n    return '<div style=\"display:flex;gap:10px;align-items:flex-start;font-size:13.5px;color:' + V.t2 + ';line-height:1.5;\">' +\n      '<span style=\"color:' + V.vertFilet + ';flex:none;margin-top:1px;\">\\u2014</span><span>' + t + '</span></div>';\n  }\n\n  function demarrer() {\n    /* Le parcours d'ajout existe deja : on l'appelle, on ne le refait pas. */\n    if (typeof window.openAddPropertyModal === 'function') { window.openAddPropertyModal(); return; }\n    window.location.href = '/settings.html#logements';\n  }\n\n  async function init() {\n    if (!jeton()) return;\n    var boite = conteneur();\n    if (!boite || document.getElementById('bhPremierJour')) return;\n\n    var liste;\n    try {\n      var r = await fetch(base() + '/api/properties', { headers: { Authorization: 'Bearer ' + jeton() } });\n      if (!r.ok) return;                       // en cas de doute, on ne touche a rien\n      var d = await r.json();\n      liste = d.properties || d || [];\n    } catch (e) { return; }\n    if (!Array.isArray(liste) || liste.length > 0) return;   // le compte n'est pas vide\n\n    /* On masque, on ne supprime pas : si quoi que ce soit se passe mal,\n       l'etat d'origine est recuperable en retirant l'attribut. */\n    [].forEach.call(boite.children, function (el) {\n      el.setAttribute('data-bh-pj-masque', '1');\n      el.style.display = 'none';\n    });\n\n    var bloc = document.createElement('div');\n    bloc.innerHTML = ecran(prenom());\n    boite.insertBefore(bloc.firstChild, boite.firstChild);\n\n    var b = document.getElementById('bhPjStart');\n    if (b) b.addEventListener('click', demarrer);\n  }\n\n  /* Le tableau de bord se remplit apres coup : on attend qu'il ait fini\n     plutot que de courir contre lui. */\n  if (document.readyState === 'loading') {\n    document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 400); });\n  } else {\n    setTimeout(init, 400);\n  }\n})();\n";

/* Le module doit etre du JavaScript valide avant d'etre pose. */
try { new Function(MODULE); }
catch (e) { echec('Le module genere est invalide — ' + e.message); }

const BALISE = '  <script src="/js/bh-premier-jour.js"></scr' + 'ipt>\n';
const n = app.split('</body>').length - 1;
if (n !== 1) echec('public/app.html contient ' + n + ' balise(s) </body> au lieu d\'une.');
app = app.replace('</body>', BALISE + '</body>');

/* ---- Verifications ---- */
if (app.indexOf('bh-premier-jour.js') === -1) echec("La balise n'a pas ete inseree.");
if (app.split('</body>').length - 1 !== 1) echec('Le nombre de </body> a change.');
if (app.indexOf(BALISE + '</body>') === -1) echec('La balise n\'est pas juste avant </body>.');

for (const [quoi, aiguille] of [
  ['la garde sur compte vide', 'liste.length > 0'],
  ['le repli API_URL', 'function base()'],
  ['la reutilisation du parcours', 'openAddPropertyModal'],
  ['le masquage reversible', 'data-bh-pj-masque'],
]) if (MODULE.indexOf(aiguille) === -1) echec('Verification : ' + quoi + ' est absent du module.');

if (!ESSAI) {
  fs.mkdirSync(path.dirname(MODULE_PATH), { recursive: true });
  fs.writeFileSync(MODULE_PATH, MODULE, 'utf8');
  fs.writeFileSync(APP, app, 'utf8');
  if (!fs.existsSync(MODULE_PATH)) echec('Le module est absent apres ecriture.');
  if (fs.readFileSync(APP, 'utf8').indexOf('bh-premier-jour.js') === -1) echec('La balise est absente apres ecriture.');
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  public/js/bh-premier-jour.js   ' + MODULE.length + ' caracteres');
console.log('  public/app.html                une balise <script> avant </body>');
console.log('');
console.log('  Ensuite : \u2318\u21e7R sur le tableau de bord.');
console.log('');
console.log('  Pour le voir : il faut un compte SANS aucun logement. Sur un');
console.log('  compte rempli, le module ne fait rien — c\'est voulu.');
console.log('  Creez un compte d\'essai pour verifier ce que voient vos inscrits :');
console.log('  c\'est la premiere fois que vous verrez votre produit comme eux.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
