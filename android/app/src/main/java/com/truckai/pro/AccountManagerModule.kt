package com.truckai.pro

import android.accounts.AccountManager
import android.app.Activity
import android.content.Intent
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.google.android.gms.common.AccountPicker
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInOptions
import com.google.android.gms.common.api.ApiException

/**
 * AccountManagerModule — Google AccountPicker native bridge.
 *
 * Launches the system Google account chooser dialog and resolves
 * the selected account email back to JavaScript via a Promise.
 *
 * JS usage:
 *   const email = await NativeModules.AccountManager.pickGoogleAccount()
 */
class AccountManagerModule(private val reactContext: ReactApplicationContext)
    : ReactContextBaseJavaModule(reactContext), ActivityEventListener {

    companion object {
        private const val RC_PICK_ACCOUNT = 0x1A3C
        private const val RC_GOOGLE_SIGN_IN = 0x1A3D
    }

    private var pendingPromise: Promise? = null

    init {
        reactContext.addActivityEventListener(this)
    }

    override fun getName(): String = "AccountManager"

    @ReactMethod
    fun pickGoogleAccount(promise: Promise) {
        val activity = reactContext.currentActivity
        if (activity == null) {
            promise.reject("E_NO_ACTIVITY", "Няма активен екран")
            return
        }
        pendingPromise = promise
        val intent = AccountPicker.newChooseAccountIntent(
            AccountPicker.AccountChooserOptions.Builder()
                .setAllowableAccountsTypes(listOf("com.google"))
                .build()
        )
        activity.startActivityForResult(intent, RC_PICK_ACCOUNT)
    }

    @ReactMethod
    fun signInGoogle(webClientId: String, promise: Promise) {
        val activity = reactContext.currentActivity
        if (activity == null) {
            promise.reject("E_NO_ACTIVITY", "Няма активен екран")
            return
        }
        if (webClientId.isBlank()) {
            promise.reject("E_CONFIG", "GOOGLE_WEB_CLIENT_ID липсва")
            return
        }
        pendingPromise = promise
        val options = GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
            .requestEmail()
            .requestIdToken(webClientId)
            .build()
        val client = GoogleSignIn.getClient(activity, options)
        activity.startActivityForResult(client.signInIntent, RC_GOOGLE_SIGN_IN)
    }

    // ActivityEventListener — non-nullable Activity and Intent per RN interface contract
    override fun onActivityResult(
        activity: Activity,
        requestCode: Int,
        resultCode: Int,
        data: Intent?
    ) {
        if (requestCode != RC_PICK_ACCOUNT && requestCode != RC_GOOGLE_SIGN_IN) return
        val p = pendingPromise ?: return
        pendingPromise = null
        if (requestCode == RC_GOOGLE_SIGN_IN) {
            try {
                val account = GoogleSignIn.getSignedInAccountFromIntent(data)
                    .getResult(ApiException::class.java)
                val idToken = account.idToken
                val email = account.email
                if (!idToken.isNullOrEmpty() && !email.isNullOrEmpty()) {
                    val result = Arguments.createMap()
                    result.putString("email", email)
                    result.putString("idToken", idToken)
                    p.resolve(result)
                } else {
                    p.reject("E_NO_TOKEN", "Google не върна ID token")
                }
            } catch (e: Exception) {
                p.reject("E_SIGN_IN", e.message ?: "Google входът е отказан")
            }
            return
        }
        if (resultCode == Activity.RESULT_OK && data != null) {
            val email = data.getStringExtra(AccountManager.KEY_ACCOUNT_NAME)
            if (!email.isNullOrEmpty()) {
                p.resolve(email)
            } else {
                p.reject("E_NO_EMAIL", "Акаунтът не върна имейл")
            }
        } else {
            p.reject("E_CANCELLED", "Изборът на акаунт е отказан")
        }
    }

    override fun onNewIntent(intent: Intent) {}
}
