package com.truckai.pro

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

data class TruckAutoState(
    val navigating: Boolean = false,
    val stepInstruction: String = "",
    val distToTurnM: Double = 0.0,
    val remainingSeconds: Long = 0,
    val speedKmh: Double = 0.0,
)

object TruckAutoStore {
    @Volatile
    var state: TruckAutoState = TruckAutoState()
        private set

    private val listeners = mutableSetOf<() -> Unit>()
    private var stopListener: (() -> Unit)? = null

    @Synchronized
    fun update(nextState: TruckAutoState) {
        state = nextState
        listeners.toList().forEach { it() }
    }

    @Synchronized
    fun addListener(listener: () -> Unit) {
        listeners.add(listener)
    }

    @Synchronized
    fun removeListener(listener: () -> Unit) {
        listeners.remove(listener)
    }

    @Synchronized
    fun setStopListener(listener: (() -> Unit)?) {
        stopListener = listener
    }

    fun requestStop() {
        stopListener?.invoke()
    }
}

class TruckAutoModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    init {
        TruckAutoStore.setStopListener {
            if (reactContext.hasActiveReactInstance()) {
                reactContext
                    .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                    .emit("TruckAutoStopRequested", null)
            }
        }
    }

    override fun getName(): String = "TruckAutoModule"

    @ReactMethod
    fun updateNavigation(
        navigating: Boolean,
        stepInstruction: String,
        distToTurnM: Double,
        remainingSeconds: Double,
        speedKmh: Double,
    ) {
        TruckAutoStore.update(
            TruckAutoState(
                navigating = navigating,
                stepInstruction = stepInstruction,
                distToTurnM = distToTurnM.coerceAtLeast(0.0),
                remainingSeconds = remainingSeconds.toLong().coerceAtLeast(0),
                speedKmh = speedKmh.coerceAtLeast(0.0),
            ),
        )
    }

    @ReactMethod
    fun addListener(eventName: String) = Unit

    @ReactMethod
    fun removeListeners(count: Double) = Unit

    override fun invalidate() {
        TruckAutoStore.setStopListener(null)
        super.invalidate()
    }
}
