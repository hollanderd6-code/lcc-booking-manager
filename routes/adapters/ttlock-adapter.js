const SmartLockAdapter = require('./base-adapter');
const crypto = require('crypto');

// TTLock utilise des serveurs régionaux
const REGIONS = {
  eu: 'https://euapi.ttlock.com',
  us: 'https://api.ttlock.com',
  cn: 'https://cnapi.ttlock.com',
};

class TTLockAdapter extends SmartLockAdapter {
  constructor(connection, pool) {
    super(connection, pool);
    this.baseUrl = REGIONS[this.credentials.region || 'eu'];
  }

  async authenticate() {
    const { clientId, clientSecret, username, password, accessToken, refreshToken, expiresAt } = this.credentials;

    if (!clientId || !clientSecret) throw new Error('TTLock: clientId et clientSecret requis');

    // Token encore valide ?
    if (accessToken && expiresAt && Date.now() < expiresAt - 60000) {
      return accessToken;
    }

    // Refresh si possible
    if (refreshToken) {
      try {
        return await this._refreshToken(clientId, clientSecret, refreshToken);
      } catch (e) {
        console.warn('[TTLock] Refresh token échoué, re-auth complète:', e.message);
      }
    }

    // Auth complète (username + password)
    if (!username || !password) {
      throw new Error('TTLock: username et password requis pour la première connexion');
    }

    const fetch = (await import('node-fetch')).default;
    const md5Pass = crypto.createHash('md5').update(password).digest('hex');

    const res = await fetch(`${this.baseUrl}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        username: username,
        password: md5Pass,
      }),
    });

    const data = await res.json();
    if (data.errcode && data.errcode !== 0) {
      throw new Error(`TTLock auth failed: ${data.errmsg || data.errcode}`);
    }

    await this.saveCredentials({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + (data.expires_in || 7776000) * 1000,
      uid: data.uid,
    });

    return data.access_token;
  }

  async _refreshToken(clientId, clientSecret, refreshToken) {
    const fetch = (await import('node-fetch')).default;
    const res = await fetch(`${this.baseUrl}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });

    const data = await res.json();
    if (data.errcode && data.errcode !== 0) throw new Error(data.errmsg);

    await this.saveCredentials({
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken,
      expiresAt: Date.now() + (data.expires_in || 7776000) * 1000,
    });

    return data.access_token;
  }

  async listLocks() {
    const token = await this.authenticate();
    const allLocks = [];
    let pageNo = 1;
    const pageSize = 100;

    while (true) {
      const data = await this._ttlockPost('/v3/lock/list', {
        clientId: this.credentials.clientId,
        accessToken: token,
        pageNo,
        pageSize,
        date: Date.now(),
      });

      const locks = data.list || [];
      allLocks.push(...locks);

      if (locks.length < pageSize) break;
      pageNo++;
      if (pageNo > 10) break; // sécurité
    }

    return allLocks.map(d => ({
      deviceId: String(d.lockId),
      name: d.lockAlias || d.lockName || 'TTLock',
      type: 'smart_lock',
      model: d.lockData ? 'TTLock' : null,
      serialNumber: d.electricQuantity ? null : null,
      battery: d.electricQuantity ?? null,
      isOnline: d.lockStatus === 1 || d.isOnline === true,
      metadata: {
        lockMac: d.lockMac,
        featureValue: d.featureValue,
        hasGateway: d.hasGateway === 1,
        raw: d,
      },
    }));
  }

  async generateCode(lock, { startDate, endDate, guestName }) {
    const token = await this.authenticate();
    const lockId = lock.device_id;

    const startMs = new Date(startDate).getTime();
    const endMs = new Date(endDate).getTime();

    // Vérifier si la serrure supporte les codes clavier (featureValue bit 2)
    const hasKeypad = lock.metadata?.featureValue
      ? (parseInt(lock.metadata.featureValue) & 4) !== 0
      : true;

    if (!hasKeypad) {
      // Fallback : générer un code custom
      const code = this._generatePin(6);
      const data = await this._ttlockPost('/v3/keyboardPwd/add', {
        clientId: this.credentials.clientId,
        accessToken: token,
        lockId: parseInt(lockId),
        keyboardPwd: code,
        keyboardPwdName: (guestName || 'Guest').substring(0, 32),
        startDate: startMs,
        endDate: endMs,
        addType: 2,  // 2 = custom password
        date: Date.now(),
      });

      return {
        externalCodeId: String(data.keyboardPwdId),
        code: code,
        validFrom: startDate,
        validUntil: endDate,
      };
    }

    // Avec clavier : TTLock peut générer le code
    const data = await this._ttlockPost('/v3/keyboardPwd/get', {
      clientId: this.credentials.clientId,
      accessToken: token,
      lockId: parseInt(lockId),
      keyboardPwdType: 2,  // 2 = period password
      startDate: startMs,
      endDate: endMs,
      date: Date.now(),
    });

    return {
      externalCodeId: data.keyboardPwdId ? String(data.keyboardPwdId) : String(Date.now()),
      code: String(data.keyboardPwd),
      validFrom: startDate,
      validUntil: endDate,
    };
  }

  async revokeCode(lock, externalCodeId) {
    const token = await this.authenticate();
    try {
      await this._ttlockPost('/v3/keyboardPwd/delete', {
        clientId: this.credentials.clientId,
        accessToken: token,
        lockId: parseInt(lock.device_id),
        keyboardPwdId: parseInt(externalCodeId),
        deleteType: 2,  // 2 = delete via gateway
        date: Date.now(),
      });
      return true;
    } catch (e) {
      console.error(`[TTLock] Erreur révocation code ${externalCodeId}:`, e.message);
      return false;
    }
  }

  async getLockStatus(lock) {
    const token = await this.authenticate();
    try {
      const data = await this._ttlockPost('/v3/lock/detail', {
        clientId: this.credentials.clientId,
        accessToken: token,
        lockId: parseInt(lock.device_id),
        date: Date.now(),
      });
      return {
        battery: data.electricQuantity ?? null,
        isOnline: data.lockStatus === 1,
        lastActivity: null,
        firmwareVersion: null,
      };
    } catch (e) {
      return { battery: null, isOnline: false, lastActivity: null, firmwareVersion: null };
    }
  }

  async _ttlockPost(path, params) {
    const fetch = (await import('node-fetch')).default;
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(
        Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]))
      ),
    });

    const data = await res.json();
    if (data.errcode && data.errcode !== 0) {
      throw new Error(`TTLock ${path}: ${data.errmsg || 'errcode=' + data.errcode}`);
    }
    return data;
  }

  _generatePin(length = 6) {
    let pin = '';
    for (let i = 0; i < length; i++) pin += Math.floor(Math.random() * 10);
    if (/^(\d)\1+$/.test(pin) || pin === '123456') return this._generatePin(length);
    return pin;
  }
}

module.exports = TTLockAdapter;
