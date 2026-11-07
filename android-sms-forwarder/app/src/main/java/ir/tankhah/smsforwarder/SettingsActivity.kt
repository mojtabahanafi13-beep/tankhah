package ir.tankhah.smsforwarder

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

class SettingsActivity : AppCompatActivity() {
    private lateinit var p: Prefs
    private lateinit var status: TextView

    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        p = Prefs(this)
        val pad = (16 * resources.displayMetrics.density).toInt()
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(pad, pad, pad, pad); layoutDirection = View.LAYOUT_DIRECTION_RTL }
        fun label(t: String) = TextView(this).apply { text = t; setPadding(0, pad / 2, 0, 0); gravity = Gravity.START }
        fun input(v: String, hint: String) = EditText(this).apply { setText(v); this.hint = hint; setSingleLine(); textDirection = View.TEXT_DIRECTION_LTR; gravity = Gravity.START }

        val url = input(p.url, "http://192.168.1.10:3100")
        val token = input(p.token, "توکن را از تنظیمات برنامهٔ تنخواه کپی کنید")
        val senders = input(p.senders, "خالی = پیامک‌هایی که «بلو» یا Blu دارند")
        val pass = input(p.password, "رمز ورود برنامه تنخواه (اگر گذاشته‌اید)").apply { inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD }
        val sw = Switch(this).apply { text = "ارسال خودکار پیامک‌ها فعال باشد"; isChecked = p.enabled }
        status = TextView(this).apply { setPadding(0, pad, 0, 0) }

        root.addView(TextView(this).apply { text = "پیامک بانک ← تنخواه"; textSize = 20f })
        root.addView(label("آدرس سرور تنخواه")); root.addView(url)
        root.addView(label("توکن")); root.addView(token)
        root.addView(label("رمز ورود به برنامه")); root.addView(pass)
        root.addView(label("فرستنده‌های مجاز (با ویرگول جدا کنید)")); root.addView(senders)
        root.addView(sw)

        fun save() { p.url = url.text.toString(); p.token = token.text.toString(); p.senders = senders.text.toString(); p.password = pass.text.toString(); p.enabled = sw.isChecked }
        root.addView(Button(this).apply { text = "ذخیره و درخواست مجوز پیامک"; setOnClickListener {
            save()
            if (ContextCompat.checkSelfPermission(this@SettingsActivity, Manifest.permission.RECEIVE_SMS) != PackageManager.PERMISSION_GRANTED ||
                ContextCompat.checkSelfPermission(this@SettingsActivity, Manifest.permission.READ_SMS) != PackageManager.PERMISSION_GRANTED ||
                (android.os.Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this@SettingsActivity, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED))
                ActivityCompat.requestPermissions(this@SettingsActivity, (if (android.os.Build.VERSION.SDK_INT >= 33) arrayOf(Manifest.permission.RECEIVE_SMS, Manifest.permission.READ_SMS, Manifest.permission.POST_NOTIFICATIONS) else arrayOf(Manifest.permission.RECEIVE_SMS, Manifest.permission.READ_SMS)), 1)
            if (p.enabled) InboxSync.schedulePeriodic(this@SettingsActivity)
            refresh()
        } })
        root.addView(Button(this).apply { text = "آزمایش اتصال به سرور"; setOnClickListener { save(); test() } })
        root.addView(Button(this).apply { text = "بررسی صندوق پیامک ۳۰ روز اخیر و ارسال موارد جاافتاده"; setOnClickListener {
            save()
            if (!InboxSync.hasReadPermission(this@SettingsActivity)) { Toast.makeText(this@SettingsActivity, "اول «ذخیره و درخواست مجوز پیامک» را بزنید و مجوز را بدهید", Toast.LENGTH_LONG).show() }
            else thread {
                val n = InboxSync.scan(this@SettingsActivity, System.currentTimeMillis() - 30L * 24 * 3600 * 1000)
                runOnUiThread { Toast.makeText(this@SettingsActivity, "$n پیامک بلو پیدا و برای ارسال آماده شد", Toast.LENGTH_LONG).show(); refresh() }
            }
        } })
        root.addView(Button(this).apply { text = "تشخیص فرستندهٔ پیامک‌های بانکی"; setOnClickListener {
            val list = InboxSync.financialSenders(this@SettingsActivity)
            if (list.isEmpty()) Toast.makeText(this@SettingsActivity, "پیامک مالی‌ای پیدا نشد (مجوز خواندن پیامک داده شده؟)", Toast.LENGTH_LONG).show()
            else android.app.AlertDialog.Builder(this@SettingsActivity).setTitle("فرستندهٔ پیامک بلو را انتخاب کنید")
                .setItems(list.map { it.first + " — " + it.second }.toTypedArray()) { _, i ->
                    val cur = senders.text.toString().trim()
                    senders.setText(if (cur.isEmpty()) list[i].first else cur + "," + list[i].first); save()
                }.show()
        } })
        root.addView(Button(this).apply { text = "حذف محدودیت باتری (برای دریافت مطمئن پیامک)"; setOnClickListener {
            try { startActivity(android.content.Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, android.net.Uri.parse("package:" + packageName))) }
            catch (e: Exception) { startActivity(android.content.Intent(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }
        } })
        root.addView(Button(this).apply { text = "ارسال دوبارهٔ پیامک‌های در صف"; setOnClickListener { save(); Uploader.schedule(this@SettingsActivity); refresh() } })
        root.addView(Button(this).apply { text = "بازگشت به برنامه تنخواه"; setOnClickListener { save(); finish() } })
        root.addView(status)
        setContentView(ScrollView(this).apply { addView(root) })
        refresh()
    }

    override fun onResume() { super.onResume(); refresh() }
    private fun refresh() {
        val perm = ContextCompat.checkSelfPermission(this, Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED
        val rd = InboxSync.hasReadPermission(this)
        status.text = "مجوز دریافت پیامک: " + (if (perm) "داده شده" else "داده نشده") + "\nمجوز خواندن صندوق پیامک: " + (if (rd) "داده شده" else "داده نشده") + "\n" + p.lastScanInfo +
            "\nپیامک در صف ارسال: ${p.queue().length()}\nآخرین وضعیت: ${p.lastStatus}"
    }
    private fun test() {
        status.text = "در حال آزمایش…"
        thread {
            val msg = try {
                val c = URL(p.url + "/api/sms/ping").openConnection() as HttpURLConnection
                c.connectTimeout = 8000; c.readTimeout = 8000; c.setRequestProperty("X-Token", p.token)
                if (c.responseCode == 200) "اتصال موفق بود" else if (c.responseCode == 401) "توکن اشتباه است" else "خطا ${c.responseCode}"
            } catch (e: Exception) { "سرور در دسترس نیست. آدرس و اتصال به همان شبکه را بررسی کنید." }
            runOnUiThread { Toast.makeText(this, msg, Toast.LENGTH_LONG).show(); p.lastStatus = msg; refresh() }
        }
    }
}
