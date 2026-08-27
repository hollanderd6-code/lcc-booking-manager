import UIKit
import UserNotifications

// Capacitor construit sa fenêtre lui-même, via ApplicationDelegateProxy.
// Ce délégué n'a donc rien à assembler : il existe pour qu'iOS trouve une
// adoption du cycle de vie par scènes, ce que Xcode 27 exige.
//
// Le garder vide pour la fenêtre est volontaire. Y créer une fenêtre
// entrerait en concurrence avec celle de Capacitor : l'écran resterait noir.
//
// ⚠️ EN REVANCHE le badge se gère ICI, et nulle part ailleurs.
// Dès qu'une app adopte le cycle de vie par scènes, iOS n'appelle plus
// applicationWillEnterForeground(_:) ni applicationDidBecomeActive(_:) sur
// l'AppDelegate : ce sont sceneWillEnterForeground / sceneDidBecomeActive
// qui reçoivent l'événement. Les remises à zéro qui vivaient dans
// l'AppDelegate étaient donc du code mort — d'où le « 1 » qui ne partait
// jamais de l'icône.

class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        guard let _ = scene as? UIWindowScene else { return }
        remettreBadgeAZero()
    }

    func sceneDidDisconnect(_ scene: UIScene) {}

    func sceneDidBecomeActive(_ scene: UIScene) {
        remettreBadgeAZero()
    }

    func sceneWillResignActive(_ scene: UIScene) {}

    func sceneWillEnterForeground(_ scene: UIScene) {
        remettreBadgeAZero()
    }

    func sceneDidEnterBackground(_ scene: UIScene) {}

    // ============================================
    // BADGE
    // ============================================
    // L'utilisateur ouvre l'app : il a vu ses notifications. On efface la
    // pastille de l'icône et on vide le tiroir, pour que les lanceurs
    // Android comme iOS n'affichent plus rien.
    private func remettreBadgeAZero() {
        let centre = UNUserNotificationCenter.current()
        centre.removeAllDeliveredNotifications()

        if #available(iOS 16.0, *) {
            // applicationIconBadgeNumber est déprécié depuis iOS 17 :
            // setBadgeCount est la seule voie fiable sur les versions récentes.
            centre.setBadgeCount(0) { erreur in
                if let erreur = erreur {
                    print("❌ Badge non remis à zéro : \(erreur.localizedDescription)")
                } else {
                    print("📱 Badge remis à 0 (scène active)")
                }
            }
        } else {
            DispatchQueue.main.async {
                UIApplication.shared.applicationIconBadgeNumber = 0
                print("📱 Badge remis à 0 (scène active, iOS < 16)")
            }
        }
    }
}
