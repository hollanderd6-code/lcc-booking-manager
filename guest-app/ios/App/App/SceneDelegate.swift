import UIKit

// Capacitor construit sa fenêtre lui-même, via ApplicationDelegateProxy.
// Ce délégué n'a donc rien à assembler : il existe pour qu'iOS trouve une
// adoption du cycle de vie par scènes, ce que Xcode 27 exige.
//
// Le garder vide est volontaire. Y créer une fenêtre entrerait en
// concurrence avec celle de Capacitor : l'écran resterait noir.

class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        guard let _ = scene as? UIWindowScene else { return }
    }

    func sceneDidDisconnect(_ scene: UIScene) {}
    func sceneDidBecomeActive(_ scene: UIScene) {}
    func sceneWillResignActive(_ scene: UIScene) {}
    func sceneWillEnterForeground(_ scene: UIScene) {}
    func sceneDidEnterBackground(_ scene: UIScene) {}
}
