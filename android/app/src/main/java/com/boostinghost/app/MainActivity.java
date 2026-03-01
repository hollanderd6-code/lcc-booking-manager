package com.boostinghost.app;

import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onStart() {
        super.onStart();
        setupAuthBridge();
    }

    private void setupAuthBridge() {
        WebView webView = getBridge().getWebView();
        if (webView == null) return;

        // ── 1. Ajouter le JavascriptInterface pour recevoir le token depuis le JS
        webView.addJavascriptInterface(new TokenSyncInterface(), "AndroidAuth");

        // ── 2. Injecter le JS bridge + restauration du token (comme AppDelegate.webView didFinish)
        webView.post(() -> {
            String token = MainApplication.getToken();

            String bridgeJS =
                    // Intercepte localStorage.setItem pour synchroniser vers Android
                    "(function() {" +
                            "  var _orig = localStorage.setItem.bind(localStorage);" +
                            "  localStorage.setItem = function(key, value) {" +
                            "    _orig(key, value);" +
                            "    if (key === 'lcc_token' && value && value !== 'undefined' && value !== 'null') {" +
                            "      window.AndroidAuth && window.AndroidAuth.saveToken(value);" +
                            "      console.log('[Auth] 🔄 Token synchronisé vers SharedPreferences');" +
                            "    }" +
                            "  };" +
                            "})();" +

                            // Restaure le token si localStorage est vide
                            "(function() {" +
                            "  var saved = '" + (token != null ? token : "") + "';" +
                            "  if (saved && saved.length > 0) {" +
                            "    var existing = localStorage.getItem('lcc_token');" +
                            "    if (!existing || existing === 'undefined' || existing === 'null') {" +
                            "      localStorage.setItem('lcc_token', saved);" +
                            "      console.log('[Auth] ✅ Token restauré depuis SharedPreferences');" +
                            "    }" +
                            "  }" +
                            "})();";

            webView.evaluateJavascript(bridgeJS, null);
        });
    }

    // ── Interface JS → Java pour recevoir le token
    private static class TokenSyncInterface {
        @JavascriptInterface
        public void saveToken(String token) {
            MainApplication.saveToken(token);
            android.util.Log.d("Auth", "✅ Token reçu depuis JS → SharedPreferences");
        }

        @JavascriptInterface
        public void clearToken() {
            MainApplication.clearToken();
        }
    }
}