package ir.tankhah.smsforwarder

import android.content.Context
import androidx.work.*
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** ارسال صف پیامک‌ها به سرور تنخواه؛ در صورت نبودن شبکه خودکار دوباره تلاش می‌کند. */
class Uploader(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {
    override fun doWork(): Result {
        val p = Prefs(applicationContext)
        if (p.url.isEmpty() || p.token.isEmpty()) return Result.failure()
        val q = p.queue(); val left = JSONArray()
        var retry = false
        for (i in 0 until q.length()) {
            val m = q.getJSONObject(i)
            when (post(p, m)) {
                "ok" -> {}
                "retry" -> { left.put(m); retry = true }
                else -> {} // خطای دائمی (مثلاً توکن اشتباه): پیامک حذف نمی‌شود تا کاربر تنظیمات را اصلاح کند
            }
        }
        p.setQueue(left)
        return if (retry) Result.retry() else Result.success()
    }

    private fun post(p: Prefs, m: JSONObject): String {
        return try {
            val c = URL(p.url + "/api/sms/ingest").openConnection() as HttpURLConnection
            c.requestMethod = "POST"; c.connectTimeout = 10000; c.readTimeout = 15000; c.doOutput = true
            c.setRequestProperty("Content-Type", "application/json; charset=utf-8"); c.setRequestProperty("X-Token", p.token)
            c.outputStream.use { it.write(m.toString().toByteArray(Charsets.UTF_8)) }
            val code = c.responseCode
            val text = (if (code in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.readText() ?: ""
            when {
                code in 200..299 -> { p.lastStatus = "ارسال شد: " + text.take(120); "ok" }
                code == 401 -> { p.lastStatus = "توکن اشتباه است"; "keep" }
                code >= 500 -> { p.lastStatus = "خطای سرور ($code)"; "retry" }
                else -> { p.lastStatus = "خطا $code"; "keep" }
            }
        } catch (e: Exception) { p.lastStatus = "سرور در دسترس نیست؛ بعداً دوباره تلاش می‌شود"; "retry" }
    }

    companion object {
        fun schedule(ctx: Context) {
            val req = OneTimeWorkRequestBuilder<Uploader>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.LINEAR, 30, java.util.concurrent.TimeUnit.SECONDS).build()
            WorkManager.getInstance(ctx).enqueueUniqueWork("upload", ExistingWorkPolicy.APPEND_OR_REPLACE, req)
        }
    }
}
