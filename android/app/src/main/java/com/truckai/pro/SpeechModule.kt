package com.truckai.pro

import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Log
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule

class SpeechModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    private var speechRecognizer: SpeechRecognizer? = null
    private var hasDeliveredResults = false
    private var isStopping = false

    override fun getName(): String = "SpeechModule"

    private fun destroyRecognizer() {
        speechRecognizer?.destroy()
        speechRecognizer = null
    }

    private fun errorMessageForCode(error: Int): String {
        return when (error) {
            SpeechRecognizer.ERROR_AUDIO -> "Проблем с микрофона."
            SpeechRecognizer.ERROR_CLIENT -> "Гласовото разпознаване беше прекъснато."
            SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Липсва разрешение за микрофона."
            SpeechRecognizer.ERROR_NETWORK -> "Проблем с мрежата при разпознаване."
            SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Изтече времето за мрежовата заявка."
            SpeechRecognizer.ERROR_NO_MATCH -> "Не чух ясна команда."
            SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Гласовото разпознаване е заето."
            SpeechRecognizer.ERROR_SERVER -> "Грешка от услугата за разпознаване."
            SpeechRecognizer.ERROR_SERVER_DISCONNECTED -> "Услугата за разпознаване прекъсна."
            SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "Не беше засечена реч."
            SpeechRecognizer.ERROR_TOO_MANY_REQUESTS -> "Твърде много заявки за кратко време."
            else -> "Грешка при разпознаване: $error"
        }
    }

    @ReactMethod
    fun startListening(language: String) {
        reactApplicationContext.runOnUiQueueThread {
            val activity = reactApplicationContext.currentActivity
            val ctx = activity ?: reactApplicationContext
            hasDeliveredResults = false
            isStopping = false
            if (!SpeechRecognizer.isRecognitionAvailable(ctx)) {
                val map = Arguments.createMap()
                map.putString("message", "Speech recognition is not available on this device.")
                sendEvent("onSpeechError", map)
                return@runOnUiQueueThread
            }
            destroyRecognizer()
            speechRecognizer = SpeechRecognizer.createSpeechRecognizer(ctx)
            speechRecognizer?.setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) { sendEvent("onSpeechStart", null) }
                override fun onBeginningOfSpeech() {}
                override fun onRmsChanged(rmsdB: Float) {}
                override fun onBufferReceived(buffer: ByteArray?) {}
                override fun onEndOfSpeech() { sendEvent("onSpeechEnd", null) }
                override fun onError(error: Int) {
                    val shouldIgnore =
                        (hasDeliveredResults && error == SpeechRecognizer.ERROR_NO_MATCH) ||
                        (isStopping && (
                            error == SpeechRecognizer.ERROR_CLIENT ||
                            error == SpeechRecognizer.ERROR_NO_MATCH ||
                            error == SpeechRecognizer.ERROR_SERVER_DISCONNECTED
                        ))

                    destroyRecognizer()
                    isStopping = false
                    if (shouldIgnore) {
                        return
                    }

                    val map = Arguments.createMap()
                    map.putInt("code", error)
                    map.putString("message", errorMessageForCode(error))
                    sendEvent("onSpeechError", map)
                }
                override fun onResults(results: Bundle?) {
                    val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                    if (matches != null && matches.size > 0) {
                        hasDeliveredResults = true
                        val map = Arguments.createMap()
                        val array = Arguments.createArray()
                        for (match in matches) array.pushString(match)
                        map.putArray("value", array)
                        sendEvent("onSpeechResults", map)
                    }
                    destroyRecognizer()
                    isStopping = false
                }
                override fun onPartialResults(partialResults: Bundle?) {}
                override fun onEvent(eventType: Int, params: Bundle?) {}
            })
            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, language)
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
            intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, 4000L)
            intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 2500L)
            intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 2000L)
            try {
                speechRecognizer?.startListening(intent)
            } catch (error: Exception) {
                Log.e("SpeechModule", "Failed to start listening", error)
                destroyRecognizer()
                val map = Arguments.createMap()
                map.putString("message", error.message ?: "Failed to start speech recognition.")
                sendEvent("onSpeechError", map)
            }
        }
    }

    @ReactMethod
    fun stopListening() {
        reactApplicationContext.runOnUiQueueThread {
            isStopping = true
            speechRecognizer?.stopListening()
        }
    }

    private fun sendEvent(eventName: String, params: WritableMap?) {
        reactApplicationContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(eventName, params)
    }
}
