package ir.mojtabahanafi.tankhah

import android.Manifest
import android.content.Context
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Bundle
import android.provider.Telephony
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private lateinit var smsReceiver: BluBankSmsReceiver

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        webView = WebView(this)
        setContentView(webView)

        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECEIVE_SMS) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.RECEIVE_SMS, Manifest.permission.READ_SMS), 101)
        }

        smsReceiver = BluBankSmsReceiver(webView)
        registerReceiver(smsReceiver, IntentFilter(Telephony.Sms.Intents.SMS_RECEIVED_ACTION))

        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                flushPendingSms()
            }
        }

        webView.loadUrl("file:///android_asset/petty_cash_app.html")
    }

    private fun flushPendingSms() {
        val prefs = getSharedPreferences("tankhah_sms_queue", Context.MODE_PRIVATE)
        val pending = prefs.getString("pending_sms", "") ?: ""
        if (pending.isNotBlank()) {
            val escaped = pending.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n")
            webView.evaluateJavascript("window.onBluBankSmsReceived('$escaped');", null)
            prefs.edit().remove("pending_sms").apply()
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        unregisterReceiver(smsReceiver)
    }
}
