package com.boostinghost.guest;

import android.app.Application;
import android.content.Context;
import android.content.SharedPreferences;

public class MainApplication extends Application {

    private static final String PREFS_NAME = "lcc_auth";
    private static final String TOKEN_KEY  = "lcc_token";

    private static MainApplication instance;

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
    }

    public static MainApplication getInstance() {
        return instance;
    }

    public static void saveToken(String token) {
        if (token == null || token.isEmpty() || token.equals("undefined") || token.equals("null")) return;
        SharedPreferences prefs = instance.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putString(TOKEN_KEY, token).apply();
        android.util.Log.d("Auth", "💾 Token sauvegardé dans SharedPreferences");
    }

    public static String getToken() {
        SharedPreferences prefs = instance.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        return prefs.getString(TOKEN_KEY, null);
    }

    public static void clearToken() {
        SharedPreferences prefs = instance.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().remove(TOKEN_KEY).apply();
        android.util.Log.d("Auth", "🗑️ Token supprimé de SharedPreferences");
    }
}
