const SmartLockAdapter = require('./base-adapter');

const AUTH_URL = 'https://auth.igloohome.co/oauth2/token';
const BASE_URL = 'https://api.igloodeveloper.co/igloohome';
const SCOPES = 'igloohomeapi/algopin-hourly igloohomeapi/algopin-daily igloohomeapi/algopin-permanent igloohomeapi/algopin-onetime igloohomeapi/get-devices';

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

    return allDevices.map(d => {
      const linkedBridge = (d.linkedDevices || []).some(ld => ld.type === 'Bridge');
      return {
        deviceId: d.deviceId || d.id,
        name: d.deviceName || d.name || 'Igloohome Lock',
        type: this._mapType(d.type),
        model: d.type || null,
        serialNumber: d.deviceId || null,
        battery: d.batteryLevel ?? null,
        isOnline: linkedBridge,
        metadata: {
          linkedDevices: d.linkedDevices || [],
          hasBridge: linkedBridge,
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
    const token = await this.authenticate();
    try {
      const data = await this.apiCall(`${BASE_URL}/devices/${lock.device_id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const linkedBridge = (data.linkedDevices || []).some(ld => ld.type === 'Bridge');
      return {
        battery: data.batteryLevel ?? null,
        isOnline: linkedBridge,
        lastActivity: data.pairedAt || null,
        firmwareVersion: null,
      };
    } catch (e) {
      return { battery: null, isOnline: false, lastActivity: null, firmwareVersion: null };
    }
  }

  _mapType(t) {
    if (!t) return 'smart_lock';
    const lower = String(t).toLowerCase();
    if (lower === 'bridge') return 'bridge';
    if (lower === 'lock') return 'smart_lock';
    if (lower === 'padlock') return 'padlock';
    if (lower === 'keybox') return 'keybox';
    const map = { '1': 'smart_lock', '2': 'padlock', '3': 'keybox' };
    return map[lower] || 'smart_lock';
  }
}

module.exports = IgloohomeAdapter;
