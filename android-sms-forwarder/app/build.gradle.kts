plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}
android {
    namespace = "ir.tankhah.smsforwarder"
    compileSdk = 34
    defaultConfig {
        applicationId = "ir.tankhah.smsforwarder"
        minSdk = 24
        targetSdk = 34
        versionCode = 2
        versionName = "1.1"
    }
    // امضای ثابت (از Secrets گیت‌هاب) تا نسخه‌های بعدی روی نسخهٔ قبلی نصب شوند
    System.getenv("KS_PATH")?.let { path ->
        signingConfigs.getByName("debug").apply {
            storeFile = file(path); storePassword = System.getenv("KS_PASS"); keyAlias = "tankhah"; keyPassword = System.getenv("KS_PASS")
        }
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}
dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.work:work-runtime:2.9.1")
}
