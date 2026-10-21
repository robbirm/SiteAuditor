# Keep the JavaScript bridge methods if you ever turn on minification.
-keepclassmembers class com.robgames.snailchess.MainActivity$Bridge {
    @android.webkit.JavascriptInterface <methods>;
}
