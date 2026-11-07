package ir.tankhah.smsforwarder

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import androidx.core.content.ContextCompat
import androidx.work.*
import java.util.concurrent.TimeUnit

/**
 * شبکهٔ اطمینان: علاوه بر دریافت لحظه‌ای، صندوق پیامک گوشی هر ۱۵ دقیقه، هنگام باز شدن اپ و بعد از روشن شدن گوشی
 * بررسی می‌شود تا هیچ پیامک بلویی (حتی وقتی اپ بسته یا گوشی خاموش بوده) از دست نرود. سرور موارد تکراری را نادیده می‌گیرد.
 */
object InboxSync {
    private const val DAY = 24L * 3600 * 1000

    fun hasReadPermission(ctx: Context) =
        ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_SMS) == PackageManager.PERMISSION_GRANTED

    /** پیامک‌های جدیدتر از آخرین اسکن (یا sinceMillis) را در صف ارسال می‌گذارد. تعداد پیامک‌های مرتبط را برمی‌گرداند. */
    fun scan(ctx: Context, sinceMillis: Long? = null): Int {
        val p = Prefs(ctx)
        if (!p.enabled || !hasReadPermission(ctx)) return 0
        val since = sinceMillis ?: (if (p.lastScan > 0) p.lastScan else System.currentTimeMillis() - 30 * DAY)
        var max = since
        var n = 0
        try {
            val c = ctx.contentResolver.query(Uri.parse("content://sms/inbox"), arrayOf("address", "body", "date"),
                "date > ?", arrayOf(since.toString()), "date ASC")
            if (c != null) {
                c.use {
                    while (it.moveToNext()) {
                        val addr = it.getString(0) ?: ""
                        val body = it.getString(1) ?: ""
                        val date = it.getLong(2)
                        if (date > max) max = date
                        if (p.matches(addr, body)) { p.enqueue(addr, body, date); n++ }
                    }
                }
            }
        } catch (e: Exception) {
            p.lastStatus = "خواندن صندوق پیامک ممکن نشد"
            return 0
        }
        p.lastScan = max
        p.lastScanInfo = "آخرین بررسی صندوق پیامک: " + java.text.SimpleDateFormat("MM/dd HH:mm", java.util.Locale.US).format(java.util.Date()) + " (" + n + " پیامک مرتبط)"
        if (n > 0) Uploader.schedule(ctx)
        return n
    }

    /** فرستنده‌هایی که در ۶۰ روز اخیر پیامک مالی (دارای مبلغ/مانده) فرستاده‌اند، همراه با نمونهٔ متن. */
    fun financialSenders(ctx: Context): List<Pair<String, String>> {
        if (!hasReadPermission(ctx)) return emptyList()
        val out = LinkedHashMap<String, String>()
        try {
            val c = ctx.contentResolver.query(Uri.parse("content://sms/inbox"), arrayOf("address", "body"),
                "date > ?", arrayOf((System.currentTimeMillis() - 60 * DAY).toString()), "date DESC")
            if (c != null) {
                c.use {
                    while (it.moveToNext() && out.size < 15) {
                        val addr = it.getString(0) ?: ""
                        val body = it.getString(1) ?: ""
                        if (addr.isNotEmpty() && !out.containsKey(addr) && Regex("ریال|تومان|مانده|موجودی|برداشت|واریز|کاهش|افزایش").containsMatchIn(body))
                            out[addr] = body.replace("\n", " ").take(70)
                    }
                }
            }
        } catch (e: Exception) { }
        return out.map { Pair(it.key, it.value) }
    }

    fun schedulePeriodic(ctx: Context) {
        val req = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES).build()
        WorkManager.getInstance(ctx).enqueueUniquePeriodicWork("inbox-sync", ExistingPeriodicWorkPolicy.KEEP, req)
    }
}

class SyncWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {
    override fun doWork(): Result {
        InboxSync.scan(applicationContext)
        Uploader.schedule(applicationContext)
        return Result.success()
    }
}
