package com.truckai.pro

import android.content.ActivityNotFoundException
import android.content.ContentUris
import android.content.Intent
import android.provider.ContactsContract
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class WhatsAppCallModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "WhatsAppCallModule"

  @ReactMethod
  fun startVoiceCall(phoneNumber: String?, contactRecordId: String?, promise: Promise) {
    val voiceCallTarget = findWhatsAppVoiceCallTarget(phoneNumber, contactRecordId?.toLongOrNull())
    if (voiceCallTarget == null) {
      promise.reject("not_whatsapp_contact", "No WhatsApp voice call row found for this contact.")
      return
    }

    val contactUri = ContentUris.withAppendedId(ContactsContract.Data.CONTENT_URI, voiceCallTarget.dataId)
    val intent = Intent(Intent.ACTION_VIEW).apply {
      setDataAndType(contactUri, voiceCallTarget.mimeType)
      setPackage(voiceCallTarget.packageName)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }

    try {
      reactApplicationContext.startActivity(intent)
      promise.resolve(true)
    } catch (_: ActivityNotFoundException) {
      promise.reject("unavailable", "WhatsApp voice call is not available for this contact.")
    } catch (error: Exception) {
      promise.reject("open_failed", error.message ?: "Failed to open WhatsApp voice call.")
    }
  }

  private fun findWhatsAppVoiceCallTarget(
    phoneNumber: String?,
    contactRecordId: Long?,
  ): WhatsAppVoiceCallTarget? {
    if (contactRecordId != null) {
      val contactMatch =
        queryFirstWhatsAppVoiceCallTarget(
          "${ContactsContract.Data.CONTACT_ID} = ?",
          arrayOf(contactRecordId.toString()),
        )
      if (contactMatch != null) {
        return contactMatch
      }
    }

    val targetPhones = phoneVariants(phoneNumber)
    if (targetPhones.isEmpty()) {
      return null
    }

    val cursor =
      reactApplicationContext.contentResolver.query(
        ContactsContract.Data.CONTENT_URI,
        WHATSAPP_DATA_PROJECTION,
        whatsappVoiceCallSelection(),
        WHATSAPP_VOICE_CALL_MIME_TYPES,
        null,
      )

    cursor?.use {
      val idIndex = it.getColumnIndexOrThrow(ContactsContract.Data._ID)
      val mimeTypeIndex = it.getColumnIndexOrThrow(ContactsContract.Data.MIMETYPE)
      val dataIndexes =
        listOf(
          ContactsContract.Data.DATA1,
          ContactsContract.Data.DATA2,
          ContactsContract.Data.DATA3,
          ContactsContract.Data.DATA4,
        ).map(it::getColumnIndex)

      while (it.moveToNext()) {
        val matchesPhone =
          dataIndexes
            .filter { index -> index >= 0 }
            .mapNotNull { index -> it.getString(index) }
            .any { value -> phonesMatch(targetPhones, value) }

        if (matchesPhone) {
          return targetFromDataRow(it.getLong(idIndex), it.getString(mimeTypeIndex))
        }
      }
    }

    return null
  }

  private fun queryFirstWhatsAppVoiceCallTarget(
    extraSelection: String,
    extraSelectionArgs: Array<String>,
  ): WhatsAppVoiceCallTarget? {
    val cursor =
      reactApplicationContext.contentResolver.query(
        ContactsContract.Data.CONTENT_URI,
        arrayOf(ContactsContract.Data._ID, ContactsContract.Data.MIMETYPE),
        whatsappVoiceCallSelection(extraSelection),
        arrayOf(*WHATSAPP_VOICE_CALL_MIME_TYPES, *extraSelectionArgs),
        null,
      )

    cursor?.use {
      if (it.moveToFirst()) {
        return targetFromDataRow(
          it.getLong(it.getColumnIndexOrThrow(ContactsContract.Data._ID)),
          it.getString(it.getColumnIndexOrThrow(ContactsContract.Data.MIMETYPE)),
        )
      }
    }

    return null
  }

  private fun whatsappVoiceCallSelection(extraSelection: String? = null): String {
    val placeholders = WHATSAPP_VOICE_CALL_MIME_TYPES.joinToString(",") { "?" }
    val mimeSelection = "${ContactsContract.Data.MIMETYPE} IN ($placeholders)"
    return if (extraSelection == null) mimeSelection else "$mimeSelection AND $extraSelection"
  }

  private fun targetFromDataRow(dataId: Long, mimeType: String): WhatsAppVoiceCallTarget? {
    val packageName = WHATSAPP_PACKAGE_BY_MIME_TYPE[mimeType] ?: return null
    return WhatsAppVoiceCallTarget(dataId, mimeType, packageName)
  }

  private fun phonesMatch(targetPhones: Set<String>, candidate: String): Boolean {
    val candidatePhones = phoneVariants(candidate)
    return candidatePhones.any { it in targetPhones }
  }

  private fun phoneVariants(phone: String?): Set<String> {
    val digits = phone?.filter(Char::isDigit).orEmpty()
    if (digits.length < 7) {
      return emptySet()
    }

    val normalized = if (digits.startsWith("00") && digits.length > 2) digits.drop(2) else digits
    val variants = mutableSetOf(normalized)

    if (normalized.startsWith("359") && normalized.length > 3) {
      variants.add("0${normalized.drop(3)}")
    }

    if (normalized.startsWith("0") && normalized.length == 10) {
      variants.add("359${normalized.drop(1)}")
    }

    return variants
  }

  private data class WhatsAppVoiceCallTarget(
    val dataId: Long,
    val mimeType: String,
    val packageName: String,
  )

  private companion object {
    val WHATSAPP_PACKAGE_BY_MIME_TYPE =
      mapOf(
        "vnd.android.cursor.item/vnd.com.whatsapp.voip.call" to "com.whatsapp",
        "vnd.android.cursor.item/vnd.com.whatsapp.w4b.voip.call" to "com.whatsapp.w4b",
      )

    val WHATSAPP_VOICE_CALL_MIME_TYPES = WHATSAPP_PACKAGE_BY_MIME_TYPE.keys.toTypedArray()

    val WHATSAPP_DATA_PROJECTION =
      arrayOf(
        ContactsContract.Data._ID,
        ContactsContract.Data.MIMETYPE,
        ContactsContract.Data.DATA1,
        ContactsContract.Data.DATA2,
        ContactsContract.Data.DATA3,
        ContactsContract.Data.DATA4,
      )
  }
}
