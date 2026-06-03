const SmartLockAdapter = require('./base-adapter');

const BASE_URL = 'https://api.igloocompany.co/iglooaccess/v1';

class IgloohomeAdapter extends SmartLockAdapter {
  constructor(connection, pool) {
    super(connection, pool);
  }

  async authenticate() {
    // Igloohome utilise client_credentials OAuth2
    const { clientId, clientSecret } = this.credentials;
    if (!clientId || !clientSecret) throw new Error('Igloohome: clientId et clientSecret requis');

    // Vérifier si le token est encore valide
    if (this.credentials.accessToken && this.credentials.expiresAt) {
      if (Date.now() < this.credentials.expiresAt - 60000) {
        return this.credentials.accessToken;
      }
    }

    const fetch = (await import('node-fetch')).default;
    const res = await fetch('https://api.igloocompany.co/iglooaccess/v1/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
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
    const data = await this.apiCall(`${BASE_URL}/devices`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const devices = data.payload || data.results || data || [];
    return (Array.isArray(devices) ? devices : []).map(d => ({
      deviceId: d.deviceId || d.id,
      name: d.name || d.deviceName || 'Igloohome Lock',
      type: this._mapType(d.type || d.deviceType),
      model: d.model || d.deviceModel || null,
      serialNumber: d.serialNo || d.serialNumber || null,
      battery: d.batteryLevel ?? d.battery ?? null,
      isOnline: d.status === 'online' || d.connected === true,
      metadata: { raw: d },
    }));
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
    const token = await this.authenticate();
    try {
      const data = await this.apiCall(`${BASE_URL}/devices/${lock.device_id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return {
        battery: data.batteryLevel ?? data.battery ?? null,
        isOnline: data.status === 'online' || data.connected === true,
        lastActivity: data.lastActivity || null,
        firmwareVersion: data.firmwareVersion || null,
      };
    } catch (e) {
      return { battery: null, isOnline: false, lastActivity: null, firmwareVersion: null };
    }
  }

  _mapType(t) {
    const map = { '1': 'smart_lock', '2': 'padlock', '3': 'keybox', lock: 'smart_lock', padlock: 'padlock', keybox: 'keybox' };
    return map[String(t).toLowerCase()] || 'smart_lock';
  }
}

module.exports = IgloohomeAdapter;
