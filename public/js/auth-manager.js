// ============================================
// 🔐 AUTH MANAGER - Stockage persistant + Face ID
// ============================================

console.log('🔐 Auth Manager chargé');

// Vérifier si Capacitor est disponible
const isNative = typeof Capacitor !== 'undefined' && Capacitor.getPlatform() !== 'web';

// Importer les plugins
let Preferences, NativeBiometric;

if (isNative) {
  try {
    Preferences = Capacitor.Plugins.Preferences;
    NativeBiometric = Capacitor.Plugins.NativeBiometric;
    console.log('✅ Capacitor Preferences disponible');
    console.log('✅ Native Biometric disponible');
  } catch (err) {
    console.warn('⚠️ Plugins Capacitor non disponibles:', err);
  }
}

// ============================================
// 💾 STOCKAGE PERSISTANT (Preferences ou localStorage)
// ============================================

const AuthStorage = {
  async setToken(token) {
    if (isNative && Preferences) {
      await Preferences.set({ key: 'lcc_token', value: token });
      console.log('✅ Token sauvegardé (Preferences)');
    } else {
      localStorage.setItem('lcc_token', token);
      console.log('✅ Token sauvegardé (localStorage)');
    }
  },

  async getToken() {
    if (isNative && Preferences) {
      const { value } = await Preferences.get({ key: 'lcc_token' });
      return value;
    } else {
      return localStorage.getItem('lcc_token');
    }
  },

  async removeToken() {
    if (isNative && Preferences) {
      await Preferences.remove({ key: 'lcc_token' });
      console.log('🗑️ Token supprimé (Preferences)');
    } else {
      localStorage.removeItem('lcc_token');
      console.log('🗑️ Token supprimé (localStorage)');
    }
  },

  async setUser(user) {
    const userJson = JSON.stringify(user);
    if (isNative && Preferences) {
      await Preferences.set({ key: 'lcc_user', value: userJson });
    } else {
      localStorage.setItem('lcc_user', userJson);
    }
  },

  async getUser() {
    let userJson;
    if (isNative && Preferences) {
      const { value } = await Preferences.get({ key: 'lcc_user' });
      userJson = value;
    } else {
      userJson = localStorage.getItem('lcc_user');
    }
    return userJson ? JSON.parse(userJson) : null;
  },

  async removeUser() {
    if (isNative && Preferences) {
      await Preferences.remove({ key: 'lcc_user' });
    } else {
      localStorage.removeItem('lcc_user');
    }
  },

  // Sauvegarder les credentials pour Face ID
  async saveCredentials(email, password) {
    if (isNative && Preferences) {
      await Preferences.set({ key: 'lcc_email', value: email });
      await Preferences.set({ key: 'lcc_password', value: password });
      await Preferences.set({ key: 'lcc_biometric_enabled', value: 'true' });
      console.log('✅ Credentials sauvegardés pour Face ID');
    }
  },

  async getCredentials() {
    if (isNative && Preferences) {
      const email = await Preferences.get({ key: 'lcc_email' });
      const password = await Preferences.get({ key: 'lcc_password' });
      return {
        email: email.value,
        password: password.value
      };
    }
    return null;
  },

  async isBiometricEnabled() {
    if (isNative && Preferences) {
      const { value } = await Preferences.get({ key: 'lcc_biometric_enabled' });
      return value === 'true';
    }
    return false;
  },

  async disableBiometric() {
    if (isNative && Preferences) {
      await Preferences.remove({ key: 'lcc_email' });
      await Preferences.remove({ key: 'lcc_password' });
      await Preferences.remove({ key: 'lcc_biometric_enabled' });
      console.log('❌ Face ID désactivé');
    }
  }
};

// ============================================
// 👤 FACE ID / TOUCH ID
// ============================================

const BiometricAuth = {
  async isAvailable() {
    if (!isNative || !NativeBiometric) {
      console.log('⚠️ Biométrie non disponible (pas sur appareil natif)');
      return false;
    }

    try {
      const result = await NativeBiometric.isAvailable();
      console.log('🔍 Biométrie disponible:', result.isAvailable);
      console.log('🔍 Type:', result.biometryType); // 'faceId', 'touchId', 'fingerprintAuth'
      return result.isAvailable;
    } catch (err) {
      console.error('❌ Erreur vérification biométrie:', err);
      return false;
    }
  },

  async authenticate(reason = 'Connectez-vous à Boostinghost') {
    if (!isNative || !NativeBiometric) {
      console.warn('⚠️ Biométrie non disponible');
      return false;
    }

    try {
      const result = await NativeBiometric.verifyIdentity({
        reason: reason,
        title: 'Authentification',
        subtitle: 'Utilisez Face ID pour continuer',
        description: 'Scannez votre visage pour vous connecter'
      });

      console.log('✅ Authentification biométrique réussie');
      return true;
    } catch (err) {
      console.error('❌ Authentification biométrique échouée:', err);
      return false;
    }
  },

  async loginWithBiometric() {
    console.log('🔐 Tentative de connexion avec Face ID...');

    // Vérifier si la biométrie est activée
    const enabled = await AuthStorage.isBiometricEnabled();
    if (!enabled) {
      console.log('⚠️ Face ID non activé pour cet utilisateur');
      return null;
    }

    // Vérifier si la biométrie est disponible
    const available = await this.isAvailable();
    if (!available) {
      console.log('⚠️ Face ID non disponible sur cet appareil');
      return null;
    }

    // Demander l'authentification
    const authenticated = await this.authenticate('Connectez-vous à Boostinghost avec Face ID');
    if (!authenticated) {
      console.log('❌ Authentification Face ID échouée');
      return null;
    }

    // Récupérer les credentials
    const credentials = await AuthStorage.getCredentials();
    if (!credentials || !credentials.email || !credentials.password) {
      console.error('❌ Credentials non trouvés');
      return null;
    }

    console.log('✅ Face ID réussi, connexion en cours...');

    // Se connecter avec les credentials
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: credentials.email,
          password: credentials.password
        })
      });

      const data = await res.json();

      if (!res.ok) {
        console.error('❌ Erreur connexion:', data.error);
        return null;
      }

      // Sauvegarder le token et user
      await AuthStorage.setToken(data.token);
      await AuthStorage.setUser(data.user);

      console.log('✅ Connexion Face ID réussie !');
      return data;
    } catch (err) {
      console.error('❌ Erreur réseau:', err);
      return null;
    }
  }
};

// ============================================
// 🚀 AUTO-LOGIN AU DÉMARRAGE
// ============================================

async function tryAutoLogin() {
  console.log('🔄 Vérification auto-login...');

  // Vérifier si un token existe
  const token = await AuthStorage.getToken();
  if (!token) {
    console.log('ℹ️ Pas de token sauvegardé');
    return false;
  }

  // Vérifier si le token est valide
  try {
    const res = await fetch('/api/auth/verify', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (res.ok) {
      console.log('✅ Token valide, redirection...');
      return true;
    } else {
      console.log('⚠️ Token invalide, suppression...');
      await AuthStorage.removeToken();
      await AuthStorage.removeUser();
      return false;
    }
  } catch (err) {
    console.error('❌ Erreur vérification token:', err);
    return false;
  }
}

// ============================================
// 📤 LOGOUT
// ============================================

async function logout() {
  console.log('🚪 Déconnexion...');
  await AuthStorage.removeToken();
  await AuthStorage.removeUser();
  // Note: on ne supprime PAS les credentials Face ID
  // pour permettre une reconnexion rapide
  window.location.href = '/login.html';
}

// ============================================
// 🌍 EXPOSER GLOBALEMENT
// ============================================

window.AuthManager = {
  storage: AuthStorage,
  biometric: BiometricAuth,
  tryAutoLogin,
  logout
};

console.log('✅ Auth Manager prêt !');
