import UIKit
import Capacitor
import WebKit
import FirebaseCore
import FirebaseMessaging
import UserNotifications

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?
    var splashViewController: UIViewController?
    var isWebViewLoaded = false

    // ✅ Fonction centralisée pour désactiver le pull-to-refresh
    private func disablePullToRefresh(on webView: WKWebView) {
        let sv = webView.scrollView
        sv.bounces = false
        sv.alwaysBounceVertical = false
        sv.refreshControl = nil
        if #available(iOS 11.0, *) {
            sv.contentInsetAdjustmentBehavior = .never
        }
    }

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {

        // ✅ Configurer Firebase
        FirebaseApp.configure()
        
        // ✅ Configurer les notifications
        UNUserNotificationCenter.current().delegate = self
        Messaging.messaging().delegate = self
        
        // Demander la permission notifications
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, error in
            print("📱 Notifications autorisées: \(granted)")
            if granted {
                DispatchQueue.main.async {
                    application.registerForRemoteNotifications()
                }
            }
        }

        // Couleur violette #7c3aed
        let purpleColor = UIColor(red: 0.486, green: 0.227, blue: 0.929, alpha: 1.0)

        // Créer la fenêtre principale
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.backgroundColor = purpleColor

        // Créer le Bridge Capacitor
        let capVC = CAPBridgeViewController()
        capVC.view.backgroundColor = purpleColor
        capVC.view.isOpaque = true

        // WebView avec fond violet et opaque
        if let webView = capVC.webView {
            webView.backgroundColor = purpleColor
            webView.isOpaque = true
            webView.scrollView.backgroundColor = purpleColor
            webView.scrollView.bounces = false
            webView.scrollView.alwaysBounceVertical = false
            webView.scrollView.refreshControl = nil
            webView.alpha = 0
            webView.navigationDelegate = self
        }

        window.rootViewController = capVC
        self.window = window
        window.makeKeyAndVisible()

        // 🎨 Splash screen animé par-dessus
        createAndShowSplashScreen()

        return true
    }

    // ✅ BADGE : Remettre à 0 quand l'app passe au premier plan
    func applicationWillEnterForeground(_ application: UIApplication) {
        application.applicationIconBadgeNumber = 0
        UNUserNotificationCenter.current().removeAllDeliveredNotifications()
        print("📱 Badge remis à 0 (foreground)")
    }
    
    func applicationDidBecomeActive(_ application: UIApplication) {
        application.applicationIconBadgeNumber = 0
        print("📱 Badge remis à 0 (active)")
    }

    // ✅ Enregistrement APNs token
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Messaging.messaging().apnsToken = deviceToken
        let tokenString = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
        print("📱 APNs token: \(tokenString)")
    }
    
    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        print("❌ Erreur APNs: \(error.localizedDescription)")
    }

    // ============================================
    // SPLASH SCREEN ANIMÉ - VERSION GUEST
    // ============================================

    func createAndShowSplashScreen() {
        let purpleColor = UIColor(red: 0.486, green: 0.227, blue: 0.929, alpha: 1.0)
        guard let window = self.window else { return }

        // --- Conteneur principal ---
        let splashView = UIView(frame: window.bounds)
        splashView.backgroundColor = purpleColor
        splashView.autoresizingMask = [.flexibleWidth, .flexibleHeight]

        // --- Cercle fond blanc semi-transparent ---
        let circleSize: CGFloat = 112
        let circleView = UIView()
        circleView.backgroundColor = UIColor.white.withAlphaComponent(0.15)
        circleView.layer.cornerRadius = circleSize / 2
        circleView.translatesAutoresizingMaskIntoConstraints = false

        // --- Logo B ---
        let logoLabel = UILabel()
        logoLabel.text = "B"
        logoLabel.textAlignment = .center
        logoLabel.font = UIFont.systemFont(ofSize: 72, weight: .heavy)
        logoLabel.textColor = .white
        logoLabel.translatesAutoresizingMaskIntoConstraints = false

        // --- Brand name (texte lettre par lettre) ---
        let brandLabel = UILabel()
        brandLabel.text = ""
        brandLabel.textAlignment = .center
        brandLabel.font = UIFont.systemFont(ofSize: 24, weight: .bold)
        brandLabel.textColor = .white
        brandLabel.alpha = 0
        brandLabel.translatesAutoresizingMaskIntoConstraints = false

        // --- Tagline ---
        let taglineLabel = UILabel()
        taglineLabel.text = "GUEST"
        taglineLabel.textAlignment = .center
        taglineLabel.font = UIFont.systemFont(ofSize: 13, weight: .medium)
        taglineLabel.textColor = UIColor.white.withAlphaComponent(0.70)
        taglineLabel.alpha = 0
        taglineLabel.translatesAutoresizingMaskIntoConstraints = false

        // --- Spinner ---
        let spinner = UIActivityIndicatorView(style: .medium)
        spinner.color = UIColor.white.withAlphaComponent(0.80)
        spinner.alpha = 0
        spinner.translatesAutoresizingMaskIntoConstraints = false

        // Ajout des vues
        splashView.addSubview(circleView)
        splashView.addSubview(logoLabel)
        splashView.addSubview(brandLabel)
        splashView.addSubview(taglineLabel)
        splashView.addSubview(spinner)

        // Contraintes
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

        // État initial (invisible pour animation)
        logoLabel.alpha = 0
        logoLabel.transform = CGAffineTransform(scaleX: 0.4, y: 0.4)
        circleView.alpha = 0
        circleView.transform = CGAffineTransform(scaleX: 0.4, y: 0.4)

        // Ajouter dans la fenêtre par-dessus tout
        window.addSubview(splashView)
        window.bringSubviewToFront(splashView)

        // Garder une référence pour hideSplashScreen()
        splashViewController = UIViewController()
        splashViewController?.view = splashView

        print("✅ Splash screen animé affiché (GUEST)")

        // ============================================
        // ANIMATIONS
        // ============================================

        // 1. Le B arrive avec effet spring
        UIView.animate(
            withDuration: 0.65,
            delay: 0.15,
            usingSpringWithDamping: 0.6,
            initialSpringVelocity: 0.8,
            options: .curveEaseOut
        ) {
            logoLabel.alpha = 1
            logoLabel.transform = .identity
            circleView.alpha = 1
            circleView.transform = .identity
        } completion: { _ in

            // 2. Légère pulsation du cercle
            UIView.animate(withDuration: 0.3, delay: 0, options: [.autoreverse, .curveEaseInOut]) {
                circleView.transform = CGAffineTransform(scaleX: 1.08, y: 1.08)
            } completion: { _ in
                circleView.transform = .identity
            }

            // 3. Fade in du brandLabel avant typewriter
            UIView.animate(withDuration: 0.2, delay: 0.15) {
                brandLabel.alpha = 1
            }

            // 4. Écriture lettre par lettre
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                let brandText = "BOOSTINGHOST"
                var charIndex = 0

                // Utilise un Timer stocké localement (capturé par le bloc)
                var timer: Timer?
                timer = Timer.scheduledTimer(withTimeInterval: 0.07, repeats: true) { t in
                    charIndex += 1
                    brandLabel.text = String(brandText.prefix(charIndex))

                    if charIndex >= brandText.count {
                        t.invalidate()

                        // 5. Tagline fade in
                        UIView.animate(withDuration: 0.4, delay: 0.1) {
                            taglineLabel.alpha = 1
                        }

                        // 6. Spinner apparaît
                        UIView.animate(withDuration: 0.4, delay: 0.25) {
                            spinner.alpha = 1
                        } completion: { _ in
                            spinner.startAnimating()
                        }
                    }
                }
                _ = timer // évite le warning "unused variable"
            }
        }
    }

    func hideSplashScreen() {
        guard let splashView = splashViewController?.view else { return }

        print("🎬 Masquage du splash")

        // Rendre la WebView visible
        if let rootVC = window?.rootViewController as? CAPBridgeViewController {
            UIView.animate(withDuration: 0.3) {
                rootVC.webView?.alpha = 1
            }
        }

        // Masquer le splash avec une transition fluide
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
            UIView.animate(withDuration: 0.4, animations: {
                splashView.alpha = 0
            }) { _ in
                splashView.removeFromSuperview()
                self.splashViewController = nil
                print("✨ Splash masqué")
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

        guard !isWebViewLoaded else { return }
        isWebViewLoaded = true

        print("📱 WebView chargée — masquage splash dans 1.5s")

        // ✅ 1.5 secondes
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            self.hideSplashScreen()
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        disablePullToRefresh(on: webView)
        print("❌ Erreur WebView: \(error.localizedDescription)")
        
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
            self.hideSplashScreen()
        }
    }
}

// ============================================
// NOTIFICATIONS
// ============================================
extension AppDelegate: UNUserNotificationCenterDelegate {
    
    // Notification reçue quand l'app est au premier plan
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        if #available(iOS 14.0, *) {
            completionHandler([.banner, .badge, .sound])
        } else {
            completionHandler([.alert, .badge, .sound])
        }
    }
    
    // L'utilisateur tape sur une notification
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        UIApplication.shared.applicationIconBadgeNumber = 0
        
        let userInfo = response.notification.request.content.userInfo
        print("📱 Notification tapée: \(userInfo)")
        
        completionHandler()
    }
}

// ============================================
// FIREBASE MESSAGING
// ============================================
extension AppDelegate: MessagingDelegate {
    func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        guard let token = fcmToken else { return }
        print("📱 FCM Token: \(token)")
        
        // Envoyer le token à la WebView pour que le JS puisse l'enregistrer sur le serveur
        if let rootVC = window?.rootViewController as? CAPBridgeViewController,
           let webView = rootVC.webView {
            let js = "window.fcmToken = '\(token)'; if(window.onFCMToken) window.onFCMToken('\(token)');"
            webView.evaluateJavaScript(js) { _, error in
                if let error = error {
                    print("❌ Erreur injection FCM token: \(error)")
                }
            }
        }
    }
}

