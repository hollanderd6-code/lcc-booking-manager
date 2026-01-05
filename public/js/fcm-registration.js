// fcm-registration.js (CORRIGÉ)
// Objectif : toujours voir soit "✅ Push registration token", soit "registrationError"

(function () {
  // ✅ Anti double init (si le script est injecté plusieurs fois)
  if (window.__LCC_PUSH_INIT__) {
    console.log("🔁 Push déjà initialisé, on skip.");
    return;
  }
  window.__LCC_PUSH_INIT__ = true;

  const { Capacitor } = window;
  const PushNotifications = Capacitor?.Plugins?.PushNotifications;

  if (!PushNotifications) {
    console.log("❌ PushNotifications plugin introuvable (pas dans l'app native ?).");
    return;
  }

  const API_BASE = (window.API_BASE || window.location.origin).replace(/\/$/, "");
  let registrationReceived = false;

  // ✅ Important : listeners AVANT register()
  PushNotifications.addListener("registration", async (token) => {
    registrationReceived = true;
    const value = token?.value;
    console.log("✅ Push registration token:", value);

    if (!value) {
      console.log("⚠️ registration event reçu mais token vide:", token);
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/save-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: value,
          platform: Capacitor.getPlatform?.() || "unknown",
          createdAt: new Date().toISOString(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      console.log("✅ Token envoyé au serveur:", json);
    } catch (e) {
      console.log("❌ Erreur envoi token au serveur:", e);
    }
  });

  PushNotifications.addListener("registrationError", (error) => {
    registrationReceived = true;
    console.log("❌ registrationError:", error);
  });

  PushNotifications.addListener("pushNotificationReceived", (notification) => {
    console.log("📩 pushNotificationReceived:", notification);
  });

  PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
    console.log("👉 pushNotificationActionPerformed:", action);
  });

  async function initPush() {
    try {
      console.log("📱 Demande de permission notifications...");
      const permStatus = await PushNotifications.checkPermissions();
      console.log("🔎 checkPermissions:", permStatus);

      let status = permStatus?.receive;

      if (status !== "granted") {
        const req = await PushNotifications.requestPermissions();
        console.log("🟦 requestPermissions:", req);
        status = req?.receive;
      }

      if (status !== "granted") {
        console.log("🚫 Permission refusée:", status);
        return;
      }

      console.log("📌 Permission accordée, register()...");
      await PushNotifications.register();
      console.log("🟢 register() appelé (attends l’événement registration)");

      // ✅ Si après 10s on n’a rien → on log un warning clair
      setTimeout(() => {
        if (!registrationReceived) {
          console.log(
            "⚠️ Aucun événement 'registration' ni 'registrationError' après 10s.\n" +
              "→ Très probable: capabilities iOS (Push Notifications) manquantes, provisioning, APNs/Firebase config, ou AppDelegate."
          );
        }
      }, 10000);
    } catch (e) {
      console.log("❌ Exception initPush:", e);
    }
  }

  initPush();
})();
