const SmartLockAdapter = require('./base-adapter');

const AUTH_URL = 'https://auth.igloohome.co/oauth2/token';
const BASE_URL = 'https://api.igloodeveloper.co/igloohome';
const SCOPES = 'igloohomeapi/algopin-hourly igloohomeapi/algopin-daily igloohomeapi/algopin-permanent igloohomeapi/algopin-onetime igloohomeapi/get-devices igloohomeapi/unlock-bridge-proxied-job igloohomeapi/lock-bridge-proxied-job igloohomeapi/create-pin-bridge-proxied-job igloohomeapi/delete-pin-bridge-proxied-job igloohomeapi/get-job-status igloohomeapi/get-properties';

class IgloohomeAdapter extends SmartLockAdapter {
  constructor(connection, pool) {
    super(connection, pool);
  }

  async authenticate() {
    // Igloohome utilise client_credentials OAuth2 avec HTTP Basic Auth
    const { clientId, clientSecret } = this.credentials;
    if (!clientId || !clientSecret) throw new Error('Igloohome: clientId et clientSecret requis');

    // Vérifier si le token est encore valide
    if (this.credentials.accessToken && this.credentials.expiresAt) {
      if (Date.now() < this.credentials.expiresAt - 60000) {
        return this.credentials.accessToken;
      }
    }

    const fetch = (await import('node-fetch')).default;
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const res = await fetch(AUTH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        scope: SCOPES,
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`Igloohome auth failed (${res.status}): ${err.substring(0, 200)}`);
    }

    const data = await res.json();
    await this.saveCredentials({
      accessToken: data.access_token,
      expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    });

    return data.access_token;
  }

  async listLocks() {
    const token = await this.authenticate();
    const allDevices = [];
    let cursor = null;

    // Pagination avec nextCursor
    do {
      const url = cursor ? `${BASE_URL}/devices?cursor=${cursor}` : `${BASE_URL}/devices`;
      const data = await this.apiCall(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const devices = data.payload || data.results || data || [];
      if (Array.isArray(devices)) allDevices.push(...devices);
      cursor = data.nextCursor || null;
    } while (cursor);

    // Vérifier si des bridges existent dans le compte
    const bridges = allDevices.filter(d => d.type === 'Bridge');
    const hasBridgesInAccount = bridges.length > 0;

    // Collecter TOUS les deviceId reliés aux bridges (keypads + locks)
    const bridgeLinkedIds = new Set();
    for (const b of bridges) {
      (b.linkedDevices || []).forEach(ld => {
        if (ld.deviceId) bridgeLinkedIds.add(ld.deviceId);
      });
    }

    // Mapper chaque device à son bridge (pour les commandes à distance)
    const deviceToBridge = {};
    for (const b of bridges) {
      (b.linkedDevices || []).forEach(ld => {
        if (ld.deviceId) deviceToBridge[ld.deviceId] = b.deviceId;
      });
    }

    return allDevices.map(d => {
      const directlyLinked = bridgeLinkedIds.has(d.deviceId);
      const childLinked = (d.linkedDevices || []).some(ld => bridgeLinkedIds.has(ld.deviceId));
      const hasBridge = directlyLinked || childLinked || (hasBridgesInAccount && d.type === 'Lock');
      const bridgeDeviceId = deviceToBridge[d.deviceId] || (bridges[0]?.deviceId) || null;

      return {
        deviceId: d.deviceId || d.id,
        name: d.deviceName || d.name || 'Igloohome Lock',
        type: this._mapType(d.type),
        model: d.type || null,
        serialNumber: d.deviceId || null,
        battery: d.batteryLevel ?? null,
        isOnline: hasBridge,
        metadata: {
          apiId: d.id,
          hasBridge,
          bridgeDeviceId,
          homeId: d.homeId || [],
          raw: d,
        },
      };
    });
  }

  // ── Helper : formater date pour AlgoPIN (YYYY-MM-DDTHH:00:00+hh:mm) ──
  _formatAlgoPinDate(date) {
    const d = new Date(date);
    const pad = (n) => String(n).padStart(2, '0');
    // Obtenir les composants en heure de Paris via Intl
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
    const p = {};
    fmt.formatToParts(d).forEach(part => { p[part.type] = part.value; });
    // Déterminer offset Paris : comparer heure UTC vs heure Paris
    const utcH = d.getUTCHours();
    const parisH = parseInt(p.hour);
    let offset = parisH - utcH;
    if (offset < 0) offset += 24;
    if (offset > 12) offset -= 24;
    const offStr = `+${pad(offset)}:00`;
    return `${p.year}-${p.month}-${p.day}T${pad(parisH)}:00:00${offStr}`;
  }

  async generateCode(lock, { startDate, endDate, guestName }) {
    const token = await this.authenticate();
    const accessName = (guestName || 'Guest').substring(0, 32);

    // Garder le device ID original pour AlgoPIN (le keypad a l'algo, pas le retrofit lock)
    const originalDeviceId = lock.device_id;
    const model = (lock.model || lock.metadata?.raw?.type || '').toLowerCase();

    // Résoudre le lock lié + son bridge (pour bridge jobs uniquement)
    let lockDeviceId = originalDeviceId;
    let effectiveLock = lock;
    if (model === 'keypad') {
      const linkedLock = (lock.metadata?.raw?.linkedDevices || []).find(d => d.type === 'Lock');
      if (linkedLock?.deviceId) {
        lockDeviceId = linkedLock.deviceId;
        try {
          const lockRow = await this.pool.query(
            'SELECT metadata FROM smart_locks WHERE device_id = $1 AND connection_id = $2',
            [lockDeviceId, this.connection.id]
          );
          if (lockRow.rows[0]?.metadata?.bridgeDeviceId) {
            effectiveLock = { ...lock, metadata: { ...lock.metadata, bridgeDeviceId: lockRow.rows[0].metadata.bridgeDeviceId } };
          }
        } catch (e) { /* fallback */ }
      }
    }

    // Formater les dates au format requis : YYYY-MM-DDTHH:00:00+hh:mm
    const formattedStart = startDate ? this._formatAlgoPinDate(startDate) : undefined;
    const formattedEnd = endDate ? this._formatAlgoPinDate(endDate) : undefined;

    // Liste des device IDs à essayer pour AlgoPIN (original d'abord, puis lock lié si différent)
    const algoDeviceIds = [originalDeviceId];
    if (lockDeviceId !== originalDeviceId) algoDeviceIds.push(lockDeviceId);

    // ── Méthode 1 : AlgoPIN daily (essayer chaque device) ──
    for (const devId of algoDeviceIds) {
      try {
        const payload = { accessName, variance: 1 };
        if (formattedStart) payload.startDate = formattedStart;
        if (formattedEnd) payload.endDate = formattedEnd;

        console.log(`🔑 [Igloohome] Tentative AlgoPIN daily sur device: ${devId}`);
        const data = await this.apiCall(`${BASE_URL}/devices/${devId}/algopin/daily`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        const code = data.pin || data.algoPin || data.code;
        console.log(`🔑 [Igloohome] AlgoPIN daily généré pour ${guestName}: ${code} (device: ${devId})`);

        return {
          externalCodeId: data.pinId || data.id || String(Date.now()),
          code: code,
          validFrom: startDate,
          validUntil: endDate,
        };
      } catch (algoPinErr) {
        console.warn(`⚠️ [Igloohome] AlgoPIN daily échoué sur ${devId}: ${algoPinErr.message}`);
      }
    }

    // ── Méthode 2 : AlgoPIN hourly (essayer chaque device) ──
    for (const devId of algoDeviceIds) {
      try {
        const payload = { accessName, variance: 1 };
        if (formattedStart) payload.startDate = formattedStart;
        if (formattedEnd) payload.endDate = formattedEnd;

        console.log(`🔑 [Igloohome] Tentative AlgoPIN hourly sur device: ${devId}`);
        const data = await this.apiCall(`${BASE_URL}/devices/${devId}/algopin/hourly`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        const code = data.pin || data.algoPin || data.code;
        console.log(`🔑 [Igloohome] AlgoPIN hourly généré pour ${guestName}: ${code} (device: ${devId})`);

        return {
          externalCodeId: data.pinId || data.id || String(Date.now()),
          code: code,
          validFrom: startDate,
          validUntil: endDate,
        };
      } catch (hourlyErr) {
        console.warn(`⚠️ [Igloohome] AlgoPIN hourly échoué sur ${devId}: ${hourlyErr.message}`);
      }
    }

    // ── Méthode 3 : Bridge create PIN (dernier recours) ──
    const bridgeId = effectiveLock.metadata?.bridgeDeviceId;
    if (!bridgeId) {
      throw new Error('AlgoPIN indisponible et aucun bridge associé — impossible de créer un code.');
    }

    const code = this._generatePin(6);
    const job = await this._createBridgeJob(effectiveLock, 4, { pin: code, pinName: accessName }, lockDeviceId);
    console.log(`🔑 [Igloohome] Bridge PIN job: ${job.jobId}`);
    const result = await this._waitForJob(job.jobId, 20000);
    console.log(`🔑 [Igloohome] Bridge job result:`, JSON.stringify(result));

    return {
      externalCodeId: result.jobResponse?.pinId || job.jobId || String(Date.now()),
      code: code,
      validFrom: startDate,
      validUntil: endDate,
    };
  }

  async revokeCode(lock, externalCodeId) {
    try {
      if (!externalCodeId) {
        console.warn('⚠️ [Igloohome] Pas d\'externalCodeId pour révocation');
        return false;
      }
      const bridgeId = lock.metadata?.bridgeDeviceId;
      if (!bridgeId) {
        console.warn(`⚠️ [Igloohome] Pas de bridgeDeviceId pour révocation (metadata: ${JSON.stringify(lock.metadata || {}).substring(0, 100)})`);
        return false;
      }
      console.log(`🔑 [Igloohome] Révocation code ${externalCodeId} via bridge ${bridgeId}`);
      const job = await this._createBridgeJob(lock, 5, { accessCodeId: externalCodeId });
      const result = await this._waitForJob(job.jobId);
      console.log(`🔑 [Igloohome] Révocation ${result.completed ? 'réussie' : 'échouée'}: job ${job.jobId}`);
      return result.completed;
    } catch (e) {
      console.error(`❌ [Igloohome] Erreur révocation code ${externalCodeId}:`, e.message);
      return false;
    }
  }

  async getLockStatus(lock) {
    return {
      battery: lock.battery_level ?? null,
      isOnline: lock.metadata?.hasBridge ?? lock.is_online ?? false,
      lastActivity: null,
      firmwareVersion: null,
    };
  }

  // ── Bridge Jobs : commandes à distance ──

  async _createBridgeJob(lock, jobType, payload = {}, overrideDeviceId = null) {
    const token = await this.authenticate();
    const bridgeId = lock.metadata?.bridgeDeviceId;
    if (!bridgeId) throw new Error('Aucun bridge associé à cette serrure');

    const targetDeviceId = overrideDeviceId || lock.device_id;
    console.log(`🔧 [Igloohome] Bridge job type=${jobType} → device=${targetDeviceId}, bridge=${bridgeId}`);
    const data = await this.apiCall(`${BASE_URL}/devices/${targetDeviceId}/jobs/bridges/${bridgeId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ jobType, ...payload }),
    });
    return data;
  }

  async _waitForJob(jobId, maxWait = 15000) {
    const token = await this.authenticate();
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      await new Promise(r => setTimeout(r, 2000));
      try {
        const data = await this.apiCall(`${BASE_URL}/jobs/${jobId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (data.completed) return data;
      } catch (e) { /* retry */ }
    }
    return { completed: false, jobId };
  }

  async unlock(lock) {
    const job = await this._createBridgeJob(lock, 2); // BRIDGE_JOB_UNLOCK
    console.log(`🔓 [Igloohome] Unlock job créé: ${job.jobId}`);
    const result = await this._waitForJob(job.jobId);
    return { success: result.completed, jobId: job.jobId };
  }

  async lockDevice(lock) {
    const job = await this._createBridgeJob(lock, 1); // BRIDGE_JOB_LOCK
    console.log(`🔒 [Igloohome] Lock job créé: ${job.jobId}`);
    const result = await this._waitForJob(job.jobId);
    return { success: result.completed, jobId: job.jobId };
  }

  async createCustomPin(lock, { code, name, startDate, endDate }) {
    const token = await this.authenticate();
    const originalDeviceId = lock.device_id;
    let lockDeviceId = originalDeviceId;
    let effectiveLock = lock;
    const model = (lock.model || lock.metadata?.raw?.type || '').toLowerCase();
    if (model === 'keypad') {
      const linkedLock = (lock.metadata?.raw?.linkedDevices || []).find(d => d.type === 'Lock');
      if (linkedLock?.deviceId) {
        lockDeviceId = linkedLock.deviceId;
        try {
          const lockRow = await this.pool.query(
            'SELECT metadata FROM smart_locks WHERE device_id = $1 AND connection_id = $2',
            [lockDeviceId, this.connection.id]
          );
          if (lockRow.rows[0]?.metadata?.bridgeDeviceId) {
            effectiveLock = { ...lock, metadata: { ...lock.metadata, bridgeDeviceId: lockRow.rows[0].metadata.bridgeDeviceId } };
          }
        } catch (e) { /* fallback */ }
      }
    }
    const accessName = (name || 'Code BH').substring(0, 32);
    const formattedStart = startDate ? this._formatAlgoPinDate(startDate) : undefined;
    const formattedEnd = endDate ? this._formatAlgoPinDate(endDate) : undefined;

    // AlgoPIN: essayer sur l'original d'abord, puis le lock lié
    const algoDeviceIds = [originalDeviceId];
    if (lockDeviceId !== originalDeviceId) algoDeviceIds.push(lockDeviceId);

    for (const devId of algoDeviceIds) {
      try {
        const payload = { accessName, variance: 1 };
        if (formattedStart) payload.startDate = formattedStart;
        if (formattedEnd) payload.endDate = formattedEnd;
        const data = await this.apiCall(`${BASE_URL}/devices/${devId}/algopin/daily`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const pin = data.pin || data.algoPin || data.code;
        return { success: true, pinId: data.pinId || data.id, code: pin };
      } catch (e) {
        console.warn(`⚠️ [Igloohome] AlgoPIN daily échoué sur ${devId}: ${e.message}`);
      }
    }

    // Fallback bridge
    const bridgeId = effectiveLock.metadata?.bridgeDeviceId;
    if (!bridgeId) return { success: false, code: null };
    const pinCode = code || this._generatePin(6);
    try {
      const job = await this._createBridgeJob(effectiveLock, 4, { pin: pinCode, pinName: accessName }, lockDeviceId);
      const result = await this._waitForJob(job.jobId, 20000);
      return { success: result.completed, jobId: job.jobId, code: pinCode };
    } catch (e) {
      console.error(`[Igloohome] Erreur bridge createCustomPin:`, e.message);
      return { success: false, code: null };
    }
  }

  async deleteCustomPin(lock, pinId) {
    try {
      const job = await this._createBridgeJob(lock, 5, { accessCodeId: pinId });
      const result = await this._waitForJob(job.jobId);
      return result.completed;
    } catch (e) {
      console.error(`[Igloohome] Erreur suppression PIN:`, e.message);
      return false;
    }
  }

  async getActivityLogs(lock) {
    try {
      const job = await this._createBridgeJob(lock, 15); // BRIDGE_JOB_GET_ACTIVITY_LOGS
      const result = await this._waitForJob(job.jobId, 20000);
      return result.jobResponse?.logs || result.jobResponse || [];
    } catch (e) {
      console.error(`[Igloohome] Erreur logs activité:`, e.message);
      return [];
    }
  }

  _generatePin(length = 6) {
    let pin = '';
    for (let i = 0; i < length; i++) pin += Math.floor(Math.random() * 10);
    if (/^(\d)\1+$/.test(pin) || pin === '123456') return this._generatePin(length);
    return pin;
  }

  _mapType(t) {
    if (!t) return 'smart_lock';
    const lower = String(t).toLowerCase();
    if (lower === 'bridge') return 'bridge';
    if (lower === 'lock') return 'smart_lock';
    if (lower === 'keypad') return 'keypad';
    if (lower === 'padlock') return 'padlock';
    if (lower === 'keybox') return 'keybox';
    const map = { '1': 'smart_lock', '2': 'padlock', '3': 'keybox' };
    return map[lower] || 'smart_lock';
  }
}

module.exports = IgloohomeAdapter;
