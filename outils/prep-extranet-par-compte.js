#!/usr/bin/env node
/* ============================================================
   outils/prep-extranet-par-compte.js
   La case « extranet autorisé » était partagée entre tous les comptes
   ============================================================
   Cible : public/js/bh-ota-connect.js

   L'étape « Autoriser la connexion chez Booking.com » se fait une fois
   par COMPTE BOOKING, et le fait qu'elle soit faite est retenu dans
   localStorage sous une clé fixe : bh_bdc_extranet_ok.

   Une clé fixe, sur un navigateur partagé, ment :

     — une AGENCE gère dix clients depuis le même navigateur. Elle coche
       la case pour le premier ; les neuf autres n'auront jamais l'écran,
       alors que chacun doit autoriser la connexion dans SON extranet.
       Ils arrivent devant une fenêtre partenaire qui refuse, sans
       explication ;
     — deux utilisateurs sur le même poste héritent l'un de l'autre.

   La clé porte désormais l'identifiant du compte concerné. Chaque compte
   retrouve son propre état, et l'ancienne valeur est conservée pour le
   compte courant afin de ne pas redemander l'étape à qui l'a déjà faite.

   Usage :
     node outils/prep-extranet-par-compte.js --essai
     node outils/prep-extranet-par-compte.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'public', 'js', 'bh-ota-connect.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

if (!fs.existsSync(CIBLE)) {
  console.error('\n  \u2717 public/js/bh-ota-connect.js introuvable. Lancez depuis la racine.\n');
  process.exit(1);
}

let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('clePrep()') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

const ANCIEN = `  var CLE_PREP = 'bh_bdc_extranet_ok';

  function prepFaite() { try { return localStorage.getItem(CLE_PREP) === '1'; } catch (e) { return false; } }
  function marquerPrep(v) { try { v ? localStorage.setItem(CLE_PREP, '1') : localStorage.removeItem(CLE_PREP); } catch (e) {} }`;

const NOUVEAU = `  var CLE_PREP = 'bh_bdc_extranet_ok';

  /* L'autorisation se donne dans l'extranet d'UN compte Booking. La retenir
     sous une cle fixe ferait croire a une agence, ou a un second utilisateur
     du meme navigateur, que l'etape est faite alors qu'elle ne l'est pas
     pour eux. La cle porte donc l'identifiant du compte. */
  function compteCourant() {
    try {
      var gere = localStorage.getItem('lcc_managed_user');
      if (gere) return 'u:' + gere;
      var sous = JSON.parse(localStorage.getItem('lcc_sub_account') || '{}');
      if (sous && sous.id) return 's:' + sous.id;
      var u = JSON.parse(localStorage.getItem('lcc_user') || '{}');
      if (u && (u.id || u.email)) return 'u:' + (u.id || u.email);
    } catch (e) {}
    return 'anon';
  }

  function clePrep() { return CLE_PREP + ':' + compteCourant(); }

  function prepFaite() {
    try {
      if (localStorage.getItem(clePrep()) === '1') return true;
      /* Reprise de l'ancienne cle globale, une seule fois et pour le compte
         courant seulement : celui qui a deja fait l'etape ne la refait pas. */
      if (localStorage.getItem(CLE_PREP) === '1') {
        localStorage.setItem(clePrep(), '1');
        localStorage.removeItem(CLE_PREP);
        return true;
      }
    } catch (e) {}
    return false;
  }

  function marquerPrep(v) {
    try { v ? localStorage.setItem(clePrep(), '1') : localStorage.removeItem(clePrep()); } catch (e) {}
  }`;

const n = src.split(ANCIEN).length - 1;
if (n !== 1) {
  console.error('\n  \u2717 ' + n + ' occurrence(s) du bloc attendu, 1 requise.');
  console.error('    Le fichier a change. Rien n\'a ete ecrit.\n');
  process.exit(1);
}

src = src.split(ANCIEN).join(NOUVEAU);

try {
  new Function(src);
} catch (e) {
  console.error('\n  \u2717 Le resultat n\'est pas du JavaScript valide : ' + e.message);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

if (!ESSAI) fs.writeFileSync(CIBLE, src, 'utf8');

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE —'));
console.log('  La case « extranet autorise » est desormais propre a chaque compte.');
console.log('  L\'ancienne valeur est reprise pour le compte courant.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');
