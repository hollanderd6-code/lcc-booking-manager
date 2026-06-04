const SmartLockAdapter = require('./base-adapter');

const AUTH_URL = 'https://auth.igloohome.co/oauth2/token';
const BASE_URL = 'https://api.igloodeveloper.co/igloohome';
const SCOPES = 'igloohomeapi/algopin-hourly igloohomeapi/algopin-daily igloohomeapi/algopin-permanent igloohomeapi/algopin-onetime igloohomeapi/get-devices igloohomeapi/unlock-bridge-proxied-job igloohomeapi/lock-bridge-proxied-job igloohomeapi/create-custom-pin-bridge-proxied-job igloohomeapi/delete-custom-pin-bridge-proxied-job igloohomeapi/get-activity-logs-bridge-proxied-job igloohomeapi/get-battery-level-bridge-proxied-job';

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

  async generateCode(lock, { startDate, endDate, guestName }) {
    const token = await this.authenticate();
    const deviceId = lock.device_id;

    // Igloohome algo PIN : code temporaire basé sur les dates
    const body = {
      type: 'duration',
      name: guestName || 'Guest',
      startDate: new Date(startDate).toISOString(),
      endDate: new Date(endDate).toISOString(),
    };

    const data = await this.apiCall(`${BASE_URL}/devices/${deviceId}/algopin`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });

    return {
      externalCodeId: data.pinId || data.id || String(Date.now()),
      code: data.pin || data.code,
      validFrom: startDate,
      validUntil: endDate,
    };
  }

  async revokeCode(lock, externalCodeId) {
    const token = await this.authenticate();
    try {
      await this.apiCall(`${BASE_URL}/devices/${lock.device_id}/algopin/${externalCodeId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      return true;
    } catch (e) {
      console.error(`[Igloohome] Erreur révocation code ${externalCodeId}:`, e.message);
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

  async _createBridgeJob(lock, jobType, payload = {}) {
    const token = await this.authenticate();
    const bridgeId = lock.metadata?.bridgeDeviceId;
    if (!bridgeId) throw new Error('Aucun bridge associé à cette serrure');

    const data = await this.apiCall(`${BASE_URL}/devices/${lock.device_id}/jobs/bridges/${bridgeId}`, {
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
    const payload = {
      pin: code || this._generatePin(6),
      pinName: (name || 'Code BH').substring(0, 32),
    };
    if (startDate) payload.startDate = new Date(startDate).toISOString();
    if (endDate) payload.endDate = new Date(endDate).toISOString();

    const job = await this._createBridgeJob(lock, 4, payload); // BRIDGE_JOB_CREATE_CUSTOM_PIN
    const result = await this._waitForJob(job.jobId, 20000);
    return { success: result.completed, jobId: job.jobId, code: payload.pin };
  }

  async deleteCustomPin(lock, pinId) {
    try {
      const job = await this._createBridgeJob(lock, 5, { pinId }); // BRIDGE_JOB_DELETE_CUSTOM_PIN
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
