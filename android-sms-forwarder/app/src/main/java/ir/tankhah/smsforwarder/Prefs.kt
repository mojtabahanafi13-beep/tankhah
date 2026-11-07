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

    var lastScan: Long
        get() = sp.getLong("lastScan", 0L)
        set(v) = sp.edit().putLong("lastScan", v).apply()
    var lastScanInfo: String
        get() = sp.getString("lastScanInfo", "") ?: ""
        set(v) = sp.edit().putString("lastScanInfo", v).apply()

    private fun key(o: JSONObject) = o.optString("sender") + "|" + o.optLong("ts") + "|" + o.optString("body")

    fun enqueue(sender: String, body: String, ts: Long) {
        synchronized(LOCK) {
            val arr = JSONArray(sp.getString("queue", "[]"))
            val item = JSONObject().put("sender", sender).put("body", body).put("ts", ts)
            for (i in 0 until arr.length()) if (key(arr.getJSONObject(i)) == key(item)) return
            arr.put(item)
            sp.edit().putString("queue", arr.toString()).commit()
        }
    }
    fun queue(): JSONArray = synchronized(LOCK) { JSONArray(sp.getString("queue", "[]")) }
    /** فقط پیامک‌هایی که با موفقیت ارسال شدند از صف حذف می‌شوند (موارد تازه‌اضافه‌شده دست‌نخورده می‌مانند). */
    fun removeSent(sent: Set<String>) {
        synchronized(LOCK) {
            val arr = JSONArray(sp.getString("queue", "[]")); val left = JSONArray()
            for (i in 0 until arr.length()) { val o = arr.getJSONObject(i); if (!sent.contains(key(o))) left.put(o) }
            sp.edit().putString("queue", left.toString()).commit()
        }
    }
    fun keyOf(o: JSONObject) = key(o)

    companion object { private val LOCK = Any() }
}
