package ir.mojtabahanafi.tankhah

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.webkit.WebView

class BluBankSmsReceiver(private val webView: WebView?) : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (Telephony.Sms.Intents.SMS_RECEIVED_ACTION == intent.action) {
            val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
            val fullBody = StringBuilder()
            for (msg in messages) {
                fullBody.append(msg.messageBody)
            }
            val smsText = fullBody.toString()
            if (smsText.contains("بلو") || smsText.contains("برداشت") || smsText.contains("واریز")) {
                val prefs = context.getSharedPreferences("tankhah_sms_queue", Context.MODE_PRIVATE)
                val existing = prefs.getString("pending_sms", "") ?: ""
                prefs.edit().putString("pending_sms", existing + "\n\n" + smsText).apply()

                val escaped = smsText.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n")
                webView?.post {
                    webView.evaluateJavascript("window.onBluBankSmsReceived('$escaped');", null)
                }
            }
        }
    }
}
