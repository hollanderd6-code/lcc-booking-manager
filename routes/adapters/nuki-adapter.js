const SmartLockAdapter = require('./base-adapter');

const BASE_URL = 'https://api.nuki.io';

class NukiAdapter extends SmartLockAdapter {
  constructor(connection, pool) {
    super(connection, pool);
  }

  async authenticate() {
    // Nuki utilise un API token statique (pas d'OAuth refresh)
    // Le token est généré depuis https://web.nuki.io → API
    const { apiToken } = this.credentials;
    if (!apiToken) throw new Error('Nuki: apiToken requis (depuis web.nuki.io → API)');
    return apiToken;
  }

  async listLocks() {
    const token = await this.authenticate();
    const devices = await this.apiCall(`${BASE_URL}/smartlock`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    return (Array.isArray(devices) ? devices : []).map(d => ({
      deviceId: String(d.smartlockId),
      name: d.name || 'Nuki Lock',
      type: this._mapType(d.type),
      model: d.firmwareVersion ? `Nuki ${d.type === 2 ? 'Opener' : 'Smart Lock'}` : null,
      serialNumber: d.serialNumber || null,
      battery: d.state?.batteryCharge ?? null,
      isOnline: d.state?.state !== undefined,
      metadata: {
        nukiState: d.state?.state,   // 1=locked, 3=unlocked, etc.
        doorState: d.state?.doorState,
        keypadEnabled: d.config?.keypadEnabled ?? false,
        raw: d,
      },
    }));
  }

  async generateCode(lock, { startDate, endDate, guestName }) {
    const token = await this.authenticate();
    const smartlockId = lock.device_id;

    // Nuki Keypad : créer une autorisation avec code PIN
    // Type 13 = Keypad code
    const code = this._generatePin(6);

    const body = {
      name: (guestName || 'Guest').substring(0, 32),
      type: 13,  // Keypad code
      code: parseInt(code),
      allowedFromDate: this._toNukiDate(startDate),
      allowedUntilDate: this._toNukiDate(endDate),
      allowedWeekDays: 127,  // tous les jours (bitmask: 1111111)
      allowedFromTime: 0,
      allowedUntilTime: 0,
      enabled: true,
    };

    const data = await this.apiCall(`${BASE_URL}/smartlock/${smartlockId}/auth`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });

    return {
      externalCodeId: data.id || data.authId || String(Date.now()),
      code: code,
      validFrom: startDate,
      validUntil: endDate,
    };
  }

  async revokeCode(lock, externalCodeId) {
    const token = await this.authenticate();
    try {
      await this.apiCall(`${BASE_URL}/smartlock/${lock.device_id}/auth/${externalCodeId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      return true;
    } catch (e) {
      console.error(`[Nuki] Erreur révocation auth ${externalCodeId}:`, e.message);
      return false;
    }
  }

  async getLockStatus(lock) {
    const token = await this.authenticate();
    try {
      const data = await this.apiCall(`${BASE_URL}/smartlock/${lock.device_id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return {
        battery: data.state?.batteryCharge ?? null,
        isOnline: data.state?.state !== undefined,
        lastActivity: data.lastKnownUpdate || null,
        firmwareVersion: data.firmwareVersion || null,
      };
    } catch (e) {
      return { battery: null, isOnline: false, lastActivity: null, firmwareVersion: null };
    }
  }

  _mapType(t) {
    // Nuki: 0=Smart Lock, 2=Opener, 3=Smart Door, 4=Smart Lock 3.0
    if (t === 2) return 'opener';
    return 'smart_lock';
  }

  _generatePin(length = 6) {
    let pin = '';
    for (let i = 0; i < length; i++) pin += Math.floor(Math.random() * 10);
    // Éviter les PIN triviaux
    if (/^(\d)\1+$/.test(pin) || pin === '123456' || pin === '654321') return this._generatePin(length);
    return pin;
  }

  _toNukiDate(dateStr) {
    const d = new Date(dateStr);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}

module.exports = NukiAdapter;
