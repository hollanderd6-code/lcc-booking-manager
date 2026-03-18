package com.boostinghost.guest;

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

        webView.addJavascriptInterface(new TokenSyncInterface(), "AndroidAuth");

        webView.post(() -> {
            String token = MainApplication.getToken();

            String bridgeJS =
                "(function() {" +
                "  var _orig = localStorage.setItem.bind(localStorage);" +
                "  localStorage.setItem = function(key, value) {" +
                "    _orig(key, value);" +
                "    if (key === 'lcc_token' && value && value !== 'undefined' && value !== 'null') {" +
                "      window.AndroidAuth && window.AndroidAuth.saveToken(value);" +
                "    }" +
                "  };" +
                "})();" +
                "(function() {" +
                "  var saved = '" + (token != null ? token : "") + "';" +
                "  if (saved && saved.length > 0) {" +
                "    var existing = localStorage.getItem('lcc_token');" +
                "    if (!existing || existing === 'undefined' || existing === 'null') {" +
                "      localStorage.setItem('lcc_token', saved);" +
                "    }" +
                "  }" +
                "})();";

            webView.evaluateJavascript(bridgeJS, null);
        });
    }

    private static class TokenSyncInterface {
        @JavascriptInterface
        public void saveToken(String token) {
            MainApplication.saveToken(token);
        }

        @JavascriptInterface
        public void clearToken() {
            MainApplication.clearToken();
        }
    }
}
