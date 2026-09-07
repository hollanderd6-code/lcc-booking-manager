# Dette technique — numérotation des factures

## Problème

`getNextInvoiceNumber` (server.js ligne 6325) calcule le prochain numéro avec un
`MAX()` sur deux tables (`invoice_download_tokens` et `owner_invoices`), sans
séquence PostgreSQL ni verrou natif.

```sql
SELECT MAX(CAST(SPLIT_PART(invoice_number, '-', 3) AS INTEGER))
FROM ( SELECT ... FROM invoice_download_tokens ... UNION ALL
       SELECT ... FROM owner_invoices ... ) t
```

Deux appels concurrents qui lisent le même MAX() avant qu'un commit ait eu lieu
produiront le même numéro — doublon de numérotation, problème comptable.

## Contournement en place

`POST /api/invoice/send-to-conversation` (ajouté 2026-09-07) enveloppe l'appel
dans une transaction PostgreSQL avec un advisory lock de session :

```sql
SELECT pg_advisory_xact_lock(1001, hashtext($userId))
```

Namespace 1001 = numérotation factures. Le lock est libéré automatiquement au
COMMIT/ROLLBACK. Cela sérialise les générations concurrentes **par compte
utilisateur**, sans toucher au schéma.

Le cron `runInvoiceQueue` n'est pas protégé de la même façon — il tourne en
arrière-plan sans concurrent naturel, mais reste vulnérable si déclenché
manuellement en parallèle via `/api/test/invoice-cron`.

## Solution définitive recommandée

Remplacer le MAX() par une séquence PostgreSQL par compte et par année :

```sql
CREATE SEQUENCE IF NOT EXISTS invoice_seq_{userId}_{year} START 1;
SELECT nextval('invoice_seq_{userId}_{year}');
```

Ou, plus proprement, une table `invoice_counters (user_id, year, last_seq)` avec
un `UPDATE ... RETURNING` dans une transaction, ce qui évite la prolifération de
séquences nommées dynamiquement.

## Impact si non traité

Doublon de numéro de facture possible si :
- le cron de 10h tourne pendant qu'un utilisateur appuie sur le bouton iOS, ou
- deux appels simultanés à `/api/invoice/send-to-conversation` depuis des comptes
  différents (pas de collision inter-comptes grâce au hashtext, mais vulnérable
  à l'intra-compte si l'advisory lock n'est pas appliqué partout).
