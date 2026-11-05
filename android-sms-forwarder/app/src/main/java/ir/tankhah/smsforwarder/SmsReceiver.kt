package ir.tankhah.smsforwarder

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony

class SmsReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        val msgs = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
        if (msgs.isEmpty()) return
        val p = Prefs(ctx)
        if (!p.enabled) return
        val sender = msgs[0].originatingAddress ?: ""
        val body = msgs.joinToString("") { it.messageBody ?: "" }
        if (!p.matches(sender, body)) return
        p.enqueue(sender, body, System.currentTimeMillis())
        Uploader.schedule(ctx)
    }
}
