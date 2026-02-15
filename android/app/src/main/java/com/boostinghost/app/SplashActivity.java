package com.boostinghost.app;

import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.animation.ObjectAnimator;
import android.animation.AnimatorSet;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.animation.DecelerateInterpolator;
import android.view.animation.OvershootInterpolator;
import android.widget.ProgressBar;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;

public class SplashActivity extends AppCompatActivity {

    private static final String BRAND_TEXT = "BOOSTINGHOST";
    private final Handler handler = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_splash);

        View logoContainer = findViewById(R.id.logoContainer);
        TextView logoText   = findViewById(R.id.logoText);
        TextView brandName  = findViewById(R.id.brandName);
        TextView tagline    = findViewById(R.id.tagline);
        ProgressBar spinner = findViewById(R.id.spinner);

        // État initial : tout invisible + logoContainer réduit
        logoContainer.setScaleX(0.4f);
        logoContainer.setScaleY(0.4f);
        logoContainer.setAlpha(0f);
        logoText.setAlpha(0f);
        brandName.setAlpha(0f);
        tagline.setAlpha(0f);
        spinner.setAlpha(0f);

        // ── Étape 1 : Spring du logo (150ms délai)
        handler.postDelayed(() -> {
            // Scale X
            ObjectAnimator scaleX = ObjectAnimator.ofFloat(logoContainer, "scaleX", 0.4f, 1f);
            scaleX.setDuration(500);
            scaleX.setInterpolator(new OvershootInterpolator(0.6f));
            // Scale Y
            ObjectAnimator scaleY = ObjectAnimator.ofFloat(logoContainer, "scaleY", 0.4f, 1f);
            scaleY.setDuration(500);
            scaleY.setInterpolator(new OvershootInterpolator(0.6f));
            // Fade in container
            ObjectAnimator fadeContainer = ObjectAnimator.ofFloat(logoContainer, "alpha", 0f, 1f);
            fadeContainer.setDuration(300);
            // Fade in B
            ObjectAnimator fadeB = ObjectAnimator.ofFloat(logoText, "alpha", 0f, 1f);
            fadeB.setDuration(300);

            AnimatorSet set = new AnimatorSet();
            set.playTogether(scaleX, scaleY, fadeContainer, fadeB);
            set.start();

            // ── Étape 2 : Pulse du logo
            handler.postDelayed(this::startPulse, 500);

            // ── Étape 3 : Fade in brand name (200ms après logo)
            handler.postDelayed(() -> {
                ObjectAnimator fadeBrand = ObjectAnimator.ofFloat(brandName, "alpha", 0f, 1f);
                fadeBrand.setDuration(400);
                fadeBrand.start();

                // ── Étape 4 : Typewriter "BOOSTINGHOST"
                handler.postDelayed(() -> startTypewriter(brandName, tagline, spinner), 100);
            }, 700);

        }, 150);
    }

    private void startPulse(View logoContainer) {
        // Pas de référence directe ici, on pulse via la méthode
        View v = findViewById(R.id.logoContainer);
        if (v == null) return;

        ObjectAnimator pulseX = ObjectAnimator.ofFloat(v, "scaleX", 1f, 1.08f, 1f);
        ObjectAnimator pulseY = ObjectAnimator.ofFloat(v, "scaleY", 1f, 1.08f, 1f);
        pulseX.setDuration(900);
        pulseY.setDuration(900);
        pulseX.setRepeatCount(ObjectAnimator.INFINITE);
        pulseY.setRepeatCount(ObjectAnimator.INFINITE);

        AnimatorSet pulse = new AnimatorSet();
        pulse.playTogether(pulseX, pulseY);
        pulse.start();
    }

    private void startPulse() {
        startPulse(null);
    }

    private void startTypewriter(TextView brandName, TextView tagline, ProgressBar spinner) {
        brandName.setText("");
        final int[] index = {0};
        final long charDelay = 70; // ms par caractère

        Runnable typeNext = new Runnable() {
            @Override
            public void run() {
                if (index[0] <= BRAND_TEXT.length()) {
                    brandName.setText(BRAND_TEXT.substring(0, index[0]));
                    index[0]++;
                    handler.postDelayed(this, charDelay);
                } else {
                    // Typewriter terminé → fade in tagline + spinner
                    handler.postDelayed(() -> {
                        ObjectAnimator fadeTagline = ObjectAnimator.ofFloat(tagline, "alpha", 0f, 1f);
                        fadeTagline.setDuration(400);
                        fadeTagline.start();

                        handler.postDelayed(() -> {
                            ObjectAnimator fadeSpinner = ObjectAnimator.ofFloat(spinner, "alpha", 0f, 1f);
                            fadeSpinner.setDuration(400);
                            fadeSpinner.start();
                        }, 150);

                        // ── Étape 5 : Lancer MainActivity après 1.5s
                        handler.postDelayed(() -> {
                            ObjectAnimator fadeOut = ObjectAnimator.ofFloat(
                                    findViewById(android.R.id.content), "alpha", 1f, 0f);
                            fadeOut.setDuration(350);
                            fadeOut.addListener(new AnimatorListenerAdapter() {
                                @Override
                                public void onAnimationEnd(Animator animation) {
                                    Intent intent = new Intent(SplashActivity.this, MainActivity.class);
                                    startActivity(intent);
                                    finish();
                                    overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out);
                                }
                            });
                            fadeOut.start();
                        }, 1500);

                    }, 100);
                }
            }
        };
        handler.post(typeNext);
    }
}
