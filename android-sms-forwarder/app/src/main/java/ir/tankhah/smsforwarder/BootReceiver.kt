package ir.tankhah.smsforwarder

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (!Prefs(ctx).enabled) return
        InboxSync.schedulePeriodic(ctx)
        InboxSync.scan(ctx)
        Uploader.schedule(ctx)
    }
}
