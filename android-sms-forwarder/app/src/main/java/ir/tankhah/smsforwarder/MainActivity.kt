package ir.tankhah.smsforwarder

import android.app.DownloadManager
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.print.PrintAttributes
import android.print.PrintManager
import android.util.Base64
import android.view.Menu
import android.view.MenuItem
import android.webkit.*
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity

/** صفحهٔ اصلی: خود برنامهٔ تنخواه (از سرور) داخل یک WebView؛ دریافت پیامک در پس‌زمینه جداست. */
class MainActivity : AppCompatActivity() {
    private lateinit var web: WebView
    private lateinit var p: Prefs
    private var authTries = 0

    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        run {
            val pf = Prefs(this)
            if (pf.enabled) {
                InboxSync.schedulePeriodic(this)
                kotlin.concurrent.thread { InboxSync.scan(this) }
            }
        }
        p = Prefs(this)
        title = "تنخواه"
        web = WebView(this)
        setContentView(web)
        val s = web.settings
        s.javaScriptEnabled = true; s.domStorageEnabled = true; s.allowFileAccess = false
        web.addJavascriptInterface(Bridge(), "AndroidApp")
        web.webViewClient = object : WebViewClient() {
            override fun onReceivedHttpAuthRequest(view: WebView, handler: HttpAuthHandler, host: String?, realm: String?) {
                if (p.password.isNotEmpty() && authTries < 3) { authTries++; handler.proceed("tankhah", p.password) }
                else { handler.cancel(); Toast.makeText(this@MainActivity, "رمز اشتباه است؛ از منو «تنظیمات اپ» رمز را اصلاح کنید", Toast.LENGTH_LONG).show() }
            }
            override fun onPageFinished(view: WebView, url: String?) {
                authTries = 0
                view.evaluateJavascript("window.print=function(){AndroidApp.print()};", null)
            }
            override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
                if (req.url.toString().startsWith(p.url)) return false
                startActivity(Intent(Intent.ACTION_VIEW, req.url)); return true
            }
        }
        web.setDownloadListener { url, _, cd, mime, _ ->
            val r = DownloadManager.Request(Uri.parse(url))
            if (p.password.isNotEmpty()) r.addRequestHeader("Authorization", "Basic " + Base64.encodeToString("tankhah:${p.password}".toByteArray(), Base64.NO_WRAP))
            r.setMimeType(mime)
            r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, URLUtil.guessFileName(url, cd, mime))
            (getSystemService(DOWNLOAD_SERVICE) as DownloadManager).enqueue(r)
            Toast.makeText(this, "دانلود شروع شد؛ در پوشهٔ Downloads گوشی ذخیره می‌شود", Toast.LENGTH_LONG).show()
        }
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { if (web.canGoBack()) web.goBack() else finish() }
        })
    }

    override fun onResume() {
        super.onResume()
        if (p.url.isEmpty()) { startActivity(Intent(this, SettingsActivity::class.java)); return }
        if (web.url == null || !web.url!!.startsWith(p.url)) web.loadUrl(p.url)
    }

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menu.add(0, 1, 0, "بارگذاری مجدد"); menu.add(0, 2, 1, "تنظیمات اپ و پیامک"); return true
    }
    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        when (item.itemId) { 1 -> web.reload(); 2 -> startActivity(Intent(this, SettingsActivity::class.java)) }
        return true
    }

    inner class Bridge {
        @JavascriptInterface fun print() {
            runOnUiThread {
                val pm = getSystemService(PRINT_SERVICE) as PrintManager
                pm.print("tankhah", web.createPrintDocumentAdapter("tankhah"), PrintAttributes.Builder().build())
            }
        }
    }
}
