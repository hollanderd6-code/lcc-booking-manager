// Wrapper pour gérer le stockage de manière unifiée
// Utilise Capacitor Preferences sur mobile, localStorage en web

const SecureStorage = {
  // Détecte si on est sur Capacitor
  isCapacitor: () => {
    return window.Capacitor && window.Capacitor.isNativePlatform();
  },

  // Sauvegarder une valeur
  async setItem(key, value) {
    if (this.isCapacitor()) {
      const { Preferences } = window.Capacitor.Plugins;
      await Preferences.set({ key, value });
      console.log(`✅ Sauvegardé dans Preferences: ${key}`);
    } else {
      localStorage.setItem(key, value);
      console.log(`✅ Sauvegardé dans localStorage: ${key}`);
    }
  },

  // Récupérer une valeur
  async getItem(key) {
    if (this.isCapacitor()) {
      const { Preferences } = window.Capacitor.Plugins;
      const { value } = await Preferences.get({ key });
      console.log(`📖 Lu depuis Preferences: ${key} = ${value ? 'trouvé' : 'non trouvé'}`);
      return value;
    } else {
      const value = localStorage.getItem(key);
      console.log(`📖 Lu depuis localStorage: ${key} = ${value ? 'trouvé' : 'non trouvé'}`);
      return value;
    }
  },

  // Supprimer une valeur
  async removeItem(key) {
    if (this.isCapacitor()) {
      const { Preferences } = window.Capacitor.Plugins;
      await Preferences.remove({ key });
      console.log(`🗑️ Supprimé de Preferences: ${key}`);
    } else {
      localStorage.removeItem(key);
      console.log(`🗑️ Supprimé de localStorage: ${key}`);
    }
  },

  // Vider tout
  async clear() {
    if (this.isCapacitor()) {
      const { Preferences } = window.Capacitor.Plugins;
      await Preferences.clear();
      console.log(`🗑️ Preferences vidé`);
    } else {
      localStorage.clear();
      console.log(`🗑️ localStorage vidé`);
    }
  }
};

// Exposer globalement
window.SecureStorage = SecureStorage;
