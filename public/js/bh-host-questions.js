/* ════════════════════════════════════════════════════════════════
   bh-host-questions.js
   Modal "Question d'un voyageur" (IA → hôte, réponse en 1 clic).
   Chargé par les pages qui n'ont pas la copie inline (ex. messages.html)
   pour que l'hôte voie la question même en arrivant via une notif de message.
   Le statut étant géré côté serveur, répondre sur n'importe quelle page
   fait disparaître la question partout au prochain polling.
   ════════════════════════════════════════════════════════════════ */
(function () {
  if (window.__bhHostQInit) return;   // évite un double polling si déjà initialisé (ex. page avec copie inline)
  window.__bhHostQInit = true;

  let _bhHostQPollTimer = null;
  let _bhHostQCurrentId = null;

  function _bhStartHostQuestionPolling() {
    if (_bhHostQPollTimer) return;
    _bhHostQPollTimer = setInterval(_bhCheckHostQuestions, 10000);
    _bhCheckHostQuestions();
  }

  async function _bhCheckHostQuestions() {
    try {
      const token = localStorage.getItem('lcc_token');
      if (!token) return;
      const res = await fetch('/api/host-questions/pending', {
        headers: { Authorization: 'Bearer ' + token }
      });
      if (!res.ok) return;
      const data = await res.json();
      const q = (data.questions || [])[0];
      if (q && q.id !== _bhHostQCurrentId && !document.getElementById('bhHostQModal')) {
        _bhHostQCurrentId = q.id;
        _bhShowHostQuestionModal(q);
      }
    } catch (e) { /* silencieux */ }
  }

  function _bhShowHostQuestionModal(q) {
    let modal = document.getElementById('bhHostQModal');
    if (modal) modal.remove();

    modal = document.createElement('div');
    modal.id = 'bhHostQModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:99999;padding:20px;';

    // ── Bloc contexte séjour : logement, dates, occupation avant/après ──
    // (utile pour juger une arrivée anticipée / un départ tardif)
    const _fmtD = (d) => { try { return d ? new Date(d).toLocaleDateString('fr-FR', { day:'numeric', month:'short' }) : null; } catch(e){ return null; } };
    const _dPart = (d) => { try { return d ? new Date(d).toISOString().split('T')[0] : null; } catch(e){ return null; } };
    const _meta = q.meta || {};
    const _ci = _dPart(q.stay_checkin || _meta.checkin);
    const _co = _dPart(q.stay_checkout || _meta.checkout);
    const _prevCo = _dPart(q.prev_checkout);
    const _nextCi = _dPart(q.next_checkin);
    // occupé avant = résa précédente qui finit le jour de l'arrivée (enchaînement)
    let _occBefore = (_prevCo && _ci) ? (_prevCo === _ci) : null;
    let _occAfter  = (_nextCi && _co) ? (_nextCi === _co) : null;
    // fallback meta (free_before / free_after) si l'API n'a pas de dates voisines
    if (_occBefore === null && typeof _meta.free_before === 'boolean') _occBefore = !_meta.free_before;
    if (_occAfter  === null && typeof _meta.free_after  === 'boolean') _occAfter  = !_meta.free_after;
    const _propName = q.property_name || _meta.property_name || null;
    const _ciF = _fmtD(q.stay_checkin || _meta.checkin);
    const _coF = _fmtD(q.stay_checkout || _meta.checkout);
    const _rows = [];
    if (_propName) _rows.push(`<div style="display:flex;align-items:center;gap:7px;"><span>🏠</span><strong style="color:#1f2937;">${_propName}</strong></div>`);
    if (_ciF && _coF) _rows.push(`<div style="display:flex;align-items:center;gap:7px;"><span>📅</span><span>${_ciF} → ${_coF}</span></div>`);
    if (_occBefore !== null) _rows.push(_occBefore
      ? `<div style="display:flex;align-items:center;gap:7px;color:#B45309;"><span>🔴</span><span>Loué la veille — départ le jour de l'arrivée</span></div>`
      : `<div style="display:flex;align-items:center;gap:7px;color:#1A7A5E;"><span>🟢</span><span>Libre la veille de l'arrivée</span></div>`);
    if (_occAfter !== null) _rows.push(_occAfter
      ? `<div style="display:flex;align-items:center;gap:7px;color:#B45309;"><span>🔴</span><span>Reloué le jour du départ</span></div>`
      : `<div style="display:flex;align-items:center;gap:7px;color:#1A7A5E;"><span>🟢</span><span>Libre le jour du départ</span></div>`);
    const infoHtml = _rows.length
      ? `<div style="background:#F0F4F2;border-radius:10px;padding:11px 14px;margin-bottom:14px;font-size:12.5px;line-height:1.7;color:#374151;">${_rows.join('')}</div>`
      : '';

    modal.innerHTML = `
      <div style="background:white;border-radius:16px;padding:26px;max-width:400px;width:100%;box-shadow:0 24px 70px rgba(0,0,0,.25);">
        <div style="font-size:34px;text-align:center;margin-bottom:10px;">❓</div>
        <div style="font-weight:700;font-size:16px;text-align:center;margin-bottom:4px;color:#1a1a1a;">Question d'un voyageur</div>
        <div style="font-size:12px;color:#999;text-align:center;margin-bottom:14px;">${q.guest_name || 'Voyageur'}</div>
        ${infoHtml}
        <div style="font-size:15px;color:#333;line-height:1.5;background:#F5F2EC;border-radius:10px;padding:14px 16px;margin-bottom:18px;text-align:center;">${q.question}</div>
        <div style="display:flex;gap:10px;margin-bottom:10px;">
          <button id="bhHQNo" style="flex:1;padding:13px;border-radius:10px;border:1px solid #FCA5A5;background:#FEF2F2;color:#DC2626;font-weight:700;font-size:15px;cursor:pointer;">Non</button>
          <button id="bhHQYes" style="flex:1;padding:13px;border-radius:10px;border:none;background:#1A7A5E;color:white;font-weight:700;font-size:15px;cursor:pointer;">Oui</button>
        </div>
        <div id="bhHQTextWrap" style="display:none;margin-bottom:10px;">
          <textarea id="bhHQText" rows="2" placeholder="Précision (optionnel)…" style="width:100%;padding:10px 12px;border:1px solid #e5e7eb;border-radius:10px;font-size:13px;font-family:inherit;box-sizing:border-box;resize:vertical;"></textarea>
          <button id="bhHQSendText" style="width:100%;margin-top:8px;padding:11px;border-radius:10px;border:none;background:#2C3E35;color:white;font-weight:600;font-size:14px;cursor:pointer;">Envoyer cette précision au voyageur</button>
        </div>
        <button id="bhHQSelf" style="width:100%;padding:11px;border-radius:10px;border:1px solid #e0e0e0;background:white;color:#555;font-weight:600;font-size:13px;cursor:pointer;">Je réponds moi-même</button>
        <div style="font-size:11px;color:#aaa;text-align:center;margin-top:12px;">L'IA transmettra votre réponse au voyageur dans sa langue.</div>
      </div>`;
    document.body.appendChild(modal);

    const text = () => (document.getElementById('bhHQText')?.value || '').trim();
    document.getElementById('bhHQYes').onclick = () => _bhAnswerHostQuestion(q.id, 'yes', text());
    document.getElementById('bhHQNo').onclick  = () => {
      const wrap = document.getElementById('bhHQTextWrap');
      if (wrap.style.display === 'none') {
        wrap.style.display = 'block';
        document.getElementById('bhHQSendText').onclick = () => _bhAnswerHostQuestion(q.id, 'no', text());
        document.getElementById('bhHQNo').textContent = 'Non, sans précision';
        document.getElementById('bhHQNo').onclick = () => _bhAnswerHostQuestion(q.id, 'no', '');
      }
    };
    document.getElementById('bhHQSelf').onclick = () => _bhAnswerHostQuestion(q.id, 'self', '');
  }

  async function _bhAnswerHostQuestion(questionId, answer, text) {
    const modal = document.getElementById('bhHostQModal');
    try {
      const token = localStorage.getItem('lcc_token');
      await fetch(`/api/host-questions/${questionId}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ answer, text: text || '' })
      });
      if (answer === 'self' && typeof window.showBHToast === 'function') {
        window.showBHToast('À vous de répondre dans la conversation 💬', 'info');
      } else if (typeof window.showBHToast === 'function') {
        window.showBHToast('Réponse transmise au voyageur ✅', 'success');
      }
    } catch (e) { /* la question reste pending si échec, repoll plus tard */ }
    _bhHostQCurrentId = null;
    if (modal) modal.remove();
  }

  // Démarrage : le modal a besoin de document.body, donc on attend le DOM si nécessaire.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _bhStartHostQuestionPolling);
  } else {
    _bhStartHostQuestionPolling();
  }
})();
