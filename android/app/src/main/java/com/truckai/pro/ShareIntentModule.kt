package com.truckai.pro

import android.content.Intent
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class ShareIntentModule(private val reactContext: ReactApplicationContext)
    : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "ShareIntent"

    @ReactMethod
    fun getInitialShare(promise: Promise) {
        val intent = reactContext.currentActivity?.intent
        val result = Arguments.createMap()
        result.putString("action", intent?.action ?: "")
        result.putString("text", extractSharedText(intent))
        result.putString("url", intent?.dataString ?: "")
        promise.resolve(result)
    }

    @ReactMethod
    fun clearInitialShare(promise: Promise) {
        val activity = reactContext.currentActivity
        val current = activity?.intent
        if (activity != null && current != null) {
            val cleared = Intent(current)
            cleared.action = Intent.ACTION_MAIN
            cleared.data = null
            cleared.removeExtra(Intent.EXTRA_TEXT)
            cleared.removeExtra(Intent.EXTRA_SUBJECT)
            activity.setIntent(cleared)
        }
        promise.resolve(true)
    }

    private fun extractSharedText(intent: Intent?): String {
        if (intent == null) return ""
        val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()
        if (!text.isNullOrBlank()) return text
        val subject = intent.getCharSequenceExtra(Intent.EXTRA_SUBJECT)?.toString()
        return subject ?: ""
    }
}
