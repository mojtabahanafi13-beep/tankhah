package ir.tankhah.smsforwarder

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** تنظیمات و صف پیامک‌های ارسال‌نشده (برای وقتی که گوشی اینترنت/شبکه ندارد). */
class Prefs(ctx: Context) {
    private val sp = ctx.applicationContext.getSharedPreferences("tankhah", Context.MODE_PRIVATE)

    var url: String
        get() = sp.getString("url", "") ?: ""
        set(v) = sp.edit().putString("url", v.trim().trimEnd('/')).apply()
    var token: String
        get() = sp.getString("token", "") ?: ""
        set(v) = sp.edit().putString("token", v.trim()).apply()
    var password: String
        get() = sp.getString("password", "") ?: ""
        set(v) = sp.edit().putString("password", v).apply()
    var senders: String
        get() = sp.getString("senders", "") ?: ""
        set(v) = sp.edit().putString("senders", v.trim()).apply()
    var enabled: Boolean
        get() = sp.getBoolean("enabled", false)
        set(v) = sp.edit().putBoolean("enabled", v).apply()
    var lastStatus: String
        get() = sp.getString("last", "هنوز پیامکی ارسال نشده") ?: ""
        set(v) = sp.edit().putString("last", v).apply()

    /** فقط پیامکی که فرستنده‌اش در فهرست باشد (یا اگر فهرست خالی است، «بلو/Blu» در فرستنده یا متن باشد) ارسال می‌شود. */
    fun matches(sender: String, body: String): Boolean {
        val list = senders.split(",", "،").map { it.trim() }.filter { it.isNotEmpty() }
        if (list.isNotEmpty()) return list.any { sender.contains(it, ignoreCase = true) }
        return sender.contains("blu", true) || sender.contains("بلو") || body.contains("بلو") || body.contains("blu", true)
    }

    @Synchronized fun enqueue(sender: String, body: String, ts: Long) {
        val arr = JSONArray(sp.getString("queue", "[]"))
        arr.put(JSONObject().put("sender", sender).put("body", body).put("ts", ts))
        sp.edit().putString("queue", arr.toString()).apply()
    }
    @Synchronized fun queue(): JSONArray = JSONArray(sp.getString("queue", "[]"))
    @Synchronized fun setQueue(a: JSONArray) { sp.edit().putString("queue", a.toString()).apply() }
}
