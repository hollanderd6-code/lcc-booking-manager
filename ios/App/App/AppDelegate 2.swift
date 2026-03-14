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
    let brandColor = UIColor(red: 0.102, green: 0.478, blue: 0.369, alpha: 1.0)
    var pendingFCMToken: String? = nil

    private func disablePullToRefresh(on webView: WKWebView) {
        let sv = webView.scrollView
        sv.bounces = false
        sv.alwaysBounceVertical = false
        sv.refreshControl = nil
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
            webView.scrollView.bounces = false
            webView.scrollView.alwaysBounceVertical = false
            webView.scrollView.refreshControl = nil
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
    // SPLASH SCREEN
    // ============================================

    func createAndShowSplashScreen() {
        guard let window = self.window else { return }

        let splashView = UIView(frame: window.bounds)
        splashView.backgroundColor = brandColor
        splashView.autoresizingMask = [.flexibleWidth, .flexibleHeight]

        let circleSize: CGFloat = 112
        let circleView = UIView()
        circleView.backgroundColor = UIColor.white.withAlphaComponent(0.15)
        circleView.layer.cornerRadius = circleSize / 2
        circleView.translatesAutoresizingMaskIntoConstraints = false

        let logoLabel = UILabel()
        logoLabel.text = "B"
        logoLabel.textAlignment = .center
        logoLabel.font = UIFont.systemFont(ofSize: 72, weight: .heavy)
        logoLabel.textColor = .white
        logoLabel.translatesAutoresizingMaskIntoConstraints = false

        let brandLabel = UILabel()
        brandLabel.text = ""
        brandLabel.textAlignment = .center
        brandLabel.font = UIFont.systemFont(ofSize: 24, weight: .bold)
        brandLabel.textColor = .white
        brandLabel.alpha = 0
        brandLabel.translatesAutoresizingMaskIntoConstraints = false

        let taglineLabel = UILabel()
        taglineLabel.text = "SMART PROPERTY MANAGER"
        taglineLabel.textAlignment = .center
        taglineLabel.font = UIFont.systemFont(ofSize: 13, weight: .medium)
        taglineLabel.textColor = UIColor.white.withAlphaComponent(0.70)
        taglineLabel.alpha = 0
        taglineLabel.translatesAutoresizingMaskIntoConstraints = false

        let spinner = UIActivityIndicatorView(style: .medium)
        spinner.color = UIColor.white.withAlphaComponent(0.80)
        spinner.alpha = 0
        spinner.translatesAutoresizingMaskIntoConstraints = false

        splashView.addSubview(circleView)
        splashView.addSubview(logoLabel)
        splashView.addSubview(brandLabel)
        splashView.addSubview(taglineLabel)
        splashView.addSubview(spinner)

        NSLayoutConstraint.activate([
            circleView.centerXAnchor.constraint(equalTo: splashView.centerXAnchor),
            circleView.centerYAnchor.constraint(equalTo: splashView.centerYAnchor, constant: -80),
            circleView.widthAnchor.constraint(equalToConstant: circleSize),
            circleView.heightAnchor.constraint(equalToConstant: circleSize),
            logoLabel.centerXAnchor.constraint(equalTo: splashView.centerXAnchor),
            logoLabel.centerYAnchor.constraint(equalTo: splashView.centerYAnchor, constant: -80),
            logoLabel.widthAnchor.constraint(equalToConstant: circleSize),
            logoLabel.heightAnchor.constraint(equalToConstant: circleSize),
            brandLabel.centerXAnchor.constraint(equalTo: splashView.centerXAnchor),
            brandLabel.topAnchor.constraint(equalTo: logoLabel.bottomAnchor, constant: 28),
            brandLabel.leadingAnchor.constraint(equalTo: splashView.leadingAnchor, constant: 40),
            brandLabel.trailingAnchor.constraint(equalTo: splashView.trailingAnchor, constant: -40),
            taglineLabel.centerXAnchor.constraint(equalTo: splashView.centerXAnchor),
            taglineLabel.topAnchor.constraint(equalTo: brandLabel.bottomAnchor, constant: 8),
            taglineLabel.leadingAnchor.constraint(equalTo: splashView.leadingAnchor, constant: 40),
            taglineLabel.trailingAnchor.constraint(equalTo: splashView.trailingAnchor, constant: -40),
            spinner.centerXAnchor.constraint(equalTo: splashView.centerXAnchor),
            spinner.bottomAnchor.constraint(equalTo: splashView.bottomAnchor, constant: -60),
        ])

        logoLabel.alpha = 0
        logoLabel.transform = CGAffineTransform(scaleX: 0.4, y: 0.4)
        circleView.alpha = 0
        circleView.transform = CGAffineTransform(scaleX: 0.4, y: 0.4)

        window.addSubview(splashView)
        window.bringSubviewToFront(splashView)

        splashViewController = UIViewController()
        splashViewController?.view = splashView

        UIView.animate(withDuration: 0.65, delay: 0.15, usingSpringWithDamping: 0.6, initialSpringVelocity: 0.8, options: .curveEaseOut) {
            logoLabel.alpha = 1; logoLabel.transform = .identity
            circleView.alpha = 1; circleView.transform = .identity
        } completion: { _ in
            UIView.animate(withDuration: 0.3, delay: 0, options: [.autoreverse, .curveEaseInOut]) {
                circleView.transform = CGAffineTransform(scaleX: 1.08, y: 1.08)
            } completion: { _ in circleView.transform = .identity }

            UIView.animate(withDuration: 0.2, delay: 0.15) { brandLabel.alpha = 1 }

            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                let brandText = "BOOSTINGHOST"
                var charIndex = 0
                var timer: Timer?
                timer = Timer.scheduledTimer(withTimeInterval: 0.07, repeats: true) { t in
                    charIndex += 1
                    brandLabel.text = String(brandText.prefix(charIndex))
                    if charIndex >= brandText.count {
                        t.invalidate()
                        UIView.animate(withDuration: 0.4, delay: 0.1) { taglineLabel.alpha = 1 }
                        UIView.animate(withDuration: 0.4, delay: 0.25) { spinner.alpha = 1 } completion: { _ in spinner.startAnimating() }
                    }
                }
                _ = timer
            }
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
        
        guard !isWebViewLoaded else { return }
        isWebViewLoaded = true
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
// NOTIFICATIONS
// ============================================
extension AppDelegate: UNUserNotificationCenterDelegate {
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        let current = UIApplication.shared.applicationIconBadgeNumber
        UIApplication.shared.applicationIconBadgeNumber = current + 1
        if #available(iOS 14.0, *) {
            completionHandler([.banner, .badge, .sound])
        } else {
            completionHandler([.alert, .badge, .sound])
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        UIApplication.shared.applicationIconBadgeNumber = 0
        UNUserNotificationCenter.current().removeAllDeliveredNotifications()
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
