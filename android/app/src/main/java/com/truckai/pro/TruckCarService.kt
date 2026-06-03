package com.truckai.pro

import android.content.Intent
import androidx.car.app.CarAppService
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.Session
import androidx.car.app.model.Distance
import androidx.car.app.model.Template
import androidx.car.app.navigation.NavigationManager
import androidx.car.app.navigation.NavigationManagerCallback
import androidx.car.app.navigation.model.Maneuver
import androidx.car.app.navigation.model.MessageInfo
import androidx.car.app.navigation.model.NavigationTemplate
import androidx.car.app.navigation.model.RoutingInfo
import androidx.car.app.navigation.model.Step
import androidx.car.app.navigation.model.TravelEstimate
import androidx.car.app.validation.HostValidator
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import java.time.ZonedDateTime

class TruckCarService : CarAppService() {
    override fun createHostValidator(): HostValidator =
        if (BuildConfig.DEBUG) {
            HostValidator.ALLOW_ALL_HOSTS_VALIDATOR
        } else {
            // Production hosts must be explicitly allowlisted before store release.
            HostValidator.Builder(this).build()
        }

    override fun onCreateSession(): Session = TruckCarSession()
}

private class TruckCarSession : Session() {
    override fun onCreateScreen(intent: Intent): Screen = TruckCarScreen(carContext)
}

private class TruckCarScreen(carContext: CarContext) : Screen(carContext) {
    private val navigationManager = carContext.getCarService(NavigationManager::class.java)
    private val storeListener: () -> Unit = { invalidate() }
    private var navigationStarted = false

    init {
        TruckAutoStore.addListener(storeListener)
        navigationManager.setNavigationManagerCallback(
            object : NavigationManagerCallback {
                override fun onStopNavigation() {
                    TruckAutoStore.requestStop()
                }
            },
        )
        lifecycle.addObserver(
            object : DefaultLifecycleObserver {
                override fun onDestroy(owner: LifecycleOwner) {
                    TruckAutoStore.removeListener(storeListener)
                    if (navigationStarted) navigationManager.navigationEnded()
                }
            },
        )
    }

    override fun onGetTemplate(): Template {
        val state = TruckAutoStore.state
        syncNavigationState(state.navigating)

        val builder = NavigationTemplate.Builder()
        if (!state.navigating) {
            return builder
                .setNavigationInfo(MessageInfo.Builder("Няма активен маршрут").build())
                .build()
        }

        val distance = Distance.create(state.distToTurnM, Distance.UNIT_METERS)
        val step = Step.Builder(state.stepInstruction.ifBlank { "Продължете по маршрута" })
            .setManeuver(Maneuver.Builder(Maneuver.TYPE_UNKNOWN).build())
            .build()
        val routingInfo = RoutingInfo.Builder()
            .setCurrentStep(step, distance)
            .build()
        val estimate = TravelEstimate.Builder(
            distance,
            ZonedDateTime.now().plusSeconds(state.remainingSeconds),
        )
            .setRemainingTimeSeconds(state.remainingSeconds)
            .build()

        return builder
            .setNavigationInfo(routingInfo)
            .setDestinationTravelEstimate(estimate)
            .build()
    }

    private fun syncNavigationState(navigating: Boolean) {
        if (navigating && !navigationStarted) {
            navigationManager.navigationStarted()
            navigationStarted = true
        } else if (!navigating && navigationStarted) {
            navigationManager.navigationEnded()
            navigationStarted = false
        }
    }
}
