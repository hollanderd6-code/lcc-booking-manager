import UIKit
import Capacitor
import WebKit
import FirebaseCore

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?
    var splashViewController: UIViewController?
    var isWebViewLoaded = false

    // ✅ AJOUT : fonction centralisée
    private func disablePullToRefresh(on webView: WKWebView) {
        let sv = webView.scrollView

        // Désactive le rebond en haut => empêche le "tirer pour actualiser"
        sv.bounces = false
        sv.alwaysBounceVertical = false

        // Si un refreshControl existe, on le supprime
        sv.refreshControl = nil

        // (Optionnel mais utile) évite certains comportements d'inset auto
        if #available(iOS 11.0, *) {
            sv.contentInsetAdjustmentBehavior = .never
        }
    }

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {

        // ✅ Configurer Firebase
        FirebaseApp.configure()

        // Couleur verte
        let greenColor = UIColor(red: 0.498, green: 0.827, blue: 0.651, alpha: 1.0)

        // Créer la fenêtre principale
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.backgroundColor = greenColor

        // Créer le Bridge Capacitor
        let capVC = CAPBridgeViewController()
        capVC.view.backgroundColor = greenColor
        capVC.view.isOpaque = true

        // WebView avec fond vert et opaque
        if let webView = capVC.webView {
            webView.backgroundColor = greenColor
            webView.isOpaque = true
            webView.scrollView.backgroundColor = greenColor

            // 🚫 BLOQUAGE TOTAL DU PULL-TO-REFRESH
            webView.scrollView.bounces = false
            webView.scrollView.alwaysBounceVertical = false
            webView.scrollView.refreshControl = nil
            webView.scrollView.panGestureRecognizer.isEnabled = false
            webView.scrollView.panGestureRecognizer.isEnabled = true
            webView.alpha = 0
            webView.navigationDelegate = self
        }

        window.rootViewController = capVC
        self.window = window
        window.makeKeyAndVisible()

        // 🎨 CRÉER UN SPLASH SCREEN PAR-DESSUS
        createAndShowSplashScreen()

        return true
    }

    func createAndShowSplashScreen() {
        let storyboard = UIStoryboard(name: "LaunchScreen", bundle: nil)

        if let splashVC = storyboard.instantiateInitialViewController() {
            splashVC.view.frame = UIScreen.main.bounds
            splashViewController = splashVC

            if let window = self.window {
                window.addSubview(splashVC.view)
                window.bringSubviewToFront(splashVC.view)
            }

            print("✅ Splash screen natif affiché")
        }
    }

    func hideSplashScreen() {
        guard let splashView = splashViewController?.view else { return }

        print("🎬 Début animation de masquage du splash")

        // Rendre la WebView visible d'abord
        if let rootVC = window?.rootViewController as? CAPBridgeViewController {
            UIView.animate(withDuration: 0.3) {
                rootVC.webView?.alpha = 1
            }
        }

        // Puis masquer le splash avec un délai
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
            UIView.animate(withDuration: 0.5, animations: {
                splashView.alpha = 0
            }) { _ in
                splashView.removeFromSuperview()
                self.splashViewController = nil
                print("✨ Splash screen masqué avec succès")
            }
        }
    }
}

extension AppDelegate: WKNavigationDelegate {
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // ✅ IMPORTANT : ré-appliquer ici quand la WebView est vraiment prête
        disablePullToRefresh(on: webView)

        guard !isWebViewLoaded else { return }
        isWebViewLoaded = true

        print("📱 WebView chargée - attente de 8 secondes avant masquage")

        // ⏱️ CHANGÉ : 8 secondes au lieu de 1.5
        DispatchQueue.main.asyncAfter(deadline: .now() + 8.0) {
            self.hideSplashScreen()
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        // ✅ ré-appliquer aussi en cas d'échec (au cas où)
        disablePullToRefresh(on: webView)

        print("❌ Erreur de chargement WebView: \(error.localizedDescription)")
        
        // En cas d'erreur, attendre 3 secondes
        DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) {
            self.hideSplashScreen()
        }
    }
}
