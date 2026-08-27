import UIKit
import Capacitor
import WebKit
import FirebaseCore
import FirebaseMessaging
import UserNotifications
import LocalAuthentication

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?
    var splashViewController: UIViewController?
    var isWebViewLoaded = false
    // Vert bouteille #0E3B2E — DOIT etre identique au backgroundColor du
    // LaunchScreen.storyboard, sinon l'ecran change de teinte au demarrage.
    let brandColor = UIColor(red: 0.0549, green: 0.2314, blue: 0.1804, alpha: 1.0)
    // Ivoire #F2EADA — encre de la marque sur fond vert.
    let inkColor = UIColor(red: 0.949, green: 0.918, blue: 0.855, alpha: 1.0)
    var pendingFCMToken: String? = nil

    private func disablePullToRefresh(on webView: WKWebView) {
        let sv = webView.scrollView
        sv.alwaysBounceHorizontal = true
        sv.alwaysBounceVertical = false
        sv.refreshControl = nil
        sv.isDirectionalLockEnabled = false
        sv.delaysContentTouches = true
        sv.decelerationRate = .normal
        if #available(iOS 11.0, *) {
            sv.contentInsetAdjustmentBehavior = .never
        }
    }

    // ============================================
    // AUTH PERSISTENCE — UserDefaults
    // ============================================

    func saveTokenToUserDefaults(_ token: String) {
        UserDefaults.standard.set(token, forKey: "lcc_token")
        UserDefaults.standard.synchronize()
        print("💾 Token sauvegardé dans UserDefaults")
    }

    func clearTokenFromUserDefaults() {
        UserDefaults.standard.removeObject(forKey: "lcc_token")
        UserDefaults.standard.synchronize()
        print("🗑️ Token supprimé de UserDefaults")
    }

    func restoreTokenIfNeeded(webView: WKWebView) {
        guard let token = UserDefaults.standard.string(forKey: "lcc_token"),
              !token.isEmpty else {
            print("ℹ️ Pas de token sauvegardé dans UserDefaults")
            return
        }

        let js = """
        (function() {
            var existing = localStorage.getItem('lcc_token');
            if (!existing || existing === 'undefined' || existing === 'null') {
                localStorage.setItem('lcc_token', '\(token)');
                console.log('[Auth] ✅ Token restauré depuis UserDefaults');
            } else {
                window._syncTokenToNative && window._syncTokenToNative(existing);
                console.log('[Auth] ℹ️ Token déjà dans localStorage');
            }
        })();
        """

        webView.evaluateJavaScript(js) { _, error in
            if let error = error {
                print("❌ Erreur restauration token: \(error)")
            } else {
                print("✅ Token restauré dans localStorage")
            }
        }
    }

    // ============================================
    // FACE ID — LocalAuthentication natif
    // ============================================

    func evaluateBiometry(completion: @escaping (Bool, String?) -> Void) {
        let context = LAContext()
        var error: NSError?

        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
            completion(false, error?.localizedDescription ?? "Biométrie indisponible")
            return
        }

        context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics,
                               localizedReason: "Accédez à votre espace Boostinghost") { success, error in
            DispatchQueue.main.async {
                completion(success, error?.localizedDescription)
            }
        }
    }

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {

        FirebaseApp.configure()
        UNUserNotificationCenter.current().delegate = self
        Messaging.messaging().delegate = self

        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, error in
            print("📱 Notifications autorisées: \(granted)")
            if granted {
                DispatchQueue.main.async {
                    application.registerForRemoteNotifications()
                }
            }
        }

        let window = UIWindow(frame: UIScreen.main.bounds)
        window.backgroundColor = brandColor

        let capVC = CAPBridgeViewController()
        capVC.view.backgroundColor = brandColor
        capVC.view.isOpaque = true

        if let webView = capVC.webView {
            webView.backgroundColor = brandColor
            webView.isOpaque = true
            webView.scrollView.backgroundColor = brandColor
            webView.scrollView.alwaysBounceHorizontal = true
            webView.scrollView.alwaysBounceVertical = false
            webView.scrollView.refreshControl = nil
            webView.scrollView.isDirectionalLockEnabled = false
            webView.scrollView.delaysContentTouches = true
            webView.scrollView.decelerationRate = .normal
            webView.alpha = 0
            webView.navigationDelegate = self

            // Token sync handler
            webView.configuration.userContentController
                .add(TokenSyncHandler(appDelegate: self), name: "tokenSync")

            // Face ID handlers
            webView.configuration.userContentController
                .add(FaceIDCheckHandler(appDelegate: self), name: "faceIDCheck")
            webView.configuration.userContentController
                .add(FaceIDAuthHandler(appDelegate: self), name: "faceIDAuth")
        }

        window.rootViewController = capVC
        self.window = window
        window.makeKeyAndVisible()

        createAndShowSplashScreen()

        return true
    }

    // Xcode 27 exige le cycle de vie par scenes : sans cette methode, iOS
    // interrompt le lancement. Elle designe la configuration declaree dans
    // Info.plist, qui pointe vers SceneDelegate.
    func application(
        _ application: UIApplication,
        configurationForConnecting connectingSceneSession: UISceneSession,
        options: UIScene.ConnectionOptions
    ) -> UISceneConfiguration {
        return UISceneConfiguration(
            name: "Default Configuration",
            sessionRole: connectingSceneSession.role
        )
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        application.applicationIconBadgeNumber = 0
        UNUserNotificationCenter.current().removeAllDeliveredNotifications()
        print("📱 Badge remis à 0 (foreground)")
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        application.applicationIconBadgeNumber = 0
        UNUserNotificationCenter.current().removeAllDeliveredNotifications()
        print("📱 Badge remis à 0 (active)")
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Messaging.messaging().apnsToken = deviceToken
        let tokenString = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
        print("📱 APNs token: \(tokenString)")
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        print("❌ Erreur APNs: \(error.localizedDescription)")
    }

    func injectFCMToken(_ token: String) {
        guard let rootVC = window?.rootViewController as? CAPBridgeViewController,
              let webView = rootVC.webView else {
            print("📱 WebView pas prête, FCM token mis en attente")
            pendingFCMToken = token
            return
        }

        let js = """
        window.fcmToken = '\(token)';
        if (typeof window.onFCMToken === 'function') {
            window.onFCMToken('\(token)');
        } else {
            setTimeout(function() { if (typeof window.onFCMToken === 'function') window.onFCMToken('\(token)'); }, 1000);
            setTimeout(function() { if (typeof window.onFCMToken === 'function') window.onFCMToken('\(token)'); }, 3000);
        }
        """

        webView.evaluateJavaScript(js) { _, error in
            if let error = error {
                print("❌ Erreur injection FCM token: \(error)")
            } else {
                print("✅ FCM token injecté")
                self.pendingFCMToken = nil
            }
        }
    }

    // ============================================
    // SPLASH SCREEN — prolongement du LaunchScreen
    //
    // L'ancien splash dessinait sa propre marque : un « B » systeme .heavy dans
    // un cercle blanc translucide, puis BOOSTINGHOST tape lettre par lettre en
    // police systeme. Trois dessins differents se succedaient donc a
    // l'ouverture : le verrou du storyboard, ce « B », puis le verrou du web.
    //
    // Ici on reprend le MEME asset et les MEMES contraintes que
    // LaunchScreen.storyboard (62 % de largeur, plafond 260 pt, ratio 240x140,
    // centre decale de -24). Le verrou est donc deja a l'ecran quand ce splash
    // s'installe : il ne bouge pas d'un point, on n'ajoute qu'un indicateur de
    // chargement. Aucune police n'est a embarquer.
    // ============================================

    func createAndShowSplashScreen() {
        guard let window = self.window else { return }

        let splashView = UIView(frame: window.bounds)
        splashView.backgroundColor = brandColor
        splashView.autoresizingMask = [.flexibleWidth, .flexibleHeight]

        let verrou = UIImageView(image: UIImage(named: "LaunchLogo"))
        verrou.contentMode = .scaleAspectFit
        verrou.isUserInteractionEnabled = false
        verrou.translatesAutoresizingMaskIntoConstraints = false

        let spinner = UIActivityIndicatorView(style: .medium)
        spinner.color = inkColor.withAlphaComponent(0.80)
        spinner.alpha = 0
        spinner.translatesAutoresizingMaskIntoConstraints = false

        splashView.addSubview(verrou)
        splashView.addSubview(spinner)

        // 62 % de la largeur d'ecran, mais jamais plus de 260 pt : sur iPad la
        // proportion doit ceder au plafond, d'ou la priorite abaissee.
        let largeur = verrou.widthAnchor.constraint(equalTo: splashView.widthAnchor, multiplier: 0.62)
        largeur.priority = .defaultHigh

        NSLayoutConstraint.activate([
            verrou.centerXAnchor.constraint(equalTo: splashView.centerXAnchor),
            // Legerement au-dessus du centre geometrique : un bloc pose
            // exactement au milieu parait toujours trop bas.
            verrou.centerYAnchor.constraint(equalTo: splashView.centerYAnchor, constant: -24),
            largeur,
            verrou.widthAnchor.constraint(lessThanOrEqualToConstant: 260),
            // Rapport du trace conserve : 240 x 140
            verrou.heightAnchor.constraint(equalTo: verrou.widthAnchor, multiplier: 140.0 / 240.0),
            spinner.centerXAnchor.constraint(equalTo: splashView.centerXAnchor),
            spinner.bottomAnchor.constraint(equalTo: splashView.bottomAnchor, constant: -60),
        ])

        window.addSubview(splashView)
        window.bringSubviewToFront(splashView)

        splashViewController = UIViewController()
        splashViewController?.view = splashView

        // Le verrou est deja visible depuis le storyboard : on ne le ré-anime
        // pas, on annonce seulement le chargement.
        UIView.animate(withDuration: 0.35, delay: 0.45, options: .curveEaseOut) {
            spinner.alpha = 1
        } completion: { _ in
            spinner.startAnimating()
        }
    }

    func hideSplashScreen() {
        guard let splashView = splashViewController?.view else { return }
        if let rootVC = window?.rootViewController as? CAPBridgeViewController {
            UIView.animate(withDuration: 0.3) { rootVC.webView?.alpha = 1 }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
            UIView.animate(withDuration: 0.4, animations: { splashView.alpha = 0 }) { _ in
                splashView.removeFromSuperview()
                self.splashViewController = nil
            }
        }
    }
}

// ============================================
// WEBVIEW NAVIGATION
// ============================================
extension AppDelegate: WKNavigationDelegate {

    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = navigationAction.request.url,
           let scheme = url.scheme?.lowercased() {
            let externalSchemes = ["tel", "telprompt", "sms", "mailto", "facetime", "facetime-audio"]
            if externalSchemes.contains(scheme) {
                UIApplication.shared.open(url, options: [:], completionHandler: nil)
                decisionHandler(.cancel)
                return
            }
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        disablePullToRefresh(on: webView)

        let bridgeJS = """
        window._syncTokenToNative = function(token) {
            window.webkit && window.webkit.messageHandlers &&
            window.webkit.messageHandlers.tokenSync &&
            window.webkit.messageHandlers.tokenSync.postMessage(token);
        };

        (function() {
            var _originalSetItem = localStorage.setItem.bind(localStorage);
            localStorage.setItem = function(key, value) {
                _originalSetItem(key, value);
                if (key === 'lcc_token' && value && value !== 'undefined' && value !== 'null') {
                    window._syncTokenToNative && window._syncTokenToNative(value);
                    console.log('[Auth] 🔄 Token intercepté et synchronisé vers UserDefaults');
                }
            };
        })();

        // Bridge Face ID natif
        window._checkBiometryAvailable = function(callback) {
            window.webkit.messageHandlers.faceIDCheck.postMessage('check');
            window._faceIDCheckCallback = callback;
        };
        window._authenticateWithFaceID = function(callback) {
            window.webkit.messageHandlers.faceIDAuth.postMessage('auth');
            window._faceIDAuthCallback = callback;
        };
        """
        webView.evaluateJavaScript(bridgeJS, completionHandler: nil)

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            self.restoreTokenIfNeeded(webView: webView)
        }

        let firstLoad = !isWebViewLoaded
        isWebViewLoaded = true

        guard firstLoad else { return }
        print("📱 WebView chargée")

        if let token = pendingFCMToken {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                self.injectFCMToken(token)
            }
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            self.hideSplashScreen()
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        disablePullToRefresh(on: webView)
        print("❌ Erreur WebView: \(error.localizedDescription)")
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { self.hideSplashScreen() }
    }
}

// ============================================
// NOTIFICATIONS + DEEP LINKING
// ============================================
extension AppDelegate: UNUserNotificationCenterDelegate {
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        // L'app est au premier plan : il n'y a rien a compter sur l'icone.
        // L'ancien code incrementait le badge ici, APRES que les deux remises
        // a zero (willEnterForeground / didBecomeActive) soient deja passees :
        // le 1 restait donc colle jusqu'au prochain aller-retour en arriere-plan.
        UIApplication.shared.applicationIconBadgeNumber = 0
        if #available(iOS 14.0, *) {
            completionHandler([.banner, .sound])
        } else {
            completionHandler([.alert, .sound])
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        UIApplication.shared.applicationIconBadgeNumber = 0
        UNUserNotificationCenter.current().removeAllDeliveredNotifications()

        // Navigation geree cote web (push-notifications-handler.js) :
        // un seul routage, une seule table de types.
        completionHandler()
    }
}

// ============================================
// FIREBASE MESSAGING
// ============================================
extension AppDelegate: MessagingDelegate {
    func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        guard let token = fcmToken else { return }
        print("📱 FCM Token reçu: \(token.prefix(20))...")
        DispatchQueue.main.async { self.injectFCMToken(token) }
    }
}

// ============================================
// TOKEN SYNC HANDLER
// ============================================
class TokenSyncHandler: NSObject, WKScriptMessageHandler {
    weak var appDelegate: AppDelegate?

    init(appDelegate: AppDelegate) {
        self.appDelegate = appDelegate
    }

    func userContentController(_ userContentController: WKUserContentController,
                                didReceive message: WKScriptMessage) {
        if let token = message.body as? String, !token.isEmpty,
           token != "undefined", token != "null" {
            appDelegate?.saveTokenToUserDefaults(token)
            print("✅ Token synchronisé JS → UserDefaults")
        }
    }
}

// ============================================
// FACE ID HANDLERS
// ============================================
class FaceIDCheckHandler: NSObject, WKScriptMessageHandler {
    weak var appDelegate: AppDelegate?
    init(appDelegate: AppDelegate) { self.appDelegate = appDelegate }

    func userContentController(_ userContentController: WKUserContentController,
                                didReceive message: WKScriptMessage) {
        let context = LAContext()
        var error: NSError?
        let available = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)
        print("🔍 Face ID disponible: \(available)")

        guard let rootVC = appDelegate?.window?.rootViewController as? CAPBridgeViewController,
              let webView = rootVC.webView else { return }

        let js = "if (window._faceIDCheckCallback) window._faceIDCheckCallback(\(available ? "true" : "false"));"
        webView.evaluateJavaScript(js, completionHandler: nil)
    }
}

class FaceIDAuthHandler: NSObject, WKScriptMessageHandler {
    weak var appDelegate: AppDelegate?
    init(appDelegate: AppDelegate) { self.appDelegate = appDelegate }

    func userContentController(_ userContentController: WKUserContentController,
                                didReceive message: WKScriptMessage) {
        appDelegate?.evaluateBiometry { success, error in
            print("🔐 Face ID résultat: \(success), erreur: \(error ?? "aucune")")
            guard let rootVC = self.appDelegate?.window?.rootViewController as? CAPBridgeViewController,
                  let webView = rootVC.webView else { return }

            let js = "if (window._faceIDAuthCallback) window._faceIDAuthCallback(\(success ? "true" : "false"));"
            webView.evaluateJavaScript(js, completionHandler: nil)
        }
    }
}
