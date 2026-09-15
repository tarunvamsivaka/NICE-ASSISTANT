package com.nice.assistant;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.TextView;

import java.util.Locale;

@SuppressWarnings({"deprecation"})
public class FloatingService extends Service {
    public static final String ACTION_SHOW_BUBBLE = "com.nice.assistant.action.SHOW_BUBBLE";
    public static final String ACTION_STOP_BUBBLE = "com.nice.assistant.action.STOP_BUBBLE";
    public static final String ACTION_START_TIMER = "com.nice.assistant.action.START_TIMER";
    public static final String ACTION_UPDATE_TIMER = "com.nice.assistant.action.UPDATE_TIMER";
    public static final String EXTRA_TIMER_END_MS = "timerEndMs";

    private static final String CHANNEL_ID = "nice_floating";

    private WindowManager windowManager;
    private View floatingView;
    private WindowManager.LayoutParams floatingParams;
    private TextView timerText;

    private final Handler timerHandler = new Handler(Looper.getMainLooper());
    private boolean timerMode = false;
    private long timerEndMs = 0L;
    private boolean timerDone = false;

    private final Runnable timerTick = new Runnable() {
        @Override
        public void run() {
            if (!timerMode || timerText == null) return;
            renderTimerText();
            if (!timerDone) {
                timerHandler.postDelayed(this, 1000L);
            }
        }
    };

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        startForeground(1, buildNotification());
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null && intent.getAction() != null
                ? intent.getAction()
                : ACTION_SHOW_BUBBLE;

        if (ACTION_STOP_BUBBLE.equals(action)) {
            stopSelf();
            return START_NOT_STICKY;
        }

        ensureFloatingView();

        if (ACTION_START_TIMER.equals(action) || ACTION_UPDATE_TIMER.equals(action)) {
            long incomingEnd = intent.getLongExtra(EXTRA_TIMER_END_MS, 0L);
            if (incomingEnd > 0L) {
                timerEndMs = incomingEnd;
                timerDone = false;
            }
            setTimerMode(true);
        } else {
            setTimerMode(false);
        }

        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        stopTimerTicker();
        if (floatingView != null && windowManager != null) {
            windowManager.removeView(floatingView);
        }
        floatingView = null;
        timerText = null;
        floatingParams = null;
    }

    private void ensureFloatingView() {
        if (floatingView != null) {
            if (timerText != null) renderTimerText();
            return;
        }

        if (windowManager == null) {
            windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        }

        FrameLayout root = new FrameLayout(this);
        GradientDrawable bubbleBg = new GradientDrawable();
        bubbleBg.setShape(GradientDrawable.OVAL);
        bubbleBg.setColor(Color.parseColor("#CC1A1A2E"));
        bubbleBg.setStroke(dp(1), Color.parseColor("#66A78BFA"));
        root.setBackground(bubbleBg);
        root.setPadding(dp(8), dp(8), dp(8), dp(8));

        ImageView bubbleIcon = new ImageView(this);
        bubbleIcon.setImageResource(R.mipmap.ic_nice_launcher_round);
        bubbleIcon.setAlpha(0.95f);
        FrameLayout.LayoutParams iconParams = new FrameLayout.LayoutParams(dp(44), dp(44), Gravity.CENTER);
        root.addView(bubbleIcon, iconParams);

        timerText = new TextView(this);
        timerText.setTextColor(Color.WHITE);
        timerText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f);
        timerText.setTypeface(Typeface.DEFAULT_BOLD);
        timerText.setGravity(Gravity.CENTER);
        timerText.setSingleLine(true);
        timerText.setEllipsize(TextUtils.TruncateAt.END);
        timerText.setVisibility(View.GONE);

        FrameLayout.LayoutParams timerParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL
        );
        timerParams.bottomMargin = dp(2);
        root.addView(timerText, timerParams);

        floatingView = root;

        int layoutType = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;

        floatingParams = new WindowManager.LayoutParams(
                dp(84),
                dp(84),
                layoutType,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                PixelFormat.TRANSLUCENT
        );
        floatingParams.gravity = Gravity.TOP | Gravity.START;
        floatingParams.x = 0;
        floatingParams.y = dp(160);

        floatingView.setOnTouchListener(new View.OnTouchListener() {
            private int initialX;
            private int initialY;
            private float initialTouchX;
            private float initialTouchY;
            private long touchStartTime;

            @Override
            public boolean onTouch(View v, MotionEvent event) {
                if (floatingParams == null) return false;
                switch (event.getAction()) {
                    case MotionEvent.ACTION_DOWN:
                        initialX = floatingParams.x;
                        initialY = floatingParams.y;
                        initialTouchX = event.getRawX();
                        initialTouchY = event.getRawY();
                        touchStartTime = System.currentTimeMillis();
                        return true;
                    case MotionEvent.ACTION_MOVE:
                        floatingParams.x = initialX + (int) (event.getRawX() - initialTouchX);
                        floatingParams.y = initialY + (int) (event.getRawY() - initialTouchY);
                        if (windowManager != null && floatingView != null) {
                            windowManager.updateViewLayout(floatingView, floatingParams);
                        }
                        return true;
                    case MotionEvent.ACTION_UP:
                        long duration = System.currentTimeMillis() - touchStartTime;
                        if (duration < 220L) {
                            v.performClick();
                            Intent openIntent = new Intent(FloatingService.this, MainActivity.class);
                            openIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                            startActivity(openIntent);
                            stopSelf();
                        }
                        return true;
                    default:
                        return false;
                }
            }
        });

        floatingView.setOnLongClickListener(v -> {
            stopSelf();
            return true;
        });

        if (windowManager != null) {
            windowManager.addView(floatingView, floatingParams);
        }
    }

    private void setTimerMode(boolean enabled) {
        timerMode = enabled;
        if (timerText == null) return;
        if (enabled) {
            timerText.setVisibility(View.VISIBLE);
            renderTimerText();
            startTimerTicker();
        } else {
            timerText.setVisibility(View.GONE);
            stopTimerTicker();
            timerDone = false;
            timerEndMs = 0L;
        }
    }

    private void startTimerTicker() {
        timerHandler.removeCallbacks(timerTick);
        timerHandler.post(timerTick);
    }

    private void stopTimerTicker() {
        timerHandler.removeCallbacks(timerTick);
    }

    private void renderTimerText() {
        if (timerText == null || !timerMode) return;
        long remaining = timerEndMs - System.currentTimeMillis();
        if (remaining <= 0L) {
            timerDone = true;
            timerText.setText(getString(R.string.floating_timer_done));
            stopTimerTicker();
            return;
        }
        timerText.setText(formatRemaining(remaining));
    }

    private String formatRemaining(long remainingMs) {
        long totalSeconds = Math.max(0L, (remainingMs + 999L) / 1000L);
        long hours = totalSeconds / 3600L;
        long minutes = (totalSeconds % 3600L) / 60L;
        long seconds = totalSeconds % 60L;

        if (hours > 0L) {
            return String.format(Locale.US, "%d:%02d:%02d", hours, minutes, seconds);
        }
        return String.format(Locale.US, "%02d:%02d", minutes, seconds);
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Nice Floating Bubble",
                    NotificationManager.IMPORTANCE_LOW
            );
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    private Notification buildNotification() {
        Intent intent = new Intent(this, MainActivity.class);
        PendingIntent pi = PendingIntent.getActivity(
                this,
                0,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);

        return builder
                .setContentTitle("Nice Assistant")
                .setContentText("Floating bubble active - tap to open")
                .setSmallIcon(R.mipmap.ic_nice_launcher)
                .setContentIntent(pi)
                .build();
    }

    private int dp(int value) {
        return Math.round(getResources().getDisplayMetrics().density * value);
    }
}

